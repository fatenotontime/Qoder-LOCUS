// F7 前端评审视觉验收种子（合成数据，不调用真实模型）。
// 用法：node scripts/seed-acceptance-f7.ts [数据文件]   （默认 data/f7-acceptance.json）
// 然后：PORT=<端口> LOCUS_DATA=<文件> node server.ts，浏览器打开 http://127.0.0.1:<端口>/
//
// 说明：本数据为**合成演示**，仅为让每一页都有内容可看；不含任何私人/内部材料，不调模型。
// 生成的数据文件位于 sciworkbench/data/（已在 .gitignore 内，不入库）；本脚本可入库。
import { emptyState, JsonFileStore } from "../store.ts";
import { createTopic, createSubquestion, addManualCard, reviewCard, importMeasurements, createMapping } from "../services/app.ts";
import { createPaper, addPaperAttachment } from "../services/papers.ts";
import { createProtocol, editProtocol, startExecution, updatePreparation, confirmPreparation, appendEvent, completeExecution, createSample, addSampleState, addMeasurement } from "../services/experiment.ts";
import { createChat } from "../services/analysis.ts";

const OUT = process.argv[2] ?? "data/f7-acceptance.json";
const now = () => new Date().toISOString();

let s = emptyState();

// ── 课题 + 子问题 ──
s = createTopic(s, { name: "漆酶动力学与木质素降解（合成验收）", researchQuestion: "pH 与温度如何影响漆酶对木质素的降解速率？" }).state;
const topicId = s.topics[0].id;
const subqs = [
  { question: "不同 pH 下的反应速率常数 k 差异有多大？", kind: "declared" as const },
  { question: "温度升高是否单调加快降解，还是存在最适点？", kind: "declared" as const },
  { question: "介质离子强度的影响能否推广到真实废水？", kind: "exploratory" as const },
];
for (const q of subqs) s = createSubquestion(s, { topicId, ...q }).state;

// ── 文献：两篇带附件、一篇无附件 ──
const paperA = createPaper(s, { title: "漆酶催化木质素模型物氧化的动力学研究", authors: ["Zhang, W.", "刘敏"], year: "2021", doi: "10.1000/lac.2021.001", source: "J. Mol. Catal.", license: "CC BY 4.0", topicIds: [topicId], note: "合成演示条目。" }); s = paperA.state;
const textA = [
  "# 研究方法",
  "",
  "以 2,2'-联氮-双(3-乙基苯并噻唑啉-6-磺酸)（ABTS）为底物，在 420 nm 测定吸光变化。",
  "",
  "## 条件",
  "- pH：3.0 / 4.0 / 5.0（柠檬酸-磷酸氢二钠缓冲液）",
  "- 温度：25 / 35 / 45 °C",
  "- 酶浓度：0.05 mg/mL",
  "",
  "## 步骤",
  "1. 配缓冲液并预热至设定温度。",
  "2. 加入底物与酶，立即开始记录。",
  "3. 以初始速率拟合米氏参数。",
].join("\n");
const attA = addPaperAttachment(s, { paperId: paperA.paper.id, name: "laccase-kinetics-methods.md", text: textA, role: "fulltext", version: "v1" }); s = attA.state;

const paperB = createPaper(s, { title: "白腐真菌漆酶降解木质素的综述", authors: ["Martinez, A. T.", "Speranza, M."], year: "2018", source: "Enzyme Microb. Technol.", license: "CC BY 4.0", topicIds: [topicId], note: "合成演示条目。" }); s = paperB.state;
const attB = addPaperAttachment(s, { paperId: paperB.paper.id, name: "review-main.md", text: "# 综述正文（合成）\n\n漆酶氧化酚类底物，介体可扩展底物范围……", role: "fulltext", version: "v1" }); s = attB.state;
s = addPaperAttachment(s, { paperId: paperB.paper.id, name: "review-supp.md", text: "补充材料（合成）：介体 ABTS 与 HBT 的比较表。", role: "supplement", version: "v1" }).state;

s = createPaper(s, { title: "仅题录无附件的条目（用于看“无附件”状态）", authors: ["Anonymous"], year: "2019", source: "预印本", topicIds: [topicId], note: "合成演示：此条目不导入附件，文献管理里应显示“无附件”。" }).state;

// 再补一批合成文献，使文献管理列表可滚动（含带附件与不带附件两类）。
for (let i = 1; i <= 9; i++) {
  const pp = createPaper(s, { title: `合成文献 #${i}：漆酶介体体系研究 ${i}`, authors: [`Author ${i}`, "合作者"], year: String(2010 + i), source: i % 2 ? "J. Synth." : "预印本", topicIds: [topicId], note: "合成演示条目。" }); s = pp.state;
  if (i % 3 === 0) {
    s = addPaperAttachment(s, { paperId: pp.paper.id, name: `synth-${i}-body.md`, text: `# 合成正文 ${i}\n\n第 ${i} 篇合成文献的正文，用于占位与列表滚动演示。`, role: "fulltext", version: "v1" }).state;
  }
}

// ── 知识卡（供知识审阅流程有内容）──
const mkCard = (rawText: string, quote: string, fields: Record<string, string>, audit: "confirm" | "unreviewed") => {
  const r = addManualCard(s, { assetId: attA.assetId, rawText, sectionQuote: quote, fields, conditions: ["pH 4.0"], unknowns: [] }); s = r.state;
  if (audit === "confirm") s = reviewCard(s, r.card.id, { audit: "confirm", importance: "high", reason: "人工核对原文" });
  return r.card.id;
};
mkCard("pH 4.0 下初始速率最高（合成数据）。", "以初始速率拟合米氏参数。", { 对象: "ABTS", pH: "4.0", 相对速率: "1.00" }, "confirm");
mkCard("温度 45 °C 时酶开始部分失活（合成数据）。", "温度：25 / 35 / 45 °C", { 对象: "ABTS", 温度: "45", 现象: "部分失活" }, "unreviewed");
mkCard("离子强度升高使表观速率略降（合成数据，待复核）。", "酶浓度：0.05 mg/mL", { 对象: "ABTS", 变量: "离子强度", 方向: "下降" }, "unreviewed");

s = createMapping(s, { original: "initial rate", mapped: "初始速率 v0", basis: "原文方法段落定义", topicId }).state;

// ── 方案：多版本 ──
const stepsV1 = [
  { id: "s1", op: "配制柠檬酸-磷酸缓冲液（pH 3–5）", params: {}, note: "", durationMin: 20, estimated: false, branch: null, observeEnd: "" },
  { id: "s2", op: "预热底物至设定温度", params: {}, note: "", durationMin: 15, estimated: false, branch: null, observeEnd: "" },
  { id: "s3", op: "加入漆酶并开始计时记录", params: {}, note: "", durationMin: 30, estimated: true, branch: null, observeEnd: "记录初始速率" },
];
const proto = createProtocol(s, { topicId, name: "漆酶动力学测定流程（合成）", sourceKind: "user", purpose: "测定 pH 与温度对初始速率的影响", criteria: "三次重复 RSD < 5%", unknowns: ["介体是否加注未定"], steps: stepsV1 }); s = proto.state;
const protoId = proto.protocol.id;
s = editProtocol(s, protoId, { steps: [stepsV1[0], stepsV1[1], stepsV1[2], { id: "s4", op: "设置对照（无酶）", params: {}, note: "新增对照步骤", durationMin: 30, estimated: false, branch: "对照支路", observeEnd: "" }], reason: "补充无酶对照步骤" }).state; // → 第2版

// ── 执行：一次已完成（有步骤记录/样品/测量）、一次进行中 ──
const exec1 = startExecution(s, { topicId, protocolId: protoId }); s = exec1.state;
s = confirmPreparation(s, exec1.execution.id).state;
s = appendEvent(s, exec1.execution.id, { kind: "start", text: "开始实验", backfilled: false }).state;
s = appendEvent(s, exec1.execution.id, { kind: "step", stepId: "s1", text: "配制缓冲液", actual: { durationMin: 22 } }).state;
s = appendEvent(s, exec1.execution.id, { kind: "step", stepId: "s2", text: "预热底物", actual: { durationMin: 15 } }).state;
s = appendEvent(s, exec1.execution.id, { kind: "deviation", stepId: "s3", text: "意外：加入酶后温度波动 2 °C" }).state;
const smp1 = createSample(s, { topicId, executionId: exec1.execution.id, shortName: "S1", displayName: "pH4-25C", amount: { value: "10", unit: "mL" }, handling: "标准条件", use: "动力学测定" }); s = smp1.state;
s = addSampleState(s, smp1.sample.id, { amount: { value: "5", unit: "mL" }, handling: "分样", use: "重复测定" }).state;
const sampleId1 = smp1.sample.id;
s = addMeasurement(s, { topicId, sampleId: sampleId1, sampleStateRevision: 1, value: "0.82", unit: "s^-1", method: "初始速率拟合", note: "pH 4.0 / 25 °C（合成）" }).state;
s = addMeasurement(s, { topicId, sampleId: sampleId1, sampleStateRevision: 1, value: "0.79", unit: "s^-1", method: "初始速率拟合", note: "重复（合成）" }).state;
s = completeExecution(s, exec1.execution.id).state;

const exec2 = startExecution(s, { topicId, protocolId: protoId }); s = exec2.state;
s = confirmPreparation(s, exec2.execution.id).state;
s = appendEvent(s, exec2.execution.id, { kind: "start", text: "开始实验（进行中）", backfilled: false }).state;
s = appendEvent(s, exec2.execution.id, { kind: "step", stepId: "s1", text: "配制缓冲液", actual: { durationMin: 20 } }).state;
const smp2 = createSample(s, { topicId, executionId: exec2.execution.id, shortName: "S2", displayName: "pH5-45C", amount: { value: "10", unit: "mL" }, handling: "高温条件", use: "动力学测定" }); s = smp2.state;
s = addMeasurement(s, { topicId, sampleId: smp2.sample.id, sampleStateRevision: 1, value: "0.41", unit: "s^-1", method: "初始速率拟合", note: "pH 5.0 / 45 °C（合成，部分失活）" }).state;

// ── 数据表 ──
const CSV = [
  "sample,pH,temp,rate,unit",
  "S1,4,25,0.82,s^-1",
  "S1,4,35,0.95,s^-1",
  "S1,4,45,0.41,s^-1",
  "S2,5,25,0.55,s^-1",
  "S2,5,35,0.66,s^-1",
  "",
  "note,,,,",
  "以上为合成演示数据",
].join("\n");
s = importMeasurements(s, { name: "laccase-rates.csv", csv: CSV, topicId, origin: "user" }).state;

// ── 对话：一段长会话（32 条，合成，不调模型）+ 一段空会话 ──
const longChat = createChat(s, { topicId, subquestionId: s.subquestions[0].id, scope: [] }); s = longChat.state;
const longChatId = longChat.chat.id;
const messages = [];
for (let i = 0; i < 16; i++) {
  messages.push({ id: `msg_u_${i}`, role: "user", content: `第 ${i + 1} 问（合成）：pH ${3 + (i % 3)} 条件下速率变化的主要原因是什么？`, status: "done", proposals: [], sources: [], at: now() });
  messages.push({ id: `msg_a_${i}`, role: "assistant", content: `第 ${i + 1} 答（合成数据，未调用模型）：可能与酶活性中心的质子化状态及底物结合有关；参见《漆酶动力学》第 ${i % 3 + 1} 段。`, status: "done", proposals: [], sources: [`文献甲 · 第${i % 3 + 1}段`], at: now() });
}
s = { ...s, chats: s.chats.map((c) => (c.id === longChatId ? { ...c, messages } : c)) };

const emptyChat = createChat(s, { topicId, subquestionId: s.subquestions[2].id, scope: [] }); s = emptyChat.state; // 空会话（无消息）

await new JsonFileStore(OUT).save(s);
console.log(`F7 验收种子已生成 → ${OUT}`);
console.log(`课题 ${topicId} · 文献 ${s.papers.length}（附件 ${s.attachments.length}）· 方案 ${s.protocols.length} · 执行 ${s.executions.length} · 样品 ${s.samples.length} · 数据表 ${s.tables.length} · 会话 ${s.chats.length}`);
console.log(`启动：PORT=<端口> LOCUS_DATA=${OUT} node server.ts`);
