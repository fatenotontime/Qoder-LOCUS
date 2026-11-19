/**
 * 上下文地图（只读）：供分析页把「勾选清单」换成真正的地图。
 * - 节点/边一律来自 `buildNetwork(state)`（不补造、不新增边类型）；同课题不等于连线。
 * - 必选自动推导（测量 → 样品 → 执行 → 方案）在此**后端化**（纯函数 `deriveCore`），
 *   与前端既有逻辑结果一致；待地图界面接入后再删前端旧推导。
 * - 只读：不写 state、不 save、不调用 AI、不起 job。
 * 见 docs/stage7/02_CONTEXT_MAP_API_PROMPT.md、ADR-0027。
 */
import type { LocusState, ObjectRef } from "../store.ts";
import { AppError } from "./app.ts";
import { buildNetwork, nodeForRef, type NetEdge, type NetKind, type NetNode } from "./references.ts";

/** 可加入上下文的可选对象类型（以 resolveFragment 支持者为准）。 */
const SELECTABLE_KINDS: ObjectRef["kind"][] = ["execution", "measurement", "table", "protocol", "card"];
const MAX_NODES = 300;
const CONTEXT_DEPTH = 6;

export interface MapPick { readonly kind: string; readonly id: string; }
export type MapRole = "core" | "selected" | "optional" | "context";
export interface MapGap { readonly code: string; readonly label: string; }
export interface MapNode {
  readonly key: string; readonly kind: string; readonly id: string; readonly label: string;
  readonly version?: string; readonly external?: boolean;
  readonly role: MapRole; readonly selectable: boolean; readonly gaps: MapGap[];
}
export interface MapEdge { readonly from: string; readonly to: string; readonly edgeKind: string; readonly establishedBy: string; readonly note?: string; }
export interface ContextMap {
  readonly ok: true;
  readonly scope: { readonly topicId: string; readonly subquestionId?: string; readonly taskId?: string; readonly frozen?: boolean };
  readonly nodes: MapNode[];
  readonly edges: MapEdge[];
  readonly gaps: ({ readonly key: string } & MapGap)[];
  readonly truncated: boolean;
}

const GAP_SOURCE_MISSING: MapGap = { code: "source_missing", label: "来源缺失" };
const pendingGaps = (n: NetNode): MapGap[] => (n.pending ?? []).map((p) => ({ code: "pending", label: p }));

/** 对象是否属本课题（表经原件归属；卡经论文归属）；对象不存在返回 null。 */
function inTopic(state: LocusState, topicId: string, kind: string, id: string): boolean | null {
  switch (kind) {
    case "execution": { const e = state.executions.find((x) => x.id === id); return e ? e.topicId === topicId : null; }
    case "protocol": { const p = state.protocols.find((x) => x.id === id); return p ? p.topicId === topicId : null; }
    case "measurement": { const m = state.measurements.find((x) => x.id === id); return m ? m.topicId === topicId : null; }
    case "table": { const t = state.tables.find((x) => x.id === id); if (!t) return null; const a = state.assets.find((x) => x.id === t.assetId); return !a?.topicId || a.topicId === topicId; }
    case "card": { const c = state.cards.find((x) => x.id === id); if (!c) return null; const p = c.paperId ? state.papers.find((x) => x.id === c.paperId) : null; return !p || !p.topicIds.length || p.topicIds.includes(topicId); }
    case "asset": { const a = state.assets.find((x) => x.id === id); return a ? (!a.topicId || a.topicId === topicId) : null; }
    case "subquestion": { const q = state.subquestions.find((x) => x.id === id); return q ? q.topicId === topicId : null; }
    default: return null;
  }
}

/**
 * 必选自动推导（纯函数，与前端 renderAnalysisForm 旧逻辑一致）：
 * pick 里的测量 → 其样品 → 执行 → 方案，一并为 core；表直接为 core；去重、保持顺序。
 * 缺环不报错：把缺口写在返回的 gaps（键＝该 pick 的 key）。
 */
export function deriveCore(state: LocusState, picks: MapPick[]): { core: ObjectRef[]; gaps: ({ key: string } & MapGap)[] } {
  const core: ObjectRef[] = picks.map((p) => ({ kind: p.kind as ObjectRef["kind"], id: p.id }));
  const seen = new Set(core.map((r) => `${r.kind}:${r.id}`));
  const gaps: ({ key: string } & MapGap)[] = [];
  for (const d of [...core]) {
    if (d.kind !== "measurement") continue;
    const m = state.measurements.find((x) => x.id === d.id);
    const s = m && state.samples.find((x) => x.id === m.sampleId);
    if (!s || !s.executionId) { gaps.push({ key: `measurement:${d.id}`, ...GAP_SOURCE_MISSING }); continue; }
    if (!seen.has(`execution:${s.executionId}`)) { seen.add(`execution:${s.executionId}`); core.push({ kind: "execution", id: s.executionId }); }
    const e = state.executions.find((x) => x.id === s.executionId);
    if (!e || !e.protocolId) { gaps.push({ key: `measurement:${d.id}`, ...GAP_SOURCE_MISSING }); continue; }
    if (!seen.has(`protocol:${e.protocolId}`)) { seen.add(`protocol:${e.protocolId}`); core.push({ kind: "protocol", id: e.protocolId }); }
  }
  return { core, gaps };
}

interface RoleRef { ref: ObjectRef; role: MapRole; }

/** 组装上下文地图（核心）。 */
export function buildContextMap(state: LocusState, opts: { topicId: string; subquestionId?: string; taskId?: string; pick?: MapPick[] }): ContextMap {
  const topicId = opts.topicId;
  if (!state.topics.some((t) => t.id === topicId)) throw new AppError(404, `课题不存在：${topicId}`);
  if (opts.subquestionId) {
    const q = state.subquestions.find((x) => x.id === opts.subquestionId);
    if (!q) throw new AppError(404, `子问题不存在：${opts.subquestionId}`);
    if (q.topicId !== topicId) throw new AppError(422, "子问题不属于该课题。");
  }

  const roles = new Map<string, MapRole>();
  const extraGaps = new Map<string, MapGap[]>();
  const put = (r: ObjectRef, role: MapRole) => roles.set(`${r.kind}:${r.id}`, role);
  const addGap = (key: string, g: MapGap) => extraGaps.set(key, [...(extraGaps.get(key) ?? []), g]);

  let frozen: boolean | undefined;
  if (opts.taskId) {
    const task = state.analysisTasks.find((t) => t.id === opts.taskId);
    if (!task) throw new AppError(404, `分析任务不存在：${opts.taskId}`);
    frozen = !!task.snapshot;
    for (const r of task.core) put(r, "core");
    for (const o of task.optional) put(o.ref, o.included ? "selected" : "optional");
  } else {
    // 建任务前：pick 推导 → core；已入候选知识卡默认 selected；同课题其余可选对象为 optional。
    const picks = (opts.pick ?? []).map((p) => {
      const belong = inTopic(state, topicId, p.kind, p.id);
      if (belong === null) throw new AppError(422, `所选对象不存在：${p.kind}:${p.id}`);
      if (belong === false) throw new AppError(422, `所选对象不属于该课题：${p.kind}:${p.id}`);
      return p;
    });
    const { core, gaps } = deriveCore(state, picks);
    for (const r of core) put(r, "core");
    for (const g of gaps) addGap(g.key, { code: g.code, label: g.label });
    // 默认已选＝已入候选知识卡
    for (const c of state.cards) {
      if (c.audit !== "confirm") continue;
      if (inTopic(state, topicId, "card", c.id) === true) put({ kind: "card", id: c.id }, "selected");
    }
    // 其他可选＝同课题的执行/测量/数据表/方案（未被 core/selected 占用）
    for (const k of ["protocol", "execution", "measurement", "table"] as const) {
      const coll = {
        protocol: state.protocols.filter((p) => p.topicId === topicId).map((p) => p.id),
        execution: state.executions.filter((e) => e.topicId === topicId).map((e) => e.id),
        measurement: state.measurements.filter((m) => m.topicId === topicId).map((m) => m.id),
        table: state.tables.filter((t) => { const a = state.assets.find((x) => x.id === t.assetId); return !a?.topicId || a.topicId === topicId; }).map((t) => t.id),
      }[k];
      for (const id of coll) { const key = `${k}:${id}`; if (!roles.has(key)) roles.set(key, "optional"); }
    }
  }

  const net = buildNetwork(state);
  // 节点集合：先取被指派角色的节点（以网络节点为准，缺失则不补造）。
  const kept = new Map<string, MapNode>();
  const addNode = (n: NetNode, role: MapRole) => {
    if (kept.has(n.key)) return;
    kept.set(n.key, {
      key: n.key, kind: n.kind, id: n.id, label: n.label, version: n.version, external: n.external,
      role, selectable: role === "selected" || role === "optional",
      gaps: [...(extraGaps.get(n.key) ?? []), ...pendingGaps(n)],
    });
  };
  for (const [key, role] of roles) {
    const n = net.nodes.get(key) ?? nodeForRef(state, { kind: key.split(":")[0], id: key.slice(key.indexOf(":") + 1) });
    if (n) addNode(n, role);
  }
  // 课题与子问题恒为 context
  const topicNode = net.nodes.get(`topic:${topicId}`); if (topicNode) addNode(topicNode, "context");
  if (opts.subquestionId) { const qn = net.nodes.get(`subquestion:${opts.subquestionId}`); if (qn) addNode(qn, "context"); }

  // 沿真实引用向上追溯来源（作 context），有界 + 不补造。
  {
    let frontier = [...kept.keys()];
    for (let depth = 0; depth < CONTEXT_DEPTH && frontier.length; depth++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of net.edges) {
          if (e.to !== cur) continue;
          if (kept.has(e.from)) continue;
          const n = net.nodes.get(e.from);
          if (!n) continue;
          addNode(n, "context");
          next.push(n.key);
        }
      }
      frontier = next;
    }
  }

  // 截断（有界）
  let nodeList = [...kept.values()].sort((a, b) => a.key.localeCompare(b.key));
  const truncated = nodeList.length > MAX_NODES;
  if (truncated) nodeList = nodeList.slice(0, MAX_NODES);
  const keySet = new Set(nodeList.map((n) => n.key));

  // 边：仅保留两端都在节点集合内的 buildNetwork 边（不补造）。
  const edges: MapEdge[] = net.edges
    .filter((e: NetEdge): e is NetEdge => keySet.has(e.from) && keySet.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, edgeKind: e.edgeKind, establishedBy: e.establishedBy, note: e.note }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.edgeKind.localeCompare(b.edgeKind));

  const gaps = nodeList.flatMap((n) => n.gaps.map((g) => ({ key: n.key, ...g })));

  return {
    ok: true,
    scope: { topicId, subquestionId: opts.subquestionId, taskId: opts.taskId, frozen },
    nodes: nodeList,
    edges,
    gaps,
    truncated,
  };
}

/** 解析 `pick` 查询串：`table:ID,measurement:ID`。 */
export function parsePicks(raw: string | null): MapPick[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf(":");
    if (i <= 0) throw new AppError(422, `pick 格式错误：${s}（应为 kind:id）。`);
    return { kind: s.slice(0, i), id: s.slice(i + 1) };
  }).map((p) => {
    if (!SELECTABLE_KINDS.includes(p.kind as ObjectRef["kind"])) throw new AppError(422, `pick 类型不支持：${p.kind}。`);
    return p;
  });
}
