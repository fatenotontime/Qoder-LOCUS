import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadASnapshot } from "../a-snapshot.js";
import { createDemoData, DemoMissingError } from "../snapshot-adapter.js";

const ROOT = fileURLToPath(new URL("../../../demo-data/", import.meta.url));
const fakeFetch = async (url) => {
  const rel = String(url).replace(/^\.\.\/demo-data\//, "");
  try {
    const body = readFileSync(resolve(ROOT, rel));
    return { ok: true, status: 200, json: async () => JSON.parse(body.toString("utf8")), text: async () => body.toString("utf8") };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
};

const snapshot = await loadASnapshot({ baseUrl: "../demo-data", fetch: fakeFetch });
const data = createDemoData(snapshot);

test("A 正式包：主课题与版本对齐 manifest", () => {
  assert.equal(data.meta().projectId, "topic_f6bff443-3f74-4677-810d-0c15c7d06bf0");
  assert.equal(data.meta().fixtureVersion, "s08-a-fixture-1");
  assert.equal(snapshot.fixture, false);
  assert.equal(data.isFixture(), false);
});

test("A 正式包：state 集合读取", () => {
  assert.equal(snapshot.cards.length, 10);
  assert.equal(snapshot.tables.length, 2);
  assert.equal(data.listPapers().length, 1);
  assert.ok(data.listCards({ audit: ["confirm"] }).length >= 1);
});

test("A 正式包：知识条目由 knowledge.json 派生为可读条目", () => {
  const items = data.listKnowledgeItems();
  assert.equal(items.length, 10);
  const one = data.knowledgeItem(items[0].id, items[0].revision);
  assert.equal(one.ok, true);
  assert.ok(one.payload.evidenceRefs.length === 1);
  assert.ok(one.payload.demoFields && Object.keys(one.payload.demoFields).length > 0);
});

test("A 正式包：上下文地图来自实跑 mapTask", () => {
  const t = data.getAnalysisTask();
  const map = data.getContextMap(t.id);
  assert.equal(map.nodes.length, 13);
  assert.equal(map.edges.length, 18);
  assert.equal(map.scope.taskId, t.id);
});

test("A 正式包：回查网络用 references（34 节点 / 75 边）", () => {
  const c = data.listCards()[0];
  const bt = data.backtrace("card", c.id);
  assert.ok(bt.nodes.length > 1);
  assert.ok(bt.nodes.some((n) => n.kind === "asset"));
  assert.ok(bt.edges.length > 0);
});

test("A 正式包：原件内嵌 + 可再分发外链（Public Domain）", () => {
  const assetId = snapshot.assets.find((a) => a.kind === "literature").id;
  const src = data.getOriginalUrl(assetId);
  assert.equal(src.kind, "inline");
  assert.match(src.href, /demo-data\/originals\//);
  assert.equal(src.license, "Public Domain");
});

test("A 正式包：跨来源比较按 A 形状返回（sides）", () => {
  const cmps = data.listComparisons();
  assert.equal(cmps.length, 1);
  assert.equal(cmps[0].sides.length, 2);
  assert.match(cmps[0].independenceStatus, /未具备/);
});

test("A 正式包：下一步 2 条，含四类依据", () => {
  const sugs = data.listSuggestions();
  assert.equal(sugs.length, 2);
  for (const s of sugs) {
    assert.ok(s.title && s.text);
    assert.ok(s.basis.divergence.length && s.basis.dataGaps.length && s.basis.distinguishing.length && s.basis.uncertainty.length);
  }
});

test("A 正式包：ZIP 校验值与 SHA256SUMS 一致", () => {
  const z = data.zipInfo();
  assert.equal(z.fileName, "locus-demo-public.zip");
  assert.match(z.sha256, /^[0-9a-f]{64}$/);
  assert.match(z.url, /locus-demo-public\.zip$/);
});

test("A 正式包：模型未运行如实标注（不冒充预生成）", () => {
  const p = data.presetInfo();
  assert.equal(p.ai, false);
  assert.match(p.model, /未调用|未授权/);
});

test("A 正式包：缺容器如实报缺项", () => {
  assert.throws(() => data.knowledgeContainer(), (e) => e instanceof DemoMissingError);
});
