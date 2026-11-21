/**
 * 第二步（合同 §5.3/§6）：知识抽取**块级流式**调度契约测试（真实 HTTP 假模型 + 传输层失败）。
 * 覆盖：单块失败隔离、失败块单独重试、取消保留已产出、逐块落库（运行中即可见）、暂停/继续、
 * 以及**断点续跑**——落盘 store 上关闭进程再重启，已提交块不重跑、未跑块继续。
 * 与 tests/knowledge-pipeline.test.ts 的分工：那份用 fetch 桩按调用次序精确门控，验证幂等键/回执/
 * 逐字定位/有界补读/整块拒收/守卫；这份用真 HTTP 服务验证**队列与信号编排**（500 退避、暂停边界、重启恢复）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileStore, MemoryStore } from "../store.ts";
import { clearAiConfig } from "../services/ai.ts";

// 每段 2407 字符 → 单段独立成块（块上限 4000），共 3 块；段首标记句在块内唯一，供逐字定位命中。
const para = (i: number) => `第${i}段标记句。` + "内容填充".repeat(600);
const ATT = [1, 2, 3].map(para).join("\n\n");

/** 模型返回的一批结构化知识：1 条逐字证据 + 1 张含单一项的卡（块级流式的最小单元）。 */
const batchOf = (blockId: string, idx: number, quote: string) => ({
  schemaVersion: 1,
  evidence: [{ localId: "e1", sourceBlockId: blockId, quote }],
  contexts: [],
  cards: [{
    localId: "k1", summary: `卡-${idx}`,
    items: [{
      contentType: "observation", nature: "observation", text: `卡-${idx}-${quote.slice(0, 8)}`,
      subject: "对象", predicate: "指标", value: null,
      contextLocalIds: [], evidenceLocalIds: ["e1"], scopeText: "", unknowns: [], secondaryCitation: false,
    }],
  }],
  relations: [],
});

/**
 * 假模型：按提示词里的「第 N/M 部分」识别块（hits 以**块下标**记次）；对 failRef.chunk 返回 500
 * （可恢复失败，postChat 自行退避重试 3 次）；hits[i] 用于断言「已成功块不再重调模型」。
 */
async function fakeAi(failRef: { chunk: number }, delayMs = 120): Promise<{ server: Server; port: number; hits: number[] }> {
  const hits: number[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const msgs = (JSON.parse(raw) as { messages: { content: string }[] }).messages;
      const user = String(msgs[msgs.length - 1].content);
      const idx = Number(/第 (\d+)\/\d+ 部分/.exec(user)?.[1] ?? "1") - 1; // 块下标（0 基）
      const blockId = /块ID：(\S+)/.exec(user)?.[1] ?? "chunk_0";
      const quote = (user.split("部分）：\n")[1] ?? "").slice(0, 24);
      hits[idx] = (hits[idx] ?? 0) + 1;
      setTimeout(() => {
        if (idx + 1 === failRef.chunk) { res.statusCode = 500; res.end("boom"); return; }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(batchOf(blockId, idx, quote)) } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as AddressInfo).port, hits };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function setup(store?: MemoryStore | JsonFileStore) {
  const { createApp } = await import("../server.ts");
  const app = await createApp(store ?? new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const post = async (p: string, b: unknown) => {
    const r = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, data: await r.json() as Record<string, never> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, any>>;
  return { app, base, post, get };
}

/** 论文条目 + 一份 3 块全文附件；附件 ID 必须显式传给抽取任务（合同不接受「缺省＝全部」）。 */
async function mkPaper(post: (p: string, b: unknown) => Promise<{ status: number; data: Record<string, any> }>) {
  const topicId = (await post("/api/topics", { name: "T", researchQuestion: "Q" })).data.topicId;
  const paperId = (await post("/api/papers", { title: "P", topicIds: [topicId] })).data.paperId;
  const att = await post(`/api/papers/${paperId}/attachments`, { name: "a.md", text: ATT, role: "fulltext" });
  return { paperId, attachmentId: att.data.attachmentId };
}

const start = async (post: (p: string, b: unknown) => Promise<{ status: number; data: Record<string, any> }>, o: { paperId: string; attachmentId: string; key: string }) =>
  post("/api/knowledge/jobs", { paperId: o.paperId, attachmentIds: [o.attachmentId], purpose: "研究目的", idempotencyKey: o.key });

/** 等 job 离开 running（done / error / paused）。块含 500 退避时最长约 6s，故留足轮询预算。 */
async function poll(get: (p: string) => Promise<Record<string, any>>, id: string) {
  for (let i = 0; i < 300; i++) {
    const j = await get(`/api/jobs/${id}`);
    if (j.status === "done" || j.status === "error" || j.status === "paused") return j;
    await sleep(60);
  }
  assert.fail("job 未在预期时间内离开 running");
}

/** 视图：run 的块状态与回执（GET /api/knowledge/runs/:id）。 */
const runView = async (get: (p: string) => Promise<Record<string, any>>, runId: string) => (await get(`/api/knowledge/runs/${runId}`)) as { run: Record<string, any> };

test("第二步：单块失败隔离——已出块保留、失败块入 chunkErrors 且无回执、其余块照常、任务收尾 done", async () => {
  const ref = { chunk: 2 };
  const ai = await fakeAi(ref); const { app, base, post, get } = await setup();
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const paper = await mkPaper(post);
    const r = await start(post, { ...paper, key: "iso-1" });
    assert.equal(r.status, 202);
    assert.equal(r.data.total, 3);
    const job = await poll(get, r.data.jobId);
    assert.equal(job.status, "done");
    assert.equal((job.result.chunkErrors ?? []).length, 1);
    assert.equal(job.result.chunkErrors[0].index, 1); // 提示词「第 2/3 部分」＝块下标 1
    assert.equal(job.result.created, 2); // 另两块照常入库，不被失败块拖垮
    const run = (await runView(get, r.data.runId)).run;
    assert.equal(run.status, "partial");
    assert.deepEqual(run.chunks.map((c: Record<string, unknown>) => c.status), ["committed", "failed", "committed"]);
    assert.equal(run.chunks[1].receipt ?? null, null); // 失败块无回执（故可重试）
    assert.ok(String(run.chunks[1].error).includes("HTTP 500"));
    const st = await get("/api/state");
    assert.equal(st.cards.length, 2);
    assert.equal(st.knowledge.items.length, 2);
    // 服务端逐字定位：引文来自冻结块原文，故 matched＋可回查偏移
    assert.equal(st.knowledge.evidence.every((e: Record<string, any>) => e.payload.locationStatus === "matched"), true);
    assert.equal(st.knowledge.evidence.every((e: Record<string, any>) => e.payload.locator.type === "text"), true);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：失败块可单独重试（只补该块、不重调已成功块、计数不重复）", async () => {
  const ref = { chunk: 2 };
  const ai = await fakeAi(ref, 60); const { app, base, post, get } = await setup();
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const paper = await mkPaper(post);
    const r = await start(post, { ...paper, key: "retry-1" });
    const job = await poll(get, r.data.jobId);
    assert.equal(job.result.created, 2);
    const hitsBefore = ai.hits.map((n) => n ?? 0);
    assert.ok(hitsBefore[1] >= 1, "失败块应被请求过");
    assert.equal(hitsBefore[0], 1);
    assert.equal(hitsBefore[2], 1);
    // 让该块不再失败，只重试下标 1
    ref.chunk = 0;
    const retry = await post(`/api/knowledge/jobs/${r.data.jobId}/retry-chunk`, { index: 1, runId: r.data.runId });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.created, 1);
    assert.notEqual(retry.data.replayed, true);
    assert.equal(ai.hits[0], hitsBefore[0]); // 其余块一次也没再调
    assert.equal(ai.hits[2], hitsBefore[2]);
    assert.equal(ai.hits[1], hitsBefore[1] + 1);
    const after = await get(`/api/jobs/${r.data.jobId}`);
    assert.equal((after.result.chunkErrors ?? []).length, 0); // 重试成功后失败清单清空
    assert.equal(after.result.created, 3);
    const st = await get("/api/state");
    assert.equal(st.cards.length, 3); // 3 块各 1 张，不重复
    assert.equal(st.knowledge.items.length, 3);
    const run = (await runView(get, r.data.runId)).run;
    assert.equal(run.status, "completed");
    assert.equal(run.chunks.every((c: Record<string, any>) => c.status === "committed" && c.receipt), true);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：取消——在途块响应丢弃、run 记 cancelled、已产出保留且计数与库一致", async () => {
  const ai = await fakeAi({ chunk: 0 }, 200); const { app, base, post, get } = await setup();
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const paper = await mkPaper(post);
    const r = await start(post, { ...paper, key: "cancel-1" });
    await sleep(350); // 第 1 块已提交，第 2 块在途
    const c = await post(`/api/knowledge/jobs/${r.data.jobId}/cancel`, { runId: r.data.runId });
    assert.equal(c.status, 200);
    assert.equal(c.data.runStatus, "cancelled");
    const job = await poll(get, r.data.jobId);
    assert.equal(job.status, "done");
    assert.equal(job.result.cancelled, true);
    const run = (await runView(get, r.data.runId)).run;
    assert.equal(run.status, "cancelled");
    const committed = run.chunks.filter((x: Record<string, any>) => x.status === "committed");
    const discarded = run.chunks.filter((x: Record<string, any>) => x.status === "discarded");
    const pending = run.chunks.filter((x: Record<string, any>) => x.status === "pending");
    // 取消：在途块的响应到达时丢弃（discarded），未开跑的块保持 pending，绝不留下半态
    assert.equal(committed.length + discarded.length + pending.length, run.chunks.length);
    assert.ok(committed.length >= 1, "取消前已提交的块必须保留");
    assert.ok(discarded.length + pending.length >= 1, "取消必须拦住后续块");
    assert.equal(committed.every((x: Record<string, any>) => Boolean(x.receipt)), true);
    assert.equal(discarded.every((x: Record<string, any>) => !x.receipt), true);
    const st = await get("/api/state");
    assert.equal(st.cards.length, job.result.created); // 取消后计数与库一致（回执推导）
    assert.equal(st.knowledge.items.length, job.result.createdItems);
    assert.ok(job.result.created <= 2, "取消确实拦住了至少一块");
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：逐块落库——任务结束前已能看到中间产出（块级流式，不是一批到底）", async () => {
  const ai = await fakeAi({ chunk: 0 }, 250); const { app, base, post, get } = await setup();
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const paper = await mkPaper(post);
    const r = await start(post, { ...paper, key: "stream-1" });
    let sawPartial = false;
    let partialItems = 0;
    let requestedAtPartial = 0;
    for (let i = 0; i < 120; i++) {
      const j = await get(`/api/jobs/${r.data.jobId}`);
      if (j.status === "running" && (j.result?.created ?? 0) >= 1) {
        sawPartial = true;
        const st = await get("/api/state");
        partialItems = st.knowledge.items.length; // 已落库的知识实体（不只是壳）
        requestedAtPartial = ai.hits.filter((n) => (n ?? 0) > 0).length; // 此刻已发起请求的块数
        break;
      }
      if (j.status !== "running") break;
      await sleep(60);
    }
    assert.equal(sawPartial, true); // 任务结束前已有卡片落库
    assert.equal(partialItems >= 1, true);
    assert.equal(requestedAtPartial < 3, true); // 并非三块都跑完才一次性可见：产出是逐块出现的
    const done = await poll(get, r.data.jobId);
    assert.equal(done.status, "done");
    assert.equal(done.result.created, 3);
    const st = await get("/api/state");
    assert.equal(st.cards.length, 3);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：暂停/继续——暂停保留已出块与 pending 块，继续只补未跑块", async () => {
  const ai = await fakeAi({ chunk: 0 }, 300); const { app, base, post, get } = await setup();
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const paper = await mkPaper(post);
    const r = await start(post, { ...paper, key: "pause-1" });
    await sleep(200); // 第 1 块在途
    const p = await post(`/api/knowledge/jobs/${r.data.jobId}/pause`, { runId: r.data.runId });
    assert.equal(p.status, 200);
    const j = await poll(get, r.data.jobId);
    assert.equal(j.status, "paused");
    const createdOnPause = j.result.created;
    assert.equal(createdOnPause, 1);
    const hitsOnPause = ai.hits.map((n) => n ?? 0);
    const runPaused = (await runView(get, r.data.runId)).run;
    assert.equal(runPaused.status, "paused");
    assert.deepEqual(runPaused.chunks.map((c: Record<string, any>) => c.status), ["committed", "pending", "pending"]);
    // 继续：只补第 2、3 块
    const res = await post(`/api/knowledge/jobs/${r.data.jobId}/resume`, { runId: r.data.runId });
    assert.equal(res.status, 200);
    const done = await poll(get, res.data.jobId ?? r.data.jobId);
    assert.equal(done.status, "done");
    assert.equal(done.result.created, 3);
    assert.equal(ai.hits[0], hitsOnPause[0]); // 已提交块未重调模型
    assert.equal(ai.hits[1], 1);
    assert.equal(ai.hits[2], 1);
    const st = await get("/api/state");
    assert.equal(st.cards.length, 3); // 不重复
    assert.equal(done.result.created >= createdOnPause, true);
    const run = (await runView(get, r.data.runId)).run;
    assert.equal(run.status, "completed");
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("第二步：断点续跑——落盘后重启进程，已提交块凭回执跳过、未跑块继续补齐", async () => {
  const dir = mkdtempSync(join(tmpdir(), "locus-e2-restart-"));
  const ai = await fakeAi({ chunk: 0 }, 300);
  const { app, base, post, get } = await setup(new JsonFileStore(join(dir, "state.json")));
  let runId = "";
  let hitsBeforeRestart: number[] = [];
  let second: Awaited<ReturnType<typeof setup>> | null = null;
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const paper = await mkPaper(post);
    const r = await start(post, { ...paper, key: "restart-1" });
    runId = r.data.runId;
    await sleep(200);
    await post(`/api/knowledge/jobs/${r.data.jobId}/pause`, { runId }); // 停在块边界：第 1 块已提交，其余 pending
    const paused = await poll(get, r.data.jobId);
    assert.equal(paused.status, "paused");
    assert.equal(paused.result.created, 1);
    hitsBeforeRestart = ai.hits.map((n) => n ?? 0);
    const st1 = await get("/api/state");
    assert.equal(st1.cards.length, 1);
  } finally {
    app.close(); // 模拟进程结束（state.json 已落盘）
  }
  second = await setup(new JsonFileStore(join(dir, "state.json"))); // 新进程读同一份数据
  const { post: post2, get: get2 } = second;
  try {
    await post2("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const view = (await runView(get2, runId)).run; // 重启后仍可查（持久 run）
    assert.equal(view.status, "paused"); // 未跑完的暂停态不是「假称在跑」
    assert.deepEqual(view.chunks.map((c: Record<string, any>) => c.status), ["committed", "pending", "pending"]);
    assert.equal(Boolean(view.chunks[0].receipt), true);
    const r2 = await post2(`/api/knowledge/jobs/legacy/resume`, { runId });
    assert.equal(r2.status, 200);
    const done = await poll(get2, r2.data.jobId);
    assert.equal(done.status, "done");
    assert.equal(done.result.created, 3);
    assert.equal(ai.hits[0], hitsBeforeRestart[0]); // 重启续跑不重调已成功块
    assert.equal(ai.hits[1], 1);
    assert.equal(ai.hits[2], 1);
    const st = await get2("/api/state");
    assert.equal(st.cards.length, 3); // 只追加，不重复
    assert.equal(st.knowledge.items.length, 3);
  } finally {
    second!.app.close(); ai.server.close(); clearAiConfig();
    rmSync(dir, { recursive: true, force: true });
  }
});
