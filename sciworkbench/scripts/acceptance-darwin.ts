// 验收用：用内部达尔文包（test-packages/darwin-seed-saltwater）预导入完整研究闭环。
// 用法：node scripts/acceptance-darwin.ts [数据文件]  → 默认 data/acceptance-darwin.json
// 然后：PORT=5184 LOCUS_DATA=<文件> node server.ts，打开 http://127.0.0.1:5184/
//
// 说明：本数据仅供**内部验收**使用；达尔文包不进产品样本（public/samples）、不被公开仓库引用。
// 若测试包缺失，脚本会明确报错而不静默产出空数据。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { JsonFileStore, emptyState } from "../store.ts";
import { createTopic, createSubquestion, addManualCard, reviewCard, importMeasurements } from "../services/app.ts";
import { createPaper, addPaperAttachment } from "../services/papers.ts";
import { createProtocol, startExecution, updatePreparation, confirmPreparation, appendEvent, createSample, addMeasurement } from "../services/experiment.ts";
import { createAnalysisTask, archiveResultFile, submitResult, createReport, applyReportEdit } from "../services/analysis.ts";

const PKG = "../test-packages/darwin-seed-saltwater";
if (!existsSync(`${PKG}/data/darwin-flotation.csv`)) {
  console.error(`缺少内部测试包：${PKG}（达尔文种子浸盐水）。请先准备该包再运行。`);
  process.exit(1);
}
const OUT = process.argv[2] ?? "data/acceptance-darwin.json";

const clean = (w: string) => {
  let t = w.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, "").replace(/<[^>]+>/g, "");
  let prev;
  do { prev = t; t = t.replace(/\{\{[^{}]*\}\}/g, ""); } while (t !== prev);
  return t.replace(/\s+/g, " ").trim();
};
const page = (n: number) => clean(readFileSync(`${PKG}/sources/page-${n}.wiki`, "utf8"));
const ATT_TEXT = ["达尔文《物种起源》1859 · 第十一章 地理分布（影印页 359–361；公有领域）。原文摘录，未改写。", "", page(371), "", page(372), "", page(373)].join("\n");
const FLOAT_CSV = readFileSync(`${PKG}/data/darwin-flotation.csv`, "utf8").trim();
const DISP_CSV = readFileSync(`${PKG}/data/darwin-dispersal-estimates.csv`, "utf8").trim();

let s = emptyState();
s = createTopic(s, { name: "种子经海水漂流后的萌发（达尔文 1859）", researchQuestion: "种子能否经海水漂流后仍萌发，从而跨海传播？" }).state;
const topicId = s.topics[0].id;
s = createSubquestion(s, { topicId, question: "干燥与新鲜的漂浮时长差异如何？", kind: "declared" }).state;
s = createSubquestion(s, { topicId, question: "海浪条件下传播估计是否需下修？", kind: "exploratory" }).state;
const paper = createPaper(s, { title: "On the Origin of Species（1859）· 第十一章 地理分布", authors: ["Charles Darwin"], year: "1859", source: "Wikisource 影印（页 371–373）", license: "Public Domain", topicIds: [topicId], note: "原文叙述，非实验记录本；条件多未量化。" }); s = paper.state;
const att = addPaperAttachment(s, { paperId: paper.paper.id, name: "origin-1859-p371-373.md", text: ATT_TEXT, role: "fulltext", version: "v1" }); s = att.state;
const assetId = att.assetId;
const mkCard = (rawText: string, quote: string, fields: Record<string, string>, importance: "high" | "medium" | "low") => {
  const r = addManualCard(s, { assetId, rawText, sectionQuote: quote, fields, conditions: ["海水浸泡"], unknowns: [] }); s = r.state;
  s = reviewCard(s, r.card.id, { audit: "confirm", importance, reason: "人工核对原文" }); return r.card.id;
};
mkCard("干燥后榛子漂浮 90 天，随后种植萌发（新鲜时立即下沉）。", "ripe hazel-nuts sank immediately, but when dried, they floated for 90 days and afterwards when planted they germinated", { 对象: "榛子", 新鲜: "0", 干燥: "90", 萌发: "是" }, "high");
mkCard("芦笋带熟果：新鲜漂 23 天；干燥后 85 天，种子随后萌发。", "an asparagus plant with ripe berries floated for 23 days, when dried it floated for 85 days, and the seeds afterwards germinated", { 对象: "芦笋", 新鲜: "23", 干燥: "85", 萌发: "是" }, "medium");
mkCard("Helosciadium 熟种：2 天沉；干燥后漂浮 >90 天，随后萌发。", "the ripe seeds of Helosciadium sank in two days, when dried they floated for above 90 days, and afterwards germinated", { 对象: "Helosciadium", 新鲜: "2", 干燥: ">90", 萌发: "是" }, "medium");
const cInfer = mkCard("作者据稀少事实推断：约 14/100 植物种子可经海流漂 28 天并保持萌发力（推断，非测量）。", "plants belonging to one country might be floated across 924 miles of sea to another country", { 类型: "作者推断", 比例: "14/100" }, "high");
const cMartens = mkCard("马滕斯在真实海水实测：98 粒中 18 粒漂浮 42 天且仍能萌发（干湿交替）。", "of his seeds floated for 42 days, and were then capable of germination", { 对象: "马滕斯实测", 比例: "18/98", 天: "42" }, "high");
const cCaveat = mkCard("作者自述：暴露于海浪者漂浮时间应短于静水实验 → 传播估计或需下修。", "plants exposed to the waves would float for a less time than those protected from violent movement", { 类型: "作者修正意见", 方向: "下修" }, "high");
mkCard("鸽嗉囊中的种子在人工海水漂浮 30 天，取出后几乎全部萌发。", "some taken out of the crop of a pigeon, which had floated on artificial salt-water for 30 days, to my surprise nearly all germinated", { 对象: "鸽嗉囊种子", 天: "30" }, "medium");
const proto = createProtocol(s, { topicId, name: "海水浸泡萌发试验（干燥 vs 新鲜）", sourceKind: "user", purpose: "比较新鲜与干燥茎枝/果实在海水中的漂浮时长与浸后萌发", criteria: "记录漂浮天数（新鲜 vs 干燥）与浸后是否萌发；未量化条件明示未知", unknowns: ["海水盐度未写明", "温度未写明", "浸泡容器未写明"], steps: [
  { id: "s1", op: "采集 94 种带熟果的茎枝与果实", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "" },
  { id: "s2", op: "干燥部分茎枝（保留新鲜组作对照）", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "" },
  { id: "s3", op: "置于海水浸泡并计时", params: {}, note: "盐度/温度原文未写明", durationMin: null, estimated: false, branch: null, observeEnd: "" },
  { id: "s4", op: "取出后种植并观察萌发", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "记录是否萌发" },
] }); s = proto.state;
const exec = startExecution(s, { topicId, protocolId: proto.protocol.id }); s = exec.state;
s = updatePreparation(s, exec.execution.id, { adjustments: [{ stepId: "s3", field: "note", after: "海水（盐度/温度未写明）", reason: "原文未量化，明示缺项，不补造" }], notes: "浸泡条件缺量化；计时口径：新鲜 vs 干燥对照。" }).state;
s = confirmPreparation(s, exec.execution.id).state;
s = appendEvent(s, exec.execution.id, { kind: "start", text: "实际开始：干燥茎枝与对照置于海水", backfilled: true }).state;
s = appendEvent(s, exec.execution.id, { kind: "step", stepId: "s3", text: "浸泡计时开始（记录漂浮天数）", backfilled: true }).state;
s = appendEvent(s, exec.execution.id, { kind: "note", text: "缺项：海水盐度/温度未写明；容器未写明。" }).state;
const sample = createSample(s, { topicId, executionId: exec.execution.id, shortName: "SEA-94", amount: { value: "94", unit: "plants" } }); s = sample.state;
const mHazel = addMeasurement(s, { topicId, sampleId: sample.sample.id, sampleStateRevision: 1, value: "90", unit: "days", method: "干燥后浸泡-种植", note: "榛子（干燥）漂浮天数" }); s = mHazel.state;
s = addMeasurement(s, { topicId, sampleId: sample.sample.id, sampleStateRevision: 1, value: "85", unit: "days", method: "干燥后浸泡-种植", note: "芦笋（干燥）漂浮天数" }).state;
s = importMeasurements(s, { name: "darwin-flotation.csv", csv: FLOAT_CSV, topicId }).state;
s = importMeasurements(s, { name: "darwin-dispersal-estimates.csv", csv: DISP_CSV, topicId }).state;
const tableId = s.tables[0].id;
const task = createAnalysisTask(s, { topicId, subquestionId: s.subquestions[0].id, title: "传播量级与漂浮时长（干燥 vs 新鲜）", core: [{ kind: "table", id: tableId }, { kind: "measurement", id: mHazel.measurement.id }], optional: [{ kind: "card", id: cInfer }, { kind: "card", id: cMartens }, { kind: "card", id: cCaveat }] }); s = task.state;
const csv = archiveResultFile(s, { name: "flotation-summary.csv", content: "group,float_days\nfresh,多数数日内下沉\ndried,榛子90; 芦笋23->85; Helosciadium 2->>90", topicId }); s = csv.state;
const res = submitResult(s, task.task.id, { method: "表格统计（按新鲜/干燥分组）", params: "分组口径见所附 CSV；浸泡天数取原文陈述", assetIds: [csv.asset.id], note: "逐物件漂浮与萌发事实汇总" }); s = res.state;
const report = createReport(s, { topicId, taskId: task.task.id }); s = report.state;
const rid = report.report.id;
const b = [
  { nature: "observation" as const, text: "干燥显著延长漂浮时长：榛子 0→90 天、芦笋 23→85 天、Helosciadium 2→>90 天（浸后均萌发）。", refs: [{ kind: "result" as const, id: res.result.id, version: "rev 1", label: "表格统计" }] },
  { nature: "observation" as const, text: "94 株干燥植物中 18 株漂浮 >28 天；作者据此推断约 14/100 植物种子可经海流漂 28 天并保持萌发。", refs: [{ kind: "card" as const, id: cInfer, version: "核对", label: "证据卡·作者推断" }] },
  { nature: "human_judgment" as const, text: "据此，海流可为部分跨海传播提供可行途径（人工判断，非测量结论）。", refs: [{ kind: "result" as const, id: res.result.id, version: "rev 1", label: "表格统计" }] },
  { nature: "to_verify" as const, text: "反证与修正：马滕斯实测 18/98 漂 42 天可萌发；作者自述海浪条件下漂浮应更短 → 传播估计或需下修，本解释待复核。", refs: [{ kind: "card" as const, id: cMartens, version: "核对", label: "证据卡·马滕斯实测" }, { kind: "card" as const, id: cCaveat, version: "核对", label: "证据卡·作者修正意见" }] },
];
s = applyReportEdit(s, rid, { baseRevision: 1, blocks: b, reason: "首稿：观察/判断/待复核分列" }).state;
const cur = s.reports[0].blocks;
const edited = [
  { id: cur[3].id, nature: "to_verify" as const, text: cur[3].text, refs: cur[3].refs },
  { id: cur[0].id, nature: "observation" as const, text: cur[0].text + "（复核：天数为原文陈述，非本次实测）", refs: cur[0].refs },
  { id: cur[1].id, nature: "observation" as const, text: cur[1].text, refs: cur[1].refs },
  { id: cur[2].id, nature: "human_judgment" as const, text: cur[2].text, refs: cur[2].refs },
];
s = applyReportEdit(s, rid, { baseRevision: 2, blocks: edited, reason: "新证据（马滕斯/海浪条件）→ 复核：待验证提前并加注" }).state;

await new JsonFileStore(OUT).save(s);
writeFileSync(OUT, JSON.stringify(s, null, 2), "utf8");
console.log(`达尔文验收数据已生成 → ${OUT}`);
console.log(`启动：PORT=5184 LOCUS_DATA=${OUT} node server.ts，打开 http://127.0.0.1:5184/`);
