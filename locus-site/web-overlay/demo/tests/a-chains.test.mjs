import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadASnapshot } from "../a-snapshot.js";
import { createDemoData } from "../snapshot-adapter.js";

const ROOT = fileURLToPath(new URL("../../../demo-data/", import.meta.url));
const fakeFetch = async (url) => {
  const rel = String(url).replace(/^\.\.\/demo-data\//, "");
  try {
    const body = readFileSync(resolve(ROOT, rel));
    return { ok: true, status: 200, json: async () => JSON.parse(body.toString("utf8")), text: async () => body.toString("utf8") };
  } catch { return { ok: false, status: 404, json: async () => ({}), text: async () => "" }; }
};

const fixture = JSON.parse(readFileSync(resolve(ROOT, "fixture.json"), "utf8"));
const data = createDemoData(await loadASnapshot({ baseUrl: "../demo-data", fetch: fakeFetch }));

// chainA：文献 → 原件定位 → 附件 → 卡片 → 知识条目（正式库为 knowledge.json）
test("chainA：文献/原件/附件/卡片逐环可解析，引文逐字一致", () => {
  const a = fixture.chainA_literatureToKnowledge;
  assert.equal(data.getPaper(a.paper.id).id, a.paper.id);
  assert.equal(data.getSource(a.original.assetId).asset.id, a.original.assetId);
  assert.equal(data.getAttachment(a.attachment.id).assetId, a.original.assetId);
  const card = data.getCard(a.card.id);
  assert.equal(card.locator.sectionQuote, a.original.locator.quote, "卡片定位引文 = 原件定位引文");
  // 正式知识条目：由 cardId 关联（fixture 里的 kitem_* 为简化映射）
  const item = data.listKnowledgeItems().find((e) => e.payload.cardId === a.card.id);
  assert.ok(item, "存在关联此卡的正式知识条目");
  const read = data.knowledgeItem(item.id, item.revision);
  assert.equal(read.payload.evidenceRefs.length, 1);
  const asset = data.getOriginalUrl(a.original.assetId);
  assert.equal(asset.kind, "inline");
  assert.ok(asset.text.includes(a.original.locator.quote), "原件文本逐字含引文");
});

test("chainA：回查网络从卡可达原件与论文", () => {
  const a = fixture.chainA_literatureToKnowledge;
  const bt = data.backtrace("card", a.card.id);
  const keys = new Set(bt.nodes.map((n) => n.key));
  assert.ok(keys.has(`asset:${a.original.assetId}`));
  assert.ok(keys.has(`paper:${a.paper.id}`));
});

// chainB：结果 → 处理记录(测量) → 表行 → 执行 → 原件
test("chainB：结果/测量/表行/执行/原件逐环可解析", () => {
  const b = fixture.chainB_resultToOriginal;
  const result = data.listResults(data.getAnalysisTask()).find((r) => r.id === b.result.id);
  assert.ok(result, "结果存在");
  assert.ok(result.assetIds.includes(b.result.assetIds[0]));
  const meas = data.listMeasurements().find((m) => m.id === b.processingSample.measurementId);
  assert.equal(meas.value, b.processingSample.value);
  assert.equal(meas.unit, b.processingSample.unit);
  const table = data.getTable(b.tableRow.tableId);
  assert.deepEqual(table.rows[b.tableRow.rowIndex], b.tableRow.row, "表行原样一致");
  assert.deepEqual(table.columns, b.tableRow.columns);
  const exec = data.listExecutions().find((e) => e.id === b.execution.id);
  assert.equal(exec.protocolId, b.execution.protocolId);
  assert.ok(data.getAsset(b.original.assetId), "元件存在");
});

test("chainB：回查网络从结果可达任务/表/执行/方案/原件", () => {
  const b = fixture.chainB_resultToOriginal;
  const bt = data.backtrace("result", b.result.id);
  const keys = new Set(bt.nodes.map((n) => n.key));
  for (const k of [`task:${b.result.taskId}`, `execution:${b.execution.id}`, `protocol:${b.execution.protocolId}`, `asset:${b.original.assetId}`]) {
    assert.ok(keys.has(k), k);
  }
});
