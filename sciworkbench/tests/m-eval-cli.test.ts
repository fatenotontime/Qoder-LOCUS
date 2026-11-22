/**
 * M5 CLI 端到端：check/replay、compare、judge 三命令；显式输入输出；退出码；
 * 在清空 AI 配置（不联网）的环境下运行。全部输出写到临时目录，不写仓库。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "m-eval.ts");
const FX = join(ROOT, "tests", "fixtures", "m-eval");
const offlineEnv = { ...process.env, LOCUS_AI_KEY: "", LOCUS_AI_BASE_URL: "", LOCUS_AI_MODEL: "" };

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env: offlineEnv, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

test("M5-CLI check：离线重做结构检查，显式输出，提示词与基线一致", () => {
  const out = mkdtempSync(join(tmpdir(), "m-eval-check-"));
  const r = cli(["check", "--samples", join(FX, "samples", "samples.json"), "--run", join(FX, "runs", "knowledge_struct-new.json"), "--baseline", join(FX, "baseline", "knowledge_struct.json"), "--out", out]);
  assert.ok(existsSync(join(out, "check.json")) && existsSync(join(out, "check.md")), "写出 check.json/md");
  const cj = JSON.parse(readFileSync(join(out, "check.json"), "utf8"));
  assert.equal(cj.promptMatch, true);
  assert.ok(cj.samples.length === 3);
  assert.equal(r.status, 3); // 语义项待人工判断 → 不伪装通过
});

test("M5-CLI 输入/格式错误 → 退出码 2", () => {
  const out = mkdtempSync(join(tmpdir(), "m-eval-bad-"));
  assert.equal(cli(["check", "--samples", join(FX, "samples", "does-not-exist.json"), "--run", "x", "--out", out]).status, 2);
  assert.equal(cli(["compare", "--samples", join(FX, "samples", "samples.json"), "--old", "nope.json", "--new", "nope2.json", "--out", out]).status, 2);
  assert.equal(cli(["freeze", "--code-baseline", "x", "--out", join(out, "b.json")]).status, 2); // 缺 --task
});

test("M5-CLI compare：生成 JSON + 可读 Markdown，逐样本与汇总", () => {
  const out = mkdtempSync(join(tmpdir(), "m-eval-cmp-"));
  const r = cli(["compare", "--samples", join(FX, "samples", "samples.json"), "--old", join(FX, "runs", "knowledge_struct-old.json"), "--new", join(FX, "runs", "knowledge_struct-new.json"), "--out", out]);
  const report = JSON.parse(readFileSync(join(out, "comparison.json"), "utf8"));
  assert.equal(report.taskId, "knowledge_struct");
  assert.ok(report.perCase.length === 3);
  const md = readFileSync(join(out, "comparison.md"), "utf8");
  assert.ok(md.includes("提示词对比报告") && md.includes("逐样本") && md.includes("simulated"));
  assert.equal(r.status, report.summary.needs_review > 0 ? 3 : 0);
});

test("M5-CLI compare：非提示词因素变化时明确不可比", () => {
  const out = mkdtempSync(join(tmpdir(), "m-eval-cmp2-"));
  cli(["compare", "--samples", join(FX, "samples", "samples.json"), "--old", join(FX, "runs", "knowledge_struct-new.json"), "--new", join(FX, "runs", "knowledge_struct-new-incomparable.json"), "--out", out]);
  const report = JSON.parse(readFileSync(join(out, "comparison.json"), "utf8"));
  assert.equal(report.comparability.comparable, false);
  assert.ok(report.comparability.nonPromptDiffs.some((d: string) => d.includes("模型参数不同")));
});

test("M5-CLI judge：登记判断并保留历史，不覆盖原判断", () => {
  const out = mkdtempSync(join(tmpdir(), "m-eval-judge-"));
  const checked = mkdtempSync(join(tmpdir(), "m-eval-check2-"));
  cli(["check", "--samples", join(FX, "samples", "samples.json"), "--run", join(FX, "runs", "handwriting_ocr-new.json"), "--out", checked]);
  const cj = JSON.parse(readFileSync(join(checked, "check.json"), "utf8"));
  const jf = join(out, "judgment.json");
  const uf = join(out, "updates.json");
  writeFileSync(jf, JSON.stringify(cj.samples[0].judgment));
  writeFileSync(uf, JSON.stringify({ at: "t1", note: "初判", updates: [{ checkId: "manual:0", human: "pass", reason: "人工核对一致" }] }));
  const r = cli(["judge", "--judgment", jf, "--updates", uf, "--out", join(out, "next.json")]);
  const next = JSON.parse(readFileSync(join(out, "next.json"), "utf8"));
  assert.equal(next.history.length, 1);
  assert.ok(next.history[0].items.some((i: { checkId: string; human: string }) => i.checkId === "manual:0" && i.human === "pending"));
  assert.equal(next.items.find((i: { checkId: string }) => i.checkId === "manual:0").human, "pass");
  assert.equal(r.status, 3); // 其余语义项仍待审
});
