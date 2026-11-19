/**
 * 6A-2 真实引用网络：从现有 state 的**实际引用字段**确定性建边，按关系类型遍历。
 *
 * 关系语义（见 03_DOMAIN_RUNTIME / ADR-0008）：
 * - affiliation 组织归属（论文↔附件↔卡、报告↔块）
 * - provenance 来源溯源（卡←原件、结果←结果附件、执行←方案来源原件）
 * - lineage 处理依赖（方案→执行→样品→测量→分析→报告）
 * - support 科学依据（卡/证据→解释/报告块）
 *
 * 方向约定：边 from（上游/被依赖）→ to（下游/依赖者）。下游 = 受改动影响者。
 * 回查是**网络**，按类型边遍历，不要求固定全对象串联（12_DOMAIN_BOUNDARIES）。
 * 本模型无内部 Run：分析结果一律标 external，明示"无内部 Run"，不伪造。
 */
import type { LocusState } from "../store.ts";
import type { EdgeKind } from "../domain/graph.ts";

export type NetKind =
  | "topic" | "subquestion" | "paper" | "attachment" | "asset" | "card"
  | "protocol" | "template" | "execution" | "sample" | "measurement" | "table"
  | "task" | "result" | "report" | "block" | "chat";

export interface NetNode {
  readonly key: string;
  readonly kind: NetKind;
  readonly id: string;
  readonly label: string;
  readonly version?: string;
  /** 无内部 Run 的结果：显式标注，供回查时明示。 */
  readonly external?: boolean;
  readonly pending?: string[];
}

export interface NetEdge {
  readonly from: string;
  readonly to: string;
  readonly edgeKind: EdgeKind;
  readonly establishedBy: "run" | "human";
  readonly note?: string;
}

export interface Network {
  readonly nodes: Map<string, NetNode>;
  readonly edges: NetEdge[];
}

const key = (kind: NetKind, id: string): string => `${kind}:${id}`;

/** 从 state 确定性建边（不推断、不补造；无引用字段处不建边）。 */
export function buildNetwork(state: LocusState): Network {
  const nodes = new Map<string, NetNode>();
  const edges: NetEdge[] = [];
  const add = (n: NetNode) => { if (!nodes.has(n.key)) nodes.set(n.key, n); };
  const link = (from: NetNode, to: NetNode, edgeKind: EdgeKind, establishedBy: "run" | "human", note?: string) => {
    add(from); add(to);
    edges.push({ from: from.key, to: to.key, edgeKind, establishedBy, note });
  };

  const paper = (id: string): NetNode | undefined => {
    const p = state.papers.find((x) => x.id === id);
    return p ? { key: key("paper", p.id), kind: "paper", id: p.id, label: p.title || p.id, version: `r${p.revision}` } : undefined;
  };
  const asset = (id: string, label?: string): NetNode => {
    const a = state.assets.find((x) => x.id === id);
    return { key: key("asset", id), kind: "asset", id, label: label ?? a?.name ?? id };
  };

  // 专题 / 子问题
  for (const t of state.topics) add({ key: key("topic", t.id), kind: "topic", id: t.id, label: t.name });
  for (const q of state.subquestions) {
    add({ key: key("subquestion", q.id), kind: "subquestion", id: q.id, label: q.question });
    const tp = nodes.get(key("topic", q.topicId));
    if (tp) link(tp, { key: key("subquestion", q.id), kind: "subquestion", id: q.id, label: q.question }, "affiliation", "human");
  }

  // 论文条目 / 正文附件
  for (const p of state.papers) {
    const pn = paper(p.id)!;
    add(pn);
    for (const tid of p.topicIds) { const tp = nodes.get(key("topic", tid)); if (tp) link(tp, pn, "affiliation", "human"); }
  }
  for (const att of state.attachments) {
    const pn = paper(att.paperId);
    const an: NetNode = { key: key("attachment", att.id), kind: "attachment", id: att.id, label: `附件 ${att.role}`, version: att.version || undefined };
    if (pn) link(pn, an, "affiliation", "human");
    else add(an);
    // 附件指向原件（若有）
    const av = nodes.get(key("asset", att.assetId)) ?? asset(att.assetId);
    link(an, av, "provenance", "human");
  }

  // 知识卡 → 原件（provenance）与 论文（affiliation）
  for (const c of state.cards) {
    const cn: NetNode = { key: key("card", c.id), kind: "card", id: c.id, label: c.rawText.slice(0, 30) || c.id, version: `核对 ${c.audit}` };
    link(asset(c.assetId), cn, "provenance", c.extraction === "ai" ? "run" : "human", c.mechanical ? "机械草稿（开发调试）" : undefined);
    if (c.paperId) { const pn = paper(c.paperId); if (pn) link(pn, cn, "affiliation", "human"); }
    for (const sp of c.spans ?? []) link(asset(sp.assetId), cn, "provenance", "run", sp.matched ? undefined : "定位未匹配");
  }

  // 方案 → 来源原件（provenance）/ 执行（lineage）/ 模板
  for (const pr of state.protocols) {
    const pn: NetNode = { key: key("protocol", pr.id), kind: "protocol", id: pr.id, label: pr.name, version: `r${pr.revision}（${pr.sourceKind}）` };
    add(pn);
    const tp = nodes.get(key("topic", pr.topicId)); if (tp) link(tp, pn, "affiliation", "human");
    if (pr.sourceAssetId) link(asset(pr.sourceAssetId), pn, "provenance", pr.sourceKind === "ai-draft" ? "run" : "human", pr.sourceKind === "reconstructed" ? "由公开材料重构" : undefined);
  }
  for (const tpl of state.templates) {
    const tn: NetNode = { key: key("template", tpl.id), kind: "template", id: tpl.id, label: `模板 r${tpl.protocolRevision}`, version: tpl.humanConfirmed ? "已确认" : "未确认" };
    const pn = nodes.get(key("protocol", tpl.protocolId));
    if (pn) link(pn, tn, "lineage", tpl.humanConfirmed ? "human" : "run");
    else add(tn);
  }

  // 执行 → 方案（lineage）；执行 → 样品（provenance）
  for (const e of state.executions) {
    const recon = e.origin === "reconstructed";
    const en: NetNode = { key: key("execution", e.id), kind: "execution", id: e.id, label: `执行 r${e.protocolRevision}${recon ? "（文献重构）" : ""}`, version: e.phase === "preparing" ? "准备稿未确认" : e.status };
    add(en);
    const pn = nodes.get(key("protocol", e.protocolId));
    if (pn) link(pn, en, "lineage", "human", `固定方案 r${e.protocolRevision}`);
    else for (const tid of [e.topicId]) { const tp = nodes.get(key("topic", tid)); if (tp) link(tp, en, "affiliation", "human"); }
    const tp2 = nodes.get(key("topic", e.topicId)); if (tp2 && pn) link(tp2, en, "affiliation", "human");
    if (recon && e.sourceAssetId) link(asset(e.sourceAssetId), en, "provenance", "human", "重构执行的文献来源");
    // 确认快照：执行记其基础方案版本；缺项如实登记
    const pending: string[] = [];
    if (recon) pending.push("历史文献重构（非本地实际实验；数值为原文陈述）");
    if ((e.phase ?? "recording") === "preparing") pending.push("执行准备稿未确认（无冻结快照）");
    if (!e.events.length) pending.push("尚无实际步骤事件");
    if (pending.length) nodes.set(en.key, { ...nodes.get(en.key)!, pending });
  }
  for (const s of state.samples) {
    const sn: NetNode = { key: key("sample", s.id), kind: "sample", id: s.id, label: `${s.shortName}（${s.displayName}）${s.origin === "reconstructed" ? "（文献重构）" : ""}`, version: `状态 ${s.states.length} 条` };
    add(sn);
    if (s.executionId) { const en = nodes.get(key("execution", s.executionId)); if (en) link(en, sn, "provenance", "human"); }
    const tp = nodes.get(key("topic", s.topicId)); if (tp) link(tp, sn, "affiliation", "human");
  }

  // 测量 → 样品（lineage，固定样品状态 revision）；测量 → 数据表（provenance，若回链单元格）
  for (const m of state.measurements) {
    const recon = (m.origin ?? state.samples.find((s) => s.id === m.sampleId)?.origin) === "reconstructed";
    const mn: NetNode = { key: key("measurement", m.id), kind: "measurement", id: m.id, label: `${m.value}${m.unit ? ` ${m.unit}` : ""}${recon ? "（文献重构）" : ""}`, version: `样品状态 r${m.sampleStateRevision} · rev ${m.revision}` };
    const sn = nodes.get(key("sample", m.sampleId));
    if (sn) link(sn, mn, "lineage", "human");
    else add(mn);
    if (m.cellRef) link({ key: key("table", m.cellRef.tableId), kind: "table", id: m.cellRef.tableId, label: state.tables.find((t) => t.id === m.cellRef!.tableId)?.name ?? m.cellRef.tableId }, mn, "provenance", "human", `单元格 r${m.cellRef.row},c${m.cellRef.col}`);
  }
  for (const t of state.tables) {
    const tn: NetNode = { key: key("table", t.id), kind: "table", id: t.id, label: `${t.name}${t.origin === "reconstructed" ? "（文献重构）" : ""}`, version: `rev ${t.revision}` };
    add(tn);
    link(asset(t.assetId), tn, "provenance", "run");
  }

  // 分析任务 → 核心/候选对象（数据 lineage，卡片 support）
  for (const task of state.analysisTasks) {
    const kn: NetNode = { key: key("task", task.id), kind: "task", id: task.id, label: task.title, version: task.snapshot ? `快照 ${task.snapshot.hash.slice(0, 8)}` : "无快照" };
    add(kn);
    if (task.subquestionId) { const qn = nodes.get(key("subquestion", task.subquestionId)); if (qn) link(qn, kn, "affiliation", "human"); }
    for (const ref of [...task.core, ...task.optional.filter((o) => o.included).map((o) => o.ref)]) {
      const upstream = nodeForRef(state, ref);
      if (upstream) link(upstream, kn, ref.kind === "card" ? "support" : "lineage", "human");
    }
  }

  // 结果 → 任务（lineage）；结果 → 结果附件（provenance）；无内部 Run 显式标注
  for (const r of state.analysisResults) {
    const rn: NetNode = {
      key: key("result", r.id), kind: "result", id: r.id, label: `${r.method}（rev ${r.revision}）`,
      version: r.reproducible ? "可复现" : `不可复现：${r.missing.join("；")}`,
      external: true, pending: ["无内部 Run（外部工具/人工处理，本站不重建专业软件）"],
    };
    const kn = nodes.get(key("task", r.taskId));
    if (kn) link(kn, rn, "lineage", "human");
    else add(rn);
    for (const aid of r.assetIds) link(asset(aid), rn, "provenance", "human", "结果附件");
  }

  // 报告 → 块（affiliation）；块 → 引用对象（support/lineage/provenance）
  for (const rep of state.reports) {
    const rpn: NetNode = { key: key("report", rep.id), kind: "report", id: rep.id, label: `分析初稿 r${rep.revision}`, version: `钉住 ${rep.pinned.resultIds.length} 结果` };
    add(rpn);
    const tp = nodes.get(key("topic", rep.topicId)); if (tp) link(tp, rpn, "affiliation", "human");
    if (rep.pinned.taskId) { const kn = nodes.get(key("task", rep.pinned.taskId)); if (kn) link(kn, rpn, "lineage", "human"); }
    for (const rid of rep.pinned.resultIds) { const rn = nodes.get(key("result", rid)); if (rn) link(rn, rpn, "support", "human", "钉住结果"); }
    for (const b of rep.blocks) {
      const bn: NetNode = { key: key("block", b.id), kind: "block", id: b.id, label: b.text.slice(0, 30) || `块#${b.order + 1}`, version: `${b.nature}${b.draft ? " · AI草稿" : ""}` };
      link(rpn, bn, "affiliation", "human");
      for (const ref of b.refs) {
        if (ref.kind === "note") continue;
        const upstream = nodeForRef(state, { kind: ref.kind as never, id: ref.id });
        if (!upstream) continue;
        const ek: EdgeKind = ref.kind === "card" ? "support" : ref.kind === "result" ? "support" : ref.kind === "asset" ? "provenance" : "lineage";
        link(upstream, bn, ek, "human", `固定版本 ${ref.version || "未标"}`);
      }
    }
  }

  // 对话（affiliation 到课题；范围对象为 support）
  for (const c of state.chats) {
    const cn: NetNode = { key: key("chat", c.id), kind: "chat", id: c.id, label: `对话（${c.messages.length} 消息）` };
    add(cn);
    const tp = nodes.get(key("topic", c.topicId)); if (tp) link(tp, cn, "affiliation", "human");
    for (const ref of c.scope) { const up = nodeForRef(state, ref); if (up) link(up, cn, "support", "human"); }
  }

  return { nodes, edges };
}

/** 把一个应用层 ref（ObjectRef/块引用）映射为网络节点（不存在则 undefined，不补造）。 */
export function nodeForRef(state: LocusState, ref: { kind: string; id: string }): NetNode | undefined {
  switch (ref.kind) {
    case "execution": { const e = state.executions.find((x) => x.id === ref.id); return e ? { key: key("execution", e.id), kind: "execution", id: e.id, label: `执行 r${e.protocolRevision}` } : undefined; }
    case "protocol": { const p = state.protocols.find((x) => x.id === ref.id); return p ? { key: key("protocol", p.id), kind: "protocol", id: p.id, label: p.name, version: `r${p.revision}` } : undefined; }
    case "measurement": { const m = state.measurements.find((x) => x.id === ref.id); return m ? { key: key("measurement", m.id), kind: "measurement", id: m.id, label: m.value } : undefined; }
    case "table": { const t = state.tables.find((x) => x.id === ref.id); return t ? { key: key("table", t.id), kind: "table", id: t.id, label: t.name } : undefined; }
    case "card": { const c = state.cards.find((x) => x.id === ref.id); return c ? { key: key("card", c.id), kind: "card", id: c.id, label: c.rawText.slice(0, 30) } : undefined; }
    case "asset": { const a = state.assets.find((x) => x.id === ref.id); return a ? { key: key("asset", a.id), kind: "asset", id: a.id, label: a.name } : undefined; }
    case "subquestion": { const q = state.subquestions.find((x) => x.id === ref.id); return q ? { key: key("subquestion", q.id), kind: "subquestion", id: q.id, label: q.question } : undefined; }
    case "result": { const r = state.analysisResults.find((x) => x.id === ref.id); return r ? { key: key("result", r.id), kind: "result", id: r.id, label: r.method, external: true } : undefined; }
    case "report": { const r = state.reports.find((x) => x.id === ref.id); return r ? { key: key("report", r.id), kind: "report", id: r.id, label: `分析初稿 r${r.revision}` } : undefined; }
    default: return undefined;
  }
}

export interface Traversal {
  readonly start: NetNode | undefined;
  readonly nodes: NetNode[];
  readonly edges: NetEdge[];
  /** 按关系类型分组的下游（受影响者）。 */
  readonly downstreamByKind: Record<string, NetNode[]>;
  readonly pending: string[];
}

export interface TraverseOptions {
  readonly direction?: "down" | "up" | "both";
  readonly edgeKinds?: readonly EdgeKind[];
  readonly maxDepth?: number;
}

/** 从一个节点按关系类型遍历网络（回查：默认双向；影响：direction=down）。 */
export function traverseNetwork(state: LocusState, startKey: string, opts: TraverseOptions = {}): Traversal {
  const net = buildNetwork(state);
  const start = net.nodes.get(startKey);
  const direction = opts.direction ?? "both";
  const allowed = opts.edgeKinds ? new Set(opts.edgeKinds) : null;
  const maxDepth = opts.maxDepth ?? 12;
  const seen = new Set<string>([startKey]);
  const usedEdges: NetEdge[] = [];
  let frontier = [startKey];
  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const e of net.edges) {
        if (allowed && !allowed.has(e.edgeKind)) continue;
        const forward = e.from === cur && (direction === "down" || direction === "both");
        const backward = e.to === cur && (direction === "up" || direction === "both");
        if (!forward && !backward) continue;
        const target = forward ? e.to : e.from;
        if (!usedEdges.includes(e)) usedEdges.push(e);
        if (!seen.has(target)) { seen.add(target); next.push(target); }
      }
    }
    frontier = next; depth++;
  }
  const nodes = [...seen].map((k) => net.nodes.get(k)).filter((n): n is NetNode => !!n);
  const downstreamByKind: Record<string, NetNode[]> = {};
  for (const e of net.edges) {
    if (e.from !== startKey) continue;
    if (allowed && !allowed.has(e.edgeKind)) continue;
    const to = net.nodes.get(e.to);
    if (to) (downstreamByKind[e.edgeKind] ??= []).push(to);
  }
  const pending = nodes.flatMap((n) => n.pending ?? []);
  return { start, nodes, edges: usedEdges, downstreamByKind, pending };
}

// ── 6A-3 上游改动命中：科学改变 → 具体复核对象；标题/备注 → 不误报 ─────────

export type ChangeCategory = "no_recompute" | "needs_review";

/** 实体字段 → 是否科学改动（确定性传播）；标题/备注/显示名不触发重算。 */
export function classifyChange(entityKind: string, fields: readonly string[]): ChangeCategory {
  const cosmetic = new Set(["title", "name", "note", "displayName", "label", "reason", "pins", "tags"]);
  const scientific = new Set(["value", "unit", "params", "conditions", "criteria", "amount", "handling", "steps", "method", "instrument", "sampleStateRevision", "withdrawn"]);
  if (fields.some((f) => scientific.has(f))) return "needs_review";
  if (fields.every((f) => cosmetic.has(f))) return "no_recompute";
  // 未知字段保守：需复核（不无difference报警，但也不静默）。
  return "needs_review";
}

export interface ChangeHit {
  readonly node: NetNode;
  readonly edgeKind: EdgeKind;
  readonly reason: string;
}

export interface ChangeImpact {
  readonly category: ChangeCategory;
  readonly entityKind: string;
  readonly entityId: string;
  readonly hits: ChangeHit[];
  readonly byKind: Record<string, NetNode[]>;
  readonly unknowns: string[];
}

/** 一次上游改动命中的下游对象（报告块/结果/分析/表/测量），按关系类型说明理由。 */
export function changeHits(
  state: LocusState,
  change: { kind: string; id: string; fields?: readonly string[]; withdrawn?: boolean },
): ChangeImpact {
  const net = buildNetwork(state);
  const startKey = key(change.kind as NetKind, change.id);
  const fields = change.fields ?? [];
  const category: ChangeCategory = change.withdrawn ? "needs_review" : classifyChange(change.kind, fields);
  const hits: ChangeHit[] = [];
  const byKind: Record<string, NetNode[]> = {};
  if (category === "no_recompute") {
    const node = net.nodes.get(startKey);
    return { category, entityKind: change.kind, entityId: change.id, hits, byKind, unknowns: node ? [] : [`对象不存在：${startKey}`] };
  }
  // 从改动对象沿下游遍历（不限边类型；结果/块为终端消费者）
  const seen = new Set<string>([startKey]);
  let frontier = [startKey];
  for (let depth = 0; depth < 12 && frontier.length; depth++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const e of net.edges) {
        if (e.from !== cur) continue;
        const to = net.nodes.get(e.to);
        if (!to) continue;
        hits.push({ node: to, edgeKind: e.edgeKind, reason: `${roadLabel(e.edgeKind)}：${net.nodes.get(e.from)?.label ?? e.from} → ${to.label}${e.note ? `（${e.note}）` : ""}` });
        if (!seen.has(to.key)) { seen.add(to.key); next.push(to.key); (byKind[to.kind] ??= []).push(to); }
      }
    }
    frontier = next;
  }
  const unknowns: string[] = [];
  for (const n of Object.values(byKind).flat()) if (n.pending) unknowns.push(...n.pending.map((p) => `${n.label}：${p}`));
  return { category, entityKind: change.kind, entityId: change.id, hits, byKind, unknowns };
}

function roadLabel(k: EdgeKind): string {
  return { affiliation: "归属", provenance: "溯源", lineage: "数据链", support: "科学依据" }[k];
}

export const EDGE_KIND_LABEL: Record<EdgeKind, string> = { affiliation: "归属", provenance: "溯源", lineage: "数据链", support: "科学依据" };
