/**
 * 阶段5 第一段：论文条目/附件（文献整理）与语义知识提取（领域知识积累）。
 * 条目≠文件；收藏不触发解析；同 DOI 不同附件不互拒；机械草稿明确标记；
 * 语义卡以研究意义为单位、多段引文可回查；合并写回不覆盖等待期编辑。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { emptyState, MemoryStore, rawHash, contentHash } from "../store.ts";
import { AppError, importLiterature } from "../services/app.ts";
import { addPaperAttachment, createPaper, importBibliography, linkPaperTopic, parseBibtex, updatePaper } from "../services/papers.ts";
import { applyKnowledge, mapKnowledgeCards, prepareKnowledge } from "../services/knowledge.ts";
import { AiError } from "../services/ai.ts";

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

test("语义提取发起：目的必填；无附件 422；快照固定输入版本", () => {
  const { state, paper } = withPaper();
  assert.throws(() => prepareKnowledge(state, { paperId: paper.id, purpose: "" }), (e: unknown) => e instanceof AppError && e.status === 422);
  const empty = createPaper(state, { title: "无附件" });
  assert.throws(() => prepareKnowledge(empty.state, { paperId: empty.paper.id, purpose: "p" }), (e: unknown) => e instanceof AppError && e.status === 422);
  const prep = prepareKnowledge(state, { paperId: paper.id, purpose: "比较 pH 对 Km 的影响" });
  assert.equal(prep.assets.length, 1);
  assert.ok(prep.snapshotHash.length > 0);
  const prep2 = prepareKnowledge(state, { paperId: paper.id, purpose: "比较 pH 对 Km 的影响" });
  assert.equal(prep.snapshotHash, prep2.snapshotHash); // 同输入同快照
});

test("语义卡映射：多段引文匹配原件；不匹配明示定位不足；缺引文拒收；数据/解释/思路分开", () => {
  const { state, paper } = withPaper();
  const assets = state.assets.filter((a) => a.id === state.attachments[0].assetId);
  const cards = mapKnowledgeCards(paper, assets, [
    {
      kind: "data", rawText: "pH 4.0、25°C 下 Km=0.5 mM、kcat=120 s^-1",
      spans: [{ quote: "At pH 4.0 and 25 C, Km was 0.5 mM and kcat was 120 s^-1." }, { quote: "Incubate 15 min at 25 C." }],
      extracted: { fields: { Km: "0.5", kcat: "120" }, units: ["mM", "s^-1"], conditions: ["pH 4.0", "25 C"] },
      scope: "pH 4.0, 25 C", interpretation: "作者认为反映底物亲和力", unknowns: [],
    },
    { kind: "idea", rawText: "模型改写的不存在片段", spans: [{ quote: "this text is not in the source" }], extracted: { fields: {}, units: [], conditions: [] }, unknowns: [] },
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].kind, "data");
  assert.equal(cards[0].paperId, paper.id);
  assert.equal(cards[0].spans!.length, 2);
  assert.equal(cards[0].spans!.every((s) => s.matched), true);
  assert.equal(cards[0].interpretation, "作者认为反映底物亲和力"); // 作者解释与数据分开
  assert.equal(cards[0].audit, "unreviewed"); // 进待审区，不是自动确认
  assert.equal(cards[1].spans![0].matched, false);
  assert.ok(cards[1].unknowns.some((u) => u.includes("定位不足")));
  assert.equal(cards[1].locator.sectionQuote, ""); // 定位不足不得正式采用
  assert.throws(() => mapKnowledgeCards(paper, assets, [{ kind: "data", rawText: "无引文", spans: [] }]), (e: unknown) => e instanceof AiError);
});

test("合并写回：同概述跳过不重复入库；只追加不覆盖", () => {
  const { state, paper } = withPaper();
  const assets = state.assets.filter((a) => a.id === state.attachments[0].assetId);
  const cards = mapKnowledgeCards(paper, assets, [{ kind: "data", rawText: "Km=0.5 mM", spans: [{ quote: "Km was 0.5 mM" }], extracted: { fields: { Km: "0.5" }, units: ["mM"], conditions: [] }, unknowns: [] }]);
  const r1 = applyKnowledge(state, paper.id, cards);
  assert.equal(r1.created, 1);
  const r2 = applyKnowledge(r1.state, paper.id, cards); // 重试/重复提交
  assert.equal(r2.created, 0);
  assert.equal(r2.skipped, 1);
  assert.equal(r2.state.cards.length, 1);
});

test("机械草稿明确标记（旧逐段路径保留为开发调试，不与语义提取混淆）", async () => {
  const r = await importLiterature(emptyState(), { name: "m.md", text: "第一段\n\n第二段" }, null);
  assert.equal(r.created, 2);
  assert.equal(r.state.cards.every((c) => c.mechanical === true), true);
});

// ── 集成：真实路由 + 慢速假模型，知识 job 等待期编辑不丢 ──
const KNOW_JSON = JSON.stringify({ cards: [{ kind: "data", rawText: "Km=0.5 mM（pH 4.0, 25 C）", spans: [{ quote: "Km was 0.5 mM" }], extracted: { fields: { Km: "0.5" }, units: ["mM"], conditions: ["pH 4.0", "25 C"] }, scope: "", interpretation: "", unknowns: [], secondaryCitation: false }] });

async function fakeAi(delayMs: number): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: KNOW_JSON } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as import("node:net").AddressInfo).port };
}

test("知识 job 走真实路由：待审卡入库；等待期新课题保留；重复提交不重复入库", async () => {
  const { createApp } = await import("../server.ts");
  const ai = await fakeAi(250);
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, b: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, never>>;
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const p = await post("/api/papers", { title: "SLAC kinetics", doi: "10.1/x" });
    assert.equal(p.status, 200);
    const att = await post(`/api/papers/${p.data.paperId}/attachments`, { name: "fulltext.md", text: TEXT, role: "fulltext" });
    assert.equal(att.status, 200);
    const st0 = await get("/api/state");
    assert.equal((st0.cards as unknown[]).length, 0); // 附件导入不触发解析
    const job = await post("/api/knowledge/jobs", { paperId: p.data.paperId, purpose: "pH 对 Km 的影响" });
    assert.equal(job.status, 202);
    await post("/api/topics", { name: "等待期课题", researchQuestion: "Q" }); // 等待期编辑
    let j: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      j = await get(`/api/jobs/${job.data.jobId}`);
      if (j.status === "done" || j.status === "error") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(j.status, "done");
    const st = await get("/api/state");
    assert.equal((st.topics as unknown[]).length, 1); // 等待期课题保留
    const cards = st.cards as { paperId: string; audit: string; mechanical?: boolean; kind?: string }[];
    assert.equal(cards.length, 1);
    assert.equal(cards[0].paperId, p.data.paperId);
    assert.equal(cards[0].audit, "unreviewed");
    assert.equal(cards[0].mechanical, false);
    assert.equal(cards[0].kind, "data");
    // 重复发起同任务：同概述跳过，不重复入库
    const job2 = await post("/api/knowledge/jobs", { paperId: p.data.paperId, purpose: "pH 对 Km 的影响" });
    for (let i = 0; i < 100; i++) {
      j = await get(`/api/jobs/${job2.data.jobId}`);
      if (j.status === "done" || j.status === "error") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(j.status, "done");
    assert.equal((j.result as { skipped?: number }).skipped, 1);
    const st2 = await get("/api/state");
    assert.equal((st2.cards as unknown[]).length, 1);
    // 未配置 AI 时明确 400（不冒充）
    await fetch(`${base}/api/ai/config`, { method: "DELETE" });
    const noCfg = await post("/api/knowledge/jobs", { paperId: p.data.paperId, purpose: "x" });
    assert.equal(noCfg.status, 400);
  } finally { app.close(); ai.server.close(); }
});