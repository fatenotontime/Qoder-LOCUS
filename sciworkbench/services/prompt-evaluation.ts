/**
 * M 方法评测路（先行）· M5：离线评测（不是模型调用平台）。
 *
 * 交付：四类任务的提示词基线冻结、样本/运行/处理/判断/比较的**记录结构**、
 *       确定性解析与结构规则检查、可比性判断、逐例差异汇总与可读报告。
 *
 * 边界（与 M_METHOD_EVAL_LANE_EXECUTION_PROMPT 一致）：
 *  - 纯函数、零 npm 依赖（仅 node 内置 crypto）；不调用模型、不联网、不执行报告中的文本/脚本。
 *  - 基线取自只读 TASKS（services/ai.ts），冻结 system/schema **正文**与 hash；不写回 TASKS、不自动发布。
 *  - 自动规则仅限结构、必填项、明确禁止字段等**可验证事实**；语义需人工判断，未审阅保持未审阅。
 */
import { createHash } from "node:crypto";
import { TASKS, KNOWLEDGE_STRUCT_PROMPT_VERSION, KNOWLEDGE_STRUCT_SCHEMA_VERSION, type TaskName } from "./ai.ts";

// ── 任务映射（首批固定四类）────────────────────────────────

export type EvalTaskId = "knowledge_struct" | "handwriting_ocr" | "pause_assist" | "impact_assess";

export const EVAL_TASKS: readonly EvalTaskId[] = ["knowledge_struct", "handwriting_ocr", "pause_assist", "impact_assess"];

export const EVAL_TASK_TO_TASKNAME: Record<EvalTaskId, TaskName> = {
  knowledge_struct: "knowledge_struct",
  handwriting_ocr: "handwriting_ocr",
  pause_assist: "pause_assist",
  impact_assess: "impact_assess",
};

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ── 提示词基线 ─────────────────────────────────────────────

export interface PromptBaseline {
  readonly taskId: EvalTaskId;
  readonly taskName: TaskName;
  /** 有版本常量则用之；否则标「未定义版本常量」，一律以正文 hash 冻结（不统一编造 promptVersion）。 */
  readonly versionLabel: string;
  readonly systemText: string;
  readonly schemaText: string;
  readonly systemHash: string;
  readonly schemaHash: string;
  /** 冻结时所用的代码基线（提交号）。 */
  readonly codeBaseline: string;
}

export function freezeBaseline(taskId: EvalTaskId, codeBaseline: string): PromptBaseline {
  const def = TASKS[EVAL_TASK_TO_TASKNAME[taskId]];
  const versionLabel =
    taskId === "knowledge_struct"
      ? `${KNOWLEDGE_STRUCT_PROMPT_VERSION}（schemaVersion ${KNOWLEDGE_STRUCT_SCHEMA_VERSION}）`
      : "未定义版本常量（以正文 hash 冻结）";
  return {
    taskId,
    taskName: def.name,
    versionLabel,
    systemText: def.system,
    schemaText: def.schema,
    systemHash: hashText(def.system),
    schemaHash: hashText(def.schema),
    codeBaseline,
  };
}

export interface RunPromptRef {
  readonly versionLabel: string;
  readonly systemHash: string;
  readonly schemaHash: string;
}

export function promptRefFromBaseline(b: PromptBaseline): RunPromptRef {
  return { versionLabel: b.versionLabel, systemHash: b.systemHash, schemaHash: b.schemaHash };
}

// ── 样本 ───────────────────────────────────────────────────

export type EvalSplit = "tuning" | "holdout";

export interface EvalSample {
  readonly id: string;
  readonly taskId: EvalTaskId;
  readonly split: EvalSplit;
  /** 来源/许可说明。 */
  readonly provenance: string;
  readonly kind: "synthetic" | "real";
  readonly input: string;
  readonly inputHash: string;
  /** 人工验收点；留出样本的验收答案不得混入发送输入。 */
  readonly acceptancePoints: readonly string[];
}

export function makeSample(s: Omit<EvalSample, "inputHash">): EvalSample {
  return { ...s, inputHash: hashText(s.input) };
}

// ── 处理记录（输入处理器版本 + 实际发送输入 + hash）─────────

export interface ProcessingRecord {
  readonly processorVersion: string;
  readonly actualInput: string;
  readonly inputHash: string;
  readonly params: Readonly<Record<string, string>>;
  /** OCR：图像内容 hash（不只存可能变化的图片路径）。 */
  readonly imageHash?: string;
}

export function makeProcessing(p: Omit<ProcessingRecord, "inputHash">): ProcessingRecord {
  return { ...p, inputHash: hashText(p.actualInput) };
}

// ── 运行记录 ───────────────────────────────────────────────

export type RunMode = "simulated" | "real";

export interface SingleRun {
  readonly sampleId: string;
  readonly status: "ok" | "parse_error";
  /** 未经修补的原始输出。 */
  readonly rawOutput: string;
  readonly parsed: unknown | null;
  readonly parseError: string | null;
}

export function makeSingleRun(taskId: EvalTaskId, sampleId: string, rawOutput: string): SingleRun {
  const { parsed, parseError } = autoChecks(taskId, rawOutput);
  return { sampleId, status: parseError ? "parse_error" : "ok", rawOutput, parsed, parseError };
}

export interface RunSet {
  readonly setId: string;
  readonly taskId: EvalTaskId;
  readonly modelId: string;
  /** 实际已知参数；未知参数须显式标注，不补默认值。 */
  readonly params: Readonly<Record<string, string>>;
  readonly mode: RunMode;
  readonly at: string;
  readonly prompt: RunPromptRef;
  readonly processing: { readonly processorVersion: string; readonly params: Readonly<Record<string, string>> };
  /** 每个样本在该次运行中实际使用的输入 hash（用于发现「样本输入被改」而不可归因改词）。 */
  readonly sampleInputHashes: Readonly<Record<string, string>>;
  readonly runs: readonly SingleRun[];
}

// ── 自动结构检查（限可验证事实）─────────────────────────────

export interface AutoCheck {
  readonly checkId: string;
  readonly rule: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly kind: "structural" | "manual";
}

const FORBIDDEN_BY_TASK: Partial<Record<EvalTaskId, readonly string[]>> = {
  knowledge_struct: ["audit", "revision", "stableId", "history"],
};

function collectKeys(v: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) collectKeys(x, acc);
  else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      acc.add(k);
      collectKeys(val, acc);
    }
  }
  return acc;
}

/** 确定性解析 + 结构规则；不调用模型。 */
export function autoChecks(taskId: EvalTaskId, rawOutput: string): { parsed: unknown | null; parseError: string | null; checks: AutoCheck[] } {
  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (e) {
    parseError = (e as Error).message;
  }
  const checks: AutoCheck[] = [];
  checks.push({ checkId: "json_parse", rule: "输出是合法 JSON", ok: parseError === null, detail: parseError ?? "ok", kind: "structural" });

  const obj = parsed as Record<string, unknown> | null;
  const hasObj = obj !== null && typeof obj === "object" && !Array.isArray(obj);

  const reqArray = (key: string) =>
    checks.push({
      checkId: `array:${key}`,
      rule: `顶层 ${key} 为数组`,
      ok: hasObj && Array.isArray(obj![key]),
      detail: hasObj && Array.isArray(obj![key]) ? "ok" : "缺失或非数组",
      kind: "structural",
    });

  if (taskId === "knowledge_struct") {
    checks.push({ checkId: "field:schemaVersion", rule: "顶层含 schemaVersion", ok: hasObj && obj!.schemaVersion !== undefined, detail: hasObj && obj!.schemaVersion !== undefined ? "ok" : "缺失", kind: "structural" });
    ["evidence", "contexts", "cards", "relations"].forEach(reqArray);
  } else if (taskId === "handwriting_ocr") {
    reqArray("records");
  } else if (taskId === "pause_assist") {
    reqArray("risks");
    reqArray("resumeChecks");
  } else if (taskId === "impact_assess") {
    reqArray("items");
    checks.push({ checkId: "field:assessment", rule: "assessment 取值合法", ok: hasObj && ["impact", "no_supported_impact_found", "needs_review"].includes(String(obj!.assessment)), detail: hasObj ? String(obj!.assessment) : "缺失", kind: "structural" });
  }

  const forbidden = FORBIDDEN_BY_TASK[taskId];
  if (forbidden && parsed !== null) {
    const keys = collectKeys(parsed);
    const bad = forbidden.filter((k) => keys.has(k));
    checks.push({ checkId: "forbidden_fields", rule: `不得出现字段 ${forbidden.join("/")}`, ok: bad.length === 0, detail: bad.length ? `出现：${bad.join(",")}` : "ok", kind: "structural" });
  }

  return { parsed, parseError, checks };
}

/** 需人工判断的语义项（不靠关键词齐全冒充语义正确）。 */
export function manualChecks(taskId: EvalTaskId): readonly string[] {
  switch (taskId) {
    case "knowledge_struct":
      return ["每条 evidence 的 quote 是否在原文逐字存在", "未知范围/条件是否如实列入 unknowns 而非补造", "二手转引是否标 secondaryCitation"];
    case "handwriting_ocr":
      return ["数值/负号/小数点/单位是否与图一致", "不清晰处是否保持未知（? 占位）而非猜测", "表格结构是否保持"];
    case "pause_assist":
      return ["风险与恢复检查是否基于给定快照", "不确定项是否列入 unknowns"];
    case "impact_assess":
      return ["证据不足是否用 needs_review 而非称无影响", "受影响对象/类别是否与快照一致"];
  }
}

// ── 判断记录（原始输出不改，判断修订留历史）─────────────────

export type JudgmentVerdict = "pass" | "fail" | "pending";

export interface JudgmentItem {
  readonly checkId: string;
  readonly auto: { readonly rule: string; readonly ok: boolean } | null;
  readonly human: JudgmentVerdict;
  readonly reason: string;
  readonly failureClass: string | null;
}

export interface JudgmentRecord {
  readonly runId: string;
  readonly items: readonly JudgmentItem[];
  readonly history: readonly { readonly at: string; readonly note: string; readonly items: readonly JudgmentItem[] }[];
}

export function buildJudgment(run: SingleRun, taskId: EvalTaskId): JudgmentRecord {
  const { checks } = autoChecks(taskId, run.rawOutput);
  const items: JudgmentItem[] = [
    ...checks.map((c) => ({ checkId: `auto:${c.checkId}`, auto: { rule: c.rule, ok: c.ok }, human: "pending" as const, reason: "", failureClass: null })),
    ...manualChecks(taskId).map((rule, i) => ({ checkId: `manual:${i}`, auto: null, human: "pending" as const, reason: rule, failureClass: null })),
  ];
  return { runId: run.sampleId, items, history: [] };
}

export interface JudgmentUpdate {
  readonly checkId: string;
  readonly human: JudgmentVerdict;
  readonly reason: string;
  readonly failureClass?: string | null;
}

/** 新增判断并保留旧判断为历史；不改动任何原始输出。 */
export function registerJudgment(
  prev: JudgmentRecord,
  input: { readonly at: string; readonly note: string; readonly updates: readonly JudgmentUpdate[] },
): JudgmentRecord {
  const byId = new Map(input.updates.map((u) => [u.checkId, u]));
  const items = prev.items.map((it) => {
    const u = byId.get(it.checkId);
    return u ? { ...it, human: u.human, reason: u.reason, failureClass: u.failureClass ?? null } : it;
  });
  return { runId: prev.runId, items, history: [...prev.history, { at: input.at, note: input.note, items: prev.items }] };
}

// ── 可比性与逐例差异 ───────────────────────────────────────

export type CaseCategory = "fixed" | "new_failure" | "still_failing" | "needs_review" | "unchanged_pass";
export type Verdict = JudgmentVerdict;

export interface ComparabilityResult {
  readonly comparable: boolean;
  readonly promptChanges: readonly string[];
  readonly nonPromptDiffs: readonly string[];
  readonly note: string;
}

export function assessComparability(oldSet: RunSet, newSet: RunSet): ComparabilityResult {
  const nonPromptDiffs: string[] = [];
  if (oldSet.taskId !== newSet.taskId) nonPromptDiffs.push(`任务不同（${oldSet.taskId} vs ${newSet.taskId}）`);
  if (oldSet.modelId !== newSet.modelId) nonPromptDiffs.push(`模型不同（${oldSet.modelId} vs ${newSet.modelId}）`);
  if (JSON.stringify(oldSet.params) !== JSON.stringify(newSet.params)) nonPromptDiffs.push("模型参数不同");
  if (oldSet.processing.processorVersion !== newSet.processing.processorVersion) nonPromptDiffs.push("输入处理器版本不同");
  if (JSON.stringify(oldSet.processing.params) !== JSON.stringify(newSet.processing.params)) nonPromptDiffs.push("处理参数不同");

  const oldIds = oldSet.runs.map((r) => r.sampleId).sort();
  const newIds = newSet.runs.map((r) => r.sampleId).sort();
  if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) nonPromptDiffs.push("样本集合不同");
  const allIds = [...new Set([...Object.keys(oldSet.sampleInputHashes), ...Object.keys(newSet.sampleInputHashes)])].sort();
  const changedInputs = allIds.filter((id) => oldSet.sampleInputHashes[id] !== newSet.sampleInputHashes[id]);
  if (changedInputs.length) nonPromptDiffs.push(`样本输入 hash 变化：${changedInputs.join(",")}`);

  const promptChanges: string[] = [];
  if (oldSet.prompt.systemHash !== newSet.prompt.systemHash) promptChanges.push("system");
  if (oldSet.prompt.schemaHash !== newSet.prompt.schemaHash) promptChanges.push("schema");

  let note: string;
  if (nonPromptDiffs.length > 0) note = "非提示词因素变化，不能作同条件优劣结论；仅展示两次输出并列出差异。";
  else if (promptChanges.length === 0) note = "未检测到提示词变化，无法把差异归因于改词。";
  else if (promptChanges.length > 1) note = "同时改动了 system 与 schema（多因素），不能单独归因。";
  else note = `仅改动 ${promptChanges[0]}，同条件对比成立（仍受样本量与模型波动限制）。`;

  const comparable = nonPromptDiffs.length === 0 && promptChanges.length === 1;
  return { comparable, promptChanges, nonPromptDiffs, note };
}

export interface CaseResult {
  readonly sampleId: string;
  readonly oldVerdict: Verdict;
  readonly newVerdict: Verdict;
  readonly category: CaseCategory;
  readonly note: string;
}

export interface ComparisonReport {
  readonly taskId: EvalTaskId;
  readonly oldSetId: string;
  readonly newSetId: string;
  readonly oldMode: RunMode;
  readonly newMode: RunMode;
  readonly comparability: ComparabilityResult;
  readonly perCase: readonly CaseResult[];
  readonly summary: Readonly<Record<CaseCategory, number>>;
}

function verdictFrom(judgments: readonly JudgmentRecord[] | undefined, run: SingleRun, taskId: EvalTaskId): Verdict {
  const jr = judgments?.find((j) => j.runId === run.sampleId);
  if (jr) {
    if (jr.items.some((i) => i.human === "fail")) return "fail";
    if (jr.items.every((i) => i.human === "pass")) return "pass";
    return "pending";
  }
  const { checks } = autoChecks(taskId, run.rawOutput);
  if (checks.some((c) => !c.ok)) return "fail";
  return "pending"; // 结构通过但未人工审阅 → 不默认为通过
}

function categorize(oldV: Verdict, newV: Verdict): CaseCategory {
  if (oldV === "pending" || newV === "pending") return "needs_review";
  if (oldV === "fail" && newV === "pass") return "fixed";
  if (oldV === "pass" && newV === "fail") return "new_failure";
  if (oldV === "fail" && newV === "fail") return "still_failing";
  return "unchanged_pass";
}

export function compareRuns(
  oldSet: RunSet,
  newSet: RunSet,
  samples: readonly EvalSample[],
  opts: { readonly judgments?: { readonly old?: readonly JudgmentRecord[]; readonly new?: readonly JudgmentRecord[] } } = {},
): ComparisonReport {
  const comparability = assessComparability(oldSet, newSet);
  const perCase: CaseResult[] = [];
  const summary: Record<CaseCategory, number> = { fixed: 0, new_failure: 0, still_failing: 0, needs_review: 0, unchanged_pass: 0 };
  for (const s of samples) {
    const o = oldSet.runs.find((r) => r.sampleId === s.id);
    const n = newSet.runs.find((r) => r.sampleId === s.id);
    if (!o || !n) continue;
    const ov = verdictFrom(opts.judgments?.old, o, oldSet.taskId);
    const nv = verdictFrom(opts.judgments?.new, n, newSet.taskId);
    const category = categorize(ov, nv);
    summary[category]++;
    perCase.push({ sampleId: s.id, oldVerdict: ov, newVerdict: nv, category, note: `${s.split} · ${s.kind}` });
  }
  return { taskId: oldSet.taskId, oldSetId: oldSet.setId, newSetId: newSet.setId, oldMode: oldSet.mode, newMode: newSet.mode, comparability, perCase, summary };
}

// ── 报告渲染 ───────────────────────────────────────────────

export function renderComparisonJson(report: ComparisonReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderComparisonMarkdown(report: ComparisonReport): string {
  const c = report.comparability;
  const lines: string[] = [];
  lines.push(`# 提示词对比报告（离线）`);
  lines.push("");
  lines.push(`> 运行模式：旧=${report.oldMode}，新=${report.newMode}。simulated 为模拟输出，不能证明候选更好。`);
  lines.push("");
  lines.push(`- 任务：${report.taskId}`);
  lines.push(`- 旧运行：${report.oldSetId}`);
  lines.push(`- 新运行：${report.newSetId}`);
  lines.push(`- 可比性：${c.comparable ? "可比（仅改动 " + c.promptChanges.join("+") + "）" : "不可比"}`);
  lines.push(`- 说明：${c.note}`);
  if (c.nonPromptDiffs.length) lines.push(`- 非提示词差异：${c.nonPromptDiffs.join("；")}`);
  lines.push("");
  lines.push(`## 逐样本`);
  lines.push("");
  lines.push(`| 样本 | 旧判断 | 新判断 | 类别 | 备注 |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const p of report.perCase) lines.push(`| ${p.sampleId} | ${p.oldVerdict} | ${p.newVerdict} | ${p.category} | ${p.note} |`);
  lines.push("");
  lines.push(`## 汇总`);
  lines.push("");
  lines.push(`| 类别 | 数量 |`);
  lines.push(`| --- | --- |`);
  for (const k of ["fixed", "new_failure", "still_failing", "needs_review", "unchanged_pass"] as CaseCategory[]) lines.push(`| ${k} | ${report.summary[k]} |`);
  lines.push("");
  return lines.join("\n");
}
