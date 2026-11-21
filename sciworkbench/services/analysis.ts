/**
 * 5E 用例层：分析任务（上下文地图：核心＋可取消候选）/ 冻结上下文快照 /
 * 方法推荐（预期产物≠预设结论）/ 处理结果提交（实际方法＋不采纳须理由；
 * 只有图/缺参数可存但不标可复现）/ 初步报告（观察/假设/解释/待验证分列，修订留历史）/
 * 上下文对话（范围限定＋逐次冻结快照；讨论不改对象；采纳须目标＋预览＋人工确认）。
 */
import { randomUUID } from "node:crypto";
import type {
  LocusState, ObjectRef, ContextFragment, ContextSnapshot, AnalysisTaskRecord,
  AnalysisResultRecord, PreliminaryReportRecord, ReportBlock, ReportBlockRef, ReportBlockNature,
  ChatSessionRecord, ChatMessage, ChatProposal,
} from "../store.ts";
import { contentHash } from "../store.ts";
import { AppError, MAX_IMPORT_BYTES, makeAsset, assertLegacyCardConsumerUsable, isStructuredShell } from "./app.ts";
import {
  accessClosure, assertFixedRefsIntact, assertKnowledgeAccess, createKnowledgeStatement, currentViewId,
  describeItem, freezeKnowledge, knowledgeAccess, knowledgeItemConfirmedAt, knowledgeItemGate,
  knowledgeSourceAdapter, knowledgeSourceFragment, readKnowledge, readKnowledgeVersion, resolvePinnedRefs,
  shellItemRefs, snapshotAccessRefs,
} from "./knowledge-base.ts";
import type { KnowledgeSourceKind } from "./knowledge-base.ts";
import { exportKnowledge } from "./knowledge-export.ts";
import { canonicalHash, knowledgeRef as makeKnowledgeRef } from "../domain/knowledge.ts";
import type { ItemPayload, KnowledgeRef } from "../domain/knowledge.ts";
import { effectiveSnapshot, appendEvent } from "./experiment.ts";

const now = () => new Date().toISOString();
const str = (v: unknown): string => String(v ?? "").trim();
const EXCERPT_CAP = 1600;

function requireTopic(state: LocusState, topicId: string): void {
  if (!state.topics.some((t) => t.id === topicId)) throw new AppError(404, `课题不存在：${topicId}`);
}

function cap(s: string): string {
  return s.length > EXCERPT_CAP ? `${s.slice(0, EXCERPT_CAP)}…（摘录截断，全文见原件）` : s;
}

const REF_KINDS = ["execution", "protocol", "measurement", "table", "card", "asset", "subquestion", "item"];

/** 知识分项引用必须固定版本（§4.2）：审核与摘录都按那一版判定，不用最新版兜底。 */
function cleanRef(v: unknown): ObjectRef {
  const o = (v ?? {}) as Record<string, unknown>;
  const kind = str(o.kind);
  const id = str(o.id);
  if (!REF_KINDS.includes(kind)) throw new AppError(422, `不支持的上下文对象类型：${kind}`);
  if (!id) throw new AppError(422, "上下文对象缺少 id。");
  if (kind === "item") {
    const revision = o.revision;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
      throw new AppError(422, `知识项引用必须固定版本：item ${id} 缺少 revision。`, { code: "revision_required" });
    }
    return { kind: "item", id, revision };
  }
  if (o.revision !== undefined) throw new AppError(422, `只有知识项引用需要 revision：${kind} ${id} 不接受。`);
  return { kind: kind as ObjectRef["kind"], id };
}

/** 去重键：同 kind/id 不同 revision 不能合并（§4.2）。 */
const refKeyOf = (r: ObjectRef): string => (r.kind === "item" ? `item:${r.id}@r${r.revision ?? 0}` : `${r.kind}:${r.id}`);
const itemRef = (r: ObjectRef): KnowledgeRef => ({ kind: "item", id: r.id, revision: r.revision ?? 0 });

/** 候选项统一契约（创建与保存候选共用）：{ref:{kind,id}, included}；included:false 保留为未选候选。 */
function cleanOptionalItem(state: LocusState, v: unknown): { ref: ObjectRef; included: boolean } {
  const o = (v ?? {}) as Record<string, unknown>;
  if (!o.ref || typeof o.ref !== "object") throw new AppError(422, "候选项须为 {ref:{kind,id},included} 结构。");
  const ref = cleanRef(o.ref);
  resolveFragment(state, ref);
  return { ref, included: o.included === true };
}

/** 锁5（选择边界）：知识卡须人工确认才可被选用；核心与候选同查。取消选择（included:false）不经过此守卫。
 *  新契约阅读壳（§4.6.10）：分析上下文尚未接入分项选择，遇到即明确拒绝，不退回概述文本。 */
function assertSelectable(state: LocusState, ref: ObjectRef): void {
  if (ref.kind === "item") {
    const payload = readKnowledgeVersion(state.knowledge, itemRef(ref)) as ItemPayload | null;
    if (!payload) throw new AppError(422, `知识项版本不存在：item ${ref.id} 第 ${ref.revision ?? 0} 版（不退回最新版）。`, { code: "ref_unresolvable" });
    // 固定版本决定读到的内容；能否进入正式上下文再看该项现在的审核状态（§4.7 分项复检）。
    // §4.2/§4.6.9：门槛以**被引用版本**的审核为准（现撤回/排除仍阻断）。
    try { assertFixedRefsIntact(state, (payload.sourceRefs ?? [])); } catch (e) {
      throw new AppError(422, `知识项不能进入正式上下文：${(e as Error).message.slice(0, 120)}`, { code: "report_refs_unresolvable" });
    }
    const gate = knowledgeItemGate(state, itemRef(ref));
    if (!gate.ok) {
      const why = gate.reason === "pinned_not_confirmed"
        ? `被引用版本（第 ${ref.revision ?? 0} 版）审核为「${gate.pinnedStatus}」，当前版本为「${gate.liveStatus}」；须显式改绑到已确认版本后再选（不自动升级）`
        : gate.reason === "withdrawn" ? "该知识项已被撤回" : gate.reason === "excluded" ? "该知识项已被排除" : "引用版本不可读";
      throw new AppError(422, `知识项不能进入正式上下文：${why}（${payload.text.slice(0, 30)}）`, { code: "item_not_confirmed", reason: gate.reason });
    }
    return;
  }
  if (ref.kind !== "card") return;
  const c = state.cards.find((x) => x.id === ref.id);
  assertLegacyCardConsumerUsable(c, "分析上下文");
  if (c && c.audit !== "confirm") throw new AppError(422, `知识卡未入候选（须人工确认）：${c.rawText.slice(0, 30)}…`);
}

/** 锁5（冻结前统一复检）：送 AI 的上下文中不得含未确认知识卡——兜底旧任务遗留的未审候选。 */
function assertCardsConfirmed(state: LocusState, refs: ObjectRef[]): void {
  const badItems = refs.filter((r) => r.kind === "item").filter((r) => !knowledgeItemConfirmedAt(state, itemRef(r)));
  if (badItems.length) throw new AppError(422, `上下文含未确认的知识项（${badItems.length} 个），请先逐项确认或取消选择。`, { code: "item_not_confirmed", refs: badItems.map(itemRef) });
  for (const r of refs) if (r.kind === "card") assertLegacyCardConsumerUsable(state.cards.find((c) => c.id === r.id), "分析上下文");
  const bad = refs.filter((r) => r.kind === "card").map((r) => state.cards.find((c) => c.id === r.id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.audit !== "confirm");
  if (bad.length) throw new AppError(422, `上下文含未确认知识卡（${bad.length} 张），请先人工确认或取消选择：${bad.map((c) => c.rawText.slice(0, 20)).join("；")}`);
}

/** 解析引用为快照碎片：标签＋固定版本＋实际发送摘录。不存在即拒绝，不补造。 */
export function resolveFragment(state: LocusState, ref: ObjectRef): ContextFragment {
  const base = { ref };
  switch (ref.kind) {
    case "subquestion": {
      const q = state.subquestions.find((x) => x.id === ref.id);
      if (!q) throw new AppError(404, `子问题不存在：${ref.id}`);
      return { ...base, label: `子问题 · ${q.question}`, version: q.kind, excerpt: q.question };
    }
    case "execution": {
      const e = state.executions.find((x) => x.id === ref.id);
      if (!e) throw new AppError(404, `执行不存在：${ref.id}`);
      const p = state.protocols.find((x) => x.id === e.protocolId);
      const snap = effectiveSnapshot(state, e);
      const prep = (e.phase ?? "recording") === "preparing";
      const recon = e.origin === "reconstructed";
      const lines = [
        ...(recon ? ["性质：历史文献重构（非本地实际实验；数值为原文陈述，未实测）"] : []),
        `方案：${p?.name ?? e.protocolId}（基础 r${e.protocolRevision}${prep ? "，准备稿未确认" : ""}）`,
        `目的：${snap?.purpose ?? "（未写）"}`,
        `步骤：${(snap?.steps ?? []).map((s) => `${s.op}${s.durationMin === null ? "(时长未知)" : `(${s.durationMin}min${s.estimated ? "估" : ""})`}`).join(" → ")}`,
        `事件（${e.events.length}）：${e.events.map((ev) => `[${ev.kind}] ${ev.text}${ev.actual.durationMin !== undefined ? ` 实际${ev.actual.durationMin}min` : ""}`).join("；") || "无"}`,
        `状态：${e.status}`,
      ];
      return { ...base, label: `执行 · ${p?.name ?? e.protocolId}${recon ? "（文献重构）" : ""}`, version: `r${e.protocolRevision}${e.preparation?.snapshot ? `＋${e.preparation.adjustments.length}差异` : ""}`, excerpt: cap(lines.join("\n")) };
    }
    case "protocol": {
      const p = state.protocols.find((x) => x.id === ref.id);
      if (!p) throw new AppError(404, `方案不存在：${ref.id}`);
      const snap = p.revisions[p.revisions.length - 1];
      const recon = p.sourceKind === "reconstructed";
      return { ...base, label: `方案 · ${p.name}${recon ? "（文献重构）" : ""}`, version: `r${p.revision}`, excerpt: cap(`${recon ? "性质：方法按历史文献重构（非本地实测方案）\n" : ""}目的：${snap.purpose}\n步骤：${snap.steps.map((s) => `${s.op}${s.durationMin === null ? "(时长未知)" : `(${s.durationMin}min)`}`).join(" → ")}\n判据：${snap.criteria}`) };
    }
    case "measurement": {
      const m = state.measurements.find((x) => x.id === ref.id);
      if (!m) throw new AppError(404, `测量不存在：${ref.id}`);
      const smp = state.samples.find((x) => x.id === m.sampleId);
      const recon = (m.origin ?? smp?.origin) === "reconstructed";
      return { ...base, label: `测量 · ${smp?.shortName ?? m.sampleId}${recon ? "（文献重构）" : ""}`, version: `样品状态 r${m.sampleStateRevision} · rev ${m.revision}`, excerpt: `${recon ? "（历史文献重构数值，非本地测量）" : ""}值 ${m.value} ${m.unit} · 方法 ${m.method || "（未写）"} · 仪器 ${m.instrument || "（未写）"} · 时间 ${m.time}${m.note ? ` · 注：${m.note}` : ""}` };
    }
    case "table": {
      const t = state.tables.find((x) => x.id === ref.id);
      if (!t) throw new AppError(404, `数据表不存在：${ref.id}`);
      const head = t.columns.join(" | ");
      const rows = t.rows.slice(0, 30).map((r) => r.join(" | ")).join("\n");
      const recon = t.origin === "reconstructed";
      return { ...base, label: `数据表 · ${t.name}${recon ? "（文献重构）" : ""}`, version: `rev ${t.revision}`, excerpt: cap(`${recon ? "（历史文献重构数据，非本地实测）\n" : ""}${head}\n${rows}${t.rows.length > 30 ? `\n…（共 ${t.rows.length} 行，摘录前 30 行）` : ""}${t.markerRows?.length ? `\n（含 ${t.markerRows.length} 个标记行：疑似标题/备注/占位，保留原样待人工核对）` : ""}`) };
    }
    case "card": {
      const c = state.cards.find((x) => x.id === ref.id);
      if (!c) throw new AppError(404, `知识卡不存在：${ref.id}`);
      // §4.6.3：新壳 extracted 为空结构，不能读成「没数据就用概述」；此处 fail closed。
      assertLegacyCardConsumerUsable(c, "上下文摘录");
      if (isStructuredShell(c)) {
        // §4.6.9：整壳选择只在全部分项已确认后展开，逐项呈现（不拿 rawText 概述冒充内容）。
        const refs = shellItemRefs(state, c);
        const body = refs.map((r) => {
          const p = readKnowledgeVersion(state.knowledge, r) as ItemPayload | null;
          return p ? `【第 ${r.revision} 版】` + describeItem(state, p, r.revision) : `【${r.id}】版本不可读`;
        }).join("\n\n");
        return { ...base, label: `知识卡（结构化）· ${(c.rawText || c.note).slice(0, 40)}`, version: `${refs.length} 项·已确认`, excerpt: cap(body) };
      }
      return { ...base, label: `知识卡 · ${c.rawText.slice(0, 40)}`, version: `核对 ${c.audit}`, excerpt: cap(`${c.rawText}${c.scope ? `\n适用范围：${c.scope}` : ""}${c.interpretation ? `\n作者解释：${c.interpretation}` : ""}${c.secondaryCitation ? "\n（二手转引）" : ""}`) };
    }
    case "item": {
      // 固定版本读取：旧版从 history 取，取不到就拒绝，绝不用 latest 冒充（§4.2）。
      const payload = readKnowledgeVersion(state.knowledge, itemRef(ref)) as ItemPayload | null;
      if (!payload) throw new AppError(422, `知识项版本不存在：item ${ref.id} 第 ${ref.revision ?? 0} 版（不退回最新版）。`, { code: "ref_unresolvable" });
      return {
        ...base,
        label: `知识项 · ${payload.text.slice(0, 40)}`,
        version: `第${ref.revision ?? 0}版 · ${payload.review.status}`,
        excerpt: cap(describeItem(state, payload, ref.revision ?? 0)),
      };
    }
    case "asset": {
      const a = state.assets.find((x) => x.id === ref.id);
      if (!a) throw new AppError(404, `原件不存在：${ref.id}`);
      return { ...base, label: `原件 · ${a.name}`, version: `${a.bytes}B`, excerpt: a.text.startsWith("data:") ? "（二进制原件，仅元信息入上下文）" : cap(a.text) };
    }
  }
}

// ── 分析任务与上下文地图 ────────────────────────────────────

export function createAnalysisTask(
  state: LocusState,
  input: { topicId: string; subquestionId?: string; title: string; core: unknown[]; optional?: unknown[] },
): { state: LocusState; task: AnalysisTaskRecord } {
  requireTopic(state, input.topicId);
  const title = str(input.title);
  if (!title) throw new AppError(422, "分析任务标题不能为空。");
  const subquestionId = str(input.subquestionId) || undefined;
  if (subquestionId) {
    const q = state.subquestions.find((x) => x.id === subquestionId);
    if (!q) throw new AppError(404, `子问题不存在：${subquestionId}`);
    if (q.topicId !== input.topicId) throw new AppError(422, "子问题不属于该课题。");
  }
  const core = (input.core ?? []).map(cleanRef);
  if (!core.length) throw new AppError(422, "分析任务须至少挂一个核心对象（执行/测量/数据表）。");
  if (!core.some((r) => ["execution", "measurement", "table"].includes(r.kind))) {
    throw new AppError(422, "分析任务的核心须来自执行或测量数据（方案/知识卡可作补充核心）。");
  }
  for (const r of core) { resolveFragment(state, r); assertSelectable(state, r); }
  const coreKeys = new Set(core.map(refKeyOf));
  // 与核心重复的候选静默去重（前端必选自动推导可能与「其他可选」勾选重叠）。
  const optional = (input.optional ?? []).map((v) => cleanOptionalItem(state, v))
    .filter((o) => !coreKeys.has(refKeyOf(o.ref)));
  for (const o of optional) if (o.included) assertSelectable(state, o.ref);
  const task: AnalysisTaskRecord = {
    id: `atask_${randomUUID()}`, topicId: input.topicId, subquestionId, title,
    core, optional, resultIds: [], createdAt: now(), updatedAt: now(),
  };
  return { state: { ...state, analysisTasks: [...state.analysisTasks, task] }, task };
}

export function setTaskCandidates(
  state: LocusState,
  taskId: string,
  optional: { ref: unknown; included: boolean }[],
): { state: LocusState; task: AnalysisTaskRecord } {
  const cur = state.analysisTasks.find((t) => t.id === taskId);
  if (!cur) throw new AppError(404, `分析任务不存在：${taskId}`);
  const coreKeys = new Set(cur.core.map(refKeyOf));
  const list = optional.map((o) => {
    const item = cleanOptionalItem(state, o);
    if (coreKeys.has(refKeyOf(item.ref))) throw new AppError(422, "核心对象不能放入可取消候选。");
    if (item.included) assertSelectable(state, item.ref);
    return item;
  });
  const task: AnalysisTaskRecord = { ...cur, optional: list, updatedAt: now() };
  return { state: { ...state, analysisTasks: state.analysisTasks.map((t) => (t.id === taskId ? task : t)) }, task };
}

/** 冻结上下文快照：实际将发送的碎片＋版本＋目的＋模型＋提示词版本＋hash。 */
export function buildSnapshot(state: LocusState, task: AnalysisTaskRecord, purpose: string, model: string, promptVersion: string): ContextSnapshot {
  const refs: ObjectRef[] = [];
  if (task.subquestionId) refs.push({ kind: "subquestion", id: task.subquestionId });
  refs.push(...task.core, ...task.optional.filter((o) => o.included).map((o) => o.ref));
  assertCardsConfirmed(state, refs);
  const fragments = refs.map((r) => resolveFragment(state, r));
  const topic = state.topics.find((t) => t.id === task.topicId);
  const summary = `课题「${topic?.name ?? task.topicId}」· ${fragments.length} 个碎片（核心 ${task.core.length} ＋ 候选 ${task.optional.filter((o) => o.included).length}${task.subquestionId ? " ＋ 子问题" : ""}）`;
  return {
    at: now(), purpose, summary, model, promptVersion,
    hash: contentHash(JSON.stringify({ purpose, fragments })),
    fragments,
  };
}

export function snapshotInput(snap: ContextSnapshot): string {
  return `研究目的：${snap.purpose}\n上下文摘要：${snap.summary}\n\n上下文碎片（冻结，hash ${snap.hash}）：\n` +
    snap.fragments.map((f, i) => `【碎片 ${i + 1} · ${f.label} · ${f.version} · ${f.ref.kind}:${f.ref.id}】\n${f.excerpt}`).join("\n\n");
}

export function applyRecommendation(
  state: LocusState,
  taskId: string,
  value: unknown,
  raw: string,
  snapshot: ContextSnapshot,
): { state: LocusState; task: AnalysisTaskRecord } {
  const cur = state.analysisTasks.find((t) => t.id === taskId);
  if (!cur) throw new AppError(404, `分析任务不存在：${taskId}`);
  const obj = (value ?? {}) as { methods?: unknown; unknowns?: unknown };
  if (!Array.isArray(obj.methods)) throw new AppError(422, "方法推荐结果结构不符：缺少 methods。");
  const methods = obj.methods.map((m) => {
    const o = (m ?? {}) as Record<string, unknown>;
    const name = str(o.name);
    if (!name) throw new AppError(422, "推荐方法缺少名称。");
    return {
      name, software: str(o.software), rationale: str(o.rationale),
      expectedArtifacts: (Array.isArray(o.expectedArtifacts) ? o.expectedArtifacts : []).map(str).filter(Boolean),
      acceptanceItems: (Array.isArray(o.acceptanceItems) ? o.acceptanceItems : []).map(str).filter(Boolean),
    };
  });
  const task: AnalysisTaskRecord = {
    ...cur, snapshot,
    recommendation: { methods, unknowns: (Array.isArray(obj.unknowns) ? obj.unknowns : []).map(str).filter(Boolean), raw, at: now() },
    updatedAt: now(),
  };
  return { state: { ...state, analysisTasks: state.analysisTasks.map((t) => (t.id === taskId ? task : t)) }, task };
}

// ── 处理结果提交 ────────────────────────────────────────────

export function submitResult(
  state: LocusState,
  taskId: string,
  input: { method: string; params?: string; reason?: string; note?: string; assetIds?: string[]; adoptedRecommendation?: string },
): { state: LocusState; result: AnalysisResultRecord } {
  const task = state.analysisTasks.find((t) => t.id === taskId);
  if (!task) throw new AppError(404, `分析任务不存在：${taskId}`);
  const method = str(input.method);
  if (!method) throw new AppError(422, "实际使用的方法不能为空（外部工具也须写明实际方法）。");
  const assetIds = (input.assetIds ?? []).map(str).filter(Boolean);
  for (const id of assetIds) {
    const a = state.assets.find((x) => x.id === id);
    if (!a) throw new AppError(404, `结果原件不存在：${id}`);
    if (a.kind !== "result") throw new AppError(422, `原件 ${a.name} 不是结果附件（kind=result）。`);
  }
  const adopted = str(input.adoptedRecommendation);
  const reason = str(input.reason);
  if (adopted && !task.recommendation?.methods.some((m) => m.name === adopted)) {
    throw new AppError(422, `采纳的推荐方法不存在：${adopted}`);
  }
  if (task.recommendation && !adopted && !reason) {
    throw new AppError(422, "未采纳推荐方法时须填写简短理由（实际方法已记录）。");
  }
  const params = str(input.params);
  const hasData = assetIds.some((id) => {
    const a = state.assets.find((x) => x.id === id)!;
    return !a.text.startsWith("data:") && /\.(csv|tsv|json|txt|md)$/i.test(a.name);
  });
  const missing: string[] = [];
  if (!hasData) missing.push("未附数据文件（只有图/脚本不算可复现）");
  if (!params) missing.push("缺关键参数");
  const result: AnalysisResultRecord = {
    id: `ares_${randomUUID()}`, taskId, topicId: task.topicId,
    method, params, reason, note: str(input.note), assetIds,
    reproducible: missing.length === 0, missing, adoptedRecommendation: adopted,
    revision: 1, history: [], createdAt: now(), updatedAt: now(),
  };
  const nextTask: AnalysisTaskRecord = { ...task, resultIds: [...task.resultIds, result.id], updatedAt: now() };
  return {
    state: { ...state, analysisResults: [...state.analysisResults, result], analysisTasks: state.analysisTasks.map((t) => (t.id === taskId ? nextTask : t)) },
    result,
  };
}

export function editResult(
  state: LocusState,
  resultId: string,
  patch: { method?: string; params?: string; note?: string; reason: string },
): { state: LocusState; result: AnalysisResultRecord } {
  const cur = state.analysisResults.find((r) => r.id === resultId);
  if (!cur) throw new AppError(404, `结果不存在：${resultId}`);
  const reason = str(patch.reason);
  if (!reason) throw new AppError(422, "结果修订必须填写原因（留历史）。");
  const method = patch.method !== undefined ? str(patch.method) : cur.method;
  if (!method) throw new AppError(422, "实际使用的方法不能为空。");
  const params = patch.params !== undefined ? str(patch.params) : cur.params;
  const hasData = cur.assetIds.some((id) => {
    const a = state.assets.find((x) => x.id === id);
    return a && !a.text.startsWith("data:") && /\.(csv|tsv|json|txt|md)$/i.test(a.name);
  });
  const missing: string[] = [];
  if (!hasData) missing.push("未附数据文件（只有图/脚本不算可复现）");
  if (!params) missing.push("缺关键参数");
  const result: AnalysisResultRecord = {
    ...cur, method, params, note: patch.note !== undefined ? str(patch.note) : cur.note,
    reproducible: missing.length === 0, missing,
    revision: cur.revision + 1,
    history: [...cur.history, { revision: cur.revision, at: now(), reason, method: cur.method, params: cur.params }],
    updatedAt: now(),
  };
  return { state: { ...state, analysisResults: state.analysisResults.map((r) => (r.id === resultId ? result : r)) }, result };
}

// ── 分析初稿（有序块：顺序＋性质＋固定引用；块级 diff→接受→新版本）────
// 性质区分观察/假设/解释/待验证/人工判断；引用固定版本；AI 草稿带 draft 标记，须人工确认。

const NATURES: ReportBlockNature[] = ["observation", "hypothesis", "interpretation", "to_verify", "human_judgment"];
const BLOCK_REF_KINDS = ["result", "measurement", "table", "card", "execution", "protocol", "subquestion", "snapshot", "asset", "note"];
const NATURE_LABEL: Record<ReportBlockNature, string> = {
  observation: "观察", hypothesis: "假设", interpretation: "解释", to_verify: "待验证", human_judgment: "人工判断",
};

function cleanRefs(v: unknown): ReportBlockRef[] {
  return (Array.isArray(v) ? v : []).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const kind = str(o.kind);
    const label = str(o.label);
    if (!BLOCK_REF_KINDS.includes(kind)) throw new AppError(422, `不支持的引用类型：${kind}`);
    const id = str(o.id);
    if (kind !== "note" && !id) throw new AppError(422, `引用 ${kind} 缺少稳定 id。`);
    if (!label && !id) throw new AppError(422, "引用须有标签或 id。");
    return { kind: kind as ReportBlockRef["kind"], id, version: str(o.version), label };
  });
}

/**
 * 清洗报告块。生命周期字段不随内容编辑走：
 * 已有块的 draft/history 一律继承库内值（客户端值忽略；draft→false 仅 confirmReportBlock，历史由系统追加）；
 * 新块 draft 只接受 true（fail-closed：宁可多标待确认，不把新 AI 草稿当人工内容）。
 */
function cleanBlocks(v: unknown, current: ReportBlock[]): ReportBlock[] {
  const arr = Array.isArray(v) ? v : [];
  if (!arr.length) throw new AppError(422, "报告至少需要一个块（每块含内容与性质）。");
  const byId = new Map(current.map((b) => [b.id, b]));
  return arr.map((it, i) => {
    const x = (it ?? {}) as Record<string, unknown>;
    const text = str(x.text);
    if (!text) throw new AppError(422, "报告块内容不能为空。");
    const nature = str(x.nature);
    if (!NATURES.includes(nature as ReportBlockNature)) throw new AppError(422, `报告块性质不合法：${nature}`);
    const id = str(x.id);
    const prev = id ? byId.get(id) : undefined;
    return {
      id: id || `rblk_${randomUUID()}`,
      order: i,
      nature: nature as ReportBlockNature,
      text,
      refs: cleanRefs(x.refs),
      draft: prev ? prev.draft : x.draft === true,
      history: prev ? prev.history : [],
    };
  });
}

export interface BlockDiff {
  readonly baseRevision: number;
  readonly added: { nature: ReportBlockNature; text: string }[];
  readonly removed: { nature: ReportBlockNature; text: string }[];
  readonly changed: { id: string; text: string; fields: string[]; before: ReportBlock; after: ReportBlock }[];
  readonly reordered: { id: string; from: number; to: number }[];
  readonly same: boolean;
}

function blockFieldsDiffer(a: ReportBlock, b: ReportBlock): string[] {
  const f: string[] = [];
  if (a.text !== b.text) f.push("text");
  if (a.nature !== b.nature) f.push("nature");
  if (JSON.stringify(a.refs) !== JSON.stringify(b.refs)) f.push("refs");
  if (a.draft !== b.draft) f.push("draft");
  return f;
}

/** 块级 diff：新增/删除/修改（含字段）＋顺序变化。无对象引用者按 text+nature 匹配。 */
export function diffReportBlocks(current: ReportBlock[], proposed: ReportBlock[], baseRevision: number): BlockDiff {
  const byId = new Map(current.map((b) => [b.id, b]));
  const proposedIds = new Set(proposed.map((b) => b.id));
  const added: BlockDiff["added"] = [];
  const changed: BlockDiff["changed"] = [];
  const reordered: BlockDiff["reordered"] = [];
  for (const p of proposed) {
    const before = byId.get(p.id);
    if (!before) { added.push({ nature: p.nature, text: p.text }); continue; }
    const fields = blockFieldsDiffer(before, p);
    if (fields.length) changed.push({ id: p.id, text: p.text, fields, before, after: p });
    if (before.order !== p.order) reordered.push({ id: p.id, from: before.order, to: p.order });
  }
  const removed = current.filter((b) => !proposedIds.has(b.id)).map((b) => ({ nature: b.nature, text: b.text }));
  const same = !added.length && !removed.length && !changed.length && !reordered.length;
  return { baseRevision, added, removed, changed, reordered, same };
}

export function createReport(state: LocusState, input: { topicId: string; taskId?: string }): { state: LocusState; report: PreliminaryReportRecord } {
  requireTopic(state, input.topicId);
  const taskId = str(input.taskId) || undefined;
  const task = taskId ? state.analysisTasks.find((t) => t.id === taskId) : undefined;
  if (taskId && !task) throw new AppError(404, `分析任务不存在：${taskId}`);
  if (task && task.topicId !== input.topicId) throw new AppError(422, "分析任务不属于该课题。");
  const report: PreliminaryReportRecord = {
    id: `rep_${randomUUID()}`, topicId: input.topicId, taskId,
    pinned: { taskId, resultIds: task?.resultIds ?? [], snapshotHash: task?.snapshot?.hash },
    blocks: [],
    revision: 1, history: [], createdAt: now(), updatedAt: now(),
  };
  return { state: { ...state, reports: [...state.reports, report] }, report };
}

/** 预览块级 diff（不改状态）。baseRevision 供接受时做乐观并发校验。 */
export function previewReportEdit(state: LocusState, reportId: string, input: { blocks: unknown }): { baseRevision: number; diff: BlockDiff } {
  const cur = requireReport(state, reportId);
  const proposed = cleanBlocks(input.blocks, cur.blocks);
  return { baseRevision: cur.revision, diff: diffReportBlocks(cur.blocks, proposed, cur.revision) };
}

/** 接受块编辑 → 新版本；baseRevision 不符即 409（可恢复冲突，不覆盖）。改动块记录块内历史。 */
export function applyReportEdit(
  state: LocusState,
  reportId: string,
  input: { baseRevision: number; blocks: unknown; reason: string },
): { state: LocusState; report: PreliminaryReportRecord; diff: BlockDiff } {
  const cur = requireReport(state, reportId);
  if (Number(input.baseRevision) !== cur.revision) {
    throw new AppError(409, `报告已被他处修改（期望 r${input.baseRevision}，当前 r${cur.revision}）。请刷新后重试，不会覆盖新结果。`, { currentRevision: cur.revision });
  }
  const reason = str(input.reason);
  if (!reason) throw new AppError(422, "报告修订必须填写原因（留历史）。");
  let proposed = cleanBlocks(input.blocks, cur.blocks);
  const before = new Map(cur.blocks.map((b) => [b.id, b]));
  const at = now();
  // 已存在且内容变更的块：追加块内历史；新块/未变块保持原历史。
  proposed = proposed.map((b) => {
    const prev = before.get(b.id);
    if (!prev || blockFieldsDiffer(prev, b).length === 0) return b;
    return { ...b, history: [...prev.history, { at, reason, text: prev.text, nature: prev.nature }] };
  });
  const diff = diffReportBlocks(cur.blocks, proposed, cur.revision);
  if (diff.same) throw new AppError(422, "未检测到块改动；如需仅改原因，请修改内容或顺序。");
  const report: PreliminaryReportRecord = {
    ...cur, blocks: proposed, revision: cur.revision + 1,
    history: [...cur.history, { revision: cur.revision, at, reason, blocks: cur.blocks }],
    updatedAt: at,
  };
  return { state: { ...state, reports: state.reports.map((r) => (r.id === reportId ? report : r)) }, report, diff };
}

/** 人工确认 AI 草稿块（draft → confirmed）；讨论/生成不自动确认。 */
export function confirmReportBlock(state: LocusState, reportId: string, blockId: string, reason: string): { state: LocusState; report: PreliminaryReportRecord } {
  const cur = requireReport(state, reportId);
  const block = cur.blocks.find((b) => b.id === blockId);
  if (!block) throw new AppError(404, `报告块不存在：${blockId}`);
  if (!block.draft) throw new AppError(422, "该块非 AI 草稿，无需确认。");
  const r = str(reason) || "人工确认 AI 草稿";
  const blocks = cur.blocks.map((b) => (b.id === blockId ? { ...b, draft: false, history: [...b.history, { at: now(), reason: r, text: b.text, nature: b.nature }] } : b));
  const report: PreliminaryReportRecord = { ...cur, blocks, revision: cur.revision + 1, history: [...cur.history, { revision: cur.revision, at: now(), reason: r, blocks: cur.blocks }], updatedAt: now() };
  return { state: { ...state, reports: state.reports.map((x) => (x.id === reportId ? report : x)) }, report };
}

/** 由钉住的分析任务生成草稿块（本地确定性，不调用模型；标 draft 待人工确认）。 */
export function draftReportBlocks(state: LocusState, reportId: string): { blocks: ReportBlock[] } {
  const rep = requireReport(state, reportId);
  const task = rep.pinned.taskId ? state.analysisTasks.find((t) => t.id === rep.pinned.taskId) : undefined;
  const out: ReportBlock[] = [];
  const push = (nature: ReportBlockNature, text: string, refs: ReportBlockRef[]) => {
    out.push({ id: `rblk_${randomUUID()}`, order: out.length, nature, text, refs, draft: true, history: [] });
  };
  if (task) {
    const results = state.analysisResults.filter((r) => task.resultIds.includes(r.id));
    for (const res of results) {
      push("observation", `按「${res.method}」处理所得结果（参数：${res.params || "未记"}）${res.reproducible ? "" : "（不可复现：缺数据/参数）"}`,
        [{ kind: "result", id: res.id, version: `rev ${res.revision}`, label: `分析结果 ${res.method}` }]);
    }
    for (const m of task.recommendation?.methods ?? []) {
      push("to_verify", `待核验：${m.name} 的验收项 ${m.acceptanceItems.join("；") || "（未给）"}`,
        [{ kind: "snapshot", id: task.snapshot?.hash ?? "", version: task.snapshot?.hash ? task.snapshot.hash.slice(0, 8) : "", label: `任务 ${task.title} 快照` }]);
    }
  }
  return { blocks: out };
}

// ── 上下文对话 ──────────────────────────────────────────────

export function createChat(
  state: LocusState,
  input: { topicId: string; subquestionId?: string; scope?: unknown[] },
): { state: LocusState; chat: ChatSessionRecord } {
  requireTopic(state, input.topicId);
  const subquestionId = str(input.subquestionId) || undefined;
  if (subquestionId) {
    const q = state.subquestions.find((x) => x.id === subquestionId);
    if (!q) throw new AppError(404, `子问题不存在：${subquestionId}`);
    if (q.topicId !== input.topicId) throw new AppError(422, "子问题不属于该课题。");
  }
  const scope = (input.scope ?? []).map(cleanRef);
  for (const r of scope) { resolveFragment(state, r); assertSelectable(state, r); }
  const chat: ChatSessionRecord = {
    id: `chat_${randomUUID()}`, topicId: input.topicId, subquestionId, scope,
    messages: [], createdAt: now(), updatedAt: now(),
  };
  return { state: { ...state, chats: [...state.chats, chat] }, chat };
}

export function chatScopeSnapshot(state: LocusState, chat: ChatSessionRecord, purpose: string, model: string): ContextSnapshot {
  const refs: ObjectRef[] = [];
  if (chat.subquestionId) refs.push({ kind: "subquestion", id: chat.subquestionId });
  refs.push(...chat.scope);
  assertCardsConfirmed(state, refs);
  const fragments = refs.map((r) => resolveFragment(state, r));
  const topic = state.topics.find((t) => t.id === chat.topicId);
  return {
    at: now(), purpose, model, promptVersion: "context_chat/v1",
    summary: `课题「${topic?.name ?? chat.topicId}」对话 · 显式选取 ${chat.scope.length} 个对象${chat.subquestionId ? " ＋ 子问题" : ""}`,
    hash: contentHash(JSON.stringify({ purpose, fragments })),
    fragments,
  };
}

export function chatHistoryInput(chat: ChatSessionRecord): string {
  return chat.messages
    .filter((m) => m.status === "done" || m.role === "user")
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`)
    .join("\n");
}

/** 追加用户消息＋running 助手占位；返回助手消息 id（job 写回目标）。 */
export function appendChatTurn(state: LocusState, chatId: string, text: string): { state: LocusState; chat: ChatSessionRecord; messageId: string } {
  const cur = state.chats.find((c) => c.id === chatId);
  if (!cur) throw new AppError(404, `对话不存在：${chatId}`);
  const content = str(text);
  if (!content) throw new AppError(422, "消息内容不能为空。");
  if (cur.messages.some((m) => m.status === "running")) throw new AppError(409, "本对话已有消息在运行，请等待/取消后再发。");
  const user: ChatMessage = { id: `msg_${randomUUID()}`, role: "user", content, status: "done", proposals: [], sources: [], at: now() };
  const assistant: ChatMessage = { id: `msg_${randomUUID()}`, role: "assistant", content: "", status: "running", proposals: [], sources: [], at: now() };
  const chat: ChatSessionRecord = { ...cur, messages: [...cur.messages, user, assistant], updatedAt: now() };
  return { state: { ...state, chats: state.chats.map((c) => (c.id === chatId ? chat : c)) }, chat, messageId: assistant.id };
}

function patchMessage(state: LocusState, chatId: string, messageId: string, patch: Partial<ChatMessage>): LocusState {
  return {
    ...state,
    chats: state.chats.map((c) => c.id !== chatId ? c : {
      ...c, updatedAt: now(),
      messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
    }),
  };
}

export function applyChatResponse(state: LocusState, chatId: string, messageId: string, value: unknown, snapshot: ContextSnapshot): LocusState {
  const obj = (value ?? {}) as { answer?: unknown; sources?: unknown; proposals?: unknown };
  const answer = str(obj.answer);
  if (!answer) throw new AppError(422, "对话结果结构不符：缺少 answer。");
  const proposals: ChatProposal[] = (Array.isArray(obj.proposals) ? obj.proposals : [])
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { targetKind: str(o.targetKind), targetId: str(o.targetId), preview: str(o.preview), confirmed: false };
    })
    .filter((p) => {
      if (p.targetKind === "execution-note") return state.executions.some((e) => e.id === p.targetId) && !!p.preview;
      if (p.targetKind === "report-toVerify") return state.reports.some((r) => r.id === p.targetId) && !!p.preview;
      return false; // 越界目标/空预览：丢弃，不猜测
    });
  return patchMessage(state, chatId, messageId, {
    content: answer, status: "done", snapshot, proposals,
    sources: (Array.isArray(obj.sources) ? obj.sources : []).map(str).filter(Boolean),
  });
}

export function failChat(state: LocusState, chatId: string, messageId: string, error: string): LocusState {
  return patchMessage(state, chatId, messageId, { status: "failed", error });
}

/**
 * 启动恢复：job 仅在内存，服务重启后仍为 running 的消息已成孤儿 → 标失败可重试。
 * 只在加载时调用（正常运行时不会误伤在途消息）。稳定优先：模型消息不悬挂。
 */
export function recoverInterruptedChats(state: LocusState): { state: LocusState; recovered: number } {
  let recovered = 0;
  const chats = state.chats.map((c) => {
    if (!c.messages.some((m) => m.status === "running")) return c;
    const messages = c.messages.map((m) => {
      if (m.status !== "running") return m;
      recovered++;
      return { ...m, status: "failed" as const, error: "服务重启：任务中断，可重试。" };
    });
    return { ...c, messages };
  });
  return { state: { ...state, chats }, recovered };
}

export function cancelChat(state: LocusState, chatId: string, messageId: string): LocusState {
  const chat = state.chats.find((c) => c.id === chatId);
  const msg = chat?.messages.find((m) => m.id === messageId);
  if (!msg) throw new AppError(404, `消息不存在：${messageId}`);
  if (msg.status !== "running") throw new AppError(422, "只有运行中的消息可以取消。");
  return patchMessage(state, chatId, messageId, { status: "cancelled", error: "用户取消（在途请求的结果将被丢弃，不写回）" });
}

export function retryChat(state: LocusState, chatId: string, messageId: string): LocusState {
  const chat = state.chats.find((c) => c.id === chatId);
  const msg = chat?.messages.find((m) => m.id === messageId);
  if (!msg) throw new AppError(404, `消息不存在：${messageId}`);
  if (msg.status !== "failed" && msg.status !== "cancelled") throw new AppError(422, "只有失败/已取消的消息可以重试。");
  if (chat!.messages.some((m) => m.status === "running")) throw new AppError(409, "本对话已有消息在运行。");
  return patchMessage(state, chatId, messageId, { status: "running", error: undefined });
}

/** 采纳提案：目标＋预览＋人工确认缺一不可；讨论本身不改对象，只有这里写。 */
export function adoptProposal(
  state: LocusState,
  chatId: string,
  messageId: string,
  index: number,
  confirmed: boolean,
): { state: LocusState; applied: string } {
  if (confirmed !== true) throw new AppError(422, "采纳须人工确认（confirmed=true）；讨论不自动修改对象。");
  const chat = state.chats.find((c) => c.id === chatId);
  const msg = chat?.messages.find((m) => m.id === messageId);
  if (!msg) throw new AppError(404, `消息不存在：${messageId}`);
  const prop = msg.proposals[index];
  if (!prop) throw new AppError(404, `提案不存在：#${index}`);
  if (prop.confirmed) throw new AppError(409, "该提案已采纳，不重复写入。");
  let next: LocusState;
  let applied: string;
  if (prop.targetKind === "execution-note") {
    const r = appendEvent(state, prop.targetId, { kind: "note", text: `[上下文对话采纳] ${prop.preview}` });
    next = r.state;
    applied = `执行 ${prop.targetId} 追加备注`;
  } else {
    const cur = requireReport(state, prop.targetId);
    const block: ReportBlock = {
      id: `rblk_${randomUUID()}`, order: cur.blocks.length, nature: "to_verify",
      text: prop.preview, refs: [{ kind: "note", id: "", version: "", label: `对话 ${chatId} · 消息 ${messageId}` }],
      draft: false, history: [],
    };
    const report: PreliminaryReportRecord = {
      ...cur, blocks: [...cur.blocks, block], revision: cur.revision + 1,
      history: [...cur.history, { revision: cur.revision, at: now(), reason: "上下文对话采纳（人工确认）", blocks: cur.blocks }],
      updatedAt: now(),
    };
    next = { ...state, reports: state.reports.map((r) => (r.id === cur.id ? report : r)) };
    applied = `报告 ${cur.id} 待验证块 ＋1`;
  }
  const marked = patchMessage(next, chatId, messageId, {
    proposals: msg.proposals.map((p, i) => (i === index ? { ...p, confirmed: true, adoptedAt: now() } : p)),
  });
  return { state: marked, applied };
}

function requireReport(state: LocusState, reportId: string): PreliminaryReportRecord {
  const r = state.reports.find((x) => x.id === reportId);
  if (!r) throw new AppError(404, `报告不存在：${reportId}`);
  return r;
}

/** 结果附件归档（kind=result）：文本/数据/脚本按原文；图按 dataURL 原样。不触发解析、不虚构内部 Run。 */
export function archiveResultFile(
  state: LocusState,
  input: { name: string; content: string; topicId?: string },
): { state: LocusState; asset: import("../store.ts").AssetRecord } {
  const name = str(input.name);
  if (!name) throw new AppError(422, "结果附件须有文件名。");
  const content = String(input.content ?? "");
  if (!content.trim()) throw new AppError(422, "结果附件内容为空。");
  if (content.length > MAX_IMPORT_BYTES) throw new AppError(413, `结果附件超过 ${MAX_IMPORT_BYTES} 字节上限。`);
  if (content.startsWith("data:")) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(content)) throw new AppError(422, "图片附件仅支持 PNG/JPEG/WebP 的 dataURL。");
  } else {
    if (content.includes(String.fromCharCode(0))) throw new AppError(422, "文件疑似二进制，已拒绝；图片请用 dataURL 上传。");
  }
  const asset = makeAsset("result", name, content, input.topicId);
  return { state: { ...state, assets: [...state.assets, asset] }, asset };
}
// ══ E7-A 内置 AI 统一输入与引用校验（合同 §10 E7；服务层，前端无关）════════
//
// - 核心/可选预览一律从 readKnowledge 产生：核心=已选且过了正式门槛的固定版本；
//   可选=未选或未过门槛（含待审），带原因说明；explore 模式才允许待审进入核心并显式标记。
// - 发送时冻结快照（snapshotHash 覆盖 scope/mode/引用固定版本 + 实际 payload）；payload 可复查。
// - 超预算**不静默截断**：给出 requiresShrink 与省略说明，要求缩小范围或分页。
// - 模型返回的引用必须在本输入快照内；不在即 invalid，不得自动写入正式报告/知识。

export interface KnowledgeAiInputRequest {
  readonly topicId: string;
  readonly subquestionId?: string;
  readonly mode?: "formal" | "explore";
  readonly selectedRefs?: { kind: "item"; id: string; revision: number }[];
  /** E8：其余模块对象（方案/模板/执行/样品/分析结果/报告块/已采纳对话）也可被 AI 选择器读取。 */
  readonly sourceRefs?: { kind: KnowledgeSourceKind; id: string }[];
  readonly purpose: string;
  readonly model: string;
  readonly promptVersion?: string;
  readonly budgetBytes?: number;
}

export interface KnowledgeAiSourceEntry { readonly kind: KnowledgeSourceKind; readonly id: string; readonly label: string; readonly marker: string; readonly text: string; readonly sourceRef: { kind: string; id: string; version: string; contentHash: string } }

export interface KnowledgeAiInputEntry { readonly ref: { kind: "item"; id: string; revision: number }; readonly text: string; readonly marker: string }

export interface KnowledgeAiInput {
  readonly snapshotHash: string;
  readonly scope: { topicId: string; subquestionId?: string; mode: "formal" | "explore" };
  readonly core: KnowledgeAiInputEntry[];
  readonly sourceEntries: KnowledgeAiSourceEntry[];
  readonly optional: { ref: { kind: "item"; id: string; revision: number }; text: string; reason: string }[];
  readonly actualPayload: string;
  readonly omitted: { ref: string; reason: string }[];
  readonly truncated: { ref: string; reason: string }[];
  readonly requiresShrink: boolean;
  readonly notes: string[];
  readonly counts: { coreItems: number; bytes: number; budgetBytes: number };
  /** T45：同一输入交给外部文件工具时的同源结构（科学字段与内置一致，仅包装不同）。 */
  readonly externalFile: Record<string, unknown>;
}

const AI_BUDGET_DEFAULT = 24000;

/** 从 readKnowledge 产生 AI 输入（核心/可选/省略/超预算），并冻结快照 hash。 */
export function buildKnowledgeAiInput(state: LocusState, req: KnowledgeAiInputRequest): KnowledgeAiInput {
  const mode: "formal" | "explore" = req.mode === "explore" ? "explore" : "formal";
  const topic = state.topics.find((t) => t.id === req.topicId);
  if (!topic) throw new AppError(404, `课题不存在：${req.topicId}`);
  const purpose = (req.purpose ?? "").trim();
  if (!purpose) throw new AppError(422, "请写明用途（purpose）：AI 发送必须说明目的。");
  const view = readKnowledge(state, { source: "current", topicId: req.topicId, mode, subquestionId: req.subquestionId });
  const byId = new Map(view.items.map((e) => [e.id, e]));

  const selected = req.selectedRefs ?? [];
  const core: KnowledgeAiInputEntry[] = [];
  const omitted: { ref: string; reason: string }[] = [];
  for (const r of selected) {
    const key = `item ${r.id} 第 ${r.revision} 版`;
    const fixed = makeKnowledgeRef("item", r.id, r.revision);
    const envNow = state.knowledge.items.find((x) => x.id === r.id);
    if (!envNow) { omitted.push({ ref: key, reason: "知识项不存在" }); continue; }
    if (!((envNow.payload as ItemPayload).topicIds ?? []).includes(req.topicId)) { omitted.push({ ref: key, reason: "不属于本课题（跨课题引用）" }); continue; }
    const payload = readKnowledgeVersion(state.knowledge, fixed) as ItemPayload | null;
    if (!payload) { omitted.push({ ref: key, reason: "该固定版本不可读（不退回最新版）" }); continue; }
    const pinnedStatus = payload.review.status;
    const liveStatus = (envNow.payload as ItemPayload).review.status;
    if (mode === "formal") {
      const gate = knowledgeItemGate(state, fixed);
      if (!gate.ok) { omitted.push({ ref: key, reason: `未过正式门槛（${gate.reason}${gate.reason === "pinned_not_confirmed" ? `：被引用版本为「${gate.pinnedStatus}」` : ""}）；待审内容请改用探索模式` }); continue; }
    } else if (liveStatus === "withdrawn" || liveStatus === "excluded") {
      omitted.push({ ref: key, reason: `探索模式也不得包含当前「${liveStatus}」的项` }); continue;
    }
    if (!byId.has(r.id)) {
      // 视图内不存在但固定版可读：explore 下待审项本就在视图内；此处仅当视图过滤（如主题筛选）时发生
      omitted.push({ ref: key, reason: "不在当前视图范围（如主题/条件筛选或已加载页外）" });
      continue;
    }
    // 闭包：无来源项按其稳定 ID 判策略；派生项展开到上游（含报告块固定引用）
    const readOk = knowledgeAccess(state, "localRead", [fixed]);
    if (!readOk.ok) { omitted.push({ ref: key, reason: `未获本地读取许可：${readOk.denied[0]?.reason ?? ""}` }); continue; }
    const sendOk = knowledgeAccess(state, "aiSend", [fixed]);
    if (!sendOk.ok) { omitted.push({ ref: key, reason: `未获发送 AI 许可：${sendOk.denied[0]?.reason ?? ""}（AI 发送须逐来源显式授权）` }); continue; }
    try { assertFixedRefsIntact(state, (payload.sourceRefs ?? [])); } catch (e) { omitted.push({ ref: key, reason: `固定引用不可用：${(e as Error).message.slice(0, 90)}` }); continue; }
    core.push({
      ref: fixed, text: describeItem(state, payload, r.revision),
      marker: mode === "explore" && pinnedStatus !== "confirmed" ? `[待审·${pinnedStatus}]` : "",
    });
  }
  // 可选预览：视图内其余项（视图在 formal 下已只含正式项；explore 下含待审）
  const coreIds = new Set(core.map((c) => c.ref.id));
  const optional = view.items.filter((e) => !coreIds.has(e.id)).map((e) => {
    const p = e.payload as { review: { status: string } };
    return { ref: makeKnowledgeRef("item", e.id, e.revision), text: describeItem(state, e.payload as never, e.revision).slice(0, 200), reason: mode === "formal" ? "未选中；选中后经门槛复核才进入核心" : `未选中（当前审核：${p.review.status}）` };
  });

  // E8：其余模块对象（逐条过：存在 → 归属本课题 → 可用 → 权限 → 报告引用可解析）
  const sourceEntries: KnowledgeAiSourceEntry[] = [];
  for (const sr of req.sourceRefs ?? []) {
    const key = `${sr.kind} ${sr.id}`;
    const adapter = (() => { try { return knowledgeSourceAdapter(state, sr.kind, sr.id); } catch { return null; } })();
    if (!adapter) { omitted.push({ ref: key, reason: "对象不存在" }); continue; }
    if (!adapter.topicIds.includes(req.topicId)) { omitted.push({ ref: key, reason: `不属于本课题（归属：${adapter.topicIds.join("、") || "无法验证"}）——跨课题不得混入` }); continue; }
    if (!adapter.usable) { omitted.push({ ref: key, reason: `不可用：${adapter.usableNote}` }); continue; }
    // 权限：读 + 发送 两道都要过（默认策略下 aiSend 为否，须用户显式授权）
    const read = knowledgeAccess(state, "localRead", [adapter.sourceRef]);
    if (!read.ok) { omitted.push({ ref: key, reason: `未获本地读取许可：${read.denied[0]?.reason ?? ""}` }); continue; }
    const send = knowledgeAccess(state, "aiSend", [adapter.sourceRef]);
    if (!send.ok) { omitted.push({ ref: key, reason: `未获发送 AI 许可：${send.denied[0]?.reason ?? ""}` }); continue; }
    void accessClosure;
    // 报告块等：当时引用的版本必须能在本库解析（历史不存在即不放行）
    if (adapter.kind === "report_block" && adapter.pinnedRefs.length) {
      const res = resolvePinnedRefs(state, adapter.pinnedRefs);
      const bad = res.filter((x) => x.status !== "ok");
      if (bad.length) { omitted.push({ ref: key, reason: `${bad.length} 个引用版本不可解析（${bad[0].reason}）——不放行` }); continue; }
    }
    const frag = knowledgeSourceFragment(state, sr.kind, sr.id);
    sourceEntries.push({ kind: sr.kind, id: sr.id, label: frag.label, marker: `[${frag.label}]`, text: frag.excerpt, sourceRef: frag.sourceRef });
  }

  const header = [`研究目的：${purpose}`, `视角：${mode === "formal" ? "正式（只用已确认）" : "探索（含待审，带标记）"}`, `课题：${topic.name}`].join("\n");
  const body = core.map((c) => `${c.marker ? `${c.marker} ` : ""}【${c.ref.id} 第 ${c.ref.revision} 版】\n${c.text}`).join("\n\n");
  const srcBody = sourceEntries.map((x) => `${x.marker}【${x.kind} ${x.id} ${x.sourceRef.version}】\n${x.text}`).join("\n\n");
  const actualPayload = `${header}\n\n核心（${core.length} 项）：\n${body}${sourceEntries.length ? `\n\n外部对象（${sourceEntries.length} 项）：\n${srcBody}` : ""}`;
  const bytes = Buffer.byteLength(actualPayload, "utf8");
  const budgetBytes = req.budgetBytes ?? AI_BUDGET_DEFAULT;
  const requiresShrink = bytes > budgetBytes;
  const truncated: { ref: string; reason: string }[] = [];
  const notes: string[] = [];
  if (requiresShrink) notes.push(`输入约 ${bytes} 字节，超过预算 ${budgetBytes} 字节：请缩小选择范围或分页重发；**未做静默截断**。`);
  if (mode === "explore") notes.push("探索模式：待审内容已标注，不得进入正式推荐/报告。");
  if (omitted.length) notes.push(`${omitted.length} 项被省略（见 omitted），未混入 payload。`);

  const snapshotHash = canonicalHash({
    scope: { topicId: req.topicId, subquestionId: req.subquestionId ?? null, mode },
    refs: core.map((c) => `${c.ref.id}@${c.ref.revision}`),
    sourceRefs: sourceEntries.map((x) => `${x.kind}:${x.id}@${x.sourceRef.version}`),
    payload: actualPayload,
    promptVersion: req.promptVersion ?? "knowledge_input/v1",
  });
  const externalFile = {
    wrapper: "locus-knowledge-input/v1 (standalone-json)",
    purpose, mode, topic: { id: req.topicId, name: topic.name }, subquestionId: req.subquestionId ?? null,
    items: core.map((c) => ({ ref: { kind: "item", id: c.ref.id, revision: c.ref.revision }, payload: (byId.get(c.ref.id)!.payload) })),
    sources: sourceEntries.map((x) => ({ ref: x.sourceRef, payload: { kind: x.kind, id: x.id, text: x.text } })),
    snapshotHash, notes,
  };
  return {
    snapshotHash,
    scope: { topicId: req.topicId, ...(req.subquestionId ? { subquestionId: req.subquestionId } : {}), mode },
    core, sourceEntries, optional, actualPayload, omitted, truncated, requiresShrink, notes,
    counts: { coreItems: core.length, bytes, budgetBytes }, externalFile,
  };
}

export interface AiReferenceCheck { readonly ref: string; readonly status: "valid" | "invalid"; readonly reason: string }

/** T43：模型返回的引用必须落在本次输入快照内；不在即 invalid（不得自动写入正式报告/知识）。 */
export function validateAiReferences(input: KnowledgeAiInput, refs: unknown[]): AiReferenceCheck[] {
  const allowed = new Set(input.core.map((c) => `${c.ref.id}@${c.ref.revision}`));
  const allowedSources = new Set(input.sourceEntries.map((x) => `${x.kind}:${x.id}@${x.sourceRef.version}`));
  const knownSourceIds = new Map(input.sourceEntries.map((x) => [`${x.kind}:${x.id}`, x.sourceRef.version]));
  return (Array.isArray(refs) ? refs : []).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : typeof o.localId === "string" ? o.localId : "";
    const kind = typeof o.kind === "string" ? o.kind : "item";
    const version = typeof o.version === "string" ? o.version : null;
    const revision = typeof o.revision === "number" ? o.revision : null;
    if (!id) return { ref: "(缺 id)", status: "invalid" as const, reason: "引用缺 id" };
    // 外部对象（E8 各类型）：必须给 kind+version 且落在本次输入快照内
    if (kind !== "item") {
      if (!version) {
        const expected = knownSourceIds.get(`${kind}:${id}`);
        return expected
          ? { ref: `${kind}:${id}（未给版本）`, status: "invalid" as const, reason: "必须给出固定版本（不允许 latest 兜底）" }
          : { ref: `${kind}:${id}`, status: "invalid" as const, reason: "not_in_snapshot" };
      }
      const key = `${kind}:${id}@${version}`;
      return allowedSources.has(key)
        ? { ref: key, status: "valid" as const, reason: "在本输入快照内（外部对象）" }
        : { ref: key, status: "invalid" as const, reason: "not_in_snapshot（不存在或不属本次输入）" };
    }
    if (revision === null) {
      const ok = input.core.some((c) => c.ref.id === id);
      return ok ? { ref: `${id}（未给版本）`, status: "invalid" as const, reason: "必须给出固定版本（不允许 latest 兜底）" } : { ref: id, status: "invalid" as const, reason: "not_in_snapshot" };
    }
    const key = `${id}@${revision}`;
    return allowed.has(key)
      ? { ref: key, status: "valid" as const, reason: "在本输入快照内" }
      : { ref: key, status: "invalid" as const, reason: "not_in_snapshot（不存在或不属本次输入）" };
  });
}

/** 人工采纳：AI 产出只能落为**待审**候选（statement），引用须全部有效；不自动转 confirmed 科学结论。 */
export function adoptAiProposal(
  state: LocusState,
  input: { topicId: string; aiInput: KnowledgeAiInput; text: string; nature: "observation" | "hypothesis" | "interpretation" | "to_verify" | "human_judgment"; evidenceRefs?: unknown[]; scopeText?: string },
): { state: LocusState; itemId: string; review: string } {
  const checks = validateAiReferences(input.aiInput, [
    ...input.aiInput.core.map((c) => ({ kind: "item", id: c.ref.id, revision: c.ref.revision })),
    ...(input.evidenceRefs ?? []),
  ]);
  const invalid = checks.filter((c) => c.status === "invalid");
  if (invalid.length) throw new AppError(422, `采纳被拒：${invalid.length} 个引用不属本次输入快照（${invalid.map((i) => i.ref).join("、")}）；不得自动写入正式报告/知识。`, { code: "ai_reference_invalid", invalid });
  const st = createKnowledgeStatement(state, {
    topicId: input.topicId, text: input.text, nature: input.nature, createdBy: "model",
    ...(input.scopeText ? { scopeText: input.scopeText } : {}),
  });
  if (st.item.payload.review.status !== "pending") throw new AppError(500, "内部错误：AI 采纳必须落为待审。");
  return { state: st.state, itemId: st.item.id, review: st.item.payload.review.status };
}

/** 手动下载「选定范围」知识包（E5 冻结 + 导出复用；不新建导出实现）。 */
export function exportSelectedPackage(state: LocusState, input: { topicId: string; selectedRefs: { kind: "item"; id: string; revision: number }[]; mode?: "formal" | "explore"; purpose?: string }): { filename: string; buffer: Buffer } {
  const frozen = freezeKnowledge(state, { topicId: input.topicId, viewId: currentViewId(state, input.topicId), selectedRefs: input.selectedRefs, mode: input.mode ?? "formal" });
  // §7.5：导出是独立许可——按快照**依赖闭包**检查（含无来源知识项自身的 item 策略）
  assertKnowledgeAccess(state, "export", snapshotAccessRefs(frozen.snapshot));
  const out = exportKnowledge(frozen.snapshot, { format: "zip" });
  return { filename: out.filename, buffer: out.data as Buffer };
}
