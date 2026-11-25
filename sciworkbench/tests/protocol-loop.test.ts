/**
 * 4C 契约测试（T02–T09 + 反例）：
 * 方案固定版本 / 模板确认复用 / 记录层不改源方案 / 暂停恢复人决定 /
 * 样品短号与状态追加 / 测量固定状态 / 确定性时间传播 / 失败≠无影响 / stale 守卫 / OCR 归档与确认。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTopic, createSubquestion, importLiterature, importMeasurements } from "../services/app.ts";
import {
  addManualOcr,
  addMeasurement,
  addSampleState,
  appendEvent,
  computeTimeShifts,
  confirmOcr,
  confirmPreparation,
  confirmTemplate,
  createProtocol,
  createSample,
  createTemplate,
  editEvent,
  editMeasurement,
  editProtocol,
  impactDisplay,
  importImage,
  pauseExecution,
  protocolDraftFromAi,
  registerImpact,
  renameSample,
  resumeExecution,
  runImpactAssessment,
  startExecution,
  templateProtocolCheck,
} from "../services/experiment.ts";
import { emptyState, MemoryStore, type LocusState, type ProtocolStep } from "../store.ts";

function base() {
  let s = emptyState();
  const t = createTopic(s, { name: "酶活实验", researchQuestion: "温度如何影响活性？" });
  s = t.state;
  const q = createSubquestion(s, { topicId: t.topic.id, question: "最适温度？" });
  return { s: q.state, topicId: t.topic.id, subqId: q.subquestion.id };
}

const step = (id: string, op: string, durationMin: number | null, branch: string | null = null, estimated = false): ProtocolStep =>
  ({ id, op, params: {}, note: "", durationMin, estimated, branch, observeEnd: "" });

function proto(s: LocusState, topicId: string, steps: ProtocolStep[]) {
  return createProtocol(s, { topicId, name: "标准方案", steps, purpose: "测活", criteria: "完成显色" });
}

// T03 / EXP01：方案整版快照追加；引用固定 revision
test("T03 方案修订追加整版快照；旧 revision 不动；无原因拒绝", () => {
  const { s, topicId } = base();
  const r = proto(s, topicId, [step("s1", "配缓冲液", 10), step("s2", " incubate", 30)]);
  let st = r.state;
  const pid = r.protocol.id;
  assert.throws(() => editProtocol(st, pid, { steps: [step("s1", "配缓冲液", 15)], reason: "" }), /原因/);
  const e = editProtocol(st, pid, { steps: [step("s1", "配缓冲液", 15), step("s2", " incubate", 30)], reason: "延长配液" });
  st = e.state;
  assert.equal(e.protocol.revision, 2);
  assert.equal(e.protocol.revisions.length, 2);
  assert.equal(e.protocol.revisions[0].steps[0].durationMin, 10); // 旧快照不被改写
  assert.equal(e.protocol.revisions[1].steps[0].durationMin, 15);
});

test("T03 重构/AI 草稿方案必须标明方法来源", () => {
  const { s, topicId } = base();
  assert.throws(
    () => createProtocol(s, { topicId, name: "重构", sourceKind: "reconstructed", steps: [step("s1", "op", null)] }),
    /方法来源/,
  );
  const ok = createProtocol(s, { topicId, name: "重构", sourceKind: "reconstructed", sourceFragments: ["原文：37℃ 30min"], steps: [step("s1", "op", null)] });
  assert.equal(ok.protocol.sourceKind, "reconstructed");
});

test("T03 AI 方案解析结果映射：未知时长留空，不补造", () => {
  const d = protocolDraftFromAi({ protocol: { purpose: "P", operations: ["混合", "静置"], conditions: ["pH7"], unknowns: ["温度未写明"] } }, "ast_1");
  assert.equal(d.steps.length, 2);
  assert.equal(d.steps[0].durationMin, null);
  assert.deepEqual(d.unknowns, ["温度未写明"]);
  assert.throws(() => protocolDraftFromAi({ nope: 1 }, "ast_1"), /结构不符/);
});

test("T03 AI 方案解析：结构化 steps 的时长入 durationMin，不埋在操作文本（远端验收反例）", () => {
  const d = protocolDraftFromAi({ protocol: { purpose: "P", steps: [
    { op: "配制缓冲液", durationMin: 10, estimated: false },
    { op: "孵育", durationMin: 30, estimated: true, note: "原文约 30 分钟" },
    { op: "读吸光度", durationMin: null },
  ] } }, "ast_1");
  assert.deepEqual(d.steps.map((s) => s.durationMin), [10, 30, null]);
  assert.equal(d.steps[1].estimated, true);
  assert.equal(d.steps[1].note, "原文约 30 分钟");
  // 旧 operations 兜底仍可用
  const legacy = protocolDraftFromAi({ protocol: { operations: ["混合"] } }, "ast_1");
  assert.equal(legacy.steps[0].durationMin, null);
});

// T03 / EXP03：模板固定 revision；AI 草稿须人工确认后复用
test("T03 模板固定方案 revision；未确认不得用于执行；方案变更后须比较", () => {
  const { s, topicId } = base();
  const r = proto(s, topicId, [step("s1", "op", 10)]);
  let st = r.state;
  const pid = r.protocol.id;
  const t = createTemplate(st, { protocolId: pid, aiDraft: true });
  st = t.state;
  assert.equal(t.template.protocolRevision, 1);
  assert.equal(t.template.humanConfirmed, false);
  assert.throws(() => startExecution(st, { topicId, protocolId: pid, templateId: t.template.id }), /人工确认/);
  st = confirmTemplate(st, t.template.id).state;
  const ex = startExecution(st, { topicId, protocolId: pid, templateId: t.template.id });
  st = ex.state;
  assert.equal(ex.execution.protocolRevision, 1);
  // 方案修订 → 模板仍固定 r1，检查提示已变
  st = editProtocol(st, pid, { steps: [step("s1", "op", 20)], reason: "改时长" }).state;
  const chk = templateProtocolCheck(st, t.template.id);
  assert.equal(chk.changed, true);
  assert.equal(chk.pinnedRevision, 1);
  assert.equal(chk.currentRevision, 2);
  // 已固定的执行不受方案修订影响
  assert.equal(st.executions[0].protocolRevision, 1);
});

// T04 / EXP04：记录层原位编辑留历史，不改源方案；后补标明
test("T04 执行事件追加/后补/原位编辑；改实际值须原因；源方案不动", () => {
  const { s, topicId } = base();
  const r = proto(s, topicId, [step("s1", "op", 10)]);
  let st = r.state;
  const ex = startExecution(st, { topicId, protocolId: r.protocol.id });
  st = ex.state;
  const eid = ex.execution.id;
  // 5D：创建执行=准备稿；确认快照后才进入记录状态（无差异也要确认）
  assert.equal(ex.execution.phase, "preparing");
  assert.equal(ex.execution.events.length, 0);
  st = confirmPreparation(st, eid).state;
  const ev = appendEvent(st, eid, { kind: "step", stepId: "s1", text: "已配液", actual: { durationMin: 12 }, backfilled: true });
  st = ev.state;
  const evId = st.executions[0].events[0].id;
  assert.equal(st.executions[0].events[0].backfilled, true);
  assert.throws(() => editEvent(st, eid, evId, { actual: { durationMin: 15 } }), /原因/);
  const ed = editEvent(st, eid, evId, { actual: { durationMin: 15 }, reason: "计时更正" });
  st = ed.state;
  const edited = st.executions[0].events[0];
  assert.equal(edited.actual.durationMin, 15);
  assert.equal(edited.history.length, 1);
  assert.equal(edited.history[0].before, JSON.stringify({ durationMin: 12 }));
  // 源方案 revision 与步骤时长未被触碰
  assert.equal(st.protocols[0].revision, 1);
  assert.equal(st.protocols[0].revisions[0].steps[0].durationMin, 10);
  // 步骤事件必须引用固定 revision 中存在的步骤
  assert.throws(() => appendEvent(st, eid, { kind: "step", stepId: "ghost", text: "x" }), /步骤/);
});

// T05 / EXP05：暂停/恢复；AI 只建议，人决定
test("T05 暂停须原因；恢复须人的决定；建议标记保留", () => {
  const { s, topicId } = base();
  const r = proto(s, topicId, [step("s1", "op", 10)]);
  let st = startExecution(r.state, { topicId, protocolId: r.protocol.id }).state;
  const eid = st.executions[0].id;
  st = confirmPreparation(st, eid).state;
  assert.throws(() => pauseExecution(st, eid, { reason: "" }), /原因/);
  st = pauseExecution(st, eid, { reason: "设备故障", risks: ["样品降解"], resumeChecks: ["确认温度"], aiSuggested: true }).state;
  assert.equal(st.executions[0].status, "paused");
  assert.equal(st.executions[0].pausedState!.aiSuggested, true);
  assert.throws(() => resumeExecution(st, eid, "  "), /人做出决定/);
  st = resumeExecution(st, eid, "更换设备后继续，样品保留").state;
  assert.equal(st.executions[0].status, "active");
  assert.equal(st.executions[0].pausedState!.humanDecision, "更换设备后继续，样品保留");
  assert.equal(st.executions[0].events.some((e) => e.kind === "pause"), true);
  assert.equal(st.executions[0].events.some((e) => e.kind === "resume"), true);
});

// T02 / TOP04–05：样品短号稳定、状态追加、测量固定状态
test("T02 样品短号唯一；改名不破引用；状态追加不改写历史", () => {
  const { s, topicId } = base();
  const a = createSample(s, { topicId, shortName: "S1", amount: { value: "5", unit: "mL", estimated: true } });
  let st = a.state;
  assert.throws(() => createSample(st, { topicId, shortName: "S1", amount: { value: "1", unit: "mL" } }), /短号已存在/);
  st = addSampleState(st, a.sample.id, { amount: { value: "2", unit: "mL" }, handling: "分样", use: "测活" }).state;
  assert.equal(st.samples[0].states.length, 2);
  assert.equal(st.samples[0].states[0].amount.value, "5"); // 旧状态保留
  assert.equal(st.samples[0].states[0].amount.estimated, true);
  const m = addMeasurement(st, { topicId, sampleId: a.sample.id, sampleStateRevision: 1, value: "0.42", unit: "U/mL", method: "显色法" });
  st = m.state;
  st = renameSample(st, a.sample.id, "缓冲液A（ renamed）").state;
  assert.equal(st.samples[0].shortName, "S1");
  assert.equal(st.measurements[0].sampleId, a.sample.id); // 引用不破
  assert.equal(st.measurements[0].sampleStateRevision, 1); // 固定旧状态
  assert.throws(() => addMeasurement(st, { topicId, sampleId: a.sample.id, sampleStateRevision: 99, value: "1" }), /revision 不存在/);
});

test("T02 测量修订须原因留历史；公开导入不创建执行/样品（反例）", async () => {
  const { s, topicId } = base();
  const a = createSample(s, { topicId, shortName: "S1", amount: { value: "5", unit: "mL" } });
  let st = a.state;
  const m = addMeasurement(st, { topicId, sampleId: a.sample.id, value: "0.42", unit: "U/mL" });
  st = m.state;
  assert.throws(() => editMeasurement(st, m.measurement.id, { value: "0.45" }), /原因/);
  st = editMeasurement(st, m.measurement.id, { value: "0.45", reason: "读数更正" }).state;
  assert.equal(st.measurements[0].history.length, 1);
  assert.equal(st.measurements[0].revision, 2);
  // 公开材料导入只产生原件/卡/表，不新增执行与样品
  const execBefore = st.executions.length;
  const sampleBefore = st.samples.length;
  const lit = await importLiterature(st, { name: "p.md", text: "公开方法。", mode: "draft", topicId }, null);
  const csv = importMeasurements(lit.state, { name: "d.csv", csv: "t,v\n0,1", topicId });
  assert.equal(csv.state.executions.length, execBefore);
  assert.equal(csv.state.samples.length, sampleBefore);
});

// T06/T07：确定性时间传播独立于 AI
test("T07 确定性时间传播：改时长 → 下游主线平移；支路不计；未知时长说明", () => {
  const prev = [step("s1", "配液", 10), step("s2", "孵育", 30), step("s3", "显色", 5), step("b1", "对照", 60, "对照支路")];
  const next = [step("s1", "配液", 10), step("s2", "孵育", 45), step("s3", "显色", 5), step("b1", "对照", 60, "对照支路")];
  const r = computeTimeShifts(prev, next);
  const s3 = r.timeShifts.find((t) => t.stepId === "s3")!;
  assert.equal(s3.deltaMin, 15);
  assert.equal(s3.newTotalMin, 60);
  assert.equal(r.timeShifts.some((t) => t.stepId === "b1"), false);
  const unknown = computeTimeShifts(prev, [step("s1", "配液", 10), step("s2", "孵育", null), step("s3", "显色", 5)]);
  assert.match(unknown.note, /未知/);
});

// T07/T08 / ARC06–07：失败/未配置 ≠ 无影响；stale 不盖新改
test("T07 未配置 AI ⇒ failed+needs_review，绝不显示无影响", () => {
  const { s, topicId } = base();
  const r = registerImpact(s, { topicId, change: { entityKind: "protocol", entityId: "p1", revision: 2, summary: "改" }, aiConfigured: false });
  const i = r.impact;
  assert.equal(i.status, "failed");
  assert.equal(i.assessment, "needs_review");
  assert.equal(impactDisplay(i), "failed");
  assert.notEqual(impactDisplay(i), "no_supported_impact_found");
});

test("T08 新改动 → 旧分析 stale；旧的“无影响”降级 needs_review；晚到结果被丢弃", async () => {
  const { s, topicId } = base();
  const r1 = registerImpact(s, { topicId, change: { entityKind: "protocol", entityId: "p1", revision: 2, summary: "第一次" }, aiConfigured: true });
  let st = r1.state;
  // 模拟第一次已完成且结论为“无支持的影响”
  st = { ...st, impacts: st.impacts.map((i) => ({ ...i, status: "completed" as const, assessment: "no_supported_impact_found" as const })) };
  const r2 = registerImpact(st, { topicId, change: { entityKind: "protocol", entityId: "p1", revision: 3, summary: "第二次" }, aiConfigured: true });
  st = r2.state;
  const old = st.impacts.find((i) => i.id === r1.impact.id)!;
  assert.equal(old.status, "stale");
  assert.equal(impactDisplay(old), "needs_review"); // 旧“无影响”不得当当前结论
  assert.equal(st.impacts.find((i) => i.id === r2.impact.id)!.status, "pending");
  // 晚到守卫：对 stale 的分析跑评估 → 直接丢弃，不发请求、不覆盖
  const store = new MemoryStore();
  await store.save(st);
  const res = await runImpactAssessment(() => store.load(), (x) => store.save(x), r1.impact.id, { baseUrl: "http://127.0.0.1:1", model: "m", key: "k" });
  assert.equal(res.discarded, true);
  const back = await store.load();
  assert.equal(back.impacts.find((i) => i.id === r1.impact.id)!.status, "stale");
});

test("T07 AI 评估失败 ⇒ failed+needs_review+错误信息（不冒充无影响）", async () => {
  const { s, topicId } = base();
  const r = registerImpact(s, { topicId, change: { entityKind: "protocol", entityId: "p1", revision: 2, summary: "改" }, aiConfigured: true });
  const store = new MemoryStore();
  await store.save(r.state);
  const res = await runImpactAssessment(() => store.load(), (x) => store.save(x), r.impact.id, { baseUrl: "http://127.0.0.1:1", model: "m", key: "k", timeoutMs: 5000 });
  assert.equal(res.ok, false);
  assert.ok(res.error);
  const back = await store.load();
  const i = back.impacts[0];
  assert.equal(i.status, "failed");
  assert.equal(i.assessment, "needs_review");
  assert.equal(impactDisplay(i), "failed");
});

test("T07 方案修订自动登记影响：确定性传播已算，AI 未配置分栏明示", () => {
  const { s, topicId } = base();
  const r = proto(s, topicId, [step("s1", "配液", 10), step("s2", "孵育", 30)]);
  const e = editProtocol(r.state, r.protocol.id, { steps: [step("s1", "配液", 10), step("s2", "孵育", 40)], reason: "延长孵育" });
  const imps = e.state.impacts.filter((i) => i.change.entityId === r.protocol.id);
  assert.equal(imps.length, 1);
  assert.equal(imps[0].deterministic.timeShifts.length, 1);
  assert.equal(imps[0].deterministic.timeShifts[0].deltaMin, 10);
  assert.equal(imps[0].status, "failed"); // 测试环境未配置 AI
  assert.match(imps[0].summary, /不等于/);
});

// T09 / OCR01–02：原图归档 + 人工兜底 + 确认留历史
test("T09 图片归档：非 dataURL 拒绝；同内容拒收；OCR 只挂图片原件", () => {
  const { s, topicId } = base();
  assert.throws(() => importImage(s, { name: "x.png", dataUrl: "not-an-image" }), /dataURL/);
  const url = "data:image/png;base64,aGVsbG8=";
  const r = importImage(s, { name: "hand.png", dataUrl: url, topicId });
  assert.throws(() => importImage(r.state, { name: "hand2.png", dataUrl: url }), /拒收/);
  assert.equal(r.asset.kind, "image");
  assert.throws(() => addManualOcr(r.state, r.asset.id, { rawText: "" }), /不能为空/);
  assert.equal(r.state.assets.length, 1);
});

test("T09 人工转录兜底标 manual；确认改数值须原因留历史", () => {
  const { s, topicId } = base();
  const img = importImage(s, { name: "h.png", dataUrl: "data:image/png;base64,aGk=", topicId });
  let st = img.state;
  const o = addManualOcr(st, img.asset.id, { rawText: "37℃ 3?min", fields: { 温度: "37", 时长: "3?" }, unknowns: ["时长末位不清"] });
  st = o.state;
  assert.equal(o.ocr.extraction, "manual");
  assert.equal(o.ocr.status, "draft");
  assert.throws(() => confirmOcr(st, o.ocr.id, { fields: { 温度: "37", 时长: "30" } }), /原因/);
  const c = confirmOcr(st, o.ocr.id, { fields: { 温度: "37", 时长: "30" }, reason: "对照原图末位为0" });
  st = c.state;
  assert.equal(c.ocr.status, "confirmed");
  assert.equal(c.ocr.fields.时长, "30");
  assert.equal(c.ocr.history.length, 1);
  assert.equal(c.ocr.history[0].reason, "对照原图末位为0");
  // 原图仍在档（不被转录覆盖）
  assert.equal(st.assets.find((a) => a.id === img.asset.id)!.text, "data:image/png;base64,aGk=");
});

// HTTP 全链路（MemoryStore，无真实网络）
test("4C HTTP 闭环：方案→模板→执行→暂停恢复→样品→测量→修订→影响登记→OCR", async () => {
  const { createApp } = await import("../server.ts");
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, body: unknown) => {
    const res = await fetch(`${url}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${url}${p}`)).json() as Promise<Record<string, never>>;
  try {
    const topicId = (await post("/api/topics", { name: "HTTP4C", researchQuestion: "Q" })).data.topicId as string;
    const p = await post("/api/protocols", { topicId, name: "方案A", steps: [{ id: "s1", op: "配液", durationMin: 10 }, { id: "s2", op: "孵育", durationMin: 30 }] });
    assert.equal(p.status, 200);
    const protocolId = p.data.protocolId as string;
    const t = await post("/api/templates", { protocolId, aiDraft: true });
    const templateId = t.data.templateId as string;
    assert.equal((await post("/api/executions", { topicId, protocolId, templateId })).status, 422); // 未确认
    assert.equal((await post(`/api/templates/${templateId}/confirm`, {})).status, 200);
    const chk = await get(`/api/templates/${templateId}/check`);
    assert.equal(chk.changed, false);
    const ex = await post("/api/executions", { topicId, protocolId, templateId });
    assert.equal(ex.status, 200);
    const executionId = ex.data.executionId as string;
    assert.equal((await post(`/api/executions/${executionId}/events`, { kind: "start" })).status, 422); // 准备稿未确认不得补记录
    assert.equal((await post(`/api/executions/${executionId}/confirm-preparation`, {})).status, 200);
    const ev = await post(`/api/executions/${executionId}/events`, { kind: "step", stepId: "s1", text: "配液完成", actual: { durationMin: 12 } });
    const eventId = ev.data.eventId as string;
    assert.equal((await post(`/api/executions/${executionId}/events/${eventId}/edit`, { actual: { durationMin: 14 } })).status, 422);
    assert.equal((await post(`/api/executions/${executionId}/events/${eventId}/edit`, { actual: { durationMin: 14 }, reason: "更正" })).status, 200);
    assert.equal((await post(`/api/executions/${executionId}/pause`, { reason: "断电" })).status, 200);
    assert.equal((await post(`/api/executions/${executionId}/resume`, {})).status, 422);
    assert.equal((await post(`/api/executions/${executionId}/resume`, { humanDecision: "恢复供电，继续" })).status, 200);
    const smp = await post("/api/samples", { topicId, executionId, shortName: "S1", amount: { value: "5", unit: "mL" } });
    const sampleId = smp.data.sampleId as string;
    assert.equal((await post("/api/samples", { topicId, shortName: "S1", amount: { value: "1", unit: "mL" } })).status, 409);
    assert.equal((await post(`/api/samples/${sampleId}/states`, { amount: { value: "2", unit: "mL" }, handling: "分样" })).status, 200);
    const meas = await post("/api/measurements", { topicId, sampleId, sampleStateRevision: 1, value: "0.42", unit: "U/mL" });
    assert.equal(meas.status, 200);
    // 方案修订 → 影响登记（未配置 AI ⇒ failed+needs_review）
    const ed = await post(`/api/protocols/${protocolId}/edit`, { steps: [{ id: "s1", op: "配液", durationMin: 10 }, { id: "s2", op: "孵育", durationMin: 45 }], reason: "延长" });
    assert.equal(ed.data.revision, 2);
    const st1 = await get("/api/state");
    const impacts = st1.impacts as { status: string; assessment: string; change: { entityId: string } }[];
    assert.ok(impacts.some((i) => i.change.entityId === protocolId && i.status === "failed" && i.assessment === "needs_review"));
    assert.equal((await post(`/api/impacts/${impacts[0].change.entityId}/run`, {})).status, 422); // AI 未配置 ⇒ 拒绝评估（非“无影响”）
    // 模板检查：方案已变
    const chk2 = await get(`/api/templates/${templateId}/check`);
    assert.equal(chk2.changed, true);
    // OCR：图片归档 + 人工转录 + 确认
    const img = await post("/api/import/image", { name: "h.png", dataUrl: "data:image/png;base64,aHR0cA==", topicId });
    assert.equal(img.status, 200);
    const assetId = img.data.assetId as string;
    assert.equal((await post("/api/ocr", { assetId })).status, 422); // AI 未配置
    const mo = await post("/api/ocr/manual", { assetId, rawText: "37℃ 30min", fields: { 温度: "37" } });
    const ocrId = mo.data.ocrId as string;
    assert.equal((await post(`/api/ocr/${ocrId}/confirm`, { fields: { 温度: "38" } })).status, 422);
    assert.equal((await post(`/api/ocr/${ocrId}/confirm`, { fields: { 温度: "38" }, reason: "原图为38" })).status, 200);
    const st2 = await get("/api/state");
    assert.equal((st2.ocrs as { status: string }[])[0].status, "confirmed");
    assert.equal((st2.executions as { status: string }[])[0].status, "active");
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
  }
});
// S10-T1：行保存＝一次请求写实际步骤＋偏差；同键重试只追加一次；含非法则整批不半写
test("S10-A4 事件批量与幂等：steps+deviation 同笔；dedupeKey 重放；非法整批拒绝", async () => {
  const { createApp } = await import("../server.ts");
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, body: unknown) => {
    const res = await fetch(`${url}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${url}${p}`)).json() as Promise<Record<string, never>>;
  const count = async () => ((await get("/api/state")).executions as { events: unknown[] }[])[0].events.length;
  const flush = () => new Promise((r) => setTimeout(r, 10)); // POST 串行进提交队列；等一等再读计数
  try {
    const topicId = (await post("/api/topics", { name: "S10EV", researchQuestion: "Q" })).data.topicId as string;
    const protocolId = (await post("/api/protocols", { topicId, name: "方案", steps: [{ id: "s1", op: "配液", durationMin: 10 }] })).data.protocolId as string;
    const executionId = (await post("/api/executions", { topicId, protocolId })).data.executionId as string;
    await post(`/api/executions/${executionId}/confirm-preparation`, {});
    const base0 = await count();

    // 一次请求：实际步骤＋偏差，各自事件类型/引用保留
    const b = await post(`/api/executions/${executionId}/events`, { events: [
      { kind: "step", stepId: "s1", text: "实际执行 s1", actual: { durationMin: 12 }, dedupeKey: "row-s1" },
      { kind: "deviation", text: "温度偏高 2℃", dedupeKey: "row-s1-dev" },
    ] });
    assert.equal(b.status, 200);
    assert.equal((b.data.eventIds as string[]).length, 2);
    await flush();
    assert.equal(await count(), base0 + 2);
    const evs = ((await get("/api/state")).executions as { events: { kind: string; stepId?: string; text: string }[] }[])[0].events;
    assert.equal(evs[base0].kind, "step");
    assert.equal(evs[base0].stepId, "s1");
    assert.equal(evs[base0 + 1].kind, "deviation");

    // 重试同批（同去重键）→ 重放，不重复追加
    const b2 = await post(`/api/executions/${executionId}/events`, { events: [
      { kind: "step", stepId: "s1", text: "实际执行 s1", actual: { durationMin: 12 }, dedupeKey: "row-s1" },
      { kind: "deviation", text: "温度偏高 2℃", dedupeKey: "row-s1-dev" },
    ] });
    assert.equal(b2.data.replayed, true);
    await flush();
    assert.equal(await count(), base0 + 2);

    // 单条兼容：仍返回 eventId
    const single = await post(`/api/executions/${executionId}/events`, { kind: "note", text: "单条" });
    assert.equal(single.status, 200);
    assert.ok(single.data.eventId);

    // 批量原子性：含非法步骤 → 整批 422，不半写
    const before = await count();
    const bad = await post(`/api/executions/${executionId}/events`, { events: [
      { kind: "note", text: "合法" },
      { kind: "step", stepId: "ghost", text: "非法步骤" },
    ] });
    assert.equal(bad.status, 422);
    await flush();
    assert.equal(await count(), before);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
  }
});
