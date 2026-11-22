/**
 * A09 常见失败：损坏文件、扩展名与内容不匹配、不支持格式、超限 → 明确失败，不静默成功。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { parseBytes, OriginalStore, ImportError } from "../services/import-formats/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FX = join(HERE, "fixtures", "m-import");
const read = (n: string) => new Uint8Array(readFileSync(join(FX, n)));

test("A09 损坏 PDF（魔数正确但内容损坏）→ failed", async () => {
  const r = await parseBytes(read("corrupt.pdf"), "corrupt.pdf");
  assert.equal(r.status, "failed");
});

test("A09 扩展名与内容不匹配（truncated zip 声称 xlsx）→ unsupported", async () => {
  const bytes = read("multi-sheet.xlsx").slice(0, 200); // 截断
  const r = await parseBytes(bytes, "broken.xlsx");
  assert.notEqual(r.status, "ok");
  assert.ok(r.status === "unsupported" || r.status === "failed");
});

test("A09 不支持格式：老 DOC / 任意 zip / 未知扩展名", async () => {
  const doc = await parseBytes(strToU8("legacy"), "old.doc");
  assert.equal(doc.status, "unsupported");

  const zip = zipSync({ "a.txt": strToU8("hi") }, {});
  const zr = await parseBytes(zip, "pack.docx"); // zip 非 docx → mismatch
  assert.equal(zr.status, "unsupported");

  const unknown = await parseBytes(strToU8("data"), "file.xyz");
  assert.equal(unknown.status, "unsupported");
});

test("A09 原件超限 → 明确失败（不截断）", () => {
  const store = new OriginalStore(mkdtempSync(join(tmpdir(), "m-import-fail-")));
  assert.throws(
    () => store.save(new Uint8Array(1024), "x.bin", { maxBytes: 512 }),
    (e: unknown) => e instanceof ImportError && e.code === "original_too_large",
  );
});

test("A09 压缩展开量超限 → failed（不截断后报成功）", async () => {
  const bytes = read("p-t-p.docx");
  const r = await parseBytes(bytes, "p-t-p.docx", { archiveExpandMaxBytes: 100 });
  assert.equal(r.status, "failed");
  assert.ok(r.unknowns.some((d) => d.code === "archive_expand_too_large"));
});

test("A09 真实高压缩比文档：预扫描展开量可拦住（不解压内容）", async () => {
  const bomb = zipSync({ "word/document.xml": strToU8("A".repeat(5_000_000)) }, { level: 9 });
  const r = await parseBytes(bomb, "bomb.docx", { archiveExpandMaxBytes: 1_000_000 });
  assert.equal(r.status, "failed");
  assert.ok(r.unknowns.some((d) => d.code === "archive_expand_too_large"));
});

test("A09 无静默成功：所有失败以状态或诊断显式呈现", async () => {
  const r = await parseBytes(new Uint8Array(0), "empty.bin");
  assert.notEqual(r.status, "ok");
  assert.ok(r.unknowns.length > 0);
});
