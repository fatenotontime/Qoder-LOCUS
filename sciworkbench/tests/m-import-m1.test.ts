/**
 * A02 PDF / A03 DOCX / A05 文本回归（M1）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBytes } from "../services/import-formats/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FX = join(HERE, "fixtures", "m-import");
const read = (n: string) => new Uint8Array(readFileSync(join(FX, n)));
const parse = (n: string, opts = {}) => parseBytes(read(n), n, opts);

test("A02 两页文本 PDF：逐页文字与 1 基页码正确、Unicode 可读", async () => {
  const r = await parse("text-2page.pdf");
  assert.equal(r.format, "pdf");
  assert.equal(r.status, "ok");
  assert.equal(r.textBlocks.length, 2);
  assert.deepEqual(r.textBlocks.map((b) => b.origin), [
    { kind: "pdf-page", page: 1 },
    { kind: "pdf-page", page: 2 },
  ]);
  assert.match(r.textBlocks[0].text, /Page one alpha/);
  assert.match(r.textBlocks[0].text, /second line/);
  assert.match(r.textBlocks[1].text, /Page two beta .*[\u00e9\u00fc\u00b0\u00d7\u00b1\u00b5]/, "第 2 页含非 ASCII（Unicode）字符");
});

test("A02 纯扫描 PDF（无文字）→ needs_ocr，不冒充全文成功", async () => {
  const r = await parse("scanned.pdf");
  assert.equal(r.status, "needs_ocr");
  assert.equal(r.textBlocks.length, 0);
  assert.ok(r.unknowns.some((d) => d.code === "needs_ocr"));
});

test("A02 混合 PDF → partial，保留可读页并列出待处理页", async () => {
  const r = await parse("mixed.pdf");
  assert.equal(r.status, "partial");
  assert.equal(r.textBlocks.length, 1);
  assert.equal(r.textBlocks[0].origin.kind, "pdf-page");
  assert.ok(r.textBlocks[0].text.includes("readable page 1"));
  const u = r.unknowns.find((d) => d.code === "pages_need_ocr");
  assert.ok(u && u.message.includes("2"), "待 OCR 页应含第 2 页");
});

test("A03 DOCX：段落—简单表格—段落的交错的文档顺序可回查", async () => {
  const r = await parse("p-t-p.docx");
  assert.equal(r.format, "docx");
  assert.equal(r.status, "ok");
  // 合并文本块与表格，按 orderIndex 还原交错顺序
  const seq = [
    ...r.textBlocks.map((b) => ({ o: b.orderIndex, kind: "p" as const, text: b.text, origin: b.origin })),
    ...r.tables.map((t) => ({ o: t.orderIndex, kind: "t" as const, text: "", origin: t.origin })),
  ].sort((a, b) => a.o - b.o);
  assert.equal(seq.length, 3);
  assert.equal(seq[0].kind, "p");
  assert.match(seq[0].text, /段落一/);
  assert.equal(seq[1].kind, "t");
  assert.equal(seq[2].kind, "p");
  assert.match(seq[2].text, /段落二/);
  // 表格：格子内容与 0 基行列位置
  const t = r.tables[0];
  assert.deepEqual(t.rows, [["r1c1", "r1c2"], ["r2c1", "r2c2"]]);
  assert.equal(t.gridOrigin.kind, "docx-table");
  assert.ok(r.warnings.some((w) => w.code === "docx_no_page_numbers"), "明确声明 DOCX 无页码");
});

test("A05 MD/TXT：完整文本与稳定块（物理行号，去 CRLF）", async () => {
  const md = await parse("sample.md");
  assert.equal(md.format, "markdown");
  assert.equal(md.status, "ok");
  assert.ok(md.textBlocks.some((b) => b.text.includes("# Title")));
  assert.ok(md.textBlocks.some((b) => b.text.includes("- item a")));

  const txt = await parse("sample.txt");
  assert.equal(txt.format, "text");
  assert.ok(txt.textBlocks.every((b) => !b.text.includes("\r")), "CRLF 已归一，块内无 \\r");
  assert.equal(txt.textBlocks[0].origin.kind, "text-lines");
});

test("A05 CSV/TSV：BOM、CRLF、引号内分隔符与换行", async () => {
  const bom = await parse("sample-bom.csv");
  assert.equal(bom.format, "csv");
  assert.deepEqual(bom.tables[0].rows, [["x", "y"], ["1", "2"], ["3", "4"]]);

  const q = await parse("sample-quoted.csv");
  assert.deepEqual(q.tables[0].rows[1], ["Smith, J", "line1\nline2"], "引号内逗号与换行保留");

  const tsv = await parse("sample.tsv");
  assert.equal(tsv.format, "tsv");
  assert.deepEqual(tsv.tables[0].rows, [["a", "b"], ["1", "2"]]);
});

test("A05 旧格式仍可用：0 不丢失、稀疏行保留", async () => {
  const r = await parse("single-cell.csv");
  assert.equal(r.status, "ok");
  const grid = r.tables[0].rows.map((row) => row.join("|"));
  assert.ok(grid.includes("0|Time [min]|||"), `含 0 的块标记行应保留：${grid.join(" / ")}`);
});

test("A05 文本能力：MD/TXT 为空时不冒充成功", async () => {
  const r = await parseBytes(new TextEncoder().encode("   \n\n  "), "empty.txt");
  assert.equal(r.status, "failed");
  assert.ok(r.unknowns.some((d) => d.code === "no_extractable_text"));
});
