/**
 * 纯渲染函数（DOM 无关）：外壳、侧栏列表、课题总览/待办、分区报错。
 * 供 app.js 注入 innerHTML，也供 node:test 直接断言渲染文本（自动检查）。
 * 规则：不出现 ISO 时间、英文枚举、裸版本号、docs/ 路径；时间/枚举/版本一律经 lib/format.js。
 */
import { fmtTime, fmtEnum, fmtVersion, fmtNameOnce } from "./format.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const topicName = (state, id) => state.topics.find((t) => t.id === id)?.name;

export const NAV_ITEMS = [
  ["topic", "课题展示"], ["papers", "文献整理"], ["knowledge", "领域知识积累"],
  ["protocol", "实验方案管理"], ["record", "实验执行与记录"], ["analysis", "数据处理与分析"], ["chat", "上下文 AI 对话"],
];

/** 页头「当前课题」：单课题显示名称，多课题下拉，无课题显示提示。 */
export function topbarTopicHtml(state, ui) {
  if (!state.topics.length) return `<span class="curtopic none">尚无课题</span>`;
  if (state.topics.length === 1) return `<span class="curtopic">当前课题：<b>${esc(state.topics[0].name)}</b></span>`;
  return `<label class="curtopic">当前课题
    <select id="topic-select">${state.topics.map((t) => `<option value="${t.id}" ${t.id === ui.topicId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`;
}

/** 无课题时中间区引导：只留「创建课题（名称＋研究问题）」。 */
export function emptyTopicGuideHtml() {
  return `<div class="item empty-guide"><div class="meta">开始：创建课题</div>
    <p class="hint">只需名称与研究问题即可开始，不需要先准备材料。</p>
    <input id="topic-name" placeholder="课题名称" />
    <input id="topic-q" placeholder="研究问题" />
    <button class="primary" id="topic-create">创建课题</button></div>`;
}

/** 侧栏上层：七个导航项（全站可折叠，默认展开）。 */
export function navHtml(ui, collapsed) {
  return `<button class="navtoggle" id="nav-toggle" title="${collapsed ? "展开导航" : "收起导航"}">${collapsed ? "»" : "«"}</button>
    <div class="navitems">${NAV_ITEMS.map(([k, label]) =>
      `<button class="navitem ${k === ui.nav ? "active" : ""}" data-nav="${k}" title="${esc(label)}"><span class="navico">${esc(label[0])}</span><span class="navlabel">${esc(label)}</span></button>`).join("")}</div>`;
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

/** 侧栏下层：本页列表。 */
export function sidebarListHtml(state, ui) {
  const arc = (rows, empty) => rows.length ? rows.join("") : `<p class="hint">${empty}</p>`;
  if (ui.nav === "topic") return "";
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
