/**
 * 5D 契约测试：方案原件直传直解（不进文献候选库）；
 * 执行准备稿 → 确认冻结快照 → 实际记录；源方案新版本不改旧执行；
 * 时长调整触发确定性时间传播（AI 未配置 ≠ 无影响）；另存新方案不改全局。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createTopic, createSubquestion } from "../services/app.ts";
import {
  appendEvent,
  confirmPreparation,
  completeExecution,
  createProtocol,
  editProtocol,
  effectiveSnapshot,
  pauseExecution,
  saveExecutionAsProtocol,
  startExecution,
  updatePreparation,
  uploadProtocolSource,
} from "../services/experiment.ts";
import { emptyState, MemoryStore, type LocusState, type ProtocolStep } from "../store.ts";
import { clearAiConfig } from "../services/ai.ts";

function base() {
  let s = emptyState();
  const t = createTopic(s, { name: "酶活实验", researchQuestion: "温度如何影响活性？" });
  s = t.state;
  const q = createSubquestion(s, { topicId: t.topic.id, question: "最适温度？" });
  return { s: q.state, topicId: t.topic.id };
}

const step = (id: string, op: string, durationMin: number | null): ProtocolStep =>
  ({ id, op, params: {}, note: "", durationMin, estimated: false, branch: null, observeEnd: "" });

function withProto() {
  const { s, topicId } = base();
  const r = createProtocol(s, {
    topicId, name: "标准方案", purpose: "测活", criteria: "完成显色",
    steps: [step("s1", "配缓冲液", 10), step("s2", "孵育", 30), step("s3", "读数", null)],
  });
  const e = startExecution(r.state, { topicId, protocolId: r.protocol.id });
  return { st: e.state, topicId, pid: r.protocol.id, eid: e.execution.id };
}

test("5D-1 创建执行进入准备稿：不虚构开始事件；准备期禁止补记录/暂停/完成", () => {
  const { st, eid } = withProto();
  const exec = st.executions[0];
  assert.equal(exec.phase, "preparing");
  assert.equal(exec.events.length, 0);
  assert.equal(exec.preparation!.adjustments.length, 0);
  assert.throws(() => appendEvent(st, eid, { kind: "start" }), /准备≠已做实验/);
  assert.throws(() => appendEvent(st, eid, { kind: "note", text: "x" }), /未确认/);
  assert.throws(() => pauseExecution(st, eid, { reason: "r" }), /尚未开始/);
  assert.throws(() => completeExecution(st, eid), /不虚构/);
});

test("5D-2 准备稿校验：幽灵步骤/缺原因/坏时长拒绝；before 自动取基础值", () => {
  const { st, eid } = withProto();
  assert.throws(() => updatePreparation(st, eid, { adjustments: [{ stepId: "ghost", field: "op", after: "x", reason: "r" }] }), /不在基础快照/);
  assert.throws(() => updatePreparation(st, eid, { adjustments: [{ stepId: "s1", field: "op", after: "x", reason: "" }] }), /原因/);
  assert.throws(() => updatePreparation(st, eid, { adjustments: [{ stepId: "s1", field: "durationMin", after: "-5", reason: "r" }] }), /非负数/);
  assert.throws(() => updatePreparation(st, eid, { adjustments: [{ stepId: "s1", field: "durationMin", after: "abc", reason: "r" }] }), /非负数/);
  const r = updatePreparation(st, eid, {
    adjustments: [{ stepId: "s2", field: "durationMin", after: "45", reason: "本次延长孵育" }],
    notes: "今天室温偏高",
  });
  const a = r.execution.preparation!.adjustments[0];
  assert.equal(a.before, "30"); // 自动取基础快照值
  assert.equal(r.execution.preparation!.notes, "今天室温偏高");
  assert.equal(r.execution.phase, "preparing"); // 保存草稿不确认
  // 草稿可反复改
  const r2 = updatePreparation(r.state, eid, { adjustments: [{ stepId: "s2", field: "durationMin", after: "50", reason: "再延长" }] });
  assert.equal(r2.execution.preparation!.adjustments.length, 1);
  assert.equal(r2.execution.preparation!.adjustments[0].after, "50");
});

test("5D-3 确认冻结快照：差异生效；源方案与后续新版本都不改本次快照", () => {
  const { st, topicId, pid, eid } = withProto();
  let s = updatePreparation(st, eid, {
    adjustments: [
      { stepId: "s2", field: "durationMin", after: "45", reason: "延长孵育" },
      { stepId: "s1", field: "op", after: "配磷酸缓冲液", reason: "换缓冲体系" },
      { stepId: "s3", field: "durationMin", after: "null", reason: "读数时长未知" },
    ],
  }).state;
  const c = confirmPreparation(s, eid);
  s = c.state;
  const exec = s.executions[0];
  assert.equal(exec.phase, "recording");
  assert.ok(exec.preparation!.confirmedAt);
  const snap = exec.preparation!.snapshot!;
  assert.equal(snap.steps.find((x) => x.id === "s2")!.durationMin, 45);
  assert.equal(snap.steps.find((x) => x.id === "s1")!.op, "配磷酸缓冲液");
  assert.equal(snap.steps.find((x) => x.id === "s3")!.durationMin, null);
  assert.match(snap.reason, /3 条本次差异/);
  // 源方案 r1 不动
  const src = s.protocols.find((p) => p.id === pid)!;
  assert.equal(src.revision, 1);
  assert.equal(src.revisions[0].steps.find((x) => x.id === "s2")!.durationMin, 30);
  // 源方案出新版本，本次执行快照不变
  s = editProtocol(s, pid, { steps: [step("s1", "配缓冲液", 10), step("s2", "孵育", 99)], reason: "全局改" }).state;
  const after = effectiveSnapshot(s, s.executions[0])!;
  assert.equal(after.steps.find((x) => x.id === "s2")!.durationMin, 45);
  assert.equal(s.executions[0].protocolRevision, 1); // 固定引用不变
  // 确认后不可再改准备稿、不可重复确认
  assert.throws(() => updatePreparation(s, eid, { notes: "x" }), /不可再改/);
  assert.throws(() => confirmPreparation(s, eid), /无需重复确认/);
  // 步骤事件按有效快照校验
  const ev = appendEvent(s, eid, { kind: "step", stepId: "s2", actual: { durationMin: 47 } });
  assert.equal(ev.execution.events.length, 1);
  // 实际开始是显式事件，不是系统虚构
  const started = appendEvent(s, eid, { kind: "start" });
  assert.equal(started.execution.events[0].kind, "start");
});

test("5D-4 时长差异触发确定性时间传播；AI 未配置 ⇒ failed+needs_review 而非无影响", () => {
  clearAiConfig();
  const { st, eid } = withProto();
  const s = updatePreparation(st, eid, { adjustments: [{ stepId: "s2", field: "durationMin", after: "45", reason: "延长" }] }).state;
  const c = confirmPreparation(s, eid);
  assert.ok(c.impactId);
  const imp = c.state.impacts.find((i) => i.id === c.impactId)!;
  assert.equal(imp.status, "failed");
  assert.equal(imp.assessment, "needs_review");
  assert.match(imp.summary, /不等于/);
  const shifts = imp.deterministic.timeShifts;
  assert.ok(shifts.some((t) => t.stepId === "s2" && t.deltaMin === 15));
  assert.ok(shifts.some((t) => t.stepId === "s3")); // 后续步骤顺延（时长未知也提示）
  // 无差异确认：不登记影响
  const { st: st2, eid: eid2 } = withProto();
  const c2 = confirmPreparation(st2, eid2);
  assert.equal(c2.impactId, undefined);
  assert.equal(c2.state.impacts.length, 0);
});

test("5D-5 另存新方案：须已确认；新方案 r1 带差异与出处；源方案不动", () => {
  const { st, pid, eid } = withProto();
  assert.throws(() => saveExecutionAsProtocol(st, eid, { name: "新" }), /先确认/);
  let s = updatePreparation(st, eid, { adjustments: [{ stepId: "s2", field: "durationMin", after: "45", reason: "延长" }] }).state;
  s = confirmPreparation(s, eid).state;
  const r = saveExecutionAsProtocol(s, eid, { name: "延长孵育版" });
  const np = r.protocol;
  assert.equal(np.revision, 1);
  assert.equal(np.sourceKind, "user");
  assert.equal(np.revisions[0].steps.find((x) => x.id === "s2")!.durationMin, 45);
  assert.match(np.revisions[0].sourceFragments.join(), /不改动源方案/);
  assert.equal(r.state.protocols.find((p) => p.id === pid)!.revision, 1);
  assert.equal(r.state.protocols.length, 2);
});

test("5D-6 方案原件直传：kind=protocol 不进文献库；去 BOM；拒二进制/坏扩展/空文本；重复 409 带已有 id", () => {
  const { s, topicId } = base();
  const bom = String.fromCharCode(0xfeff);
  const r = uploadProtocolSource(s, { name: "p.md", text: bom + "# 方案\n配液后孵育 30 分钟。", topicId });
  assert.equal(r.asset.kind, "protocol");
  assert.equal(r.asset.text.startsWith(bom), false);
  assert.equal(r.state.cards.length, 0);
  assert.equal(r.state.papers.length, 0);
  assert.throws(() => uploadProtocolSource(r.state, { name: "p2.md", text: "# 方案\n配液后孵育 30 分钟。" }), (e: { status?: number; details?: { existingAssetId?: string } }) => {
    assert.equal(e.status, 409);
    assert.equal(e.details!.existingAssetId, r.asset.id);
    return true;
  });
  assert.throws(() => uploadProtocolSource(s, { name: "p.pdf", text: "x" }), /Markdown\/纯文本/);
  assert.throws(() => uploadProtocolSource(s, { name: "p.md", text: "a" + String.fromCharCode(0) + "b" }), /二进制/);
  assert.throws(() => uploadProtocolSource(s, { name: "p.md", text: "  " }), /为空/);
});

test("5D-7 存量执行（无 phase）按 recording 对待：可直接补记录", () => {
  const { st, eid } = withProto();
  const legacy: LocusState = {
    ...st,
    executions: st.executions.map((e) => ({ ...e, phase: undefined, preparation: null })),
  };
  const r = appendEvent(legacy, eid, { kind: "start" });
  assert.equal(r.execution.events.length, 1);
  assert.equal(effectiveSnapshot(legacy, legacy.executions[0])!.steps.length, 3);
});

// ── 集成：真实路由 上传→解析（假模型）；重复提交 409；reconstructed 仅限文献原件 ──
const PROTO_JSON = JSON.stringify({ protocol: { purpose: "测活", inputs: ["酶液"], steps: [{ op: "孵育", durationMin: 30, estimated: false, note: "" }, { op: "读数", durationMin: null, estimated: false, note: "" }], conditions: ["25 C"], criteria: "显色", unknowns: ["读数时长"] } });

async function fakeAi(delayMs: number): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: PROTO_JSON } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as import("node:net").AddressInfo).port };
}

test("5D-8 路由：上传原件→解析出 ai-draft 方案（不进文献库）；运行中重复提交 409；reconstructed 拒非文献原件", async () => {
  const { createApp } = await import("../server.ts");
  const ai = await fakeAi(250);
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, b: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, never>>;
  try {
    const t = await post("/api/topics", { name: "方案课题", researchQuestion: "Q" });
    const topicId = t.data.topicId as string;
    const up = await post("/api/protocols/upload", { name: "methods.md", text: "孵育 30 分钟后读数。", topicId });
    assert.equal(up.status, 200);
    const assetId = up.data.assetId as string;
    const st0 = await get("/api/state");
    assert.equal((st0.cards as unknown[]).length, 0);
    assert.equal((st0.papers as unknown[]).length, 0);
    // reconstructed 不接受 protocol 原件
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const bad = await post("/api/protocols/parse", { assetId, topicId, sourceKind: "reconstructed" });
    assert.equal(bad.status, 422);
    const job = await post("/api/protocols/parse", { assetId, topicId });
    assert.equal(job.status, 202);
    const dup = await post("/api/protocols/parse", { assetId, topicId });
    assert.equal(dup.status, 409);
    let j: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      j = await get(`/api/jobs/${job.data.jobId}`);
      if (j.status === "done" || j.status === "error") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(j.status, "done");
    const st = await get("/api/state");
    const protos = st.protocols as { sourceKind: string; sourceAssetId?: string; revisions: { steps: { durationMin: number | null }[] }[] }[];
    assert.equal(protos.length, 1);
    assert.equal(protos[0].sourceKind, "ai-draft");
    assert.equal(protos[0].sourceAssetId, assetId);
    assert.equal(protos[0].revisions[0].steps[1].durationMin, null); // 未知时长不虚构
    // 完成后可再次解析（产生新草稿，不覆盖）
    const job2 = await post("/api/protocols/parse", { assetId, topicId });
    assert.equal(job2.status, 202);
    for (let i = 0; i < 100; i++) {
      j = await get(`/api/jobs/${job2.data.jobId}`);
      if (j.status === "done" || j.status === "error") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(j.status, "done");
    assert.equal(((await get("/api/state")).protocols as unknown[]).length, 2);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});