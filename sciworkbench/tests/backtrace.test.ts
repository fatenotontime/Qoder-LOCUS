import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backtraceChain,
  canOnlyReachFileLevel,
  chainPassesThrough,
  traceLabel,
} from "../domain/backtrace.ts";

test("内部处理结果：经过 Run → 原始表", () => {
  assert.ok(chainPassesThrough("internal_result", "Run"));
  assert.ok(chainPassesThrough("internal_result", "SourceAsset"));
});

test("文献数值：到 EvidenceCard，不经过 Run/Measurement", () => {
  assert.ok(chainPassesThrough("literature_value", "EvidenceCard"));
  assert.equal(chainPassesThrough("literature_value", "Run"), false);
  assert.equal(chainPassesThrough("literature_value", "Measurement"), false);
});

test("实验背景：到 Topic/子问题，根本不回到测量", () => {
  assert.ok(chainPassesThrough("experimental_context", "Topic"));
  assert.equal(chainPassesThrough("experimental_context", "Measurement"), false);
});

test("原始测量：经 SampleState → Execution → ProtocolRevision", () => {
  assert.deepEqual(
    backtraceChain("raw_measurement").map((s) => s.kind),
    ["Measurement", "SampleState", "Execution", "ProtocolRevision"],
  );
});

test("作者外部结果：只能到文件级，不硬造 Run", () => {
  assert.equal(canOnlyReachFileLevel("author_external_result"), true);
  assert.equal(chainPassesThrough("author_external_result", "Run"), false);
});

test("不同来源类型的链不同（不是一条固定串联链）", () => {
  assert.notEqual(traceLabel("internal_result"), traceLabel("literature_value"));
  assert.notEqual(traceLabel("internal_result"), traceLabel("experimental_context"));
});
