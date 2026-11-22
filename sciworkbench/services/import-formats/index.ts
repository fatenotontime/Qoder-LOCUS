/**
 * M 导入路 · 统一入口。
 * 调用方按需动态加载各解析器（避免无关场景加载 PDF/zip 重依赖）。
 * 协议类型见 ./contracts.ts。
 */
export * from "./contracts.ts";
export { OriginalStore, mediaTypeFor, type SavedOriginal } from "./storage.ts";
export { detectFormat, type Detection } from "./detect.ts";
export { profileGrid } from "./profile.ts";
export { ImportError, sha256Hex, toA1, colNumberToLetter } from "./util.ts";
export { envelope } from "./envelope.ts";
export { DEFAULT_ORIGINAL_MAX_BYTES, DEFAULT_ARCHIVE_EXPAND_MAX_BYTES, DEFAULT_OUTPUT_MAX_CELLS, DEFAULT_OUTPUT_MAX_CHARS } from "./limits.ts";

import { envelope } from "./envelope.ts";
import { detectFormat } from "./detect.ts";
import { sha256Hex, zipExpandSize, ImportError, toA1 } from "./util.ts";
import { DEFAULT_ARCHIVE_EXPAND_MAX_BYTES } from "./limits.ts";
import type { ParseOptions, ParseResult, GridTable, SheetInfo, Diagnostic } from "./contracts.ts";

/** 解析真实字节并按格式分发（统一结果协议）。 */
export async function parseBytes(
  bytes: Uint8Array,
  fileName: string,
  options: ParseOptions = {},
  sourceId: string | null = null,
): Promise<ParseResult> {
  const det = detectFormat(fileName, bytes);
  const base = {
    sourceId,
    originalHash: sha256Hex(bytes),
    byteLength: bytes.length,
    fileName,
    options,
  };

  if (det.format === "unsupported") {
    return envelope({
      ...base,
      format: "unsupported",
      parser: { name: "unsupported", version: "-" },
      status: "unsupported",
      unknowns: [{ code: det.mismatch ? "extension_content_mismatch" : "unsupported_format", message: det.message ?? "不支持的格式。" }],
    });
  }

  if (det.format === "docx" || det.format === "xlsx") {
    const expand = zipExpandSize(bytes);
    const max = options.archiveExpandMaxBytes ?? DEFAULT_ARCHIVE_EXPAND_MAX_BYTES;
    if (expand !== null && expand > max) {
      return envelope({
        ...base,
        format: det.format,
        parser: { name: det.format, version: "-" },
        status: "failed",
        unknowns: [{ code: "archive_expand_too_large", message: `压缩文档展开量 ${expand} 字节超过上限 ${max}，已拒绝（不截断）。` }],
      });
    }
  }

  try {
    switch (det.format) {
      case "pdf": {
        const { parsePdf } = await import("./parsers/pdf.ts");
        return await parsePdf(bytes, fileName, options, sourceId);
      }
      case "docx": {
        const { parseDocx } = await import("./parsers/docx.ts");
        return await parseDocx(bytes, fileName, options, sourceId);
      }
      case "xlsx": {
        const { parseXlsx } = await import("./parsers/xlsx.ts");
        return await parseXlsx(bytes, fileName, options, sourceId);
      }
      case "csv":
      case "tsv": {
        const { parseDelimited } = await import("./parsers/delimited.ts");
        return parseDelimited(bytes, fileName, det.format, options, sourceId);
      }
      case "markdown":
      case "text": {
        const { parseText } = await import("./parsers/text.ts");
        return parseText(bytes, fileName, det.format, options, sourceId);
      }
    }
  } catch (e) {
    const diag: Diagnostic =
      e instanceof ImportError
        ? { code: e.code, message: e.message }
        : { code: "parse_failed", message: `解析失败：${(e as Error).message}` };
    return envelope({
      ...base,
      format: det.format,
      parser: { name: det.format, version: "-" },
      status: "failed",
      unknowns: [diag],
    });
  }
}

/** 从原件存取按标识取回并解析（保持原件 hash 与派生 hash 分列）。 */
export async function parseOriginal(
  store: { meta(id: string): { fileName: string }; retrieve(id: string): Uint8Array },
  id: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const meta = store.meta(id);
  const bytes = store.retrieve(id);
  return parseBytes(bytes, meta.fileName, options, id);
}

/** 仅列出 XLSX 工作表目录（含隐藏状态），不解析数据。 */
export async function listWorkbookSheets(bytes: Uint8Array, options: ParseOptions = {}): Promise<readonly SheetInfo[]> {
  const { parseXlsx } = await import("./parsers/xlsx.ts");
  const r = await parseXlsx(bytes, "workbook.xlsx", { ...options, sheet: undefined });
  return r.sheets ?? [];
}

/** 由网格推导单元格的原始位置（原件位置映射，供回查）。 */
export function cellOriginAt(
  grid: GridTable,
  row: number,
  col: number,
): { a1?: string; record?: number; field?: number; tableIndex?: number; row?: number; col?: number } {
  const g = grid.gridOrigin;
  if (g.kind === "xlsx") {
    return { a1: toA1((g.firstRowNumber ?? 1) + row, (g.firstColNumber ?? 1) + col) };
  }
  if (g.kind === "delim") {
    return { record: (g.firstRecordIndex ?? 0) + row, field: (g.firstFieldIndex ?? 0) + col };
  }
  return { tableIndex: g.tableIndex ?? 0, row, col };
}