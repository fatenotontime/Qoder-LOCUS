/**
 * M5 离线评测模块测试：基线冻结（存正文+hash）、结构规则、可比性、逐例差异四类、
 * 判断修订留历史、报告渲染。合成输入来自 fixtures/m-eval。
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
  type PromptBaseline,
} from "../services/prompt-evaluation.ts";

const fx = <T>(p: string): T => JSON.parse(readFileSync(new URL(`./fixtures/m-eval/${p}`, import.meta.url), "utf8")) as T;

const PROMPT = { versionLabel: "v1", systemHash: "SYS", schemaHash: "SCH" };

function runSet(taskId: EvalTaskId, setId: string, entries: [string, string][], over: Partial<RunSet> = {}): RunSet {
  const sampleInputHashes: Record<string, string> = {};
  for (const [id, input] of entries) sampleInputHashes[id] = hashText(input);
  return {
    setId, taskId, modelId: "sim-model", params: { temperature: "0" }, mode: "simulated", at: "t",
    prompt: PROMPT, processing: { processorVersion: "input/v1", params: {} }, sampleInputHashes,
    runs: entries.map(([id, raw]) => makeSingleRun(taskId, id, raw)),
    ...over,
  };
}
const sample = (id: string, taskId: EvalTaskId, input: string, split: "tuning" | "holdout" = "tuning"): EvalSample =>
  makeSample({ id, taskId, split, provenance: "合成", kind: "synthetic", input, acceptancePoints: [] });
const jrec = (runId: string, human: "pass" | "fail"): JudgmentRecord => ({ runId, items: [{ checkId: "manual:0", auto: null, human, reason: "", failureClass: null }], history: [] });

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
  const bad = autoChecks("knowledge_struct", JSON.stringify({ schemaVersion: 1, revision: 1, evidence: [], contexts: [], cards: [], relations: [] }));
  assert.ok(bad.checks.find((c) => c.checkId === "forbidden_fields" && !c.ok));
  const miss = autoChecks("knowledge_struct", JSON.stringify({ schemaVersion: 1, evidence: [], contexts: [], cards: [] }));
  assert.ok(miss.checks.find((c) => c.checkId === "array:relations" && !c.ok));
  const pa = autoChecks("pause_assist", JSON.stringify({ risks: [] }));
  assert.ok(pa.checks.find((c) => c.checkId === "array:resumeChecks" && !c.ok));
  const ia = autoChecks("impact_assess", JSON.stringify({ summary: "s", assessment: "bogus", items: [] }));
  assert.ok(ia.checks.find((c) => c.checkId === "field:assessment" && !c.ok));
  const badJson = autoChecks("handwriting_ocr", "{not json");
  assert.ok(badJson.parseError !== null && badJson.checks.find((c) => c.checkId === "json_parse" && !c.ok));
  assert.ok(manualChecks("handwriting_ocr").length >= 2);
});

test("M5 对比四类：修复/新增失败/仍失败/未审 → needs_review（原始输出不改）", () => {
  const task: EvalTaskId = "knowledge_struct";
  const ok = JSON.stringify({ schemaVersion: 1, evidence: [], contexts: [], cards: [], relations: [] });
  const bad = JSON.stringify({ schemaVersion: 1, revision: 1, evidence: [], contexts: [], cards: [], relations: [] });
  const samples = [sample("s1", task, "i1"), sample("s2", task, "i2"), sample("s3", task, "i3"), sample("s4", task, "i4"), sample("s5", task, "i5")];
  const oldSet = runSet(task, "old", [["s1", bad], ["s2", ok], ["s3", bad], ["s4", ok], ["s5", ok]]);
  const newSet = runSet(task, "new", [["s1", ok], ["s2", bad], ["s3", bad], ["s4", ok], ["s5", ok]]);
  const oldRaws = oldSet.runs.map((r) => r.rawOutput);
  const r = compareRuns(oldSet, newSet, samples, {
    judgments: { old: [jrec("s1", "fail"), jrec("s2", "pass"), jrec("s3", "fail"), jrec("s4", "pass")], new: [jrec("s1", "pass"), jrec("s2", "fail"), jrec("s3", "fail"), jrec("s4", "pass")] },
  });
  const cat = (id: string) => r.perCase.find((p) => p.sampleId === id)!.category;
  assert.equal(cat("s1"), "fixed");
  assert.equal(cat("s2"), "new_failure");
  assert.equal(cat("s3"), "still_failing");
  assert.equal(cat("s4"), "unchanged_pass");
  assert.equal(cat("s5"), "needs_review"); // 未审阅不默认为通过
  assert.equal(r.summary.fixed, 1);
  assert.equal(r.summary.new_failure, 1);
  assert.equal(r.summary.needs_review, 1);
  assert.deepEqual(oldSet.runs.map((x) => x.rawOutput), oldRaws); // 原始输出逐字保留
  assert.ok(renderComparisonMarkdown(r).includes("new_failure"));
});

test("M5 可比性：仅改一个提示词因素→可比；换模型/参数/样本输入→不可比", () => {
  const base = runSet("knowledge_struct", "a", [["s1", "{}"]]);
  const sysChanged = runSet("knowledge_struct", "b", [["s1", "{}"]], { prompt: { ...PROMPT, systemHash: "SYS2" } });
  assert.equal(assessComparability(base, sysChanged).comparable, true);
  assert.deepEqual(assessComparability(base, sysChanged).promptChanges, ["system"]);

  const modelChanged = runSet("knowledge_struct", "c", [["s1", "{}"]], { modelId: "other" });
  const mc = assessComparability(base, modelChanged);
  assert.equal(mc.comparable, false);
  assert.ok(mc.nonPromptDiffs.some((d) => d.includes("模型不同")));

  const paramChanged = runSet("knowledge_struct", "d", [["s1", "{}"]], { params: { temperature: "0.7" } });
  assert.equal(assessComparability(base, paramChanged).comparable, false);

  const inputChanged = runSet("knowledge_struct", "e", [["s1", "CHANGED-INPUT"]], { sampleInputHashes: { s1: hashText("orig") } });
  const ic = assessComparability(base, inputChanged);
  assert.ok(ic.nonPromptDiffs.some((d) => d.includes("样本输入 hash 变化")));

  const bothPrompt = runSet("knowledge_struct", "f", [["s1", "{}"]], { prompt: { ...PROMPT, systemHash: "SYS2", schemaHash: "SCH2" } });
  const bp = assessComparability(base, bothPrompt);
  assert.equal(bp.comparable, false);
  assert.match(bp.note, /多因素/);
});

test("M5 判断修订保留历史，不覆盖", () => {
  const run = makeSingleRun("handwriting_ocr", "ocr-normal", JSON.stringify({ records: [] }));
  let j = buildJudgment(run, "handwriting_ocr");
  assert.ok(j.items.every((i) => i.human === "pending"));
  j = registerJudgment(j, { at: "t1", note: "初判", updates: [{ checkId: "manual:0", human: "fail", reason: "数值不符" }] });
  assert.equal(j.history.length, 1);
  assert.equal(j.items.find((i) => i.checkId === "manual:0")!.human, "fail");
  j = registerJudgment(j, { at: "t2", note: "复核改判", updates: [{ checkId: "manual:0", human: "pass", reason: "复核后一致" }] });
  assert.equal(j.history.length, 2);
  assert.equal(j.items.find((i) => i.checkId === "manual:0")!.human, "pass");
  assert.equal(j.history[1].items.find((i) => i.checkId === "manual:0")!.human, "fail"); // 历史保留首次判断
});

test("M5 样本分列与留出答案不泄入发送输入", () => {
  const data = fx<{ samples: EvalSample[] }>("samples/samples.json");
  assert.equal(data.samples.length, 12);
  assert.ok(data.samples.some((s) => s.split === "tuning") && data.samples.some((s) => s.split === "holdout"));
  for (const s of data.samples) {
    assert.equal(s.inputHash, hashText(s.input));
    for (const ap of s.acceptancePoints) assert.ok(!s.input.includes(ap), `${s.id} 验收点不应出现在输入中`);
  }
});
