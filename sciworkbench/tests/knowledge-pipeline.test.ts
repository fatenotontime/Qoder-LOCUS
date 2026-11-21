/**
 * E1 提交边界合同测试（§5.1 / §11）：T04/T05/T22/T23。
 * 用可控延迟/可失败的 Store 驱动真实 HTTP 路由，证明：
 * 保存成功才可读；写提交串行且基于最新；失败不发布；后台合并不丢用户改动。
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { MemoryStore, emptyState, type LocusState, type Store } from "../store.ts";
import { createTopic, makeAsset, importMeasurements } from "../services/app.ts";
import { archiveSourceVersion, currentSourceRef, sourcePayload, createKnowledgeDataset, reviewKnowledgeDataset } from "../services/knowledge-base.ts";
import { buildKnowledgeAiInput, validateAiReferences, adoptAiProposal, exportSelectedPackage, createAnalysisTask } from "../services/analysis.ts";
import { clearAiConfig, setAiConfig } from "../services/ai.ts";
import { chatScopeSnapshot } from "../services/analysis.ts";

import { createApp } from "../server.ts";

class GatedStore implements Store {
  #inner = new MemoryStore();
  #gates: (() => void)[] = [];
  gating = false;
  failNext = false;
  saved: LocusState[] = [];
  async load(): Promise<LocusState> { return this.#inner.load(); }
  async save(s: LocusState): Promise<void> {
    if (this.failNext) { this.failNext = false; throw new Error("模拟保存失败"); }
    if (this.gating) await new Promise<void>((r) => this.#gates.push(r));
    await this.#inner.save(s);
    this.saved.push(structuredClone(s));
  }
  release(): void { this.#gates.shift()?.(); }
  async seed(state: LocusState): Promise<void> { await this.#inner.save(structuredClone(state)); }
  get pending(): number { return this.#gates.length; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`等待超时：${what}`);
    await sleep(5);
  }
}

async function boot(store: Store) {
  const app = await createApp(store);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const post = async (p: string, body: unknown) => {
    const res = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(base + p)).json() as Promise<Record<string, unknown>>;
  const close = () => new Promise<void>((r) => app.close(() => r()));
  const raw = (p2: string) => fetch(base + p2);
  return { post, get, raw, base, close };
}

/** 拦截模型调用：挂起直到 release()，返回 context_chat 合法应答。 */
function stubChatAi() {
  const orig = globalThis.fetch;
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((r) => { release = r; });
  globalThis.fetch = (async (u: unknown, init: unknown) => {
    if (String(u).includes("/chat/completions")) {
      started = true;
      await gate;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"助手回答","sources":[],"proposals":[]}' } }] }), { status: 200 });
    }
    return orig(u as never, init as never);
  }) as typeof fetch;
  setAiConfig({ baseUrl: "https://stub", model: "m", key: "k" });
  return { release, isStarted: () => started, restore: () => { globalThis.fetch = orig; clearAiConfig(); } };
}

type State = LocusState;

test("T04 延迟Store：两次用户操作与AI完成交错，三笔基于最新提交串行保留；GET不见未提交态", async () => {
  const store = new GatedStore();
  const { post, get, close } = await boot(store);
  const ai = stubChatAi();
  try {
    const t1 = await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    assert.equal(t1.status, 200);
    const chatId = (await post("/api/chats", { topicId: t1.body.topicId ?? (await get("/api/state") as unknown as State).topics[0].id })).body.chatId as string;
    assert.ok(chatId);

    store.gating = true;
    // 提交①：用户发言（appendChatTurn），保存被挂起
    const p1 = post(`/api/chats/${chatId}/send`, { text: "用户问题" });
    await waitFor(() => store.pending === 1, "提交①保存挂起");
    let s = (await get("/api/state")) as unknown as State;
    assert.equal(s.chats[0].messages.length, 0, "保存未成功：GET 不得见未提交的用户消息");

    store.release(); // 提交①落库 → job 启动（模型调用在队列外、被挂起）
    await waitFor(() => ai.isStarted(), "模型调用已开始");
    // 提交②：第二个用户操作排队
    const p2 = post("/api/topics", { name: "课题乙", researchQuestion: "R" });
    await sleep(30);
    s = (await get("/api/state")) as unknown as State;
    assert.equal(s.topics.length, 1);
    assert.equal(s.chats[0].messages.length, 2, "提交①已发布：用户消息＋running 占位");
    assert.equal(s.chats[0].messages[1].status, "running");

    ai.release(); // 提交③（AI 完成）进入队列，排在提交②之后
    await waitFor(() => store.pending === 1, "提交②保存挂起");
    s = (await get("/api/state")) as unknown as State;
    assert.equal(s.topics.length, 1, "提交②未保存成功：课题乙不可见");
    store.release(); // 提交②落库
    await waitFor(() => store.pending === 1, "提交③保存挂起");
    s = (await get("/api/state")) as unknown as State;
    assert.equal(s.topics.length, 2);
    assert.equal(s.chats[0].messages[1].status, "running", "提交③未保存成功：助手回答不可见");
    store.release(); // 提交③落库

    assert.equal((await p1).status, 202);
    assert.equal((await p2).status, 200);
    s = (await get("/api/state")) as unknown as State;
    assert.equal(s.topics.length, 2);
    assert.equal(s.chats[0].messages.length, 2);
    assert.equal(s.chats[0].messages[0].content, "用户问题");
    assert.equal(s.chats[0].messages[1].status, "done");
    assert.equal(s.chats[0].messages[1].content, "助手回答");
    // 三笔串行保留：每次落库快照都包含此前已提交的全部实体（不互相覆盖）
    assert.ok(store.saved.length >= 3);
    const last = store.saved.at(-1)!;
    assert.equal(last.topics.length, 2);
    assert.equal(last.chats[0].messages[1].content, "助手回答");
    const aiSave = store.saved.find((x) => x.chats[0]?.messages[1]?.content === "助手回答")!;
    assert.equal(aiSave.topics.length, 2, "AI 写回基于最新提交（含等待期的课题乙），不是旧快照");
  } finally {
    ai.restore();
    await close();
  }
});

test("T05 Store首次保存失败：不发布任何业务变化，队列可继续", async () => {
  const store = new GatedStore();
  const { post, get, close } = await boot(store);
  try {
    store.failNext = true;
    const bad = await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    assert.equal(bad.status, 500);
    let s = (await get("/api/state")) as unknown as State;
    assert.equal(s.topics.length, 0, "保存失败：内存与 GET 均不得见新课题");
    assert.equal(store.saved.length, 0);
    // 队列未挂死：后续提交正常
    const ok = await post("/api/topics", { name: "课题乙", researchQuestion: "R" });
    assert.equal(ok.status, 200);
    const imp = await post("/api/import/measurements", { name: "d.csv", csv: "t,v\n0,1" });
    assert.equal(imp.status, 200);
    s = (await get("/api/state")) as unknown as State;
    assert.equal(s.topics.length, 1);
    assert.equal(s.topics[0].name, "课题乙");
    assert.equal(s.tables.length, 1);
    assert.equal(store.saved.length, 2);
  } finally {
    await close();
  }
});

test("T22 后台模型完成前用户改备注/确认：不丢用户改动、不覆盖确认、不改变冻结输入", async () => {
  const store = new GatedStore();
  const { post, get, close } = await boot(store);
  const ai = stubChatAi();
  try {
    await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    const tid = ((await get("/api/state")) as unknown as State).topics[0].id;
    const lit = await post("/api/import/literature", { name: "l.md", text: "原文片段在此。", mode: "draft" });
    assert.equal(lit.status, 200);
    const card = await post("/api/cards", { assetId: lit.body.assetId, rawText: "原文片段在此。" });
    assert.equal(card.status, 200);
    const cardId = card.body.cardId as string;
    const chatId = (await post("/api/chats", { topicId: tid })).body.chatId as string;

    const send = await post(`/api/chats/${chatId}/send`, { text: "讨论问题" });
    assert.equal(send.status, 202);
    await waitFor(() => ai.isStarted(), "模型调用已开始");
    // 独立 oracle：用发送时刻（任何用户编辑前）的已提交 state 重算冻结快照 hash
    const atSend = (await get("/api/state")) as unknown as State;
    const frozenHash = chatScopeSnapshot(atSend, atSend.chats[0], "讨论问题", "m").hash;

    // 等待期用户改动①：确认知识卡＋备注
    const rv1 = await post(`/api/cards/${cardId}/review`, { audit: "confirm", note: "用户备注", reason: "人工核对" });
    assert.equal(rv1.status, 200);

    // AI 完成的保存挂起时，用户改动②排队（不得被 AI 写回覆盖）
    store.gating = true;
    ai.release();
    await waitFor(() => store.pending === 1, "AI 写回保存挂起");
    const rv2 = post(`/api/cards/${cardId}/review`, { note: "二次备注" });
    let s = (await get("/api/state")) as unknown as State;
    assert.equal(s.chats[0].messages[1].status, "running", "AI 保存未成功前不得见回答");
    store.release();
    await waitFor(() => store.pending === 1, "用户改动②保存挂起");
    store.release();
    assert.equal((await rv2).status, 200);

    s = (await get("/api/state")) as unknown as State;
    const c = s.cards.find((x) => x.id === cardId)!;
    assert.equal(c.audit, "confirm", "AI 写回不得覆盖用户确认");
    assert.equal(c.note, "二次备注", "等待期与挂起期的用户备注均保留");
    const msg = s.chats[0].messages[1];
    assert.equal(msg.status, "done");
    assert.equal(msg.content, "助手回答");
    assert.equal((msg.snapshot as { hash: string }).hash, frozenHash, "写回使用发送时冻结的快照，不随等待期编辑改变");
    assert.equal(s.chats[0].messages[0].content, "讨论问题");
  } finally {
    ai.restore();
    await close();
  }
});

test("T23 多实体结果提交在save处失败：文件与结果均未发布，无孤儿业务记录", async () => {
  const store = new GatedStore();
  const { post, get, close } = await boot(store);
  try {
    await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    const tid = ((await get("/api/state")) as unknown as State).topics[0].id;
    const imp = await post("/api/import/measurements", { name: "d.csv", csv: "t,v\n0,1", topicId: tid });
    assert.equal(imp.status, 200);
    const tableId = ((await get("/api/state")) as unknown as State).tables[0].id;
    const task = await post("/api/analysis/tasks", { topicId: tid, title: "分析", core: [{ kind: "table", id: tableId }] });
    assert.equal(task.status, 200);
    const taskId = task.body.taskId as string;
    const body = {
      method: "外部工具甲",
      attachments: [{ name: "r1.csv", content: "a,b\n1,2" }, { name: "r2.txt", content: "外部工具输出" }],
    };
    const before = (await get("/api/state")) as unknown as State;
    store.failNext = true;
    const bad = await post(`/api/analysis/tasks/${taskId}/result`, body);
    assert.equal(bad.status, 500);
    let s = (await get("/api/state")) as unknown as State;
    assert.equal(s.assets.length, before.assets.length, "失败：结果文件原件不得发布");
    assert.equal(s.analysisResults.length, 0, "失败：结果记录不得发布（无孤儿）");
    // 重试同一笔：整体成功
    const ok = await post(`/api/analysis/tasks/${taskId}/result`, body);
    assert.equal(ok.status, 200);
    s = (await get("/api/state")) as unknown as State;
    assert.equal(s.assets.length, before.assets.length + 2);
    assert.equal(s.analysisResults.length, 1);
    assert.equal((s.analysisResults[0].assetIds ?? []).length, 2);
  } finally {
    await close();
  }
});

// ══ E2：语义知识提取新契约（合同 §5.3/§5.4/§6）路由级测试 T06–T12、T24 ══

interface StructCall { blockId: string; index: number; total: number; user: string }
type Post = (p: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
type Get = (p: string) => Promise<Record<string, unknown>>;

function structCall(init: unknown): StructCall {
  const body = JSON.parse(String((init as { body?: string }).body ?? "{}"));
  const msgs = (body.messages ?? []) as { content?: unknown }[];
  const user = String(msgs[msgs.length - 1]?.content ?? "");
  const dm = /第 (\d+)\/(\d+) 部分/.exec(user);
  return { blockId: /块ID：(\S+)/.exec(user)?.[1] ?? "", index: Number(dm?.[1] ?? 1) - 1, total: Number(dm?.[2] ?? 1), user };
}

/** 结构化提取模型桩：按调用即时返回 plan 给的 JSON 文本，并记录每次调用（用于「模型调用次数 0」这类硬断言）。 */
function stubStructAi(plan: (call: StructCall) => string) {
  const orig = globalThis.fetch;
  const calls: StructCall[] = [];
  globalThis.fetch = (async (u: unknown, init: unknown) => {
    if (!String(u).includes("/chat/completions")) return orig(u as never, init as never);
    const call = structCall(init);
    calls.push(call);
    return new Response(JSON.stringify({ choices: [{ message: { content: plan(call) } }] }), { status: 200 });
  }) as typeof fetch;
  setAiConfig({ baseUrl: "https://stub", model: "m", key: "k" });
  return { calls, restore: () => { globalThis.fetch = orig; clearAiConfig(); } };
}

/** 挂起式模型桩：每次调用停在 await，测试可控地放行，用来制造「在途响应 vs 取消/暂停/重启」交错。 */
const EMPTY_BATCH = '{"schemaVersion":1,"evidence":[],"contexts":[],"cards":[],"relations":[]}';
function stubStructGated() {
  const orig = globalThis.fetch;
  const hooks: { call: StructCall; respond: (content: string) => void; answered: boolean }[] = [];
  globalThis.fetch = (async (u: unknown, init: unknown) => {
    if (!String(u).includes("/chat/completions")) return orig(u as never, init as never);
    const call = structCall(init);
    let respond!: (content: string) => void;
    const waiting = new Promise<string>((r) => { respond = r; });
    hooks.push({ call, respond, answered: false });
    const content = await waiting;
    hooks[hooks.length - 1].answered = true;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  setAiConfig({ baseUrl: "https://stub", model: "m", key: "k" });
  return {
    get count(): number { return hooks.length; },
    call(i: number): StructCall { return hooks[i].call; },
    wasAnswered(i: number): boolean { return hooks[i].answered === true; },
    respond(i: number, content: string): void { hooks[i].respond(content); },
    restore: () => {
      globalThis.fetch = orig;
      clearAiConfig();
      // 测试收尾：放行故意留在途的请求（否则 postChat 的 120s 超时定时器会拖住进程）；
      // 用空批次应答，断言此时已全部完成，不影响任何结果。
      hooks.forEach((h, i) => { if (!h.answered) h.respond(EMPTY_BATCH); });
    },
  };
}

const scalar = (raw: string, value: string, unit: string | null = null) => ({ kind: "scalar", raw, value, unit });
const evOf = (localId: string, sourceBlockId: string, quote: string) => ({ localId, sourceBlockId, quote });
const ctxOf = (localId: string, over: Record<string, unknown> = {}) => ({ localId, subject: "石墨烯电极", group: "G1", stage: "测试", method: "", conditions: [], unknowns: [], evidenceLocalIds: [], ...over });
const itemOf = (over: Record<string, unknown> = {}) => ({ contentType: "observation", nature: "observation", text: "25 °C下响应时间0.8 s", subject: { raw: "石墨烯电极" }, predicate: { raw: "响应时间" }, value: scalar("0.8 s", "0.8", "s"), contextLocalIds: [], evidenceLocalIds: [], scopeText: "", unknowns: [], secondaryCitation: false, ...over });
const cardOf = (localId: string, summary: string, items: Record<string, unknown>[]) => ({ localId, summary, items });
const structJson = (o: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, evidence: [], contexts: [], cards: [], relations: [], ...o });
const EMPTY = structJson({});
async function mkPaper(post: Post, title: string, atts: { name: string; text: string }[], topicIds?: string[]): Promise<{ paperId: string; attachments: { attachmentId: string; assetId: string }[] }> {
  const p = await post("/api/papers", { title, authors: "作者甲", year: "2024", topicIds });
  assert.equal(p.status, 200);
  const paperId = p.body.paperId as string;
  const attachments: { attachmentId: string; assetId: string }[] = [];
  for (const a of atts) {
    const r = await post(`/api/papers/${paperId}/attachments`, { name: a.name, text: a.text, role: "fulltext" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    attachments.push({ attachmentId: r.body.attachmentId as string, assetId: r.body.assetId as string });
  }
  return { paperId, attachments };
}

const st = async (get: Get): Promise<State> => (await get("/api/state")) as unknown as State;
const jobOf = async (get: Get, jobId: string): Promise<Record<string, unknown>> => jobWithStatus(get, jobId);
async function jobWithStatus(get: Get, jobId: string): Promise<Record<string, unknown>> {
  const job = await get(`/api/jobs/${jobId}`);
  if (job.error && !job.id) throw new Error(`job 不存在：${jobId}`);
  return job;
}
interface RunView { ok: boolean; run: Record<string, unknown>; jobId: string | null; job: Record<string, unknown> | null }
const runOf = async (get: Get, runId: string): Promise<RunView> => (await get(`/api/knowledge/runs/${runId}`)) as unknown as RunView;
const chunksOf = (view: RunView): { status: string; receipt?: unknown; error?: string }[] => (view.run.chunks ?? []) as { status: string; receipt?: unknown; error?: string }[];
const counts = (s: State) => ({ cards: s.cards.length, items: s.knowledge.items.length, contexts: s.knowledge.contexts.length, evidence: s.knowledge.evidence.length, relations: s.knowledge.relations.length });
/** 等 job 离开 running（done / error / paused）；轮询而非挂死。 */
async function waitJobEnd(get: Get, jobId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 800; i++) {
    const job = await jobOf(get, jobId);
    if (job.status !== "running") return job;
    await sleep(5);
  }
  throw new Error(`等待超时：job ${jobId} 未结束`);
}
async function waitChunk(get: Get, runId: string, index: number, status: string): Promise<void> {
  for (let i = 0; i < 800; i++) {
    const c = chunksOf(await runOf(get, runId))[index];
    if (c && c.status === status) return;
    await sleep(5);
  }
  throw new Error(`等待超时：${runId} 第 ${index} 块未变为 ${status}`);
}

test("T06 输入非法早拒：422/404，模型调用 0 次，无 run 与知识残留", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  const ai = stubStructAi(() => EMPTY);
  try {
    const t1 = await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    const t2 = await post("/api/topics", { name: "课题乙", researchQuestion: "R" });
    const topicId = t1.body.topicId as string, otherTopicId = t2.body.topicId as string;
    const sqOther = await post(`/api/topics/${otherTopicId}/subquestions`, { question: "乙的子问题", kind: "declared" });
    assert.equal(sqOther.status, 200);
    const A = await mkPaper(post, "论文甲", [{ name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。" }]);
    const B = await mkPaper(post, "论文乙", [{ name: "b1.md", text: "碳纳米管电极在30 °C下响应时间1.4 s。" }]);
    const key = "k-e2-t06";
    const cases: [string, Record<string, unknown>, number][] = [
      ["附件为空数组", { paperId: A.paperId, attachmentIds: [], purpose: "比较响应时间", idempotencyKey: key }, 422],
      ["附件缺省（不得解释为全选）", { paperId: A.paperId, purpose: "比较响应时间", idempotencyKey: key }, 422],
      ["附件含重复 ID", { paperId: A.paperId, attachmentIds: [A.attachments[0].attachmentId, A.attachments[0].attachmentId], purpose: "比较响应时间", idempotencyKey: key }, 422],
      ["附件不属于该论文", { paperId: A.paperId, attachmentIds: [B.attachments[0].attachmentId], purpose: "比较响应时间", idempotencyKey: key }, 422],
      ["附件不存在", { paperId: A.paperId, attachmentIds: ["att_不存在"], purpose: "比较响应时间", idempotencyKey: key }, 422],
      ["缺研究目的", { paperId: A.paperId, attachmentIds: [A.attachments[0].attachmentId], purpose: "  ", idempotencyKey: key }, 422],
      ["缺幂等键", { paperId: A.paperId, attachmentIds: [A.attachments[0].attachmentId], purpose: "比较响应时间", idempotencyKey: "" }, 422],
      ["子问题不属于该课题", { paperId: A.paperId, attachmentIds: [A.attachments[0].attachmentId], purpose: "比较响应时间", topicId, subquestionId: sqOther.body.subquestionId as string, idempotencyKey: key }, 422],
      ["只给子问题不给课题", { paperId: A.paperId, attachmentIds: [A.attachments[0].attachmentId], purpose: "比较响应时间", subquestionId: sqOther.body.subquestionId as string, idempotencyKey: key }, 422],
      ["论文条目不存在", { paperId: "paper_不存在", attachmentIds: [A.attachments[0].attachmentId], purpose: "比较响应时间", idempotencyKey: key }, 404],
    ];
    for (const [what, body, status] of cases) {
      const r = await post("/api/knowledge/jobs", body);
      assert.equal(r.status, status, `${what} 应 ${status}，实得 ${r.status}：${JSON.stringify(r.body)}`);
      assert.ok(String(r.body.error ?? "").length > 0, `${what} 应给出人话错误`);
    }
    assert.equal(ai.calls.length, 0, "早拒：一次模型调用都不许发生");
    const s = await st(get);
    assert.deepEqual(counts(s), { cards: 0, items: 0, contexts: 0, evidence: 0, relations: 0 }, "早拒：不产生任何知识对象");
    assert.equal(s.knowledge.extractionRuns.length, 0, "早拒：不建提取 run");
    assert.equal(s.assets.length, 2, "早拒不得留下半建来源");
  } finally {
    ai.restore();
    await close();
  }
});

test("T07 同概述不同组别/条件：两项均保留，不按概述去重（重复仅提示不合并）", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  let current: (c: StructCall) => string = () => EMPTY;
  const ai = stubStructAi((c) => current(c));
  try {
    const { paperId, attachments } = await mkPaper(post, "论文甲", [{ name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。高湿组同为0.8 s。" }]);
    const attIds = attachments.map((a) => a.attachmentId);
    current = () => structJson({
      evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")],
      contexts: [
        ctxOf("c1", { group: "低温干燥组", conditions: [{ field: "温度", value: scalar("25 °C", "25", "°C"), appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceLocalIds: ["e1"] }], evidenceLocalIds: ["e1"] }),
        ctxOf("c2", { group: "高湿组", conditions: [{ field: "湿度", value: scalar("80 %RH", "80", "%RH"), appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceLocalIds: ["e1"] }], evidenceLocalIds: ["e1"] }),
      ],
      cards: [cardOf("k1", "响应时间0.8 s", [itemOf({ text: "响应时间0.8 s", contextLocalIds: ["c1"], evidenceLocalIds: ["e1"] })]),
        cardOf("k2", "响应时间0.8 s", [itemOf({ text: "响应时间0.8 s", contextLocalIds: ["c2"], evidenceLocalIds: ["e1"] })])],
    });
    const r1 = await post("/api/knowledge/jobs", { paperId, attachmentIds: attIds, purpose: "比较响应时间", idempotencyKey: "k-t07-a" });
    assert.equal(r1.status, 202, JSON.stringify(r1.body));
    await waitJobEnd(get, r1.body.jobId as string);
    let s = await st(get);
    assert.equal(s.cards.length, 2, "同概述两候选都建壳，不合并");
    assert.equal(s.knowledge.items.length, 2, "两候选各 1 项，均保留");
    assert.equal(s.knowledge.contexts.length, 2, "组别不同 → 两个上下文");
    assert.ok(s.knowledge.contexts.every((c) => c.payload.review.status === "pending"), "全部待审");
    assert.deepEqual(s.knowledge.items.map((i) => i.payload.text), ["响应时间0.8 s", "响应时间0.8 s"], "不按概述文本去重");

    // 第二次运行再出同概述同谓词项：只提示疑似重复，不自动合并/删除
    current = () => structJson({
      evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")],
      cards: [cardOf("k1", "响应时间0.8 s", [itemOf({ text: "响应时间0.8 s", evidenceLocalIds: ["e1"] })])],
    });
    const r2 = await post("/api/knowledge/jobs", { paperId, attachmentIds: attIds, purpose: "另一研究目的", idempotencyKey: "k-t07-b" });
    assert.equal(r2.status, 202);
    const j2 = await waitJobEnd(get, r2.body.jobId as string);
    s = await st(get);
    assert.equal(s.cards.length, 3, "重复提示不得吞掉新候选");
    assert.equal(s.knowledge.items.length, 3);
    assert.ok(((j2.result as { duplicateCandidates?: string[] }).duplicateCandidates ?? []).length >= 1, "应给出疑似重复提示");
  } finally {
    ai.restore();
    await close();
  }
});

test("T08 幂等：同键同输入返回同 run 不重调模型；已成功块重放返回同 receipt 不增对象", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  const g = stubStructGated();
  try {
    const { paperId, attachments } = await mkPaper(post, "论文甲", [{ name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。" }]);
    const attIds = attachments.map((a) => a.attachmentId);
    const body = { paperId, attachmentIds: attIds, purpose: "比较响应时间", idempotencyKey: "k-t08" };
    const batch = structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")], cards: [cardOf("k1", "响应时间0.8 s", [itemOf({ evidenceLocalIds: ["e1"] })])] });
    const r1 = await post("/api/knowledge/jobs", body);
    assert.equal(r1.status, 202);
    const runId = r1.body.runId as string;
    await waitFor(() => g.count >= 1, "第 1 块已请求模型");
    g.respond(0, batch);
    const j1 = await waitJobEnd(get, r1.body.jobId as string);
    assert.equal((j1.result as { created?: number }).created, 1);
    let s = await st(get);
    const run1 = s.knowledge.extractionRuns[0];
    const receipt1 = run1.chunks[0].receipt!;
    const before = counts(s);
    assert.equal(g.count, 1, "单次运行只调一次模型");

    // ① 同键同输入重复提交（网络重试）：返回既有 run，不新建、不重调模型
    const r2 = await post("/api/knowledge/jobs", body);
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal(r2.body.replayed, true);
    assert.equal(r2.body.runId, runId, "同键同输入必须复用同一 run");
    g.respond(0, batch); // 若被误当作新调用重发，也不应产生第二次模型请求
    s = await st(get);
    assert.equal(s.knowledge.extractionRuns.length, 1, "不新建 run");
    assert.deepEqual(counts(s), before, "重放不产生任何新对象");
    assert.equal(g.count, 1, "重放不再调模型");

    // ② 响应丢失后对已成功块重试：命中 receipt，返回同一回执，对象数与模型调用均不变
    const retry = await post(`/api/knowledge/jobs/${runId}/retry-chunk`, { index: 0, runId });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.replayed, true, "已有回执的块必须重放而非重复入库");
    assert.equal(retry.body.created, 0);
    s = await st(get);
    assert.equal(g.count, 1, "重放不调模型");
    assert.deepEqual(counts(s), before, "重放不增加对象");
    assert.deepEqual(s.knowledge.extractionRuns[0].chunks[0].receipt, receipt1, "返回同 receipt（卡片/实体 ID 不变）");

    // ③ 同键不同输入：409 定位既有 run
    const r3 = await post("/api/knowledge/jobs", { ...body, purpose: "换一个研究目的" });
    assert.equal(r3.status, 409);
    assert.equal(r3.body.code, "idempotency_conflict");
  } finally {
    g.restore();
    await close();
  }
});

test("T09 引文定位：合法范围内多命中才 ambiguous；范围外同句不构成候选、不默认首个", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  let current: (c: StructCall) => string = () => EMPTY;
  const ai = stubStructAi((c) => current(c));
  try {
    const { paperId, attachments } = await mkPaper(post, "论文甲", [
      { name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。\n\n重复记录：响应时间0.8 s。" },
      { name: "a2.md", text: "另一附件同样写着响应时间0.8 s（不在本块允许范围内）。" },
    ]);
    const [a1, a2] = attachments;
    current = (c) => c.blockId === "chunk_0"
      ? structJson({
        evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")],
        contexts: [ctxOf("c1", { evidenceLocalIds: ["e1"] })],
        cards: [cardOf("k1", "响应时间0.8 s", [itemOf({ contextLocalIds: ["c1"], evidenceLocalIds: ["e1"] })])],
      })
      : EMPTY;
    const r = await post("/api/knowledge/jobs", { paperId, attachmentIds: attachments.map((a) => a.attachmentId), purpose: "比较响应时间", idempotencyKey: "k-t09" });
    assert.equal(r.status, 202);
    await waitJobEnd(get, r.body.jobId as string);
    const s = await st(get);
    assert.equal(s.knowledge.evidence.length, 1);
    const ev = s.knowledge.evidence[0].payload;
    assert.equal(ev.locationStatus, "ambiguous", "范围内两处命中 → 歧义，不得当作已定位");
    assert.equal(ev.candidates.length, 2, "范围外同句不得进入候选（不是 3 个）");
    assert.ok(ev.candidates.every((c) => c.sourceRef.id === a1.assetId), "候选只来自本块所属原件");
    assert.equal(ev.locator.type, "unresolved", "歧义时不给假定位，也不默认第一处");
    assert.equal(s.knowledge.contexts[0].payload.unknowns.some((u) => u.reasonCode === "ambiguous"), true, "歧义须留待审线索");
    assert.equal(s.knowledge.items[0].payload.review.status === "pending", true);
    assert.equal(s.cards[0].spans[0].matched, false, "阅读壳引文不得标为已匹配");
  } finally {
    ai.restore();
    await close();
  }
});

test("T10 引文不在块内：pending + unmatched，不生成 matched 假定位", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  const ai = stubStructAi(() => structJson({
    evidence: [evOf("e1", "chunk_0", "响应时间9.9 s")],
    contexts: [ctxOf("c1", { evidenceLocalIds: ["e1"] })],
    cards: [cardOf("k1", "响应时间9.9 s", [itemOf({ text: "响应时间9.9 s", value: scalar("9.9 s", "9.9", "s"), contextLocalIds: ["c1"], evidenceLocalIds: ["e1"] })])],
  }));
  try {
    const { paperId, attachments } = await mkPaper(post, "论文甲", [{ name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。" }]);
    const r = await post("/api/knowledge/jobs", { paperId, attachmentIds: attachments.map((a) => a.attachmentId), purpose: "比较响应时间", idempotencyKey: "k-t10" });
    assert.equal(r.status, 202);
    await waitJobEnd(get, r.body.jobId as string);
    const s = await st(get);
    assert.equal(s.knowledge.evidence.length, 1, "未匹配不等于整块拒收：仍入库待审");
    const ev = s.knowledge.evidence[0].payload;
    assert.equal(ev.locationStatus, "unmatched");
    assert.equal(ev.locator.type, "unresolved", "未匹配不得给出 text 假定位");
    assert.deepEqual(ev.candidates, []);
    assert.equal(ev.sourceRef.id, attachments[0].assetId, "来源可确定，只是定位不足");
    assert.equal(s.knowledge.items[0].payload.review.status === "pending", true, "全部保持待审");
    assert.equal(s.knowledge.contexts[0].payload.unknowns.some((u) => u.reasonCode === "unresolved_link"), true, "定位不足须作为 unknown 呈现");
    assert.equal(s.cards[0].spans[0].matched, false);
    assert.equal(s.cards[0].locator.sectionQuote, "", "无已定位引文 → 壳不回查引文，不编造");
  } finally {
    ai.restore();
    await close();
  }
});

test("T11 跨块方法与结果：仅明确唯一引用可绑定；范围外引用整块拒收；补读失败不悄悄丢", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  let current: (c: StructCall) => string = () => EMPTY;
  const ai = stubStructAi((c) => current(c));
  try {
    const { paperId, attachments } = await mkPaper(post, "论文甲", [
      { name: "结果.md", text: "石墨烯电极在25 °C下响应时间0.8 s（测试条件见表3）。" },
      { name: "方法.md", text: "表3 计时电流法：电位0.6 V，电解液为PBS。\n\n其余参数原文未给出。" },
      { name: "讨论.md", text: "响应提升的原因尚不清楚（相关数据见表9）。" },
    ]);
    const [res, met] = attachments;
    current = (c) => c.blockId === "chunk_0"
      ? structJson({
        evidence: [evOf("e1", "chunk_0", "响应时间0.8 s"), evOf("e2", "chunk_0:sup0", "电位0.6 V")],
        contexts: [ctxOf("c1", {
          method: "计时电流法",
          conditions: [{ field: "电位", value: scalar("0.6 V", "0.6", "V"), appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceLocalIds: ["e2"] }],
          evidenceLocalIds: ["e1"],
        })],
        cards: [cardOf("k1", "响应时间0.8 s", [itemOf({ contextLocalIds: ["c1"], evidenceLocalIds: ["e1", "e2"] })])],
      })
      // chunk_1（方法.md）试图引用别块的证据 → 整块拒收
        : structJson({
          evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")],
          cards: [cardOf("k1", "跨块串条件", [itemOf({ evidenceLocalIds: ["e1"] })])],
        });
    const r = await post("/api/knowledge/jobs", { paperId, attachmentIds: [res.attachmentId, met.attachmentId], purpose: "比较响应时间", idempotencyKey: "k-t11" });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.total, 2);
    const job = await waitJobEnd(get, r.body.jobId as string);
    const s = await st(get);
    const run = s.knowledge.extractionRuns.find((x) => x.id === (r.body.runId as string))!;
    assert.equal(run.chunks[0].status, "committed");
    assert.equal(run.chunks[1].status === "failed", true, "非法跨块引用：该块整块拒收");
    assert.ok(String(run.chunks[1].error).includes("整块拒收"), "拒收理由可见");
    // 唯一明确引用可绑定：补读来的方法证据落在方法.md，且定位合法
    const sup = s.knowledge.evidence.find((e) => e.payload.quote === "电位0.6 V")!;
    assert.equal(sup.payload.sourceRef.id, met.assetId, "补读证据来源为方法附件");
    assert.equal(sup.payload.locationStatus, "matched");
    assert.equal(sup.payload.locator.type === "text" && sup.payload.locator.start >= 0, true, "补读范围内给真实偏移");
    // 不串条件：结果块只带自己的 1 个上下文，方法文字另存为 method 项
    assert.equal(s.knowledge.contexts.length, 1, "被拒收的块不得留下任何上下文");
    assert.equal(s.knowledge.contexts[0].payload.conditions.length, 1);
    assert.equal(s.knowledge.contexts[0].payload.conditions[0].field.raw, "电位");
    assert.equal(s.knowledge.contexts[0].payload.methodRefs.length, 1, "方法文字另存为 method 项");
    assert.equal(s.knowledge.items.length, 2, "结果项＋方法项；拒收块 0 项");
    assert.equal(s.cards.length, 1, "拒收块不返回半套知识");
    assert.ok((job.result as { chunkErrors?: { index: number; recoverable: boolean }[] }).chunkErrors?.some((e) => e.index === 1 && e.recoverable), "失败块标为可重试");
    assert.equal(run.status, "partial");

    // 补读定位失败（表9 无处可寻）：既不编造绑定，也必须显式暴露而不是悄悄丢
    current = () => structJson({
      evidence: [evOf("e1", "chunk_0", "原因尚不清楚")],
      contexts: [ctxOf("c1", { evidenceLocalIds: ["e1"] })],
      cards: [cardOf("k1", "机制不明", [itemOf({ text: "机制未查明", value: null, contextLocalIds: ["c1"], evidenceLocalIds: ["e1"] })])],
    });
    const r2 = await post("/api/knowledge/jobs", { paperId, attachmentIds: [attachments[2].attachmentId], purpose: "弄清提升原因", idempotencyKey: "k-t11b" });
    assert.equal(r2.status, 202);
    const j2 = await waitJobEnd(get, r2.body.jobId as string);
    assert.deepEqual(((j2.result as { unresolvedLinks?: string[] }).unresolvedLinks ?? []).length, 1, "未解析的表引用必须出现在任务结果");
    const s2 = await st(get);
    const ctx2 = s2.knowledge.contexts.find((c) => c.payload.unknowns.some((u) => u.fieldPath === "supplement"))!;
    assert.ok(ctx2, "未解析的表引用同时落为上下文 unknown（可逐项审阅）");
    assert.equal(ctx2.payload.unknowns.find((u) => u.fieldPath === "supplement")!.reasonCode, "unresolved_link");
  } finally {
    ai.restore();
    await close();
  }
});

test("T12 非法类型/localId 重复/悬空引用/伪造审核：整块拒收，不返回半套可用知识", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  let current: (c: StructCall) => string = () => EMPTY;
  const ai = stubStructAi((c) => current(c));
  try {
    const { paperId, attachments } = await mkPaper(post, "论文甲", [{ name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。" }]);
    const attIds = attachments.map((a) => a.attachmentId);
    const okItem = itemOf({ evidenceLocalIds: ["e1"] });
    const cases: [string, string, string][] = [
      ["非法 contentType", structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")], cards: [cardOf("k1", "猜测", [itemOf({ contentType: "speculation", evidenceLocalIds: ["e1"] })])] }), "contentType"],
      ["localId 重复", structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s"), evOf("e1", "chunk_0", "25 °C")], cards: [cardOf("k1", "重复", [okItem])] }), "localId 重复"],
      ["悬空 context 引用", structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")], cards: [cardOf("k1", "悬空", [itemOf({ contextLocalIds: ["cX"], evidenceLocalIds: ["e1"] })])] }), "悬空引用"],
      ["一批两卡、第二卡非法 → 两卡都不入库", structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")], cards: [cardOf("k1", "合法", [okItem]), cardOf("k2", "非法 nature", [itemOf({ nature: "fact", evidenceLocalIds: ["e1"] })])] }), "nature"],
      ["模型伪造 audit 生命周期", JSON.stringify({ schemaVersion: 1, cards: [{ localId: "k1", summary: "伪造", audit: "confirm", items: [itemOf({})] }] }), "audit"],
      ["关系引用本批之外的库内 ID", structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")], cards: [cardOf("k1", "臆造关系", [okItem])], relations: [{ fromLocalId: "ki_库内不存在", toLocalId: "k1", relationType: "supports", basis: "臆造", evidenceLocalIds: ["e1"] }] }), "不接受臆造库内 ID"],
      ["关系端点指向多项卡（歧义，不挑第一个）", structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")], cards: [cardOf("k1", "两项卡", [okItem, itemOf({ text: "另一项", evidenceLocalIds: ["e1"] })])], relations: [{ fromLocalId: "k1", toLocalId: "e1", relationType: "supports", basis: "歧义端点", evidenceLocalIds: ["e1"] }] }), "指向不明确"],
    ];
    for (const [what, content, hint] of cases) {
      current = () => content;
      const before = counts(await st(get));
      const r = await post("/api/knowledge/jobs", { paperId, attachmentIds: attIds, purpose: "比较响应时间", idempotencyKey: `k-t12-${what}` });
      assert.equal(r.status, 202, `${what}：${JSON.stringify(r.body)}`);
      const runId = r.body.runId as string;
      const job = await waitJobEnd(get, r.body.jobId as string);
      assert.equal(job.status, "done", `${what}：任务要正常结束，不能挂住`);
      const view = await runOf(get, runId);
      assert.equal(chunksOf(view)[0].status === "failed", true, `${what} 应整块拒收`);
      const why = String(chunksOf(view)[0].error ?? "");
      assert.ok(why.includes("整块拒收"), `${what} 理由须说明整块拒收：${why}`);
      assert.ok(why.includes(hint), `${what} 理由须指出问题（${hint}）：${why}`);
      assert.deepEqual(counts(await st(get)), before, `${what}：不返回半套可用知识（对象数不变）`);
      assert.equal((job.result as { created?: number }).created, 0);
      assert.equal(view.run.status, "failed");
      assert.equal(((job.result as { chunkErrors?: unknown[] }).chunkErrors ?? []).length, 1, "失败块可逐块重试");
      assert.equal(chunksOf(view)[0].receipt, undefined, "拒收块不留 receipt");
    }
    // 全部拒收之后，同一附件的合法批次仍能正常入库：拒收没有把 run/来源写坏
    current = () => structJson({
      evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")],
      contexts: [ctxOf("c1", { evidenceLocalIds: ["e1"] })],
      cards: [cardOf("k1", "合法", [okItem])],
      relations: [{ fromLocalId: "k1", toLocalId: "c1", relationType: "belongs_to", basis: "同一研究对象", evidenceLocalIds: ["e1"] }],
    });
    const okRun = await post("/api/knowledge/jobs", { paperId, attachmentIds: attIds, purpose: "比较响应时间", idempotencyKey: "k-t12-ok" });
    assert.equal(okRun.status, 202);
    await waitJobEnd(get, okRun.body.jobId as string);
    const s = await st(get);
    assert.equal(s.cards.length, 1, "此前各块全部拒收后，合法批次仍能入库");
    assert.equal(s.knowledge.items.length, 1);
    assert.equal(s.knowledge.relations.length, 1, "合法的关系（只引用本批 localId）应被接受");
  } finally {
    ai.restore();
    await close();
  }
});

test("T24 暂停/继续/取消/重启：成功块保留，未提交块丢弃，计数与回执不重复", async () => {
  const store = new MemoryStore();
  const first = await boot(store);
  const g = stubStructGated();
  let second: Awaited<ReturnType<typeof boot>> | null = null;
  const batch = (blockId: string, quote: string, text: string) => structJson({
    evidence: [evOf("e1", blockId, quote)],
    cards: [cardOf("k1", text, [itemOf({ text, predicate: { raw: "响应时间" }, evidenceLocalIds: ["e1"] })])],
  });
  try {
    const { paperId, attachments } = await mkPaper(first.post, "论文甲", [
      { name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。" },
      { name: "a2.md", text: "碳纳米管电极在30 °C下响应时间1.4 s。" },
    ]);
    const attIds = attachments.map((a) => a.attachmentId);
    const { post, get } = first;

    // ① 暂停：在途块完成后停止，成功块保留，未开始块不动
    const r1 = await post("/api/knowledge/jobs", { paperId, attachmentIds: attIds, purpose: "比较响应时间", idempotencyKey: "k-t24-a" });
    assert.equal(r1.status, 202);
    const runIdA = r1.body.runId as string, jobA = r1.body.jobId as string;
    await waitFor(() => g.count >= 1, "chunk_0 已请求模型");
    const pause = await post(`/api/knowledge/jobs/${jobA}/pause`, {});
    assert.equal(pause.status, 200);
    assert.equal(pause.body.pending, true, "在途块不截断：先完成再停");
    g.respond(0, batch("chunk_0", "响应时间0.8 s", "响应时间0.8 s"));
    const j1 = await waitJobEnd(get, jobA);
    assert.equal(j1.status, "paused");
    let s = await st(get);
    assert.equal(s.knowledge.extractionRuns.find((x) => x.id === runIdA)!.status, "paused");
    assert.equal(g.count, 1, "暂停后不再请求下一块模型");
    let run = s.knowledge.extractionRuns.find((x) => x.id === runIdA)!;
    assert.equal(run.chunks[0].status, "committed", "成功块保留");
    assert.equal(run.chunks[1].status, "pending", "未开始块保持 pending");
    assert.equal(s.cards.length, 1);

    // ② 继续：复用同一 run，已成功块不重调模型
    const resume = await post(`/api/knowledge/jobs/${jobA}/resume`, { runId: runIdA });
    assert.equal(resume.status, 200, JSON.stringify(resume.body));
    await waitFor(() => g.count >= 2, "chunk_1 已请求模型");
    assert.equal(g.call(1).blockId, "chunk_1", "继续只跑未完成块");
    g.respond(1, batch("chunk_1", "响应时间1.4 s", "响应时间1.4 s"));
    await waitJobEnd(get, resume.body.jobId as string);
    s = await st(get);
    run = s.knowledge.extractionRuns.find((x) => x.id === runIdA)!;
    assert.equal(run.status, "completed");
    assert.equal(s.cards.length, 2);
    assert.equal(g.count, 2, "暂停/继续全程共 2 次模型调用，无重复");

    // ③ 取消：在途响应作废，未提交块丢弃，已出内容保留
    const r2 = await post("/api/knowledge/jobs", { paperId, attachmentIds: attIds, purpose: "换一个问题", idempotencyKey: "k-t24-b" });
    const runIdB = r2.body.runId as string, jobB = r2.body.jobId as string;
    await waitFor(() => g.count >= 3, "取消场景 chunk_0 已请求模型");
    const cancel = await post(`/api/knowledge/jobs/${jobB}/cancel`, { runId: runIdB });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.runStatus, "cancelled");
    const beforeCancel = counts(await st(get));
    g.respond(2, batch("chunk_0", "响应时间0.8 s", "响应时间0.8 s")); // 在途响应晚于取消
    const j2 = await waitJobEnd(get, jobB);
    s = await st(get);
    run = s.knowledge.extractionRuns.find((x) => x.id === runIdB)!;
    assert.equal(run.status, "cancelled");
    assert.equal(run.chunks[0].status, "discarded", "取消后未提交块丢弃（不落 receipt）");
    assert.equal(run.chunks[0].receipt, undefined);
    assert.deepEqual(counts(s), beforeCancel, "取消后在途结果不写入");
    assert.equal((j2.result as { created?: number }).created, 0);
    assert.equal(j2.status, "done");

    // ④ 重启：内存 job 不假称在跑 → 持久 run 标 interrupted，已成功块保留；按 runId 继续只补未完成块
    const r3 = await post("/api/knowledge/jobs", { paperId, attachmentIds: attIds, purpose: "第三问", idempotencyKey: "k-t24-c" });
    const runIdC = r3.body.runId as string;
    await waitFor(() => g.count >= 4, "重启场景 chunk_0 已请求模型");
    g.respond(3, batch("chunk_0", "响应时间0.8 s", "响应时间0.8 s")); // 第 1 块成功入库
    await waitChunk(get, runIdC, 0, "committed");
    await waitFor(() => g.count >= 5, "重启场景 chunk_1 已请求模型"); // 第 2 块在途，故意不响应
    const cardsBefore = (await st(get)).cards.length;
    second = await boot(store); // 新进程：内存 job 全丢，持久 run 仍是 running
    const after = await runOf(second.get, runIdC);
    assert.equal(after.run.status, "interrupted", "重启后不得假称仍在运行");
    assert.equal(after.jobId, null, "重启后没有内存 job");
    assert.equal(chunksOf(after)[0].status, "committed", "成功块保留");
    assert.ok(chunksOf(after)[0].receipt, "成功块 receipt 保留");
    assert.equal(chunksOf(after)[1].status, "pending", "在途未提交的块回到 pending（不谎称已入库）");
    const resumeC = await second.post(`/api/knowledge/jobs/${runIdC}/resume`, { runId: runIdC });
    assert.equal(resumeC.status, 200, JSON.stringify(resumeC.body));
    await waitFor(() => g.count >= 6, "继续后重新请求模型");
    assert.equal(g.count, 6, "已成功块不重调模型：继续只补 1 块");
    assert.equal(g.call(5).blockId, "chunk_1", "继续只跑未完成块");
    const receiptC0 = chunksOf(after)[0].receipt as { cardIds: string[] };
    g.respond(5, batch("chunk_1", "响应时间1.4 s", "响应时间1.4 s"));
    const j3 = await waitJobEnd(second.get, resumeC.body.jobId as string);
    const s2 = await st(second.get);
    const runC = s2.knowledge.extractionRuns.find((x) => x.id === runIdC)!;
    assert.equal(runC.status, "completed", JSON.stringify(j3));
    assert.equal(runC.chunks.filter((c) => c.receipt).length, 2, "两块各有回执");
    assert.equal(s2.cards.length, cardsBefore + 1, "续跑只补未完成块，不重建已成功块的壳");
    assert.ok(receiptC0.cardIds.every((id) => s2.cards.some((c) => c.id === id)), "重启前落库的壳仍在，receipt 指向未变");
    assert.equal((j3.result as { created?: number }).created, 2, "计数由 receipt 推导：run 级累计 2 张，重启不重复计数");
  } finally {
    await first.close();
    if (second) await second.close();
    g.restore(); // 最后放行仍在途的请求，避免超时定时器拖住测试进程
  }
});

test("E2 守卫：结构化阅读壳在未适配消费者前 fail-closed（422/409），note 与旧卡不受影响", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  const ai = stubStructAi(() => structJson({ evidence: [evOf("e1", "chunk_0", "响应时间0.8 s")], cards: [cardOf("k1", "响应时间0.8 s", [itemOf({ evidenceLocalIds: ["e1"] })])] }));
  try {
    const topic = await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    const topicId = topic.body.topicId as string;
    const { paperId, attachments } = await mkPaper(post, "论文甲", [{ name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。" }], [topicId]);
    const r = await post("/api/knowledge/jobs", { paperId, attachmentIds: attachments.map((a) => a.attachmentId), purpose: "比较响应时间", topicId, idempotencyKey: "k-guard" });
    assert.equal(r.status, 202);
    await waitJobEnd(get, r.body.jobId as string);
    const s = await st(get);
    const shell = s.cards.find((c) => c.knowledgeItemIds && c.knowledgeItemIds.length > 0)!;
    assert.ok(shell, "提取产出新壳");
    // 语义改写与整卡确认：新壳上拒绝
    const bad = await post(`/api/cards/${shell.id}/review`, { audit: "confirm", reason: "整卡确认" });
    assert.equal(bad.status, 409, JSON.stringify(bad.body));
    assert.equal(bad.body.code, "structured_knowledge_required");
    const bad2 = await post(`/api/cards/${shell.id}/review`, { rawText: "手改概述" });
    assert.equal(bad2.status, 409);
    // 备注/重要度：仍允许（不是科学判断改动）
    const ok = await post(`/api/cards/${shell.id}/review`, { note: "先看分项", importance: "high" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // 未适配消费者：比较入口 422 指向分项
    const cmp = await post("/api/comparisons", { topicId, cardIds: [shell.id] });
    assert.equal(cmp.status, 422);
    assert.equal(cmp.body.code, "structured_knowledge_required");
    // 整壳采用：新壳必须逐项选择（§4.6.8/§4.6.9），未适配入口 422 指向分项
    const sq = await post(`/api/topics/${topicId}/subquestions`, { question: "响应时间是多少", kind: "declared" });
    const adopt = await post("/api/adoptions", { cardId: shell.id, subquestionId: sq.body.subquestionId as string, decision: "adopt", reason: "整卡采用" });
    assert.equal(adopt.status, 422, JSON.stringify(adopt.body));
    assert.equal(adopt.body.code, "structured_knowledge_required");
    // 排除该壳仍允许（清理候选用）
    const exclude = await post("/api/adoptions", { cardId: shell.id, subquestionId: sq.body.subquestionId as string, decision: "exclude", reason: "暂时不相关" });
    assert.equal(exclude.status, 200, JSON.stringify(exclude.body));
    // 分析核心选择：新壳不可直接选入（核心须含数据对象，卡片作为补充核心被拒）
    const imp = await post("/api/import/measurements", { name: "d.csv", csv: "t,v\n0,1", topicId });
    assert.equal(imp.status, 200);
    const tableId = (await st(get)).tables[0].id;
    const task = await post("/api/analysis/tasks", { topicId, title: "分析", core: [{ kind: "table", id: tableId }, { kind: "card", id: shell.id }] });
    assert.equal(task.status, 422, JSON.stringify(task.body));
    assert.equal(task.body.code, "structured_knowledge_required");
    // 上下文地图：新壳只作呈现，不默认勾选、不可选，并给出指向分项审阅的缺口
    const map = (await get(`/api/analysis/map?topicId=${encodeURIComponent(topicId)}`)) as unknown as { nodes: { key: string; role: string; selectable: boolean; gaps: { code: string }[] }[] };
    const shellNode = map.nodes.find((n) => n.key === `card:${shell.id}`);
    assert.ok(shellNode, "地图呈现该壳");
    assert.equal(shellNode!.role, "optional", "新壳不参与默认勾选");
    assert.equal(shellNode!.selectable, false, "新壳在地图里不可选");
    assert.ok(shellNode!.gaps.some((g) => g.code === "structured_knowledge_required"), "缺口指向逐项审阅");
    // 旧卡（无逐项绑定）正常流程仍可走
    const lit = await post("/api/import/literature", { name: "old.md", text: "旧卡原文片段。", mode: "draft", topicId });
    assert.equal(lit.status, 200);
    const oldState = await st(get);
    const oldCard = oldState.cards.find((c) => c.assetId === lit.body.assetId)!;
    const okOld = await post(`/api/cards/${oldCard.id}/review`, { audit: "confirm", reason: "人工核对" });
    assert.equal(okOld.status, 200, JSON.stringify(okOld.body));
    // 旧卡路径不变：确认后仍在地图里默认选入
    const map2 = (await get(`/api/analysis/map?topicId=${encodeURIComponent(topicId)}`)) as unknown as { nodes: { key: string; role: string; selectable: boolean }[] };
    const legacyNode = map2.nodes.find((n) => n.key === `card:${oldCard.id}`);
    assert.equal(legacyNode?.role, "selected", "旧确认卡仍按原路径默认选入");
    assert.equal(legacyNode?.selectable, true);
  } finally {
    ai.restore();
    await close();
  }
});

// ── E3 路由：分项人审在 HTTP 上真实可用（§8.1 items/contexts/evidence + §4.6.9 派生审计）──
test("E3 路由：新壳定位修订→条件审核→分项确认→整壳解锁消费者", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  const ai = stubStructAi(() => structJson({
    evidence: [evOf("e1", "chunk_0", "响应时间0.8 s"), evOf("e2", "chunk_0", "重复测量3次")],
    contexts: [ctxOf("c1", { conditions: [{ field: "温度", value: scalar("25 °C", "25", "°C"), appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceLocalIds: ["e1"] }] })],
    cards: [cardOf("k1", "响应时间0.8 s", [
      itemOf({ localId: "i1", evidenceLocalIds: ["e1"], contextLocalIds: ["c1"] }),
      itemOf({ localId: "i2", text: "重复测量3次取平均", nature: "to_verify", predicate: { raw: "测量次数" }, value: scalar("3次", "3", "次"), evidenceLocalIds: ["e2"] }),
    ])],
  }));
  try {
    const topic = await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    const topicId = topic.body.topicId as string;
    const { paperId, attachments } = await mkPaper(post, "论文甲", [{ name: "a1.md", text: "石墨烯电极在25 °C下响应时间0.8 s。重复测量3次取平均值。" }], [topicId]);
    const imp = await post("/api/import/measurements", { name: "d.csv", csv: "t,v\n0,1", topicId });
    assert.equal(imp.status, 200);
    const job = await post("/api/knowledge/jobs", { paperId, attachmentIds: attachments.map((a) => a.attachmentId), purpose: "比较响应时间", topicId, idempotencyKey: "k-e3-chain" });
    assert.equal(job.status, 202);
    await waitJobEnd(get, job.body.jobId as string);
    const s0 = await st(get);
    const shell = s0.cards.find((c) => (c.knowledgeItemIds ?? []).length === 2)!;
    assert.ok(shell, "提取产出两项的新壳");
    const tableId = s0.tables[0].id;
    const itemIds = shell.knowledgeItemIds!;
    assert.equal(shell.audit, "unreviewed", "全待审 → 派生 unreviewed");

    // §8.1 指定版本读取：revision 必填；E5 起快照读取已实装（不存在的快照 → 404）
    assert.equal((await get(`/api/knowledge/items/${itemIds[0]}`)).code, "revision_required");
    assert.equal((await get(`/api/knowledge/items/${itemIds[0]}?revision=1&topicId=tp_absent`)).code, "topic_mismatch");
    assert.equal((await get(`/api/knowledge/items/${itemIds[0]}?revision=1&snapshotId=ks_x`)).code, "snapshot_missing");
    const v1 = await get(`/api/knowledge/items/${itemIds[0]}?revision=1&topicId=${encodeURIComponent(topicId)}`);
    assert.equal(v1.revision, 1);
    const payload = v1.payload as { evidenceRefs: { ref: { id: string } }[]; contextRefs: { id: string }[] };
    const evId = payload.evidenceRefs[0].ref.id;
    const ctxId = payload.contextRefs[0].id;
    assert.deepEqual(v1.availableRevisions, [1]);

    // 定位修订不接受伪造引文；未审条件挡住分项确认
    const fake = await post(`/api/knowledge/evidence/${evId}/resolve`, { baseRevision: 1, quote: "响应时间1.5 s" });
    assert.equal(fake.status, 422, JSON.stringify(fake.body));
    assert.equal(fake.body.code, "quote_mismatch");
    const forge = await post(`/api/knowledge/items/${itemIds[0]}/update`, { baseRevision: 1, patch: { review: { status: "confirmed" } } });
    assert.equal(forge.status, 422);
    assert.equal(forge.body.code, "lifecycle_field_forbidden");
    const early = await post(`/api/knowledge/items/${itemIds[0]}/review`, { baseRevision: 1, decision: "confirmed", basis: "先看值" });
    assert.equal(early.status, 422);
    assert.equal(early.body.code, "context_pending");

    // 条件审核 → 新版；再确认分项（生成第 2 版）
    const ctxReview = await post(`/api/knowledge/contexts/${ctxId}/review`, { baseRevision: 1, decision: "confirmed", basis: "温度按原文第一句" });
    assert.equal(ctxReview.status, 200, JSON.stringify(ctxReview.body));
    assert.equal(ctxReview.body.review, "confirmed");
    assert.deepEqual(ctxReview.body.pendingConditions, []);
    const stale = await post(`/api/knowledge/items/${itemIds[0]}/update`, { baseRevision: 99, patch: { scopeText: "只看该电极" } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "stale_revision");

    const r1 = await post(`/api/knowledge/items/${itemIds[0]}/review`, { baseRevision: 1, decision: "confirmed", basis: "逐字核对第一句" });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.revision, 2);
    assert.equal(r1.body.review, "confirmed");
    assert.equal(r1.body.cardAudit, "need_info", "一确认一待审 → 不给整卡确认");

    // 中间态：整壳仍不可选入，分项可（固定版本）
    const wholeBlocked = await post("/api/analysis/tasks", { topicId, title: "分析甲", core: [{ kind: "table", id: tableId }, { kind: "card", id: shell.id }] });
    assert.equal(wholeBlocked.status, 422);
    assert.equal(wholeBlocked.body.code, "structured_knowledge_required");
    const itemTask = await post("/api/analysis/tasks", { topicId, title: "分析乙", core: [{ kind: "table", id: tableId }, { kind: "item", id: itemIds[0], revision: 2 }] });
    assert.equal(itemTask.status, 200, JSON.stringify(itemTask.body));
    const pendingItem = await post("/api/analysis/tasks", { topicId, title: "分析丙", core: [{ kind: "table", id: tableId }, { kind: "item", id: itemIds[1], revision: 1 }] });
    assert.equal(pendingItem.status, 422);
    assert.equal(pendingItem.body.code, "item_not_confirmed");
    const map1 = (await get(`/api/analysis/map?topicId=${encodeURIComponent(topicId)}`)) as unknown as { nodes: { key: string; selectable: boolean }[] };
    assert.equal(map1.nodes.find((n) => n.key === `card:${shell.id}`)!.selectable, false, "部分项未审 → 整壳不可选");

    // 全部确认 → 派生 confirm，整壳与地图同时解锁（§4.6.9）
    const r2 = await post(`/api/knowledge/items/${itemIds[1]}/review`, { baseRevision: 1, decision: "confirmed", basis: "逐字核对第二句" });
    assert.equal(r2.body.cardAudit, "confirm");
    const wholeTask = await post("/api/analysis/tasks", { topicId, title: "分析丁", core: [{ kind: "table", id: tableId }, { kind: "card", id: shell.id }] });
    assert.equal(wholeTask.status, 200, JSON.stringify(wholeTask.body));
    const map2 = (await get(`/api/analysis/map?topicId=${encodeURIComponent(topicId)}`)) as unknown as { nodes: { key: string; selectable: boolean }[] };
    assert.equal(map2.nodes.find((n) => n.key === `card:${shell.id}`)!.selectable, true, "全部分项确认后整壳可选");
    const s1 = await st(get);
    assert.equal(s1.cards.find((c) => c.id === shell.id)!.audit, "confirm", "审计由分项派生并落库");
    assert.equal((await get(`/api/knowledge/items/${itemIds[0]}?revision=1`)).revision, 1, "旧版仍可回查");
  } finally {
    ai.restore();
    await close();
  }
});

// ── E3 路由：旧卡显式结构化 + 主题/新增认识（§4.6.6、§8.1 themes/statements）──
test("E3 路由：旧卡显式结构化后走分项审阅；主题当前认识受确认门槛约束", async () => {
  const { post, get, close } = await boot(new MemoryStore());
  try {
    const topic = await post("/api/topics", { name: "课题甲", researchQuestion: "Q" });
    const topicId = topic.body.topicId as string;
    const lit = await post("/api/import/literature", { name: "old.md", text: "石墨烯电极在25 °C下响应时间0.8 s。重复测量3次取平均值。", mode: "draft", topicId });
    assert.equal(lit.status, 200);
    const s0 = await st(get);
    const legacy = s0.cards.find((c) => c.assetId === lit.body.assetId)!;
    assert.ok(legacy, "旧卡存在");

    const structure = await post(`/api/knowledge/cards/${legacy.id}/structure`, {
      baseRevision: legacy.revision,
      evidence: [{ localId: "e1", quote: "响应时间0.8 s" }],
      contexts: [{ localId: "c1", subject: "石墨烯电极", stage: "测试", topicIds: [topicId], conditions: [
        { field: { raw: "温度" }, value: scalar("25 °C", "25", "°C"), appliesTo: { subject: "石墨烯电极", stage: "测试" }, obtainedBy: "source_explicit" },
      ] }],
      items: [{ localId: "i1", contentType: "observation", nature: "observation", text: "25 °C下响应时间0.8 s", topicIds: [topicId], value: scalar("0.8 s", "0.8", "s"), contextRefs: [{ kind: "context", localId: "c1" }], evidenceRefs: [{ localId: "e1", fieldPaths: ["quote"] }] }],
    });
    assert.equal(structure.status, 200, JSON.stringify(structure.body));
    const itemIds = structure.body.itemIds as string[];
    assert.equal(structure.body.audit, "unreviewed", "壳审计由分项派生");
    const s1 = await st(get);
    const ctxId = s1.knowledge.contexts[0].id;
    const condId = s1.knowledge.contexts[0].payload.conditions[0].id;
    assert.equal(s1.knowledge.contexts[0].payload.review.status, "pending", "新结构一律待审");
    assert.equal(s1.knowledge.evidence[0].payload.locationStatus, "matched", "引文由服务端逐字核对");

    const again = await post(`/api/knowledge/cards/${legacy.id}/structure`, { baseRevision: (await st(get)).cards.find((c) => c.id === legacy.id)!.revision, items: [{ text: "重复结构化" }] });
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.code, "already_structured");
    const dbl = await post(`/api/cards/${legacy.id}/review`, { extracted: { fields: { 响应时间: "0.9 s" } }, reason: "改草稿" });
    assert.equal(dbl.status, 409, "结构化后不再双编辑旧 fields：" + JSON.stringify(dbl.body));

    const blocked = await post(`/api/knowledge/items/${itemIds[0]}/review`, { baseRevision: 1, decision: "confirmed", basis: "先确认项" });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.code, "context_pending");

    // 条件更改 → 整体待审（本例无条件已确认，affectedItems 为空）
    const ctxUpd = await post(`/api/knowledge/contexts/${ctxId}/update`, {
      baseRevision: 1,
      patch: { conditions: [{ id: condId, field: { raw: "温度" }, value: scalar("30 °C", "30", "°C"), appliesTo: { subject: "石墨烯电极", stage: "测试" }, obtainedBy: "human_record" }] },
    });
    assert.equal(ctxUpd.status, 200, JSON.stringify(ctxUpd.body));
    assert.equal(ctxUpd.body.review, "pending");
    assert.deepEqual(ctxUpd.body.affectedItems, []);

    // 新增认识：AI 建议只作候选，人工陈述也须经 review 才算确认
    const suggestion = await post("/api/knowledge/statements", { topicId, text: "响应时间随温度升高而下降", nature: "hypothesis", createdBy: "model" });
    assert.equal(suggestion.status, 200, JSON.stringify(suggestion.body));
    assert.equal(suggestion.body.review, "pending");
    assert.equal(suggestion.body.nature, "hypothesis");

    const themePending = await post("/api/knowledge/themes", { topicId, name: "响应动力学", members: [{ kind: "item", id: itemIds[0], revision: 1 }, { kind: "item", id: suggestion.body.id as string, revision: 1 }] });
    assert.equal(themePending.status, 200, JSON.stringify(themePending.body));
    const badJudge = await post(`/api/knowledge/themes/${themePending.body.id as string}/update`, { baseRevision: 1, patch: { currentJudgmentRefs: [{ kind: "item", id: itemIds[0], revision: 1 }] } });
    assert.equal(badJudge.status, 422);
    assert.equal(badJudge.body.code, "judgment_not_confirmed");

    const ctxReview = await post(`/api/knowledge/contexts/${ctxId}/review`, { baseRevision: 2, decision: "confirmed", basis: "温度按批次记录" });
    assert.equal(ctxReview.status, 200, JSON.stringify(ctxReview.body));
    const confirm = await post(`/api/knowledge/items/${itemIds[0]}/review`, { baseRevision: 1, decision: "confirmed", basis: "逐字核对" });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    const judge = await post(`/api/knowledge/themes/${themePending.body.id as string}/update`, { baseRevision: 1, patch: { currentJudgmentRefs: [{ kind: "item", id: itemIds[0], revision: confirm.body.revision as number }] } });
    assert.equal(judge.status, 200, JSON.stringify(judge.body));
    assert.equal(judge.body.currentJudgmentRefs, 1);
    const topicB = await post("/api/topics", { name: "课题乙", researchQuestion: "Q2" });
    const cross = await post("/api/knowledge/themes", { topicId: topicB.body.topicId as string, name: "对照", members: [{ kind: "item", id: itemIds[0], revision: confirm.body.revision as number }] });
    assert.equal(cross.status, 422, JSON.stringify(cross.body));
    assert.equal(cross.body.code, "cross_topic_confirmation_required");
  } finally {
    await close();
  }
});

// ── E4 路由（§7.1/§8.1）：统一读取只读＋viewId 过期 409、比较决策往返 ──
test("E4 路由：/api/knowledge/view 作用域校验与比较 409 view_stale 往返", async () => {
  const store = new GatedStore();
  const { post, get, close } = await boot(store);
  try {
    const noTopic = await get("/api/knowledge/view?source=current");
    assert.equal(noTopic.code, "topic_required", "current 读取必须带 topicId");

    const topic = await post("/api/topics", { name: "合成课题甲", researchQuestion: "Q" });
    const topicId = topic.body.topicId as string;
    const view = await get(`/api/knowledge/view?source=current&topicId=${topicId}`);
    assert.equal(view.ok, true);
    assert.equal(typeof view.viewId, "string");
    assert.deepEqual(view.items, []);
    assert.equal((view.coverage as { totalAvailable: number }).totalAvailable, 0);

    const stale = await post("/api/knowledge/comparisons", {
      topicId, viewId: "bogus-view", question: "过期视图", metricId: null,
      inputRefs: [{ type: "item", ref: { kind: "item", id: "ki_missing", revision: 1 } }],
      varyingFields: [], requiredEqualFields: [], operation: "display",
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, "view_stale");

    const ok = await post("/api/knowledge/comparisons", {
      topicId, viewId: view.viewId as string, question: "取消选择的项应被阻断", metricId: null,
      inputRefs: [{ type: "item", ref: { kind: "item", id: "ki_missing", revision: 1 } }],
      varyingFields: [], requiredEqualFields: [], operation: "display",
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.decision, "blocked", "读不到固定版本的操作数不给结论");
    assert.ok((ok.body.reasonCodes as string[]).includes("source_unresolvable"));
    assert.equal(ok.body.computedValue, null);
  } finally {
    await close();
  }
});
/** E5 种子：用服务函数构建真实 state（sourceRef/hash 一律按服务端口径生成）。 */
function seedKnowledgeState() {
  const t = createTopic(emptyState(), { name: "合成课题甲", researchQuestion: "Q" });
  const topicId = t.topic.id;
  let s: LocusState = t.state;
  const asset = makeAsset("literature", "exp.md", "合成对象A在 1 d 与 24 h 下培养。", topicId);
  s = { ...s, assets: [...s.assets, asset] };
  const srcRef = currentSourceRef(s, "asset", asset.id)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, srcRef, sourcePayload(s, "asset", asset.id)) };
  s = importMeasurements(s, { name: "t.csv", csv: "时间,批注\n24,第一轮\n24,重复\n48,延长\n", topicId }).state;
  const tableId = s.tables[0].id;
  const tableRef = currentSourceRef(s, "table", tableId)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, tableRef, sourcePayload(s, "table", tableId)) };
  const ds = createKnowledgeDataset(s, {
    topicId, sourceRef: tableRef, selection: { rowIndices: [0, 1, 2], columnIndices: [0] },
    columns: [{ index: 0, originalName: "时间", standardId: "m", type: "scalar", unit: "h" }],
    rowBindings: [{ rowIndex: 0 }, { rowIndex: 1 }, { rowIndex: 2 }],
  });
  s = reviewKnowledgeDataset(ds.state, ds.dataset.id, { baseRevision: 1, columnIndices: [0], decision: "confirmed", basis: "核对列含义" }).state;
  const datasetRevision = s.knowledge.datasets.find((d) => d.id === ds.dataset.id)!.revision;
  return { state: s, topicId, datasetId: ds.dataset.id, datasetRevision, tableRef, srcRef };
}

// ── T35：首次 freeze 保存失败 → 不返回 ready，旧快照仍可读（§7.3）──────────
test("T35 冻结保存失败不返回 ready；旧快照仍可读且内容不变", async () => {
  const seed = seedKnowledgeState();
  const store = new GatedStore();
  await store.seed(seed.state);
  const { post, get, close } = await boot(store);
  try {
    const view = await get(`/api/knowledge/view?source=current&topicId=${seed.topicId}`);

    store.failNext = true;
    const failed = await post("/api/knowledge/snapshots", { topicId: seed.topicId, viewId: view.viewId as string });
    assert.equal(failed.status, 500, JSON.stringify(failed.body));
    assert.notEqual(failed.body.dataReady, true, "保存失败不得返回 ready");
    const afterFail = await get("/api/state");
    assert.equal((afterFail.knowledge as { snapshots: unknown[] }).snapshots.length, 0, "失败不发布任何快照");

    const ok = await post("/api/knowledge/snapshots", { topicId: seed.topicId, viewId: view.viewId as string });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const snapId = ok.body.snapshotId as string;
    const read1 = await get(`/api/knowledge/snapshots/${snapId}`);
    assert.equal((read1.snapshot as { contentHash: string }).contentHash, ok.body.contentHash, "冻结返回 hash 与读取一致");

    const view2 = await get(`/api/knowledge/view?source=current&topicId=${seed.topicId}`);
    store.failNext = true;
    const failed2 = await post("/api/knowledge/snapshots", { topicId: seed.topicId, viewId: view2.viewId as string });
    assert.equal(failed2.status, 500);
    const read2 = await get(`/api/knowledge/snapshots/${snapId}`);
    assert.equal((read2.snapshot as { contentHash: string }).contentHash, ok.body.contentHash, "旧快照内容不变、仍可读");
  } finally {
    await close();
  }
});

// ── E5 路由往返：导出（json/csv/zip）、token 引用、§7.5 先验许可 ────────────
test("E5 路由：快照导出与 token 引用按 §7.5 先验许可", async () => {
  const seed = seedKnowledgeState();
  const store = new GatedStore();
  await store.seed(seed.state);
  const { post, get, raw, close } = await boot(store);
  try {
    const view = await get(`/api/knowledge/view?source=current&topicId=${seed.topicId}`);
    const ok = await post("/api/knowledge/snapshots", { topicId: seed.topicId, viewId: view.viewId as string });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const snapId = ok.body.snapshotId as string;
    const snapRead = await get(`/api/knowledge/snapshots/${snapId}`);
    const content = (snapRead.snapshot as { content: { datasetRows: { datasetRef: { id: string; revision: number } }[]; referenceMap: Record<string, unknown> } }).content;
    assert.equal(content.datasetRows.length, 1, "快照含数据集实际行列");
    assert.equal(content.datasetRows[0].rows.length, 3, "3 行均在快照内");

    const before = await raw(`/api/knowledge/snapshots/${snapId}/export?format=json`);
    assert.equal(before.status, 403, "默认不允许导出（本机所有者模式 export 默认关闭）");
    assert.equal(((await before.json()) as { code?: string }).code, "source_access_denied");

    for (const r of (snapRead.snapshot as { sourceVersionRefs: { kind: string; id: string }[] }).sourceVersionRefs) {
      const pol = await post("/api/knowledge/source-policies", { sourceKind: r.kind, sourceId: r.id, allowLocalRead: true, allowExport: true, allowAiSend: false, reason: "本次带出" });
      assert.equal(pol.status, 200, JSON.stringify(pol.body));
    }
    const jsonRes = await raw(`/api/knowledge/snapshots/${snapId}/export?format=json`);
    assert.equal(jsonRes.status, 200);
    assert.ok((await jsonRes.text()).includes("contentHash"), "JSON 导出含快照事实");
    const csvRes = await raw(`/api/knowledge/snapshots/${snapId}/export?format=csv&datasetId=${seed.datasetId}`);
    assert.equal(csvRes.status, 200);
    assert.ok((await csvRes.text()).startsWith("operand_type,"), "CSV 导出列固定");
    const zipRes = await raw(`/api/knowledge/snapshots/${snapId}/export?format=zip`);
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(zipRes.status, 200);
    assert.equal(zipBuf.subarray(0, 2).toString("latin1"), "PK", "ZIP 导出为合法压缩包");
    const csvBoth = await raw(`/api/knowledge/snapshots/${snapId}/export?format=csv`);
    assert.equal(csvBoth.status, 422, "CSV 必须指定 datasetId 或 comparisonId");

    const tok = Object.keys(content.referenceMap)[0];
    const ref = await get(`/api/knowledge/references/${tok}?snapshotId=${snapId}`);
    assert.ok(ref.ok, "token 可解析");
    const noSnap = await get(`/api/knowledge/references/${tok}`);
    assert.equal((noSnap as { code?: string }).code, "snapshot_required");
  } finally {
    await close();
  }
});
// ══ E7-A 内置 AI 统一输入与引用校验（合同 §10 E7；判据 T41–T45）═════════════

/** E7 种子：课题 + 一张表（数据核心）+ 一项已确认 + 一项待审（同一来源）。 */
function seedAiInput() {
  const t = createTopic(emptyState(), { name: "合成课题甲", researchQuestion: "培养时间" });
  const topicId = t.topic.id;
  let s: LocusState = t.state;
  const asset = makeAsset("literature", "p.md", "合成对象A在 1 d 与 24 h 下培养。", topicId);
  s = { ...s, assets: [...s.assets, asset] };
  const ref = currentSourceRef(s, "asset", asset.id)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, ref, sourcePayload(s, "asset", asset.id)) };
  s = importMeasurements(s, { name: "t.csv", csv: "时间,批注\n24,a\n48,b\n", topicId }).state;
  const mk = (id: string, text: string, status: string) => ({
    id, revision: 1, createdAt: "t", updatedAt: "t", history: [],
    payload: {
      contentType: "observation", nature: "observation", text, subject: { raw: "合成对象A" }, predicate: { raw: "培养时间", metricId: "time_germ" },
      value: { kind: "scalar", raw: "1 d", value: "1", unit: "d" }, contextRefs: [], evidenceRefs: [], sourceRefs: [ref],
      origin: { sourceClass: "literature_report", createdBy: "model", secondaryCitation: false },
      scopeText: "", unknowns: [], topicIds: [topicId], subquestionIds: [], review: { status },
    },
  });
  s = { ...s, knowledge: { ...s.knowledge, items: [...s.knowledge.items, mk("ki_ok", "合成对象A在 1 d 下培养", "confirmed") as never, mk("ki_pending", "合成对象A在 24 h 下培养（待核）", "pending") as never] } };
  return { state: s, topicId, tableId: s.tables[0].id, srcRef: ref };
}

test("T41 内置正式AI选择新项+数据核心：仅选中且已确认内容进入核心，actualPayload 可复查", () => {
  const f = seedAiInput();
  // 既有 AnalysisTask 仍要求数据核心（表格）：不因知识输入放开该约束
  const task = createAnalysisTask(f.state, { topicId: f.topicId, title: "分析", core: [{ kind: "table", id: f.tableId }, { kind: "item", id: "ki_ok", revision: 1 }] });
  assert.equal(task.task.core.length, 2, "表格（数据核心）+ 已确认项可同选");

  const input = buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }], purpose: "比较培养时间" });
  assert.equal(input.core.length, 1, "核心只含选中的已确认项");
  assert.equal(input.scope.mode, "formal");
  assert.ok(input.actualPayload.includes("研究目的：比较培养时间"));
  assert.ok(input.actualPayload.includes("合成对象A在 1 d 下培养"), "actualPayload 含实际发送内容（可复查）");
  assert.equal(input.requiresShrink, false);
  // 同一输入 → 同一 snapshotHash；换选择 → 变化
  const again = buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }], purpose: "比较培养时间" });
  assert.equal(again.snapshotHash, input.snapshotHash, "同输入冻结同一快照 hash");
  const changed = buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [], purpose: "比较培养时间" });
  assert.notEqual(changed.snapshotHash, input.snapshotHash, "选择变化 → 快照变化");
  assert.ok(changed.optional.length >= 1, "可选预览来自 readKnowledge，带原因");
});

test("T42 待审探索与正式推荐分别发送：探索有标记，正式守卫仍阻断待审", () => {
  const f = seedAiInput();
  const formalInput = buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_pending", revision: 1 }], purpose: "正式用途" });
  assert.equal(formalInput.core.length, 0, "正式模式不放行待审");
  assert.ok(formalInput.omitted.some((o) => o.reason.includes("未过正式门槛")), "正式阻断给出理由并指向探索模式");

  const exploreInput = buildKnowledgeAiInput(f.state, { topicId: f.topicId, mode: "explore", selectedRefs: [{ kind: "item", id: "ki_pending", revision: 1 }], purpose: "探索用途" });
  assert.equal(exploreInput.core.length, 1);
  assert.equal(exploreInput.core[0].marker, "[待审·pending]", "探索核心带待审标记");
  assert.ok(exploreInput.actualPayload.includes("[待审·pending]"), "标记进入实际 payload");
  assert.equal(exploreInput.scope.mode, "explore");
  assert.ok(exploreInput.notes.some((n) => n.includes("探索模式")));
});

test("T43 模型返回不存在/不属快照的引用：标invalid，不能自动写入 confirmed 报告/知识", () => {
  const f = seedAiInput();
  const input = buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }], purpose: "P" });
  const checks = validateAiReferences(input, [
    { kind: "item", id: "ki_ok", revision: 1 },
    { kind: "item", id: "ki_missing", revision: 1 },
    { kind: "item", id: "ki_pending", revision: 1 },
    { kind: "item", id: "ki_ok" },
  ]);
  assert.deepEqual(checks.map((c) => c.status), ["valid", "invalid", "invalid", "invalid"]);
  assert.ok(checks[1].reason.includes("not_in_snapshot"));
  assert.ok(checks[3].reason.includes("固定版本"));

  const bad = (() => { try { adoptAiProposal(f.state, { topicId: f.topicId, aiInput: input, text: "AI 建议", nature: "hypothesis", evidenceRefs: [{ kind: "item", id: "ki_missing", revision: 1 }] }); return null; } catch (e) { return e as { status: number; details?: { code?: string } }; } })();
  assert.ok(bad, "含无效引用的采纳必须被拒");
  assert.equal(bad!.status, 422);
  assert.equal(bad!.details?.code, "ai_reference_invalid");

  const ok = adoptAiProposal(f.state, { topicId: f.topicId, aiInput: input, text: "培养时间可能受温度影响", nature: "hypothesis" });
  assert.equal(ok.review, "pending", "采纳只落待审候选，不自动转 confirmed");
});

test("T44 模型上下文超预算：显式要求缩小/分页，不默默截断条件", () => {
  const f = seedAiInput();
  const tight = buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }], purpose: "P", budgetBytes: 40 });
  assert.equal(tight.requiresShrink, true, "超预算显式标记要求缩小/分页");
  assert.equal(tight.truncated.length, 0, "不做静默截断");
  assert.ok(tight.notes.some((n) => n.includes("未做静默截断")));
  assert.equal(tight.actualPayload, buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }], purpose: "P" }).actualPayload, "payload 未被裁剪");
  const roomy = buildKnowledgeAiInput(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }], purpose: "P", budgetBytes: 100000 });
  assert.equal(roomy.requiresShrink, false);
});

test("T45 相同输入给内置与外部文件：科学字段/引用相同，包装差异明确", () => {
  const f = seedAiInput();
  const req = { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }], purpose: "P" } as const;
  const input = buildKnowledgeAiInput(f.state, req);
  const ext = input.externalFile as { wrapper: string; items: { ref: { id: string; revision: number }; payload: { value: { value: string; unit: string }; subject: { raw: string }; origin: { sourceClass: string } } }[]; snapshotHash: string };
  assert.ok(ext.wrapper.includes("standalone-json"), "外部文件包装明确标注");
  assert.equal(ext.items.length, input.core.length, "条目数与内置一致");
  assert.equal(ext.items[0].ref.id, "ki_ok");
  assert.equal(ext.items[0].ref.revision, 1, "固定版本一致");
  assert.equal(ext.items[0].payload.value.value, "1");
  assert.equal(ext.items[0].payload.value.unit, "d", "科学字段（值/单位）一致");
  assert.equal(ext.items[0].payload.subject.raw, "合成对象A");
  assert.equal(ext.items[0].payload.origin.sourceClass, "literature_report");
  assert.equal(ext.snapshotHash, input.snapshotHash, "同一输入共享快照 hash");
  assert.ok(input.notes.length >= 0);
});

test("E7-A 手动下载选定包：冻结选定范围并导出 ZIP（复用 E5，不另造导出）", () => {
  const f = seedAiInput();
  const out = exportSelectedPackage(f.state, { topicId: f.topicId, selectedRefs: [{ kind: "item", id: "ki_ok", revision: 1 }] });
  assert.ok(out.filename.endsWith(".zip"));
  assert.equal(out.buffer.subarray(0, 2).toString("latin1"), "PK");
});
