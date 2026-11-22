/**
 * M 导入路 · 限额默认值。
 * 原件上限**沿用现有 2 MiB**（服务 app.ts 的 MAX_IMPORT_BYTES），作为显式选项供将来接线；
 * 本模块不改动旧入口限制。
 */
export const DEFAULT_ORIGINAL_MAX_BYTES = 2 * 1024 * 1024;

/** 压缩文档（DOCX/XLSX）展开量上限（各 zip 条目解压后大小之和）。 */
export const DEFAULT_ARCHIVE_EXPAND_MAX_BYTES = 64 * 1024 * 1024;

/** 派生网格总单元格上限（行列相乘累计）；超限明确失败。 */
export const DEFAULT_OUTPUT_MAX_CELLS = 2_000_000;

/** 派生文本总字符上限；超限明确失败。 */
export const DEFAULT_OUTPUT_MAX_CHARS = 20_000_000;

/** PDF 最大页数上限（防超大文档）；超限明确失败。 */
export const DEFAULT_MAX_PDF_PAGES = 2000;
