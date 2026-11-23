/**
 * P7 / M6 集成端到端：真实二进制文件经 HTTP 上传 → 存原件（去重、hash 一致）→
 * 解析（PDF/XLSX/CSV）→ 入库（文献卡 / 数据表，带 M 画像）→ 回取原件校验逐字节一致。
 * 原件落在实例级临时根目录，不写现用数据目录。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { MemoryStore } from "../store.ts";
import { OriginalStore } from "../services/import-formats/index.ts";
import { createApp } from "../server.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FX = join(HERE, "fixtures", "m-import");
const read = (n: string) => new Uint8Array(readFileSync(join(FX, n)));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

async function withApp<T>(fn: (base: string, root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "m6-originals-"));
  const app = await createApp(new MemoryStore(), { originalRoot: root });
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  try { return await fn(base, root); } finally { app.close(); }
}

async function upload(base: string, name: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/import/file`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, dataBase64: b64(bytes), ...extra }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("M6 上传真实 PDF → 文献类入库（原件外置、draft 卡、回取一致）", async () => {
  await withApp(async (base, root) => {
    const bytes = read("text-2page.pdf");
    const up = await upload(base, "paper.pdf", bytes);
    assert.equal(up.status, 200);
    const b = up.body;
    assert.equal(b.ok, true);
    assert.equal(b.kind, "literature");
    const parse = b.parse as { status: string; format: string };
    assert.equal(parse.format, "pdf");
    assert.equal(parse.status, "ok");
    assert.ok((b.created as { cards: number }).cards > 0, "PDF 文本应产出 draft 卡");
    assert.ok((b.created as { tables: number }).tables === 0);

    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      assets: { id: string; kind: string; originalId?: string; mediaType?: string; hash: string; name: string }[];
      cards: { assetId: string }[];
    };
    const asset = state.assets.find((a) => a.id === b.assetId)!;
    assert.equal(asset.originalId, b.originalId, "资产引用原件标识");
    assert.equal(asset.mediaType, "application/pdf");
    assert.equal(asset.hash, (b.originalId as string).slice("orig_".length), "hash=原始字节 sha256");
    assert.ok(state.cards.some((c) => c.assetId === asset.id), "卡片挂在文献原件上");

    // 回取原件：经 HTTP 与重建 OriginalStore 两种路径，均逐字节一致
    const back = new Uint8Array(await (await fetch(`${base}/api/originals/${b.originalId}`)).arrayBuffer());
    assert.deepEqual(Array.from(back), Array.from(bytes));
    const store2 = new OriginalStore(root);
    assert.deepEqual(Array.from(store2.retrieve(b.originalId as string)), Array.from(bytes), "重建实例后仍可取回");
  });
});

test("M6 上传真实 XLSX → 数据表入库，含 M 画像与原始位置", async () => {
  await withApp(async (base) => {
    const bytes = read("multi-sheet.xlsx");
    const up = await upload(base, "book.xlsx", bytes);
    assert.equal(up.status, 200);
    const b = up.body;
    assert.equal(b.kind, "measurement");
    assert.equal((b.parse as { format: string }).format, "xlsx");
    assert.ok((b.created as { tables: number }).tables > 0, "XLSX 应产出数据表");

    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      tables: { assetId: string; columns: string[]; rows: string[][]; profile?: { totalRows: number; questions: unknown[] }; gridOrigin?: { kind: string } }[];
    };
    const tables = state.tables.filter((t) => t.assetId === b.assetId);
    assert.ok(tables.length > 0);
    const t = tables[0];
    assert.ok(t.columns.length > 0 && t.rows.length > 0, "表格保留行列结构");
    assert.ok(t.profile, "M 画像随表保存");
    assert.ok((t.profile!.questions.length ?? 0) > 0, "画像带待答问题");
    assert.equal(t.gridOrigin?.kind, "xlsx", "保留原始位置基址（xlsx→A1）");

    const back = new Uint8Array(await (await fetch(`${base}/api/originals/${b.originalId}`)).arrayBuffer());
    assert.deepEqual(Array.from(back), Array.from(bytes));
  });
});

test("M6 上传真实 CSV → 数据表入库；同名同内容再传 409 定位已有原件", async () => {
  await withApp(async (base) => {
    const bytes = read("sample-bom.csv");
    const up = await upload(base, "sample.csv", bytes);
    assert.equal(up.status, 200);
    assert.equal((up.body.parse as { format: string }).format, "csv");
    assert.ok((up.body.created as { tables: number }).tables > 0);
    const dup = await upload(base, "sample.csv", bytes);
    assert.equal(dup.status, 409, "同字节重导应拒收（稳定去重）");
    assert.ok(dup.body.existingAssetId, "409 指出已有原件定位");
  });
});

test("M6 不支持的格式在落盘前拒绝；扫描 PDF 如实报 needs_ocr", async () => {
  await withApp(async (base, root) => {
    const before = readdirSync(root).length;
    const bad = await upload(base, "fake.pdf", new TextEncoder().encode("这不是 PDF"));
    assert.equal(bad.status, 422, "扩展名与内容不符 → 拒绝");
    assert.equal(readdirSync(root).length, before, "被拒文件不落盘（无孤儿原件）");

    const scanned = await upload(base, "scan.pdf", read("scanned.pdf"));
    assert.equal(scanned.status, 200);
    assert.equal((scanned.body.parse as { status: string }).status, "needs_ocr", "扫描 PDF 如实上报，不谎报成功");
    assert.equal((scanned.body.created as { cards: number }).cards, 0, "无可提取文本时不伪造证据卡");
    const state = (await (await fetch(`${base}/api/state`)).json()) as { assets: { id: string; originalId?: string }[] };
    assert.ok(state.assets.find((a) => a.id === scanned.body.assetId)?.originalId, "原件仍归档可回取");
  });
});

test("M6 论文附件路径：带 paperId 上传 PDF → 建附件且卡片归属论文", async () => {
  await withApp(async (base) => {
    const paper = (await (await fetch(`${base}/api/papers`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "被引论文" }),
    })).json()) as { paperId: string };
    const up = await upload(base, "full.pdf", read("text-2page.pdf"), { paperId: paper.paperId });
    assert.equal(up.status, 200);
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      attachments: { paperId: string; assetId: string }[];
      cards: { assetId: string; paperId?: string }[];
    };
    const assetId = up.body.assetId as string;
    assert.ok(state.attachments.some((a) => a.assetId === assetId && a.paperId === paper.paperId), "建立论文正文附件");
    const cards = state.cards.filter((c) => c.assetId === assetId);
    assert.ok(cards.length > 0 && cards.every((c) => c.paperId === paper.paperId), "卡片随附件归属论文");
  });
});

test("M6 回取原件：畸形文件名（引号/CRLF）不再致 500，头部安全且字节逐一致", async () => {
  await withApp(async (base) => {
    const bytes = read("sample-bom.csv");
    // 文件名含引号 + CRLF：修复前会产出畸形 content-disposition，CR/LF 更令 Node 拒绝写头 → 整个回取 500。
    const up = await upload(base, 'weird"\r\nname.csv', bytes);
    assert.equal(up.status, 200, "含引号/CRLF 的文件名仍可上传归档");
    const res = await fetch(`${base}/api/originals/${up.body.originalId}`);
    assert.equal(res.status, 200, "畸形文件名不得使原件回取 500");
    const cd = res.headers.get("content-disposition") ?? "";
    assert.ok(cd.startsWith("attachment;"), "仍为附件下载头");
    assert.equal(/[\r\n]/.test(cd), false, "响应头不得含换行");
    assert.equal(/filename="[^"]*"/.test(cd), true, "文件名为完整引号对（无裸引号破坏结构）");
    const back = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(Array.from(back), Array.from(bytes), "回取字节仍逐字节一致");
  });
});

test("M6 回取原件：普通 ASCII 文件名 content-disposition 不变样", async () => {
  await withApp(async (base) => {
    const up = await upload(base, "plain.csv", read("sample-bom.csv"));
    assert.equal(up.status, 200);
    const res = await fetch(`${base}/api/originals/${up.body.originalId}`);
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="plain.csv"', "既有可控文件名输出不变");
  });
});

test("M6 接线：方案二进制上传的 409 复用已有原件（与文本分支同口径）", () => {
  const APP = readFileSync(join(HERE, "..", "public", "app.js"), "utf8");
  assert.match(
    APP,
    /isBinaryDoc\(file\.name\)\)[\s\S]{0,400}?api\.importFile\([\s\S]{0,200}?kind: "protocol"[\s\S]{0,250}?existingAssetId/,
    "二进制方案分支须捕获 409 并复用 existingAssetId 继续解析（不得整段报错）",
  );
});

test("M6 方案原件路径：kind=protocol 的 PDF 只归档（不产卡/表），正文可留待方案解析", async () => {
  await withApp(async (base) => {
    const up = await upload(base, "protocol.pdf", read("text-2page.pdf"), { kind: "protocol" });
    assert.equal(up.status, 200);
    assert.equal(up.body.kind, "protocol");
    assert.deepEqual(up.body.created, { tables: 0, cards: 0 }, "方案原件不产出卡/表");
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      assets: { id: string; kind: string; originalId?: string; text: string }[];
      cards: { assetId: string }[];
      tables: { assetId: string }[];
    };
    const asset = state.assets.find((a) => a.id === up.body.assetId)!;
    assert.equal(asset.kind, "protocol");
    assert.ok(asset.originalId, "原件外置归档可回取");
    assert.ok(asset.text.length > 0, "保留可读正文供方案解析");
    assert.equal(state.cards.filter((c) => c.assetId === asset.id).length, 0);
    assert.equal(state.tables.filter((t) => t.assetId === asset.id).length, 0);
  });
});

