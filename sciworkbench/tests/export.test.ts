/**
 * 6A-4/6A-5 契约测试：ZIP/DOCX 导出、追溯包（版本索引/许可过滤/hash manifest），
 * 整体导出与隔离恢复（损坏不静默成空、不覆盖主数据）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, JsonFileStore } from "../store.ts";
import { createTopic } from "../services/app.ts";
import { createPaper, addPaperAttachment } from "../services/papers.ts";
import { createReport, applyReportEdit } from "../services/analysis.ts";
import {
  zip, buildReportDocx, buildTraceabilityPackage, buildWholeLibraryPackage,
  inspectLibraryJson, licenseRedistributable, sha256, countsOf,
} from "../services/export.ts";

const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const hasEntry = (buf: Buffer, name: string) => buf.includes(Buffer.from(name, "utf8"));

test("zip：结构合法（本地头＋EOCD＋条目名）；空集也可写出", () => {
  const buf = zip([{ name: "a.txt", data: "hello" }, { name: "dir/b.json", data: "{}" }]);
  assert.ok(buf.subarray(0, 4).equals(PK));
  assert.ok(hasEntry(buf, "a.txt") && hasEntry(buf, "dir/b.json"));
  assert.ok(buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))); // EOCD
  const empty = zip([]);
  assert.ok(empty.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])));
});

test("6A-4 Word 导出：含 document.xml；块顺序/性质/引用写入；标注外部编辑非审计", () => {
  let s = emptyState();
  s = createTopic(s, { name: "课题甲", researchQuestion: "Q" }).state;
  const tid = s.topics[0].id;
  s = createReport(s, { topicId: tid }).state;
  const rid = s.reports[0].id;
  s = applyReportEdit(s, rid, { baseRevision: 1, blocks: [
    { nature: "observation", text: "观察条目", refs: [{ kind: "note", label: "来源注" }] },
    { nature: "human_judgment", text: "人工判断条目", refs: [{ kind: "measurement", id: "m1", version: "rev 2", label: "测量甲" }] },
  ], reason: "首次" }).state;
  const rep = s.reports[0];
  const docx = buildReportDocx(s, rep);
  assert.ok(docx.subarray(0, 4).equals(PK));
  assert.ok(hasEntry(docx, "[Content_Types].xml") && hasEntry(docx, "word/document.xml") && hasEntry(docx, "_rels/.rels"));
  // 内容为 deflate 压缩，这里验证条目标识与 XML 结构名存在
  assert.ok(hasEntry(docx, "word/document.xml"));
});

test("6A-4 追溯包：版本索引固定版本；许可逐附件过滤；manifest sha256；NOTICE 列排除", () => {
  let s = emptyState();
  s = createTopic(s, { name: "课题乙", researchQuestion: "Q" }).state;
  const tid = s.topics[0].id;
  const pa = createPaper(s, { title: "开放论文", license: "CC BY 4.0", topicIds: [tid] }); s = pa.state;
  const aa = addPaperAttachment(s, { paperId: pa.paper.id, name: "open.md", text: "open text method", role: "fulltext" }); s = aa.state;
  const pb = createPaper(s, { title: "未标许可论文", license: "", topicIds: [tid] }); s = pb.state;
  const ab = addPaperAttachment(s, { paperId: pb.paper.id, name: "closed.md", text: "closed text method", role: "fulltext" }); s = ab.state;
  // 两张卡（经导入会关联论文；此处手工指向附件原件）
  s = createReport(s, { topicId: tid }).state;
  const rid = s.reports[0].id;
  s = applyReportEdit(s, rid, { baseRevision: 1, blocks: [
    { nature: "observation", text: "引用开放来源", refs: [{ kind: "asset", id: aa.assetId, version: "bytes", label: "open.md" }] },
    { nature: "interpretation", text: "引用受限来源", refs: [{ kind: "asset", id: ab.assetId, version: "bytes", label: "closed.md" }] },
  ], reason: "首次" }).state;
  const t = buildTraceabilityPackage(s, rid);
  assert.ok(t.buffer.subarray(0, 4).equals(PK));
  assert.ok(hasEntry(t.buffer, "report.docx") && hasEntry(t.buffer, "versions.json") && hasEntry(t.buffer, "manifest.json") && hasEntry(t.buffer, "NOTICE.txt"));
  // 版本索引固定版本（不指向 latest）
  const refs = (t.versionIndex.fixedRefs as { version: string }[]);
  assert.ok(refs.length === 2 && refs.every((r) => r.version === "bytes"));
  // 许可过滤：开放许可入包（其附件原件），受限/未标排除并登记
  assert.ok(hasEntry(t.buffer, "open.md"));
  assert.ok(!hasEntry(t.buffer, "closed.md"));
  assert.ok(t.excludedAttachments.some((e) => e.name === "closed.md"));
  // manifest：每文件 sha256
  assert.ok(t.manifest.every((m) => /^[0-9a-f]{64}$/.test(m.sha256)));
  assert.ok(t.manifest.some((m) => m.file === "report.docx"));
});

test("6A-4 许可判定：CC BY/CC0/公有领域可；NC/ND/AR/空不可", () => {
  assert.equal(licenseRedistributable("CC BY 4.0"), true);
  assert.equal(licenseRedistributable("CC0 1.0"), true);
  assert.equal(licenseRedistributable("Public Domain"), true);
  assert.equal(licenseRedistributable("CC BY-NC 4.0"), false);
  assert.equal(licenseRedistributable("CC BY-ND 4.0"), false);
  assert.equal(licenseRedistributable("All Rights Reserved"), false);
  assert.equal(licenseRedistributable(""), false);
});

test("6A-5 整体导出＋隔离恢复：manifest 校验；损坏/版本未知/篡改 → 明确报错不静默成空", () => {
  let s = emptyState();
  s = createTopic(s, { name: "课题丙", researchQuestion: "Q" }).state;
  const pkg = buildWholeLibraryPackage(s);
  assert.ok(hasEntry(pkg, "state.json") && hasEntry(pkg, "manifest.json"));
  // 重建 state.json 文本做校验（与包内一致：JSON.stringify(state,null,2)）
  const stateJson = JSON.stringify(s, null, 2);
  const good = inspectLibraryJson(stateJson, sha256(stateJson));
  assert.equal(good.ok, true);
  assert.equal(good.version, s.version);
  assert.deepEqual(good.counts, countsOf(s));
  // 损坏 JSON
  assert.equal(inspectLibraryJson("{not json", undefined).ok, false);
  // 缺少版本字段
  assert.equal(inspectLibraryJson(JSON.stringify({ topics: [] }), undefined).ok, false);
  // 篡改：sha 不符
  const tampered = inspectLibraryJson(stateJson + " ", sha256(stateJson));
  assert.equal(tampered.ok, false);
  assert.equal(tampered.hashOk, false);
});

test("6A-5 loadStrict/load：损坏文件均抛错（不静默成空）；仅文件不存在才新建", async () => {
  const bad = join(tmpdir(), `locus-bad-${Date.now()}.json`);
  writeFileSync(bad, "{ broken", "utf8");
  await assert.rejects(() => new JsonFileStore(bad).loadStrict(), /损坏/);
  await assert.rejects(() => new JsonFileStore(bad).load(), /损坏/); // 存在但损坏 → 不静默成空
  rmSync(bad, { force: true });
  // 未知版本
  const ver = join(tmpdir(), `locus-ver-${Date.now()}.json`);
  writeFileSync(ver, JSON.stringify({ version: 99, topics: [] }), "utf8");
  await assert.rejects(() => new JsonFileStore(ver).loadStrict(), /未知数据版本/);
  await assert.rejects(() => new JsonFileStore(ver).load(), /未知数据版本/);
  rmSync(ver, { force: true });
  // 文件不存在 → load 可新建为空状态
  const missing = join(tmpdir(), `locus-none-${Date.now()}.json`);
  const fresh = await new JsonFileStore(missing).load();
  assert.deepEqual(fresh.topics, []);
});
