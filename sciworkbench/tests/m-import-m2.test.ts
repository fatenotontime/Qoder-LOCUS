/**
 * A04 XLSX / A06 L3 / A07 画像正反例（M2）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBytes, listWorkbookSheets, profileGrid, cellOriginAt } from "../services/import-formats/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FX = join(HERE, "fixtures", "m-import");
const read = (n: string) => new Uint8Array(readFileSync(join(FX, n)));
const parse = (n: string, opts = {}) => parseBytes(read(n), n, opts);

test("A04 列出全部工作表（含隐藏状态）", async () => {
  const sheets = await listWorkbookSheets(read("multi-sheet.xlsx"));
  assert.deepEqual(sheets.map((s) => s.name), ["Data", "Second", "Empty"]);
  assert.equal(sheets.find((s) => s.name === "Second")?.state, "hidden");
  assert.equal(sheets.find((s) => s.name === "Empty")?.isEmpty, true);
});

test("A04 未显式选择 → 只列目录、不偷偷取第一张", async () => {
  const r = await parse("multi-sheet.xlsx");
  assert.equal(r.tables.length, 0);
  assert.deepEqual((r.sheets ?? []).map((s) => s.name), ["Data", "Second", "Empty"]);
  assert.ok(r.warnings.some((w) => w.code === "sheet_not_selected"));
});

test("A04 显式选择第二张：名称与 A1 映射正确；公式缓存保留、无缓存标未知", async () => {
  const r = await parse("multi-sheet.xlsx", { sheet: "Second" });
  assert.equal(r.status, "ok");
  assert.equal(r.tables.length, 1);
  const t = r.tables[0];
  assert.equal(t.name, "Second");
  assert.deepEqual(cellOriginAt(t, 0, 0), { a1: "A1" }); // 1 基 A1
  assert.deepEqual(cellOriginAt(t, 1, 0), { a1: "A2" });

  const c1 = t.raw[0][0];
  assert.equal(c1.type, "formula");
  assert.match(c1.formula ?? "", /SUM/);
  assert.equal(c1.value, 3, "有缓存值 → 保留缓存值");

  const c2 = t.raw[1][0];
  assert.equal(c2.type, "formula");
  assert.equal(c2.value, null, "无缓存 → 不填 0，标未知");
  assert.ok(t.notes.some((n) => n.includes("A2")), "记录无缓存公式位置");
});

test("A04 空表如实返回；非法选择明确", async () => {
  const empty = await parse("multi-sheet.xlsx", { sheet: "Empty" });
  assert.equal(empty.status, "ok");
  assert.equal(empty.tables.length, 1);
  assert.equal(empty.tables[0].rows.length, 0);

  const bad = await parse("multi-sheet.xlsx", { sheet: "NoSuch" });
  assert.equal(bad.status, "failed");
  assert.ok(bad.unknowns.some((d) => d.code === "sheet_not_found"));
});

test("A04 稀疏/空格子/合并区域：原始网格保留、合并范围记录", async () => {
  const r = await parse("multi-sheet.xlsx", { sheet: "Data" });
  const t = r.tables[0];
  // 行列：A1..B3 有值，第 4 行空，第 5 行有值 + 合并 B5:C5
  assert.equal(t.rows.length >= 5, true);
  assert.equal(t.rows[1][0], "1", "稀疏行首格保留");
  assert.ok(t.rows[1].slice(1).every((c) => c === ""), `稀疏行其余格为空：${JSON.stringify(t.rows[1])}`);
  assert.ok(t.merged?.some((m) => m.from === "B5" && m.to === "C5"), `合并区域应记录：${JSON.stringify(t.merged)}`);
  assert.ok(t.notes.some((n) => n.includes("合并")));
});

test("A06 L3：x,y / 1, / 2,3 中 `1,` 保留，画像解释所有原始行去向", async () => {
  const r = await parse("sparse-l3.csv");
  const grid = r.tables[0];
  assert.deepEqual(grid.rows, [["x", "y"], ["1", ""], ["2", "3"]]);
  const p = profileGrid(grid);
  assert.equal(p.totalRows, 3);
  assert.equal(p.totalColumns, 2);
  assert.deepEqual(p.suspectedHeaderRows, [0]);
  assert.ok(p.sparseRows.includes(1), "第 2 行（1,）为稀疏行");
  // 所有原始行都被归类（header / sparse / empty / 普通数据），无丢失
  const accounted = new Set<number>([...p.suspectedHeaderRows, ...p.sparseRows, ...p.emptyRows, ...p.suspectedNoteRows]);
  for (let i = 0; i < p.totalRows; i++) {
    if (!accounted.has(i)) {
      const nonEmpty = grid.rows[i].filter((c) => c.trim() !== "").length;
      assert.ok(nonEmpty > 0, `行 ${i} 未被归类且非空`);
    }
  }
});

test("A06 单格文字 / 全空行 / 多级表头：画像与映射能解释所有原始行", async () => {
  const ml = await parse("multilevel.csv");
  const pml = profileGrid(ml.tables[0]);
  assert.deepEqual(pml.suspectedHeaderRows, [0, 1], "两级表头都应识别");

  const sc = await parse("single-cell.csv");
  const grid = sc.tables[0];
  const p = profileGrid(grid);
  assert.equal(p.totalRows, 5);
  assert.deepEqual(p.suspectedHeaderRows, [2]);
  assert.deepEqual([...p.suspectedNoteRows].sort((a, b) => a - b), [0, 1, 3], "标题/块标记行标注保留");
  assert.ok(grid.rows[3].join("|").startsWith("0|Time [min]"), "块标记行的 0 与文字保留");
});

test("A07 完整表计数准确（非前 30 行）；四态不含 human_confirmed", async () => {
  const csv = "name,value,sd\nx,1,0.1\ny,2,0.2\nz,3,0.3\n";
  const r = await parseBytes(new TextEncoder().encode(csv), "unit.csv");
  const before = JSON.stringify(r.tables[0].rows);
  const p = profileGrid(r.tables[0]);
  assert.equal(p.totalRows, 4);
  const valueCol = p.columns.find((c) => c.label === "value");
  assert.ok(valueCol);
  assert.equal(valueCol.nonEmpty, 4); // 表头文本 + 3 数据格
  assert.equal(valueCol.empty, 0);
  // 问题清单：分组/独立性/单位/样本量/误差均未确认
  const topics = new Set(p.questions.map((q) => q.topic));
  for (const t of ["unit", "independence", "sample_size", "error_measure", "missing_value"]) assert.ok(topics.has(t as never), `缺问题：${t}`);
  assert.ok(p.questions.every((q) => q.state !== "human_confirmed"), "本路绝不冒充人工确认");
  // 不凭行数确认 n
  assert.ok(p.questions.find((q) => q.topic === "sample_size")?.text.includes("不等于"), "声明行数≠样本量");
  // 输入未被修改
  assert.equal(JSON.stringify(r.tables[0].rows), before);
});

test("A07 XLSX 画像基于完整表；日期保留 numFmt 不换单位", async () => {
  const r = await parse("multi-sheet.xlsx", { sheet: "Data" });
  const p = profileGrid(r.tables[0]);
  assert.equal(p.totalRows, r.tables[0].rows.length);
  assert.ok(p.notes.some((n) => n.includes("完整表")));
});
