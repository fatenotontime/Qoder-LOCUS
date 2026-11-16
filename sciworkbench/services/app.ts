/**
 * 用例层（app layer）：文献证据路径 与 实验数据路径 **分开**。
 * 纯函数式：入参 state → 返回新 state + 结果；由 server 负责 load/save（存储可替换）。
 */
import { createHash, randomUUID } from "node:crypto";
import type { AssetRecord, LitCardRecord, LocusState, MeasurementRecord } from "../store.ts";

const MAX_TEXT = 512 * 1024;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function now(): string {
  return new Date().toISOString();
}

// ── 路径①：文献证据 ─────────────────────────────────────────
export interface ImportResult {
  state: LocusState;
  asset: AssetRecord;
  created: number;
}

/** 导入一段文献摘录/文本 → 生成待审证据卡草稿（抽取=草稿，非确认）。 */
export function importLiterature(state: LocusState, input: { name: string; text: string }): ImportResult {
  const text = (input.text ?? "").slice(0, MAX_TEXT);
  const name = (input.name ?? "").trim() || "未命名文献摘录";
  const asset: AssetRecord = {
    id: `ast_${randomUUID()}`,
    kind: "literature",
    name,
    bytes: Buffer.byteLength(text, "utf8"),
    hash: sha256(text),
    text,
    createdAt: now(),
  };
  const paragraphs = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const cards: LitCardRecord[] = paragraphs.map((p) => ({
    id: `card_${randomUUID()}`,
    assetId: asset.id,
    rawText: p,
    locator: { sectionQuote: p.slice(0, 80) },
    audit: "unreviewed",
    importance: null,
    note: "",
    reason: "",
    createdAt: now(),
    updatedAt: now(),
  }));
  return { state: { ...state, assets: [...state.assets, asset], cards: [...state.cards, ...cards] }, asset, created: cards.length };
}

export interface CardPatch {
  audit?: LitCardRecord["audit"];
  importance?: LitCardRecord["importance"];
  note?: string;
  reason?: string;
  keyValueChanged?: boolean;
}

const NEEDS_REASON = new Set<LitCardRecord["audit"]>(["exclude"]);

export function reviewCard(state: LocusState, id: string, patch: CardPatch): LocusState {
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx < 0) throw new AppError(404, `证据卡不存在：${id}`);
  const cur = state.cards[idx];
  const reason = (patch.reason ?? cur.reason ?? "").trim();
  const needsReason = (patch.audit !== undefined && NEEDS_REASON.has(patch.audit)) || patch.keyValueChanged === true;
  if (needsReason && !reason) throw new AppError(422, "修改关键数值 / 排除证据，必须填写简短原因。");
  const next: LitCardRecord = {
    ...cur,
    audit: patch.audit ?? cur.audit,
    importance: patch.importance !== undefined ? patch.importance : cur.importance,
    note: patch.note ?? cur.note,
    reason,
    updatedAt: now(),
  };
  const cards = state.cards.slice();
  cards[idx] = next;
  return { ...state, cards };
}

// ── 路径②：实验数据（SLAC CSV 等）──────────────────────────
/** 最小 CSV 解析（支持引号与逗号）。 */
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

/** 导入实验数据 CSV → 逐单元格生成待核对测量项（数值/单位由人工核对）。 */
export function importMeasurements(state: LocusState, input: { name: string; csv: string }): ImportResult {
  const csv = (input.csv ?? "").slice(0, MAX_TEXT);
  const name = (input.name ?? "").trim() || "未命名数据文件";
  const asset: AssetRecord = {
    id: `ast_${randomUUID()}`,
    kind: "measurement",
    name,
    bytes: Buffer.byteLength(csv, "utf8"),
    hash: sha256(csv),
    text: csv,
    createdAt: now(),
  };
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new AppError(422, "CSV 至少需要表头 + 一行数据。");
  const header = rows[0];
  const measurements: MeasurementRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    for (let c = 0; c < header.length; c++) {
      const value = (rows[r][c] ?? "").trim();
      if (value === "") continue;
      measurements.push({
        id: `meas_${randomUUID()}`,
        assetId: asset.id,
        source: { fileName: name, rowIndex: r, column: header[c] || `col${c + 1}` },
        value,
        unit: "",
        decision: "unreviewed",
        note: "",
        createdAt: now(),
        updatedAt: now(),
      });
    }
  }
  return { state: { ...state, assets: [...state.assets, asset], measurements: [...state.measurements, ...measurements] }, asset, created: measurements.length };
}

export interface MeasurementPatch {
  value?: string;
  unit?: string;
  decision?: MeasurementRecord["decision"];
  note?: string;
  reason?: string;
}

export function reviewMeasurement(state: LocusState, id: string, patch: MeasurementPatch): LocusState {
  const idx = state.measurements.findIndex((m) => m.id === id);
  if (idx < 0) throw new AppError(404, `测量项不存在：${id}`);
  const cur = state.measurements[idx];
  const next: MeasurementRecord = {
    ...cur,
    value: patch.value ?? cur.value,
    unit: patch.unit ?? cur.unit,
    decision: patch.decision ?? cur.decision,
    note: patch.note ?? cur.note,
    updatedAt: now(),
  };
  const measurements = state.measurements.slice();
  measurements[idx] = next;
  return { ...state, measurements };
}

// ── 原件回查 ────────────────────────────────────────────────
export interface SourceView {
  asset: AssetRecord;
  /** 该资产下的对象及其定位（用于界面高亮）。 */
  points: { id: string; kind: "card" | "measurement"; locate: string }[];
}

export function sourceView(state: LocusState, assetId: string): SourceView {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) throw new AppError(404, `素材不存在：${assetId}`);
  const points: SourceView["points"] = [];
  for (const c of state.cards) if (c.assetId === assetId) points.push({ id: c.id, kind: "card", locate: c.locator.sectionQuote });
  for (const m of state.measurements) if (m.assetId === assetId) points.push({ id: m.id, kind: "measurement", locate: `第 ${m.source.rowIndex + 1} 行 · ${m.source.column}` });
  return { asset, points };
}

export class AppError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
