/**
 * 阶段6 6B：独立探索性验收（真实路由，隔离实例）——
 * 正常链路 / 重复（幂等·409）/ 中途离开（持久化·重启）/ 并发（守卫）/ 失败恢复（重试·取消丢弃）；
 * 覆盖 T19–T25 路由并回归阶段5 链路；用内部「达尔文种子浸盐水」包数据（不入产品样本）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, JsonFileStore } from "../store.ts";
import { clearAiConfig } from "../services/ai.ts";

// 内部测试包数据（逐字取自达尔文 1859 页 371–373；公有领域）
const DARWIN_FLOAT = `item,fresh_float_days,dried_float_days,germinated_after,note,source_page
ripe hazel-nuts,0,90,yes,dried then planted,371
asparagus plant with ripe berries,23,85,yes,seeds afterwards germinated,371
Helosciadium (ripe seeds),2,>90,yes,afterwards germinated,371`;
const DARWIN_TEXT = `种子能否经海水漂流后仍萌发？\n\n干燥 94 种带熟果的茎枝后置于海水；对比新鲜与干燥的漂浮时长。\n\n榛子干后漂浮 90 天后萌发；芦笋 23 天、干后 85 天萌发。\n\n原文自述：海浪中的漂浮时间应短于静水实验，估计或需下修。`;

const REC = { methods: [{ name: "漂浮时长汇总", software: "表格统计", rationale: "有逐物件时长", expectedArtifacts: ["时长分布"], acceptanceItems: ["区分新鲜/干燥", "标注缺量化条件"] }], unknowns: ["盐度未写明", "温度未写明"] };

async function fakeAi(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let content = JSON.stringify(REC);
      if (body.includes("上下文讨论助手")) content = JSON.stringify({ answer: "海浪条件下漂浮时间应短于静水，估计需下修。", sources: ["原文自述"], proposals: [] });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as import("node:net").AddressInfo).port };
}

function client(base: string) {
  const post = async (p: string, b: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: res.status, data: await res.json() as Record<string, any> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<any>;
  const getRaw = async (p: string) => { const r = await fetch(`${base}${p}`); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "" }; };
  const poll = async (jobId: unknown) => { for (let i = 0; i < 120; i++) { const j = await get(`/api/jobs/${jobId}`); if (j.status === "done" || j.status === "error") return j; await new Promise((r) => setTimeout(r, 40)); } return {}; };
  return { post, get, getRaw, poll };
}

test("6B 正常链路：达尔文闭环 → 报告块 → 回查 → 改动命中 → 导出 → 隔离恢复", async () => {
  const { createApp } = await import("../server.ts");
  const ai = await fakeAi();
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const { post, get, getRaw, poll } = client(base);
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    // 1 课题＋子问题（研究问题可空泛）
    const topicId = (await post("/api/topics", { name: "种子海水传播（内部测试）", researchQuestion: "种子能否经海水漂流后仍萌发？" })).data.topicId;
    await post(`/api/topics/${topicId}/subquestions`, { question: "新鲜与干燥的漂浮时长差异？", kind: "declared" });
    // 2 文献（draft 机械草稿）+ 3 数据表
    const lit = await post("/api/import/literature", { name: "darwin-pages.md", text: DARWIN_TEXT, mode: "draft", topicId });
    assert.equal(lit.status, 200);
    const tab = await post("/api/import/measurements", { name: "darwin-flotation.csv", csv: DARWIN_FLOAT, topicId });
    assert.equal(tab.status, 200);
    let st = await get("/api/state");
    const tableId = st.tables[0].id;
    // 4 方案（时长未知不按 0）：干燥组时长未知 → durationMin null
    const protoId = (await post("/api/protocols", { topicId, name: "浸泡设计", purpose: "比较新鲜/干燥", criteria: "记录萌发与否", steps: [
      { id: "s1", op: "干燥茎枝", durationMin: null, estimated: false },
      { id: "s2", op: "浸入海水", durationMin: 90, estimated: true },
    ] })).data.protocolId;
    // 5 执行准备稿：登记「盐度未写明」差异；确认快照
    const execId = (await post("/api/executions", { topicId, protocolId: protoId })).data.executionId;
    await post(`/api/executions/${execId}/preparation`, { adjustments: [{ stepId: "s2", field: "note", after: "海水（盐度未写明）", reason: "原文未量化" }], notes: "盐度/温度缺项" });
    const conf = await post(`/api/executions/${execId}/confirm-preparation`, {});
    assert.equal(conf.status, 200);
    // 样品＋测量
    const sampleId = (await post("/api/samples", { topicId, executionId: execId, shortName: "S1", amount: { value: "100", unit: "seeds" } })).data.sampleId;
    const measId = (await post("/api/measurements", { topicId, sampleId, sampleStateRevision: 1, value: "90", unit: "days", method: "浸盐后种植" })).data.measurementId;
    // 6 分析任务：核心表＋测量；推荐（冻结快照）
    const taskId = (await post("/api/analysis/tasks", { topicId, title: "漂浮时长汇总", core: [{ kind: "table", id: tableId }, { kind: "measurement", id: measId }] })).data.taskId;
    const rec = await post(`/api/analysis/tasks/${taskId}/recommend`, { purpose: "汇总新鲜/干燥漂浮时长并标缺项" });
    assert.equal(rec.status, 202);
    assert.equal((await poll(rec.data.jobId)).status, "done");
    // 7 结果：数据＋参数 → 可复现
    const res1 = await post(`/api/analysis/tasks/${taskId}/result`, { method: "表格统计", adoptedRecommendation: "漂浮时长汇总", params: "按新鲜/干燥分组", attachments: [{ name: "summary.csv", content: "group,mean_days\nfresh,8\ndried,88" }] });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.reproducible, true);
    const resultId = res1.data.resultId;
    // 8 报告：本地草稿 → 入稿（含 AI 草稿块＋人工判断）→ 确认；块级 diff→接受
    const reportId = (await post("/api/reports", { topicId, taskId })).data.reportId;
    const draft = await post(`/api/reports/${reportId}/draft`, {});
    const draftBlocks = draft.data.blocks as { nature: string; text: string; draft: boolean }[];
    const blocks = [
      ...draftBlocks.map((b) => ({ ...b })),
      { nature: "human_judgment", text: "干燥后漂浮更久——与原文一致", refs: [{ kind: "result", id: resultId, version: "rev 1", label: "表格统计" }] },
      { nature: "to_verify", text: "海浪条件下估计需下修（原文自述）" },
    ];
    const pv = await post(`/api/reports/${reportId}/preview`, { blocks });
    assert.equal(pv.status, 200);
    assert.ok((pv.data.diff.added as unknown[]).length >= 2);
    const ap = await post(`/api/reports/${reportId}/apply`, { baseRevision: pv.data.baseRevision, blocks, reason: "首稿" });
    assert.equal(ap.status, 200);
    st = await get("/api/state");
    const rep = st.reports[0];
    const draftBlock = rep.blocks.find((b: any) => b.draft);
    assert.ok(draftBlock, "AI 草稿块应存在且未确认");
    assert.equal((await post(`/api/reports/${reportId}/blocks/${draftBlock.id}/confirm`, { reason: "已核对原文" })).status, 200);
    // 9 回查：由人工判断块回溯到结果与（经网络）文献原件
    const block = rep.blocks.find((b: any) => b.nature === "human_judgment");
    const bt = await get(`/api/backtrace?kind=block&id=${block.id}&dir=both`);
    const kinds = new Set(bt.nodes.map((n: any) => n.kind));
    assert.ok(kinds.has("result") && kinds.has("task") && kinds.has("table") && kinds.has("measurement") && kinds.has("execution") && kinds.has("protocol"));
    assert.ok(kinds.has("report"));
    const rnode = bt.nodes.find((n: any) => n.kind === "result");
    assert.equal(rnode.external, true);
    // 10 改动命中：改测量数值 → 命中报告块；改标题 → 不误报
    const hit = await post("/api/change-hits", { kind: "measurement", id: measId, fields: ["value"] });
    assert.equal(hit.data.category, "needs_review");
    assert.ok((hit.data.byKind.block ?? []).length >= 1);
    const cos = await post("/api/change-hits", { kind: "measurement", id: measId, fields: ["note"] });
    assert.equal(cos.data.category, "no_recompute");
    assert.equal(cos.data.hits.length, 0);
    // 11 导出：Word + 追溯包（zip 魔数；含 manifest）
    const docx = await getRaw(`/api/reports/${reportId}/export.docx`);
    assert.equal(docx.status, 200);
    assert.ok(docx.buf.subarray(0, 2).toString() === "PK");
    const trace = await getRaw(`/api/reports/${reportId}/traceability.zip`);
    assert.equal(trace.status, 200);
    assert.ok(trace.buf.includes(Buffer.from("manifest.json")));
    // 12 整体导出 + 隔离恢复（不覆盖主数据）
    const all = await getRaw("/api/export/all.zip");
    assert.equal(all.status, 200);
    const stateJson = JSON.stringify(await get("/api/state"));
    const restore = await post("/api/restore", { json: stateJson });
    assert.equal(restore.status, 200);
    assert.ok(restore.data.isolatedPath.includes("locus-restore-"));
    assert.equal(restore.data.counts.reports, 1);
    // 损坏 → 明确报错
    const bad = await post("/api/restore", { json: "{ broken" });
    assert.equal(bad.status, 422);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("6B 重复 / 并发 / 失败恢复：幂等拒重、守卫 409、取消丢弃、重试写回", async () => {
  const { createApp } = await import("../server.ts");
  const ai = await fakeAi();
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const { post, get, poll } = client(base);
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const topicId = (await post("/api/topics", { name: "T", researchQuestion: "Q" })).data.topicId;
    const protoId = (await post("/api/protocols", { topicId, name: "P", steps: [{ id: "s1", op: "o", durationMin: 1 }] })).data.protocolId;
    const execId = (await post("/api/executions", { topicId, protocolId: protoId })).data.executionId;
    await post(`/api/executions/${execId}/confirm-preparation`, {});
    // 重复导入同内容 → 409 且给出已有原件
    await post("/api/import/literature", { name: "a.md", text: "same text", mode: "draft", topicId });
    const dup = await post("/api/import/literature", { name: "a2.md", text: "same text", mode: "draft", topicId });
    assert.equal(dup.status, 409);
    assert.ok(dup.data.existingAssetId);
    // 并发推荐：第二次 409
    const taskId = (await post("/api/analysis/tasks", { topicId, title: "x", core: [{ kind: "execution", id: execId }] })).data.taskId;
    const r1 = await post(`/api/analysis/tasks/${taskId}/recommend`, { purpose: "p" });
    const r2 = await post(`/api/analysis/tasks/${taskId}/recommend`, { purpose: "p" });
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 409);
    await poll(r1.data.jobId);
    // 对话取消 → 丢弃不写回；重试 → done
    const cid = (await post("/api/chats", { topicId, scope: [{ kind: "execution", id: execId }] })).data.chatId;
    const send = await post(`/api/chats/${cid}/send`, { text: "海浪条件是否需下修？" });
    assert.equal((await post(`/api/chats/${cid}/messages/${send.data.messageId}/cancel`, {})).status, 200);
    const j = await poll(send.data.jobId);
    assert.equal(j.result.discarded, true);
    let st = await get("/api/state");
    assert.equal(st.chats[0].messages.find((m: any) => m.id === send.data.messageId).status, "cancelled");
    const retry = await post(`/api/chats/${cid}/messages/${send.data.messageId}/retry`, {});
    assert.equal(retry.status, 202);
    assert.equal((await poll(retry.data.jobId)).status, "done");
    st = await get("/api/state");
    assert.equal(st.chats[0].messages.find((m: any) => m.id === send.data.messageId).status, "done");
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("6B 中途离开：JsonFileStore 持久化；重启后恢复（含报告块与历史）", async () => {
  const { createApp } = await import("../server.ts");
  const path = join(tmpdir(), `locus-6b-${Date.now()}.json`);
  let app = await createApp(new JsonFileStore(path));
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  let base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  let c = client(base);
  const topicId = (await c.post("/api/topics", { name: "离开", researchQuestion: "Q" })).data.topicId;
  const reportId = (await c.post("/api/reports", { topicId })).data.reportId;
  await c.post(`/api/reports/${reportId}/apply`, { baseRevision: 1, blocks: [{ nature: "observation", text: "离开前写入的块" }], reason: "离开前" });
  app.close();
  // 重启（新实例读同一文件）
  app = await createApp(new JsonFileStore(path));
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  c = client(base);
  const st = await c.get("/api/state");
  assert.equal(st.reports[0].blocks.length, 1);
  assert.equal(st.reports[0].blocks[0].text, "离开前写入的块");
  assert.equal(st.reports[0].history.length, 1);
  assert.ok(st.version >= 8);
  app.close();
  rmSync(path, { force: true });
});
