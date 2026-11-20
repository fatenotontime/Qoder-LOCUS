/**
 * 纯渲染函数（DOM 无关）：外壳、侧栏列表、课题总览/待办、分区报错。
 * 供 app.js 注入 innerHTML，也供 node:test 直接断言渲染文本（自动检查）。
 * 规则：不出现 ISO 时间、英文枚举、裸版本号、docs/ 路径；时间/枚举/版本一律经 lib/format.js。
 */
import { fmtTime, fmtEnum, fmtVersion, fmtNameOnce } from "./format.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const topicName = (state, id) => state.topics.find((t) => t.id === id)?.name;

export const NAV_ITEMS = [
  ["topic", "课题"], ["papers", "文献"], ["knowledge", "知识"],
  ["protocol", "方案"], ["record", "记录"], ["analysis", "分析"], ["chat", "对话"],
];

/** 书脊与封面共用的一字印。 */
export const NAV_CHARS = {
  topic: "课", papers: "文", knowledge: "知", protocol: "案",
  record: "行", analysis: "析", chat: "谈",
};

export function navChar(kind) { return NAV_CHARS[kind] ?? "课"; }

/** 导航线性图标（随文字颜色走，24 栅格）。 */
const NAV_ICONS = {
  topic: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H19"/>`,
  papers: `<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>`,
  knowledge: `<path d="M12 3 4 7l8 4 8-4z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/>`,
  protocol: `<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M8.2 15h7.6"/>`,
  record: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4"/><path d="m9 13 2 2 4-4"/>`,
  analysis: `<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5M12 16V7M16 16v-3"/>`,
  chat: `<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/><path d="M8 12h8M8 15.5h5"/>`,
};

export function navIcon(kind, size = 18) {
  const body = NAV_ICONS[kind] ?? NAV_ICONS.topic;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** 页头「当前课题」：单课题显示名称，多课题下拉，无课题显示提示。 */
export function topbarTopicHtml(state, ui) {
  if (!state.topics.length) return `<span class="curtopic none"><span class="ct-kicker">未开卷</span><span class="ct-empty">先建课题</span></span>`;
  if (state.topics.length === 1) return `<span class="curtopic"><span class="ct-kicker">当前课题</span><b>${esc(state.topics[0].name)}</b></span>`;
  return `<label class="curtopic"><span class="ct-kicker">当前课题</span>
    <select id="topic-select" aria-label="切换课题">${state.topics.map((t) => `<option value="${t.id}" ${t.id === ui.topicId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`;
}

/** 无课题时中间区引导：只留「创建课题（名称＋研究问题）」。 */
export function emptyTopicGuideHtml() {
  return `<div class="empty-guide empty-first" data-empty="topic">
    <div class="empty-seal" aria-hidden="true">课</div>
    <div class="eyebrow">未开卷</div>
    <h2>创建第一个课题</h2>
    <p class="empty-sub">只需名称与研究问题即可开始，不需要先准备材料。</p>
    <div class="field"><label for="topic-name">课题名称</label><input id="topic-name" placeholder="例如：SLAC 漆酶动力学表征" /></div>
    <div class="field"><label for="topic-q">研究问题</label><input id="topic-q" placeholder="想回答的科学问题" /></div>
    <div class="empty-actions"><button class="primary" id="topic-create">开卷</button></div>
    <p class="empty-foot">之后按「文 → 知 → 案 → 行 → 析 → 谈」逐步积累上下文。</p>
  </div>`;
}

/** 课题页的研究流程带：六步闭环，点步骤直达对应页。 */
export function topicFlowHtml(state, ui) {
  const topics = ui.topicId ? state.topics.filter((t) => t.id === ui.topicId) : state.topics;
  if (!topics.length) return "";
  const t = topics[0];
  const paperIds = new Set(state.papers.filter((p) => p.topicIds.includes(t.id)).map((p) => p.id));
  const cards = state.cards.filter((c) => paperIds.has(c.paperId) || state.assets.find((a) => a.id === c.assetId)?.topicId === t.id);
  const confirmed = cards.filter((c) => c.audit === "confirm").length;
  const execs = state.executions.filter((e) => e.topicId === t.id);
  const steps = [
    ["papers", "文", "文献", state.papers.filter((p) => p.topicIds.includes(t.id)).length, "篇"],
    ["knowledge", "知", "知识", cards.length, "张", cards.length ? `${confirmed} 已确认` : ""],
    ["protocol", "案", "方案", state.protocols.filter((p) => p.topicId === t.id).length, "份"],
    ["record", "行", "执行", execs.length, "次", execs.length ? `${execs.filter((e) => e.status === "active").length} 进行中` : ""],
    ["analysis", "析", "分析", state.analysisTasks.filter((x) => x.topicId === t.id).length, "个"],
    ["chat", "谈", "对话", state.chats.filter((c) => c.topicId === t.id).length, "段"],
  ];
  const nextIdx = steps.findIndex(([, , , n]) => !n);
  const html = steps.map(([k, char, label, n, unit, sub], i) => {
    const hasData = n > 0;
    return `<button class="goto flowstep ${hasData ? "hasdata" : ""} ${i === nextIdx ? "next" : ""}" data-goto="${k}" title="前往${label}">
      <span class="flowdot" aria-hidden="true">${char}</span>
      <span class="flowlabel">${label}</span>
      <span class="flowcount"><b>${n}</b> ${unit}</span>
      ${sub ? `<span class="flowsub">${esc(sub)}</span>` : ""}
    </button>`;
  }).join("");
  return `<div class="flowcard">
    <div class="flowhead"><span class="eyebrow">研究流程</span><span class="flowhint">每一步的产出都保留来源与版本，可回溯到原文或记录。</span></div>
    <div class="flow">${html}</div>
  </div>`;
}

/** 书脊：七枚一字印，当前页朱砂底。collapsed 保留给旧调用方，书脊始终显示文字。 */
export function navHtml(ui, collapsed) {
  return `<div class="navitems"${collapsed ? ' data-collapsed="1"' : ""}>${NAV_ITEMS.map(([k, label]) =>
    `<button class="navitem ${k === ui.nav ? "active" : ""}" data-nav="${k}" title="${esc(label)}"${k === ui.nav ? ' aria-current="page"' : ""}>
      <span class="navsigil" aria-hidden="true">${navChar(k)}</span><span class="navlabel">${esc(label)}</span>
    </button>`).join("")}</div>`;
}

/** 分区报错条：可关闭、带重试、附「详情」。 */
export function panelErrorHtml(err) {
  if (!err) return "";
  return `<div class="panelerr" data-panel="${esc(err.panel ?? "")}">
    <span class="msg">${esc(err.message)}</span>
    ${err.retry ? `<button class="primary perr-retry">重试</button>` : ""}
    <button class="perr-detail" type="button">详情</button>
    <button class="perr-close" type="button" title="关闭">×</button>
    <pre class="perr-detail-body" hidden>${esc(err.detail ?? "（无）")}</pre></div>`;
}

/** 侧栏下层：本页列表。课题页显示课题目录。 */
export function sidebarListHtml(state, ui) {
  const arc = (rows, empty) => rows.length ? rows.join("") : `<p class="hint">${empty}</p>`;
  if (ui.nav === "topic") {
    return arc(state.topics.map((t) => `<button class="material topic-row ${t.id === ui.topicId ? "active" : ""}" data-topicpick="${t.id}" type="button">
      <div class="m-title">${esc(t.name)}</div>
      <div class="m-meta">${esc(t.researchQuestion || "研究问题待补")}</div>
    </button>`), "还没有课题：先在中间开卷。");
  }
  if (ui.nav === "papers" || ui.nav === "knowledge") {
    const ps = state.papers.filter((p) => !ui.topicId || p.topicIds.includes(ui.topicId) || !p.topicIds.length);
    return arc(ps.map((p) => {
      const nAtt = state.attachments.filter((a) => a.paperId === p.id).length;
      const nCard = state.cards.filter((c) => c.paperId === p.id).length;
      return `<div class="material ${p.id === ui.paperId ? "active" : ""}" data-paperid="${p.id}">
        <div class="m-title">${esc(p.title)}</div>
        <div class="m-meta">${p.year ? esc(p.year) + " · " : ""}${nAtt} 附件 · ${nCard} 卡</div></div>`;
    }), ui.nav === "papers" ? "暂无论文条目。" : "先在「文献整理」建立条目。");
  }
  if (ui.nav === "protocol") {
    const ps = state.protocols.filter((p) => !ui.topicId || p.topicId === ui.topicId);
    return arc(ps.map((p) => `<div class="material ${p.id === ui.protocolId ? "active" : ""}" data-pid="${p.id}">
      <div class="m-title">${esc(p.name)}</div>
      <div class="m-meta">${fmtEnum(p.sourceKind)} · ${p.revisions[p.revisions.length - 1].steps.length} 步</div></div>`), "本课题暂无方案。");
  }
  if (ui.nav === "record") {
    const es = state.executions.filter((e) => !ui.topicId || e.topicId === ui.topicId);
    return arc(es.map((e) => {
      const p = state.protocols.find((x) => x.id === e.protocolId);
      const prep = (e.phase ?? "recording") === "preparing";
      const badge = prep ? "准备稿" : fmtEnum(e.status);
      return `<div class="material ${e.id === ui.executionId ? "active" : ""}" data-eid="${e.id}">
        <div class="m-title">${esc(p?.name ?? "执行")} <span class="badge">${badge}</span>${e.origin === "reconstructed" ? ` <span class="badge warn">文献重构</span>` : ""}</div>
        <div class="m-meta">${prep ? `${e.preparation?.adjustments.length ?? 0} 条差异待确认` : `${e.events.length} 条记录`}</div></div>`;
    }), "暂无执行。");
  }
  if (ui.nav === "analysis") {
    const ts = state.analysisTasks.filter((t) => !ui.topicId || t.topicId === ui.topicId);
    return arc(ts.map((t) => `<div class="material ${t.id === ui.taskId ? "active" : ""}" data-atid="${t.id}">
      <div class="m-title">${esc(t.title)} ${t.recommendation ? `<span class="badge confirm">已推荐</span>` : `<span class="badge">待推荐</span>`}</div>
      <div class="m-meta">${t.resultIds.length} 个结果</div></div>`), "暂无分析任务。");
  }
  if (ui.nav === "chat") {
    const cs = state.chats.filter((c) => !ui.topicId || c.topicId === ui.topicId);
    return arc(cs.map((c) => {
      const q = state.subquestions.find((x) => x.id === c.subquestionId);
      const running = c.messages.some((m) => m.status === "running");
      return `<div class="material ${c.id === ui.chatId ? "active" : ""}" data-cid="${c.id}">
        <div class="m-title">${esc(q ? q.question : topicName(state, c.topicId) ?? "课题对话")}${running ? ` <span class="badge warn">进行中</span>` : ""}</div>
        <div class="m-meta">${c.scope.length} 个对象 · ${c.messages.length} 条消息</div></div>`;
    }), "暂无对话。");
  }
  return "";
}

/** 课题总览（首页中间区）。 */
export function topicOverviewHtml(state, ui) {
  const ts = ui.topicId ? state.topics.filter((t) => t.id === ui.topicId) : state.topics;
  if (!ts.length) return "";
  return ts.map((t) => {
    const papers = state.papers.filter((p) => p.topicIds.includes(t.id));
    const paperIds = new Set(papers.map((p) => p.id));
    const cards = state.cards.filter((c) => paperIds.has(c.paperId) || state.assets.find((a) => a.id === c.assetId)?.topicId === t.id);
    const confirmed = cards.filter((c) => c.audit === "confirm").length;
    const subqs = state.subquestions.filter((q) => q.topicId === t.id);
    const protos = state.protocols.filter((p) => p.topicId === t.id);
    const execs = state.executions.filter((e) => e.topicId === t.id);
    const tables = state.tables.filter((x) => state.assets.find((a) => a.id === x.assetId)?.topicId === t.id);
    return `<div class="item topiccard" data-id="${t.id}">
      <div class="meta"><strong>${esc(t.name)}</strong></div>
      <div>研究问题：${esc(t.researchQuestion)}</div>
      <div class="hint">子问题 ${subqs.length} · 论文 ${papers.length} · 知识卡 ${cards.length} · 已确认 ${confirmed}</div>
      <div class="hint">方案 ${protos.length} · 执行 ${execs.length}（进行中 ${execs.filter((e) => e.status === "active").length} · 已暂停 ${execs.filter((e) => e.status === "paused").length}）· 数据表 ${tables.length}</div>
    </div>`;
  }).join("");
}

/** 待办（首页右栏）：只列需要人动作的事。 */
export function topicTodosHtml(state, ui) {
  const inTopic = (topicId) => !ui.topicId || topicId === ui.topicId;
  const pendingCards = state.cards.filter((c) => ["unreviewed", "need_info"].includes(c.audit) && !c.mechanical && inTopic(state.papers.find((p) => p.id === c.paperId)?.topicIds[0] ?? state.assets.find((a) => a.id === c.assetId)?.topicId));
  const draftProtos = state.protocols.filter((p) => p.sourceKind === "ai-draft" && inTopic(p.topicId));
  const unconfTmpls = state.templates.filter((t) => !t.humanConfirmed && inTopic(state.protocols.find((p) => p.id === t.protocolId)?.topicId));
  const prepExecs = state.executions.filter((e) => (e.phase ?? "recording") === "preparing" && inTopic(e.topicId));
  const liveExecs = state.executions.filter((e) => e.status !== "done" && (e.phase ?? "recording") !== "preparing" && inTopic(e.topicId));
  const rows = [];
  if (pendingCards.length) rows.push(`<div class="item"><div class="meta">待审知识卡 ${pendingCards.length} 张</div><button class="goto" data-goto="knowledge">去审阅</button></div>`);
  if (draftProtos.length) rows.push(`<div class="item"><div class="meta">方案草稿 ${draftProtos.length} 份待确认</div><button class="goto" data-goto="protocol">去确认</button></div>`);
  if (unconfTmpls.length) rows.push(`<div class="item"><div class="meta">记录模板 ${unconfTmpls.length} 份待确认</div><button class="goto" data-goto="protocol">去确认</button></div>`);
  if (prepExecs.length) rows.push(`<div class="item"><div class="meta">执行准备稿 ${prepExecs.length} 份待确认</div><button class="goto" data-goto="record">去确认</button></div>`);
  if (liveExecs.length) rows.push(`<div class="item"><div class="meta">进行中/暂停的执行 ${liveExecs.length} 个</div><button class="goto" data-goto="record">去记录</button></div>`);
  if (!rows.length) rows.push(`<div class="item"><p class="hint">当前没有待办。</p></div>`);
  return rows.join("");
}

/** 课题首页的子问题块（列表＋新建）。 */
export function subqBlockHtml(state, ui) {
  const list = state.subquestions.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  return `<details class="mini subqbox" open><summary>子问题（${list.length}）</summary>
    <ul class="subq">${list.length
      ? list.map((s) => `<li class="${s.kind}">${esc(s.question)} <span class="hint">${fmtEnum(s.kind)}</span></li>`).join("")
      : `<li class="hint">暂无子问题</li>`}</ul>
    <input id="subq-q" placeholder="子问题" />
    <select id="subq-kind"><option value="declared">已定</option><option value="exploratory">探索中</option></select>
    <button id="subq-create">添加子问题</button></details>`;
}

/** 首页「下一步」：只给一条建议（按当前进度）。 */
export function nextStepHtml(state, ui) {
  const inTopic = (id) => (ui.topicId ? id === ui.topicId : true);
  const papers = state.papers.filter((p) => !p.topicIds.length || p.topicIds.some(inTopic));
  const pending = state.cards.filter((c) => ["unreviewed", "need_info"].includes(c.audit) && !c.mechanical);
  const protos = state.protocols.filter((p) => inTopic(p.topicId));
  const prep = state.executions.filter((e) => (e.phase ?? "recording") === "preparing" && inTopic(e.topicId));
  const tasks = state.analysisTasks.filter((t) => inTopic(t.topicId));
  let text, goto;
  if (!state.topics.length) { text = "创建课题（名称＋研究问题）"; goto = "topic"; }
  else if (!papers.length) { text = "导入文献（条目＋附件）"; goto = "papers"; }
  else if (pending.length) { text = `审阅 ${pending.length} 张知识卡`; goto = "knowledge"; }
  else if (!protos.length) { text = "建或导入实验方案"; goto = "protocol"; }
  else if (prep.length) { text = "确认执行准备稿快照"; goto = "record"; }
  else if (!tasks.length) { text = "建分析任务（选数据表）"; goto = "analysis"; }
  else { text = "撰写分析初稿"; goto = "analysis"; }
  return `<div class="item nextstep"><div class="meta">下一步</div><p>${esc(text)}</p><button class="goto" data-goto="${goto}">去这里</button></div>`;
}

export { esc, fmtVersion, fmtTime, fmtEnum, fmtNameOnce };
