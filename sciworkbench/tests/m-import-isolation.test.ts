/**
 * A10 无接线副作用：测试用临时目录与合成公开夹具；不写现用数据目录。
 * （“白名单外无代码变化 / 无网络模型调用”属审计项，不在此以断言表达。）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OriginalStore, parseOriginal } from "../services/import-formats/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FX = join(HERE, "fixtures", "m-import");
const DATA = join(HERE, "..", "data");

const listing = (dir: string): string | null => {
  try {
    return readdirSync(dir).sort().join("\n");
  } catch {
    return null;
  }
};

test("A10 解析与存取只落在测试临时目录；现用数据目录不变", async () => {
  const before = listing(DATA);
  const dir = mkdtempSync(join(tmpdir(), "m-import-iso-"));
  const store = new OriginalStore(dir);

  for (const name of ["text-2page.pdf", "p-t-p.docx", "multi-sheet.xlsx", "sample.csv"]) {
    const candidates = readdirSync(FX);
    const actual = candidates.find((c) => c === name || c === name.replace(".csv", "-bom.csv"));
    if (!actual) continue;
    const bytes = new Uint8Array(readFileSync(join(FX, actual)));
    const saved = store.save(bytes, actual);
    await parseOriginal(store, saved.id, actual.endsWith(".xlsx") ? { sheet: "Data" } : {});
  }
  // 临时目录内确有产物；现用数据目录不变
  assert.ok(readdirSync(dir).length > 0);
  assert.equal(listing(DATA), before, "现用数据目录内容不应被本模块改动");
});

test("A10 夹具均为真格式（魔数校验，非改后缀文本）", () => {
  const pdf = new Uint8Array(readFileSync(join(FX, "text-2page.pdf")));
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("latin1"), "%PDF-");
  const docx = new Uint8Array(readFileSync(join(FX, "p-t-p.docx")));
  assert.equal(Buffer.from(docx.subarray(0, 2)).toString("latin1"), "PK");
  const xlsx = new Uint8Array(readFileSync(join(FX, "multi-sheet.xlsx")));
  assert.equal(Buffer.from(xlsx.subarray(0, 2)).toString("latin1"), "PK");
});
