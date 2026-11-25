/**
 * 公开展示只读适配器（B 交付）。
 *
 * 设计约束：
 * - 只读。快照加载后深冻结；本模块不提供任何写方法。
 * - 按明确路径匹配。未知 kind/对象 ID/版本/路由 → 抛 DemoMissingError（带具体原因），不静默兜底。
 * - 不包装假 API：不存在「接受更新的 getState」，也没有模拟后端。
 *
 * 快照契约见 README.md「B 消费契约」。
 */

export class DemoMissingError extends Error {
  constructor(path, reason) {
    super(`[缺项] ${path}：${reason}`);
    this.name = "DemoMissingError";
    this.code = "DEMO_MISSING";
    this.path = path;
    this.reason = reason;
  }
}

const KINDS = new Set([
  "topic", "subquestion", "paper", "attachment", "asset", "card", "table", "protocol", "execution",
  "sample", "measurement", "task", "result", "report", "block", "item", "context",
  "evidence", "comparison", "chat", "message", "template",
]);

function arr(v) { return Array.isArray(v) ? v : []; }
function need(cond, path, reason) { if (!cond) throw new DemoMissingError(path, reason); }

function deepFreeze(o) {
  if (!o || typeof o !== "object" || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.keys(o)) deepFreeze(o[k]);
  return o;
}

export function createDemoData(snapshot, options = {}) {
  need(snapshot && typeof snapshot === "object", "snapshot", "快照为空或不是对象");
  need(Array.isArray(snapshot.topics) && snapshot.topics.length > 0, "topics", "快照缺少课题集合");
  const demo = snapshot.demo ?? {};
  const mainTopicId = options.topicId || demo.mainTopicId || snapshot.mainTopicId || snapshot.topics[0].id;
  need(snapshot.topics.some((t) => t.id === mainTopicId), `topics[${mainTopicId}]`, "快照中没有主课题");

  const idx = {
    topics: new Map(arr(snapshot.topics).map((x) => [x.id, x])),
    subquestions: new Map(arr(snapshot.subquestions).map((x) => [x.id, x])),
    papers: new Map(arr(snapshot.papers).map((x) => [x.id, x])),
    assets: new Map(arr(snapshot.assets).map((x) => [x.id, x])),
    attachments: new Map(arr(snapshot.attachments).map((x) => [x.id, x])),
    cards: new Map(arr(snapshot.cards).map((x) => [x.id, x])),
    tables: new Map(arr(snapshot.tables).map((x) => [x.id, x])),
    comparisons: new Map(arr(snapshot.comparisons).map((x) => [x.id, x])),
    protocols: new Map(arr(snapshot.protocols).map((x) => [x.id, x])),
    executions: new Map(arr(snapshot.executions).map((x) => [x.id, x])),
    samples: new Map(arr(snapshot.samples).map((x) => [x.id, x])),
    measurements: new Map(arr(snapshot.measurements).map((x) => [x.id, x])),
    tasks: new Map(arr(snapshot.analysisTasks).map((x) => [x.id, x])),
    results: new Map(arr(snapshot.analysisResults).map((x) => [x.id, x])),
    reports: new Map(arr(snapshot.reports).map((x) => [x.id, x])),
    chats: new Map(arr(snapshot.chats).map((x) => [x.id, x])),
    knowledgeItems: new Map(arr(snapshot.knowledge?.items).map((x) => [x.id, x])),
    knowledgeContexts: new Map(arr(snapshot.knowledge?.contexts).map((x) => [x.id, x])),
    knowledgeEvidence: new Map(arr(snapshot.knowledge?.evidence).map((x) => [x.id, x])),
    knowledgeRelations: arr(snapshot.knowledge?.relations),
  };

  const topicsOf = (arrLike, topicId) => arr(arrLike).filter((x) => !topicId || x.topicId === topicId || (Array.isArray(x.topicIds) && x.topicIds.includes(topicId)));

  // ── 课题 / 文献 ─────────────────────────────────────────────
  function listTopics() { return arr(snapshot.topics); }
  function getTopic(id) { const t = idx.topics.get(id); need(t, `topic:${id}`, "课题不存在"); return t; }
  function getMainTopic() { return getTopic(mainTopicId); }
  function listSubquestions(topicId) { return topicsOf(snapshot.subquestions, topicId ?? mainTopicId); }

  function listPapers(topicId) {
    if (!topicId) return arr(snapshot.papers);
    return arr(snapshot.papers).filter((p) => !p.topicIds?.length || p.topicIds.includes(topicId));
  }
  function getPaper(id) { const p = idx.papers.get(id); need(p, `paper:${id}`, "论文条目不存在"); return p; }
  function listAttachments(paperId) { return arr(snapshot.attachments).filter((a) => a.paperId === paperId); }
  function getAttachment(id) { const a = idx.attachments.get(id); need(a, `attachment:${id}`, "附件不存在"); return a; }
  function getAsset(id) { const a = idx.assets.get(id); need(a, `asset:${id}`, "原件不存在"); return a; }

  /** 与 services/app.ts:774 sourceView 同形：{ asset, points[] }。 */
  function getSource(assetId) {
    const asset = getAsset(assetId);
    const points = [];
    for (const c of arr(snapshot.cards)) if (c.assetId === assetId) points.push({ id: c.id, kind: "card", locate: c.locator?.sectionQuote ?? "" });
    for (const t of arr(snapshot.tables)) if (t.assetId === assetId) points.push({ id: t.id, kind: "table", locate: `表格《${t.name}》 ${arr(t.rows).length} 行 × ${arr(t.columns).length} 列` });
    return { asset, points };
  }

  /**
   * 原件定位：可公开外链或站内原件文本。
   * 返回 { kind:"external"|"inline", href?, text?, license?, provenance? }。
   * 缺外链且无内嵌文本 → DemoMissingError。
   */
  function getOriginalUrl(assetId) {
    const asset = getAsset(assetId);
    const src = demo.sources?.[assetId] ?? {};
    const paper = arr(snapshot.papers).find((p) => arr(snapshot.attachments).some((a) => a.paperId === p.id && a.assetId === assetId));
    const license = src.license ?? paper?.license ?? "未提供";
    // 有站内原件文本时优先内嵌展示（中间原始材料）；外链只作来源标注。
    if (typeof asset.text === "string" && asset.text.length) {
      return { kind: "inline", text: asset.text, href: src.originalUrl ?? null, license, provenance: src.provenance ?? `站内原件 · ${asset.name}` };
    }
    if (src.originalUrl) return { kind: "external", href: src.originalUrl, license, provenance: src.provenance ?? "外部公开来源" };
    throw new DemoMissingError(`originalUrl:${assetId}`, "没有可公开外链，也没有站内原件文本");
  }

  // ── 证据卡 / 比较 ──────────────────────────────────────────
  function paperOfCard(c) {
    if (c.paperId) return idx.papers.get(c.paperId) ?? null;
    const att = arr(snapshot.attachments).find((a) => a.assetId === c.assetId);
    return att ? idx.papers.get(att.paperId) ?? null : null;
  }
  function listCards(filter = {}) {
    let cards = arr(snapshot.cards);
    if (filter.topicId) {
      cards = cards.filter((c) => {
        const p = paperOfCard(c);
        if (p) return !p.topicIds?.length || p.topicIds.includes(filter.topicId);
        const a = idx.assets.get(c.assetId);
        return !a?.topicId || a.topicId === filter.topicId;
      });
    }
    if (filter.paperId) cards = cards.filter((c) => paperOfCard(c)?.id === filter.paperId);
    if (filter.assetId) cards = cards.filter((c) => c.assetId === filter.assetId);
    if (filter.audit) cards = cards.filter((c) => filter.audit.includes(c.audit));
    return cards;
  }
  function getCard(id) { const c = idx.cards.get(id); need(c, `card:${id}`, "证据卡不存在"); return c; }

  function knowledgeItemEnvelopesOfCard(cardId) {
    return arr(snapshot.knowledge?.items).filter((e) => e.payload?.cardId === cardId);
  }
  /** 卡片详情：条件、数据/论据、出处定位、知识条目关系。 */
  function getCardDetail(id) {
    const card = getCard(id);
    const paper = paperOfCard(card);
    const source = getAsset(card.assetId);
    const items = knowledgeItemEnvelopesOfCard(id).map((e) => ({
      id: e.id, revision: e.revision, text: e.payload?.text ?? "", status: e.payload?.review?.status ?? "pending",
      contexts: (e.payload?.contextRefs ?? []).map((r) => ({ id: r.id, revision: r.revision, context: idx.knowledgeContexts.get(r.id) ?? null })),
      evidence: (e.payload?.evidenceRefs ?? []).map((er) => ({ ref: er.ref, fieldPaths: er.fieldPaths, evidence: idx.knowledgeEvidence.get(er.ref?.id) ?? null })),
      relations: idx.knowledgeRelations.filter((r) => r.from?.id === e.id || r.to?.id === e.id),
    }));
    const contexts = [];
    for (const it of items) for (const cx of it.contexts) {
      const conds = cx.context?.payload?.conditions ?? [];
      for (const c of conds) contexts.push({ itemId: it.id, field: c.field?.raw ?? "", value: c.value, appliesTo: c.appliesTo, review: c.review });
    }
    return { card, paper, source, items, contexts, secondaryCitation: !!card.secondaryCitation };
  }

  function listComparisons(topicId) {
    if (demo.comparison) return [demo.comparison];
    return topicsOf(snapshot.comparisons, topicId ?? mainTopicId);
  }
  function getComparison(id) { const c = idx.comparisons.get(id); need(c, `comparison:${id}`, "比较快照不存在"); return c; }

  // ── 知识 ──────────────────────────────────────────────────
  function listKnowledgeItems(topicId) {
    const tid = topicId ?? mainTopicId;
    return arr(snapshot.knowledge?.items)
      .filter((e) => (e.payload?.topicIds ?? []).includes(tid))
      .map((e) => ({ ...e, card: e.payload?.cardId ? idx.cards.get(e.payload.cardId) ?? null : null }));
  }
  function getKnowledgeItemEnvelope(id) { const e = idx.knowledgeItems.get(id); need(e, `item:${id}`, "知识项不存在"); return e; }

  /** 严格按 revision 读取（同 server.ts:563）；读不到即缺项，不退回最新版。 */
  function knowledgeItem(id, revision) {
    const env = getKnowledgeItemEnvelope(id);
    need(Number.isInteger(revision) && revision >= 1, `knowledgeItem:${id}`, "必须指定正整数 revision");
    const available = [env.revision, ...arr(env.history).map((h) => h.revision)].sort((a, b) => a - b);
    let payload = null;
    if (env.revision === revision) payload = env.payload;
    else {
      const hit = arr(env.history).find((h) => h.revision === revision);
      payload = hit ? hit.payload : null;
    }
    need(payload, `knowledgeItem:${id}@r${revision}`, `第 ${revision} 版不可读（可用：${available.join(",")}）`);
    return { ok: true, id, revision, payload, availableRevisions: available };
  }

  function getContext(id) { const e = idx.knowledgeContexts.get(id); need(e, `context:${id}`, "条件对象不存在"); return e; }
  function getEvidence(id) { const e = idx.knowledgeEvidence.get(id); need(e, `evidence:${id}`, "引文对象不存在"); return e; }

  function knowledgeContainer() {
    const c = demo.knowledgeContainer;
    need(c, "knowledge/container", "A 未在快照中导出容器（demo.knowledgeContainer 缺失）；请用知识项明细查看，不伪造容器 token");
    return c;
  }

  // ── 科研链 ────────────────────────────────────────────────
  function listProtocols(topicId) { return topicsOf(snapshot.protocols, topicId ?? mainTopicId); }
  function getProtocol(id) {
    const pid = id || demo.mainProtocolId || listProtocols(mainTopicId)[0]?.id;
    const p = idx.protocols.get(pid);
    need(p, `protocol:${pid ?? "(main)"}`, "方案不存在");
    return p;
  }
  function getProtocolRevision(protocol, revision) {
    const rev = revision ?? protocol.revision;
    const snap = arr(protocol.revisions).find((r) => r.revision === rev);
    need(snap, `protocol:${protocol.id}@r${rev}`, `方案第 ${rev} 版不存在`);
    return snap;
  }

  function listExecutions(topicId) { return topicsOf(snapshot.executions, topicId ?? mainTopicId); }
  function getExecution(id) {
    const eid = id || demo.mainExecutionId || listExecutions(mainTopicId)[0]?.id;
    const e = idx.executions.get(eid);
    need(e, `execution:${eid ?? "(main)"}`, "执行记录不存在");
    return e;
  }
  function listSamples(executionId) { return arr(snapshot.samples).filter((s) => !executionId || s.executionId === executionId); }
  function listMeasurements(executionId) {
    const sampleIds = new Set(listSamples(executionId).map((s) => s.id));
    return arr(snapshot.measurements).filter((m) => !executionId || sampleIds.has(m.sampleId));
  }
  function getTable(id) { const t = idx.tables.get(id); need(t, `table:${id}`, "数据表不存在"); return t; }
  function listTables(topicId) {
    if (!topicId) return arr(snapshot.tables);
    return arr(snapshot.tables).filter((t) => { const a = idx.assets.get(t.assetId); return !a?.topicId || a.topicId === topicId; });
  }
  function executionDeviations(execution) { return arr(execution.events).filter((ev) => ev.kind === "deviation"); }
  function executionSteps(execution) {
    const proto = idx.protocols.get(execution.protocolId);
    const snap = execution.preparation?.snapshot
      ?? arr(proto?.revisions).find((r) => r.revision === (execution.preparation?.baseRevision ?? execution.protocolRevision));
    need(snap, `execution:${execution.id}`, "执行对应方案快照缺失");
    return snap.steps ?? [];
  }

  // ── 分析 / 报告 ────────────────────────────────────────────
  function listAnalysisTasks(topicId) { return topicsOf(snapshot.analysisTasks, topicId ?? mainTopicId); }
  function getAnalysisTask(id) {
    const tid = id || demo.mainTaskId || listAnalysisTasks(mainTopicId)[0]?.id;
    const t = idx.tasks.get(tid);
    need(t, `task:${tid ?? "(main)"}`, "分析任务不存在");
    return t;
  }
  /** 必须读实跑生成的图；缺失报缺项，不现场合成。 */
  function getContextMap(taskId) {
    const map = demo.contextMaps?.[taskId];
    need(map, `contextMaps[${taskId}]`, "快照未包含该任务的实跑上下文地图（A 需导出 /api/analysis/tasks/:id/map 结果）");
    return map;
  }
  function listResults(task) {
    const ids = arr(task.resultIds);
    const list = ids.length ? ids.map((id) => idx.results.get(id)).filter(Boolean) : arr(snapshot.analysisResults).filter((r) => r.taskId === task.id);
    need(list.length, `task:${task.id}/results`, "该任务没有结果对象");
    return list;
  }
  function listReports(taskId) { return arr(snapshot.reports).filter((r) => r.taskId === taskId); }
  function getReport(id) { const r = idx.reports.get(id); need(r, `report:${id}`, "报告不存在"); return r; }

  // ── 对话 / 建议 / ZIP ─────────────────────────────────────
  function listChats(topicId) { return topicsOf(snapshot.chats, topicId ?? mainTopicId); }
  function getChat(id) {
    const cid = id || demo.mainChatId || listChats(mainTopicId)[0]?.id;
    const c = idx.chats.get(cid);
    need(c, `chat:${cid ?? "(main)"}`, "预生成对话不存在");
    return c;
  }
  function listSuggestions() { return arr(demo.suggestions).slice(0, 2); }
  function zipInfo() {
    const z = demo.zip;
    need(z && z.fileName, "demo.zip", "快照未提供样本 ZIP（A 需导出文件名与 SHA-256）");
    return z;
  }
  function presetInfo() { return demo.preset ?? { ai: true, model: "未标注", generatedAt: snapshot.generatedAt ?? "" }; }
  function extractionRuns() { return arr(snapshot.knowledge?.extractionRuns); }
  function figures() { return demo.figures ?? {}; }
  function isFixture() { return snapshot.fixture === true || demo.fixture === true; }
  function meta() {
    return {
      schemaVersion: snapshot.schemaVersion ?? null,
      fixtureVersion: snapshot.fixtureVersion ?? "未标注",
      sourceCommit: snapshot.sourceCommit ?? "未标注",
      projectId: snapshot.projectId ?? "",
      generatedAt: snapshot.generatedAt ?? "",
      mainTopicId,
    };
  }

  // ── 回查网络 ──────────────────────────────────────────────
  let graphCache = null;
  function buildGraph() {
    if (graphCache) return graphCache;
    // A 正式数据带真实引用网络（buildNetwork 生成）：直接用，不另派生。
    if (Array.isArray(demo.references?.nodes) && demo.references.nodes.length) {
      const nodes = new Map(demo.references.nodes.map((n) => [n.key ?? `${n.kind}:${n.id}`, n]));
      graphCache = { nodes, edges: arr(demo.references.edges) };
      return graphCache;
    }
    const nodes = new Map();
    const edges = [];
    const addNode = (kind, id, label) => {
      if (!id) return;
      const key = `${kind}:${id}`;
      if (!nodes.has(key)) nodes.set(key, { key, kind, id, label: label ?? id });
      return key;
    };
    const addEdge = (a, b, edgeKind) => { if (a && b && a !== b) edges.push({ from: a, to: b, edgeKind }); };

    for (const t of arr(snapshot.topics)) addNode("topic", t.id, t.name);
    for (const q of arr(snapshot.subquestions)) { addNode("subquestion", q.id, q.question); addEdge(`topic:${q.topicId}`, `subquestion:${q.id}`, "has_subquestion"); }
    for (const p of arr(snapshot.papers)) addNode("paper", p.id, p.title);
    for (const a of arr(snapshot.assets)) addNode("asset", a.id, a.name);
    for (const at of arr(snapshot.attachments)) addEdge(`paper:${at.paperId}`, `asset:${at.assetId}`, "attachment");
    for (const c of arr(snapshot.cards)) {
      addNode("card", c.id, c.scope || c.rawText?.slice(0, 24) || c.id);
      addEdge(`card:${c.id}`, `asset:${c.assetId}`, "evidence");
      const paper = paperOfCard(c);
      if (paper) addEdge(`card:${c.id}`, `paper:${paper.id}`, "card_of_paper");
    }
    for (const e of arr(snapshot.knowledge?.items)) {
      addNode("item", e.id, e.payload?.text?.slice(0, 24) || e.id);
      if (e.payload?.cardId) addEdge(`item:${e.id}`, `card:${e.payload.cardId}`, "from_card");
      for (const r of arr(e.payload?.contextRefs)) addEdge(`item:${e.id}`, `context:${r.id}`, "context");
      for (const er of arr(e.payload?.evidenceRefs)) addEdge(`item:${e.id}`, `evidence:${er.ref?.id}`, "evidence");
    }
    for (const c of arr(snapshot.knowledge?.contexts)) addNode("context", c.id, "条件");
    for (const ev of arr(snapshot.knowledge?.evidence)) addNode("evidence", ev.id, "引文");
    for (const tb of arr(snapshot.tables)) { addNode("table", tb.id, tb.name); addEdge(`table:${tb.id}`, `asset:${tb.assetId}`, "from_asset"); }
    for (const m of arr(snapshot.measurements)) {
      addNode("measurement", m.id, `${m.method} ${m.value}${m.unit}`);
      if (m.sampleId) addEdge(`measurement:${m.id}`, `sample:${m.sampleId}`, "measured_on");
      if (m.cellRef?.tableId) addEdge(`measurement:${m.id}`, `table:${m.cellRef.tableId}`, "cell_ref");
    }
    for (const s of arr(snapshot.samples)) { addNode("sample", s.id, s.displayName || s.shortName); if (s.executionId) addEdge(`sample:${s.id}`, `execution:${s.executionId}`, "in_execution"); }
    for (const e of arr(snapshot.executions)) {
      addNode("execution", e.id, e.id);
      addEdge(`execution:${e.id}`, `protocol:${e.protocolId}`, "follows_protocol");
      if (e.sourceAssetId) addEdge(`execution:${e.id}`, `asset:${e.sourceAssetId}`, "from_source");
    }
    for (const p of arr(snapshot.protocols)) { addNode("protocol", p.id, p.name); if (p.sourceAssetId) addEdge(`protocol:${p.id}`, `asset:${p.sourceAssetId}`, "from_source"); }
    for (const t of arr(snapshot.analysisTasks)) {
      addNode("task", t.id, t.title);
      for (const r of [...arr(t.core), ...arr(t.optional).map((o) => o.ref)]) addEdge(`task:${t.id}`, `${r.kind}:${r.id}`, "context_input");
    }
    for (const r of arr(snapshot.analysisResults)) {
      addNode("result", r.id, r.method);
      addEdge(`result:${r.id}`, `task:${r.taskId}`, "result_of");
      for (const aid of arr(r.assetIds)) addEdge(`result:${r.id}`, `asset:${aid}`, "artifact");
    }
    for (const rep of arr(snapshot.reports)) {
      addNode("report", rep.id, `分析初稿 r${rep.revision}`);
      if (rep.taskId) addEdge(`report:${rep.id}`, `task:${rep.taskId}`, "from_task");
      for (const b of arr(rep.blocks)) {
        addNode("block", b.id, b.text?.slice(0, 24) || b.id);
        addEdge(`report:${rep.id}`, `block:${b.id}`, "has_block");
        for (const ref of arr(b.refs)) if (ref.kind !== "note") addEdge(`block:${b.id}`, `${ref.kind}:${ref.id}`, "cites");
      }
    }
    for (const c of arr(snapshot.chats)) {
      addNode("chat", c.id, "预生成对话");
      for (const r of arr(c.scope)) addEdge(`chat:${c.id}`, `${r.kind}:${r.id}`, "scope");
    }
    graphCache = { nodes, edges };
    return graphCache;
  }

  function backtrace(kind, id, dir = "both") {
    need(KINDS.has(kind), `backtrace:${kind}`, `未知对象类型 ${kind}`);
    const G = buildGraph();
    const start = `${kind}:${id}`;
    need(G.nodes.has(start), `backtrace:${start}`, "起点对象不在快照引用网络中");
    const out = dir === "down" || dir === "both";
    const inn = dir === "up" || dir === "both";
    const seen = new Set([start]);
    const queue = [start];
    const picked = [];
    while (queue.length) {
      const cur = queue.shift();
      for (const e of G.edges) {
        let nxt = null;
        if (out && e.from === cur) nxt = e.to;
        if (inn && e.to === cur) nxt = e.from;
        if (!nxt) continue;
        picked.push(e);
        if (!seen.has(nxt)) { seen.add(nxt); queue.push(nxt); }
      }
    }
    const uniq = [];
    const ek = new Set();
    for (const e of picked) { const k = `${e.from}>${e.to}:${e.edgeKind}`; if (!ek.has(k)) { ek.add(k); uniq.push(e); } }
    return { ok: true, start: { kind, id }, nodes: [...seen].map((k) => G.nodes.get(k)), edges: uniq };
  }

  const api = {
    meta, isFixture, getMainTopic, listTopics, getTopic, listSubquestions,
    listPapers, getPaper, listAttachments, getAttachment, getAsset, getSource, getOriginalUrl,
    listCards, getCard, getCardDetail, listComparisons, getComparison,
    listKnowledgeItems, getKnowledgeItemEnvelope, knowledgeItem, getContext, getEvidence, knowledgeContainer, extractionRuns,
    listProtocols, getProtocol, getProtocolRevision,
    listExecutions, getExecution, executionSteps, executionDeviations, listSamples, listMeasurements, listTables, getTable,
    listAnalysisTasks, getAnalysisTask, getContextMap, listResults, listReports, getReport,
    listChats, getChat, listSuggestions, zipInfo, presetInfo, figures, backtrace,
  };
  return Object.freeze(api);
}

export function loadDemoSnapshot(url, fetchImpl = fetch) {
  return fetchImpl(url, { headers: { accept: "application/json" } })
    .then((res) => {
      if (!res.ok) throw new DemoMissingError(`snapshot:${url}`, `快照加载失败（HTTP ${res.status}）`);
      return res.json();
    })
    .then((json) => deepFreeze(json));
}
