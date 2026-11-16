import { test } from "node:test";
import assert from "node:assert/strict";
import type { Locator, Ref } from "../domain/types.ts";
import { createTopic, createSubquestion, missingForTask, TopicError } from "../domain/topic.ts";
import {
  type LiteratureEvidenceCard,
  type CardReview,
  LiteratureError,
  reviewCard,
  candidateState,
  canAdoptFormally,
  adoptForTask,
  batchReviewPreview,
  batchConfirm,
  dedupAction,
  mapName,
  freezeComparison,
  newMaterialReminder,
  summarize,
  unbackedObservations,
  independentEvidenceCount,
  endorse,
} from "../domain/literature.ts";

const asset: Ref<"SourceAsset"> = { kind: "SourceAsset", id: "A1", revision: 1 };
const taskRef: Ref = { kind: "AnalysisTask", id: "T1", revision: 1 };
const loc = (page?: number): Locator => ({ assetId: "A1", revision: 1, kind: "pdf", page });

function card(id: string, review: CardReview, locator: Locator = loc(3)): LiteratureEvidenceCard {
  return {
    id,
    revision: 1,
    sourceRef: asset,
    locator,
    rawText: "raw",
    extracted: { fields: { value: "1" }, units: ["mM"] },
    unknowns: [],
    review,
  };
}

// T01 最小课题
test("T01 最小课题：仅名称+研究问题即可建，空值拒绝", () => {
  const t = createTopic("酶动力学", "温度与pH如何影响活性");
  assert.equal(t.name, "酶动力学");
  assert.throws(() => createTopic("", "q"), TopicError);
  assert.throws(() => createTopic("n", "  "), TopicError);
});

test("T01 执行任务才查缺项，探索性不强迫完整", () => {
  const t = createTopic("课题", "问题");
  assert.deepEqual(missingForTask(t, ["design", "criteria"]), ["design", "criteria"]);
  const s = createSubquestion(t.id, "探索：是否存在阈值", "exploratory");
  assert.equal(s.kind, "exploratory");
});

// T10 三个维度分开 + 跳过保持未复核 + 组审
test("T10 核对/重要/采用分开；跳过保持未复核，不判不重要", () => {
  const c0 = card("C1", { audit: "skip" }, loc(2));
  assert.equal(candidateState(c0), "unreviewed");
  const c1 = reviewCard(c0, "confirm", { importance: "high" });
  assert.equal(candidateState(c1), "reviewed");
  assert.equal(c1.review.importance, "high");
  // 调整重要程度不改变核对结论
  const c2 = reviewCard(c1, "confirm", { importance: "low" });
  assert.equal(c2.review.audit, "confirm");
  assert.equal(c2.review.importance, "low");
});

test("T10 关键数值修改必须填原因", () => {
  const c = card("C1", { audit: "confirm" });
  assert.throws(() => reviewCard(c, "confirm", { keyValueChanged: true }), LiteratureError);
  const ok = reviewCard(c, "confirm", { keyValueChanged: true, reason: "原图小数点为0.5" });
  assert.equal(ok.review.reason, "原图小数点为0.5");
});

test("T10 组审必须先展示共享条件/缺项/异常，未 ack 不得整组确认", () => {
  const cards = [card("C1", { audit: "need_info" }), card("C2", { audit: "need_info" }, { assetId: "A1", revision: 1 })];
  const preview = batchReviewPreview(cards);
  assert.equal(preview.requiresAck, true);
  assert.ok(preview.missing.includes("C2"));
  assert.throws(() => batchConfirm(cards, false), LiteratureError);
  const done = batchConfirm(cards, true);
  assert.ok(done.every((c) => c.review.audit === "confirm"));
});

// T11 定位
test("T11 缺定位不得用于正式判断/采用", () => {
  const noLoc = card("C1", { audit: "confirm" }, { assetId: "A1", revision: 1 });
  assert.equal(canAdoptFormally(noLoc), false);
  assert.throws(() => adoptForTask(noLoc, taskRef), LiteratureError);
  const withLoc = card("C2", { audit: "confirm" }, loc(5));
  assert.equal(canAdoptFormally(withLoc), true);
  assert.equal(candidateState(adoptForTask(withLoc, taskRef)), "adopted");
});

// T12 查重
test("T12 同 hash 拒收；同 DOI 不同内容=新版本；题名相似仅提示", () => {
  assert.equal(dedupAction({ fileHash: "h1" }, { fileHash: "h1" }), "reject_exact");
  assert.equal(
    dedupAction({ fileHash: "h1", doi: "10.1/x", contentHash: "c1" }, { fileHash: "h2", doi: "10.1/x", contentHash: "c2" }),
    "same_doi_new_version",
  );
  assert.equal(dedupAction({ fileHash: "h1", title: "Study of X" }, { fileHash: "h2", title: "study of x" }), "title_similar_hint");
  assert.equal(dedupAction({ fileHash: "h1", doi: "10.1/a" }, { fileHash: "h2", doi: "10.1/b" }), "distinct");
});

// T13 同源转引
test("T13 综述转引不计多份独立证据", () => {
  const primary = card("P", { audit: "confirm" });
  const secondary: LiteratureEvidenceCard = { ...card("S", { audit: "confirm" }), secondaryCitation: true };
  assert.equal(independentEvidenceCount([primary, secondary]), 1);
});

// T14 命名映射
test("T14 命名映射须有依据；原名保留", () => {
  assert.throws(() => mapName("α相", "alpha", ""), LiteratureError);
  const m = mapName("α相", "alpha", "来源表1 术语表");
  assert.equal(m.original, "α相");
  assert.equal(m.basis, "来源表1 术语表");
});

// T15 比较快照与新增提醒
test("T15 比较固定快照；新文献只提醒不自动重比", () => {
  const snap = freezeComparison({
    dataRevision: "r1", filters: ["pH=7"], conversions: ["mM→M"], exclusions: [], nameMappings: [],
  });
  assert.equal(snap.snapshotId, "cmp_r1_pH=7");
  assert.equal(newMaterialReminder([snap], [card("C1", { audit: "confirm" })]), true);
  assert.equal(newMaterialReminder([], [card("C1", { audit: "confirm" })]), false);
});

// T16 汇总分层
test("T16 观察/分歧/假设分层；人工认可不升级事实；观察须引证据", () => {
  const claims = [
    { layer: "observation" as const, text: "在pH7活性最高", evidenceRefs: ["C1"] },
    { layer: "observation" as const, text: "无引用断言", evidenceRefs: [] },
    { layer: "disagreement" as const, text: "两报道不同", evidenceRefs: ["C2"] },
    { layer: "assumption" as const, text: "可能由构象变化引起", evidenceRefs: [] },
  ];
  const grouped = summarize(claims);
  assert.equal(grouped.observation.length, 2);
  assert.equal(grouped.disagreement.length, 1);
  assert.equal(grouped.assumption.length, 1);
  assert.equal(unbackedObservations(claims).length, 1);
  const endorsed = endorse(grouped.assumption[0]);
  assert.equal(endorsed.layer, "assumption");
  assert.equal(endorsed.endorsed, true);
});
