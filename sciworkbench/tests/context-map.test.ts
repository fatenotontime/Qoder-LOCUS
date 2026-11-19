/**
 * 上下文地图只读接口（ADR-0027）：推导、角色、边不造假、跨课题、知识卡、确定性/上限、只读、路由 404/422。
 * 服务纯函数 + 真实路由（createApp + MemoryStore）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { MemoryStore, emptyState, type LocusState } from "../store.ts";
import { buildContextMap, deriveCore, parsePicks } from "../services/context-map.ts";
import { buildNetwork } from "../services/references.ts";
import { createApp } from "../server.ts";

const ISO = "2026-11-19T00:00:00.000Z";

function fixture(): LocusState {
  const s = emptyState() as unknown as LocusState & Record<string, unknown[]>;
  (s as any).topics = [
    { id: "tpA", name: "课题A", researchQuestion: "Q", createdAt: ISO },
    { id: "tpB", name: "课题B", researchQuestion: "Q2", createdAt: ISO },
  ];
  (s as any).subquestions = [{ id: "sqA", topicId: "tpA", question: "子问A", kind: "declared", createdAt: ISO }];
  (s as any).assets = [{ id: "as1", kind: "measurement", name: "数据原件", topicId: "tpA", bytes: 1, hash: "h", text: "x", createdAt: ISO }];
  (s as any).tables = [{ id: "tb1", assetId: "as1", name: "数据表1", columns: ["t", "v"], rows: [["0", "1"]], columnMeta: [], note: "", revision: 1, history: [], createdAt: ISO, updatedAt: ISO }];
  (s as any).protocols = [
    { id: "pr1", topicId: "tpA", name: "方案1", sourceKind: "user", revision: 1, revisions: [{ revision: 1, at: ISO, reason: "创建", purpose: "", inputs: [], steps: [], conditions: [], criteria: "", unknowns: [], sourceFragments: [] }], createdAt: ISO, updatedAt: ISO },
    { id: "pr2", topicId: "tpB", name: "方案B", sourceKind: "user", revision: 1, revisions: [{ revision: 1, at: ISO, reason: "创建", purpose: "", inputs: [], steps: [], conditions: [], criteria: "", unknowns: [], sourceFragments: [] }], createdAt: ISO, updatedAt: ISO },
  ];
  (s as any).executions = [{ id: "ex1", topicId: "tpA", protocolId: "pr1", protocolRevision: 1, phase: "recording", status: "done", events: [], createdAt: ISO, updatedAt: ISO }];
  (s as any).samples = [{ id: "sm1", topicId: "tpA", executionId: "ex1", shortName: "S1", displayName: "样品1", origin: "user", states: [], createdAt: ISO }];
  (s as any).measurements = [
    { id: "me1", topicId: "tpA", sampleId: "sm1", sampleStateRevision: 0, time: "0", method: "", instrument: "", value: "1", unit: "u", note: "", revision: 1, history: [], createdAt: ISO },
    { id: "meB", topicId: "tpB", sampleId: "sm1", sampleStateRevision: 0, time: "0", method: "", instrument: "", value: "9", unit: "u", note: "", revision: 1, history: [], createdAt: ISO },
  ];
  (s as any).cards = [
    { id: "c1", assetId: "as1", rawText: "已入候选卡", locator: { sectionQuote: "q" }, extracted: { fields: {}, units: [], conditions: [] }, unknowns: [], secondaryCitation: false, audit: "confirm", importance: null, note: "", reason: "", extraction: "manual", mechanical: false, revision: 1, history: [], createdAt: ISO, updatedAt: ISO },
    { id: "c2", assetId: "as1", rawText: "未审卡", locator: { sectionQuote: "q" }, extracted: { fields: {}, units: [], conditions: [] }, unknowns: [], secondaryCitation: false, audit: "unreviewed", importance: null, note: "", reason: "", extraction: "manual", mechanical: false, revision: 1, history: [], createdAt: ISO, updatedAt: ISO },
  ];
  return s as LocusState;
}

test("推导：选测量 → core 含样品对应的执行与方案；选表 → 仅表", () => {
  const s = fixture();
  const d1 = deriveCore(s, [{ kind: "measurement", id: "me1" }]);
  assert.deepEqual(d1.core, [{ kind: "measurement", id: "me1" }, { kind: "execution", id: "ex1" }, { kind: "protocol", id: "pr1" }]);
  assert.equal(d1.gaps.length, 0);
  const d2 = deriveCore(s, [{ kind: "table", id: "tb1" }]);
  assert.deepEqual(d2.core, [{ kind: "table", id: "tb1" }]);
});

test("推导：缺环记缺口、不报错（测量无样品执行）", () => {
  const s = fixture();
  (s as any).samples = [{ id: "sm2", topicId: "tpA", shortName: "S2", displayName: "样品2", origin: "user", states: [], createdAt: ISO }];
  (s as any).measurements = [{ id: "meX", topicId: "tpA", sampleId: "sm2", sampleStateRevision: 0, time: "0", method: "", instrument: "", value: "1", unit: "u", note: "", revision: 1, history: [], createdAt: ISO }];
  const d = deriveCore(s, [{ kind: "measurement", id: "meX" }]);
  assert.deepEqual(d.core, [{ kind: "measurement", id: "meX" }]);
  assert.equal(d.gaps[0].code, "source_missing");
});

test("推导结果与前端旧逻辑一致（同一实现对照）", () => {
  const s = fixture();
  const picks = [{ kind: "measurement", id: "me1" }];
  // 前端旧逻辑（renderAnalysisForm）：测量→样品→执行→方案，seen 去重。
  const core: { kind: string; id: string }[] = picks.map((p) => ({ ...p }));
  const seen = new Set(core.map((r) => `${r.kind}:${r.id}`));
  for (const d of [...core]) {
    if (d.kind !== "measurement") continue;
    const m = s.measurements.find((x) => x.id === d.id);
    const sm = m && s.samples.find((x) => x.id === m.sampleId);
    if (sm?.executionId && !seen.has(`execution:${sm.executionId}`)) { seen.add(`execution:${sm.executionId}`); core.push({ kind: "execution", id: sm.executionId }); }
    const e = sm?.executionId && s.executions.find((x) => x.id === sm.executionId);
    if (e && !seen.has(`protocol:${e.protocolId}`)) { seen.add(`protocol:${e.protocolId}`); core.push({ kind: "protocol", id: e.protocolId }); }
  }
  assert.deepEqual(deriveCore(s, picks).core, core);
});

test("角色：任务 core/selected/optional/context 分类；core.selectable=false；知识卡仅已入候选", () => {
  const s = fixture();
  (s as any).analysisTasks = [{ id: "tk1", topicId: "tpA", title: "任务1", core: [{ kind: "table", id: "tb1" }], optional: [{ ref: { kind: "card", id: "c1" }, included: true }, { ref: { kind: "protocol", id: "pr1" }, included: false }], resultIds: [], createdAt: ISO, updatedAt: ISO }];
  const m = buildContextMap(s, { topicId: "tpA", taskId: "tk1" });
  const by = (k: string) => m.nodes.find((n) => n.key === k)!;
  assert.equal(by("table:tb1").role, "core");
  assert.equal(by("table:tb1").selectable, false);
  assert.equal(by("card:c1").role, "selected");
  assert.equal(by("card:c1").selectable, true);
  assert.equal(by("protocol:pr1").role, "optional");
  assert.equal(by("topic:tpA").role, "context");
  assert.ok(m.nodes.some((n) => n.role === "context" && n.key === "asset:as1")); // 表的上游原件作 context
  assert.equal(m.nodes.some((n) => n.key === "card:c2"), false); // 未审卡不入
  assert.equal(m.scope.frozen, false);
});

test("建任务前：pick 推导为 core；已入候选卡为 selected；其余同课题对象为 optional", () => {
  const s = fixture();
  const m = buildContextMap(s, { topicId: "tpA", pick: [{ kind: "measurement", id: "me1" }] });
  const role = (k: string) => m.nodes.find((n) => n.key === k)?.role;
  assert.equal(role("measurement:me1"), "core");
  assert.equal(role("execution:ex1"), "core");
  assert.equal(role("protocol:pr1"), "core");
  assert.equal(role("card:c1"), "selected");
  assert.equal(role("table:tb1"), "optional");
});

test("边不造假：返回的每条边都存在于 buildNetwork(state).edges", () => {
  const s = fixture();
  (s as any).analysisTasks = [{ id: "tk1", topicId: "tpA", title: "任务1", core: [{ kind: "table", id: "tb1" }], optional: [{ ref: { kind: "card", id: "c1" }, included: true }], resultIds: [], createdAt: ISO, updatedAt: ISO }];
  const net = buildNetwork(s);
  const real = new Set(net.edges.map((e) => `${e.from}|${e.to}|${e.edgeKind}`));
  const m = buildContextMap(s, { topicId: "tpA", taskId: "tk1" });
  for (const e of m.edges) assert.ok(real.has(`${e.from}|${e.to}|${e.edgeKind}`), `${e.from}|${e.to}|${e.edgeKind}`);
});

test("跨课题：另一课题的对象不作为可选节点出现", () => {
  const s = fixture();
  const m = buildContextMap(s, { topicId: "tpA" });
  assert.equal(m.nodes.some((n) => n.id === "meB" || n.id === "pr2"), false);
});

test("确定性与上限：重复调用顺序一致；超限 truncated 为真", () => {
  const s = fixture();
  const a = JSON.stringify(buildContextMap(s, { topicId: "tpA" }));
  const b = JSON.stringify(buildContextMap(s, { topicId: "tpA" }));
  assert.equal(a, b);
  // 构造 320 个同课题测量 → 节点超 300
  (s as any).measurements = Array.from({ length: 320 }, (_, i) => ({ id: `mm${i}`, topicId: "tpA", sampleId: "sm1", sampleStateRevision: 0, time: "0", method: "", instrument: "", value: String(i), unit: "u", note: "", revision: 1, history: [], createdAt: ISO }));
  const big = buildContextMap(s, { topicId: "tpA" });
  assert.equal(big.truncated, true);
  assert.equal(big.nodes.length, 300);
});

test("只读：调用前后 state 深度相等", () => {
  const s = fixture();
  const before = JSON.stringify(s);
  buildContextMap(s, { topicId: "tpA", pick: [{ kind: "measurement", id: "me1" }] });
  assert.equal(JSON.stringify(s), before);
});

test("parsePicks：格式/类型校验", () => {
  assert.deepEqual(parsePicks("table:tb1,measurement:me1"), [{ kind: "table", id: "tb1" }, { kind: "measurement", id: "me1" }]);
  assert.throws(() => parsePicks("bad"), /pick 格式/);
  assert.throws(() => parsePicks("chat:x"), /pick 类型不支持/);
});

test("路由：/api/analysis/map 与 /tasks/:id/map；404/422", async () => {
  const s = fixture();
  (s as any).analysisTasks = [{ id: "tk1", topicId: "tpA", title: "任务1", core: [{ kind: "table", id: "tb1" }], optional: [], resultIds: [], createdAt: ISO, updatedAt: ISO }];
  const store = new MemoryStore(); await store.save(s);
  const app = await createApp(store);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  try {
    const ok = await fetch(`${base}/api/analysis/map?topicId=tpA&pick=measurement:me1`);
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { ok: boolean; nodes: unknown[] };
    assert.equal(body.ok, true);
    assert.ok(body.nodes.length > 0);

    const tmap = await fetch(`${base}/api/analysis/tasks/tk1/map`);
    assert.equal(tmap.status, 200);
    assert.equal(((await tmap.json()) as { scope: { taskId: string } }).scope.taskId, "tk1");

    assert.equal((await fetch(`${base}/api/analysis/map`)).status, 404);
    assert.equal((await fetch(`${base}/api/analysis/map?topicId=tpA&pick=measurement:nope`)).status, 422);
    assert.equal((await fetch(`${base}/api/analysis/map?topicId=tpA&pick=measurement:meB`)).status, 422); // 跨课题
    assert.equal((await fetch(`${base}/api/analysis/tasks/nope/map`)).status, 404);
  } finally { await new Promise<void>((r) => app.close(() => r())); }
});

test("真实形状：达尔文验收数据跑一次（若有）", () => {
  const path = "data/acceptance-darwin.json";
  if (!existsSync(path)) return;
  const s = JSON.parse(readFileSync(path, "utf8")) as LocusState;
  const task = s.analysisTasks[0];
  assert.ok(task, "验收数据应含分析任务");
  const m = buildContextMap(s, { topicId: task.topicId, taskId: task.id });
  assert.equal(m.ok, true);
  assert.ok(m.nodes.length > 0 && m.nodes.some((n) => n.role === "core"));
});
