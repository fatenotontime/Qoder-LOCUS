/**
 * 格式类覆盖矩阵（泛用性判据：跨格式类，而非单一来源文件数）。
 * 每类一个落库夹具 + 结构期望；解析层改动须全绿 + corpus-check 真实语料 diff 无回退。
 * 跨来源真实 csv 位于 fixtures/cross-source/（公开许可，来源见 docs/stage4/31_FORMAT_MATRIX.md）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseTable, detectProfile, importMeasurements, parseCsv, AppError } from "../services/app.ts";
import { emptyState } from "../store.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const imp = (csv: string, extra: Record<string, unknown> = {}) => importMeasurements(emptyState(), { name: "m.csv", csv, ...extra });

test("类1  plain 逗号矩形", () => {
  const r = imp("a,b,c\n1,2,3\n4,5,6\n");
  assert.deepEqual(r.state.tables[0].columns, ["a", "b", "c"]);
  assert.equal(r.state.tables[0].rows.length, 2);
  assert.equal(detectProfile(parseCsv("a,b,c\n1,2,3")), "plain-table");
});

test("类2  TSV 制表符", () => {
  const r = imp("a\tb\n1\t2\n");
  assert.deepEqual(r.state.tables[0].columns, ["a", "b"]);
});

test("类3  引号内含逗号与换行", () => {
  const r = imp('name,note\n"Smith, J","line1\nline2"\n');
  assert.deepEqual(r.state.tables[0].rows[0], ["Smith, J", "line1\nline2"]);
});

test("类4  CRLF + BOM", () => {
  const r = imp("﻿a,b\r\n1,2\r\n");
  assert.deepEqual(r.state.tables[0].columns, ["a", "b"]);
  assert.equal(r.state.tables[0].rows.length, 1);
});

test("类5  首尾全空列裁剪", () => {
  const r = imp(",,a,b,,\n,,1,2,,\n");
  assert.deepEqual(r.state.tables[0].columns, ["a", "b"]);
  assert.deepEqual(r.state.tables[0].rows[0], ["1", "2"]);
});

test("类6  合并单元格两级表头（组名前向填充）", () => {
  const r = imp("P,,Q,\nName,Val,Name,Val\np,1,q,2\n");
  assert.deepEqual(r.state.tables[0].columns, ["P/Name", "P/Val", "Q/Name", "Q/Val"]);
  assert.equal(detectProfile(parseCsv("P,,Q,\nName,Val,Name,Val\np,1,q,2")), "enzymeML-blocks");
});

test("类7  单级表头+列表数据：首行数据不被吞为第二级", () => {
  const r = imp(",,Units,Types\n,,mole / l,Concentration\n,,umole / l,Conversion\n");
  assert.deepEqual(r.state.tables[0].columns, ["Units", "Types"]);
  assert.equal(r.state.tables[0].rows.length, 2);
});

test("类8  多表叠放（空行分隔）→ 逐块成表", () => {
  const r = imp("A,B\n1,2\n\nC,D\n3,4\n");
  assert.equal(r.state.tables.length, 2);
});

test("类9  标题行+块标记行（保留原行仅标注）", () => {
  const r = imp(",\n   Data,\nID,Type,Name,Val,Unit\n0,Time [min],,,\n0,Abs,r,1,u\n");
  const t = r.state.tables[0];
  assert.equal(t.name, "m.csv · Data");
  assert.deepEqual(t.markerRows, [0]);
  assert.equal(t.rows.length, 2);
});

test("类10 键列独占占位行丢弃", () => {
  const r = imp("ID,Name\nr0,x\nr1,\nr2,\n");
  assert.equal(r.state.tables[0].rows.length, 1);
});

test("类11 仪器导出（首行无分隔符）→ 422 拒绝", () => {
  assert.throws(() => imp("##BLOCKS= 2\nNote:\n00:00\t25\t0.03\n"), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("类12 前置标题行（首行无分隔符）→ 422 拒绝", () => {
  assert.throws(() => imp('"Version 1.1\n",,,\nTitle,X,,\n'), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("类13 不规则表头：占位列明示，不补造列名", () => {
  const r = imp("a,,c\n1,2,3\n");
  assert.deepEqual(r.state.tables[0].columns, ["a", "col2", "c"]);
});

test("类14 仅表头 / 空文件 → 422 拒绝", () => {
  assert.throws(() => imp("a,b\n"), (e: unknown) => e instanceof AppError && e.status === 422);
  assert.throws(() => imp(""), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("类15 profile 人工 override 优先于 auto 判定", () => {
  const blocky = ",\n   T,\nA,B\n1,2\n\nC,D\n3,4\n";
  assert.equal(imp(blocky).state.tables.length, 2);
  assert.equal(imp(blocky, { profile: "plain-table" }).state.tables.length, 1);
  assert.equal(imp("a,b\n1,2\n", { profile: "enzymeML-blocks" }).state.tables.length, 1);
});

test("类16 analyseTable 显式 headerRows 与 auto 一致处不漂移", () => {
  const rows = [["A", "B"], ["C", "D"], ["1", "2"]];
  assert.deepEqual(analyseTable(rows, 2).columns, ["A/C", "B/D"]);
  assert.deepEqual(analyseTable(rows, 1).columns, ["A", "B"]);
});

// ── 跨来源真实 csv（单一来源语料之外的泛用性抽查）─────────────
const CROSS: { file: string; source: string; minRows: number }[] = [
  { file: "tips.csv", source: "seaborn-data (BSD-3)", minRows: 200 },
  { file: "titanic.csv", source: "datasciencedojo/datasets (public domain)", minRows: 800 },
  { file: "2014_usa_states.csv", source: "plotly/datasets (MIT)", minRows: 40 },
];
for (const c of CROSS) {
  test(`跨来源 ${c.file}（${c.source}）：plain profile、无占位列、行数足`, () => {
    const p = join(HERE, "fixtures", "cross-source", c.file);
    if (!existsSync(p)) return; // 未下载时跳过（登记于 31_FORMAT_MATRIX.md）
    const r = imp(readFileSync(p, "utf8"), { name: c.file });
    const t = r.state.tables[0];
    assert.equal(r.state.tables.length, 1);
    assert.equal(t.columns.some((x) => /^col\d+$/.test(x)), false);
    assert.equal(t.rows.length >= c.minRows, true);
    assert.equal((t.markerRows ?? []).length, 0);
  });
}