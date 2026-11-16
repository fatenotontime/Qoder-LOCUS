/**
 * 4C 用例层：方案固定版本 / 记录模板 / 执行（暂停恢复）/ 样品 / 测量 / 影响分析 / OCR。
 * 契约：方案整版快照追加、引用固定 revision；记录层原位编辑留历史不改源方案；
 * 确定性时间传播独立于 AI 语义评估；失败/未配置 ≠ 无影响；新改动使旧分析 stale。
 */
import { randomUUID } from "node:crypto";
import type {
  LocusState, ProtocolRecord, ProtocolStep, ProtocolRevisionSnapshot, RecordTemplateRecord,
  ExecutionRecord, ExecEvent, SampleRecord, SampleStateEntry, MeasurementRecord,
  ImpactRecord, ImpactItem, OcrRecord, RevisionEntry, AssetRecord,
} from "../store.ts";
import { contentHash } from "../store.ts";
import { AppError, MAX_IMPORT_BYTES } from "./app.ts";
import { AiError, runTask, getAiConfig, type AiConfig } from "./ai.ts";
import { transition, displayAssessment, type ImpactState } from "../domain/impact.ts";

const now = () => new Date().toISOString();
const str = (v: unknown): string => String(v ?? "").trim();

function requireTopic(state: LocusState, topicId: string): void {
  if (!state.topics.some((t) => t.id === topicId)) throw new AppError(404, `课题不存在：${topicId}`);
}

// ── 方案（EXP01/EXP02：固定版本，整版快照，追加式）──────────

export interface ProtocolInput {
  topicId: string;
  name: string;
  sourceKind?: "user" | "reconstructed" | "ai-draft";
  sourceAssetId?: string;
  purpose?: string;
  inputs?: string[];
  steps: ProtocolStep[];
  conditions?: string[];
  criteria?: string;
  unknowns?: string[];
  sourceFragments?: string[];
}

function cleanSteps(steps: unknown): ProtocolStep[] {
  if (!Array.isArray(steps)) throw new AppError(422, "steps 必须是数组。");
  return steps.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const op = str(o.op);
    if (!op) throw new AppError(422, `第 ${i + 1} 步操作不能为空。`);
    const d = o.durationMin;
    const durationMin = d === null || d === undefined || d === "" ? null : Number(d);
    if (durationMin !== null && (!Number.isFinite(durationMin) || durationMin < 0)) {
      throw new AppError(422, `第 ${i + 1} 步时长须为非负数或留空（未知）。`);
    }
    const params: Record<string, string> = {};
    if (o.params && typeof o.params === "object") {
      for (const [k, v] of Object.entries(o.params as Record<string, unknown>)) params[str(k)] = str(v);
    }
    return {
      id: str(o.id) || `step_${randomUUID()}`,
      op,
      params,
      note: str(o.note),
      durationMin,
      estimated: o.estimated === true,
      branch: str(o.branch) || null,
      observeEnd: str(o.observeEnd),
    };
  });
}

function snapshot(input: ProtocolInput, revision: number, reason: string): ProtocolRevisionSnapshot {
  return {
    revision,
    at: now(),
    reason,
    purpose: str(input.purpose),
    inputs: (input.inputs ?? []).map(str).filter(Boolean),
    steps: cleanSteps(input.steps),
    conditions: (input.conditions ?? []).map(str).filter(Boolean),
    criteria: str(input.criteria),
    unknowns: (input.unknowns ?? []).map(str).filter(Boolean),
    sourceFragments: (input.sourceFragments ?? []).map(str).filter(Boolean),
  };
}

export function createProtocol(state: LocusState, input: ProtocolInput): { state: LocusState; protocol: ProtocolRecord } {
  requireTopic(state, input.topicId);
  const name = str(input.name);
  if (!name) throw new AppError(422, "方案名称不能为空。");
  const sourceKind = input.sourceKind ?? "user";
  // 方法来源重构/AI 草稿必须标明出处（原件或原文片段），不冒充用户原创。
  if (sourceKind !== "user" && !input.sourceAssetId && (input.sourceFragments ?? []).length === 0) {
    throw new AppError(422, "重构/AI 草稿方案须标明方法来源（sourceAssetId 或 sourceFragments）。");
  }
  if (input.sourceAssetId && !state.assets.some((a) => a.id === input.sourceAssetId)) {
    throw new AppError(404, `来源原件不存在：${input.sourceAssetId}`);
  }
  const snap = snapshot(input, 1, "创建");
  if (snap.steps.length === 0) throw new AppError(422, "方案至少需要一个步骤。");
  const protocol: ProtocolRecord = {
    id: `proto_${randomUUID()}`,
    topicId: input.topicId,
    name,
    sourceKind,
    sourceAssetId: input.sourceAssetId || undefined,
    revision: 1,
    revisions: [snap],
    createdAt: now(),
    updatedAt: now(),
  };
  return { state: { ...state, protocols: [...state.protocols, protocol] }, protocol };
}

export interface ProtocolPatch {
  name?: string;
  purpose?: string;
  inputs?: string[];
  steps?: ProtocolStep[];
  conditions?: string[];
  criteria?: string;
  unknowns?: string[];
  sourceFragments?: string[];
  reason: string;
}

/** 编辑方案 → 追加新整版快照；旧 revision 不动（已固定的引用不受影响）。 */
export function editProtocol(state: LocusState, id: string, patch: ProtocolPatch): { state: LocusState; protocol: ProtocolRecord } {
  const cur = state.protocols.find((p) => p.id === id);
  if (!cur) throw new AppError(404, `方案不存在：${id}`);
  const reason = str(patch.reason);
  if (!reason) throw new AppError(422, "修改方案必须填写原因。");
  const prev = cur.revisions[cur.revisions.length - 1];
  const nextInput: ProtocolInput = {
    topicId: cur.topicId,
    name: patch.name !== undefined ? str(patch.name) : cur.name,
    purpose: patch.purpose !== undefined ? patch.purpose : prev.purpose,
    inputs: patch.inputs ?? prev.inputs,
    steps: patch.steps ?? prev.steps,
    conditions: patch.conditions ?? prev.conditions,
    criteria: patch.criteria !== undefined ? patch.criteria : prev.criteria,
    unknowns: patch.unknowns ?? prev.unknowns,
    sourceFragments: patch.sourceFragments ?? prev.sourceFragments,
  };
  if (!nextInput.name) throw new AppError(422, "方案名称不能为空。");
  const snap = snapshot(nextInput, cur.revision + 1, reason);
  if (snap.steps.length === 0) throw new AppError(422, "方案至少需要一个步骤。");
  const protocol: ProtocolRecord = {
    ...cur,
    name: nextInput.name,
    revision: cur.revision + 1,
    revisions: [...cur.revisions, snap],
    updatedAt: now(),
  };
  let next: LocusState = { ...state, protocols: state.protocols.map((p) => (p.id === id ? protocol : p)) };
  next = registerImpact(next, {
    topicId: cur.topicId,
    change: { entityKind: "protocol", entityId: id, revision: protocol.revision, summary: `方案修订 r${protocol.revision}：${reason}` },
    prevSteps: prev.steps,
    nextSteps: snap.steps,
    aiConfigured: getAiConfig() !== null,
  }).state;
  return { state: next, protocol };
}

/** 方案解析 AI 结果 → 草稿步骤（结构化 steps 优先，时长入 durationMin；旧 operations 字符串兜底；未知时长留空，不补造）。 */
export function protocolDraftFromAi(value: unknown, sourceAssetId: string): { steps: ProtocolStep[]; purpose: string; inputs: string[]; conditions: string[]; criteria: string; unknowns: string[]; sourceAssetId: string } {
  const obj = (value ?? {}) as { protocol?: Record<string, unknown> };
  const p = obj.protocol;
  if (!p || (!Array.isArray(p.steps) && !Array.isArray(p.operations))) throw new AiError("方案解析结果结构不符：缺少 protocol.steps。");
  const rawSteps = Array.isArray(p.steps) && p.steps.length > 0
    ? (p.steps as unknown[])
    : (p.operations as unknown[]).map((op) => ({ op: str(op) }));
  const steps = cleanSteps(rawSteps);
  if (steps.length === 0) throw new AiError("方案解析结果为空。");
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  return {
    steps,
    purpose: str(p.purpose),
    inputs: arr(p.inputs),
    conditions: arr(p.conditions),
    criteria: str(p.criteria),
    unknowns: arr(p.unknowns),
    sourceAssetId,
  };
}

// ── 记录模板（EXP03：固定方案 revision；AI 草稿须人工确认后复用）──

export function createTemplate(
  state: LocusState,
  input: { protocolId: string; protocolRevision?: number; fields?: string[]; aiDraft?: boolean },
): { state: LocusState; template: RecordTemplateRecord } {
  const proto = state.protocols.find((p) => p.id === input.protocolId);
  if (!proto) throw new AppError(404, `方案不存在：${input.protocolId}`);
  const rev = input.protocolRevision ?? proto.revision;
  if (!proto.revisions.some((r) => r.revision === rev)) throw new AppError(422, `方案 revision 不存在：r${rev}`);
  const snap = proto.revisions.find((r) => r.revision === rev)!;
  const fields = (input.fields ?? []).map(str).filter(Boolean);
  const template: RecordTemplateRecord = {
    id: `tmpl_${randomUUID()}`,
    protocolId: proto.id,
    protocolRevision: rev,
    fields: fields.length > 0 ? fields : [...snap.steps.map((s) => s.op), "实际用量", "实际时长", "偏差说明"],
    aiDraft: input.aiDraft === true,
    humanConfirmed: false,
    revision: 1,
    history: [],
    createdAt: now(),
  };
  return { state: { ...state, templates: [...state.templates, template] }, template };
}

export function confirmTemplate(state: LocusState, id: string, fields?: string[]): { state: LocusState; template: RecordTemplateRecord } {
  const cur = state.templates.find((t) => t.id === id);
  if (!cur) throw new AppError(404, `模板不存在：${id}`);
  const history: RevisionEntry[] = [...cur.history];
  let nextFields = cur.fields;
  if (fields) {
    const f = fields.map(str).filter(Boolean);
    if (f.length === 0) throw new AppError(422, "模板字段不能为空。");
    history.push({ revision: cur.revision + 1, at: now(), field: "fields", before: cur.fields.join("、"), after: f.join("、"), reason: "人工确认时调整" });
    nextFields = f;
  }
  history.push({ revision: cur.revision + 1, at: now(), field: "humanConfirmed", before: String(cur.humanConfirmed), after: "true", reason: "人工确认" });
  const template: RecordTemplateRecord = { ...cur, fields: nextFields, humanConfirmed: true, confirmedAt: now(), revision: cur.revision + 1, history };
  return { state: { ...state, templates: state.templates.map((t) => (t.id === id ? template : t)) }, template };
}

/** 模板复用前检查：方案是否已变（变了须比较，不静默沿用）。 */
export function templateProtocolCheck(state: LocusState, templateId: string): { changed: boolean; pinnedRevision: number; currentRevision: number } {
  const t = state.templates.find((x) => x.id === templateId);
  if (!t) throw new AppError(404, `模板不存在：${templateId}`);
  const p = state.protocols.find((x) => x.id === t.protocolId);
  if (!p) throw new AppError(404, `方案不存在：${t.protocolId}`);
  return { changed: t.protocolRevision !== p.revision, pinnedRevision: t.protocolRevision, currentRevision: p.revision };
}

// ── 执行（EXP04/EXP05：实际层不改源方案；暂停/恢复人决定）────

export function startExecution(
  state: LocusState,
  input: { topicId: string; protocolId: string; protocolRevision?: number; templateId?: string },
): { state: LocusState; execution: ExecutionRecord } {
  requireTopic(state, input.topicId);
  const proto = state.protocols.find((p) => p.id === input.protocolId);
  if (!proto) throw new AppError(404, `方案不存在：${input.protocolId}`);
  if (proto.topicId !== input.topicId) throw new AppError(422, "方案不属于该课题。");
  const rev = input.protocolRevision ?? proto.revision;
  if (!proto.revisions.some((r) => r.revision === rev)) throw new AppError(422, `方案 revision 不存在：r${rev}`);
  if (input.templateId) {
    const t = state.templates.find((x) => x.id === input.templateId);
    if (!t) throw new AppError(404, `模板不存在：${input.templateId}`);
    if (t.protocolId !== proto.id) throw new AppError(422, "模板不属于该方案。");
    if (!t.humanConfirmed) throw new AppError(422, "AI 草稿模板须人工确认后才能用于执行（EXP03）。");
  }
  const start: ExecEvent = {
    id: `ev_${randomUUID()}`, at: now(), recordedAt: now(), backfilled: false,
    kind: "start", text: `按方案 r${rev} 开始执行`, actual: {}, revision: 1, history: [],
  };
  const execution: ExecutionRecord = {
    id: `exec_${randomUUID()}`,
    topicId: input.topicId,
    protocolId: proto.id,
    protocolRevision: rev,
    templateId: input.templateId || undefined,
    status: "active",
    events: [start],
    createdAt: now(),
    updatedAt: now(),
  };
  return { state: { ...state, executions: [...state.executions, execution] }, execution };
}

export interface EventInput {
  kind: ExecEvent["kind"];
  stepId?: string;
  text?: string;
  actual?: { amount?: string; durationMin?: number; order?: number };
  at?: string;
  backfilled?: boolean;
}

export function appendEvent(state: LocusState, execId: string, input: EventInput): { state: LocusState; execution: ExecutionRecord } {
  const cur = state.executions.find((e) => e.id === execId);
  if (!cur) throw new AppError(404, `执行不存在：${execId}`);
  if (cur.status === "done") throw new AppError(422, "执行已结束，不能再追加事件。");
  const text = str(input.text);
  if ((input.kind === "note" || input.kind === "deviation") && !text) throw new AppError(422, "备注/偏差必须写明内容。");
  if (input.kind === "step") {
    const proto = state.protocols.find((p) => p.id === cur.protocolId)!;
    const snap = proto.revisions.find((r) => r.revision === cur.protocolRevision)!;
    if (!input.stepId || !snap.steps.some((s) => s.id === input.stepId)) throw new AppError(422, "步骤事件须引用固定方案 revision 中存在的步骤。");
  }
  const actual: ExecEvent["actual"] = {};
  if (input.actual?.amount !== undefined) actual.amount = str(input.actual.amount);
  if (input.actual?.durationMin !== undefined) {
    const d = Number(input.actual.durationMin);
    if (!Number.isFinite(d) || d < 0) throw new AppError(422, "实际时长须为非负数。");
    actual.durationMin = d;
  }
  if (input.actual?.order !== undefined) actual.order = Number(input.actual.order);
  const event: ExecEvent = {
    id: `ev_${randomUUID()}`,
    at: str(input.at) || now(),
    recordedAt: now(),
    backfilled: input.backfilled === true,
    kind: input.kind,
    stepId: input.stepId || undefined,
    text,
    actual,
    revision: 1,
    history: [],
  };
  const execution: ExecutionRecord = { ...cur, events: [...cur.events, event], updatedAt: now() };
  return { state: { ...state, executions: state.executions.map((e) => (e.id === execId ? execution : e)) }, execution };
}

/** 记录层原位编辑：留历史；改实际数值须原因；不触碰源方案。 */
export function editEvent(
  state: LocusState,
  execId: string,
  eventId: string,
  patch: { text?: string; actual?: ExecEvent["actual"]; reason?: string },
): { state: LocusState; execution: ExecutionRecord } {
  const cur = state.executions.find((e) => e.id === execId);
  if (!cur) throw new AppError(404, `执行不存在：${execId}`);
  const ev = cur.events.find((e) => e.id === eventId);
  if (!ev) throw new AppError(404, `事件不存在：${eventId}`);
  const reason = str(patch.reason);
  const history: RevisionEntry[] = [...ev.history];
  const rev = ev.revision + 1;
  let text = ev.text;
  let actual = ev.actual;
  if (patch.text !== undefined && str(patch.text) !== ev.text) {
    if (!reason) throw new AppError(422, "修改记录必须填写原因。");
    history.push({ revision: rev, at: now(), field: "text", before: ev.text, after: str(patch.text), reason });
    text = str(patch.text);
  }
  if (patch.actual) {
    const next = { ...ev.actual, ...patch.actual };
    const changed = (Object.keys(next) as (keyof ExecEvent["actual"])[]).some((k) => next[k] !== ev.actual[k]);
    if (changed) {
      if (!reason) throw new AppError(422, "修改实际数值必须填写原因。");
      history.push({ revision: rev, at: now(), field: "actual", before: JSON.stringify(ev.actual), after: JSON.stringify(next), reason });
      actual = next;
    }
  }
  const nextEv: ExecEvent = { ...ev, text, actual, revision: history.length > ev.history.length ? rev : ev.revision, history };
  const execution: ExecutionRecord = { ...cur, events: cur.events.map((e) => (e.id === eventId ? nextEv : e)), updatedAt: now() };
  let next: LocusState = { ...state, executions: state.executions.map((e) => (e.id === execId ? execution : e)) };
  if (history.length > ev.history.length) {
    next = registerImpact(next, {
      topicId: cur.topicId,
      change: { entityKind: "execution", entityId: execId, revision: nextEv.revision, summary: `执行记录修订：${reason}` },
      aiConfigured: getAiConfig() !== null,
    }).state;
  }
  return { state: next, execution };
}

export function pauseExecution(
  state: LocusState,
  execId: string,
  input: { reason: string; risks?: string[]; resumeChecks?: string[]; aiSuggested?: boolean },
): { state: LocusState; execution: ExecutionRecord } {
  const cur = state.executions.find((e) => e.id === execId);
  if (!cur) throw new AppError(404, `执行不存在：${execId}`);
  if (cur.status !== "active") throw new AppError(422, "只有进行中的执行可以暂停。");
  const reason = str(input.reason);
  if (!reason) throw new AppError(422, "暂停必须填写原因。");
  const pauseEv: ExecEvent = {
    id: `ev_${randomUUID()}`, at: now(), recordedAt: now(), backfilled: false,
    kind: "pause", text: reason, actual: {}, revision: 1, history: [],
  };
  const execution: ExecutionRecord = {
    ...cur,
    status: "paused",
    events: [...cur.events, pauseEv],
    pausedState: {
      at: now(),
      reason,
      risks: (input.risks ?? []).map(str).filter(Boolean),
      resumeChecks: (input.resumeChecks ?? []).map(str).filter(Boolean),
      aiSuggested: input.aiSuggested === true,
    },
    updatedAt: now(),
  };
  return { state: { ...state, executions: state.executions.map((e) => (e.id === execId ? execution : e)) }, execution };
}

export function resumeExecution(state: LocusState, execId: string, humanDecision: string): { state: LocusState; execution: ExecutionRecord } {
  const cur = state.executions.find((e) => e.id === execId);
  if (!cur) throw new AppError(404, `执行不存在：${execId}`);
  if (cur.status !== "paused") throw new AppError(422, "只有暂停中的执行可以恢复。");
  const decision = str(humanDecision);
  if (!decision) throw new AppError(422, "恢复须由人做出决定并记录（AI 只建议，不代决定）。");
  const resumeEv: ExecEvent = {
    id: `ev_${randomUUID()}`, at: now(), recordedAt: now(), backfilled: false,
    kind: "resume", text: decision, actual: {}, revision: 1, history: [],
  };
  const execution: ExecutionRecord = {
    ...cur,
    status: "active",
    events: [...cur.events, resumeEv],
    pausedState: cur.pausedState ? { ...cur.pausedState, humanDecision: decision } : undefined,
    updatedAt: now(),
  };
  return { state: { ...state, executions: state.executions.map((e) => (e.id === execId ? execution : e)) }, execution };
}

export function completeExecution(state: LocusState, execId: string): { state: LocusState; execution: ExecutionRecord } {
  const cur = state.executions.find((e) => e.id === execId);
  if (!cur) throw new AppError(404, `执行不存在：${execId}`);
  const execution: ExecutionRecord = { ...cur, status: "done", updatedAt: now() };
  return { state: { ...state, executions: state.executions.map((e) => (e.id === execId ? execution : e)) }, execution };
}

/** 暂停辅助 AI：只返回建议（risks/resumeChecks），是否采纳由人决定。 */
export async function pauseAssist(cfg: AiConfig, state: LocusState, execId: string): Promise<{ risks: string[]; resumeChecks: string[]; unknowns: string[]; raw: string; model: string }> {
  const exec = state.executions.find((e) => e.id === execId);
  if (!exec) throw new AppError(404, `执行不存在：${execId}`);
  const proto = state.protocols.find((p) => p.id === exec.protocolId)!;
  const snap = proto.revisions.find((r) => r.revision === exec.protocolRevision)!;
  const context = JSON.stringify({ protocol: snap, events: exec.events, pausedState: exec.pausedState ?? null }).slice(0, 6000);
  const { value, raw } = await runTask(cfg, "pause_assist", context);
  const obj = (value ?? {}) as { risks?: unknown; resumeChecks?: unknown; unknowns?: unknown };
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  return { risks: arr(obj.risks), resumeChecks: arr(obj.resumeChecks), unknowns: arr(obj.unknowns), raw, model: cfg.model };
}

// ── 样品 / 分样 / 测量（TOP04/TOP05）─────────────────────────

export function createSample(
  state: LocusState,
  input: { topicId: string; executionId?: string; shortName: string; displayName?: string; origin?: "user" | "public"; amount: { value: string; unit: string; estimated?: boolean }; handling?: string; use?: string; note?: string },
): { state: LocusState; sample: SampleRecord } {
  requireTopic(state, input.topicId);
  const shortName = str(input.shortName);
  if (!shortName) throw new AppError(422, "样品短号不能为空。");
  if (state.samples.some((s) => s.topicId === input.topicId && s.shortName === shortName)) {
    throw new AppError(409, `同课题下短号已存在：${shortName}（短号须唯一，避免引用歧义）。`);
  }
  if (input.executionId && !state.executions.some((e) => e.id === input.executionId)) throw new AppError(404, `执行不存在：${input.executionId}`);
  const value = str(input.amount?.value);
  if (!value) throw new AppError(422, "样品用量不能为空（可标估计）。");
  const sample: SampleRecord = {
    id: `smp_${randomUUID()}`,
    topicId: input.topicId,
    executionId: input.executionId || undefined,
    shortName,
    displayName: str(input.displayName) || shortName,
    origin: input.origin === "public" ? "public" : "user",
    states: [{
      revision: 1, at: now(),
      amount: { value, unit: str(input.amount?.unit), estimated: input.amount?.estimated === true },
      handling: str(input.handling), use: str(input.use), note: str(input.note),
    }],
    createdAt: now(),
  };
  return { state: { ...state, samples: [...state.samples, sample] }, sample };
}

export function addSampleState(
  state: LocusState,
  sampleId: string,
  input: { amount: { value: string; unit: string; estimated?: boolean }; handling?: string; use?: string; note?: string },
): { state: LocusState; sample: SampleRecord } {
  const cur = state.samples.find((s) => s.id === sampleId);
  if (!cur) throw new AppError(404, `样品不存在：${sampleId}`);
  const value = str(input.amount?.value);
  if (!value) throw new AppError(422, "样品用量不能为空（可标估计）。");
  const entry: SampleStateEntry = {
    revision: cur.states.length + 1, at: now(),
    amount: { value, unit: str(input.amount?.unit), estimated: input.amount?.estimated === true },
    handling: str(input.handling), use: str(input.use), note: str(input.note),
  };
  const sample: SampleRecord = { ...cur, states: [...cur.states, entry] };
  let next: LocusState = { ...state, samples: state.samples.map((s) => (s.id === sampleId ? sample : s)) };
  next = registerImpact(next, {
    topicId: cur.topicId,
    change: { entityKind: "sample", entityId: sampleId, revision: entry.revision, summary: `样品 ${cur.shortName} 状态更新（分样/处理/用途）` },
    aiConfigured: getAiConfig() !== null,
  }).state;
  return { state: next, sample };
}

/** 改名只动显示名；短号与 id 不变，引用不破。 */
export function renameSample(state: LocusState, sampleId: string, displayName: string): { state: LocusState; sample: SampleRecord } {
  const cur = state.samples.find((s) => s.id === sampleId);
  if (!cur) throw new AppError(404, `样品不存在：${sampleId}`);
  const name = str(displayName);
  if (!name) throw new AppError(422, "显示名不能为空。");
  const sample: SampleRecord = { ...cur, displayName: name };
  return { state: { ...state, samples: state.samples.map((s) => (s.id === sampleId ? sample : s)) }, sample };
}

export function addMeasurement(
  state: LocusState,
  input: { topicId: string; sampleId: string; sampleStateRevision?: number; time?: string; method?: string; instrument?: string; value: string; unit?: string; cellRef?: { tableId: string; row: number; col: number }; note?: string },
): { state: LocusState; measurement: MeasurementRecord } {
  requireTopic(state, input.topicId);
  const sample = state.samples.find((s) => s.id === input.sampleId);
  if (!sample) throw new AppError(404, `样品不存在：${input.sampleId}`);
  if (sample.topicId !== input.topicId) throw new AppError(422, "样品不属于该课题。");
  const rev = input.sampleStateRevision ?? sample.states.length;
  if (!sample.states.some((s) => s.revision === rev)) throw new AppError(422, `样品状态 revision 不存在：r${rev}`);
  const value = str(input.value);
  if (!value) throw new AppError(422, "测量值不能为空。");
  if (input.cellRef && !state.tables.some((t) => t.id === input.cellRef!.tableId)) throw new AppError(404, `回链表格不存在：${input.cellRef.tableId}`);
  const measurement: MeasurementRecord = {
    id: `meas_${randomUUID()}`,
    topicId: input.topicId,
    sampleId: sample.id,
    sampleStateRevision: rev,
    time: str(input.time) || now(),
    method: str(input.method),
    instrument: str(input.instrument),
    value,
    unit: str(input.unit),
    cellRef: input.cellRef,
    note: str(input.note),
    revision: 1,
    history: [],
    createdAt: now(),
  };
  return { state: { ...state, measurements: [...state.measurements, measurement] }, measurement };
}

export function editMeasurement(
  state: LocusState,
  id: string,
  patch: { value?: string; unit?: string; method?: string; instrument?: string; note?: string; reason?: string },
): { state: LocusState; measurement: MeasurementRecord } {
  const cur = state.measurements.find((m) => m.id === id);
  if (!cur) throw new AppError(404, `测量不存在：${id}`);
  const reason = str(patch.reason);
  const history: RevisionEntry[] = [...cur.history];
  const rev = cur.revision + 1;
  const fields: (keyof MeasurementRecord)[] = ["value", "unit", "method", "instrument", "note"];
  const next: Record<string, unknown> = { ...cur };
  let changed = false;
  for (const f of fields) {
    const v = patch[f as keyof typeof patch];
    if (v !== undefined && str(v) !== String(cur[f] ?? "")) {
      if (!reason) throw new AppError(422, "修改测量记录必须填写原因。");
      history.push({ revision: rev, at: now(), field: f, before: String(cur[f] ?? ""), after: str(v), reason });
      next[f] = str(v);
      changed = true;
    }
  }
  const measurement: MeasurementRecord = { ...(next as MeasurementRecord), revision: changed ? rev : cur.revision, history };
  let ns: LocusState = { ...state, measurements: state.measurements.map((m) => (m.id === id ? measurement : m)) };
  if (changed) {
    ns = registerImpact(ns, {
      topicId: cur.topicId,
      change: { entityKind: "measurement", entityId: id, revision: measurement.revision, summary: `测量修订 r${measurement.revision}：${reason}` },
      aiConfigured: getAiConfig() !== null,
    }).state;
  }
  return { state: ns, measurement };
}

// ── 影响分析（ARC06/ARC07：确定性传播独立；AI 分栏；失败≠无影响）──

/** 确定性时间传播：比较前后步骤时长，下游主线步骤起始时间平移；未知时长不计入并说明。 */
export function computeTimeShifts(prev: ProtocolStep[], next: ProtocolStep[]): { timeShifts: ImpactRecord["deterministic"]["timeShifts"]; note: string } {
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const mainNext = next.filter((s) => s.branch === null);
  const total = mainNext.reduce((a, s) => a + (s.durationMin ?? 0), 0);
  const timeShifts: { stepId: string; op: string; deltaMin: number; newTotalMin: number }[] = [];
  let cum = 0;
  let unknownCount = 0;
  for (const s of mainNext) {
    const before = prevById.get(s.id);
    if (before && before.durationMin !== null && s.durationMin !== null && before.durationMin !== s.durationMin) {
      const delta = s.durationMin - before.durationMin;
      cum += delta;
      timeShifts.push({ stepId: s.id, op: s.op, deltaMin: delta, newTotalMin: total });
    } else if (cum !== 0) {
      timeShifts.push({ stepId: s.id, op: s.op, deltaMin: cum, newTotalMin: total });
    }
    if (s.durationMin === null) unknownCount++;
  }
  const note = timeShifts.length > 0
    ? `主线总时长（已知部分）变为 ${total} 分钟；${unknownCount > 0 ? `另有 ${unknownCount} 步时长未知，未计入。` : ""}`
    : unknownCount > 0
      ? `有 ${unknownCount} 步时长未知，未计入总时长；无已知时长变化。`
      : "主线步骤时长无变化，无确定性时间传播。";
  return { timeShifts, note };
}

export interface ImpactRegistration {
  topicId: string;
  change: ImpactRecord["change"];
  prevSteps?: ProtocolStep[];
  nextSteps?: ProtocolStep[];
  aiConfigured: boolean;
}

/** 登记影响分析：旧的同实体分析置 stale（保留旧结论供查）；未配置 AI ⇒ failed+needs_review，不是“无影响”。 */
export function registerImpact(state: LocusState, reg: ImpactRegistration): { state: LocusState; impact: ImpactRecord } {
  const deterministic = reg.prevSteps && reg.nextSteps
    ? computeTimeShifts(reg.prevSteps, reg.nextSteps)
    : { timeShifts: [], note: "该变更类型无确定性时间传播；语义影响待 AI 评估。" };
  const snapshotHash = contentHash(JSON.stringify({ change: reg.change, deterministic }));
  const impacts = state.impacts.map((i) =>
    i.change.entityId === reg.change.entityId && i.status !== "stale"
      ? { ...i, status: "stale" as const, updatedAt: now() }
      : i,
  );
  const impact: ImpactRecord = {
    id: `imp_${randomUUID()}`,
    topicId: reg.topicId,
    change: reg.change,
    snapshotHash,
    status: reg.aiConfigured ? "pending" : "failed",
    deterministic,
    promptVersion: "impact_assess/v1",
    assessment: reg.aiConfigured ? undefined : "needs_review",
    summary: reg.aiConfigured ? "变更已登记，等待 AI 语义评估。" : "AI 未配置：语义影响未分析（这不等于“无影响”）。",
    items: [],
    error: reg.aiConfigured ? undefined : "AI 未配置",
    createdAt: now(),
    updatedAt: now(),
  };
  return { state: { ...state, impacts: [...impacts, impact] }, impact };
}

function impactToState(i: ImpactRecord): ImpactState {
  return { status: i.status, assessment: i.assessment, snapshotHash: i.snapshotHash };
}

/** 组装 AI 上下文：变更 + 实体快照 + 固定引用它的下游（执行/测量）。 */
export function buildImpactContext(state: LocusState, impact: ImpactRecord): string {
  const { entityKind, entityId } = impact.change;
  const parts: Record<string, unknown> = { change: impact.change, deterministic: impact.deterministic };
  if (entityKind === "protocol") {
    const p = state.protocols.find((x) => x.id === entityId);
    if (p) {
      parts.protocol = p.revisions.find((r) => r.revision === impact.change.revision) ?? null;
      parts.executionsPinned = state.executions.filter((e) => e.protocolId === entityId).map((e) => ({ id: e.id, protocolRevision: e.protocolRevision, status: e.status, events: e.events.length }));
      parts.templatesPinned = state.templates.filter((t) => t.protocolId === entityId).map((t) => ({ id: t.id, protocolRevision: t.protocolRevision, humanConfirmed: t.humanConfirmed }));
    }
  } else if (entityKind === "execution") {
    const e = state.executions.find((x) => x.id === entityId);
    if (e) parts.execution = { ...e, events: e.events.slice(-20) };
  } else if (entityKind === "sample") {
    const s = state.samples.find((x) => x.id === entityId);
    if (s) {
      parts.sample = s;
      parts.measurements = state.measurements.filter((m) => m.sampleId === entityId);
    }
  } else if (entityKind === "measurement") {
    const m = state.measurements.find((x) => x.id === entityId);
    if (m) {
      parts.measurement = m;
      parts.sample = state.samples.find((s) => s.id === m.sampleId) ?? null;
    }
  } else if (entityKind === "table") {
    const t = state.tables.find((x) => x.id === entityId);
    if (t) parts.table = { id: t.id, name: t.name, revision: t.revision };
  }
  return JSON.stringify(parts).slice(0, 8000);
}

const ASSESSMENTS = new Set(["impact", "no_supported_impact_found", "needs_review"]);
const CATEGORIES = new Set(["timing", "execution", "comparability", "analysis", "interpretation"]);

function mapImpactItems(items: unknown): ImpactItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const category = CATEGORIES.has(str(o.category)) ? (str(o.category) as ImpactItem["category"]) : "interpretation";
    return {
      targetKind: str(o.targetKind),
      targetId: str(o.targetId),
      targetRevision: typeof o.targetRevision === "number" ? o.targetRevision : undefined,
      category,
      finding: str(o.finding),
      reason: str(o.reason),
      evidenceRefs: Array.isArray(o.evidenceRefs) ? o.evidenceRefs.map(str).filter(Boolean) : [],
      unknowns: Array.isArray(o.unknowns) ? o.unknowns.map(str).filter(Boolean) : [],
      suggestedAction: str(o.suggestedAction),
    };
  });
}

/**
 * 运行 AI 语义评估（后台任务用）。
 * 晚到守卫：结果落盘前重读状态；若该分析已 stale/被替换（snapshotHash 变），丢弃旧结果，不覆盖新改动。
 * 失败 ⇒ failed + needs_review，绝不产出 no_supported_impact_found。
 */
export async function runImpactAssessment(
  loadState: () => Promise<LocusState>,
  saveState: (s: LocusState) => Promise<void>,
  impactId: string,
  cfg: AiConfig,
): Promise<{ ok: boolean; discarded?: boolean; error?: string }> {
  let state = await loadState();
  const cur = state.impacts.find((i) => i.id === impactId);
  if (!cur) throw new AppError(404, `影响分析不存在：${impactId}`);
  if (cur.status === "stale" || cur.status === "completed") return { ok: false, discarded: true };
  const started = transition(impactToState(cur), { type: "start" });
  const running: ImpactRecord = { ...cur, status: started.status as ImpactRecord["status"], updatedAt: now() };
  state = { ...state, impacts: state.impacts.map((i) => (i.id === impactId ? running : i)) };
  await saveState(state);
  const context = buildImpactContext(state, running);
  try {
    const { value } = await runTask(cfg, "impact_assess", context);
    const obj = (value ?? {}) as { summary?: unknown; assessment?: unknown; items?: unknown };
    const assessment = ASSESSMENTS.has(str(obj.assessment)) ? (str(obj.assessment) as NonNullable<ImpactRecord["assessment"]>) : "needs_review";
    // 晚到守卫：重读，确认仍是同一次 running 分析。
    const fresh = await loadState();
    const nowRec = fresh.impacts.find((i) => i.id === impactId);
    if (!nowRec || nowRec.status !== "running" || nowRec.snapshotHash !== running.snapshotHash) {
      return { ok: false, discarded: true };
    }
    const done = transition(impactToState(nowRec), { type: "complete", assessment, snapshotHash: nowRec.snapshotHash });
    const completed: ImpactRecord = {
      ...nowRec,
      status: done.status as ImpactRecord["status"],
      assessment,
      summary: str(obj.summary) || "（模型未给摘要）",
      items: mapImpactItems(obj.items),
      model: cfg.model,
      error: undefined,
      updatedAt: now(),
    };
    await saveState({ ...fresh, impacts: fresh.impacts.map((i) => (i.id === impactId ? completed : i)) });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof AiError ? e.message : `影响评估失败：${(e as Error).message}`;
    const fresh = await loadState();
    const nowRec = fresh.impacts.find((i) => i.id === impactId);
    if (!nowRec || nowRec.status !== "running" || nowRec.snapshotHash !== running.snapshotHash) {
      return { ok: false, discarded: true, error: msg };
    }
    const failed = transition(impactToState(nowRec), { type: "fail" });
    const rec: ImpactRecord = { ...nowRec, status: failed.status as ImpactRecord["status"], assessment: "needs_review", error: msg, updatedAt: now() };
    await saveState({ ...fresh, impacts: fresh.impacts.map((i) => (i.id === impactId ? rec : i)) });
    return { ok: false, error: msg };
  }
}

/** 界面展示口径：failed/未配置/stale 不得显示“无影响”。 */
export function impactDisplay(i: ImpactRecord): ReturnType<typeof displayAssessment> {
  return displayAssessment(impactToState(i));
}

// ── OCR / 手写记录（OCR01/OCR02：原图归档 + 独立任务 + 人工确认）──

const IMAGE_DATAURL = /^data:image\/(png|jpeg|webp);base64,/;

export function importImage(state: LocusState, input: { name: string; dataUrl: string; topicId?: string }): { state: LocusState; asset: AssetRecord } {
  const dataUrl = String(input.dataUrl ?? "");
  if (!IMAGE_DATAURL.test(dataUrl)) throw new AppError(422, "图片须为 PNG/JPEG/WebP 的 dataURL（原图归档，不压缩转码）。");
  const bytes = Buffer.byteLength(dataUrl, "utf8");
  if (bytes > MAX_IMPORT_BYTES) throw new AppError(413, `图片超过上限 ${MAX_IMPORT_BYTES} 字节，已拒绝（不截断）。`);
  const hash = contentHash(dataUrl);
  if (state.assets.some((a) => a.hash === hash)) throw new AppError(409, "已导入相同图片（内容 hash 相同），已拒收。");
  const asset: AssetRecord = {
    id: `ast_${randomUUID()}`,
    kind: "image",
    name: str(input.name) || "未命名图片",
    topicId: input.topicId || undefined,
    bytes,
    hash,
    text: dataUrl,
    createdAt: now(),
  };
  return { state: { ...state, assets: [...state.assets, asset] }, asset };
}

function newOcr(assetId: string, rawText: string, fields: Record<string, string>, unknowns: string[], extraction: OcrRecord["extraction"]): OcrRecord {
  return {
    id: `ocr_${randomUUID()}`,
    assetId,
    extraction,
    rawText,
    fields,
    unknowns,
    status: "draft",
    revision: 1,
    history: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

/** AI 识别（视觉独立任务）：原图 dataURL 直传；失败抛 AiError，不降级为假 AI。 */
export async function runOcr(cfg: AiConfig, asset: AssetRecord): Promise<{ ocrs: OcrRecord[]; raw: string; model: string }> {
  if (asset.kind !== "image") throw new AppError(422, "OCR 只接受图片原件。");
  const { value, raw } = await runTask(cfg, "handwriting_ocr", "请逐字转录这张手写实验记录图片。", [asset.text]);
  const obj = (value ?? {}) as { records?: unknown };
  if (!obj || !Array.isArray(obj.records)) throw new AiError("识别结果结构不符：缺少 records。");
  const ocrs = obj.records.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    if (o.fields && typeof o.fields === "object") {
      for (const [k, v] of Object.entries(o.fields as Record<string, unknown>)) fields[str(k)] = str(v);
    }
    return newOcr(asset.id, str(o.rawText), fields, Array.isArray(o.unknowns) ? o.unknowns.map(str).filter(Boolean) : [], "ai");
  });
  if (ocrs.length === 0) throw new AiError("识别结果为空。");
  return { ocrs, raw, model: cfg.model };
}

/** 人工转录兜底：真实手写公开材料缺位时，允许人工录入，明确标 manual。 */
export function addManualOcr(state: LocusState, assetId: string, input: { rawText: string; fields?: Record<string, string>; unknowns?: string[] }): { state: LocusState; ocr: OcrRecord } {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) throw new AppError(404, `原件不存在：${assetId}`);
  if (asset.kind !== "image") throw new AppError(422, "OCR 记录只挂在图片原件上。");
  const rawText = str(input.rawText);
  if (!rawText) throw new AppError(422, "转录文本不能为空。");
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.fields ?? {})) fields[str(k)] = str(v);
  const ocr = newOcr(assetId, rawText, fields, (input.unknowns ?? []).map(str).filter(Boolean), "manual");
  return { state: { ...state, ocrs: [...state.ocrs, ocr] }, ocr };
}

/** 人工修订并确认：改转录/数值须原因；留历史；确认后 status=confirmed。 */
export function confirmOcr(
  state: LocusState,
  id: string,
  patch: { rawText?: string; fields?: Record<string, string>; unknowns?: string[]; reason?: string },
): { state: LocusState; ocr: OcrRecord } {
  const cur = state.ocrs.find((o) => o.id === id);
  if (!cur) throw new AppError(404, `OCR 记录不存在：${id}`);
  const reason = str(patch.reason);
  const history: RevisionEntry[] = [...cur.history];
  const rev = cur.revision + 1;
  let rawText = cur.rawText;
  let fields = cur.fields;
  let unknowns = cur.unknowns;
  let changed = false;
  if (patch.rawText !== undefined && str(patch.rawText) !== cur.rawText) {
    if (!reason) throw new AppError(422, "修改转录文本必须填写原因。");
    history.push({ revision: rev, at: now(), field: "rawText", before: cur.rawText, after: str(patch.rawText), reason });
    rawText = str(patch.rawText);
    changed = true;
  }
  if (patch.fields) {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.fields)) next[str(k)] = str(v);
    if (JSON.stringify(next) !== JSON.stringify(cur.fields)) {
      if (!reason) throw new AppError(422, "修改识别数值必须填写原因。");
      history.push({ revision: rev, at: now(), field: "fields", before: JSON.stringify(cur.fields), after: JSON.stringify(next), reason });
      fields = next;
      changed = true;
    }
  }
  if (patch.unknowns) {
    unknowns = patch.unknowns.map(str).filter(Boolean);
    changed = true;
  }
  const ocr: OcrRecord = { ...cur, rawText, fields, unknowns, status: "confirmed", revision: changed ? rev : cur.revision, history, updatedAt: now() };
  return { state: { ...state, ocrs: state.ocrs.map((o) => (o.id === id ? ocr : o)) }, ocr };
}