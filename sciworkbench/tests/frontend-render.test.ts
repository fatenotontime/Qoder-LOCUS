/**
 * A7 前端渲染自动检查：对纯渲染函数（lib/views.js）的输出断言——
 * 可见文本不得出现 ISO 时间、英文枚举、裸版本号、"docs/stage"、"（全部课题）"、"fetch failed"。
 * 只扫描「可见文本」：去掉标签（含属性值）与「详情」折叠体（原始报错允许留在详情里）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  topbarTopicHtml, emptyTopicGuideHtml, navHtml, panelErrorHtml, sidebarListHtml,
  topicOverviewHtml, topicTodosHtml, subqBlockHtml, nextStepHtml,
} from "../public/lib/views.js";
import { knowledgeLeftHtml, knowledgeWorkspaceHtml, knowledgeQueueHtml, kzCondSplit } from "../public/lib/pages/knowledge.js";
import { fmtTime, fmtEnum, fmtVersion, fmtNameOnce } from "../public/lib/format.js";

const ISO = "2026-11-18T12:35:11.046Z";
const state = {
  version: 8,
  topics: [{ id: "t1", name: "课题甲", researchQuestion: "Q" }],
  subquestions: [{ id: "q1", topicId: "t1", question: "子问题?", kind: "declared" }],
  assets: [{ id: "as1", kind: "literature", name: "n", bytes: 1, hash: "h", text: "t", topicId: "t1", createdAt: ISO }],
  papers: [{ id: "p1", title: "论文", year: "1859", doi: "", topicIds: ["t1"] }],
  attachments: [{ id: "a1", paperId: "p1", assetId: "as1", role: "fulltext", version: "v1" }],
  cards: [{ id: "c1", paperId: "p1", assetId: "as1", rawText: "x", audit: "unreviewed", importance: null, note: "", reason: "", extraction: "manual", revision: 1, history: [], locator: { sectionQuote: "x" }, unknowns: [], secondaryCitation: false, mechanical: false, createdAt: ISO, updatedAt: ISO }],
  tables: [], adoptions: [], mappings: [], comparisons: [],
  protocols: [{ id: "pr1", topicId: "t1", name: "方案", sourceKind: "ai-draft", revision: 2, revisions: [{ revision: 2, at: ISO, reason: "", purpose: "", inputs: [], steps: [{ id: "s1", op: "o" }], conditions: [], criteria: "", unknowns: [], sourceFragments: [] }] }],
  templates: [],
  executions: [{ id: "e1", topicId: "t1", protocolId: "pr1", protocolRevision: 2, phase: "preparing", preparation: { baseRevision: 2, adjustments: [{}], notes: "" }, status: "active", events: [], createdAt: ISO, updatedAt: ISO }],
  samples: [], measurements: [], impacts: [], ocrs: [],
  analysisTasks: [{ id: "at1", topicId: "t1", title: "分析", core: [], optional: [], resultIds: [], createdAt: ISO, updatedAt: ISO }],
  analysisResults: [], reports: [],
  chats: [{ id: "ch1", topicId: "t1", scope: [], messages: [], createdAt: ISO, updatedAt: ISO }],
};
const ui = { nav: "topic", topicId: "t1", paperId: "p1", protocolId: "pr1", executionId: "e1", taskId: "at1", chatId: "ch1" };

// ── E3 分项数据：结构化壳（c1）＋旧卡（c2）＋条件/引文/主题，供纯渲染函数消费 ──
const SRC = { kind: "asset", id: "as1", version: "sha256:h", contentHash: "h" };
const itemEnv = (revision, status) => ({
  id: "ki1", kind: "item", revision,
  history: [{ revision: 1, at: ISO, reason: "人工核对后修订", payload: {} }],
  payload: {
    cardId: "c1", topicIds: ["t1"], subquestionIds: [], contentType: "claim", nature: "observation",
    text: "响应时间 0.8 s", subject: { raw: "石墨烯电极" }, predicate: { raw: "响应时间" },
    value: { kind: "summary", raw: "0.8 s（SD 0.02）", statistic: "平均值", value: "0.8", unit: "s", uncertainty: { type: "SD", value: "0.02" }, sampleSize: 3 },
    scopeText: "pH 7.0",
    unknowns: [{ id: "ku1", fieldPath: "value", reasonCode: "unparsed_numeric", detail: "原文写法不规整", scopeRefs: [], evidenceRefs: [] }],
    contextRefs: [{ kind: "context", id: "kc1", revision: 1 }],
    evidenceRefs: [{ ref: { kind: "evidence", id: "ke1", revision: 1 }, fieldPaths: [] }],
    sourceRefs: [SRC],
    origin: { sourceClass: "literature_report", createdBy: "model", secondaryCitation: false },
    review: { status, basis: status === "pending" ? "" : "与原文逐字核对一致" },
  },
});
const knowledge = {
  items: [itemEnv(2, "pending")],
  contexts: [{
    id: "kc1", kind: "context", revision: 1, history: [],
    payload: {
      researchUnitId: "card:c1", subject: "石墨烯电极", groupLabel: "", stage: "", methodRefs: [],
      conditions: [
        { id: "kcn_1", field: { raw: "温度" }, value: { kind: "scalar", raw: "25 °C", value: "25", unit: "°C" }, appliesTo: { subject: "样品", stage: "测量" }, evidenceRefs: [{ kind: "evidence", id: "ke1", revision: 1 }], obtainedBy: "source_explicit", review: { status: "pending" } },
        { id: "kcn_2", field: { raw: "电解液 pH" }, value: { kind: "category", raw: "7.0", label: "7.0" }, appliesTo: { subject: "样品", stage: "测量" }, evidenceRefs: [], obtainedBy: "human_record", review: { status: "confirmed" } },
      ],
      unknowns: [{ id: "ku2", fieldPath: "conditions", reasonCode: "not_measured", detail: "搅拌速度未记", scopeRefs: [], evidenceRefs: [] }],
      topicIds: ["t1"], subquestionIds: [], review: { status: "pending" },
    },
  }],
  evidence: [{
    id: "ke1", kind: "evidence", revision: 2,
    history: [{ revision: 1, at: ISO, reason: "按原文逐字定位", payload: { sourceRef: SRC, quote: "响应时间0.8 s", locationStatus: "unmatched", locator: { type: "unresolved", description: "未命中" }, candidates: [] } }],
    payload: {
      sourceRef: SRC, quote: "响应时间0.8 s", locationStatus: "ambiguous",
      locator: { type: "text", start: 9, end: 17 },
      candidates: [{ sourceRef: SRC, locator: { type: "text", start: 40, end: 48 } }],
    },
  }],
  themes: [{
    id: "ktm1", kind: "theme", revision: 1, history: [],
    payload: { topicId: "t1", name: "pH 与响应时间", definition: "比较不同 pH 下的响应速度", subquestionIds: [], members: [{ kind: "item", id: "ki1", revision: 2 }], currentJudgmentRefs: [] },
  }],
};
const kzState = {
  ...state,
  cards: [
    { ...state.cards[0], knowledgeItemIds: ["ki1"], audit: "need_info" },
    { ...state.cards[0], id: "c2", rawText: "旧卡：重复测量 3 次取平均值", extraction: "ai", audit: "unreviewed", knowledgeItemIds: [] },
    { ...state.cards[0], id: "c3", paperId: undefined, rawText: "旧数据卡：未写归属，按附件回查", extraction: "manual", audit: "unreviewed", knowledgeItemIds: [] },
  ],
  knowledge,
};

// 人工陈述（缺陷 D）：无 cardId 的 pending 知识项，不得被文献/卡过滤掉，须独立成区可审。
const STMT_TEXT = "该体系在 pH 7 下响应时间优于 1 s";
const statementEnv = (revision, status) => ({
  id: "ki_stm1", kind: "item", revision, history: [],
  payload: {
    contentType: "claim", nature: "human_judgment",
    text: STMT_TEXT, subject: { raw: "课题甲" }, predicate: { raw: "当前认识" },
    value: null, contextRefs: [], evidenceRefs: [], sourceRefs: [],
    origin: { sourceClass: "human_statement", createdBy: "human", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: ["t1"], subquestionIds: [], review: { status, basis: "" },
  },
});
const withStatement = (status) => ({ ...kzState, knowledge: { ...knowledge, items: [...knowledge.items, statementEnv(1, status)] } });

const detailStripped = (h) => h.replace(/<pre class="perr-detail-body"[\s\S]*?<\/pre>/g, " ");
const visibleText = (h) => detailStripped(h).replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");

const libRef = { kind: "item", id: "ki1", revision: 2 };
const libData = {
  viewId: "v1", scope: { topicId: "t1" }, mode: "formal",
  elements: [{ ref: libRef, kind: "item", contentType: "claim", nature: "observation", sourceClass: "literature_report", reviewStatus: "confirmed", label: "响应时间 0.8 s", valueText: "0.8 s", unit: "s", unknownCount: 0, themeIds: ["th1"], sourceTokens: ["S1"], conditionTexts: ["温度＝25 °C"] }],
  totals: { items: 1, datasets: 0, pending: 0, notFormal: 0 },
  counts: { matched: 1, loaded: 1, totalKnown: 1 },
  undivided: [], byTheme: [{ themeId: "th1", name: "pH 与响应", memberRefs: [libRef] }],
  bySource: [{ token: "S1", label: "asset as1 v1", itemRefs: [libRef] }],
  sources: [{ token: "S1", ref: { kind: "asset", id: "as1", version: "v1", contentHash: "h" }, label: "asset as1 v1" }],
  cardIndex: [{ cardId: "c1", itemRefs: [libRef] }],
  dedupNote: "去重以固定引用为准。", warnings: [], hasMore: false, nextCursor: null,
};

function allRendered() {
  const parts = [
    topbarTopicHtml(state, ui), topbarTopicHtml({ ...state, topics: [] }, ui), topbarTopicHtml({ ...state, topics: [state.topics[0], { id: "t2", name: "课题乙", researchQuestion: "R" }] }, ui),
    emptyTopicGuideHtml(), navHtml(ui, false), navHtml(ui, true),
    panelErrorHtml({ panel: "mid", message: "连不上模型，请检查网络或 Key", detail: "fetch failed: ETIMEDOUT", retry: () => {} }),
    sidebarListHtml(state, ui),
    sidebarListHtml(state, { ...ui, nav: "papers" }),
    sidebarListHtml(state, { ...ui, nav: "protocol" }),
    sidebarListHtml(state, { ...ui, nav: "record" }),
    sidebarListHtml(state, { ...ui, nav: "analysis" }),
    sidebarListHtml(state, { ...ui, nav: "chat" }),
    topicOverviewHtml(state, ui), topicTodosHtml(state, ui), subqBlockHtml(state, ui), nextStepHtml(state, ui),
    knowledgeLeftHtml(state, { ...ui, nav: "knowledge" }),
    knowledgeWorkspaceHtml(state, { ...ui, nav: "knowledge", kzTab: "todo", cardOpen: "c1" }),
    knowledgeWorkspaceHtml(state, { ...ui, nav: "knowledge", kzTab: "cand" }),
    knowledgeQueueHtml(state, { ...ui, nav: "knowledge" }),
    // E3：结构化壳分项区／旧版回查／旧卡结构化表单／主题面板／分项待审队列
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzTab: "todo", cardOpen: "c1" }),
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzTab: "todo", cardOpen: "c1", kiView: { id: "ki1", revision: 1, payload: knowledge.items[0].payload } }),
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzTab: "todo", cardOpen: "c2", kzStruct: "c2" }),
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzPanel: "themes" }),
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", topicId: "", kzPanel: "themes" }),
    knowledgeQueueHtml(kzState, { ...ui, nav: "knowledge" }),
    // 缺陷 D：无卡人工陈述的独立待审区（右栏分区）与中栏独立审阅落点
    knowledgeQueueHtml(withStatement("pending"), { ...ui, nav: "knowledge" }),
    knowledgeWorkspaceHtml(withStatement("pending"), { ...ui, nav: "knowledge", kzTab: "todo" }),
    knowledgeWorkspaceHtml(withStatement("pending"), { ...ui, nav: "knowledge", cardOpen: "c1" }),
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzJob: { status: "running", done: 1, total: 3, created: 2, chunkErrors: [] } }),
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzJob: { status: "paused", done: 1, total: 3, created: 2, chunkErrors: [] } }),
    knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzJob: { status: "error", done: 1, total: 3, created: 2, chunkErrors: [] } }),
    // E6-B：库总览容器（读到数据／读取中／未接入／空库）与同源列表
    knowledgeWorkspaceHtml(state, { ...ui, nav: "knowledge", kzPanel: "library", kzLib: { status: "ready", topicId: "t1", data: libData } }),
    knowledgeWorkspaceHtml(state, { ...ui, nav: "knowledge", kzPanel: "library", kzLib: { status: "ready", topicId: "t1", data: libData, selected: "item:ki1@2" } }),
    knowledgeWorkspaceHtml(state, { ...ui, nav: "knowledge", kzPanel: "library", kzLib: { status: "loading", topicId: "t1" } }),
    knowledgeWorkspaceHtml(state, { ...ui, nav: "knowledge", kzPanel: "library", kzLib: { status: "unwired", topicId: "t1" } }),
    knowledgeWorkspaceHtml(state, { ...ui, nav: "knowledge", kzPanel: "library", kzLib: { status: "empty", topicId: "t1", data: { ...libData, elements: [], byTheme: [], bySource: [], sources: [], undivided: [], cardIndex: [], counts: { matched: 0, loaded: 0, totalKnown: 0 }, totals: { items: 0, datasets: 0, pending: 0, notFormal: 0 } } } }),
  ];
  return parts.join("\n");
}

const FORBIDDEN = [
  [/\d{4}-\d{2}-\d{2}T/, "ISO 时间"],
  [/unreviewed|declared|exploratory|ai-draft|rev \d|fetch failed|docs\/stage/, "英文枚举/裸版本/原始报错/文档路径"],
  [/（全部课题）/, "旧「全部课题」下拉"],
];

test("A7 纯渲染输出：可见文本不含禁用模式", () => {
  const html = allRendered();
  const text = visibleText(html);
  for (const [re, label] of FORBIDDEN) {
    const m = text.match(re);
    assert.equal(m, null, `可见文本出现「${label}」：${m?.[0]}`);
  }
});

test("A7 报错条：默认文案为中文人话；原始信息只在「详情」内", () => {
  const bar = panelErrorHtml({ panel: "mid", message: "连不上模型，请检查网络或 Key", detail: "fetch failed", retry: () => {} });
  assert.ok(visibleText(bar).includes("连不上模型"));
  assert.ok(!visibleText(bar).includes("fetch failed")); // 详情被排除
  assert.ok(bar.includes("fetch failed")); // 但原始信息确实保留在详情中
});

test("A7 E3 分项审阅渲染：壳→项→条件→引文＋主题面板，动作与门槛文案齐全", () => {
  const mid = (patch) => visibleText(knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", ...patch }));
  const shell = mid({ kzTab: "todo", cardOpen: "c1" });
  assert.ok(shell.includes("响应时间 0.8 s"), "知识项文本要显示");
  assert.match(shell, /分项 0\/1 已确认/, "整卡状态由分项派生");
  assert.ok(shell.includes("待审") && shell.includes("确认") && shell.includes("待补") && shell.includes("排除"), "三项动作可见");
  assert.ok(shell.includes("温度＝25 °C") && shell.includes("电解液 pH＝7.0"), "条件逐项显示（含中文单位）");
  assert.ok(shell.includes("多处命中") && shell.includes("第2处") && shell.includes("第1处（当前）"), "引文定位状态与全部出现位置可见（含可采用的当前处）");
  assert.ok(shell.includes("数字未解析：原文写法不规整"), "未知项显示原因与备注");
  assert.ok(shell.includes("标准差 0.02") && shell.includes("n=3"), "不确定度与样本量按模型给的原样显示");
  assert.ok(!shell.includes("（全部课题）"), "不用旧的整卡下拉兜底");

  const shellHtml = knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzTab: "todo", cardOpen: "c1" });
  assert.ok(shellHtml.includes('class="kcf-field" value="温度"'), "条件编辑预填条件名");
  assert.ok(shellHtml.includes('class="kcf-num" value="25"') && shellHtml.includes('class="kcf-unit" value="°C"'), "数值与单位按原值预填");
  assert.ok(shellHtml.includes("改条件"), "条件可修改（§12.3 步骤2）");
  assert.ok(shellHtml.includes("本处引用第1版：未定位") && shellHtml.includes("改绑当前版"), "钉在旧版的引文要显式标旧版并给改绑入口（§4.6.9）");
  assert.equal((shellHtml.match(/改绑当前版/g) ?? []).length, 2, "知识项与条件各给一次改绑入口");
  assert.ok(shellHtml.includes('class="kef-cond" data-ctxid="kc1"') && shellHtml.includes('data-condid="kcn_1"'), "条件改绑要带回条件 id");
  assert.ok(shellHtml.includes('class="kef-item" data-iid="ki1"'), "知识项改绑入口带项 id");

  const pinned = mid({ kzTab: "todo", cardOpen: "c1", kiView: { id: "ki1", revision: 1, payload: knowledge.items[0].payload } });
  assert.ok(pinned.includes("第1版") && pinned.includes("旧版只读"), "旧版回查显式标版次与只读");
  assert.ok(!pinned.includes("待补"), "旧版视图不给审核动作");
  assert.ok(pinned.includes("回到当前版"));
  assert.ok(!knowledgeWorkspaceHtml(kzState, { ...ui, nav: "knowledge", kzTab: "todo", cardOpen: "c1", kiView: { id: "ki1", revision: 1, payload: knowledge.items[0].payload } }).includes("改绑当前版"), "旧版只读视图不给改绑入口");

  const struct = mid({ kzTab: "todo", cardOpen: "c2", kzStruct: "c2" });
  assert.ok(struct.includes("结构化＝把这张旧卡的判断改写成"), "旧卡结构化说明可见");
  assert.ok(struct.includes("全部待审") || struct.includes("一律待审"), "结构化后回到待审要说明");

  const themes = mid({ kzPanel: "themes" });
  assert.ok(themes.includes("pH 与响应时间") && themes.includes("当前认识"), "主题列出成员与当前认识门槛");
  assert.ok(themes.includes("本课题还没有知识项") === false, "有分项时不应显空态");
  assert.ok(mid({ kzPanel: "themes", topicId: "" }).includes("先在顶部选择课题"), "缺课题要给下一步");

  const queue = visibleText(knowledgeQueueHtml(kzState, { ...ui, nav: "knowledge" }));
  assert.ok(queue.includes("知识项待审") && queue.includes("响应时间 0.8 s"), "分项待审进入右栏队列");

  const todo = mid({ kzTab: "todo" });
  assert.ok(todo.includes("未写归属"), "旧数据卡（无 paperId）按论文附件回查后仍归入所选文献");
});

test("A7 缺陷 D：无卡人工陈述进入独立待审区、可打开、可确认/改值", () => {
  const pending = withStatement("pending");

  // 右栏：卡内知识项与人工陈述分区并列；陈述不因无 cardId 被滤掉
  const queue = knowledgeQueueHtml(pending, { ...ui, nav: "knowledge" });
  assert.ok(queue.includes("人工陈述待审"), "右栏出现人工陈述待审分区标题");
  assert.ok(queue.includes("卡内知识项待审"), "卡内知识项与人工陈述分区并列");
  assert.ok(queue.includes(STMT_TEXT), "人工陈述出现在待审队列");
  assert.match(queue, /class="kzq-kitem" data-iid="ki_stm1" data-cid=""/, "陈述项无 cardId，走无卡路径");

  // 中栏「分项」：独立审阅落点，复用知识项详情（可确认、可改值、来源标注人工陈述）
  const mid = knowledgeWorkspaceHtml(pending, { ...ui, nav: "knowledge", kzTab: "todo" });
  assert.ok(mid.includes("人工陈述待审"), "中栏有独立的人工陈述审阅区");
  assert.match(mid, /<div class="kitem"[^>]*data-iid="ki_stm1"/, "陈述渲染为可打开的 kitem 详情");
  assert.ok(mid.includes('class="ki-ok" data-iid="ki_stm1"'), "陈述有确认入口");
  assert.ok(mid.includes('class="ki-save" data-iid="ki_stm1"'), "陈述有改值入口");
  assert.ok(mid.includes("人工陈述"), "来源如实标注人工陈述，不冒充证据");

  // 已确认的陈述不再出现在待审区（确认后离开待审 → 可进入主题「当前认识」）
  const confirmed = knowledgeQueueHtml(withStatement("confirmed"), { ...ui, nav: "knowledge" });
  assert.ok(!confirmed.includes(STMT_TEXT), "已确认陈述不在待审队列");
  assert.ok(!knowledgeWorkspaceHtml(withStatement("confirmed"), { ...ui, nav: "knowledge", kzTab: "todo" }).includes("人工陈述待审"), "已确认陈述不在中栏待审区");
});

test("A7 条件写法拆分：名称与值分开，不出现「温度＝温度＝…」", () => {
  assert.deepEqual(kzCondSplit("温度＝25 °C"), { name: "温度", rhs: "25 °C" });
  assert.deepEqual(kzCondSplit("缓冲液 pH: 7.0"), { name: "缓冲液 pH", rhs: "7.0" });
  assert.deepEqual(kzCondSplit("搅拌速度未记录"), { name: "搅拌速度未记录", rhs: "搅拌速度未记录" });
});

test("A7 格式化词表：时间/枚举/版本/去重", () => {
  const d = new Date(ISO), p = (n) => String(n).padStart(2, "0");
  assert.equal(fmtTime(ISO), `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
  assert.match(fmtTime(ISO), /^\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(fmtEnum("declared"), "已定");
  assert.equal(fmtEnum("unreviewed"), "待审");
  assert.equal(fmtEnum("ai-draft"), "模型草稿");
  assert.equal(fmtVersion(2), "第2版");
  assert.equal(fmtNameOnce("SEA-94", "SEA-94"), "SEA-94");
  assert.equal(fmtNameOnce("种子组", "SEA-94"), "种子组（SEA-94）");
});
