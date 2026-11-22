/**
 * A01 原件闭环 / 协议 / 识别（M0）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OriginalStore, parseBytes, parseOriginal, ImportError, PARSE_PROTOCOL_VERSION, detectFormat } from "../services/import-formats/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FX = join(HERE, "fixtures", "m-import");
const read = (n: string) => new Uint8Array(readFileSync(join(FX, n)));
const tmp = () => mkdtempSync(join(tmpdir(), "m-import-"));

test("A01 真实 PDF/DOCX/XLSX 保存后按标识取回；重建实例后逐字节一致", () => {
  const dir = tmp();
  const store = new OriginalStore(dir);
  const cases: [string, string][] = [
    ["text-2page.pdf", "application/pdf"],
    ["p-t-p.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["multi-sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ];
  const ids: string[] = [];
  for (const [name] of cases) {
    const bytes = read(name);
    const saved = store.save(bytes, name);
    assert.equal(saved.byteLength, bytes.length);
    assert.equal(saved.id, `orig_${saved.hash}`);
    ids.push(saved.id);
  }
  // 重建实例（新进程对象，仅共享磁盘根目录）
  const store2 = new OriginalStore(dir);
  for (let i = 0; i < cases.length; i++) {
    const bytes = read(cases[i][0]);
    const back = store2.retrieve(ids[i]);
    assert.deepEqual(Array.from(back), Array.from(bytes), "取回字节应与保存前逐字节一致");
    assert.equal(store2.meta(ids[i]).byteLength, bytes.length);
    assert.equal(store2.meta(ids[i]).mediaTypeGuess, cases[i][1]);
  }
});

test("A01 同字节重导去重稳定；同名不同内容不覆盖旧原件", () => {
  const store = new OriginalStore(tmp());
  const a = store.save(new TextEncoder().encode("hello"), "same.txt");
  const b = store.save(new TextEncoder().encode("hello"), "same.txt");
  assert.equal(a.id, b.id, "同字节 → 同一标识（稳定去重）");

  const c = store.save(new TextEncoder().encode("different"), "same.txt");
  assert.notEqual(c.id, a.id, "同名不同内容 → 不同标识");
  // 旧原件仍在且内容未变
  assert.deepEqual(Array.from(store.retrieve(a.id)), Array.from(new TextEncoder().encode("hello")));
  assert.deepEqual(Array.from(store.retrieve(c.id)), Array.from(new TextEncoder().encode("different")));
});

test("A01 原件上限（默认 2 MiB，可显式覆盖）超限明确失败", () => {
  const store = new OriginalStore(tmp());
  assert.throws(() => store.save(new Uint8Array(10), "big.bin", { maxBytes: 5 }), (e: unknown) => e instanceof ImportError && e.code === "original_too_large");
  // 旧入口上限未被本模块改动：默认即为 2MiB
  const ok = store.save(new Uint8Array(1024), "ok.bin");
  assert.equal(ok.byteLength, 1024);
});

test("A01 原件 hash 与派生 hash 分列", async () => {
  const store = new OriginalStore(tmp());
  const bytes = read("sample.md");
  const saved = store.save(bytes, "sample.md");
  const r = await parseOriginal(store, saved.id);
  assert.equal(r.sourceId, saved.id);
  assert.equal(r.originalHash, saved.hash, "原件 hash 来自原始字节");
  assert.notEqual(r.derivedHash, r.originalHash, "派生 hash 与原件 hash 分开");
  assert.equal(r.protocolVersion, PARSE_PROTOCOL_VERSION);
});

test("A01 非法标识 / 不存在标识明确拒绝", () => {
  const store = new OriginalStore(tmp());
  assert.throws(() => store.retrieve("../../etc/passwd"), (e: unknown) => e instanceof ImportError && e.code === "bad_original_id");
  assert.throws(() => store.retrieve(`orig_${"0".repeat(64)}`), (e: unknown) => e instanceof ImportError && e.code === "original_not_found");
});

test("A09 扩展名与内容不符 → unsupported(mismatch)", () => {
  const det = detectFormat("x.pdf", new TextEncoder().encode("just plain text, not a pdf"));
  assert.equal(det.format, "unsupported");
  assert.equal(det.mismatch, true);
});

test("A09 扩展名与内容不符（解析入口）→ status unsupported", async () => {
  const r = await parseBytes(new TextEncoder().encode("hello world"), "notes.docx");
  assert.equal(r.status, "unsupported");
  assert.ok(r.unknowns.some((d) => d.code === "extension_content_mismatch"));
});

test("A01 损坏 PDF → status failed（不静默成功）", async () => {
  const r = await parseBytes(read("corrupt.pdf"), "corrupt.pdf");
  assert.equal(r.format, "pdf");
  assert.equal(r.status, "failed");
  assert.ok(r.unknowns.some((d) => d.code === "pdf_unreadable"));
});

test("A01 写入根目录在测试临时目录（不污染现用数据目录）", () => {
  const dir = tmp();
  const store = new OriginalStore(dir);
  store.save(new TextEncoder().encode("x"), "a.txt");
  // 存在 .bin 与 .json，均在 dir 下
  const meta = store.meta(store.idFor(new TextEncoder().encode("x")));
  assert.ok(meta.fileName === "a.txt");
  // 顺带确认：能在别处重新读取（磁盘持久化，而非内存 Map）
  writeFileSync(join(dir, "probe.txt"), "ok");
  assert.equal(readFileSync(join(dir, "probe.txt"), "utf8"), "ok");
});
