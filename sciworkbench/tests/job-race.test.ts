/**
 * S02-T10 反例回归：AI job 等待期编辑不得被覆盖；等待期查重丢弃；409 附已有原件 id。
 * 用慢速假模型（本地 HTTP）制造真实等待窗口，走真实路由。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

const LIT_JSON = JSON.stringify({ cards: [{ rawText: "x", locator: { sectionQuote: "x" }, extracted: { fields: {}, units: [], conditions: [] }, unknowns: [], secondaryCitation: false }] });
const PROTO_JSON = JSON.stringify({ protocol: { purpose: "P", steps: [{ op: "混合", durationMin: 5 }], unknowns: [] } });
const OCR_JSON = JSON.stringify({ records: [{ rawText: "转录", fields: {}, unknowns: [] }] });

/** 慢速假模型：按 system 提示区分任务；延迟制造等待窗口。 */
async function fakeAi(delayMs: number): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      setTimeout(() => {
        const content = body.includes("文献证据抽取") ? LIT_JSON : body.includes("实验方案结构化") ? PROTO_JSON : OCR_JSON;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as import("node:net").AddressInfo).port };
}

async function setup(delayMs = 300) {
  const { createApp } = await import("../server.ts");
  const { MemoryStore } = await import("../store.ts");
  const ai = await fakeAi(delayMs);
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, b: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, never>>;
  const poll = async (jobId: string) => {
    for (let i = 0; i < 100; i++) {
      const j = await get(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (j.status === "done" || j.status === "error") return j;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("job timeout");
  };
  await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
  const close = () => { app.close(); ai.server.close(); };
  return { post, get, poll, close };
}

test("文献 AI job：等待期新建课题/核对编辑不被覆盖（S02-T10 反例）", async () => {
  const { post, get, poll, close } = await setup();
  try {
    const a = await post("/api/topics", { name: "课题A", researchQuestion: "Q" });
    const imp = await post("/api/import/literature", { name: "a.md", text: "x", mode: "ai", topicId: a.data.topicId });
    assert.equal(imp.status, 202);
    // 等待期编辑：新课题 + 子问题
    await post("/api/topics", { name: "课题B（等待期）", researchQuestion: "Q2" });
    const j = await poll(imp.data.jobId as string);
    assert.equal(j.status, "done");
    const st = await get("/api/state");
    assert.deepEqual((st.topics as { name: string }[]).map((t) => t.name).sort(), ["课题A", "课题B（等待期）"].sort());
    assert.equal((st.cards as unknown[]).length, 1);
  } finally { close(); }
});

test("文献 AI job：等待期同内容已入库 → 丢弃结果不重复入库，指向已有原件", async () => {
  const { post, get, poll, close } = await setup();
  try {
    const imp = await post("/api/import/literature", { name: "a.md", text: "x", mode: "ai" });
    const dup = await post("/api/import/literature", { name: "b.md", text: "x", mode: "draft" });
    assert.equal(dup.status, 200);
    const j = await poll(imp.data.jobId as string);
    assert.equal(j.status, "done");
    assert.equal((j.result as { discarded?: boolean }).discarded, true);
    assert.equal((j.result as { assetId?: string }).assetId, dup.data.assetId);
    const st = await get("/api/state");
    assert.equal((st.assets as unknown[]).length, 1);
    assert.equal((st.cards as unknown[]).length, 1); // 只有 draft 卡
  } finally { close(); }
});

test("方案解析 job：等待期编辑不被覆盖（对照验证）", async () => {
  const { post, get, poll, close } = await setup();
  try {
    const t = await post("/api/topics", { name: "课题A", researchQuestion: "Q" });
    const imp = await post("/api/import/literature", { name: "m.md", text: "方法：混合 5 分钟。", mode: "draft", topicId: t.data.topicId });
    const parse = await post("/api/protocols/parse", { assetId: imp.data.assetId, topicId: t.data.topicId, name: "P" });
    assert.equal(parse.status, 202);
    await post("/api/topics", { name: "课题B（等待期）", researchQuestion: "Q2" });
    const j = await poll(parse.data.jobId as string);
    assert.equal(j.status, "done");
    const st = await get("/api/state");
    assert.equal((st.topics as unknown[]).length, 2);
    assert.equal((st.protocols as unknown[]).length, 1);
  } finally { close(); }
});

test("OCR job：等待期编辑不被覆盖（对照验证）", async () => {
  const { post, get, poll, close } = await setup();
  try {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const img = await post("/api/import/image", { name: "h.png", dataUrl: png });
    assert.equal(img.status, 200);
    const ocr = await post("/api/ocr", { assetId: img.data.assetId });
    assert.equal(ocr.status, 202);
    await post("/api/topics", { name: "课题B（等待期）", researchQuestion: "Q2" });
    const j = await poll(ocr.data.jobId as string);
    assert.equal(j.status, "done");
    const st = await get("/api/state");
    assert.equal((st.topics as unknown[]).length, 1);
    assert.equal((st.ocrs as unknown[]).length, 1);
  } finally { close(); }
});

test("409 拒重附已有原件 id（文献/图片），可定位既有引用", async () => {
  const { post, close } = await setup(1);
  try {
    const first = await post("/api/import/literature", { name: "a.md", text: "唯一内容", mode: "draft" });
    const dup = await post("/api/import/literature", { name: "b.md", text: "唯一内容", mode: "draft" });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.existingAssetId, first.data.assetId);
    assert.equal(dup.data.existingName, "a.md");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const i1 = await post("/api/import/image", { name: "p.png", dataUrl: png });
    const i2 = await post("/api/import/image", { name: "q.png", dataUrl: png });
    assert.equal(i2.status, 409);
    assert.equal(i2.data.existingAssetId, i1.data.assetId);
  } finally { close(); }
});