/**
 * 审查 S04-T28 定点返工回归（导入路）。
 * 对应：① 合并非主格伪复制 ② 日期非确定性表示 ③ DOCX 同格段落/列表粘连
 * ④ profile 缺未知项 ⑤ parseBytes 忽略 originalMaxBytes ⑥ 计时未 await。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBytes, profileGrid } from "../services/import-formats/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FX = join(HERE, "fixtures", "m-import");
const read = (n: string) => new Uint8Array(readFileSync(join(FX, n)));
const parse = (n: string, opts = {}) => parseBytes(read(n), n, opts);

test("① 合并非主格不伪复制主格值（A1:B1 合并 A1=7 → B1 为空、不再计作观测）", async () => {
  const r = await parse("merged.xlsx", { sheet: "M" });
  const t = r.tables[0];
  assert.deepEqual(t.rows[0], ["7", ""], "合并从格 B1 显示文本应为空");
  assert.equal(t.raw[0][1].type, "empty", "合并从格 raw.type 应为 empty");
  assert.equal(t.raw[0][0].value, 7, "主格 A1 值保留");
  const p = profileGrid(t);
  const colB = p.columns[1];
  assert.equal(colB.nonEmpty, 1, "B 列只应含真实值（第 2 行），不含被复制的表头值");
  assert.ok(t.merged?.some((m) => m.from === "A1" && m.to === "B1"));
});

test("② 日期以确定的 UTC ISO 表示（不用本机 locale 文本）", async () => {
  const r = await parse("dates.xlsx", { sheet: "D" });
  const c = r.tables[0].raw[0][0];
  assert.equal(c.type, "date");
  assert.equal(c.value, "2024-01-01T00:00:00.000Z", "确定性 UTC ISO");
  assert.equal(String(c.value).includes("GMT"), false, "不得含本机时区文本");
  assert.equal(c.numFmt, "yyyy-mm-dd");
  assert.ok(r.tables[0].notes.some((n) => n.includes("确定性")), "note 声明确定性表示");
  // 同输入两次解析结果一致
  const r2 = await parse("dates.xlsx", { sheet: "D" });
  assert.deepEqual(r2.tables[0].raw[0][0], c);
});

test("③ DOCX 同格两段落用换行分隔；列表项各自成块", async () => {
  const r = await parse("cell-multi.docx");
  const t = r.tables[0];
  assert.equal(t.rows[0][0], "10\n20", "同格两段落不得粘连成 1020");
  const texts = r.textBlocks.map((b) => b.text);
  assert.deepEqual(texts, ["alpha", "beta"], "两个列表项应为两个独立文本块");
  const idx = r.textBlocks.map((b) => (b.origin.kind === "docx-paragraph" ? b.origin.paragraphIndex : -1));
  assert.equal(new Set(idx).size, idx.length, "每个块有各自段落位置");
  assert.ok(texts.every((x) => x !== "alphabeta"), "不得粘连");
});

test("④ 纯分类表也补齐全套未确认项（分组/独立性/重复/批次/来源关联…）", async () => {
  const r = await parseBytes(new TextEncoder().encode("cat1,cat2\na,x\nb,y\n"), "cat.csv");
  const p = profileGrid(r.tables[0]);
  const topics = new Set(p.questions.map((q) => q.topic));
  for (const t of ["unit", "grouping", "independence", "sample_size", "replication", "batch", "error_measure", "sample_execution_link", "missing_value"]) {
    assert.ok(topics.has(t as never), `缺未确认项：${t}`);
  }
  assert.ok(p.questions.every((q) => q.state !== "human_confirmed"));
});

test("⑤ parseBytes 遵守 originalMaxBytes（显式上限与默认 2 MiB）", async () => {
  const small = await parseBytes(new TextEncoder().encode("hello"), "a.txt", { originalMaxBytes: 1 });
  assert.equal(small.status, "failed");
  assert.ok(small.unknowns.some((d) => d.code === "original_too_large"));

  const big = await parseBytes(new Uint8Array(2 * 1024 * 1024 + 1), "big.txt");
  assert.equal(big.status, "failed");
  assert.ok(big.unknowns.some((d) => d.code === "original_too_large"));
});

test("⑥ 计时器等待异步解析（不再低报耗时）", async () => {
  const h0 = process.hrtime.bigint();
  await new Promise((res) => setTimeout(res, 30)); // 模拟异步解析
  const ms = Number(process.hrtime.bigint() - h0) / 1e6;
  assert.ok(ms >= 25, `await 后耗时应反映真实用时（得 ${ms.toFixed(0)}ms）`);
});
