/**
 * M 导入路 · 统一解析协议（contracts）。
 *
 * 本文件只定义**协议类型与常量**，不含任何解析实现。
 * 目标：所有解析器（PDF / DOCX / XLSX / CSV / TSV / MD / TXT）都产出同一份
 * `ParseResult`，原件与派生结果**分列**；每个块、行列都能追回原件位置。
 *
 * 约定边界（与 E 路的 SourceRef / KnowledgeRef 无关，也不写入正式知识库）：
 * - 本协议不替代、不伪造 AssetRecord / KnowledgeRef；与业务资产绑定留给集成者。
 * - 内部索引一律 **0 基**；对外编号（PDF 页码、文本物理行号、XLSX A1）一律 **1 基**，
 *   每个位置字段都显式标注基准，避免混用。
 */

/** 协议版本。字段语义变化时必须递增。 */
export const PARSE_PROTOCOL_VERSION = "m-import/1" as const;

/** 各解析器名—版本；写入结果便于溯源与回归对比。 */
export const PARSER_VERSIONS = {
  pdf: "pdfjs-dist@6.5.438",
  docx: "mammoth@1.13.0",
  xlsx: "exceljs@4.4.0",
  delimited: "locus-parseCsv@1",
  markdown: "locus-text@1",
  text: "locus-text@1",
} as const;

/** 识别到的格式。`unsupported` 表示格式不可处理（含扩展名与内容不符）。 */
export type DetectedFormat =
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "tsv"
  | "markdown"
  | "text"
  | "unsupported";

/** 解析状态。**空字符串/空结果不算成功**；成功必须有真实派生内容。 */
export type ParseStatus =
  | "ok" // 全部可读
  | "partial" // 部分可读（如混合 PDF：部分页有文字、部分页需 OCR）
  | "needs_ocr" // 无任何可提取文字（如纯扫描 PDF）
  | "unsupported" // 格式不支持 / 扩展名与内容不符
  | "failed"; // 解析失败（损坏等）

/** 诊断条目：warning / unknown 都携带**实际问题**，不用空字符串冒充成功。 */
export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly origin?: BlockOrigin;
}

/** 解析选项：默认值集中在 limits.ts，调用方可显式覆盖（不悄悄改旧入口限制）。 */
export interface ParseOptions {
  /** 表头行数（仅画像用）；默认 "auto"。 */
  readonly headerRows?: 1 | 2 | "auto";
  /** XLSX：显式选择的工作表名；未给时列目录、不偷偷取第一张。 */
  readonly sheet?: string;
  /** 原件字节上限，默认沿用现有 2 MiB。 */
  readonly originalMaxBytes?: number;
  /** 压缩文档（DOCX/XLSX）展开量上限；超限明确失败，不截断。 */
  readonly archiveExpandMaxBytes?: number;
  /** 派生网格总单元格上限；超限明确失败。 */
  readonly outputMaxCells?: number;
  /** 派生文本总字符上限；超限明确失败。 */
  readonly outputMaxChars?: number;
}

/** 位置：文档级块的位置。内部索引 0 基；对外编号 1 基（字段名显式标注）。 */
export type BlockOrigin =
  | { readonly kind: "pdf-page"; readonly page: number } // 1-based 页码
  | { readonly kind: "text-lines"; readonly lineStart: number; readonly lineEnd: number } // 1-based 物理行号
  | { readonly kind: "docx-paragraph"; readonly blockIndex: number; readonly paragraphIndex: number } // 0-based
  | { readonly kind: "docx-table"; readonly blockIndex: number; readonly tableIndex: number } // 0-based
  | { readonly kind: "xlsx-sheet"; readonly sheet: string }
  | { readonly kind: "delim-table"; readonly recordIndex: number }; // 0-based 逻辑记录

/** 一块可读文本（正文段落 / PDF 页正文 …）。 */
export interface TextBlock {
  readonly id: string;
  /** 文档内顺序（与表格共用一个计数器，消费方按它合并交错顺序）。 */
  readonly orderIndex: number;
  readonly origin: BlockOrigin;
  readonly text: string;
  /** 行文本（可选；PDF 按 item 顺序、DOCX 按段落）。 */
  readonly lines?: readonly string[];
}

/** 单元格原始值：保留原始值与类型，派生显示文本另存。 */
export type RawCellValue = string | number | boolean | null;

/** 单元格类型（原文可追溯；不是“猜测的统计类型”）。 */
export type RawCellType = "string" | "number" | "date" | "boolean" | "formula" | "error" | "empty";

export interface RawCell {
  readonly value: RawCellValue;
  readonly type: RawCellType;
  /** 公式文本（若为公式格）；缓存值在 value，无缓存则 value=null。 */
  readonly formula?: string;
  /** 数字格式串（Excel numFmt，若可得）。 */
  readonly numFmt?: string;
  /** 显示文本（若与原始值不同才记录）。 */
  readonly text?: string;
}

/** 合并区域（XLSX）。范围用 1 基 A1 表示，避免把单值伪复制成多次观测。 */
export interface MergedRange {
  readonly from: string; // 1-based A1，如 "B2"
  readonly to: string; // 1-based A1，如 "C3"
}

/**
 * 网格的原始位置映射（**基址 + 推导**，避免逐格对象占用）。
 * 行列 i/j 的位置由基址 + 步进推出，见 `cellOriginAt`。
 */
export interface GridOrigin {
  readonly kind: "delim" | "xlsx" | "docx-table";
  /** delim：rows[0] 对应的 0 基逻辑记录号；cols[0] 对应的 0 基字段号。 */
  readonly firstRecordIndex?: number;
  readonly firstFieldIndex?: number;
  /** xlsx：rows[0]/cols[0] 对应的 1 基行列号（A1 由此推出）。 */
  readonly firstRowNumber?: number;
  readonly firstColNumber?: number;
  /** xlsx：工作表名。 */
  readonly sheet?: string;
  /** docx-table：表序号（0 基）。 */
  readonly tableIndex?: number;
}

/** 一个原始网格（表 / 工作表 / DOCX 表）。**原始网格永不因非空格数少而删行。** */
export interface GridTable {
  readonly id: string;
  /** 与文本块共用的文档顺序计数器。 */
  readonly orderIndex: number;
  readonly origin: BlockOrigin;
  readonly name: string | null; // sheet 名 / DOCX 表名 / null
  /** 显示文本网格（全行保留）。 */
  readonly rows: readonly (readonly string[])[];
  /** 原始值网格（与 rows 同形）；保留原始值，派生列名不覆盖它。 */
  readonly raw: readonly (readonly RawCell[])[];
  readonly gridOrigin: GridOrigin;
  readonly merged?: readonly MergedRange[];
  /** 实际问题（如“公式无缓存值”“合并区域”）。 */
  readonly notes: readonly string[];
}

/** 工作表目录项（XLSX）。 */
export interface SheetInfo {
  readonly name: string;
  readonly index: number; // 0-based
  readonly state: "visible" | "hidden" | "veryHidden";
  readonly rowCount: number;
  readonly columnCount: number;
  readonly isEmpty: boolean;
}

/** 一次解析的完整结果。原件与派生结果分列（originalHash vs derivedHash）。 */
export interface ParseResult {
  readonly protocolVersion: typeof PARSE_PROTOCOL_VERSION;
  /** 原件标识（来源为 storage 时；直接解析字节时为 null）。 */
  readonly sourceId: string | null;
  /** 原件 hash：**原始字节** 的 sha256。 */
  readonly originalHash: string;
  readonly byteLength: number;
  readonly fileName: string;
  readonly format: DetectedFormat;
  readonly parser: { readonly name: string; readonly version: string };
  readonly options: ParseOptions;
  /** 派生内容 hash：与原件 hash **分开**。 */
  readonly derivedHash: string;
  readonly status: ParseStatus;
  readonly warnings: readonly Diagnostic[];
  readonly unknowns: readonly Diagnostic[];
  /** 文档顺序下的文本块（与 tables 按 orderIndex 合并可还原交错顺序）。 */
  readonly textBlocks: readonly TextBlock[];
  readonly tables: readonly GridTable[];
  /** XLSX 专用：工作表目录（选择用）。 */
  readonly sheets?: readonly SheetInfo[];
}

// ── 全表画像 ────────────────────────────────────────────────

/** 语义四态：本路只产出 declared / machine_inferred / unknown，**绝不冒充 human_confirmed**。 */
export type SemanticState = "declared" | "machine_inferred" | "human_confirmed" | "unknown";

/** 画像抛给用户的问题（不改数据、不插补）。 */
export interface SemanticQuestion {
  readonly topic:
    | "unit"
    | "grouping"
    | "independence"
    | "sample_size"
    | "replication"
    | "batch"
    | "error_measure"
    | "sample_execution_link"
    | "header"
    | "missing_value";
  readonly text: string;
  readonly state: SemanticState;
}

export interface ColumnProfile {
  readonly index: number; // 0-based 内部列号
  readonly a1: string | null; // 对外列号（xlsx: 字母；delim: "C0" 形式由消费方决定 → 这里给 1 基序号字符串）
  readonly label: string; // 派生列名（**不覆盖**原始内容，仅派生视图）
  readonly nonEmpty: number;
  readonly empty: number;
  /** 观察到的原始类型计数（非“统计类型断言”）。 */
  readonly observedTypes: Readonly<Record<RawCellType, number>>;
}

export interface TableProfile {
  /** 统计依据是**所选完整表**，不是前 30 行摘录。 */
  readonly totalRows: number;
  readonly totalColumns: number;
  readonly countedRowRange: { readonly start: number; readonly end: number };
  readonly columns: readonly ColumnProfile[];
  /** 稀疏行（部分非空）与全空行（仅标注，不删）。 */
  readonly sparseRows: readonly number[];
  readonly emptyRows: readonly number[];
  /** 疑似表头 / 备注行（派生视图，保留映射，不永久移除）。 */
  readonly suspectedHeaderRows: readonly number[];
  readonly suspectedNoteRows: readonly number[];
  readonly questions: readonly SemanticQuestion[];
  readonly notes: readonly string[];
}
