import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createDisplayApi, displayConfig } from "../display-api.js";
import { DemoMissingError } from "../../demo/snapshot-adapter.js";

// 用真实 A 快照（locus-site/demo-data）驱动，fetch 换成读文件的假实现。
const ROOT = fileURLToPath(new URL("../../../demo-data/", import.meta.url));
const calls = [];
const fakeFetch = async (url) => {
  calls.push(String(url));
  const rel = String(url).replace(/^\.\.\/demo-data\//, "");
  try {
    const body = readFileSync(resolve(ROOT, rel));
    return { ok: true, status: 200, json: async () => JSON.parse(body.toString("utf8")), text: async () => body.toString("utf8") };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
};

const api = await createDisplayApi({ baseUrl: "../demo-data", fetch: fakeFetch });
const state = await api.getState();

// 可对个别快照文件做替换（验证缺项分支），其余仍读真实 demo-data。
const makeFetch = (overrides = {}) => async (url) => {
  const rel = String(url).replace(/^\.\.\/demo-data\//, "");
  if (Object.prototype.hasOwnProperty.call(overrides, rel)) {
    const v = overrides[rel];
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(v)), text: async () => JSON.stringify(v) };
  }
  try {
    const body = readFileSync(resolve(ROOT, rel));
    return { ok: true, status: 200, json: async () => JSON.parse(body.toString("utf8")), text: async () => body.toString("utf8") };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
};

const STATE_COLLECTIONS = [
  "topics", "subquestions", "assets", "papers", "attachments", "cards", "tables", "adoptions",
  "mappings", "comparisons", "templates", "protocols", "executions", "samples", "measurements",
  "impacts", "ocrs", "analysisTasks", "analysisResults", "reports", "chats",
];

test("getState：返回 app.js 期望的 LocusState 形态（全部顶层集合为数组）", () => {
  for (const k of STATE_COLLECTIONS) assert.ok(Array.isArray(state[k]), `state.${k} 应为数组`);
  assert.ok(state.topics.length >= 1, "至少一个课题");
  assert.ok(Array.isArray(state.knowledge?.items) && state.knowledge.items.length > 0, "knowledge.items 有真实条目");
  assert.equal(state.display.readOnly, true, "只读标记");
  assert.equal(state.display.mode, "display");
  assert.equal(state.display.mainTopicId, state.topics[0].id, "主课题落在 topics 内");
  assert.ok(Object.isFrozen(state), "state 已深冻结（只读）");
});

test("getState：固定主课题来自 manifest.projectId", () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "snapshot/manifest.json"), "utf8"));
  assert.equal(state.display.projectId, manifest.projectId);
  assert.equal(state.display.mainTopicId, manifest.projectId);
});

test("只读隔离：装载与各方法都不请求 /api/", async () => {
  assert.ok(calls.length > 0, "构造时确实读取了静态快照");
  assert.ok(calls.every((u) => u.startsWith("../demo-data/")), `只读静态目录：${calls.join(", ")}`);
  const before = calls.length;
  await api.getState();
  await api.aiStatus();
  await api.getJob("job_x");
  await api.getSource(state.assets[0].id);
  await api.backtrace("card", state.cards[0].id, "both");
  const added = calls.slice(before);
  assert.ok(added.every((u) => !u.includes("/api/")), `方法不应新增 /api/ 请求：${added.join(", ")}`);
});

test("getSource：与在线 sourceView 同形 { asset, points }，锚点可指回真实卡片/表格", async () => {
  const asset = state.assets[0];
  const r = await api.getSource(asset.id);
  assert.equal(r.asset.id, asset.id);
  assert.ok(Array.isArray(r.points));
  for (const p of r.points) {
    assert.ok(["card", "table"].includes(p.kind));
    const pool = p.kind === "card" ? state.cards : state.tables;
    assert.ok(pool.some((x) => x.id === p.id), `定位点 ${p.kind}:${p.id} 在 state 中存在`);
  }
});

test("getSource：未知原件抛缺项（不补造）", async () => {
  await assert.rejects(() => api.getSource("ast_不存在"), (e) => e instanceof DemoMissingError && e.code === "DEMO_MISSING");
});

test("backtrace：补齐 GET /api/backtrace 响应形态，且边不悬空", async () => {
  const cardId = state.cards[0].id;
  const r = await api.backtrace("card", cardId, "both");
  assert.equal(r.ok, true);
  assert.deepEqual(r.start, { kind: "card", id: cardId });
  assert.ok(r.nodes.length > 1, "回查应触达多个节点");
  assert.ok(Array.isArray(r.edges) && r.edges.length > 0);
  assert.ok(r.downstreamByKind && typeof r.downstreamByKind === "object", "含 downstreamByKind");
  assert.ok(Array.isArray(r.pending), "含 pending 数组（analysis.js 消费）");
  const keys = new Set(r.nodes.map((n) => n.key ?? `${n.kind}:${n.id}`));
  for (const e of r.edges) {
    assert.ok(keys.has(e.from), `边起点不悬空：${e.from}`);
    assert.ok(keys.has(e.to), `边终点不悬空：${e.to}`);
  }
  assert.ok(r.nodes.some((n) => n.kind === "asset"), "从卡片可回查到原件");
});

test("backtrace：未知类型抛缺项", async () => {
  await assert.rejects(() => api.backtrace("不存在的类型", "x", "both"), (e) => e instanceof DemoMissingError);
});

test("knowledgeItem：严格按版本返回，引用不悬空", async () => {
  const item = state.knowledge.items[0];
  const r = await api.knowledgeItem(item.id, item.revision);
  assert.equal(r.ok, true);
  assert.equal(r.id, item.id);
  assert.equal(r.revision, item.revision);
  assert.ok(r.payload && typeof r.payload === "object");
  assert.ok(Array.isArray(r.availableRevisions) && r.availableRevisions.includes(item.revision));
  for (const sr of r.payload.sourceRefs ?? []) {
    if (sr.kind === "asset") assert.ok(state.assets.some((a) => a.id === sr.id), `sourceRef 原件 ${sr.id} 存在`);
  }
  const topicId = state.display.mainTopicId;
  assert.ok((r.payload.topicIds ?? []).includes(topicId), "条目归属主课题");
});

test("knowledgeItem：缺版 / 课题不匹配均抛缺项，不退回事后版本", async () => {
  const item = state.knowledge.items[0];
  await assert.rejects(() => api.knowledgeItem(item.id, 9999), (e) => e instanceof DemoMissingError);
  await assert.rejects(() => api.knowledgeItem(item.id, item.revision, "topic_other"), (e) => e instanceof DemoMissingError);
});

test("aiStatus / getJob：固定展示态占位，不触达后端", async () => {
  const s = await api.aiStatus();
  assert.equal(s.configured, false);
  assert.equal(s.model, "预生成");
  const j = await api.getJob("job_any");
  assert.equal(j.id, "job_any");
  assert.equal(j.status, "error", "无后台任务：任何轮询立即停止");
});

test("displayConfig：解析 window.__LOCUS_DISPLAY__ 的对象 / JSON / null", () => {
  assert.equal(displayConfig({}), null);
  assert.deepEqual(displayConfig({ __LOCUS_DISPLAY__: { baseUrl: "/demo-data" } }), { baseUrl: "/demo-data" });
  assert.deepEqual(displayConfig({ __LOCUS_DISPLAY__: '{"topicId":"t1"}' }), { topicId: "t1" });
  assert.equal(displayConfig({ __LOCUS_DISPLAY__: "{坏 json" }), null);
});

// ── 展示增量接口（E4/E5）──

test("contextMap：返回该任务实跑上下文图（nodes/edges），缺任务抛缺项", async () => {
  const taskId = state.analysisTasks[0].id;
  assert.ok(state.demo.contextMaps?.[taskId], "state.demo 仍带 contextMaps（getState 保留 demo 块）");
  const map = await api.contextMap(taskId);
  assert.equal(map.scope.taskId, taskId);
  assert.ok(Array.isArray(map.nodes) && map.nodes.length > 0);
  assert.ok(Array.isArray(map.edges));
  await assert.rejects(() => api.contextMap("atask_不存在"), (e) => e instanceof DemoMissingError && e.code === "DEMO_MISSING");
});

test("zipInfo：返回 {fileName, sha256, url}，url 可被注入配置覆盖", async () => {
  const z = await api.zipInfo();
  assert.equal(z.fileName, "locus-demo-public.zip");
  assert.match(z.sha256, /^[0-9a-f]{64}$/);
  assert.ok(z.url.endsWith("/locus-demo-public.zip"));
  const api2 = await createDisplayApi({ baseUrl: "../demo-data", zipUrl: "/downloads/locus.zip", fetch: fakeFetch });
  assert.equal((await api2.zipInfo()).url, "/downloads/locus.zip", "注入 zipUrl 覆盖快照内置 url");
});

test("suggestions：返回下一步指导（1~2 条，含依据），缺则抛缺项", async () => {
  const list = await api.suggestions();
  assert.ok(list.length >= 1 && list.length <= 2, "只给 1~2 条");
  for (const s of list) {
    assert.ok(s.id && s.title, "有 id 与标题");
    assert.ok(s.basis && typeof s.basis === "object", "带依据（分歧/待补/可区分/不确定）");
  }
  const apiEmpty = await createDisplayApi({
    baseUrl: "../demo-data",
    fetch: makeFetch({ "snapshot/next-steps.json": { note: "无", items: [] } }),
  });
  await assert.rejects(() => apiEmpty.suggestions(), (e) => e instanceof DemoMissingError && e.code === "DEMO_MISSING");
});

// ── 展示增量接口（S10-C：图形 / 90 天链 / 导出）──

test("protocolFigure：返回方案示意图，protocolId 落在 state.protocols，节点非空", async () => {
  const fig = await api.protocolFigure();
  assert.ok(state.protocols.some((p) => p.id === fig.protocolId), "方案图归属真实方案");
  assert.ok(Array.isArray(fig.nodes) && fig.nodes.length > 0, "有步骤节点");
  const ids = new Set(fig.nodes.map((n) => n.id));
  for (const e of fig.edges ?? []) { assert.ok(ids.has(e.from) && ids.has(e.to), "流程边不悬空"); }
});

test("tableChart：返回结果图，tableId 落在 state.tables，行含数值", async () => {
  const ch = await api.tableChart();
  assert.ok(state.tables.some((t) => t.id === ch.tableId), "图表归属真实表");
  assert.ok(Array.isArray(ch.rows) && ch.rows.length > 0, "有数据行");
  assert.ok(ch.rows.some((r) => typeof r.fresh === "number" || typeof r.dried === "number"), "行含数值");
});

test("chain90：报告块→结果→…→原件逐跳可解析，版本齐全", async () => {
  const c = await api.chain90();
  assert.ok(Array.isArray(c.hops) && c.hops.length >= 5, "至少 5 跳");
  const collOf = { block: "reports", result: "analysisResults", measurement: "measurements", table: "tables", execution: "executions", asset: "assets" };
  for (const h of c.hops) {
    const coll = collOf[h.kind];
    assert.ok(coll, `已知 kind：${h.kind}`);
    if (h.kind === "block") {
      assert.ok(state.reports.some((r) => r.id === h.reportId && r.blocks.some((b) => b.id === h.id)), "块在报告内");
    } else {
      assert.ok(state[coll].some((x) => x.id === h.id), `${h.kind}:${h.id} 存在`);
    }
    assert.ok(h.version || h.revision, "每跳标固定版本");
  }
  assert.equal(c.hops[c.hops.length - 1].kind, "asset", "最深一层为原件");
  assert.equal(c.value, "90", "贯通点数值为 90");
});

test("exports：Word 与追溯包指向站内文件，含 sha256", async () => {
  const ex = await api.exports();
  assert.ok(ex.docx.url.endsWith("/snapshot/exports/report.docx"));
  assert.ok(ex.trace.url.endsWith("/snapshot/exports/traceability.zip"));
  for (const f of [ex.docx, ex.trace]) { assert.match(f.sha256, /^[0-9a-f]{64}$/, "sha256 与 manifest 一致"); }
});

test("reloadFigures/reloadChain90：重试时确实重读静态文件（旁路启动缓存）", async () => {
  const before = calls.length;
  await api.reloadFigures();
  await api.reloadChain90();
  const added = calls.slice(before);
  assert.ok(added.some((u) => u.includes("figures.json")) && added.some((u) => u.includes("chain-90d.json")), "重试重新读取对应文件");
  assert.ok(added.every((u) => !u.includes("/api/")), "重试不触达 /api");
});

test("图形缺文件时：启动不阻断，协议图抛缺项（供区域显示失败与重试）", async () => {
  const apiNoFig = await createDisplayApi({ baseUrl: "../demo-data", fetch: makeFetch({ "snapshot/figures.json": null }) });
  assert.equal((await apiNoFig.getState()).topics.length >= 1, true, "工作台仍可启动");
  await assert.rejects(() => apiNoFig.protocolFigure(), (e) => e instanceof DemoMissingError);
});
