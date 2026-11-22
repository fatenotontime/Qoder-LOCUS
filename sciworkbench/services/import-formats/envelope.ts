/**
 * M 导入路 · 结果封装：统一计算派生 hash、组装 ParseResult。
 * 解析器只负责产出文本块/表格，派生 hash 与协议版本在此集中处理。
 */
import {
  PARSE_PROTOCOL_VERSION,
  type ParseResult,
  type GridTable,
  type TextBlock,
  type SheetInfo,
  type ParseStatus,
  type Diagnostic,
  type DetectedFormat,
  type ParseOptions,
} from "./contracts.ts";
import { sha256Text } from "./util.ts";

/** 对派生内容做稳定序列化，用于派生 hash（与原件 hash 分列）。 */
export function serializeDerived(textBlocks: readonly TextBlock[], tables: readonly GridTable[]): string {
  const seq: unknown[] = [];
  for (const b of textBlocks) seq.push({ orderIndex: b.orderIndex, origin: b.origin, text: b.text });
  for (const t of tables) seq.push({ orderIndex: t.orderIndex, origin: t.origin, rows: t.rows });
  seq.sort((a, b) => (a as { orderIndex: number }).orderIndex - (b as { orderIndex: number }).orderIndex);
  return JSON.stringify(seq);
}

export interface EnvelopeInput {
  readonly sourceId: string | null;
  readonly originalHash: string;
  readonly byteLength: number;
  readonly fileName: string;
  readonly format: DetectedFormat;
  readonly parser: { readonly name: string; readonly version: string };
  readonly options: ParseOptions;
  readonly status: ParseStatus;
  readonly warnings?: readonly Diagnostic[];
  readonly unknowns?: readonly Diagnostic[];
  readonly textBlocks?: readonly TextBlock[];
  readonly tables?: readonly GridTable[];
  readonly sheets?: readonly SheetInfo[];
}

export function envelope(input: EnvelopeInput): ParseResult {
  const textBlocks = input.textBlocks ?? [];
  const tables = input.tables ?? [];
  const derivedHash = sha256Text(serializeDerived(textBlocks, tables));
  return {
    protocolVersion: PARSE_PROTOCOL_VERSION,
    sourceId: input.sourceId,
    originalHash: input.originalHash,
    byteLength: input.byteLength,
    fileName: input.fileName,
    format: input.format,
    parser: input.parser,
    options: input.options,
    derivedHash,
    status: input.status,
    warnings: input.warnings ?? [],
    unknowns: input.unknowns ?? [],
    textBlocks,
    tables,
    ...(input.sheets ? { sheets: input.sheets } : {}),
  };
}