/**
 * 阶段5 第一段：论文条目/附件（文献整理）与知识提取（领域知识积累）。
 * 条目≠文件；收藏不触发解析；同 DOI 不同附件不互拒；机械草稿明确标记；
 * 知识以「卡＋分项」结构化入库、逐字引文可回查、失败/重放由回执兜底（合同 §4.6/§6）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { emptyState, MemoryStore, rawHash, contentHash, type LocusState } from "../store.ts";
import { AppError, addManualCard, importLiterature } from "../services/app.ts";
import { addPaperAttachment, createPaper, importBibliography, linkPaperTopic, parseBibtex, updatePaper } from "../services/papers.ts";
import { buildKnowledgeBatch, chunkInputTexts, commitKnowledgeChunk, prepareKnowledgeRun, validateKnowledgeBatch } from "../services/knowledge.ts";
import { AiError } from "../services/ai.ts";
import type { ExtractionRunRecord } from "../domain/knowledge.ts";

const TEXT = "SLAC laccase oxidizes ABTS. At pH 4.0 and 25 C, Km was 0.5 mM and kcat was 120 s^-1. The authors suggest this reflects substrate affinity. Incubate 15 min at 25 C.";

function withPaper(text = TEXT) {
  let s = emptyState();
  const r = createPaper(s, { title: "SLAC kinetics", doi: "10.1/x", authors: "A and B", year: "2020", license: "CC BY 4.0" });
  s = r.state;
  const att = addPaperAttachment(s, { paperId: r.paper.id, name: "fulltext.md", text, role: "fulltext" });
  return { state: att.state, paper: r.paper, attachment: att.attachment, assetId: att.assetId };
}

test("论文条目：仅题名即可建；空题名 422；同 DOI 409 附已有条目定位", () => {
  const s = emptyState();
  const r = createPaper(s, { title: "P1" });
  assert.equal(r.paper.authors.length, 0);
  assert.equal(r.paper.license, ""); // 未提供留空，不补造
  assert.throws(() => createPaper(s, { title: "" }), (e: unknown) => e instanceof AppError && e.status === 422);
  const d1 = createPaper(s, { title: "P1", doi: "10.1/x" });
  assert.throws(() => createPaper(d1.state, { title: "P2", doi: "10.1/X" }), (e: unknown) => {
    if (!(e instanceof AppError) || e.status !== 409) return false;
    return e.details?.existingPaperId === d1.paper.id; // 定位已有条目，不死路
  });
  // 题名相似但 DOI 不同 → 不拒（防误拒）
  const d2 = createPaper(d1.state, { title: "P1", doi: "10.1/y" });
  assert.equal(d2.state.papers.length, 2);
});

test("附件导入只归档不解析；同 DOI 补充材料不互拒；真重复 409 附条目定位", () => {
  const { state, paper } = withPaper();
  assert.equal(state.cards.length, 0); // 收藏/导入不触发强制解析
  const sup = addPaperAttachment(state, { paperId: paper.id, name: "supp.md", text: "Supplementary table S1.", role: "supplement", version: "v2" });
  assert.equal(sup.state.attachments.length, 2);
  assert.equal(sup.state.cards.length, 0);
  assert.throws(() => addPaperAttachment(sup.state, { paperId: paper.id, name: "copy.md", text: TEXT }), (e: unknown) => {
    if (!(e instanceof AppError) || e.status !== 409) return false;
    return e.details?.existingPaperId === paper.id && Boolean(e.details?.existingAssetId);
  });
  // 原件 hash=原始字节；指纹=逻辑内容（CRLF 跨路径互拒）
  const crlf = addPaperAttachment(sup.state, { paperId: paper.id, name: "crlf.md", text: "line1\r\nline2" });
  const asset = crlf.state.assets.find((a) => a.id === crlf.assetId)!;
  assert.equal(asset.hash, rawHash("line1\r\nline2"));
  assert.equal(asset.fingerprint, contentHash("line1\nline2"));
  assert.throws(() => addPaperAttachment(crlf.state, { paperId: paper.id, name: "lf.md", text: "line1\nline2" }), (e: unknown) => e instanceof AppError && e.status === 409);
});

test("卡片归属文献条目：手动补卡经附件解析写入 paperId；未挂论文的原件留空不补造（E3 文献视图按此过滤）", async () => {
  const { state, paper, assetId } = withPaper();
  const m = addManualCard(state, { assetId, rawText: "At pH 4.0 and 25 C, Km was 0.5 mM." });
  assert.equal(m.card.paperId, paper.id);
  assert.equal(m.state.cards.filter((c) => c.paperId === paper.id).length, 1);
  const draft = await importLiterature(emptyState(), { name: "loose.md", text: "第一句。\n\n第二句。", mode: "draft" }, null);
  assert.ok(draft.state.cards.length > 0);
  assert.equal(draft.state.cards.every((c) => c.paperId === undefined), true);
});

test("题录修订留历史；课题关联可多课题、可解除", () => {
  let s = emptyState();
  const t1 = { ...s, topics: [{ id: "topic_a", name: "A", researchQuestion: "q", createdAt: "t" }] };
  const t2 = { ...t1, topics: [...t1.topics, { id: "topic_b", name: "B", researchQuestion: "q", createdAt: "t" }] };
  const r = createPaper(t2, { title: "P", year: "2019" });
  const up = updatePaper(r.state, r.paper.id, { year: "2020", reason: "核对原文" });
  assert.equal(up.paper.revision, 2);
  assert.equal(up.paper.history[0].field, "year");
  assert.equal(up.paper.history[0].before, "2019");
  let s2 = linkPaperTopic(up.state, r.paper.id, "topic_a", true).state;
  s2 = linkPaperTopic(s2, r.paper.id, "topic_b", true).state;
  assert.deepEqual(s2.papers[0].topicIds, ["topic_a", "topic_b"]);
  s2 = linkPaperTopic(s2, r.paper.id, "topic_a", false).state;
  assert.deepEqual(s2.papers[0].topicIds, ["topic_b"]);
});

test("BibTeX 解析（嵌套花括号）与 CSL-JSON 题录导入；同 DOI 跳过并定位", () => {
  const bib = `@article{slac2020,
    title = {Kinetics of {SLAC} laccase},
    author = {H{\"a}u{\ss}ler, M. and Other, A.},
    year = {2020}, doi = {10.1/x}, journal = {J. Enz.}
  }
  @misc{noauthor, title = {Second entry}, year = {2021} }`;
  const entries = parseBibtex(bib);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].fields.title, "Kinetics of {SLAC} laccase");
  assert.equal(entries[0].fields.doi, "10.1/x");
  const r = importBibliography(emptyState(), { format: "bibtex", text: bib });
  assert.equal(r.created.length, 2);
  assert.equal(r.created[0].authors.length, 2);
  const again = importBibliography(r.state, { format: "bibtex", text: bib });
  assert.equal(again.created.length, 1); // 无 DOI 的第二条不视为重复
  assert.equal(again.skipped.length, 1);
  assert.equal(again.skipped[0].existingPaperId, r.created[0].id);
  const csl = JSON.stringify([{ title: "CSL paper", author: [{ family: "Li", given: "X" }], issued: { "date-parts": [[2022]] }, DOI: "10.2/z" }]);
  const rc = importBibliography(emptyState(), { format: "csl-json", text: csl });
  assert.equal(rc.created[0].year, "2022");
  assert.equal(rc.created[0].authors[0], "Li, X");
  assert.throws(() => importBibliography(emptyState(), { format: "csl-json", text: "not json" }), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("提取发起：目的必填；附件须显式选择（空/重复/跨条目一律 422）；缺幂等键 422；同输入同版本", () => {
  const { state, paper, attachment } = withPaper();
  const ids = [attachment.id];
  const base = { paperId: paper.id, attachmentIds: ids, purpose: "比较 pH 对 Km 的影响", idempotencyKey: "k1" };
  assert.throws(() => prepareKnowledgeRun(state, { ...base, purpose: "" }), (e: unknown) => e instanceof AppError && e.status === 422);
  assert.throws(() => prepareKnowledgeRun(state, { ...base, attachmentIds: [] }), (e: unknown) => e instanceof AppError && e.status === 422); // 不解释成「全部」
  assert.throws(() => prepareKnowledgeRun(state, { ...base, attachmentIds: [attachment.id, attachment.id] }), (e: unknown) => e instanceof AppError && e.status === 422);
  assert.throws(() => prepareKnowledgeRun(state, { ...base, attachmentIds: ["att_missing"] }), (e: unknown) => e instanceof AppError && e.status === 422);
  assert.throws(() => prepareKnowledgeRun(state, { ...base, idempotencyKey: "  " }), (e: unknown) => e instanceof AppError && e.status === 422);
  const other = createPaper(state, { title: "另一篇" });
  assert.throws(() => prepareKnowledgeRun(other.state, { ...base, paperId: other.paper.id }), (e: unknown) => e instanceof AppError && e.status === 422); // 附件不属该条目
  assert.throws(() => prepareKnowledgeRun(other.state, { ...base, paperId: other.paper.id, attachmentIds: [] }), (e: unknown) => e instanceof AppError && e.status === 422);

  const a = prepareKnowledgeRun(state, base);
  const b = prepareKnowledgeRun(state, { ...base, idempotencyKey: "k2" });
  assert.equal(a.assets.length, 1);
  assert.ok(a.inputHash.length > 0);
  assert.equal(a.inputHash, b.inputHash); // 冻结输入＝内容版本，不随幂等键变
  assert.equal(a.run.chunks.length > 0, true);
  assert.equal(a.run.chunks.every((c) => c.status === "pending"), true);
  assert.equal(a.run.promptVersion, "knowledge_struct/v1"); // 提示词版本进入 run，便于回溯
  // 题录修订（条目版本变化）→ 输入指纹变化：旧回执不会被误当成同一输入
  const revised = updatePaper(state, paper.id, { year: "2021", reason: "核对原文" }).state;
  const c = prepareKnowledgeRun(revised, base);
  assert.notEqual(c.inputHash, a.inputHash);
});

/** 把冻结 run 挂进 state（真实路由由 server 完成，这里做纯服务层验证）。 */
const attachRun = (s: LocusState, run: ExtractionRunRecord): LocusState =>
  ({ ...s, knowledge: { ...s.knowledge, extractionRuns: [...s.knowledge.extractionRuns, run] } });

const Q_DATA = "At pH 4.0 and 25 C, Km was 0.5 mM and kcat was 120 s^-1.";
const Q_IDEA = "The authors suggest this reflects substrate affinity.";
const Q_GHOST = "this text is not in the source";
const itemOf = (over: Record<string, unknown> = {}) => ({
  contentType: "observation", nature: "observation", text: "Km=0.5 mM", subject: "SLAC", predicate: "Km", value: null,
  contextLocalIds: [], evidenceLocalIds: ["e1"], scopeText: "", unknowns: [], secondaryCitation: false, ...over,
});
const batchOf = (blockId: string, evidence: unknown[], cards: unknown[]) =>
  ({ schemaVersion: 1, evidence, contexts: [], cards, relations: [] });
const dataBatch = (blockId: string) => batchOf(blockId,
  [
    { localId: "e1", sourceBlockId: blockId, quote: Q_DATA },
    { localId: "e2", sourceBlockId: blockId, quote: Q_IDEA },
    { localId: "e3", sourceBlockId: blockId, quote: Q_GHOST },
  ],
  [
    { localId: "k1", summary: "pH 4.0、25°C 下 Km=0.5 mM", items: [itemOf({ text: "Km=0.5 mM、kcat=120 s^-1", predicate: "动力学参数", value: { kind: "scalar", raw: "0.5 mM", value: "0.5", unit: "mM" }, scopeText: "pH 4.0, 25 C" })] },
    { localId: "k2", summary: "作者解释：反映底物亲和力", items: [itemOf({ contentType: "claim", nature: "interpretation", text: "反映底物亲和力", predicate: "意义", evidenceLocalIds: ["e2"] })] },
    { localId: "k3", summary: "模型改写的不存在片段", items: [itemOf({ nature: "to_verify", text: "不存在的说法", predicate: "X", evidenceLocalIds: ["e3"] })] },
  ]);

test("批次构建：逐字引文在原件里定位（matched/unmatched 分明）；数据与作者解释分列；一律待审", () => {
  const { state, paper, attachment } = withPaper();
  const prep = prepareKnowledgeRun(state, { paperId: paper.id, attachmentIds: [attachment.id], purpose: "比较 pH 对 Km 的影响", idempotencyKey: "k1" });
  const run = prep.run;
  const chunk = run.chunks[0];
  const s = attachRun(state, run);
  const read = chunkInputTexts(s, run, chunk);
  const built = buildKnowledgeBatch(s, run, chunk, validateKnowledgeBatch(dataBatch(chunk.id), read.blockIds), read.spaces);
  assert.equal(built.cards.length, 3);
  assert.equal(built.items.length, 3);
  assert.equal(built.evidence.filter((e) => e.payload.locationStatus === "matched").length, 2);
  const ghost = built.evidence.find((e) => e.payload.locationStatus === "unmatched")!;
  assert.equal(ghost.payload.locator.type, "unresolved"); // 定位不足：不得给出假偏移
  assert.equal(ghost.payload.quote, Q_GHOST);
  assert.equal(built.items[2].payload.unknowns.some((u) => u.reasonCode === "unresolved_link"), true);
  assert.equal(built.items[0].payload.unknowns.length, 0);
  assert.equal(built.items[0].payload.nature, "observation"); // 数据
  assert.equal(built.items[1].payload.nature, "interpretation"); // 作者解释另列
  assert.equal(built.items.every((i) => i.payload.review.status === "pending"), true); // 待审，不自动确认
  assert.equal(built.cards.every((c) => c.audit === "unreviewed"), true);
  assert.equal(built.cards.every((c) => c.paperId === paper.id), true);
  assert.equal(built.items[0].payload.sourceRefs.every((r) => r.kind === "asset" || r.kind === "paper"), true); // 来源指向原件/条目
  // 数字不强行解析：非十进制字符串即整块拒收
  assert.throws(
    () => validateKnowledgeBatch(batchOf(chunk.id, [{ localId: "e1", sourceBlockId: chunk.id, quote: Q_DATA }],
      [{ localId: "k1", summary: "S", items: [itemOf({ value: { kind: "scalar", raw: "约 0.5 mM", value: "约 0.5", unit: "mM" } })] }]), read.blockIds),
    (e: unknown) => e instanceof AiError && /不强行解析/.test((e as Error).message),
  );
});

test("块提交与回执：壳＋实体同笔写入；同块重放不重复入库；取消后在途结果丢弃；重复概述只提示不合并", () => {
  const { state, paper, attachment } = withPaper();
  const input = { paperId: paper.id, attachmentIds: [attachment.id], purpose: "比较 pH 对 Km 的影响" };
  const p1 = prepareKnowledgeRun(state, { ...input, idempotencyKey: "k1" });
  const s1 = attachRun(state, p1.run);
  const chunk1 = p1.run.chunks[0];
  const read1 = chunkInputTexts(s1, p1.run, chunk1);
  const built1 = buildKnowledgeBatch(s1, p1.run, chunk1, validateKnowledgeBatch(dataBatch(chunk1.id), read1.blockIds), read1.spaces);
  const r1 = commitKnowledgeChunk(s1, p1.run.id, chunk1.id, built1, "RAW");
  assert.equal(r1.created, 3);
  assert.equal(r1.state.cards.length, 3);
  assert.equal(r1.state.knowledge.items.length, 3);
  assert.ok(r1.receipt, "成功提交必须有回执");
  assert.deepEqual(r1.receipt!.cardIds, r1.state.cards.map((c) => c.id)); // 回执可回查本次写了什么
  assert.equal(r1.receipt!.inputHash, chunk1.sourceTextHash); // 回执绑定冻结输入版本
  assert.equal(r1.state.knowledge.extractionRuns.find((r) => r.id === p1.run.id)!.chunks[0].status, "committed");
  // 重复提交同一块：返回原回执，state 原样不动（新增计数由回执记录，路由层把它折成 skipped）
  const r2 = commitKnowledgeChunk(r1.state, p1.run.id, chunk1.id, built1, "RAW");
  assert.equal(r2.replayed, true);
  assert.equal(r2.discarded, undefined);
  assert.equal(r2.state, r1.state); // 纯函数：重放不产生任何写入
  assert.deepEqual(r2.receipt!.cardIds, r1.receipt!.cardIds);
  assert.equal(r2.state.cards.length, 3);
  // 已取消的 run：在途结果丢弃，不写入、也不留回执
  const cancelled: ExtractionRunRecord = { ...p1.run, id: "kr_cancel", status: "cancelled", chunks: p1.run.chunks.map((c) => ({ ...c, status: "pending", receipt: undefined, rawResponse: undefined })) };
  const s3 = attachRun(r2.state, cancelled);
  const r3 = commitKnowledgeChunk(s3, cancelled.id, cancelled.chunks[0].id, built1, "RAW");
  assert.equal(r3.discarded, true);
  assert.equal(r3.state.cards.length, 3); // 未追加
  assert.equal(r3.state.knowledge.extractionRuns.find((r) => r.id === cancelled.id)!.chunks[0].status, "discarded");
  // 另一次 run 里的同一概述：仅提示重复候选，保留两份交人审
  const p4 = prepareKnowledgeRun(r3.state, { ...input, idempotencyKey: "k2" });
  const s4 = attachRun(r3.state, p4.run);
  const read4 = chunkInputTexts(s4, p4.run, p4.run.chunks[0]);
  const built4 = buildKnowledgeBatch(s4, p4.run, p4.run.chunks[0], validateKnowledgeBatch(dataBatch(p4.run.chunks[0].id), read4.blockIds), read4.spaces);
  assert.ok(built4.duplicateCandidates.length >= 1, "重复概述应给出候选提示");
  const r4 = commitKnowledgeChunk(s4, p4.run.id, p4.run.chunks[0].id, built4, "RAW2");
  assert.equal(r4.state.cards.length, 6); // 不自动合并/删除
  assert.equal(r4.duplicateCandidates.length >= 1, true);
});

test("机械草稿明确标记（旧逐段路径保留为开发调试，不与语义提取混淆）", async () => {
  const r = await importLiterature(emptyState(), { name: "m.md", text: "第一段\n\n第二段" }, null);
  assert.equal(r.created, 2);
  assert.equal(r.state.cards.every((c) => c.mechanical === true), true);
});

// ── 集成：真实路由 + 慢速假模型，知识 job 等待期编辑不丢 ──
/** 假模型：按提示词里的块ID 回一批结构化知识（引文逐字取自 TEXT，故服务端可定位）。 */
async function fakeAi(delayMs: number): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const msgs = (JSON.parse(raw) as { messages: { content: string }[] }).messages;
      const user = String(msgs[msgs.length - 1].content);
      const blockId = /块ID：(\S+)/.exec(user)?.[1] ?? "chunk_0";
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(batchOf(blockId,
          [{ localId: "e1", sourceBlockId: blockId, quote: "At pH 4.0 and 25 C, Km was 0.5 mM and kcat was 120 s^-1." }],
          [{ localId: "k1", summary: "Km=0.5 mM（pH 4.0, 25 C）", items: [itemOf({ text: "Km=0.5 mM、kcat=120 s^-1", value: { kind: "scalar", raw: "0.5 mM", value: "0.5", unit: "mM" }, scopeText: "pH 4.0, 25 C" })] }],
        )) } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as import("node:net").AddressInfo).port };
}

test("知识 job 走真实路由：待审壳＋分项入库；等待期新课题保留；同幂等键重放不重复入库", async () => {
  const { createApp } = await import("../server.ts");
  const ai = await fakeAi(250);
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, b: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, any>>;
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const p = await post("/api/papers", { title: "SLAC kinetics", doi: "10.1/x" });
    assert.equal(p.status, 200);
    const att = await post(`/api/papers/${p.data.paperId}/attachments`, { name: "fulltext.md", text: TEXT, role: "fulltext" });
    assert.equal(att.status, 200);
    const st0 = await get("/api/state");
    assert.equal((st0.cards as unknown[]).length, 0); // 附件导入不触发解析
    const body = { paperId: p.data.paperId, attachmentIds: [att.data.attachmentId], purpose: "pH 对 Km 的影响", idempotencyKey: "job-1" };
    const job = await post("/api/knowledge/jobs", body);
    assert.equal(job.status, 202);
    assert.ok(job.data.runId);
    await post("/api/topics", { name: "等待期课题", researchQuestion: "Q" }); // 等待期编辑
    let j: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      j = await get(`/api/jobs/${job.data.jobId}`);
      if (j.status === "done" || j.status === "error") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(j.status, "done");
    const st = await get("/api/state");
    assert.equal((st.topics as unknown[]).length, 1); // 等待期课题保留（写回不覆盖）
    const cards = st.cards as { paperId: string; audit: string; mechanical?: boolean; knowledgeItemIds?: string[] }[];
    assert.equal(cards.length, 1);
    assert.equal(cards[0].paperId, p.data.paperId);
    assert.equal(cards[0].audit, "unreviewed");
    assert.equal(cards[0].mechanical, false);
    assert.equal(cards[0].knowledgeItemIds!.length, 1); // 阅读壳指向分项
    assert.equal((st.knowledge.items as unknown[]).length, 1);
    assert.equal(st.knowledge.evidence[0].payload.locationStatus, "matched"); // 引文可回查偏移
    assert.equal(j.result.created, 1);
    // 同幂等键重复发起：返回同一 run（replayed），不新建、不重调模型、不重复入库
    const job2 = await post("/api/knowledge/jobs", body);
    assert.equal(job2.status, 200);
    assert.equal(job2.data.replayed, true);
    assert.equal(job2.data.runId, job.data.runId);
    const st2 = await get("/api/state");
    assert.equal((st2.cards as unknown[]).length, 1);
    assert.equal((st2.knowledge.extractionRuns as unknown[]).length, 1);
    // 换幂等键重跑同一输入：新 run；同一概述仅作候选提示，不自动合并
    const job3 = await post("/api/knowledge/jobs", { ...body, idempotencyKey: "job-2" });
    assert.equal(job3.status, 202);
    for (let i = 0; i < 100; i++) {
      j = await get(`/api/jobs/${job3.data.jobId}`);
      if (j.status === "done" || j.status === "error") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(j.status, "done");
    const st3 = await get("/api/state");
    assert.equal((st3.cards as unknown[]).length, 2); // 两份保留，交人审
    assert.ok((j.result.duplicateCandidates ?? []).length >= 1, "重复概述应可见");
    // 未配置 AI 时明确 400（不冒充）
    await fetch(`${base}/api/ai/config`, { method: "DELETE" });
    const noCfg = await post("/api/knowledge/jobs", { ...body, idempotencyKey: "job-3" });
    assert.equal(noCfg.status, 400);
  } finally { app.close(); ai.server.close(); }
});