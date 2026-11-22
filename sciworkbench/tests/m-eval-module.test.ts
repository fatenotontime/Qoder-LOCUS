/**
 * M5 离线评测模块测试：基线冻结、结构规则、可比性、逐例差异四类、判断完整性与修订历史。
 * 回应对 S04-T28 的定点修正：结构失败不可被人工 pass 抹去 / 空判断≠通过 / 未知判断项拒绝 /
 * 缺输入证据不可比 / 图像 hash 变化不可比。合成输入来自 fixtures/m-eval。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVAL_TASKS,
  hashText,
  freezeBaseline,
  makeSample,
  makeSingleRun,
  autoChecks,
  manualChecks,
  buildJudgment,
  registerJudgment,
  compareRuns,
  assessComparability,
  renderComparisonMarkdown,
  type EvalSample,
  type RunSet,
  type JudgmentRecord,
  type EvalTaskId,
  type SingleRun,
  type PromptBaseline,
} from "../services/prompt-evaluation.ts";

const fx = <T>(p: string): T => JSON.parse(readFileSync(new URL(`./fixtures/m-eval/${p}`, import.meta.url), "utf8")) as T;

const PROMPT = { versionLabel: "v1", systemHash: "SYS", schemaHash: "SCH" };

type Entry = [sampleId: string, input: string, raw: string];
function runSet(taskId: EvalTaskId, setId: string, entries: Entry[], over: Partial<RunSet> = {}): RunSet {
  return {
    setId, taskId, modelId: "sim-model", params: { temperature: "0" }, mode: "simulated", at: "t",
    prompt: PROMPT, processing: { processorVersion: "input/v1", params: {} },
    runs: entries.map(([id, input, raw]) => makeSingleRun(taskId, id, raw, { actualInput: input })),
    ...over,
  };
}
const sample = (id: string, taskId: EvalTaskId, input: string, split: "tuning" | "holdout" = "tuning"): EvalSample =>
  makeSample({ id, taskId, split, provenance: "合成", kind: "synthetic", input, acceptancePoints: [] });
const fullJudgment = (taskId: EvalTaskId, run: SingleRun, human: "pass" | "fail"): JudgmentRecord => ({
  runId: run.sampleId,
  items: buildJudgment(run, taskId).items.map((i) => ({ ...i, human })),
  history: [],
});

const OK = JSON.stringify({ schemaVersion: 1, evidence: [], contexts: [], cards: [], relations: [] });
const BAD = JSON.stringify({ schemaVersion: 1, revision: 1, evidence: [], contexts: [], cards: [], relations: [] }); // 含禁止字段

test("M5 四类任务映射与基线冻结存正文与 hash（与已存 manifest 一致）", () => {
  assert.deepEqual([...EVAL_TASKS], ["knowledge_struct", "handwriting_ocr", "pause_assist", "impact_assess"]);
  for (const t of EVAL_TASKS) {
    const b = freezeBaseline(t, "a7a57d2");
    assert.ok(b.systemText.length > 20 && b.schemaText.length > 5, `${t} 正文`);
    assert.equal(b.systemHash, hashText(b.systemText));
    assert.equal(b.schemaHash, hashText(b.schemaText));
    const man = fx<PromptBaseline>(`baseline/${t}.json`);
    assert.equal(b.systemHash, man.systemHash, `${t} systemHash 与 manifest 一致`);
    assert.equal(b.schemaHash, man.schemaHash, `${t} schemaHash 与 manifest 一致`);
    assert.equal(b.codeBaseline, man.codeBaseline);
  }
  assert.match(freezeBaseline("knowledge_struct", "x").versionLabel, /knowledge_struct\/v1/);
  assert.match(freezeBaseline("handwriting_ocr", "x").versionLabel, /未定义版本常量/);
});

test("M5 结构规则：禁止字段/缺数组/必填项/非法 JSON", () => {
  assert.ok(autoChecks("knowledge_struct", BAD).checks.find((c) => c.checkId === "forbidden_fields" && !c.ok));
  assert.ok(autoChecks("knowledge_struct", JSON.stringify({ schemaVersion: 1, evidence: [], contexts: [], cards: [] })).checks.find((c) => c.checkId === "array:relations" && !c.ok));
  assert.ok(autoChecks("pause_assist", JSON.stringify({ risks: [] })).checks.find((c) => c.checkId === "array:resumeChecks" && !c.ok));
  assert.ok(autoChecks("impact_assess", JSON.stringify({ summary: "s", assessment: "bogus", items: [] })).checks.find((c) => c.checkId === "field:assessment" && !c.ok));
  const badJson = autoChecks("handwriting_ocr", "{not json");
  assert.ok(badJson.parseError !== null && badJson.checks.find((c) => c.checkId === "json_parse" && !c.ok));
  assert.ok(manualChecks("handwriting_ocr").length >= 2);
});

test("M5 对比四类：修复/新增失败/仍失败/未审 → needs_review（原始输出不改）", () => {
  const task: EvalTaskId = "knowledge_struct";
  const samples = [sample("s1", task, "i1"), sample("s2", task, "i2"), sample("s3", task, "i3"), sample("s4", task, "i4"), sample("s5", task, "i5")];
  const oldSet = runSet(task, "old", [["s1", "i1", BAD], ["s2", "i2", OK], ["s3", "i3", BAD], ["s4", "i4", OK], ["s5", "i5", OK]]);
  const newSet = runSet(task, "new", [["s1", "i1", OK], ["s2", "i2", BAD], ["s3", "i3", BAD], ["s4", "i4", OK], ["s5", "i5", OK]]);
  const oldRaws = oldSet.runs.map((r) => r.rawOutput);
  const r = compareRuns(oldSet, newSet, samples, {
    judgments: {
      old: [fullJudgment(task, oldSet.runs[0], "fail"), fullJudgment(task, oldSet.runs[1], "pass"), fullJudgment(task, oldSet.runs[2], "fail"), fullJudgment(task, oldSet.runs[3], "pass")],
      new: [fullJudgment(task, newSet.runs[0], "pass"), fullJudgment(task, newSet.runs[1], "fail"), fullJudgment(task, newSet.runs[2], "fail"), fullJudgment(task, newSet.runs[3], "pass")],
    },
  });
  const cat = (id: string) => r.perCase.find((p) => p.sampleId === id)!.category;
  assert.equal(cat("s1"), "fixed");
  assert.equal(cat("s2"), "new_failure");
  assert.equal(cat("s3"), "still_failing");
  assert.equal(cat("s4"), "unchanged_pass");
  assert.equal(cat("s5"), "needs_review");
  assert.equal(r.summary.needs_review, 1);
  assert.deepEqual(oldSet.runs.map((x) => x.rawOutput), oldRaws);
  assert.ok(renderComparisonMarkdown(r).includes("new_failure"));
});

test("M5 判断完整性：结构失败不被人工 pass 抹去；空判断≠通过", () => {
  const task: EvalTaskId = "knowledge_struct";
  const samples = [sample("s1", task, "i1")];
  const bad = runSet(task, "bad", [["s1", "i1", BAD]]);
  const good = runSet(task, "good", [["s1", "i1", OK]]);
  // 结构失败 + 全项人工 pass → 仍判 fail（旧实现会误判 fixed/pass）
  const r1 = compareRuns(bad, bad, samples, { judgments: { old: [fullJudgment(task, bad.runs[0], "pass")], new: [fullJudgment(task, bad.runs[0], "pass")] } });
  assert.equal(r1.perCase[0].oldVerdict, "fail");
  assert.equal(r1.summary.fixed, 0);
  // 空判断 items=[] → 视为待审，不得算通过
  const empty: JudgmentRecord = { runId: "s1", items: [], history: [] };
  const r2 = compareRuns(good, good, samples, { judgments: { new: [empty] } });
  assert.equal(r2.perCase[0].newVerdict, "pending");
});

test("M5 未知判断项被拒绝；判断修订保留历史", () => {
  const run = makeSingleRun("handwriting_ocr", "ocr-normal", JSON.stringify({ records: [] }), { actualInput: "x" });
  let j = buildJudgment(run, "handwriting_ocr");
  assert.throws(() => registerJudgment(j, { at: "t", note: "n", updates: [{ checkId: "bogus:0", human: "pass", reason: "" }] }), /未知判断项/);
  j = registerJudgment(j, { at: "t1", note: "初判", updates: [{ checkId: "manual:0", human: "fail", reason: "数值不符" }] });
  assert.equal(j.history.length, 1);
  j = registerJudgment(j, { at: "t2", note: "复核改判", updates: [{ checkId: "manual:0", human: "pass", reason: "复核一致" }] });
  assert.equal(j.history.length, 2);
  assert.equal(j.items.find((i) => i.checkId === "manual:0")!.human, "pass");
  assert.equal(j.history[1].items.find((i) => i.checkId === "manual:0")!.human, "fail");
});

test("M5 可比性：仅改一个提示词因素→可比；换模型/参数/缺证据/图像 hash→不可比", () => {
  const base = runSet("knowledge_struct", "a", [["s1", "i1", OK]]);
  const sysChanged = runSet("knowledge_struct", "b", [["s1", "i1", OK]], { prompt: { ...PROMPT, systemHash: "SYS2" } });
  assert.equal(assessComparability(base, sysChanged).comparable, true);
  assert.deepEqual(assessComparability(base, sysChanged).promptChanges, ["system"]);

  assert.equal(assessComparability(base, runSet("knowledge_struct", "c", [["s1", "i1", OK]], { modelId: "other" })).comparable, false);
  assert.equal(assessComparability(base, runSet("knowledge_struct", "d", [["s1", "i1", OK]], { params: { temperature: "0.7" } })).comparable, false);

  // 缺逐例输入证据 → 不可确认同条件
  const noEvidence: RunSet = { ...base, setId: "e", runs: [makeSingleRun("knowledge_struct", "s1", OK)] };
  const ne = assessComparability(base, noEvidence);
  assert.equal(ne.comparable, false);
  assert.ok(ne.nonPromptDiffs.some((d) => d.includes("缺少逐例处理输入")));

  // 逐例输入变化 → 不可比
  const inputChanged = runSet("knowledge_struct", "f", [["s1", "DIFFERENT", OK]]);
  const ic = assessComparability(base, inputChanged);
  assert.ok(ic.nonPromptDiffs.some((d) => d.includes("逐例处理输入/图像 hash 变化")));

  // OCR 图像 hash 变化 → 不可比（不能只靠不变路径文本判同输入）
  const ocrBase: RunSet = { ...base, taskId: "handwriting_ocr", setId: "g", runs: [makeSingleRun("handwriting_ocr", "s1", OK, { actualInput: "i1", imageHash: "IMG1" })] };
  const ocrChanged: RunSet = { ...ocrBase, setId: "h", runs: [makeSingleRun("handwriting_ocr", "s1", OK, { actualInput: "i1", imageHash: "IMG2" })] };
  assert.equal(assessComparability(ocrBase, ocrChanged).comparable, false);

  const bothPrompt = runSet("knowledge_struct", "i", [["s1", "i1", OK]], { prompt: { ...PROMPT, systemHash: "SYS2", schemaHash: "SCH2" } });
  assert.match(assessComparability(base, bothPrompt).note, /多因素/);
});

test("M5 样本分列、留出答案不泄入、OCR 绑定图像 hash", () => {
  const data = fx<{ samples: EvalSample[] }>("samples/samples.json");
  assert.equal(data.samples.length, 12);
  assert.ok(data.samples.some((s) => s.split === "tuning") && data.samples.some((s) => s.split === "holdout"));
  for (const s of data.samples) {
    assert.equal(s.inputHash, hashText(s.input));
    for (const ap of s.acceptancePoints) assert.ok(!s.input.includes(ap), `${s.id} 验收点不应出现在输入中`);
  }
  for (const s of data.samples.filter((x) => x.taskId === "handwriting_ocr")) assert.ok(s.imageHash && s.imageHash.length === 64, `${s.id} 绑定图像 hash`);
});
