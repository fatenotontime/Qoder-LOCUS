#!/usr/bin/env node
/**
 * M5 离线评测 CLI：检查/回放、比较、登记人工判断、冻结基线。
 * 不调用模型、不联网、不执行报告中的文本或脚本；输出路径一律显式。
 *
 * 退出码：0=正常且无可留待审项；2=输入/格式错误；3=已生成报告但含待审（语义未审不伪装通过）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import {
  EVAL_TASKS,
  freezeBaseline,
  autoChecks,
  buildJudgment,
  registerJudgment,
  compareRuns,
  renderComparisonJson,
  renderComparisonMarkdown,
  type EvalSample,
  type RunSet,
  type JudgmentRecord,
  type EvalTaskId,
  type PromptBaseline,
} from "../services/prompt-evaluation.ts";

const EXIT_OK = 0;
const EXIT_INPUT = 2;
const EXIT_PENDING = 3;

const USAGE = `m-eval —— M5 离线评测 CLI（不调用模型、不联网）

用法：
  node scripts/m-eval.ts freeze  --task <id> --code-baseline <sha> --out <file.json>
  node scripts/m-eval.ts check   --samples <file.json> --run <file.json> [--baseline <file.json>] --out <dir>
  node scripts/m-eval.ts compare --samples <file.json> --old <file.json> --new <file.json> --out <dir> [--judgments-old <f>] [--judgments-new <f>]
  node scripts/m-eval.ts judge   --judgment <file.json> --updates <file.json> --out <file.json>

任务 id：${EVAL_TASKS.join(" / ")}

退出码：0=正常且无可留待审项；2=输入/格式错误；3=已生成报告但含待审。
`;

function fail(msg: string): never {
  process.stderr.write(`[m-eval] ${msg}\n`);
  process.exit(EXIT_INPUT);
}

function readJson<T>(p: string): T {
  let text: string;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    fail(`无法读取文件：${p}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    fail(`文件不是合法 JSON：${p}（${(e as Error).message}）`);
  }
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, content, "utf8");
}

interface Parsed {
  readonly cmd: string;
  readonly flags: Record<string, string>;
}

function parseArgs(argv: readonly string[]): Parsed {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE);
    process.exit(EXIT_OK);
  }
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) fail(`无法识别的参数：${a}`);
    const key = a.slice(2);
    const val = rest[i + 1];
    if (val === undefined || val.startsWith("--")) fail(`参数 ${a} 缺少取值`);
    flags[key] = val;
    i++;
  }
  return { cmd, flags };
}

function requireFlag(flags: Record<string, string>, name: string, cmd: string): string {
  const v = flags[name];
  if (!v) fail(`命令 ${cmd} 缺少必需参数 --${name}`);
  return v;
}

function isEvalTask(v: string): v is EvalTaskId {
  return (EVAL_TASKS as readonly string[]).includes(v);
}

function loadSamples(path: string): EvalSample[] {
  const raw = readJson<unknown>(path);
  const arr = Array.isArray(raw) ? raw : (raw as { samples?: unknown }).samples;
  if (!Array.isArray(arr)) fail(`样本文件应为数组或 {samples:[]}：${path}`);
  return arr as EvalSample[];
}

function loadJudgments(path: string | undefined): JudgmentRecord[] | undefined {
  if (!path) return undefined;
  const raw = readJson<unknown>(path);
  const arr = Array.isArray(raw) ? raw : (raw as { judgments?: unknown }).judgments;
  if (!Array.isArray(arr)) fail(`判断文件应为数组或 {judgments:[]}：${path}`);
  return arr as JudgmentRecord[];
}

// ── freeze ─────────────────────────────────────────────────

function cmdFreeze(flags: Record<string, string>): number {
  const task = requireFlag(flags, "task", "freeze");
  if (!isEvalTask(task)) fail(`未知任务 id：${task}（可用：${EVAL_TASKS.join("/")}）`);
  const codeBaseline = requireFlag(flags, "code-baseline", "freeze");
  const out = requireFlag(flags, "out", "freeze");
  const baseline: PromptBaseline = freezeBaseline(task, codeBaseline);
  writeFile(out, JSON.stringify(baseline, null, 2));
  process.stdout.write(`已冻结基线：${task}（systemHash ${baseline.systemHash.slice(0, 12)}…）→ ${out}\n`);
  return EXIT_OK;
}

// ── check / replay ─────────────────────────────────────────

function cmdCheck(flags: Record<string, string>): number {
  const samples = loadSamples(requireFlag(flags, "samples", "check"));
  const run = readJson<RunSet>(requireFlag(flags, "run", "check"));
  const baselinePath = flags["baseline"];
  const baseline = baselinePath ? readJson<PromptBaseline>(baselinePath) : null;
  const out = requireFlag(flags, "out", "check");

  if (!run || typeof run !== "object" || !Array.isArray(run.runs)) fail("run 文件不是合法 RunSet");
  if (run.taskId !== undefined && baseline && baseline.taskId !== run.taskId) fail(`任务不一致：run=${run.taskId} baseline=${baseline.taskId}`);

  const promptMatch = baseline ? baseline.systemHash === run.prompt.systemHash && baseline.schemaHash === run.prompt.schemaHash : null;

  let pending = false;
  let structuralFail = false;
  const reportSamples = run.runs.map((r) => {
    const sample = samples.find((s) => s.id === r.sampleId);
    const { checks } = autoChecks(run.taskId, r.rawOutput);
    const judgment = buildJudgment(r, run.taskId);
    const sFail = checks.some((c) => !c.ok);
    if (sFail) structuralFail = true;
    if (judgment.items.some((i) => i.human === "pending")) pending = true;
    return {
      sampleId: r.sampleId,
      split: sample?.split ?? "unknown",
      inputHash: sample?.inputHash ?? null,
      status: r.status,
      checks,
      judgment,
    };
  });

  const outJson = { taskId: run.taskId, setId: run.setId, mode: run.mode, promptMatch, samples: reportSamples };
  writeFile(join(out, "check.json"), JSON.stringify(outJson, null, 2));

  const md: string[] = [`# 离线检查/回放（非模型调用）`, ``, `- 任务：${run.taskId}`, `- 运行：${run.setId}（模式 ${run.mode}）`, `- 提示词与基线一致：${promptMatch === null ? "未提供基线，跳过" : promptMatch ? "是" : "否"}`, ``];
  for (const s of reportSamples) {
    md.push(`## ${s.sampleId}（${s.split}）`);
    for (const c of s.checks) md.push(`- [${c.ok ? "ok" : "fail"}] ${c.checkId}：${c.rule} — ${c.detail}`);
    md.push(`- 语义项待人工判断：${s.judgment.items.filter((i) => i.checkId.startsWith("manual:")).length} 项`);
    md.push(``);
  }
  writeFile(join(out, "check.md"), md.join("\n"));

  process.stdout.write(`检查完成 → ${join(out, "check.json")} / check.md\n`);
  if (structuralFail || promptMatch === false) return EXIT_PENDING;
  return pending ? EXIT_PENDING : EXIT_OK;
}

// ── compare ────────────────────────────────────────────────

function cmdCompare(flags: Record<string, string>): number {
  const samples = loadSamples(requireFlag(flags, "samples", "compare"));
  const oldSet = readJson<RunSet>(requireFlag(flags, "old", "compare"));
  const newSet = readJson<RunSet>(requireFlag(flags, "new", "compare"));
  const out = requireFlag(flags, "out", "compare");
  const jo = loadJudgments(flags["judgments-old"]);
  const jn = loadJudgments(flags["judgments-new"]);

  if (!Array.isArray(oldSet.runs) || !Array.isArray(newSet.runs)) fail("old/new 不是合法 RunSet");
  const report = compareRuns(oldSet, newSet, samples, { judgments: { old: jo, new: jn } });

  writeFile(join(out, "comparison.json"), renderComparisonJson(report));
  writeFile(join(out, "comparison.md"), renderComparisonMarkdown(report));
  process.stdout.write(`对比完成 → ${join(out, "comparison.json")} / comparison.md\n`);
  process.stdout.write(`可比性：${report.comparability.comparable ? "可比" : "不可比"}；待审 ${report.summary.needs_review} 例\n`);
  return report.summary.needs_review > 0 ? EXIT_PENDING : EXIT_OK;
}

// ── judge ──────────────────────────────────────────────────

interface UpdatesFile {
  readonly at: string;
  readonly note: string;
  readonly updates: readonly { checkId: string; human: "pass" | "fail" | "pending"; reason: string; failureClass?: string | null }[];
}

function cmdJudge(flags: Record<string, string>): number {
  const prev = readJson<JudgmentRecord>(requireFlag(flags, "judgment", "judge"));
  const updates = readJson<UpdatesFile>(requireFlag(flags, "updates", "judge"));
  const out = requireFlag(flags, "out", "judge");
  if (!Array.isArray(prev.items)) fail("judgment 文件不是合法 JudgmentRecord");
  if (!updates || !Array.isArray(updates.updates)) fail("updates 文件缺少 updates 数组");

  const next = registerJudgment(prev, { at: updates.at, note: updates.note, updates: updates.updates });
  writeFile(out, JSON.stringify(next, null, 2));
  const pending = next.items.some((i) => i.human === "pending");
  process.stdout.write(`判断已登记（保留历史 ${next.history.length} 版）→ ${out}\n`);
  return pending ? EXIT_PENDING : EXIT_OK;
}

// ── main ───────────────────────────────────────────────────

function main(): void {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "freeze":
      process.exitCode = cmdFreeze(flags);
      break;
    case "check":
      process.exitCode = cmdCheck(flags);
      break;
    case "compare":
      process.exitCode = cmdCompare(flags);
      break;
    case "judge":
      process.exitCode = cmdJudge(flags);
      break;
    default:
      fail(`未知命令：${cmd}\n\n${USAGE}`);
  }
}

try {
  main();
} catch (e) {
  fail((e as Error).message);
}
