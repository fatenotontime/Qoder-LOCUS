// 由真实验收运行（acceptance-darwin）与达尔文种子包生成公开展示快照。
// 只读私有输入（sciworkbench/data、test-packages，均 gitignore），只写 locus-site/demo-data/。
// 无网络、无模型调用。运行：node locus-site/demo-data/tools/build-demo.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContextMap } from "../../../sciworkbench/services/context-map.ts";
import { buildNetwork } from "../../../sciworkbench/services/references.ts";
import { emptyKnowledge } from "../../../sciworkbench/domain/knowledge.ts";
import { buildReportDocx, buildTraceabilityPackage } from "../../../sciworkbench/services/export.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..");                 // locus-site/demo-data
const ROOT = resolve(HERE, "../../..");          // 仓库根
// 私有输入默认在仓库根；可用环境变量指向只读的外部副本（并行 worktree 内无私有输入时）。
const SEED = process.env.LOCUS_SEED_DIR || join(ROOT, "test-packages/darwin-seed-saltwater");
const ACC_OVERRIDE = process.env.LOCUS_ACCEPTANCE_INPUT || "";
const ACC = ACC_OVERRIDE ? resolve(ACC_OVERRIDE) : join(ROOT, "sciworkbench/data/acceptance-darwin.json");
const REPORT_DOCX = join(OUT, "snapshot/exports/report.docx");
const REPORT_TRACE = join(OUT, "snapshot/exports/traceability.zip");
const SOURCE_COMMIT = "8120986";
const FIXTURE_VERSION = "s08-a-fixture-1";
const SCHEMA_VERSION = 1;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const jwrite = (p, obj) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8"); };
const clone = (x) => structuredClone(x);

const acc = readJson(ACC);
const byId = (arr, id) => { const x = arr.find((y) => y.id === id); if (!x) throw new Error(`缺少对象 ${id}`); return x; };

const TOPIC = "topic_f6bff443-3f74-4677-810d-0c15c7d06bf0";
const PROTO = "proto_2b4f1e2f-92f4-4503-99d0-0990a3fd907e";
const EXEC = "exec_8eddd772-b298-42eb-b8b6-6f114bd27b3f";
const TASK = "atask_9cf2587e-9818-447d-9f63-9111eb090fa8";
const REPORT = "rep_f69e24f7-e4d7-4097-ab26-0ff74e165170";
const CARD_CONFIRM = [
  "card_8a4e4db2-5ada-42f8-a1fd-6fbcff8a4ae7", // 榛子
  "card_cfa623de-2b0f-44b8-8096-5ae1a3b7d8ae", // 芦笋
  "card_a24884fb-3af2-4b41-b094-28e0937aa72d", // Helosciadium
  "card_cfa0372e-18bb-4aa2-9606-8a140780c598", // 作者推断 14/100
  "card_7012e88a-b06a-4b57-8d00-ba0bdbae1386", // 马滕斯 18/98
  "card_a56d5514-401c-44a5-a19e-3006ddcec46a", // 作者修正意见
  "card_5e9e8544-e19e-4584-8eec-07844d961dc7", // 鸽嗉囊
  "card_b2405e44-467f-46d7-ada5-a31b7c2fa3a1", // 94 株总述(ai 抽取,已核对)
];
const CARD_UNREVIEWED = [
  "card_709a3cb3-589b-4e54-bf52-38b080eaa180", // 马滕斯装置(ai 待审)
  "card_8abc19d0-2813-4d0e-a0b0-87ab2fff76c7", // 马滕斯方法偏倚(ai 待审)
];
const CARD_IDS = [...CARD_CONFIRM, ...CARD_UNREVIEWED];

// ── 1. 整理 state（复用真实对象；剔除占位/无结果/失败影响等与公开案例无关项）──
const proto = clone(byId(acc.protocols, PROTO));
proto.revisions = [proto.revisions[0]];     // 丢弃 reason="111" 的占位 r2
proto.revision = 1;
proto.updatedAt = proto.revisions[0].at;

const state = {
  version: acc.version,
  topics: clone(acc.topics),
  subquestions: clone(acc.subquestions),
  assets: clone(acc.assets),
  papers: clone(acc.papers),
  attachments: clone(acc.attachments),
  cards: clone(CARD_IDS.map((id) => byId(acc.cards, id))),
  tables: clone(acc.tables),
  adoptions: [], mappings: [], comparisons: [], templates: [],
  protocols: [proto],
  executions: [clone(byId(acc.executions, EXEC))],
  samples: clone(acc.samples),
  measurements: clone(acc.measurements),
  impacts: [], ocrs: [],
  analysisTasks: [clone(byId(acc.analysisTasks, TASK))],  // 丢弃空标题 "555" 任务
  analysisResults: clone(acc.analysisResults),
  reports: clone(acc.reports),
  chats: clone(acc.chats),
  knowledge: emptyKnowledge(),
};

// 断言关键引用不悬空
const ids = (arr) => new Set(arr.map((x) => x.id));
const has = (arr, id) => ids(arr).has(id);
const errs = [];
if (!has(state.topics, TOPIC)) errs.push("topic");
for (const c of state.cards) { if (!has(state.assets, c.assetId)) errs.push(`card ${c.id} asset`); if (c.paperId && !has(state.papers, c.paperId)) errs.push(`card ${c.id} paper`); }
for (const t of state.tables) if (!has(state.assets, t.assetId)) errs.push(`table ${t.id} asset`);
for (const m of state.measurements) if (!has(state.samples, m.sampleId)) errs.push(`meas ${m.id} sample`);
for (const s of state.samples) if (!has(state.executions, s.executionId)) errs.push(`sample ${s.id} exec`);
const task = state.analysisTasks[0];
for (const r of [...task.core, ...task.optional.map((o) => o.ref)]) {
  const arr = { table: state.tables, measurement: state.measurements, card: state.cards }[r.kind];
  if (!arr || !has(arr, r.id)) errs.push(`task ref ${r.kind}:${r.id}`);
}
for (const r of state.analysisResults) if (!has(state.analysisResults, r.id) === false) {}
for (const b of state.reports[0].blocks) for (const ref of b.refs) {
  const arr = { card: state.cards, result: state.analysisResults }[ref.kind];
  if (!arr || !has(arr, ref.id)) errs.push(`report ref ${ref.kind}:${ref.id}`);
}
if (errs.length) throw new Error("引用悬空：\n" + errs.join("\n"));

// ── 2. 落原件 + 计算 SHA-256 ──
rmSync(join(OUT, "originals"), { recursive: true, force: true });
const originals = [];
const writeOriginal = (rel, buf, license, redistributable, extra = {}) => {
  const p = join(OUT, "originals", rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  originals.push({ path: `originals/${rel}`, bytes: buf.length, sha256: sha256(buf), license, redistributable, ...extra });
};
for (const a of state.assets) {
  const rel = a.kind === "literature" ? `origin-1859-p371-373.md` : `data/${a.name}`;
  const buf = Buffer.from(a.text, "utf8");
  if (sha256(buf) !== a.hash) throw new Error(`资产 hash 不符：${a.name}`);
  writeOriginal(rel, buf, "Public Domain", true, { assetId: a.id, kind: a.kind });
}
for (const page of ["369", "370", "371", "372", "373"]) {
  const src = join(SEED, "sources", `page-${page}.wiki`);
  if (existsSync(src)) writeOriginal(`sources/page-${page}.wiki`, readFileSync(src), "Public Domain", true, { djvuIndexPage: Number(page) });
}

// ── 3. 上下文地图（真实生成）──
const mapTask = buildContextMap(state, { topicId: TOPIC, taskId: TASK });
const mapPre = buildContextMap(state, {
  topicId: TOPIC,
  subquestionId: state.subquestions[0].id,
  pick: [{ kind: "table", id: state.tables[0].id }, { kind: "measurement", id: state.measurements[0].id }],
});
jwrite(join(OUT, "snapshot/context-map.json"), {
  note: "上下文地图由 buildContextMap(state) 真实生成（非手绘）。mapTask=分析任务现有选择；mapPre=建任务前按 pick 推导。",
  mapTask, mapPre,
});

// ── 4. 引用索引（buildNetwork 真实生成）──
const net = buildNetwork(state);
const references = {
  note: "引用网络由 buildNetwork(state) 真实生成；节点/边来自对象间真实引用，不补造。",
  nodes: [...net.nodes.values()],
  edges: net.edges,
};
jwrite(join(OUT, "snapshot/references.json"), references);

// ── 5. 知识条目与比较 ──
const fulltext = state.assets.find((a) => a.kind === "literature").text;
const locatorStatus = (quote) => {
  if (!quote) return { status: "insufficient", reason: "引文为空（定位不足）" };
  const idx = fulltext.indexOf(quote);
  if (idx < 0) return { status: "insufficient", reason: "引文未在原件中逐字匹配" };
  const after = fulltext[idx + quote.length] || " ";
  const truncated = /[A-Za-z]$/.test(quote) && /[A-Za-z]/.test(after);
  return truncated ? { status: "insufficient", reason: "引文在词中间被截断（定位不足）" } : { status: "confirmed", reason: "逐字匹配" };
};
const knowledgeItems = state.cards.map((c) => {
  const loc = locatorStatus(c.locator?.sectionQuote);
  return {
    id: `kitem_${c.id.replace(/^card_/, "")}`,
    cardId: c.id,
    version: c.revision,
    audit: c.audit,
    extraction: c.extraction,
    fields: c.extracted?.fields ?? {},
    units: c.extracted?.units ?? [],
    conditions: c.extracted?.conditions ?? [],
    unknowns: c.unknowns ?? [],
    locator: { quote: c.locator?.sectionQuote ?? "", ...loc },
    sourceRefs: [
      { kind: "card", id: c.id, revision: c.revision },
      { kind: "asset", id: c.assetId },
    ],
  };
});

const comparison = {
  id: "cmp_darwin_vs_martens",
  title: "静水实验 vs 真实海水（干湿交替）：漂浮时长与浸后萌发",
  kind: "cross_source",
  independenceStatus: "未具备（同页转引，非独立两篇文献）",
  independenceNote: "两项数据均出自达尔文 1859 第十一章同一页（书页 360 / 扫描索引页 372）；马滕斯试验由达尔文转引（二手）。材料仅此一份，无法构成独立两篇文献的跨文献比较，故标「未具备」而不另凑来源。",
  sides: [
    {
      label: "达尔文·静水实验",
      refs: [{ kind: "card", id: "card_cfa0372e-18bb-4aa2-9606-8a140780c598", revision: 2 }],
      metric: "干燥种子可漂浮并跨海距离的估计",
      value: "约 14/100 植物种子可漂 28 天 / 924 英里",
      conditions: "干燥处理；静水（sea water，容器/盐度/温度未写明）",
      secondaryCitation: false,
    },
    {
      label: "马滕斯·真实海水",
      refs: [{ kind: "card", id: "card_7012e88a-b06a-4b57-8d00-ba0bdbae1386", revision: 2 }],
      metric: "漂浮天数与浸后可萌发能力",
      value: "18/98 粒漂 42 天且仍能萌发",
      conditions: "盒子置于真实海水中、干湿交替；未预先干燥；偏选大型果与近海植物",
      secondaryCitation: true,
    },
  ],
  commonMetric: ["漂浮时长（天）", "浸后萌发能力（可/否）"],
  conditionDiff: [
    "介质：静水 vs 真实海水（波浪、干湿交替）",
    "预处理：达尔文组预先干燥；马滕斯组未预先干燥",
    "样本：植物/枝条（94 株）vs 种子（98 粒，多数物种不同）",
    "选材偏倚：马滕斯偏选大型果与近海植物（利于延长漂浮与耐盐）",
  ],
  units: { duration: "天", ratio: "n/N（计数比）", distance: "英里（Darwin 原文平均洋流速度 33 英里/日）" },
  unknownFields: [
    "海水盐度（两组均未写明）",
    "温度（两组均未写明）",
    "浸泡容器体积/材质（达尔文组未写明）",
    "马滕斯句中参与计数的种子总数原文缺字（'of his seeds floated for 42 days'）",
  ],
  caveat: "作者自述：暴露于海浪者漂浮时间应短于静水实验 → 静水估计可能需下修。两结果不可直接合并统计。",
};
jwrite(join(OUT, "snapshot/knowledge.json"), {
  note: "知识条目由 state.cards 派生（同源），保留原始字段/单位/条件/未知项与定位状态；比较项为跨来源比较，独立性不足已如实标注。",
  items: knowledgeItems,
  comparisons: [comparison],
});

// ── 6. AI 预生成/模拟/未完成登记 ──
const aiProducts = {
  modelRunThisSession: false,
  modelRunReason: "真实模型未授权（P8/D2：/api/ai/status configured=false）。本轮未调用任何模型；以下为历史产物标注，不冒充本轮真实运行。",
  items: [
    { id: "ai_lit_extract_cards", kind: "literature_extract", label: "unverified", model: null, contextRef: { assetId: "ast_907d8227-cbc3-45ba-8e2e-dd8a7d286c28" }, objectRefs: ["card_b2405e44-467f-46d7-ada5-a31b7c2fa3a1", "card_709a3cb3-589b-4e54-bf52-38b080eaa180", "card_8abc19d0-2813-4d0e-a0b0-87ab2fff76c7"], reviewStatus: "混合：1 张已人工核对，2 张待审", note: "历史 AI 抽取卡（extraction=ai）；模型与授权路径未核实，按未核实标注。" },
    { id: "ai_protocol_parse", kind: "protocol_parse", label: "unverified", model: null, contextRef: { assetId: "ast_907d8227-cbc3-45ba-8e2e-dd8a7d286c28" }, objectRefs: [PROTO], reviewStatus: "已人工确认（revision 1）", note: "方案为文献重构，来源与条件未知项已明示；解析模型未核实。" },
    { id: "ai_context_chat", kind: "context_chat", label: "unverified", model: "mimo-v2.6-flash", contextRef: { hash: "c311daf7b4985c582b9d3c7e996aed6fc7e26bf19b8a1d7703fb9a511aa95458" }, objectRefs: [state.chats[0].id], reviewStatus: "历史问候未复核；展示补录段为人工整理", note: "历史对话记录（模型名取自记录，未复核）；开头问候为历史记录，随后两轮科研问答为展示人工整理补录（model=null，非模型生成），见 state.chats[0].displayNote。" },
    { id: "ai_impact", kind: "impact_assess", label: "incomplete", model: null, contextRef: { executionId: EXEC }, objectRefs: [], reviewStatus: "未完成", note: "原验收记录为「AI 未配置」失败（status=failed），语义影响未分析；未作为正式结论纳入快照。" },
    { id: "cur_next_steps", kind: "next_step_guidance", label: "curated", model: null, contextRef: { taskId: TASK }, objectRefs: [], reviewStatus: "人工整理（非模型调用）", note: "下一步方向由人工依据证据分歧整理，供展示；非模型生成。" },
    { id: "cur_report", kind: "report", label: "curated", model: null, contextRef: { reportId: REPORT }, objectRefs: [REPORT], reviewStatus: "人工整理并复核", note: "报告块为人工撰写/复核，非模型生成。" },
  ],
};
jwrite(join(OUT, "snapshot/ai-products.json"), aiProducts);

// ── 7. 下一步方向（1~2 条，含理由链）──
const nextSteps = {
  note: "按手册 A.3：每条含「证据分歧/缺口 → 要补什么数据 → 能区分哪个解释 → 仍有什么不确定」。人工整理，供展示。",
  items: [
    {
      id: "next_1",
      direction: "在真实海浪/干湿交替条件下复测同一批物种的漂浮时长",
      basis: { kind: "evidence_divergence", refs: ["card_a56d5514-401c-44a5-a19e-3006ddcec46a", "card_7012e88a-b06a-4b57-8d00-ba0bdbae1386"], text: "作者自述海浪条件下漂浮时间应更短，但静水实验未给出波浪折扣量；马滕斯真实海水数据物种不同。" },
      needData: "对达尔文 94 株同批物种，在真实海水/干湿交替箱体中测漂浮天数与浸后萌发（Martens 式装置）。",
      distinguishes: "「静水估计可直接外推」 vs 「海浪条件需下修」两种解释。",
      stillUncertain: "下修幅度未知；盐度、温度、容器条件仍未量化。",
      status: "to_verify",
    },
    {
      id: "next_2",
      direction: "补齐原文条件与样本清单，区分差异来自物种组成还是实验条件",
      basis: { kind: "evidence_gap", refs: ["card_b2405e44-467f-46d7-ada5-a31b7c2fa3a1", "card_709a3cb3-589b-4e54-bf52-38b080eaa180"], text: "原文未写明海水盐度/温度/容器；94 种植物清单缺失；马滕斯句参与计数种子数缺字。" },
      needData: "原文若含附录清单/条件记录则补录；否则设计受控复现实验并记录盐度/温度/容器与物种清单。",
      distinguishes: "结果差异来自「物种/果实类型组成」 vs 「盐度/温度/容器等条件」。",
      stillUncertain: "原文未提供之处无法回溯；受控复现与 1859 条件未必一致。",
      status: "to_verify",
    },
  ],
};
jwrite(join(OUT, "snapshot/next-steps.json"), nextSteps);

// ── 8. 报告片段（可回查，markdown）──
{
  const rep = state.reports[0];
  const resolveRef = (ref) => {
    if (ref.kind === "card") {
      const c = state.cards.find((x) => x.id === ref.id);
      const a = state.assets.find((x) => x.id === c.assetId);
      const loc = locatorStatus(c.locator?.sectionQuote);
      return `卡片 ${c.id}（${c.audit}）→ 原件 ${a.name}（sha256 ${a.hash.slice(0, 12)}…，定位 ${loc.status}）`;
    }
    return `${ref.kind} ${ref.id}`;
  };
  const lines = [
    "# 报告片段（可回查）",
    "",
    `- 报告：${rep.id}（revision ${rep.revision}）`,
    `- 分析任务：${rep.taskId}`,
    "- 性质：观察/人工判断/待复核分列；天数为原文陈述，非本次实测。",
    "",
    "## 结论块（按 nature）",
    "",
  ];
  for (const b of rep.blocks) {
    lines.push(`### [${b.nature}] ${b.text}`, "");
    for (const ref of b.refs) lines.push(`- 回查：${resolveRef(ref)}`);
    lines.push("");
  }
  writeFileSync(join(OUT, "snapshot/report-snippet.md"), lines.join("\n"), "utf8");
}

// ── 8.5 展示补录：给预存对话补一段有科研内容的问答（人工整理，非模型生成）──
//      保留历史问候记录，追加一问一答；新增回答显式标 model=null 并注明「人工整理补录」。
{
  const chat = state.chats[0];
  chat.displayNote = "原始记录为历史问候（模型 mimo-v2.6-flash，未复核）。以下补录段落为展示人工整理（依冻结碎片），非模型生成，不冒充运行结果。";
  const CURATED = "display-curated/v1";
  chat.messages.push(
    {
      id: "msg_curated_q1", role: "user", content: "干燥处理到底把哪些物种的漂浮时长延长了？请只依据已冻结的对象回答。",
      status: "done", proposals: [], sources: [], at: chat.updatedAt, curated: true,
    },
    {
      id: "msg_curated_a1", role: "assistant",
      content: "依据已冻结的 8 个对象（3 张分组证据卡＋马滕斯/作者修正＋推断/装置卡）：干燥显著延长漂浮时长——成熟榛子由「立即下沉」延长到 90 天、芦笋由 23 天到 85 天、Helosciadium 由 2 天沉没到超过 90 天，且三者浸后均能萌发。94 株干燥植物中 18 株漂浮超过 28 天。这些天数均为达尔文 1859 原文陈述，非本地实测；海水盐度、温度、容器条件原文未写明。",
      status: "done", proposals: [],
      sources: ["碎片 1 · 榛子卡", "碎片 2 · 芦笋卡", "碎片 3 · Helosciadium 卡", "碎片 8 · 94 株总述卡"],
      at: chat.updatedAt,
      snapshot: { at: chat.updatedAt, purpose: "干燥对漂浮时长的影响", model: null, promptVersion: CURATED, summary: "展示补录：人工依冻结碎片整理，非模型生成", hash: "curated-display-no-model-hash", fragments: [] },
      curated: true,
    },
    {
      id: "msg_curated_q2", role: "user", content: "这些结论能直接外推到真实海浪条件吗？",
      status: "done", proposals: [], sources: [], at: chat.updatedAt, curated: true,
    },
    {
      id: "msg_curated_a2", role: "assistant",
      content: "不能直接外推。依据卡 a56d5514 与卡 7012e88a：作者自述暴露于海浪者漂浮时间应短于静水实验（估计或需下修），而马滕斯真实海水（干湿交替）试验物种不同、且未预先干燥并偏选大型果与近海植物，存在方向相反的两处偏倚。因此两种条件不可直接合并统计，需在同一批物种上做受控复测。",
      status: "done", proposals: [],
      sources: ["碎片 5 · 马滕斯实测卡", "碎片 6 · 作者修正意见卡"],
      at: chat.updatedAt,
      snapshot: { at: chat.updatedAt, purpose: "外推可行性", model: null, promptVersion: CURATED, summary: "展示补录：人工依冻结碎片整理，非模型生成", hash: "curated-display-no-model-hash", fragments: [] },
      curated: true,
    },
  );
  chat.subquestionId = state.subquestions[0].id;
  chat.updatedAt = chat.messages[chat.messages.length - 1].at;
}

// ── 9. 写 state.json（前端消费格式）──
jwrite(join(OUT, "snapshot/state.json"), state);

// ── 9.1 图形（方案流程图 + 结果柱状图；据既有步骤/表行数值生成，不新增事实）──
{
  const rev0 = proto.revisions[0];
  const figProto = {
    id: "fig_proto_flow",
    kind: "flow",
    title: `${proto.name} · 步骤`,
    caption: "据方案 r1 的步骤生成（示意流程图，非实测照片）；条件未知项沿原文标注。",
    protocolId: PROTO,
    revision: rev0.revision,
    nodes: rev0.steps.map((s) => ({ id: s.id, label: s.op, note: s.note || "" })),
    edges: rev0.steps.slice(1).map((s, i) => ({ from: rev0.steps[i].id, to: s.id })),
    unknowns: rev0.unknowns,
  };
  const tRows = state.tables[0].rows;
  const num = (v) => { const m = String(v).match(/\d+/); return m ? Number(m[0]) : null; };
  const chart = {
    id: "chart_flotation_fresh_vs_dried",
    kind: "bar",
    title: "漂浮天数：新鲜 vs 干燥",
    caption: "据 darwin-flotation.csv 前三行数值绘制；天数取自原文陈述（非本地实测）。",
    tableId: state.tables[0].id,
    revision: state.tables[0].revision,
    series: [{ key: "fresh", label: "新鲜", color: "#8c7a63" }, { key: "dried", label: "干燥", color: "#a63f2e" }],
    rows: [
      { item: "榛子", fresh: num(tRows[0][1]), dried: num(tRows[0][2]), note: "新鲜=立即下沉" },
      { item: "芦笋", fresh: num(tRows[1][1]), dried: num(tRows[1][2]) },
      { item: "Helosciadium", fresh: num(tRows[2][1]), dried: num(tRows[2][2]), note: "干燥原文为「>90 天」，按不小于 90 绘" },
    ],
    notes: ["柱高仅为原文陈述天数的直观呈现，非本次实测。", "Helosciadium 干燥值原文为「>90」，绘图取下限 90。"],
  };
  jwrite(join(OUT, "snapshot/figures.json"), {
    note: "图形由既有方案步骤与表行数值生成（不新增事实）。protocolFigures 按 protocolId 索引；charts 按 tableId 索引。",
    protocolFigures: { [PROTO]: figProto },
    charts: { [state.tables[0].id]: chart },
  });
}

// ── 9.2 「90 天」贯通链（逐跳引用与固定版本；缺跳精确写出）──
{
  const ANCHOR_BLOCK = "rblk_0d95f9d5-b406-48bf-990d-2b5b6880cf07";
  const chain = {
    note: "以报告数值「90 天」（榛子干燥后漂浮天数）为贯通点，逐跳给出引用与固定版本；每跳可点、可返回。缺直接引用边处精确写出经由对象。",
    value: "90",
    unit: "days",
    subject: "榛子（干燥后漂浮）",
    hops: [
      { hop: 1, kind: "block", id: ANCHOR_BLOCK, reportId: REPORT, version: `r${state.reports[0].revision}`, label: "分析初稿块#2（「榛子 0→90 天」）", edge: "has_block", direct: true },
      { hop: 2, kind: "result", id: state.analysisResults[0].id, version: `r${state.analysisResults[0].revision}`, label: "结果 · 表格统计（按新鲜/干燥分组）", edge: "refs", direct: true },
      { hop: 3, kind: "measurement", id: "meas_28204d07-e9ec-4f56-8404-6c873a07c0e8", version: "r1", label: "处理输入 · 测量 90 days（榛子·干燥）", edge: "任务核心输入", direct: false, via: `task:${TASK}`, note: "结果与测量之间无直接引用边，经由分析任务核心输入相连。" },
      { hop: 4, kind: "table", id: state.tables[0].id, revision: 1, rowIndex: 0, version: "r1", label: "原始表 darwin-flotation.csv 第 1 行（dried=90）", edge: "任务核心输入", direct: false, via: `task:${TASK}`, note: "表为该任务的另一核心输入；测量与表行之间无直接边，同经任务相连。" },
      { hop: 5, kind: "execution", id: EXEC, version: "r1", label: "执行（文献重构补记，非本地实测）", edge: "样品所属执行", direct: false, via: "sample:smp_efeed827-56a0-4c7c-8a36-e67b82cb0bbb", note: "测量→样品→执行；执行与表之间无直接边。" },
      { hop: 6, kind: "asset", id: "ast_46e6463a-a10b-4c85-9d3d-b38ab2bf1dd0", version: `sha256:${(state.assets.find((a) => a.id === "ast_46e6463a-a10b-4c85-9d3d-b38ab2bf1dd0")?.hash ?? "").slice(0, 12)}`, label: "原件 darwin-flotation.csv（Public Domain）", edge: "from_asset", direct: true },
    ],
    deeper: `最深可回查层：原件 ast_46e6463a…（darwin-flotation.csv）。第 3–5 跳之间无直接引用边，均经由对象相连，已逐跳写明。`,
  };
  jwrite(join(OUT, "snapshot/chain-90d.json"), chain);
}

// ── 9.3 导出：报告 Word 与追溯包（复用后端现有导出能力，同一固定版本）──
{
  mkdirSync(join(OUT, "snapshot/exports"), { recursive: true });
  const rep = state.reports[0];
  writeFileSync(REPORT_DOCX, buildReportDocx(state, rep));
  const trace = buildTraceabilityPackage(state, rep.id);
  writeFileSync(REPORT_TRACE, trace.buffer);
  console.log("导出已生成：", {
    docx: REPORT_DOCX.replace(ROOT + "\\", "").replace(ROOT + "/", ""),
    docxBytes: readFileSync(REPORT_DOCX).length,
    traceBytes: trace.buffer.length,
    excluded: trace.excludedAttachments.length,
  });
}

// ── 10. manifest（固定字段 + 文件/原件 SHA-256）──
const snapFiles = ["state.json", "context-map.json", "references.json", "knowledge.json", "ai-products.json", "next-steps.json", "report-snippet.md", "figures.json", "chain-90d.json", "exports/report.docx", "exports/traceability.zip"];
const files = {};
for (const f of snapFiles) files[`snapshot/${f}`] = sha256(readFileSync(join(OUT, "snapshot", f)));
const manifest = {
  schemaVersion: SCHEMA_VERSION,
  fixtureVersion: FIXTURE_VERSION,
  sourceCommit: SOURCE_COMMIT,
  projectId: TOPIC,
  generatedAt: new Date().toISOString(),
  generator: "locus-site/demo-data/tools/build-demo.mjs",
  verificationStatus: "verified-local",
  counts: {
    topics: state.topics.length, papers: state.papers.length, assets: state.assets.length,
    cards: state.cards.length, tables: state.tables.length, protocols: state.protocols.length,
    executions: state.executions.length, samples: state.samples.length, measurements: state.measurements.length,
    analysisTasks: state.analysisTasks.length, analysisResults: state.analysisResults.length,
    reports: state.reports.length, chats: state.chats.length,
    mapNodes: mapTask.nodes.length, mapEdges: mapTask.edges.length, refNodes: references.nodes.length, refEdges: references.edges.length,
  },
  originals,
  files,
  caveats: [
    "comparison.independenceStatus=未具备：两项数据同页转引，非独立两篇文献。",
    "全部模型产物标 unverified/incomplete/curated；本轮未调用模型。",
  ],
};
jwrite(join(OUT, "snapshot/manifest.json"), manifest);

console.log("build-demo 完成：", {
  originals: originals.length,
  cards: state.cards.length,
  mapTaskNodes: mapTask.nodes.length,
  mapTaskEdges: mapTask.edges.length,
  mapGaps: mapTask.gaps.length,
  refNodes: references.nodes.length,
  refEdges: references.edges.length,
});
