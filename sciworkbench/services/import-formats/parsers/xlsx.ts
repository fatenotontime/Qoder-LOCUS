/**
 * M 导入路 · XLSX 工作表读取（M2）。
 * 列出全部工作表（含隐藏状态）；**由调用方显式选择**，未选则只列目录。
 * 保留 sheet 名、A1 位置、原始值、单元格类型、合并区域；公式保留并保留缓存值，**不重算**。
 * 不做 XLS/XLSM/宏、不做公式计算、不做任意编码探测。
 */
import ExcelJS from "exceljs";
import type { ParseResult, ParseOptions, GridTable, RawCell, MergedRange, SheetInfo, Diagnostic } from "../contracts.ts";
import { PARSER_VERSIONS } from "../contracts.ts";
import { DEFAULT_OUTPUT_MAX_CELLS, DEFAULT_OUTPUT_MAX_CHARS } from "../limits.ts";
import { sha256Hex, ImportError, toA1 } from "../util.ts";
import { envelope } from "../envelope.ts";

const T = ExcelJS.ValueType;

interface RawCtx {
  /** 无缓存值的公式单元位置。 */
  formulaNoCache: string[];
  /** 日期/时间单元位置。 */
  dates: string[];
}

function cellToRaw(cell: ExcelJS.Cell, a1: string, ctx: RawCtx): RawCell {
  const numFmt = typeof cell.numFmt === "string" ? cell.numFmt : undefined;
  const v = cell.value;
  switch (cell.type) {
    case T.Null:
    case T.Merge:
      return { value: null, type: "empty", ...(numFmt ? { numFmt } : {}) };
    case T.Number:
      return { value: v as number, type: "number", ...(numFmt ? { numFmt } : {}) };
    case T.Boolean:
      return { value: v as boolean, type: "boolean" };
    case T.Date:
      // 日期/时间：以 **UTC ISO** 确定性表示（不随本机时区变化），保留 numFmt；不换单位、不猜时区。
      ctx.dates.push(a1);
      return { value: v instanceof Date ? v.toISOString() : String(v), type: "date", ...(numFmt ? { numFmt } : {}) };
    case T.Hyperlink: {
      const h = v as { text?: string; hyperlink?: string };
      return { value: h.text ?? "", type: "string" };
    }
    case T.Formula:
    case T.SharedFormula: {
      const f = v as { formula?: string; sharedFormula?: string; result?: unknown };
      const formula = f.formula ?? (f.sharedFormula ? `=SHARED(${f.sharedFormula})` : "=UNKNOWN");
      const hasResult = f.result !== undefined && f.result !== null;
      if (!hasResult) ctx.formulaNoCache.push(a1);
      const r = f.result as RawCell["value"] | undefined;
      return { value: hasResult ? (r as RawCell["value"]) : null, type: "formula", formula, ...(numFmt ? { numFmt } : {}) };
    }
    case T.RichText: {
      const rt = v as { richText?: { text?: string }[] };
      return { value: (rt.richText ?? []).map((x) => x.text ?? "").join(""), type: "string" };
    }
    case T.Error: {
      const e = v as { error?: string };
      return { value: e.error ?? "#ERROR", type: "error" };
    }
    default:
      return { value: cell.text, type: "string" };
  }
}

/** 是否为合并区域的**非主格**（exceljs 会让其 text/value 复制主格值 → 会伪复制为多次观测）。 */
function isMergeSlave(cell: ExcelJS.Cell): boolean {
  return cell.isMerged === true && !!cell.master && cell.master.address !== cell.address;
}

function sheetInfo(ws: ExcelJS.Worksheet, index: number): SheetInfo {
  const rows = ws.rowCount || 0;
  const cols = ws.columnCount || 0;
  return {
    name: ws.name,
    index,
    state: (ws.state as SheetInfo["state"]) ?? "visible",
    rowCount: rows,
    columnCount: cols,
    isEmpty: rows === 0 || cols === 0,
  };
}

export async function parseXlsx(
  bytes: Uint8Array,
  fileName: string,
  options: ParseOptions = {},
  sourceId: string | null = null,
): Promise<ParseResult> {
  const warnings: Diagnostic[] = [];
  const unknowns: Diagnostic[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as never);
  } catch (e) {
    return envelope({
      sourceId,
      originalHash: sha256Hex(bytes),
      byteLength: bytes.length,
      fileName,
      format: "xlsx",
      parser: { name: "xlsx", version: PARSER_VERSIONS.xlsx },
      options,
      status: "failed",
      unknowns: [{ code: "xlsx_unreadable", message: `XLSX 无法读取（疑似损坏或非 XLSX）：${(e as Error).message}` }],
    });
  }

  const sheets = wb.worksheets.map((ws, i) => sheetInfo(ws, i));

  if (options.sheet === undefined) {
    warnings.push({ code: "sheet_not_selected", message: "未显式选择工作表：仅返回工作表目录，未解析数据（不默认取第一张）。" });
    return envelope({
      sourceId,
      originalHash: sha256Hex(bytes),
      byteLength: bytes.length,
      fileName,
      format: "xlsx",
      parser: { name: "xlsx", version: PARSER_VERSIONS.xlsx },
      options,
      status: "ok",
      warnings,
      unknowns,
      textBlocks: [],
      tables: [],
      sheets,
    });
  }

  const ws = wb.getWorksheet(options.sheet);
  if (!ws) {
    return envelope({
      sourceId,
      originalHash: sha256Hex(bytes),
      byteLength: bytes.length,
      fileName,
      format: "xlsx",
      parser: { name: "xlsx", version: PARSER_VERSIONS.xlsx },
      options,
      status: "failed",
      warnings,
      unknowns: [{ code: "sheet_not_found", message: `工作表不存在：${options.sheet}（可选：${sheets.map((s) => s.name).join("、")}）。` }],
      textBlocks: [],
      tables: [],
      sheets,
    });
  }

  const rows = ws.rowCount || 0;
  const cols = ws.columnCount || 0;
  const maxCells = options.outputMaxCells ?? DEFAULT_OUTPUT_MAX_CELLS;
  if (rows * cols > maxCells) throw new ImportError("output_too_large", `工作表单元格 ${rows * cols} 超过上限 ${maxCells}，已拒绝（不截断）。`);
  const maxChars = options.outputMaxChars ?? DEFAULT_OUTPUT_MAX_CHARS;

  const notes: string[] = [];
  const ctx: RawCtx = { formulaNoCache: [], dates: [] };
  const gridRows: string[][] = [];
  const gridRaw: RawCell[][] = [];
  let totalChars = 0;
  for (let r = 1; r <= rows; r++) {
    const textRow: string[] = [];
    const rawRow: RawCell[] = [];
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(r, c);
      const a1 = toA1(r, c);
      // 合并非主格：exceljs 复制了主格的 text/value → 视为空，避免单值被伪复制为多次观测。
      const slave = isMergeSlave(cell);
      const raw = slave ? ({ value: null, type: "empty" } as RawCell) : cellToRaw(cell, a1, ctx);
      const disp = slave ? "" : (cell.text ?? "");
      totalChars += disp.length;
      if (totalChars > maxChars) throw new ImportError("output_too_large", `工作表文本超过上限 ${maxChars} 字符，已拒绝。`);
      rawRow.push(raw);
      textRow.push(disp);
    }
    gridRows.push(textRow);
    gridRaw.push(rawRow);
  }
  if (ctx.formulaNoCache.length) {
    notes.push(`公式无缓存值（共 ${ctx.formulaNoCache.length} 个，如 ${ctx.formulaNoCache.slice(0, 5).join("、")}）：仅保留公式，标记未知（不填 0）。`);
  }
  if (ctx.dates.length) {
    notes.push(`日期/时间单元（共 ${ctx.dates.length} 个，如 ${ctx.dates.slice(0, 5).join("、")}）：以 UTC ISO 确定性表示（不随本机时区变化），保留 numFmt；未做单位换算。`);
  }

  const merges: MergedRange[] = ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? []).map((m) => {
    const [from, to] = m.split(":");
    return { from, to: to ?? from };
  });
  if (merges.length) notes.push(`含 ${merges.length} 个合并区域：范围已记录，非主格的重复值不作为多次观测。`);

  const tables: GridTable[] = [
    {
      id: "tbl0",
      orderIndex: 0,
      origin: { kind: "xlsx-sheet", sheet: ws.name },
      name: ws.name,
      rows: gridRows,
      raw: gridRaw,
      gridOrigin: { kind: "xlsx", sheet: ws.name, firstRowNumber: 1, firstColNumber: 1 },
      merged: merges,
      notes,
    },
  ];

  return envelope({
    sourceId,
    originalHash: sha256Hex(bytes),
    byteLength: bytes.length,
    fileName,
    format: "xlsx",
    parser: { name: "xlsx", version: PARSER_VERSIONS.xlsx },
    options,
    status: "ok",
    warnings,
    unknowns,
    textBlocks: [],
    tables,
    sheets,
  });
}