import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ref } from "../domain/types.ts";
import {
  type DependencyEdge,
  downstreamOf,
  dataLineageDownstream,
  supportDownstream,
  refKey,
} from "../domain/graph.ts";

const r = (kind: Ref["kind"], id: string, revision: number): Ref => ({ kind, id, revision });

test("refKey 固定 revision，指向不同 revision 视为不同引用", () => {
  assert.equal(refKey(r("Measurement", "M1", 1)), "Measurement:M1@1");
  assert.notEqual(refKey(r("Measurement", "M1", 1)), refKey(r("Measurement", "M1", 2)));
});

test("改一个数值：命中引用它的分析与报告块（多级传播）", () => {
  const measurement = r("Measurement", "M1", 1);
  const result = r("ResultRevision", "R1", 1);
  const block = r("ReportBlock", "P1", 1);
  const edges: DependencyEdge[] = [
    { from: measurement, to: result, edgeKind: "lineage", establishedBy: "run" },
    { from: result, to: block, edgeKind: "lineage", establishedBy: "human" },
  ];
  const downstream = downstreamOf(edges, measurement);
  assert.deepEqual(downstream.map(refKey), [refKey(result), refKey(block)]);
});

test("一个结果被多个报告复用：都能找到，不遗漏", () => {
  const result = r("ResultRevision", "R1", 1);
  const blocks = [r("ReportBlock", "P1", 1), r("ReportBlock", "P2", 1), r("ReportBlock", "P3", 1)];
  const edges: DependencyEdge[] = blocks.map((b) => ({
    from: result, to: b, edgeKind: "lineage" as const, establishedBy: "human" as const,
  }));
  const downstream = dataLineageDownstream(edges, result);
  assert.equal(downstream.length, 3);
});

test("数据链与科学依据链分开：lineage 过滤不返回 support 边", () => {
  const data = r("Measurement", "M1", 1);
  const result = r("ResultRevision", "R1", 1);
  const explanation = r("ReportBlock", "E1", 1);
  const card = r("EvidenceCard", "C1", 1);
  const edges: DependencyEdge[] = [
    { from: data, to: result, edgeKind: "lineage", establishedBy: "run" },
    { from: card, to: explanation, edgeKind: "support", establishedBy: "human" },
  ];
  assert.deepEqual(dataLineageDownstream(edges, data).map(refKey), [refKey(result)]);
  assert.deepEqual(supportDownstream(edges, card).map(refKey), [refKey(explanation)]);
});

test("无出边 → 无下游（缺依赖不伪装成有影响）", () => {
  assert.deepEqual(downstreamOf([], r("Measurement", "M9", 1)), []);
});
