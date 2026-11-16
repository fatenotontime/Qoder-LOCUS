/**
 * S02-T10 实验图契约：横向时间泳道布局模型 + 支路分叉/汇合锚点校验 + 未知时长下界（不按零累计）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeLanes, timeLabel } from "../public/lib/lanes.js";
import { createProtocol, editProtocol } from "../services/experiment.ts";
import { emptyState } from "../store.ts";
import { createTopic } from "../services/app.ts";

const step = (id, op, dur, extra = {}) => ({ id, op, params: {}, note: "", durationMin: dur, estimated: false, branch: null, observeEnd: "", ...extra });

function base() {
  let s = emptyState();
  const t = createTopic(s, { name: "图课题", researchQuestion: "Q" });
  return { s: t.state, topicId: t.topic.id };
}

test("未知时长不按零累计：其后偏移为下界 t≥；已知总时长不含未知", () => {
  const L = computeLanes([
    step("a", "配液", 10),
    step("b", "孵育", null),
    step("c", "读数", 5),
    step("d", "收尾", 8),
  ]);
  assert.deepEqual(L.main.map((m) => [m.offset, m.approx]), [[0, false], [10, false], [10, true], [15, true]]);
  assert.equal(L.totalKnown, 23);
  assert.equal(L.unknownCount, 1);
  assert.equal(timeLabel(10, false), "t≈10min");
  assert.equal(timeLabel(15, true), "t≥15min");
});

test("锚点支路：泳道 spans 分叉后一步至汇合前一步；无锚点横跨全程并明示", () => {
  const steps = [
    step("m1", "主线1", 10),
    step("m2", "主线2", 20),
    step("m3", "主线3", 5),
    step("m4", "主线4", 5),
    step("b1", "支路步骤", 15, { branch: "平行样", branchFrom: "m1", mergeInto: "m4" }),
    step("u1", "无锚点支路", null, { branch: "旧数据" }),
  ];
  const L = computeLanes(steps);
  const lane = L.lanes.find((x) => x.name === "平行样");
  assert.equal(lane.anchored, true);
  assert.equal(lane.forkIdx, 0);
  assert.equal(lane.mergeIdx, 3);
  assert.equal(lane.start, 1); // 与 m2/m3 并行
  assert.equal(lane.end, 2);
  const legacy = L.lanes.find((x) => x.name === "旧数据");
  assert.equal(legacy.anchored, false);
  assert.equal(legacy.start, 0);
  assert.equal(legacy.end, 3);
});

test("相邻分叉/汇合：泳道至少占一列，不塌缩", () => {
  const L = computeLanes([
    step("m1", "A", 5),
    step("m2", "B", 5),
    step("b1", "快支路", 2, { branch: "x", branchFrom: "m1", mergeInto: "m2" }),
  ]);
  const lane = L.lanes[0];
  assert.equal(lane.start, 1);
  assert.equal(lane.end, 1);
});

test("锚点校验：须指向主线步骤；分叉须在汇合之前；合法锚点入快照", () => {
  const { s, topicId } = base();
  const mk = (steps) => createProtocol(s, { topicId, name: "P", steps });
  // 指向支路步骤 → 拒
  assert.throws(() => mk([
    step("m1", "A", 5),
    step("b1", "B", 5, { branch: "x", branchFrom: "b2" }),
    step("b2", "C", 5, { branch: "x" }),
  ]), /锚点须指向主线步骤/);
  // 不存在的 id → 拒
  assert.throws(() => mk([step("m1", "A", 5), step("b1", "B", 5, { branch: "x", mergeInto: "ghost" })]), /锚点须指向主线步骤/);
  // 分叉在汇合之后 → 拒
  assert.throws(() => mk([
    step("m1", "A", 5), step("m2", "B", 5),
    step("b1", "C", 5, { branch: "x", branchFrom: "m2", mergeInto: "m1" }),
  ]), /分叉须在汇合之前/);
  // 合法 → 快照保留锚点
  const ok = mk([
    step("m1", "A", 5), step("m2", "B", 5), step("m3", "C", 5),
    step("b1", "并行", 8, { branch: "x", branchFrom: "m1", mergeInto: "m3" }),
  ]);
  const saved = ok.protocol.revisions[0].steps.find((x) => x.id === "b1");
  assert.equal(saved.branchFrom, "m1");
  assert.equal(saved.mergeInto, "m3");
  // 修订保留锚点；旧快照无锚点字段也不报错（追加式兼容）
  const ed = editProtocol(ok.state, ok.protocol.id, { reason: "改时长", steps: ok.protocol.revisions[0].steps.map((x) => (x.id === "m2" ? { ...x, durationMin: 9 } : x)) });
  assert.equal(ed.protocol.revisions[1].steps.find((x) => x.id === "b1").branchFrom, "m1");
  assert.equal(ed.protocol.revisions[0].steps.find((x) => x.id === "b1").branchFrom, "m1");
});