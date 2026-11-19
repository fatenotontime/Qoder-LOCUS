/**
 * archify 缺口 A/C：
 * A 时长第2类「由量·速率计算」（用量 ÷ 速率 → 时长，来源=computed；缺速率不猜）；
 * C 确定性时间传播「等待余量先吸收延迟」（有余量的步骤先吸收上游延迟，不顺延其后）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTopic } from "../services/app.ts";
import { createProtocol, computeTimeShifts } from "../services/experiment.ts";
import { emptyState, durationSourceOf, type LocusState, type ProtocolStep } from "../store.ts";

function withTopic(): { state: LocusState; topicId: string } {
  const r = createTopic(emptyState(), { name: "T", researchQuestion: "Q" });
  return { state: r.state, topicId: r.topic.id };
}

test("A 由量·速率计算：用量÷速率 → 时长，来源=computed", () => {
  const { state, topicId } = withTopic();
  const p = createProtocol(state, { topicId, name: "P", steps: [{ op: "离心", durationSource: "computed", amount: 10, ratePerMin: 2 }] }).protocol;
  const st = p.revisions[0].steps[0];
  assert.equal(st.durationMin, 5);
  assert.equal(st.durationSource, "computed");
  assert.equal(durationSourceOf(st), "computed");
});

test("A 速率缺失/非正 → 时长未知（不猜）", () => {
  const { state, topicId } = withTopic();
  const p = createProtocol(state, { topicId, name: "P", steps: [{ op: "离心", durationSource: "computed", amount: 10, ratePerMin: 0 }] }).protocol;
  const st = p.revisions[0].steps[0];
  assert.equal(st.durationMin, null);
  assert.equal(durationSourceOf(st), "unknown");
});

const s = (id: string, durationMin: number | null, slackMin: number | null = null): ProtocolStep =>
  ({ id, op: id, params: {}, note: "", durationMin, estimated: false, branch: null, observeEnd: "", slackMin });

test("C 等待余量吸收延迟：其后步骤不被全量顺延；余量不足则部分吸收", () => {
  // s2 延长 +30；s3 有 20 分钟等待余量 → 吸收 20，s4 只顺延 10
  const r = computeTimeShifts([s("s1", 10), s("s2", 10), s("s3", 10), s("s4", 10)], [s("s1", 10), s("s2", 40), s("s3", 10, 20), s("s4", 10)]);
  const shift = (id: string) => r.timeShifts.find((t) => t.stepId === id)?.deltaMin;
  assert.equal(shift("s2"), 30);
  assert.equal(shift("s3"), 30);
  assert.equal(shift("s4"), 10); // 20 被 s3 的等待余量吸收
  assert.match(r.note, /等待余量吸收/);
});

test("C 无余量：照旧全量顺延", () => {
  const r = computeTimeShifts([s("s1", 10), s("s2", 10)], [s("s1", 10), s("s2", 25)]);
  assert.equal(r.timeShifts.find((t) => t.stepId === "s2")?.deltaMin, 15);
});
