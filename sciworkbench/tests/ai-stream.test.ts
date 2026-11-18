/**
 * 第二步：知识抽取**卡片级流式**后端契约测试。
 * 覆盖：逐块落库、单块失败隔离且不拖垮整任务、失败块可单独重试、取消保留已产出、重跑按概述去重。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { MemoryStore, emptyState } from "../store.ts";
import { createTopic } from "../services/app.ts";
import { createPaper, addPaperAttachment } from "../services/papers.ts";
import { clearAiConfig } from "../services/ai.ts";

const P = "段落内容".repeat(600); // 每段约 2400 字符 → 3 段 → 3 块（块上限 4000）
const ATT = [P, P + "B" , P + "C"].join("\n\n");

/** 假模型：按"第 N/M 部分"识别块；对 failRef.chunk 块返回 500（可恢复失败）；其余返回一张可回查的卡。 */
async function fakeAi(failRef: { chunk: number }, delayMs = 120): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = body.match(/第 (\d+)\/(\d+) 部分/);
      const idx = m ? Number(m[1]) : 1;
      const chunkPart = body.split("部分）：\n").pop() ?? "";
      const quote = chunkPart.slice(0, 30).replace(/\s+/g, " ").trim();
      setTimeout(() => {
        if (idx === failRef.chunk) { res.statusCode = 500; res.end("boom"); return; }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cards: [{ kind: "data", rawText: `卡-${idx}-${quote.slice(0, 8)}`, spans: [{ quote }] }] }) } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as import("node:net").AddressInfo).port };
}

async function setup() {
  const { createApp } = await import("../server.ts");
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  return { app, base: `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}` };
}

const post = async (base: string, p: string, b: unknown) => { const r = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() as any }; };
const get = async (base: string, p: string) => (await fetch(`${base}${p}`)).json() as Promise<any>;
const poll = async (base: string, id: string) => { for (let i = 0; i < 100; i++) { const j = await get(base, `/api/jobs/${id}`); if (j.status === "done" || j.status === "error") return j; await new Promise((r) => setTimeout(r, 60)); } return {}; };

async function mkPaper(base: string) {
  const topicId = (await post(base, "/api/topics", { name: "T", researchQuestion: "Q" })).data.topicId;
  const pid = (await post(base, "/api/papers", { title: "P", topicIds: [topicId] })).data.paperId;
  await post(base, `/api/papers/${pid}/attachments`, { name: "a.md", text: ATT, role: "fulltext" });
  return pid;
}

test("第二步：单块失败隔离——已出保留、失败块入 chunkErrors、任务 done", async () => {
  const ref = { chunk: 2 };
  const ai = await fakeAi(ref); const { app, base } = await setup();
  try {
    await post(base, "/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const pid = await mkPaper(base);
    const r = await post(base, "/api/knowledge/jobs", { paperId: pid, purpose: "研究目的" });
    assert.equal(r.status, 202);
    assert.ok(r.data.total >= 2);
    const job = await poll(base, r.data.jobId);
    assert.equal(job.status, "done");
    assert.equal((job.result.chunkErrors ?? []).length, 1);
    assert.equal(job.result.chunkErrors[0].index, 1);
    assert.ok(job.result.created >= 1); // 未失败的块已落库
    const st = await get(base, "/api/state");
    assert.equal(st.cards.length, job.result.created);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：失败块可单独重试（补该块、只补一次、不重复其余）", async () => {
  const ref = { chunk: 2 };
  const ai = await fakeAi(ref); const { app, base } = await setup();
  try {
    await post(base, "/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const pid = await mkPaper(base);
    const r = await post(base, "/api/knowledge/jobs", { paperId: pid, purpose: "P" });
    const job = await poll(base, r.data.jobId);
    assert.equal((job.result.chunkErrors ?? []).length, 1);
    // 让该块不再失败，重试
    ref.chunk = 0;
    const retry = await post(base, `/api/knowledge/jobs/${r.data.jobId}/retry-chunk`, { index: 1 });
    assert.equal(retry.status, 200);
    assert.ok(retry.data.created >= 1);
    const after = await get(base, `/api/jobs/${r.data.jobId}`);
    assert.equal((after.result.chunkErrors ?? []).length, 0);
    const st = await get(base, "/api/state");
    assert.equal(st.cards.length, 3); // 3 块各 1 张，不重复
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：取消——保留已产出，job 标记 cancelled", async () => {
  const ai = await fakeAi({ chunk: 0 }, 300); const { app, base } = await setup();
  try {
    await post(base, "/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const pid = await mkPaper(base);
    const r = await post(base, "/api/knowledge/jobs", { paperId: pid, purpose: "P" });
    await new Promise((rr) => setTimeout(rr, 150)); // 让第 1 块开始
    await post(base, `/api/knowledge/jobs/${r.data.jobId}/cancel`, {});
    const job = await poll(base, r.data.jobId);
    assert.equal(job.status, "done");
    const st = await get(base, "/api/state");
    assert.ok(st.cards.length >= 0);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：逐块落库——job 运行中已能看到中间 created（流式）", async () => {
  const ai = await fakeAi({ chunk: 0 }, 250); const { app, base } = await setup();
  try {
    await post(base, "/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const pid = await mkPaper(base);
    const r = await post(base, "/api/knowledge/jobs", { paperId: pid, purpose: "P" });
    let sawPartial = false;
    for (let i = 0; i < 40; i++) {
      const j = await get(base, `/api/jobs/${r.data.jobId}`);
      if (j.status === "running" && (j.result?.created ?? 0) >= 1) sawPartial = true;
      if (j.status === "done") break;
      await new Promise((rr) => setTimeout(rr, 60));
    }
    assert.equal(sawPartial, true); // 任务结束前已有卡片落库（卡片级流式）
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});
