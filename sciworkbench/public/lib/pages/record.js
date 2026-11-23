/**
 * 记录页纯渲染（DOM 无关）：记录总览（执行 / 数据表 / 样品三区）与样品详情子页。
 * 供 app.js 注入 innerHTML，也供 node:test 直接断言渲染文本（自动检查）。
 * 规则同 views.js：不出现 ISO 时间、英文枚举、裸版本号；时间/枚举/版本一律经 lib/format.js。
 */
import { esc } from "../views.js";
import { fmtTime, fmtEnum, fmtVersion } from "../format.js";
import { missingTag, reconTag } from "../refs.js";

/** 记录总览：执行 / 数据表 / 样品三区。 */
export function recordOverviewHtml(state, ui) {
  const execs = state.executions.filter((e) => !ui.topicId || e.topicId === ui.topicId);
  const tables = state.tables.filter((t) => { const a = state.assets.find((x) => x.id === t.assetId); return !ui.topicId || !a?.topicId || a.topicId === ui.topicId; });
  const samples = state.samples.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  const execRows = execs.length ? execs.map((e) => {
    const p = state.protocols.find((x) => x.id === e.protocolId);
    const prep = (e.phase ?? "recording") === "preparing";
    const badge = prep ? "准备稿" : fmtEnum(e.status);
    return `<article class="paper-item ${e.id === ui.executionId ? "active" : ""}" data-exrow="${e.id}">
      <div class="pi-main">
        <div class="pi-title">${esc(p?.name ?? "执行")}${e.origin === "reconstructed" ? ` <span class="badge warn">文献重构</span>` : ""}</div>
        <div class="pi-meta"><span class="badge ${e.status === "paused" ? "warn" : e.status === "active" ? "confirm" : ""}">${badge}</span> · ${prep ? `${e.preparation?.adjustments.length ?? 0} 条差异待确认` : `${e.events.length} 条记录`} · 固定 ${fmtVersion(e.protocolRevision)}</div>
      </div>
      <div class="pi-actions"><button class="mini-act rec-exec-open" type="button" data-exec="${e.id}">打开</button></div>
    </article>`;
  }).join("") : `<p class="hint">${state.topics.length ? "还没有执行；用上方「创建执行」从方案进入准备稿。" : "先建课题。"}</p>`;
  const tableRows = tables.length ? tables.map((t) => `<article class="paper-item">
    <div class="pi-main"><div class="pi-title">${esc(t.name)}</div><div class="pi-meta">${t.rows.length} 行 × ${t.columns.length} 列${t.origin === "reconstructed" ? " · 文献重构" : ""}</div></div>
    <div class="pi-actions"><button class="mini-act tbl-open" type="button" data-tid="${t.id}">查看表格</button></div>
  </article>`).join("") : `<p class="hint">还没有数据表；在「数据与分析」导入，或从论文数据重构。</p>`;
  const sampleRows = samples.length ? samples.map((s) => {
    const mOfS = state.measurements.filter((m) => m.sampleId === s.id);
    return `<article class="paper-item ${s.id === ui.sampleId ? "active" : ""}" data-smprow="${s.id}">
      <div class="pi-main"><div class="pi-title">${esc(s.displayName)}${s.shortName !== s.displayName ? ` <span class="hint">编号 ${esc(s.shortName)}</span>` : ""}${s.origin === "reconstructed" ? ` <span class="badge warn">文献重构</span>` : ""}</div>
        <div class="pi-meta">${s.states.length} 状态 · 测量 ${mOfS.length}</div></div>
      <div class="pi-actions"><button class="mini-act smp-open" type="button" data-smp-open="${s.id}">查看详情</button></div>
    </article>`;
  }).join("") : `<p class="hint">还没有样品；在「样品」工具区新建。</p>`;
  return `<div class="rec-overview">
    <section class="rec-sec"><h3>执行（${execs.length}）</h3>${execRows}</section>
    <section class="rec-sec"><h3>数据表（${tables.length}）</h3>${tableRows}</section>
    <section class="rec-sec"><h3>样品（${samples.length}）</h3>${sampleRows}<p class="hint">点「查看详情」进入单个样品的独立子页（状态追加历史与来源回链）；改名、追加状态、新建测量仍在「样品」工具区操作。</p></section>
  </div>`;
}

/** 样品详情子页：身份、状态追加历史（逐版保留）、来源回链（执行/方案/测量）。 */
export function sampleDetailHtml(state, ui) {
  const s = state.samples.find((x) => x.id === ui.sampleId);
  if (!s) return `<div class="smp-detail">
    <button class="back-btn" type="button" data-smp-back>← 返回记录总览</button>
    <p class="hint">这个样品已不存在，已回到记录总览。</p></div>`;
  const exec = s.executionId ? state.executions.find((e) => e.id === s.executionId) : null;
  const proto = exec ? state.protocols.find((p) => p.id === exec.protocolId) : null;
  const meas = state.measurements.filter((m) => m.sampleId === s.id);
  const last = s.states[s.states.length - 1];
  const execMissing = Boolean(s.executionId) && !exec;
  return `<div class="smp-detail">
    <button class="back-btn" type="button" data-smp-back>← 返回记录总览</button>
    <div class="subq-detail-head"><h2>${esc(s.displayName)}</h2><span class="badge">编号 ${esc(s.shortName)}</span>${reconTag(state, "sample", s.id) ? ` <span class="badge warn">文献重构</span>` : ""}</div>
    <section class="subq-sec"><h4>身份</h4>
      <div class="hint">显示名：${esc(s.displayName)} · 短号：${esc(s.shortName)}（短号稳定，改名不破引用）</div>
      <div class="hint">来源性质：${esc(fmtEnum(s.origin))}${s.origin === "reconstructed" ? "（历史文献重构，非本地样品）" : ""}</div>
      <div class="hint">当前总量：${esc(last?.amount.value ?? "—")} ${esc(last?.amount.unit ?? "")}${last?.amount.estimated ? "（估计）" : ""}</div>
    </section>
    <section class="subq-sec"><h4>状态追加历史（${s.states.length}，逐版保留不覆盖）</h4>
      ${s.states.length ? s.states.map((st) => `<div class="smp-state-row" data-rev="${st.revision}">
        <div class="meta">状态 ${fmtVersion(st.revision)}${st.revision === s.states.length ? ` <span class="badge confirm">当前</span>` : "（历史版）"} · ${esc(fmtTime(st.at))}</div>
        <div class="hint">用量 ${esc(st.amount.value)} ${esc(st.amount.unit)}${st.amount.estimated ? "（估计）" : ""}${st.handling ? ` · 处理：${esc(st.handling)}` : ""}${st.use ? ` · 用途：${esc(st.use)}` : ""}${st.note ? ` · 备注：${esc(st.note)}` : ""}</div>
      </div>`).join("") : `<p class="hint">暂无状态。</p>`}
    </section>
    <section class="subq-sec"><h4>来源回链</h4>
      ${exec ? `<div class="row"><span class="hint">来源执行：${esc(proto?.name ?? "执行")}${exec.origin === "reconstructed" ? "（文献重构）" : ""} · ${esc(fmtEnum(exec.status))} · 固定 ${fmtVersion(exec.protocolRevision)}</span><button class="mini-act smp-exec-open" type="button" data-exec="${exec.id}">打开执行详情</button></div>` : ""}
      ${exec && proto ? `<div class="row"><span class="hint">来源方案：${esc(proto.name)}</span><button class="mini-act smp-proto-open" type="button" data-proto-open="${proto.id}">打开方案</button></div>` : ""}
      ${exec && !proto ? `<div class="hint warn">来源方案缺失（执行无对应方案），来源不可溯。</div>` : ""}
      ${execMissing ? `<div class="hint warn">来源执行缺失（${esc(s.executionId)}），来源不可溯。</div>` : ""}
      ${!exec && !execMissing ? `<div class="hint">无直接执行来源（独立新建或公开样品）。</div>` : ""}
    </section>
    <section class="subq-sec"><h4>由本样品产生的测量（${meas.length}）</h4>
      ${meas.length ? meas.map((m) => `<div class="item meas" data-id="${m.id}">
        <div class="meta">测量 · ${esc(m.value)}${esc(m.unit)} · 固定样品状态 ${fmtVersion(m.sampleStateRevision)}${missingTag(state, "sample", m.sampleId) ? ` <span class="badge warn">样品缺失</span>` : ""}${reconTag(state, "measurement", m.id) ? ` <span class="badge warn">文献重构</span>` : ""}${m.cellRef ? ` · 回链表 行${m.cellRef.row}列${m.cellRef.col}` : ""}</div>
        <div class="hint">时间 ${esc(fmtTime(m.time))}${m.method ? ` · 方法：${esc(m.method)}` : ""}${m.instrument ? ` · 仪器：${esc(m.instrument)}` : ""}${m.note ? ` · 备注：${esc(m.note)}` : ""}</div>
        ${m.cellRef ? `<div class="row"><button class="mini-act tbl-open" type="button" data-tid="${m.cellRef.tableId}">查看回链表</button></div>` : ""}
      </div>`).join("") : `<p class="hint">暂无测量。</p>`}
    </section>
  </div>`;
}
