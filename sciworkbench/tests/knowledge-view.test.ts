/**
 * E5 纯渲染与 API 往返结构测试（合同 §9：knowledge-view.test.ts）。
 * 只验结构/渲染口径与路由往返形状，**不替代浏览器验收**（§12.3）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { JsonFileStore, emptyState, type LocusState } from "../store.ts";
import { createTopic, makeAsset, importMeasurements } from "../services/app.ts";
import { archiveSourceVersion, currentSourceRef, currentViewId, sourcePayload, createKnowledgeDataset, reviewKnowledgeDataset, createKnowledgeMapping, reviewKnowledgeMapping, freezeKnowledge } from "../services/knowledge-base.ts";
import { snapshotWiki, snapshotCsv, snapshotSchemaFiles, exportKnowledge, buildKnowledgePackage, safeFileName, safeText } from "../services/knowledge-export.ts";
import { createApp } from "../server.ts";
import type { SourceRef } from "../domain/knowledge.ts";

const tmp = (n: string) => join(tmpdir(), `locus-kview-${n}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

function seed(): { state: LocusState; topicId: string; datasetId: string; snapshot: ReturnType<typeof freezeKnowledge>["snapshot"] } {
  const t = createTopic(emptyState(), { name: "合成课题甲", researchQuestion: "Q" });
  const topicId = t.topic.id;
  let s: LocusState = t.state;
  const asset = makeAsset("literature", "exp.md", "合成对象A在 1 d 与 24 h 下培养。", topicId);
  s = { ...s, assets: [...s.assets, asset] };
  const aRef = currentSourceRef(s, "asset", asset.id)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, aRef, sourcePayload(s, "asset", asset.id)) };
  s = importMeasurements(s, { name: "t.csv", csv: "时间,批注\n24,第一轮\n48,延长\n", topicId }).state;
  const tableId = s.tables[0].id;
  const tRef = currentSourceRef(s, "table", tableId)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, tRef, sourcePayload(s, "table", tableId)) };
  const ds = createKnowledgeDataset(s, {
    topicId, sourceRef: tRef, selection: { rowIndices: [0, 1], columnIndices: [0] },
    columns: [{ index: 0, originalName: "时间", standardId: "m", type: "scalar", unit: "h" }],
    rowBindings: [{ rowIndex: 0 }, { rowIndex: 1 }],
  });
  s = reviewKnowledgeDataset(ds.state, ds.dataset.id, { baseRevision: 1, columnIndices: [0], decision: "confirmed", basis: "核对" }).state;
  const mp = createKnowledgeMapping(s, { topicId, metricId: "m", definition: "培养时间", valueKind: "scalar", targetUnit: "h", conversion: { kind: "scaleOffset", factor: "24", offset: "0", fromUnit: "d", toUnit: "h" }, basis: "1 d = 24 h" });
  s = reviewKnowledgeMapping(mp.state, mp.mapping.id, { baseRevision: 1, decision: "confirmed", basis: "核对" }).state;
  s = { ...s, knowledge: { ...s.knowledge, items: [...s.knowledge.items, {
    id: "ki_one", revision: 1, createdAt: "t", updatedAt: "t", history: [],
    payload: {
      contentType: "observation", nature: "observation", text: "合成对象A在 24 h 下培养",
      subject: { raw: "合成对象A" }, predicate: { raw: "培养时间", metricId: "m" },
      value: { kind: "scalar", raw: "24 h", value: "24", unit: "h" }, contextRefs: [], evidenceRefs: [], sourceRefs: [aRef],
      origin: { sourceClass: "literature_report", createdBy: "model", secondaryCitation: false },
      scopeText: "", unknowns: [], topicIds: [topicId], subquestionIds: [], review: { status: "confirmed" },
    },
  }] } };
  const view = freezeKnowledge(s, { topicId, viewId: currentViewId(s, topicId) });
  return { state: s, topicId, datasetId: ds.dataset.id, snapshot: view.snapshot };
}

// ── 纯渲染：wiki 固定页型、CSV 列固定、schema/data dictionary 可解析 ────
test("E5-V 纯渲染：wiki 六页固定页型与相对链接；CSV 列固定；schema 与数据字典可解析", () => {
  const { snapshot } = seed();
  const wiki = snapshotWiki(snapshot);
  assert.deepEqual(wiki.pages.map((p) => p.file), ["00-index.md", "01-subquestions.md", "02-themes.md", "03-comparisons.md", "04-sources.md", "05-gaps.md"]);
  for (const p of wiki.pages) assert.ok(p.markdown.startsWith("# "), `${p.file} 有标题`);
  assert.ok(wiki.pages[0].markdown.includes("./03-comparisons.md"), "包内为相对链接");
  assert.ok(wiki.pages[0].markdown.includes(snapshot.contentHash.slice(0, 16)), "首页标注内容 hash");

  const csv = snapshotCsv(snapshot, { datasetId: (snapshot.content.datasetRows ?? [])[0].datasetRef.id });
  assert.ok(csv.content.split("\n")[0].includes("operand_type"));
  assert.equal(csv.rows, 2, "两条观察");
  const { schema, dictionary } = snapshotSchemaFiles();
  assert.equal(JSON.parse(schema).schemaVersion, 1);
  assert.ok(JSON.parse(dictionary).valueKinds.includes("scalar"));
  assert.equal(safeText("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
  assert.equal(expectCode(() => safeFileName("../x")), "unsafe_filename");
});

// ── 回归：来源引用按 SourceRef 自身口径渲染（kind:id@version），不退化为 @rundefined ──
test("E5-V 回归：04-sources.md 的来源引用按 SourceRef.version 渲染，无 rundefined", () => {
  const { snapshot } = seed();
  const wiki = snapshotWiki(snapshot);
  const sources = wiki.pages.find((p) => p.file === "04-sources.md")!;
  assert.ok(sources.markdown.length > 0);
  assert.ok(!sources.markdown.includes("rundefined"), "来源引用不得渲染为 @rundefined");

  const sourceEntries = Object.entries(snapshot.content.referenceMap).filter(([, e]) => e.kind === "source");
  assert.ok(sourceEntries.length >= 1, "快照应含至少一个来源引用 token");
  for (const [token, e] of sourceEntries) {
    const r = e.ref as SourceRef;
    assert.ok(typeof r.version === "string" && r.version.length > 0, `来源 ${token} 应有版本`);
    assert.ok(
      sources.markdown.includes(`${r.kind}:${r.id}@${r.version}`),
      `来源 ${token} 应按 kind:id@version 渲染（${r.kind}:${r.id}@${r.version}）`,
    );
  }
});

// ── API 往返：view → freeze → snapshot 读 → export → references（形状）────
test("E5-V API 往返：view/freeze/snapshot/export/references 结构", async () => {
  const { state, topicId } = seed();
  const path = tmp("api");
  await new JsonFileStore(path).save(state);
  const app = await createApp(new JsonFileStore(path));
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const get = async (p: string) => (await fetch(base + p)).json() as Promise<Record<string, unknown>>;
  const post = async (p: string, body: unknown) => {
    const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  try {
    const view = await get(`/api/knowledge/view?source=current&topicId=${topicId}`);
    assert.equal(view.ok, true);
    assert.equal((view.scope as { mode: string }).mode, "formal");
    assert.equal((view.items as unknown[]).length, 1);
    assert.ok(view.referenceMap);

    const fr = await post("/api/knowledge/snapshots", { topicId, viewId: view.viewId as string });
    assert.equal(fr.status, 200, JSON.stringify(fr.body));
    const snapId = fr.body.snapshotId as string;
    const snap = await get(`/api/knowledge/snapshots/${snapId}`);
    assert.ok(snap.snapshot);
    const content = (snap.snapshot as { content: { items: unknown[]; referenceMap: Record<string, unknown>; datasetRows: { datasetRef: { id: string } }[] } }).content;
    assert.equal(content.items.length, 1);
    assert.equal(content.datasetRows.length, 1);

    // 未授权导出 → 403；授权后可导出（zip 为二进制，用 raw fetch 验头部）
    const denied = await fetch(`${base}/api/knowledge/snapshots/${snapId}/export?format=json`);
    assert.equal(denied.status, 403);
    for (const r of (snap.snapshot as { sourceVersionRefs: { kind: string; id: string }[] }).sourceVersionRefs) {
      const pol = await post("/api/knowledge/source-policies", { sourceKind: r.kind, sourceId: r.id, allowLocalRead: true, allowExport: true, allowAiSend: false, reason: "带出" });
      assert.equal(pol.status, 200);
    }
    const zipRes = await fetch(`${base}/api/knowledge/snapshots/${snapId}/export?format=zip`);
    assert.equal(zipRes.headers.get("content-type"), "application/zip");
    assert.equal(Buffer.from(await zipRes.arrayBuffer()).subarray(0, 2).toString("latin1"), "PK");

    const tok = Object.keys(content.referenceMap)[0];
    const ref = await get(`/api/knowledge/references/${tok}?snapshotId=${snapId}`);
    assert.equal(ref.ok, true);
    assert.ok(ref.ref && ref.label);

    // 快照读取按固定版本；不退回当前库
    const itemId = (content.items[0] as { id: string }).id;
    const bySnap = await get(`/api/knowledge/items/${itemId}?revision=1&snapshotId=${snapId}`);
    assert.equal(bySnap.ok, true);

    // E6-A 容器数据接线（只读）
    const container = await get(`/api/knowledge/container?source=current&topicId=${topicId}`);
    assert.equal(container.ok, true);
    assert.equal((container.elements as { kind: string }[]).filter((e) => e.kind === "item").length, 1);
    assert.equal((container.elements as { kind: string }[]).filter((e) => e.kind === "dataset").length, 1);
    assert.equal((container.totals as { datasets: number }).datasets, 1, "知识项数与数据集数分开");
    assert.ok((container.counts as { totalKnown: number }).totalKnown >= 1);
    assert.ok((container.sources as unknown[]).length >= 1, "来源 token 可回查");
    const missing = await get(`/api/knowledge/pipeline/kr_missing`);
    assert.equal((missing as { code?: string }).code, "run_missing");

    // 包结构（纯函数）：manifest 列每文件 sha256/schema、NOTICE 列排除附件
    const pkg = buildKnowledgePackage(snap.snapshot as never);
    const manifest = pkg.manifest as { files: { file: string; sha256: string; schema: string }[]; excludedAttachments: unknown[] };
    assert.ok(manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && !!f.schema));
    assert.ok(pkg.notice.includes("NOTICE"));
    const wikiOut = exportKnowledge(snap.snapshot as never, { format: "wiki" });
    assert.ok(String(wikiOut.data).includes("# "));
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    rmSync(path, { force: true });
  }
});

function expectCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return String((e as { details?: { code?: string } }).details?.code ?? "");
  }
  throw new Error("应当拒绝但没有抛错");
}
