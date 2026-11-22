/**
 * M 导入路 · 分隔文本解析（CSV / TSV）。
 * **复用** app.ts 既有 parseCsv（含引号内逗号/换行、全空行保留）；不原样复制其实现。
 * 位置为 0 基**逻辑记录/字段**号：引号内换行不冒充物理行号。
 */
import type { ParseResult, ParseOptions, GridTable, RawCell, Diagnostic } from "../contracts.ts";
import { PARSER_VERSIONS } from "../contracts.ts";
import { DEFAULT_OUTPUT_MAX_CELLS, DEFAULT_OUTPUT_MAX_CHARS } from "../limits.ts";
import { sha256Hex, ImportError, decodeText } from "../util.ts";
import { envelope } from "../envelope.ts";
import { parseCsv } from "../../app.ts";

const NUM_RE = /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i;

export function classifyCell(s: string): RawCell {
  const t = s.trim();
  if (t === "") return { value: null, type: "empty" };
  if (NUM_RE.test(t)) return { value: Number(t), type: "number" };
  return { value: s, type: "string" };
}

export function parseDelimited(
  bytes: Uint8Array,
  fileName: string,
  format: "csv" | "tsv",
  options: ParseOptions = {},
  sourceId: string | null = null,
): ParseResult {
  const { text, warning } = decodeText(bytes);
  const warnings: Diagnostic[] = [];
  if (warning) warnings.push({ code: "encoding_unconfirmed", message: warning });
  warnings.push({ code: "delim_logical_records", message: "位置为逻辑记录/字段号（0 基）；引号内换行不产生物理行号。" });

  const maxChars = options.outputMaxChars ?? DEFAULT_OUTPUT_MAX_CHARS;
  if (text.length > maxChars) throw new ImportError("output_too_large", `文本 ${text.length} 字符超过上限 ${maxChars}，已拒绝。`);

  const delim = format === "tsv" ? "\t" : ",";
  const parsed = parseCsv(text, delim);
  const totalCells = parsed.reduce((n, r) => n + r.length, 0);
  const maxCells = options.outputMaxCells ?? DEFAULT_OUTPUT_MAX_CELLS;
  if (totalCells > maxCells) throw new ImportError("output_too_large", `网格单元格 ${totalCells} 超过上限 ${maxCells}，已拒绝。`);

  const rows: string[][] = parsed.map((r) => [...r]);
  const raw: RawCell[][] = parsed.map((r) => r.map(classifyCell));

  const tables: GridTable[] = rows.length
    ? [
        {
          id: "tbl0",
          orderIndex: 0,
          origin: { kind: "delim-table", recordIndex: 0 },
          name: null,
          rows,
          raw,
          gridOrigin: { kind: "delim", firstRecordIndex: 0, firstFieldIndex: 0 },
          notes: [],
        },
      ]
    : [];

  return envelope({
    sourceId,
    originalHash: sha256Hex(bytes),
    byteLength: bytes.length,
    fileName,
    format,
    parser: { name: "delimited", version: PARSER_VERSIONS.delimited },
    options,
    status: rows.length ? "ok" : "failed",
    warnings,
    unknowns: rows.length ? [] : [{ code: "no_extractable_text", message: "分隔文件无任何记录，不作为成功。" }],
    textBlocks: [],
    tables,
  });
}
