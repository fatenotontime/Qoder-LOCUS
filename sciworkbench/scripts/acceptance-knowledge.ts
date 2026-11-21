/**
 * E3 分项人审的浏览器验收种子：全合成材料，不读真实课题、不联网、不需要 Key。
 * 用法：node scripts/acceptance-knowledge.ts [数据文件] [--force]
 * 然后：PORT=<空闲端口> LOCUS_DATA=<该文件> LOCUS_AI_CONFIG=<隔离配置> node server.ts
 *
 * 产出：1 个课题 + 1 篇合成文献（附件即原件）
 *   - 卡 A：已显式结构化的知识壳（1 条引文 + 1 个含两条件的条件对象 + 2 个分项：一个 claim、一个待验证问题）
 *   - 卡 B：普通旧卡（用于验证「按需结构化」入口）
 * 全部对象初始为待审：验收要人工逐项确认，种子不预先给出任何已确认结论。
 */
import { JsonFileStore, emptyState } from "../store.ts";
import { createTopic, addManualCard } from "../services/app.ts";
import { createPaper, addPaperAttachment } from "../services/papers.ts";
import { structureLegacyCard } from "../services/knowledge-base.ts";

const OUT = process.argv[2] ?? "data/acceptance-knowledge.json";
const force = process.argv.includes("--force");

const store = new JsonFileStore(OUT);
let state = force ? emptyState() : await store.load();
if (state.topics.length > 0 && !force) {
  console.log(`验收数据已有内容（${OUT}），不覆盖。确需重建请加 --force（只影响该验收文件）。`);
  process.exit(0);
}
state = emptyState();

// 合成原件：短句、含两处条件与一处「未报告」，便于验证逐字定位与缺失显示。
// 同一句原文故意出现两次 → 引文默认「多处命中」，验收需人工选定正确偏移才能定为已定位（fail-closed）。
const TEXT = [
  "（合成材料，仅供界面验收，非真实文献）",
  "",
  "# 响应时间测试",
  "",
  "在 25 °C、pH 7.0 缓冲液中，石墨烯电极对底物的响应时间为 0.8 s（平均值，标准差 0.02，n=3）。",
  "搅拌速度未记录。同一电极在 pH 5.5 下的响应时间未在本材料中报告。",
  "",
  "# 小结",
  "",
  "复述结论：石墨烯电极对底物的响应时间为 0.8 s，另有摘要表同样写出 石墨烯电极对底物的响应时间为 0.8 s。",
].join("\n");

const topic = createTopic(state, {
  name: "合成验收：石墨烯电极响应时间",
  researchQuestion: "温度与 pH 如何影响石墨烯电极的响应时间？现有材料能支撑到什么程度？",
});
state = topic.state;

const paper = createPaper(state, {
  title: "合成示例：石墨烯电极响应时间（验收用）",
  authors: "LOCUS 验收合成", year: "2026", doi: "", source: "synthetic", license: "public",
  topicIds: [topic.topic.id], note: "全合成文本，不含真实文献内容。",
});
state = paper.state;

const att = addPaperAttachment(state, { paperId: paper.paper.id, name: "synthetic-electrode.md", text: TEXT, role: "fulltext" });
state = att.state;
const assetId = att.assetId;

const QUOTE = "石墨烯电极对底物的响应时间为 0.8 s";
const cardA = addManualCard(state, {
  assetId,
  rawText: "在 25 °C、pH 7.0 下响应时间 0.8 s（SD 0.02，n=3）。",
  sectionQuote: QUOTE,
});
state = cardA.state;

const structured = structureLegacyCard(state, cardA.card.id, {
  baseRevision: cardA.card.revision,
  // 引文锚在合成原件（正文）而不是卡片摘要：验收要能「看原文」并逐字回查；只给 {kind,id}，版本由服务端锚定。
  evidence: [{ localId: "e1", sourceRef: { kind: "asset", id: assetId }, quote: QUOTE }],
  contexts: [{
    localId: "c1",
    subject: "石墨烯电极响应时间",
    conditions: [
      { id: "kcn_1", field: { raw: "温度" }, value: { kind: "scalar", raw: "25 °C", value: "25", unit: "°C" }, appliesTo: { subject: "电极", stage: "测量" }, evidenceRefs: [{ kind: "evidence", localId: "e1" }], obtainedBy: "source_explicit" },
      { id: "kcn_2", field: { raw: "缓冲液 pH" }, value: { kind: "scalar", raw: "pH 7.0", value: "7.0", unit: "1" }, appliesTo: { subject: "电极", stage: "测量" }, evidenceRefs: [{ kind: "evidence", localId: "e1" }], obtainedBy: "source_explicit" },
    ],
    unknowns: [{ id: "ku1", fieldPath: "conditions", reasonCode: "not_measured", detail: "搅拌速度未记录", scopeRefs: [], evidenceRefs: [] }],
    topicIds: [topic.topic.id],
  }],
  items: [
    {
      localId: "i1",
      contentType: "claim", nature: "observation",
      text: "25 °C、pH 7.0 下响应时间 0.8 s（平均值，SD 0.02，n=3）。",
      subject: { raw: "石墨烯电极" }, predicate: { raw: "响应时间" },
      value: { kind: "summary", raw: "0.8 s（SD 0.02）", statistic: "平均值", value: "0.8", unit: "s", uncertainty: { type: "SD", value: "0.02" }, sampleSize: 3 },
      evidenceRefs: [{ localId: "e1" }],
      contextRefs: [{ kind: "context", localId: "c1" }],
      topicIds: [topic.topic.id],
    },
    {
      localId: "i2",
      contentType: "question", nature: "to_verify",
      text: "pH 5.5 下的响应时间未在本材料中报告，需要另做测量或找到原始记录。",
      subject: { raw: "石墨烯电极" }, predicate: { raw: "响应时间" },
      value: { kind: "missing", raw: "未报告", reasonCode: "not_reported_in_checked_scope" },
      unknowns: [{ id: "ku2", fieldPath: "value", reasonCode: "not_reported_in_checked_scope", detail: "所选材料只覆盖 pH 7.0", scopeRefs: [], evidenceRefs: [] }],
      evidenceRefs: [],
      contextRefs: [],
      topicIds: [topic.topic.id],
    },
  ],
});
state = structured.state;

// 旧卡 B：不结构化，留给界面上的「按需结构化」入口。
const cardB = addManualCard(state, {
  assetId,
  rawText: "搅拌速度未记录，可能影响结果可比性。",
  sectionQuote: "搅拌速度未记录。",
});
state = cardB.state;

await store.save(state);

const items = state.knowledge?.items ?? [];
const contexts = state.knowledge?.contexts ?? [];
console.log(`已生成 E3 验收数据：${OUT}`);
console.log(`课题 ${topic.topic.id} · 文献 ${paper.paper.id} · 原件 ${assetId}`);
console.log(`知识壳卡 ${cardA.card.id}：分项 ${items.length} 项（全部待审）· 条件对象 ${contexts.length} 个（含 ${(contexts[0]?.payload?.conditions ?? []).length} 条条件）`);
console.log(`旧卡 ${cardB.card.id}：未结构化（演示「结构化」入口）`);
console.log("启动：env -u LOCUS_AI_BASE_URL -u LOCUS_AI_MODEL -u LOCUS_AI_KEY PORT=<空闲端口> LOCUS_DATA=" + OUT + " node server.ts");
