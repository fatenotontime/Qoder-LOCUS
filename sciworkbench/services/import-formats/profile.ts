/**
 * M 导入路 · 全表画像（M2）。
 * 统计依据是**所选完整表**（非前 30 行摘录）。只产出画像与待答问题：
 * 不清洗覆盖源数据、不插补、不自动单位换算、不推荐统计检验。
 * 表头/备注为**派生视图**，保留位置映射，不把未确认首行从数据中永久移除。
 */
import { analyseTable } from "../app.ts";
import type { GridTable, TableProfile, ColumnProfile, RawCellType, SemanticQuestion } from "./contracts.ts";
import { colNumberToLetter } from "./util.ts";

const EMPTY_TYPES = (): Record<RawCellType, number> => ({
  string: 0,
  number: 0,
  date: 0,
  boolean: 0,
  formula: 0,
  error: 0,
  empty: 0,
});

/** 首个疑似表头行（前 12 行内首个 ≥2 非空的行）；与 analyseTable 同规则。 */
function firstHeaderRow(rows: readonly (readonly string[])[]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (rows[i].filter((c) => c.trim() !== "").length >= 2) return i;
  }
  return -1;
}

export function profileGrid(grid: GridTable, opts: { headerRows?: 1 | 2 | "auto" } = {}): TableProfile {
  const rows = grid.rows;
  const totalRows = rows.length;
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const at = (r: number, c: number) => (rows[r][c] ?? "").trim();

  // 表头/备注（派生视图）：复用既有 analyseTable 的判定，仅取位置，回映到原始行号。
  const a = analyseTable(rows.map((r) => [...r]), opts.headerRows ?? "auto");
  const levels = totalRows - a.body.length;
  const h = levels >= 1 ? firstHeaderRow(rows) : -1;
  const suspectedHeaderRows = h >= 0 ? Array.from({ length: levels }, (_, k) => h + k).filter((x) => x < totalRows) : [];
  const suspectedNoteRows = a.markerRows.map((i) => (i < h ? i : i + levels));

  // 原始网格首/末非空列（用于对齐 analyseTable 派生列名；仅标定，不删列）。
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const r of rows) r.forEach((c, i) => { if (c.trim() !== "") { if (i < first) first = i; if (i + 1 > last) last = i + 1; } });
  if (!Number.isFinite(first)) first = 0;

  const columns: ColumnProfile[] = [];
  for (let c = 0; c < width; c++) {
    let nonEmpty = 0;
    const types = EMPTY_TYPES();
    for (let r = 0; r < totalRows; r++) {
      if (at(r, c) !== "") nonEmpty++;
      const raw = grid.raw[r]?.[c];
      types[(raw?.type ?? "empty") as RawCellType]++;
    }
    const label = c >= first && c < last ? (a.columns[c - first] ?? `col${c + 1}`) : `col${c + 1}`;
    const a1 = grid.gridOrigin.kind === "xlsx" ? colNumberToLetter(c) : String(c + 1);
    columns.push({ index: c, a1, label, nonEmpty, empty: totalRows - nonEmpty, observedTypes: types });
  }

  const emptyRows: number[] = [];
  const sparseRows: number[] = [];
  for (let r = 0; r < totalRows; r++) {
    const n = rows[r].filter((c) => c.trim() !== "").length;
    if (n === 0) emptyRows.push(r);
    else if (n < width) sparseRows.push(r);
  }

  // ── 待答问题（一律 machine_inferred / unknown；**绝不冒充 human_confirmed**）──
  // 按合同 §6.2：列含义/单位/分组/独立样本/重复/批次/误差量/样品-执行关联 均须可核对。
  const questions: SemanticQuestion[] = [];
  const dataRows = Math.max(1, totalRows - suspectedHeaderRows.length);
  const numericCols = columns.filter((c) => c.observedTypes.number > 0 && c.observedTypes.number >= dataRows * 0.8);
  questions.push({
    topic: "unit",
    state: "unknown",
    text: numericCols.length
      ? `列 ${numericCols.map((c) => c.label).join("、")} 数值占多数，但单位/量纲未确认（原文是否声明单位？）。`
      : "各列单位/量纲均未确认（原文是否声明单位？）。",
  });
  questions.push({ topic: "grouping", state: "unknown", text: "分组关系（列间分组、组内成员）未确认。" });
  questions.push({ topic: "independence", state: "unknown", text: "各行独立性未确认；数值列不证明其为连续测量量。" });
  questions.push({
    topic: "sample_size",
    state: "unknown",
    text: `本表 ${totalRows} 行；**行数不等于独立样本量**，n 未确认。`,
  });
  questions.push({ topic: "replication", state: "unknown", text: "是否存在重复测量及其次数未确认。" });
  questions.push({ topic: "batch", state: "unknown", text: "是否分批次及其标识未确认。" });
  questions.push({ topic: "error_measure", state: "unknown", text: "误差列为 SD 还是 SE 未由列名确认（不得凭列名断定）。" });
  questions.push({ topic: "sample_execution_link", state: "unknown", text: "样品与执行/观测的关联（哪一行对应哪个样品）未确认。" });
  questions.push({
    topic: "missing_value",
    state: "unknown",
    text: "空单元格是否表示缺失值未确认（0 不算缺失；文本 NA 未默认为已确认缺失）。",
  });
  if (suspectedHeaderRows.length) {
    questions.push({
      topic: "header",
      state: "machine_inferred",
      text: `疑似表头行：第 ${suspectedHeaderRows.map((i) => i + 1).join("、")} 行（派生判定，需人工确认）。`,
    });
  }

  const notes = [
    `统计依据为完整表（共 ${totalRows} 行 × ${width} 列），非前 30 行摘录。`,
    "原始网格行数不因非空格数少而删减；表头/备注仅为派生视图，保留位置映射。",
  ];

  return {
    totalRows,
    totalColumns: width,
    countedRowRange: { start: 0, end: Math.max(0, totalRows - 1) },
    columns,
    sparseRows,
    emptyRows,
    suspectedHeaderRows,
    suspectedNoteRows,
    questions,
    notes,
  };
}
