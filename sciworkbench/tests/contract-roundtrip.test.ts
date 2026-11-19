/**
 * 契约往返测试（R1 闸门）：前端真实请求体构造 → 后端纯函数。
 * 前端 payload 逻辑逐行复刻自 public/lib/pages/analysis.js（an-create / cand-save），
 * 防止前后端形状再次漂移（T47-D1：创建任务 422「不支持的上下文对象类型：」）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTopic, createSubquestion, importLiterature, importMeasurements } from "../services/app.ts";
import { createProtocol, startExecution, confirmPreparation, createSample, addMeasurement } from "../services/experiment.ts";
import { createAnalysisTask, setTaskCandidates } from "../services/analysis.ts";
import { emptyState, type LocusState } from "../store.ts";

async function world() {
  let s = emptyState();
  const t = createTopic(s, { name: "契约课题", researchQuestion: "漂移？" }); s = t.state;
  const q = createSubquestion(s, { topicId: t.topic.id, question: "能漂多久？" }); s = q.state;
  const p = createProtocol(s, {
    topicId: t.topic.id, name: "浸泡方案", purpose: "泡", criteria: "记天数",
    steps: [{ id: "s1", op: "浸泡", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "" }],
  }); s = p.state;
  const e = startExecution(s, { topicId: t.topic.id, protocolId: p.protocol.id }); s = e.state;
  s = confirmPreparation(s, e.execution.id).state;
  const smp = createSample(s, { topicId: t.topic.id, executionId: e.execution.id, shortName: "S1", amount: { value: "1", unit: "株" } }); s = smp.state;
  const m = addMeasurement(s, { topicId: t.topic.id, sampleId: smp.sample.id, sampleStateRevision: 1, value: "90", unit: "days" }); s = m.state;
  const tab = importMeasurements(s, { name: "c.csv", csv: "x,y\n1,2\n3,4", topicId: t.topic.id }); s = tab.state;
  const lit = await importLiterature(s, { name: "l.md", text: "段一\n\n段二", mode: "draft", topicId: t.topic.id }); s = lit.state;
  return { s, topicId: t.topic.id, subqId: q.subquestion.id, execId: e.execution.id, protoId: p.protocol.id, measId: m.measurement.id, tableId: tab.state.tables[0].id, cardIds: s.cards.map((c) => c.id) };
}

/** 复刻 analysis.js an-create：core＝勾选数据＋B5 自动推导；optional＝{ref,included} 包装（含未勾选）。 */
function frontendCreatePayload(w: Awaited<ReturnType<typeof world>>, opts: { dataKind: "table" | "measurement"; dataId: string; defChecked: boolean[]; opt2: { kind: string; id: string }[] }) {
  const state2 = w.s;
  const core: { kind: string; id: string }[] = [{ kind: opts.dataKind, id: opts.dataId }];
  const seen = new Set(core.map((r) => `${r.kind}:${r.id}`));
  for (const d of [...core]) {
    if (d.kind !== "measurement") continue;
    const m = state2.measurements.find((x) => x.id === d.id);
    const sm = m && state2.samples.find((x) => x.id === m.sampleId);
    if (sm?.executionId && !seen.has(`execution:${sm.executionId}`)) { seen.add(`execution:${sm.executionId}`); core.push({ kind: "execution", id: sm.executionId }); }
    const e = sm?.executionId && state2.executions.find((x) => x.id === sm.executionId);
    if (e && !seen.has(`protocol:${e.protocolId}`)) { seen.add(`protocol:${e.protocolId}`); core.push({ kind: "protocol", id: e.protocolId }); }
  }
  const optional = [
    ...w.cardIds.map((id, i) => ({ ref: { kind: "card", id }, included: opts.defChecked[i] === true })),
    ...opts.opt2.map((x) => ({ ref: { kind: x.kind, id: x.id }, included: true })),
  ];
  return { topicId: w.topicId, subquestionId: w.subqId, title: "往返任务", core, optional };
}

test("往返-1 前端真实请求体（含 included:false 与自动推导重叠）创建成功", async () => {
  const w = await world();
  // 测量为必选 → 自动推导执行/方案入核心；「其他可选」又勾了同一执行（重叠须去重不报错）
  const payload = frontendCreatePayload(w, { dataKind: "measurement", dataId: w.measId, defChecked: [true, false], opt2: [{ kind: "execution", id: w.execId }] });
  const r = createAnalysisTask(w.s, payload);
  assert.ok(r.task.id);
  assert.equal(r.task.core.length, 3); // 测量＋执行＋方案
  assert.equal(r.task.optional.length, 2); // 两张卡；重叠执行被去重
  assert.equal(r.task.optional.find((o) => o.ref.id === w.cardIds[0])?.included, true);
  assert.equal(r.task.optional.find((o) => o.ref.id === w.cardIds[1])?.included, false); // 未勾选保留为未选候选
});

test("往返-2 全部卡取消勾选（T47-D1 反例）仍创建成功", async () => {
  const w = await world();
  const payload = frontendCreatePayload(w, { dataKind: "table", dataId: w.tableId, defChecked: w.cardIds.map(() => false), opt2: [] });
  const r = createAnalysisTask(w.s, payload);
  assert.ok(r.task.optional.every((o) => o.included === false));
});

test("往返-3 旧扁平形状被明确拒绝（单一契约，不做双形状兼容）", async () => {
  const w = await world();
  assert.throws(
    () => createAnalysisTask(w.s, { topicId: w.topicId, title: "x", core: [{ kind: "table", id: w.tableId }], optional: [{ kind: "card", id: w.cardIds[0] }] as never }),
    /候选项须为 \{ref:\{kind,id\},included\} 结构/,
  );
});

test("往返-4 cand-save 请求体（t.optional 全量回传）保存成功", async () => {
  const w = await world();
  const payload = frontendCreatePayload(w, { dataKind: "table", dataId: w.tableId, defChecked: [true, false], opt2: [] });
  let s = createAnalysisTask(w.s, payload).state;
  const t = s.analysisTasks[0];
  // 复刻 cand-save：按当前 optional 顺序回传 {ref, included}
  const optional = t.optional.map((o, i) => ({ ref: o.ref, included: i === 1 }));
  s = setTaskCandidates(s, t.id, optional).state;
  assert.equal(s.analysisTasks[0].optional[0].included, false);
  assert.equal(s.analysisTasks[0].optional[1].included, true);
});