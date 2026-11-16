/**
 * 用例层（app layer）：文献证据路径 与 实验数据路径 **分开**。
 * v2：实验数据导入为**表格**；所有更正写**修订历史**；原件超限**拒绝**不截断。
 * AI：文献抽取走独立任务（services/ai.ts）；失败不冒充成功。
 */
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import type {
  AssetRecord,
  ColumnMeta,
  LitCardRecord,
  LocusState,
  MeasurementTableRecord,
  RevisionEntry,
  SubquestionRecord,
  TopicRecord,
} from "../store.ts";
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
const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
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
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** 表分析：跳过章节标记行，识别真表头，丢弃键列独占的空数据行。 */
export function analyseTable(rows: string[][]): { columns: string[]; body: string[][] } {
  const cleaned = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const nonEmpty = (r: string[]) => r.filter((c) => c.trim() !== "").length;
  let headerIdx = 0;
  for (let i = 0; i < Math.min(cleaned.length, 12); i++) {
    if (nonEmpty(cleaned[i]) >= 2) { headerIdx = i; break; }
  }
  const width = Math.max(...cleaned.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => (cleaned[headerIdx]?.[i] ?? "").trim() || `col${i + 1}`);
  const body = cleaned.slice(headerIdx + 1)
    .map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()))
    .filter((r) => nonEmpty(r) >= 2); // 丢弃“只有键列”/空行
  return { columns, body };
}

function makeAsset(kind: AssetRecord["kind"], name: string, text: string, topicId?: string): AssetRecord {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_IMPORT_BYTES) {
    throw new AppError(413, `文件超过上限 ${MAX_IMPORT_BYTES} 字节，已拒绝导入（不截断）。请缩减后再试。`);
  }
  return { id: `ast_${randomUUID()}`, kind, name: name.trim() || "未命名", topicId: topicId || undefined, bytes, hash: sha256(text), text, createdAt: now() };
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
}

function draftCards(assetId: string, text: string): LitCardRecord[] {
  return text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => newCard(assetId, p, { fields: {}, units: [] }, [], "draft"));
}

function newCard(
  assetId: string,
  rawText: string,
  extracted: { fields: Record<string, string>; units: string[] },
  unknowns: string[],
  extraction: LitCardRecord["extraction"],
): LitCardRecord {
  return {
    id: `card_${randomUUID()}`,
    assetId,
    rawText,
    locator: { sectionQuote: rawText.slice(0, 80) },
    // 抽取字段作为备注初值，不自动成为"已核对"结论。
    note: Object.keys(extracted.fields).length ? JSON.stringify(extracted.fields) : unknowns.length ? `未知：${unknowns.join("、")}` : "",
    audit: "unreviewed",
    importance: null,
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
    const result = await extractLiterature(ai, asset.text);
    cards = mapAiCards(asset.id, result.cards);
    audit = { raws: result.raws, model: ai.model };
  } else {
    cards = draftCards(asset.id, asset.text);
  }
  return { state: { ...state, assets: [...state.assets, asset], cards: [...state.cards, ...cards] }, asset, created: cards.length, audit };
}

/** 校验并映射文献抽取输出；结构不符即报错（不静默补造）。 */
function mapAiCards(assetId: string, cards: unknown[]): LitCardRecord[] {
  if (!Array.isArray(cards) || cards.length === 0) throw new AiError("文献抽取结果为空；未生成任何证据卡。");
  return cards.map((c) => {
    const card = c as { rawText?: string; extracted?: { fields?: Record<string, string>; units?: string[] }; unknowns?: string[] };
    const rawText = String(card.rawText ?? "").trim();
    if (!rawText) throw new AiError("文献抽取结果含空 rawText。");
    return newCard(assetId, rawText, { fields: card.extracted?.fields ?? {}, units: card.extracted?.units ?? [] }, card.unknowns ?? [], "ai");
  });
}

const CARD_BLOCKING_AUDIT = new Set<LitCardRecord["audit"]>(["exclude"]);

export interface CardPatch {
  audit?: LitCardRecord["audit"];
  importance?: LitCardRecord["importance"];
  note?: string;
  reason?: string;
  rawText?: string;
}

/** 人工核对证据卡：写修订历史；排除/改关键文本须原因。 */
export function reviewCard(state: LocusState, id: string, patch: CardPatch): LocusState {
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx < 0) throw new AppError(404, `证据卡不存在：${id}`);
  const cur = state.cards[idx];
  const reason = (patch.reason ?? cur.reason ?? "").trim();
  const textChanged = patch.rawText !== undefined && patch.rawText !== cur.rawText;
  const needsReason = (patch.audit !== undefined && CARD_BLOCKING_AUDIT.has(patch.audit)) || textChanged;
  if (needsReason && !reason) throw new AppError(422, "排除证据 / 修改关键文本，必须填写简短原因。");

  const diffs: [string, string, string][] = [];
  if (patch.rawText !== undefined && patch.rawText !== cur.rawText) diffs.push(["rawText", cur.rawText, patch.rawText]);
  if (patch.audit !== undefined && patch.audit !== cur.audit) diffs.push(["audit", cur.audit, patch.audit]);
  if (patch.importance !== undefined && patch.importance !== cur.importance) diffs.push(["importance", String(cur.importance ?? ""), String(patch.importance ?? "")]);
  if (patch.note !== undefined && patch.note !== cur.note) diffs.push(["note", cur.note, patch.note]);
  if (reason && reason !== cur.reason) diffs.push(["reason", cur.reason, reason]);

  const nextRev = cur.revision + (diffs.length ? 1 : 0);
  const history: RevisionEntry[] = [...cur.history];
  for (const [field, before, after] of diffs) history.push({ revision: nextRev, at: now(), field, before, after, reason });

  const next: LitCardRecord = {
    ...cur,
    rawText: patch.rawText ?? cur.rawText,
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
  return { ...state, cards };
}

// ── 路径②：实验数据（保留表格结构）─────────────────────────
/** 导入 CSV/TSV → **一张表格**（保留行列结构），供按表/列核对。 */
export function importMeasurements(state: LocusState, input: { name: string; csv: string; topicId?: string }): ImportResult {
  const name = input.name ?? "";
  assertCsvName(name);
  const text = stripBom(input.csv ?? "");
  assertTextual(text);
  const asset = makeAsset("measurement", name, text, input.topicId);
  assertUniqueHash(state, asset.hash);
  // 分隔符判定：首行无 ,/\t → 视为仪器导出等非表格格式（解析器未配置），明确拒绝，不硬解析成垃圾表。
  const delim = detectDelimiter(asset.text);
  if (!delim) throw new AppError(422, "看起来不是 CSV/TSV 表格（仪器导出等格式解析器未配置）。请提供带分隔符、表头在首行的表格。");
  const rows = parseCsv(asset.text, delim);
  if (rows.length < 2) throw new AppError(422, "表格至少需要表头 + 一行数据。");
  const { columns, body } = analyseTable(rows);
  if (body.length === 0) throw new AppError(422, "解析后没有可核对的数据行（可能只有表头或章节标记）。");
  const table: MeasurementTableRecord = {
    id: `tbl_${randomUUID()}`,
    assetId: asset.id,
    name: asset.name,
    columns,
    rows: body,
    columnMeta: columns.map<ColumnMeta>((cname) => ({ name: cname, unit: "", decision: "unreviewed" })),
    note: "",
    revision: 1,
    history: [],
    createdAt: now(),
    updatedAt: now(),
  };
  return { state: { ...state, assets: [...state.assets, asset], tables: [...state.tables, table] }, asset, created: body.length };
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
