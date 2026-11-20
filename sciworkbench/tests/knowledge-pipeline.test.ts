/**
 * E1 提交边界合同测试（§5.1 / §11）：T04/T05/T22/T23。
 * 用可控延迟/可失败的 Store 驱动真实 HTTP 路由，证明：
 * 保存成功才可读；写提交串行且基于最新；失败不发布；后台合并不丢用户改动。
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { MemoryStore, type LocusState, type Store } from "../store.ts";
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
  return { post, get, close };
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