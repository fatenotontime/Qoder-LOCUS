import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planForChange,
  transition,
  displayAssessment,
  normalizeAssessment,
  type ImpactState,
} from "../domain/impact.ts";

test("改标题/备注：不重算、不误报", () => {
  const plan = planForChange("title_or_note");
  assert.equal(plan.recompute, false);
  assert.equal(plan.newRun, false);
  assert.equal(plan.reviewAnalysis, false);
  assert.equal(plan.reviewInterpretation, false);
});

test("改方法/参数/代码：建新 Run，不直接重算数值", () => {
  const plan = planForChange("method_or_params");
  assert.equal(plan.newRun, true);
  assert.equal(plan.recompute, false);
});

test("改判据/目标：解释复核，数值不必强制重算", () => {
  const plan = planForChange("criteria_or_goal");
  assert.equal(plan.reviewInterpretation, true);
  assert.equal(plan.recompute, false);
});

test("状态机：pending → running → completed", () => {
  let s: ImpactState = { status: "pending" };
  s = transition(s, { type: "start" });
  assert.equal(s.status, "running");
  s = transition(s, { type: "complete", assessment: "impact", snapshotHash: "h1" });
  assert.equal(s.status, "completed");
  assert.equal(s.assessment, "impact");
});

test("失败 ≠ 无影响：failed 不得展示 no_supported_impact_found", () => {
  let s: ImpactState = { status: "pending" };
  s = transition(s, { type: "start" });
  s = transition(s, { type: "fail" });
  assert.equal(s.status, "failed");
  assert.notEqual(displayAssessment(s), "no_supported_impact_found");
  assert.equal(displayAssessment(s), "failed");
});

test("normalizeAssessment 把非法组合纠正为 needs_review", () => {
  const bad: ImpactState = { status: "failed", assessment: "no_supported_impact_found" };
  const fixed = normalizeAssessment(bad);
  assert.equal(fixed.assessment, "needs_review");
});

test("未分析/进行中：显示 not_analyzed，不暗示无影响", () => {
  assert.equal(displayAssessment({ status: "pending" }), "not_analyzed");
  assert.equal(displayAssessment({ status: "running" }), "not_analyzed");
});

test("新改动到达：旧分析 stale，且旧的无影响结论降级为 needs_review", () => {
  let s: ImpactState = { status: "running" };
  s = transition(s, { type: "complete", assessment: "no_supported_impact_found", snapshotHash: "h1" });
  s = transition(s, { type: "invalidate" });
  assert.equal(s.status, "stale");
  assert.equal(displayAssessment(s), "needs_review");
});

test("终态不可被 start 复位（不覆盖）", () => {
  const done: ImpactState = { status: "completed", assessment: "impact", snapshotHash: "h" };
  assert.equal(transition(done, { type: "start" }).status, "completed");
});
