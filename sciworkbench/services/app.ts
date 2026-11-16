/**
 * 用例层（app layer）：文献证据路径 与 实验数据路径 **分开**。
 * v2：实验数据导入为**表格**；所有更正写**修订历史**；原件超限**拒绝**不截断。
 * AI：文献抽取走独立任务（services/ai.ts）；失败不冒充成功。
 */
import { createHash, randomUUID } from "node:crypto";
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
import { AiError, runTask, type AiConfig } from "./ai.ts";

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
  const asset = makeAsset("literature", input.name ?? "", input.text ?? "", input.topicId);
  let cards: LitCardRecord[];
  if (input.mode === "ai") {
    if (!ai) throw new AppError(400, "未配置 AI（需设置 LOCUS_AI_BASE_URL / LOCUS_AI_MODEL / LOCUS_AI_KEY）。");
    const raw = await runTask(ai, "literature_extract", asset.text);
    cards = mapAiCards(asset.id, raw);
  } else {
    cards = draftCards(asset.id, asset.text);
  }
  return { state: { ...state, assets: [...state.assets, asset], cards: [...state.cards, ...cards] }, asset, created: cards.length };
}

/** 校验并映射文献抽取输出；结构不符即报错（不静默补造）。 */
function mapAiCards(assetId: string, raw: unknown): LitCardRecord[] {
  const obj = raw as { cards?: unknown };
  if (!obj || !Array.isArray(obj.cards) || obj.cards.length === 0) {
    throw new AiError("文献抽取结果结构不符：缺少 cards。");
  }
  return obj.cards.map((c) => {
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
export function parseCsv(text: string): string[][] {
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
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** 导入 CSV → **一张表格**（保留行列结构），供按表/列核对。 */
export function importMeasurements(state: LocusState, input: { name: string; csv: string; topicId?: string }): ImportResult {
  const asset = makeAsset("measurement", input.name ?? "", input.csv ?? "", input.topicId);
  const rows = parseCsv(asset.text);
  if (rows.length < 2) throw new AppError(422, "CSV 至少需要表头 + 一行数据。");
  const width = Math.max(...rows.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => rows[0][i]?.trim() || `col${i + 1}`);
  const body = rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  const table: MeasurementTableRecord = {
    id: `tbl_${randomUUID()}`,
    assetId: asset.id,
    name: asset.name,
    columns,
    rows: body,
    columnMeta: columns.map<ColumnMeta>((name) => ({ name, unit: "", decision: "unreviewed" })),
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
