/**
 * 用例层（app layer）：文献证据路径 与 实验数据路径 **分开**。
 * v2：实验数据导入为**表格**；所有更正写**修订历史**；原件超限**拒绝**不截断。
 * AI：文献抽取走独立任务（services/ai.ts）；失败不冒充成功。
 */
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type {
  AdoptionRecord,
  AssetRecord,
  CardExtracted,
  ColumnMeta,
  ComparisonEntry,
  ComparisonGroup,
  ComparisonRecord,
  LitCardRecord,
  LocusState,
  MeasurementTableRecord,
  NameMappingRecord,
  RevisionEntry,
  SubquestionRecord,
  TopicRecord,
} from "../store.ts";
import { contentHash } from "../store.ts";
import { AiError, extractLiterature, type AiConfig } from "./ai.ts";

/** 原件大小上限（字节）。超过即拒绝导入，绝不静默截断。 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export class AppError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
const stripBom = (t: string) => t.replace(/^\uFEFF/, "");

/** 文献暂只支持 Markdown / 纯文本；其他格式解析器未配置，明确拒绝。 */
const LIT_EXT = new Set([".md", ".markdown", ".txt", ".text", ""]);
function assertLiteratureName(name: string): void {
  const ext = extname(name).toLowerCase();
  if (!LIT_EXT.has(ext)) throw new AppError(422, `文献暂只支持 Markdown/纯文本（.md/.markdown/.txt）；${ext} 解析器未配置。`);
}
/** 实验数据暂只支持 CSV/TSV；其他格式解析器未配置。 */
const CSV_EXT = new Set([".csv", ".tsv", ".txt", ""]);
function assertCsvName(name: string): void {
  const ext = extname(name).toLowerCase();
  if (!CSV_EXT.has(ext)) throw new AppError(422, `实验数据暂只支持 CSV（.csv/.tsv）；${ext} 解析器未配置。`);
}
function assertTextual(text: string): void {
  if (text.includes("\u0000")) throw new AppError(422, "文件疑似二进制/含不支持内容，已拒绝。请提供文本类文件。");
}
/** 内容 hash 拒重（LIT07）。 */
function assertUniqueHash(state: LocusState, hash: string): void {
  if (state.assets.some((a) => a.hash === hash)) throw new AppError(409, "已导入相同内容（文件 hash 相同），已拒收。");
}
/** 判断分隔符：以**首个非空行**为准（表头在首行才算常规表格）。返回 "," / "\t" / null。 */
export function detectDelimiter(text: string): "," | "\t" | null {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!first) return null;
  if (first.includes("\t")) return "\t";
  if (first.includes(",")) return ",";
  return null;
}

export function parseCsv(text: string, delim = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delim) { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  // 保留全空行：它们是表块边界（splitBlocks 依赖），由调用方自行过滤。
  return rows;
}

/** 自动判断表头行数：两级表头须符合**合并单元格**语义——第二级在首级空缺处有续列。 */
function autoHeaderLevels(cleaned: string[][], h: number): number {
  const l1 = cleaned[h] ?? [];
  const l2 = cleaned[h + 1] ?? [];
  const first2 = (l2[0] ?? "").trim();
  if (/^[a-z]{1,3}\d{1,3}$/i.test(first2)) return 1; // 下一行像行号(r0/r1) → 单级
  const n2 = l2.filter((c) => c.trim() !== "").length;
  if (n2 < 2) return 1;
  // 第二级全为数值 → 是数据行而非列名（单级表头中间有空列时不误吞数据）。
  const numeric = /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i;
  if (l2.every((c) => c.trim() === "" || numeric.test(c.trim()))) return 1;
  return l2.some((c, i) => c.trim() !== "" && (l1[i] ?? "").trim() === "") ? 2 : 1;
}

/** 一个表块：标题行（单格行）归属其后的块；全空行是块边界。 */
export interface TableBlock {
  title: string | null;
  rows: string[][];
}

/** 按标题行/全空行把整文件切成多个表块（EnzymeML 导出常多表叠放）。 */
export function splitBlocks(rows: string[][]): TableBlock[] {
  const blocks: TableBlock[] = [];
  let cur: TableBlock | null = null;
  let lastTitle: string | null = null;
  const close = () => { if (cur && cur.rows.length) blocks.push(cur); cur = null; };
  for (const r of rows) {
    const filled = r.filter((c) => c.trim() !== "");
    if (filled.length === 0) { close(); continue; }
    if (filled.length === 1) {
      // 仅首列单格行是章节标题；其余单格行是列表残行/备注，不作标题也不入表体。
      if (r.findIndex((c) => c.trim() !== "") === 0) { close(); lastTitle = filled[0].trim(); }
      continue;
    }
    if (!cur) cur = { title: lastTitle, rows: [] };
    cur.rows.push(r);
  }
  close();
  return blocks;
}

/**
 * 表分析（单个表块内）：识别表头（合并单元格两级时组名前向填充），
 * 首尾全空列裁剪，保留全部数据行并标出**块标记行**（如时间块标题，非测量行）。
 * headerRows：1 / 2 / "auto"（默认自动）。
 */
export function analyseTable(rows: string[][], headerRows: 1 | 2 | "auto" = "auto"): { columns: string[]; body: string[][]; markerRows: number[] } {
  const nonEmpty = (r: string[]) => r.filter((c) => c.trim() !== "").length;
  // 单格行是标题/章节标记，不属于表格本体（分块时已剥离，这里再兜底）。
  const cleaned = rows.filter((r) => nonEmpty(r) >= 2);
  let h = 0;
  for (let i = 0; i < Math.min(cleaned.length, 12); i++) {
    if (nonEmpty(cleaned[i]) >= 2) { h = i; break; }
  }
  const levels = headerRows === "auto" ? autoHeaderLevels(cleaned, h) : headerRows;
  // 宽度按“首/末非空列”裁剪，避免首尾全空列产生大量 colN 占位。
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const r of cleaned) r.forEach((c, i) => { if (c.trim() !== "") { if (i < first) first = i; if (i + 1 > last) last = i + 1; } });
  if (!Number.isFinite(first)) first = 0;
  const at = (r: string[] | undefined, i: number) => (r?.[first + i] ?? "").trim();
  let group = "";
  const columns = Array.from({ length: last - first }, (_, i) => {
    const a = at(cleaned[h], i);
    const b = levels === 2 ? at(cleaned[h + 1], i) : "";
    if (a) group = a;
    const parts = levels === 2 ? (a && b ? [a, b] : b ? [group, b] : a ? [a] : []) : a ? [a] : [];
    return parts.join("/") || `col${i + 1}`;
  });
  const body = cleaned.slice(h + levels)
    .map((r) => Array.from({ length: last - first }, (_, i) => at(r, i)))
    .filter((r) => nonEmpty(r) >= 2);
  // 块标记行：非空格数 ≤ 表头一半、且集中在前缀列（原件中的分块标题，如 "0,Time [min],…"）。
  const headFilled = columns.filter((c) => !/^col\d+$/.test(c)).length;
  const markerRows: number[] = [];
  body.forEach((r, i) => {
    const idx = r.map((c, j) => (c !== "" ? j : -1)).filter((j) => j >= 0);
    if (idx.length >= 2 && idx.length * 2 <= headFilled && idx.every((j, k) => j === k)) markerRows.push(i);
  });
  return { columns, body, markerRows };
}

function makeAsset(kind: AssetRecord["kind"], name: string, text: string, topicId?: string): AssetRecord {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_IMPORT_BYTES) {
    throw new AppError(413, `文件超过上限 ${MAX_IMPORT_BYTES} 字节，已拒绝导入（不截断）。请缩减后再试。`);
  }
  return { id: `ast_${randomUUID()}`, kind, name: name.trim() || "未命名", topicId: topicId || undefined, bytes, hash: contentHash(text), text, createdAt: now() };
}

// ── 课题 / 子问题（TOP01）────────────────────────────────────
export function createTopic(state: LocusState, input: { name: string; researchQuestion: string }): { state: LocusState; topic: TopicRecord } {
  const name = (input.name ?? "").trim();
  const q = (input.researchQuestion ?? "").trim();
  if (!name) throw new AppError(422, "课题名称不能为空。");
  if (!q) throw new AppError(422, "研究问题不能为空。");
  const topic: TopicRecord = { id: `topic_${randomUUID()}`, name, researchQuestion: q, createdAt: now() };
  return { state: { ...state, topics: [...state.topics, topic] }, topic };
}

export function createSubquestion(
  state: LocusState,
  input: { topicId: string; question: string; kind?: "declared" | "exploratory" },
): { state: LocusState; subquestion: SubquestionRecord } {
  if (!state.topics.some((t) => t.id === input.topicId)) throw new AppError(404, `课题不存在：${input.topicId}`);
  const question = (input.question ?? "").trim();
  if (!question) throw new AppError(422, "子问题不能为空。");
  const subquestion: SubquestionRecord = {
    id: `subq_${randomUUID()}`,
    topicId: input.topicId,
    question,
    kind: input.kind === "exploratory" ? "exploratory" : "declared",
    createdAt: now(),
  };
  return { state: { ...state, subquestions: [...state.subquestions, subquestion] }, subquestion };
}

// ── 路径①：文献证据 ─────────────────────────────────────────
export interface ImportResult {
  state: LocusState;
  asset: AssetRecord;
  created: number;
  /** AI 模式：原始模型响应（供审计留存；不含认证头）。 */
  audit?: { raws: { index: number; content: string }[]; model: string };
  /** 新文献入库且已有比较快照 → 只提醒是否重比，不自动改结论（LIT10）。 */
  reminder?: boolean;
}

function draftCards(assetId: string, text: string): LitCardRecord[] {
  return text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => newCard(assetId, p, { fields: {}, units: [], conditions: [] }, [], "draft"));
}

function newCard(
  assetId: string,
  rawText: string,
  extracted: CardExtracted,
  unknowns: string[],
  extraction: LitCardRecord["extraction"],
  sectionQuote?: string,
  secondaryCitation = false,
): LitCardRecord {
  return {
    id: `card_${randomUUID()}`,
    assetId,
    rawText,
    locator: { sectionQuote: sectionQuote ?? rawText.slice(0, 80) },
    extracted,
    unknowns,
    secondaryCitation,
    audit: "unreviewed",
    importance: null,
    note: "",
    reason: "",
    extraction,
    revision: 1,
    history: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * 导入文献文本 → 证据卡草稿。
 * mode="ai"：调用文献抽取任务（独立提示词/结构）；失败抛 AiError（不冒充成功、不降级为假 AI）。
 * mode="draft"：按行生成草稿（明确标注 extraction="draft"）。
 */
export async function importLiterature(
  state: LocusState,
  input: { name: string; text: string; mode?: "draft" | "ai"; topicId?: string },
  ai: AiConfig | null,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const name = input.name ?? "";
  assertLiteratureName(name);
  const text = stripBom(input.text ?? "");
  const asset = makeAsset("literature", name, text, input.topicId);
  assertUniqueHash(state, asset.hash);
  let cards: LitCardRecord[];
  let audit: ImportResult["audit"];
  if (input.mode === "ai") {
    if (!ai) throw new AppError(400, "未配置 AI：请在页面「AI 配置」填写 baseUrl / 模型 / Key。");
    const result = await extractLiterature(ai, asset.text, onProgress);
    cards = mapAiCards(asset, result.cards);
    audit = { raws: result.raws, model: ai.model };
  } else {
    cards = draftCards(asset.id, asset.text);
  }
  const reminder = state.comparisons.some((c) => !input.topicId || c.topicId === input.topicId);
  return { state: { ...state, assets: [...state.assets, asset], cards: [...state.cards, ...cards] }, asset, created: cards.length, audit, reminder };
}

/** 校验并映射文献抽取输出；结构不符即报错（不静默补造）；定位/片段须在原件中可匹配，否则明示不足。 */
function mapAiCards(asset: AssetRecord, cards: unknown[]): LitCardRecord[] {
  if (!Array.isArray(cards) || cards.length === 0) throw new AiError("文献抽取结果为空；未生成任何证据卡。");
  return cards.map((c) => {
    const card = c as {
      rawText?: string;
      locator?: { sectionQuote?: string };
      extracted?: { fields?: Record<string, string>; units?: string[]; conditions?: string[] };
      unknowns?: string[];
      secondaryCitation?: boolean;
    };
    const rawText = String(card.rawText ?? "").trim();
    if (!rawText) throw new AiError("文献抽取结果含空 rawText。");
    const unknowns = Array.isArray(card.unknowns) ? card.unknowns.map(String) : [];
    const quote = String(card.locator?.sectionQuote ?? "").trim();
    const rawMatches = asset.text.includes(rawText);
    let sectionQuote: string;
    if (quote && asset.text.includes(quote)) sectionQuote = quote;
    else if (rawMatches) sectionQuote = rawText.slice(0, 80);
    else sectionQuote = "";
    if (quote && !asset.text.includes(quote)) unknowns.push("定位引文未在原件中匹配（定位不足）");
    if (!rawMatches) unknowns.push("片段未在原件中逐字匹配（可能经模型改写，需人工核对）");
    const extracted: CardExtracted = {
      fields: card.extracted?.fields ?? {},
      units: Array.isArray(card.extracted?.units) ? card.extracted.units.map(String) : [],
      conditions: Array.isArray(card.extracted?.conditions) ? card.extracted.conditions.map(String) : [],
    };
    return newCard(asset.id, rawText, extracted, unknowns, "ai", sectionQuote, card.secondaryCitation === true);
  });
}

const CARD_BLOCKING_AUDIT = new Set<LitCardRecord["audit"]>(["exclude"]);

export interface CardPatch {
  audit?: LitCardRecord["audit"];
  importance?: LitCardRecord["importance"];
  note?: string;
  reason?: string;
  rawText?: string;
  secondaryCitation?: boolean;
  extracted?: { fields?: Record<string, string>; units?: string[]; conditions?: string[] };
}

/** 人工核对证据卡：写修订历史；排除/改关键文本/改抽取字段/标转引须原因。 */
export function reviewCard(state: LocusState, id: string, patch: CardPatch): LocusState {
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx < 0) throw new AppError(404, `证据卡不存在：${id}`);
  const cur = state.cards[idx];
  const reason = (patch.reason ?? cur.reason ?? "").trim();
  const textChanged = patch.rawText !== undefined && patch.rawText !== cur.rawText;
  const markingSecondary = patch.secondaryCitation === true && !cur.secondaryCitation;
  const fieldsChanged = patch.extracted?.fields !== undefined && JSON.stringify(patch.extracted.fields) !== JSON.stringify(cur.extracted.fields);
  const needsReason = (patch.audit !== undefined && CARD_BLOCKING_AUDIT.has(patch.audit)) || textChanged || markingSecondary || fieldsChanged;
  // 阻断性动作须给**本次**原因，不复用旧原因（旧原因解释的是上一次修改）。
  if (needsReason && !(patch.reason ?? "").trim()) throw new AppError(422, "排除证据 / 修改关键文本或字段 / 标记转引，必须填写简短原因。");

  const diffs: [string, string, string][] = [];
  if (textChanged) diffs.push(["rawText", cur.rawText, patch.rawText!]);
  if (patch.audit !== undefined && patch.audit !== cur.audit) diffs.push(["audit", cur.audit, patch.audit]);
  if (patch.importance !== undefined && patch.importance !== cur.importance) diffs.push(["importance", String(cur.importance ?? ""), String(patch.importance ?? "")]);
  if (patch.note !== undefined && patch.note !== cur.note) diffs.push(["note", cur.note, patch.note]);
  if (patch.secondaryCitation !== undefined && patch.secondaryCitation !== cur.secondaryCitation) diffs.push(["secondaryCitation", String(cur.secondaryCitation), String(patch.secondaryCitation)]);
  const nextExtracted: CardExtracted = {
    fields: patch.extracted?.fields ?? cur.extracted.fields,
    units: patch.extracted?.units ?? cur.extracted.units,
    conditions: patch.extracted?.conditions ?? cur.extracted.conditions,
  };
  if (fieldsChanged) {
    const keys = new Set([...Object.keys(cur.extracted.fields), ...Object.keys(nextExtracted.fields)]);
    for (const k of keys) {
      const b = cur.extracted.fields[k] ?? "";
      const a = nextExtracted.fields[k] ?? "";
      if (a !== b) diffs.push([`extracted.fields.${k}`, b, a]);
    }
  }
  if (patch.extracted?.units !== undefined && patch.extracted.units.join("|") !== cur.extracted.units.join("|")) diffs.push(["extracted.units", cur.extracted.units.join("|"), patch.extracted.units.join("|")]);
  if (patch.extracted?.conditions !== undefined && patch.extracted.conditions.join("|") !== cur.extracted.conditions.join("|")) diffs.push(["extracted.conditions", cur.extracted.conditions.join("|"), patch.extracted.conditions.join("|")]);
  if (reason && reason !== cur.reason) diffs.push(["reason", cur.reason, reason]);

  const nextRev = cur.revision + (diffs.length ? 1 : 0);
  const history: RevisionEntry[] = [...cur.history];
  for (const [field, before, after] of diffs) history.push({ revision: nextRev, at: now(), field, before, after, reason });

  const next: LitCardRecord = {
    ...cur,
    rawText: patch.rawText ?? cur.rawText,
    extracted: nextExtracted,
    secondaryCitation: patch.secondaryCitation ?? cur.secondaryCitation,
    audit: patch.audit ?? cur.audit,
    importance: patch.importance !== undefined ? patch.importance : cur.importance,
    note: patch.note ?? cur.note,
    reason,
    revision: nextRev,
    history,
    updatedAt: now(),
  };
  const cards = state.cards.slice();
  cards[idx] = next;
  // 已入比较快照的卡被修改 → 标复核（不自动改快照，T15）。
  let comparisons = state.comparisons;
  if (nextRev > cur.revision) {
    comparisons = state.comparisons.map((cmp) => {
      const hit = cmp.groups.some((g) => g.entries.some((e) => e.cardId === id && e.cardRevision < nextRev));
      if (!hit || cmp.reviewFlags.some((f) => f.cardId === id && f.cardRevision === nextRev)) return cmp;
      return { ...cmp, reviewFlags: [...cmp.reviewFlags, { cardId: id, cardRevision: nextRev, at: now() }] };
    });
  }
  return { ...state, cards, comparisons };
}

// ── 候选库 / 补卡 / 组审 / 采用 / 映射 / 比较（4B）──────────
export type CandidateState = "unreviewed" | "pending" | "reviewed" | "adopted";

/** 候选库状态：跳过保持未复核；任务采用独立于核对（排除≠采用）。 */
export function candidateStateOf(card: LitCardRecord, adoptions: readonly AdoptionRecord[]): CandidateState {
  if (adoptions.some((a) => a.cardId === card.id && a.decision === "adopt")) return "adopted";
  if (card.audit === "need_info") return "pending";
  if (card.audit === "confirm" || card.audit === "exclude") return "reviewed";
  return "unreviewed"; // unreviewed / skip
}

/** 独立证据计数：转引（二手）与未确认不计（LIT08）。 */
export function independentEvidenceCount(state: LocusState, topicId?: string): number {
  return state.cards.filter((c) => {
    if (c.audit !== "confirm" || c.secondaryCitation) return false;
    if (!topicId) return true;
    return state.assets.find((a) => a.id === c.assetId)?.topicId === topicId;
  }).length;
}

/** 手动补卡：定位引文若给出必须与原件匹配；不给则明示定位不足，不得正式采用。 */
export function addManualCard(
  state: LocusState,
  input: { assetId: string; rawText: string; sectionQuote?: string; fields?: Record<string, string>; units?: string[]; conditions?: string[]; unknowns?: string[]; secondaryCitation?: boolean; reason?: string },
): { state: LocusState; card: LitCardRecord } {
  const asset = state.assets.find((a) => a.id === input.assetId);
  if (!asset) throw new AppError(404, `素材不存在：${input.assetId}`);
  if (asset.kind !== "literature") throw new AppError(422, "手动补卡仅用于文献路径；实验数据请按表格核对。");
  const rawText = (input.rawText ?? "").trim();
  if (!rawText) throw new AppError(422, "补卡内容不能为空。");
  const quote = (input.sectionQuote ?? "").trim();
  if (quote && !asset.text.includes(quote)) throw new AppError(422, "定位引文与原件不匹配；请粘贴原文中的连续片段，或留空（将明示定位不足）。");
  if (input.secondaryCitation && !(input.reason ?? "").trim()) throw new AppError(422, "标记综述转引（二手）必须填写依据。");
  const card = newCard(
    asset.id, rawText,
    { fields: input.fields ?? {}, units: input.units ?? [], conditions: input.conditions ?? [] },
    input.unknowns ?? [], "manual", quote || (asset.text.includes(rawText) ? rawText.slice(0, 80) : ""),
    input.secondaryCitation === true,
  );
  return { state: { ...state, cards: [...state.cards, card] }, card };
}

export interface BatchPreview {
  count: number;
  sharedConditions: string[];
  missing: string[];
  anomalies: string[];
  requiresAck: boolean;
}

/** 组审预览：先呈现共享条件/缺定位/缺项，未 ack 不得整组确认。 */
export function batchPreview(state: LocusState, ids: string[]): BatchPreview {
  const cards = ids.map((id) => {
    const c = state.cards.find((x) => x.id === id);
    if (!c) throw new AppError(404, `证据卡不存在：${id}`);
    return c;
  });
  const conditions = new Set<string>();
  const missing: string[] = [];
  const anomalies: string[] = [];
  for (const c of cards) {
    for (const u of c.extracted.units) conditions.add(`单位：${u}`);
    for (const cond of c.extracted.conditions) conditions.add(cond);
    if (!c.locator.sectionQuote) missing.push(c.id);
    if (c.unknowns.length > 0) anomalies.push(c.id);
  }
  return { count: cards.length, sharedConditions: [...conditions], missing, anomalies, requiresAck: cards.length > 1 };
}

export function batchConfirm(state: LocusState, ids: string[], ack: boolean): LocusState {
  const preview = batchPreview(state, ids);
  if (preview.requiresAck && !ack) throw new AppError(422, "批量确认前必须先呈现共享条件/缺项/异常并勾选确认。");
  let s = state;
  for (const id of ids) s = reviewCard(s, id, { audit: "confirm" });
  return s;
}

/** 任务采用/排除：独立维度；采用须已确认且有定位；一卡可被多任务引用。 */
export function upsertAdoption(
  state: LocusState,
  input: { cardId: string; subquestionId: string; decision: "adopt" | "exclude"; reason?: string },
): { state: LocusState; adoption: AdoptionRecord } {
  const card = state.cards.find((c) => c.id === input.cardId);
  if (!card) throw new AppError(404, `证据卡不存在：${input.cardId}`);
  if (!state.subquestions.some((q) => q.id === input.subquestionId)) throw new AppError(404, `子问题不存在：${input.subquestionId}`);
  if (input.decision !== "adopt" && input.decision !== "exclude") throw new AppError(422, "采用决定只能是 adopt / exclude。");
  const reason = (input.reason ?? "").trim();
  if (input.decision === "adopt" && (card.audit !== "confirm" || !card.locator.sectionQuote)) {
    throw new AppError(422, "不足以正式采用：核对未确认或缺少原文定位（可先暂存搜索，不用于正式判断）。");
  }
  if (input.decision === "exclude" && !reason) throw new AppError(422, "任务排除必须填写简短原因。");
  const existing = state.adoptions.find((a) => a.cardId === input.cardId && a.subquestionId === input.subquestionId);
  if (existing) {
    const diffs: [string, string, string][] = [];
    if (existing.decision !== input.decision) diffs.push(["decision", existing.decision, input.decision]);
    if (reason !== existing.reason) diffs.push(["reason", existing.reason, reason]);
    if (existing.cardRevision !== card.revision) diffs.push(["cardRevision", String(existing.cardRevision), String(card.revision)]);
    const nextRev = existing.revision + (diffs.length ? 1 : 0);
    const history = [...existing.history];
    for (const [field, before, after] of diffs) history.push({ revision: nextRev, at: now(), field, before, after, reason });
    const adoption: AdoptionRecord = { ...existing, decision: input.decision, reason, cardRevision: card.revision, revision: nextRev, history, updatedAt: now() };
    return { state: { ...state, adoptions: state.adoptions.map((a) => (a.id === adoption.id ? adoption : a)) }, adoption };
  }
  const adoption: AdoptionRecord = {
    id: `adp_${randomUUID()}`, cardId: card.id, subquestionId: input.subquestionId, decision: input.decision, reason,
    cardRevision: card.revision, revision: 1, history: [], createdAt: now(), updatedAt: now(),
  };
  return { state: { ...state, adoptions: [...state.adoptions, adoption] }, adoption };
}

/** 命名映射：原名保留，依据必填；禁止仅按同名自动合并（LIT09）。 */
export function createMapping(state: LocusState, input: { original: string; mapped: string; basis: string; topicId?: string }): { state: LocusState; mapping: NameMappingRecord } {
  const original = (input.original ?? "").trim();
  const mapped = (input.mapped ?? "").trim();
  const basis = (input.basis ?? "").trim();
  if (!original || !mapped) throw new AppError(422, "原名与映射名均不能为空。");
  if (!basis) throw new AppError(422, "命名映射必须有来源依据；禁止仅按同名自动合并。");
  if (input.topicId && !state.topics.some((t) => t.id === input.topicId)) throw new AppError(404, `课题不存在：${input.topicId}`);
  const mapping: NameMappingRecord = { id: `map_${randomUUID()}`, topicId: input.topicId || undefined, original, mapped, basis, createdAt: now() };
  return { state: { ...state, mappings: [...state.mappings, mapping] }, mapping };
}

/**
 * 条件差异/分歧比较：仅已确认证据卡可入；固定卡 revision 与全部输入口径；
 * 不自动合并/平均；追加式新快照，不覆盖旧结论（LIT10）。
 */
export function createComparison(
  state: LocusState,
  input: { topicId: string; subquestionId?: string; cardIds: string[]; filters?: string[]; conversions?: string[]; exclusions?: string[]; note?: string },
): { state: LocusState; comparison: ComparisonRecord } {
  if (!state.topics.some((t) => t.id === input.topicId)) throw new AppError(404, `课题不存在：${input.topicId}`);
  if (input.subquestionId && !state.subquestions.some((q) => q.id === input.subquestionId && q.topicId === input.topicId)) throw new AppError(404, "子问题不存在或不属于该课题。");
  const ids = input.cardIds ?? [];
  if (ids.length === 0) throw new AppError(422, "比较至少选择一张证据卡。");
  const cards = ids.map((id) => {
    const c = state.cards.find((x) => x.id === id);
    if (!c) throw new AppError(404, `证据卡不存在：${id}`);
    if (c.audit !== "confirm") throw new AppError(422, `证据卡 ${id} 未确认，不能进入正式比较（先核对）。`);
    if (state.assets.find((a) => a.id === c.assetId)?.topicId !== input.topicId) throw new AppError(422, `证据卡 ${id} 不属于该课题。`);
    return c;
  });
  const mappings = state.mappings.filter((m) => !m.topicId || m.topicId === input.topicId);
  const entries: ComparisonEntry[] = [];
  for (const c of cards) {
    const fields = Object.entries(c.extracted.fields);
    const unit = c.extracted.units.length === 1 ? c.extracted.units[0] : "";
    if (fields.length === 0) {
      entries.push({ cardId: c.id, cardRevision: c.revision, originalName: "(原文片段)", mappedName: "(原文片段)", value: c.rawText, unit, conditions: c.extracted.conditions });
      continue;
    }
    for (const [name, value] of fields) {
      const m = mappings.find((x) => x.original === name);
      entries.push({ cardId: c.id, cardRevision: c.revision, originalName: name, mappedName: m?.mapped ?? name, value, unit, conditions: c.extracted.conditions });
    }
  }
  const byName = new Map<string, ComparisonEntry[]>();
  for (const e of entries) byName.set(e.mappedName, [...(byName.get(e.mappedName) ?? []), e]);
  const groups: ComparisonGroup[] = [...byName.entries()].map(([name, es]) => {
    const unresolved: string[] = [];
    for (const e of es) {
      const card = cards.find((c) => c.id === e.cardId)!;
      if (card.unknowns.length > 0) unresolved.push(`卡 ${e.cardId} 有缺项：${card.unknowns.join("、")}`);
      if (!e.unit) unresolved.push(`卡 ${e.cardId}「${e.originalName}」单位未明`);
      if (card.extracted.units.length > 1) unresolved.push(`卡 ${e.cardId} 多单位未与字段关联`);
      if (card.secondaryCitation) unresolved.push(`卡 ${e.cardId} 为综述转引（二手），不计独立证据`);
    }
    let divergence: ComparisonGroup["divergence"] = "single";
    if (es.length > 1) {
      const values = new Set(es.map((e) => e.value));
      const condSets = new Set(es.map((e) => [...e.conditions].sort().join("|")));
      divergence = values.size > 1 ? "value_diff" : condSets.size > 1 ? "conditions_diff" : "consistent";
    }
    return { name, entries: es, divergence, unresolved: [...new Set(unresolved)] };
  });
  const filters = input.filters ?? [];
  const conversions = input.conversions ?? [];
  const exclusions = input.exclusions ?? [];
  const mappingIds = mappings.map((m) => m.id);
  const dataRevision = contentHash(JSON.stringify({ entries, filters, conversions, exclusions, mappingIds }));
  const comparison: ComparisonRecord = {
    id: `cmp_${randomUUID()}`, topicId: input.topicId, subquestionId: input.subquestionId || undefined,
    snapshot: { dataRevision, filters, conversions, exclusions, mappingIds, pinnedAt: now() },
    groups, reviewFlags: [], note: input.note ?? "", createdAt: now(),
  };
  return { state: { ...state, comparisons: [...state.comparisons, comparison] }, comparison };
}

// ── 路径②：实验数据（保留表格结构）─────────────────────────
/** 格式 profile：解析规则只在声明的 profile 内生效；auto 仅判定一次，可人工 override。 */
export type FormatProfile = "plain-table" | "enzymeML-blocks";

export function detectProfile(rows: string[][]): FormatProfile {
  const blocks = splitBlocks(rows);
  if (blocks.length > 1 || blocks.some((b) => b.title)) return "enzymeML-blocks";
  const cleaned = (blocks[0]?.rows ?? []).filter((r) => r.filter((c) => c.trim() !== "").length >= 2);
  return autoHeaderLevels(cleaned, 0) === 2 ? "enzymeML-blocks" : "plain-table";
}

/**
 * 导入 CSV/TSV → **一张或多张表格**（保留行列结构），供按表/列核对。
 * profile：plain-table（单表矩形）/ enzymeML-blocks（标题行+分块+合并表头+标记行）/ 默认 auto 判定。
 */
export function importMeasurements(state: LocusState, input: { name: string; csv: string; topicId?: string; headerRows?: 1 | 2 | "auto"; profile?: FormatProfile | "auto" }): ImportResult {
  const name = input.name ?? "";
  assertCsvName(name);
  const text = stripBom(input.csv ?? "");
  assertTextual(text);
  const asset = makeAsset("measurement", name, text, input.topicId);
  assertUniqueHash(state, asset.hash);
  // 分隔符判定：首行无 ,/\t → 视为仪器导出等非表格格式（解析器未配置），明确拒绝，不硬解析成垃圾表。
  const delim = detectDelimiter(asset.text);
  if (!delim) throw new AppError(422, "首行未发现分隔符（可能是带前置标题的 CSV 或仪器导出格式）。请移除标题行、或用带表头在首行的 CSV/TSV。");
  const rows = parseCsv(asset.text, delim);
  if (rows.length < 2) throw new AppError(422, "表格至少需要表头 + 一行数据。");
  // 整文件可能叠放多张表：按标题行/空行分块，每块独立识别表头与数据行。
  const profile = input.profile === "plain-table" || input.profile === "enzymeML-blocks" ? input.profile : detectProfile(rows);
  const parsed = (profile === "plain-table"
    ? [{ title: null as string | null, ...analyseTable(rows, input.headerRows ?? "auto") }]
    : splitBlocks(rows).map((b) => ({ title: b.title, ...analyseTable(b.rows, input.headerRows ?? "auto") }))
  ).filter((b) => b.body.length > 0);
  if (parsed.length === 0) throw new AppError(422, "解析后没有可核对的数据行（可能只有表头或章节标记）。");
  const tables = parsed.map((b, i) => {
    const suffix = b.title ? ` · ${b.title}` : "";
    const idx = parsed.length > 1 ? ` (${i + 1}/${parsed.length})` : "";
    const table: MeasurementTableRecord = {
      id: `tbl_${randomUUID()}`,
      assetId: asset.id,
      name: `${asset.name}${suffix}${idx}`,
      columns: b.columns,
      rows: b.body,
      columnMeta: b.columns.map<ColumnMeta>((cname) => ({ name: cname, unit: "", decision: "unreviewed" })),
      markerRows: b.markerRows,
      note: "",
      revision: 1,
      history: [],
      createdAt: now(),
      updatedAt: now(),
    };
    return table;
  });
  const created = tables.reduce((n, t) => n + t.rows.length, 0);
  return { state: { ...state, assets: [...state.assets, asset], tables: [...state.tables, ...tables] }, asset, created };
}

export interface TablePatch {
  columnUpdates?: { index: number; unit?: string; decision?: ColumnMeta["decision"] }[];
  cellUpdates?: { row: number; col: number; value: string }[];
  note?: string;
  reason?: string;
}

/** 按表/列核对表格：写修订历史；**改单元格数值必须给原因**。 */
export function reviewTable(state: LocusState, id: string, patch: TablePatch): LocusState {
  const idx = state.tables.findIndex((t) => t.id === id);
  if (idx < 0) throw new AppError(404, `表格不存在：${id}`);
  const cur = state.tables[idx];
  const reason = (patch.reason ?? "").trim();
  const cellUpdates = patch.cellUpdates ?? [];
  if (cellUpdates.length > 0 && !reason) throw new AppError(422, "修改单元格数值必须填写简短原因。");

  const diffs: [string, string, string][] = [];
  const columnMeta = cur.columnMeta.map((m) => ({ ...m }));
  for (const u of patch.columnUpdates ?? []) {
    const m = columnMeta[u.index];
    if (!m) throw new AppError(422, `列索引无效：${u.index}`);
    if (u.unit !== undefined && u.unit !== m.unit) { diffs.push([`col[${u.index}].unit`, m.unit, u.unit]); (columnMeta[u.index] as { unit: string }).unit = u.unit; }
    if (u.decision !== undefined && u.decision !== m.decision) { diffs.push([`col[${u.index}].decision`, m.decision, u.decision]); (columnMeta[u.index] as { decision: ColumnMeta["decision"] }).decision = u.decision; }
  }
  const rows = cur.rows.map((r) => r.slice());
  for (const c of cellUpdates) {
    const before = rows[c.row]?.[c.col];
    if (before === undefined) throw new AppError(422, `单元格越界：r${c.row},c${c.col}`);
    if (before !== c.value) { diffs.push([`cell[${c.row}][${c.col}]`, before, c.value]); rows[c.row][c.col] = c.value; }
  }
  if (patch.note !== undefined && patch.note !== cur.note) diffs.push(["note", cur.note, patch.note]);

  const nextRev = cur.revision + (diffs.length ? 1 : 0);
  const history: RevisionEntry[] = [...cur.history];
  for (const [field, before, after] of diffs) history.push({ revision: nextRev, at: now(), field, before, after, reason });

  const next: MeasurementTableRecord = {
    ...cur,
    rows,
    columnMeta,
    note: patch.note ?? cur.note,
    revision: nextRev,
    history,
    updatedAt: now(),
  };
  const tables = state.tables.slice();
  tables[idx] = next;
  return { ...state, tables };
}

// ── 原件回查 ────────────────────────────────────────────────
export interface SourceView {
  asset: AssetRecord;
  points: { id: string; kind: "card" | "table"; locate: string }[];
}

export function sourceView(state: LocusState, assetId: string): SourceView {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) throw new AppError(404, `素材不存在：${assetId}`);
  const points: SourceView["points"] = [];
  for (const c of state.cards) if (c.assetId === assetId) points.push({ id: c.id, kind: "card", locate: c.locator.sectionQuote });
  for (const t of state.tables) if (t.assetId === assetId) points.push({ id: t.id, kind: "table", locate: `表格《${t.name}》 ${t.rows.length} 行 × ${t.columns.length} 列` });
  return { asset, points };
}
