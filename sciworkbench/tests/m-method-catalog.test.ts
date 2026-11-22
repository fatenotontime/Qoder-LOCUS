/**
 * M3 方法与前提目录测试：五类条目完整性、判断三态、局部阻断、
 * 快照可序列化且修改目录后旧快照不漂移。合成事实来自 fixtures/m-method/facts。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  METHOD_IDS,
  getEntry,
  entryHash,
  catalogSnapshot,
  serializeEvaluation,
  evaluateMethod,
  evaluateAll,
  type MethodFacts,
  type MethodId,
} from "../services/method-catalog.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/m-method/facts/${f}`, import.meta.url), "utf8"));
const ready = load("ready.json") as Record<MethodId, MethodFacts>;
const gaps = load("gaps.json") as Record<string, MethodFacts>;

test("M3-B01 五类条目字段齐全、工具/步骤/产物/验收/误用具体", () => {
  assert.deepEqual([...METHOD_IDS].sort(), ["descriptive_stats", "independent_two_group", "linear_fit", "paired_pre_post", "trend_plot"]);
  for (const id of METHOD_IDS) {
    const e = getEntry(id);
    assert.ok(e.title.length > 0 && e.appliesTo.length > 0, `${id} 标题/适用`);
    assert.ok(e.required.length >= 3, `${id} 前提项`);
    assert.ok(e.toolPath.length >= 1 && e.toolPath.every((t) => t.functions.length >= 1), `${id} 工具函数`);
    assert.ok(e.steps.length >= 3, `${id} 步骤`);
    assert.ok(e.artifacts.length >= 1 && e.acceptance.length >= 1 && e.misuse.length >= 1, `${id} 产物/验收/误用`);
    assert.ok(e.example.description.length > 0, `${id} 示例`);
    assert.equal(e.runtimeStatus, "verified", `${id} 实跑状态`);
    assert.ok(e.toolVersion.length > 0, `${id} 工具版本`);
  }
});

test("M3-B02 每类前提满足→ready 且给出可执行操作；序列化稳定", () => {
  for (const id of METHOD_IDS) {
    const j = evaluateMethod(id, ready[id]);
    assert.equal(j.status, "ready", `${id} 应 ready，实为 ${j.status}`);
    assert.ok(j.executableSteps && j.executableSteps.length >= 3, `${id} 可执行步骤`);
    assert.equal(j.gaps.length, 0);
    assert.equal(j.entryHash, entryHash(getEntry(id)));
  }
  const snap = evaluateAll(ready.descriptive_stats);
  assert.equal(serializeEvaluation(snap), serializeEvaluation(snap));
});

test("M3-B02 修改目录不影响已存快照（旧快照不漂移）", () => {
  const snap = evaluateAll(ready.descriptive_stats);
  const before = snap.catalog.entries.find((e) => e.id === "descriptive_stats")!.hash;
  const edited = { ...getEntry("descriptive_stats"), version: "999", title: "描述统计（改）" };
  assert.notEqual(entryHash(edited), before); // 改动目录确会改变其 hash
  assert.equal(snap.catalog.entries.find((e) => e.id === "descriptive_stats")!.hash, before); // 旧快照保持原值
  assert.equal(serializeEvaluation(snap), serializeEvaluation(evaluateAll(ready.descriptive_stats)));
});

test("M3-B03 关键缺口：独立性未知不给完整两组检验步骤", () => {
  const j = evaluateMethod("independent_two_group", gaps.independence_unknown);
  assert.equal(j.status, "needs_info");
  assert.equal(j.executableSteps, null); // 不得同时标缺独立性又下发完整步骤
  assert.ok(j.gaps.some((g) => g.key === "independence"));
  assert.ok(j.questions.length >= 1);
});

test("M3-B03 常量 x→线性拟合 not_applicable；无配对键不按行配对；两组非独立 n/a", () => {
  const lf = evaluateMethod("linear_fit", gaps.constant_x);
  assert.equal(lf.status, "not_applicable");
  assert.match(lf.notApplicableReason ?? "", /x 无变化/);
  const p = evaluateMethod("paired_pre_post", gaps.unpaired);
  assert.equal(p.status, "not_applicable");
  assert.match(p.notApplicableReason ?? "", /配对/);
  assert.equal(evaluateMethod("independent_two_group", gaps.dependent_groups).status, "not_applicable");
});

test("M3-B03 机器推断未确认不自动视为确认", () => {
  const j = evaluateMethod("descriptive_stats", gaps.inferred_type);
  assert.equal(j.status, "needs_info");
  assert.equal(j.gaps[0].key, "units");
  assert.equal(j.gaps[0].status, "inferred");
});

test("M3-B04 局部阻断：独立性未知而整体描述充分 → 描述 ready、两组 needs_info", () => {
  const facts = gaps.independence_unknown;
  assert.equal(evaluateMethod("descriptive_stats", facts).status, "ready");
  assert.equal(evaluateMethod("independent_two_group", facts).status, "needs_info");
});

test("M3 快照：M2 画像缺失显式标注，有则原样带上", () => {
  const noProfile = evaluateAll(ready.descriptive_stats);
  assert.equal(noProfile.profileMissing, true);
  assert.equal(noProfile.profileRef, null);
  const withProfile = evaluateAll(ready.descriptive_stats, { profileRef: { version: "m2/v1", hash: "abc123" } });
  assert.equal(withProfile.profileMissing, false);
  assert.equal(withProfile.profileRef?.hash, "abc123");
});

test("M3 目录快照 hash 覆盖五类且与逐条 hash 一致", () => {
  const cs = catalogSnapshot();
  assert.equal(cs.entries.length, 5);
  for (const e of cs.entries) assert.equal(e.hash, entryHash(getEntry(e.id)));
});
