import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDemoData, DemoMissingError } from "../snapshot-adapter.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../fixture/snapshot.json", import.meta.url)), "utf8"));
const data = createDemoData(fixture);

test("主课题与元信息", () => {
  assert.equal(data.getMainTopic().id, "TP1");
  assert.equal(data.meta().fixtureVersion, "b-wire-0");
  assert.equal(data.isFixture(), true);
});

test("getState 同源：集合读取按明确过滤", () => {
  assert.equal(data.listPapers("TP1").length, 2);
  assert.equal(data.listCards({ paperId: "P1" }).length, 1);
  assert.equal(data.listCards({ audit: ["confirm"] }).length, 1);
  assert.equal(data.listCards({ audit: ["need_info"] }).length, 1);
});

test("getSource 与 sourceView 同形", () => {
  const s = data.getSource("A1");
  assert.equal(s.asset.id, "A1");
  assert.deepEqual(s.points.map((p) => p.kind), ["card"]);
  assert.equal(s.points[0].id, "C1");
});

test("原件定位：有站内文本优先内嵌，外链作来源标注", () => {
  const a1 = data.getOriginalUrl("A1");
  assert.equal(a1.kind, "inline");
  assert.match(a1.href, /https:\/\//);
  assert.equal(data.getOriginalUrl("A2").kind, "inline");
});

test("knowledgeItem 严格按 revision：缺版报缺项", () => {
  const r = data.knowledgeItem("KI1", 1);
  assert.equal(r.ok, true);
  assert.equal(r.payload.cardId, "C1");
  assert.deepEqual(r.availableRevisions, [1]);
  assert.throws(() => data.knowledgeItem("KI1", 2), (e) => e instanceof DemoMissingError && /r2/.test(e.path));
  assert.throws(() => data.knowledgeItem("KI1", undefined), (e) => e instanceof DemoMissingError);
});

test("knowledgeContainer 未导出即报缺项（不伪造 token）", () => {
  assert.throws(() => data.knowledgeContainer(), (e) => e instanceof DemoMissingError && e.path === "knowledge/container");
});

test("上下文地图只读实跑产物；缺失报缺项", () => {
  const m = data.getContextMap("AN1");
  assert.equal(m.nodes.length, 7);
  assert.ok(m.edges.length >= 4);
  assert.throws(() => data.getContextMap("NOPE"), (e) => e instanceof DemoMissingError);
});

test("回查网络：卡 → 原件/论文/知识项双向可达", () => {
  const r = data.backtrace("card", "C1");
  const keys = new Set(r.nodes.map((n) => n.key));
  assert.ok(keys.has("asset:A1"));
  assert.ok(keys.has("paper:P1"));
  assert.ok(keys.has("item:KI1"));
  assert.equal(r.start.id, "C1");
  assert.throws(() => data.backtrace("card", "NOPE"), (e) => e instanceof DemoMissingError);
  assert.throws(() => data.backtrace("bogus", "x"), (e) => e instanceof DemoMissingError);
});

test("报告块引用可达结果/执行/表/卡", () => {
  const rep = data.getReport("REP1");
  const refs = rep.blocks.flatMap((b) => b.refs.map((r) => `${r.kind}:${r.id}`));
  for (const k of ["execution:EX1", "table:T1", "result:R1", "card:C1"]) assert.ok(refs.includes(k), k);
  const bt = data.backtrace("result", "R1");
  assert.ok(bt.nodes.some((n) => n.key === "task:AN1"));
  assert.ok(bt.nodes.some((n) => n.key === "report:REP1"));
});

test("执行/步骤/测量链完整", () => {
  const e = data.getExecution();
  assert.equal(e.id, "EX1");
  assert.equal(data.executionSteps(e).length, 3);
  assert.equal(data.listSamples(e.id).length, 1);
  assert.equal(data.listMeasurements(e.id).length, 1);
  assert.equal(data.executionDeviations(e).length, 1);
});

test("ZIP 信息：文件名存在，未给下载地址", () => {
  const z = data.zipInfo();
  assert.match(z.fileName, /\.zip$/);
  assert.equal(z.url, null);
});

test("只读：适配器没有写方法", () => {
  const writey = Object.keys(data).filter((k) => /^(create|update|review|add|set|import|run|send|adopt|restore|delete|edit|append|cancel|confirm|apply)/.test(k));
  assert.deepEqual(writey, []);
  assert.ok(!("getState" in data), "不包装接受更新的假 getState");
});

test("未知对象：给出具体路径", () => {
  assert.throws(() => data.getPaper("NOPE"), (e) => e instanceof DemoMissingError && e.path === "paper:NOPE");
  assert.throws(() => data.getAsset("NOPE"), (e) => e instanceof DemoMissingError && e.path === "asset:NOPE");
});
