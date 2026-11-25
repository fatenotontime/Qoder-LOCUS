/**
 * 数据处理与分析页：渲染（纯函数）＋事件注册（bindAnalysis）。
 * 渲染函数无 DOM；事件走文档级委托、closest() 命中。
 * 行为与拆分前一致：DOM、文案、接口、请求时序均不变。
 */
import { esc } from "../views.js";
import { fmtVersion, fmtTime, fmtKind } from "../format.js";
import { humanVer, deIso, refLabel, reconTag, missingTag, depMissingNote, topicObjects } from "../refs.js";

let ctx = null;

const topicName = (state, id) => state.topics.find((t) => t.id === id)?.name;

export function currentTask(state, ui) { return state.analysisTasks.find((t) => t.id === ui.taskId) ?? null; }

// ── 当前选择（本次未保存的工作副本）：图与列表绑定同一份 ──────
const isDisplay = () => (typeof document !== "undefined" && document.documentElement.dataset.displayMode === "on");

/** 每个任务一份当前选择；首次从库内已存候选克隆，之后切换节点/勾选框即时同步。 */
export function selOf(ui, t) {
  const m = (ui.anSel ??= {});
  if (!m[t.id]) m[t.id] = t.optional.map((o) => ({ ref: o.ref, included: !!o.included }));
  return m[t.id];
}
export function resetSel(ui, t) { if (ui.anSel) delete ui.anSel[t.id]; }

/** 引用对象的可校验版本：能取到版本/更新时间的对象带版本，缺则不带（服务端按最新校验）。 */
function refVersion(state, r) {
  if (r.kind === "measurement" || r.kind === "table") return state.measurements?.find((x) => x.id === r.id)?.revision ?? state.tables?.find((x) => x.id === r.id)?.revision ?? null;
  if (r.kind === "execution") return state.executions?.find((x) => x.id === r.id)?.updatedAt ?? null;
  if (r.kind === "protocol") return state.protocols?.find((x) => x.id === r.id)?.revision ?? null;
  if (r.kind === "card") return state.cards?.find((x) => x.id === r.id)?.revision ?? null;
  return null;
}
function selectionVersions(state, t, optional) {
  const out = {};
  for (const r of [...t.core, ...optional.map((o) => o.ref)]) { const v = refVersion(state, r); if (v != null) out[`${r.kind}:${r.id}`] = v; }
  return out;
}

// ── 中栏「＋新建」：分析任务表单 ────────────────────────────

export function renderAnalysisForm(box) {
  const state = ctx.getState();
  const { ui, $, $$ } = ctx;
  if (!ui.topicId) { box.innerHTML = `<p class="hint">先在上方选择课题，再建分析任务。</p>`; return; }
  const { execs, tables, meas, protos, cards } = topicObjects(state, ui);
  const subqs = state.subquestions.filter((s) => s.topicId === ui.topicId);
  const conf = cards.filter((c) => c.audit === "confirm");
  const dataSources = [
    ...tables.map((t) => ({ kind: "table", id: t.id, label: refLabel(state, { kind: "table", id: t.id }) })),
    ...meas.map((m) => ({ kind: "measurement", id: m.id, label: refLabel(state, { kind: "measurement", id: m.id }) })),
  ];
  box.innerHTML = `
    <details class="mini" open>
      <summary>＋新建分析任务</summary>
      <input id="an-title" placeholder="任务标题（如 传播量级汇总）"/>
      <select id="an-subq"><option value="">（子问题）</option>${subqs.map((s) => `<option value="${s.id}">${esc(s.question)}</option>`).join("")}</select>
      <p class="hint">选择数据（必选，锁定且不可取消）：</p>
      ${dataSources.length ? dataSources.map((d) => `<label class="ctxpick"><input type="checkbox" class="an-data" data-kind="${d.kind}" data-id="${d.id}"/> ${esc(d.label)}</label>`).join("") : `<p class="hint">本课题暂无可分析数据（先导入数据表或记录测量）。</p>`}
      <p class="hint">默认已选（关联度高的已入候选知识卡，可取消）：</p>
      ${conf.length ? conf.map((c) => `<label class="ctxpick"><input type="checkbox" class="an-def" data-id="${c.id}" checked/> ${esc(c.scope || c.rawText.slice(0, 24))}</label>`).join("") : `<p class="hint">暂无已入候选卡。</p>`}
      <details class="mini"><summary>其他可选（折叠：方案/执行）</summary>
        ${protos.map((p) => `<label class="ctxpick"><input type="checkbox" class="an-opt2" data-kind="protocol" data-id="${p.id}"/> ${esc(refLabel(state, { kind: "protocol", id: p.id }))}</label>`).join("")}
        ${execs.map((e) => `<label class="ctxpick"><input type="checkbox" class="an-opt2" data-kind="execution" data-id="${e.id}"/> ${esc(refLabel(state, { kind: "execution", id: e.id }))}</label>`).join("")}
      </details>
      <button class="primary" id="an-create">创建任务（必选项自动锁定）</button>
    </details>`;
  $("#an-create").addEventListener("click", (ev) => ctx.runBusy(ev.target, "创建分析任务", async () => {
    const state2 = ctx.getState();
    const subqVal = $("#an-subq").value || "";
    if (!subqVal) { ctx.notify("mid", "请先选择子问题：分析任务必须归属到具体子问题。"); return; }
    const core = [...$$(".an-data:checked")].map((x) => ({ kind: x.dataset.kind, id: x.dataset.id }));
    if (!core.length) { ctx.notify("mid", "请至少选择一个数据表/测量作为必选数据。"); return; }
    // B5 必选自动推导：所选测量 → 样品 → 执行 → 方案，一并锁定为必选
    const seen = new Set(core.map((r) => `${r.kind}:${r.id}`));
    for (const d of [...core]) {
      if (d.kind !== "measurement") continue;
      const m = state2.measurements.find((x) => x.id === d.id);
      const s = m && state2.samples.find((x) => x.id === m.sampleId);
      if (s?.executionId && !seen.has(`execution:${s.executionId}`)) { seen.add(`execution:${s.executionId}`); core.push({ kind: "execution", id: s.executionId }); }
      const e = s?.executionId && state2.executions.find((x) => x.id === s.executionId);
      if (e && !seen.has(`protocol:${e.protocolId}`)) { seen.add(`protocol:${e.protocolId}`); core.push({ kind: "protocol", id: e.protocolId }); }
    }
    const optional = [
      ...[...$$(".an-def:checked")].map((x) => ({ ref: { kind: "card", id: x.dataset.id }, included: true })),
      ...[...$$(".an-opt2:checked")].map((x) => ({ ref: { kind: x.dataset.kind, id: x.dataset.id }, included: true })),
      ...[...$$(".an-def:not(:checked)")].map((x) => ({ ref: { kind: "card", id: x.dataset.id }, included: false })),
    ];
    const r = await ctx.api.createAnalysisTask({ topicId: ui.topicId, subquestionId: subqVal, title: $("#an-title").value, core, optional });
    ui.taskId = r.taskId; await ctx.refresh(); ctx.setStatus("分析任务已创建：必选数据已锁定（含关联执行/方案）");
  }));
}

// ── 中间：上下文地图 ────────────────────────────────────────

export function snapshotHtml(snap) {
  return `<details class="mini" open><summary>冻结上下文快照 · ${esc(snap.summary)}</summary>
    <p class="hint">目的：${esc(snap.purpose)}<br/>模型：${esc(snap.model)} · ${esc(fmtTime(snap.at))}<br/>hash：${esc(snap.hash)}</p>
    ${snap.fragments.map((f, i) => `<details class="mini"><summary>碎片 ${i + 1} · ${esc(f.label)} · ${esc(humanVer(f.version))} · ${esc(fmtKind(f.ref.kind))}:${f.ref.id}</summary><pre>${esc(deIso(humanVer(f.excerpt)))}</pre></details>`).join("")}
  </details>`;
}

export function contextMapHtml(state, ui, t) {
  const q = t.subquestionId ? state.subquestions.find((x) => x.id === t.subquestionId) : null;
  const refOpen = (r) => {
    if (r.kind === "table") return ` <button class="tbl-open" data-tid="${r.id}">查看表格</button>`;
    if (r.kind === "measurement") {
      const mr = state.measurements.find((x) => x.id === r.id);
      const tb = state.tables.find((x) => x.assetId === r.id) || (mr?.cellRef ? state.tables.find((t) => t.id === mr.cellRef.tableId) : null);
      return tb ? ` <button class="tbl-open" data-tid="${tb.id}">查看表格</button>` : ` <span class="hint">（无关联数据表）</span>`;
    }
    return "";
  };
  // 待补：库内找不到对象 / 缺关联 → 标记，不补造记录关系。
  const gap = (r) => {
    const miss = missingTag(state, r.kind, r.id);
    const dep = depMissingNote(state, r.kind, r.id);
    if (miss) return ` <span class="badge warn">待补（对象缺失）</span>`;
    if (dep) return ` <span class="badge warn">待补：${esc(dep)}</span>`;
    return "";
  };
  const sel = selOf(ui, t);
  const inc = sel.map((o, i) => ({ o, i })).filter(({ o }) => o.included);
  const others = sel.map((o, i) => ({ o, i })).filter(({ o }) => !o.included);
  const cand = ({ o, i }) => `<li><label><input type="checkbox" class="cand-toggle" data-idx="${i}" ${o.included ? "checked" : ""}/> ${esc(refLabel(state, o.ref))}${gap(o.ref)}</label>${refOpen(o.ref)}</li>`;
  return `
    <p><b>课题「${esc(topicName(state, t.topicId) ?? t.topicId)}」${q ? ` → 子问题「${esc(q.question)}」` : ` <span class="badge warn">子问题待选（推荐前必选）</span>`}</b></p>
    ${isDisplay() ? `<p class="hint">展示态：勾选可试选，只留在本页，不写回快照。</p>` : ""}
    <p class="hint">必选（锁定，不可取消）：</p>
    <ul>${t.core.map((r) => `<li>🔒 ${esc(refLabel(state, r))}${gap(r)}${refOpen(r)}</li>`).join("") || `<li class="hint">无</li>`}</ul>
    <p class="hint">默认已选（可取消）：</p>
    ${inc.length ? `<ul>${inc.map(cand).join("")}</ul>` : `<p class="hint">无。</p>`}
    ${others.length ? `<details class="mini"><summary>其他可选（${others.length}，折叠）</summary><ul>${others.map(cand).join("")}</ul></details>` : ""}
    ${sel.length ? `<button id="cand-save"${isDisplay() ? " disabled title=\"展示态不可保存\"" : ""}>保存候选选择</button>` : `<p class="hint">无候选。</p>`}
    ${t.snapshot ? snapshotHtml(t.snapshot) : ""}`;
}

// ── 右栏：推荐 / 结果 / 分析初稿 ────────────────────────────

const REPORT_NATURES = [["observation", "观察"], ["hypothesis", "假设"], ["interpretation", "解释"], ["to_verify", "待验证"], ["human_judgment", "人工判断"]];
const natureLabel = (n) => (REPORT_NATURES.find(([k]) => k === n)?.[1] ?? n);
const refDisplay = (r) => r.version ? `${r.label}（${humanVer(r.version)}）` : r.label;

/** 触发浏览器下载（本地服务带 content-disposition）。 */
function download(path) {
  const a = document.createElement("a");
  a.href = path; a.download = ""; document.body.append(a); a.click(); a.remove();
}

export function blockRowHtml(b, i, state, persisted = true) {
  const refLabels = (b.refs ?? []).map((r) => esc(r.label)).join("；");
  return `<div class="reprow" data-bid="${esc(b.id)}" data-draft="${b.draft ? "1" : ""}" data-refs="${esc(JSON.stringify(b.refs ?? []))}">
    <div class="repmove"><button class="rep-up" title="上移">↑</button><button class="rep-down" title="下移">↓</button><span class="hint">#${i + 1}</span></div>
    <select class="rep-nature">${REPORT_NATURES.map(([k, l]) => `<option value="${k}" ${k === b.nature ? "selected" : ""}>${l}</option>`).join("")}</select>
    <textarea class="rep-text" rows="2">${esc(b.text)}</textarea>
    <div class="rep-refs">${refLabels || `<span class="hint">（无引用）</span>`}</div>
    <div class="reprowactions">
      <span class="badge ${b.draft ? "warn" : "confirm"}">${b.draft ? "AI 草稿待确认" : "已确认"}</span>
      ${b.draft && persisted ? `<button class="rep-confirm">确认</button>` : ""}
      <button class="rep-del">删除</button>
    </div>
    ${(b.refs ?? []).filter((r) => r.kind !== "note").length ? `<div class="refchips">${b.refs.filter((r) => r.kind !== "note").map((r) => `<span class="refchip">${esc(refDisplay(r))}${state ? esc(reconTag(state, r.kind, r.id)) + esc(missingTag(state, r.kind, r.id)) : ""}${state && depMissingNote(state, r.kind, r.id) ? ` <span class="badge warn">${esc(depMissingNote(state, r.kind, r.id))}</span>` : ""} <button class="ref-back" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}">回查</button></span>`).join("")}</div>` : ""}
    <div class="refnet-body"></div></div>`;
}

/** 块列表 HTML：已落库块（id 见于库内）才渲染确认按钮；未保存新增/草稿块一律不渲染。 */
export function repBlocksHtml(blocks, state, rep) {
  const persisted = new Set(rep.blocks.map((b) => b.id).filter(Boolean));
  return blocks.map((b, i) => blockRowHtml(b, i, state, !!b.id && persisted.has(b.id))).join("") || `<p class="hint">尚无块。</p>`;
}

export function reportHtml(state, ui, r) {
  const blocks = (ui.reportWorking && ui.reportWorking[r.id]) || r.blocks;
  return `<details class="mini rep" data-repid="${r.id}" ${r.id === ui.reportId ? "open" : ""}><summary>分析初稿 ${fmtVersion(r.revision)} · 钉住 ${r.pinned.resultIds.length} 结果${r.pinned.snapshotHash ? ` · 快照 ${r.pinned.snapshotHash.slice(0, 8)}…` : ""}</summary>
    <p class="hint">块＝性质＋固定引用；改动→预览→新版本。</p>
    <div class="repblocks">${repBlocksHtml(blocks, state, r)}</div>
    <div class="repaddrow">
      <select class="rep-newnature">${REPORT_NATURES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <button class="rep-add">＋ 添加块</button>
      <button class="rep-draft">由任务生成草稿</button>
    </div>
    <input class="rep-reason" placeholder="修订原因（必填，留历史）"/>
    <div class="repaddrow">
      <button class="primary rep-preview">预览改动</button>
      <button class="rep-docx" data-repid="${r.id}">Word 导出</button>
      <button class="rep-trace" data-repid="${r.id}">追溯包</button>
    </div>
    <div class="rep-diff"></div>
    ${r.history.length ? `<details class="mini"><summary>历史（${r.history.length}）</summary>${r.history.map((h) => `<p class="hint">${fmtVersion(h.revision)} · ${esc(fmtTime(h.at))} · ${esc(h.reason)}</p>`).join("")}</details>` : ""}
  </details>`;
}

export function collectReportBlocks(repEl) {
  return [...repEl.querySelectorAll(".repblocks > .reprow")].map((row) => {
    let refs = [];
    try { refs = JSON.parse(row.dataset.refs || "[]"); } catch {}
    return { id: row.dataset.bid || undefined, nature: row.querySelector(".rep-nature").value, text: row.querySelector(".rep-text").value.trim(), refs, draft: row.dataset.draft === "1" };
  });
}

export function renderBlockDiff(el, diff, reportId) {
  if (diff.same) { el.innerHTML = `<p class="hint">未检测到块改动。</p>`; return; }
  const part = (label, arr, fmt) => arr.length ? `<p class="hint"><b>${label}</b> ${arr.map(fmt).join("；")}</p>` : "";
  el.innerHTML = `<div class="diffbox">
    ${part("新增", diff.added, (a) => `[${natureLabel(a.nature)}] ${esc(a.text)}`)}
    ${part("删除", diff.removed, (a) => `[${natureLabel(a.nature)}] ${esc(a.text)}`)}
    ${part("修改", diff.changed, (c) => `[${natureLabel(c.after.nature)}] ${esc(c.text)}（${c.fields.join("/")}）`)}
    ${part("顺序", diff.reordered, (o) => `#${o.from + 1}→#${o.to + 1}`)}
    <button class="primary rep-accept" data-repid="${reportId}" data-rev="${diff.baseRevision}">接受并保存为新版本</button></div>`;
}

export function resultHtml(state, r) {
  const atts = r.assetIds.map((id) => state.assets.find((a) => a.id === id)).filter(Boolean);
  return `<details class="mini"><summary>结果 · ${esc(r.method)} ${r.reproducible ? `<span class="badge confirm">可复现</span>` : `<span class="badge warn">不可复现</span>`} · ${fmtVersion(r.revision)}</summary>
    <p>参数：${esc(r.params) || "（未填）"}</p>
    ${r.adoptedRecommendation ? `<p class="hint">采纳推荐：${esc(r.adoptedRecommendation)}</p>` : r.reason ? `<p class="hint">不采纳理由：${esc(r.reason)}</p>` : ""}
    ${r.note ? `<p class="hint">备注：${esc(r.note)}</p>` : ""}
    ${r.missing.length ? `<p class="hint">缺项：${r.missing.map(esc).join("；")}</p>` : ""}
    <p class="hint">附件：${atts.map((a) => esc(a.name)).join("、") || "无"}</p>
    <details class="mini"><summary>修订结果（留历史）</summary>
      <div class="resedit" data-rid="${r.id}">
        <input data-field="method" value="${esc(r.method)}"/>
        <textarea data-field="params" rows="2">${esc(r.params)}</textarea>
        <input data-field="note" value="${esc(r.note)}" placeholder="备注"/>
        <input data-field="reason" placeholder="修订原因（必填）"/>
        <button class="res-edit-save">保存修订</button>
      </div></details>
    ${r.history.length ? `<details class="mini"><summary>历史（${r.history.length}）</summary>${r.history.map((h) => `<p class="hint">${fmtVersion(h.revision)} · ${esc(fmtTime(h.at))} · ${esc(h.reason)} · 方法 ${esc(h.method)}</p>`).join("")}</details>` : ""}
  </details>`;
}

/** B5：核心数据在快照之后是否被更新（用于「需要复核」提示）。 */
export function analysisUpstreamChanged(state, t) {
  if (!t.snapshot) return false;
  const at = t.snapshot.at;
  const changedAfter = (obj) => { const h = obj?.history ?? []; const last = h.length ? h[h.length - 1].at : (obj?.createdAt ?? ""); return last > at; };
  for (const r of t.core) {
    if (r.kind === "measurement") { const m = state.measurements.find((x) => x.id === r.id); if (m && changedAfter(m)) return true; }
    if (r.kind === "table") { const tb = state.tables.find((x) => x.id === r.id); if (tb && changedAfter(tb)) return true; }
    if (r.kind === "execution") { const e = state.executions.find((x) => x.id === r.id); if (e && (e.updatedAt ?? "") > at) return true; }
  }
  return false;
}

export function analysisRightHtml(state, ui) {
  const t = currentTask(state, ui);
  if (!t) return `<p class="hint">选择分析任务后：这里做推荐、提交结果、写分析初稿。</p>`;
  const rec = t.recommendation;
  const results = t.resultIds.map((id) => state.analysisResults.find((r) => r.id === id)).filter(Boolean);
  const reps = state.reports.filter((r) => r.taskId === t.id);
  let h = "";
  if (t.snapshot && ui.suppressRecheck !== t.id && analysisUpstreamChanged(state, t)) {
    h += `<div class="item recheck"><div class="meta">需要复核</div><p class="hint">核心数据在快照之后有更新，当前分析基于旧快照。</p>
      <div class="row"><button class="primary" id="an-recheck">重新推荐（新快照）</button><button id="an-keep">保留旧快照</button></div></div>`;
  }
  h += `<details class="mini" open><summary>确认范围并推荐（含验收项；预期产物≠预设结论）</summary>
    <textarea id="an-purpose" rows="2" placeholder="研究目的（必填，如：估计 pH3 下酶活半衰期并比较 pH5）"></textarea>
    ${t.subquestionId ? "" : `<p class="hint warn">本次任务未选子问题：推荐前请先在「＋新建」或任务里选定子问题。</p>`}
    <button class="primary" id="an-recommend"${t.subquestionId ? "" : " disabled"}>${rec ? "确认并重新推荐（生成新快照）" : "确认范围并推荐"}</button>`;
  if (ui.anRecheck === t.id && ui.anRecheckList?.length) {
    h += `<div class="item recheck"><div class="meta">范围被改动，已阻止本次推荐</div><p class="hint">这些对象在期间改版，请复核后再提交：${ui.anRecheckList.map((x) => esc(x)).join("、")}。</p>
      <p class="hint">当前选择已保留。</p></div>`;
  }
  if (rec) {
    h += rec.methods.map((m) => `<div class="item"><b>${esc(m.name)}</b> · 软件：${esc(m.software)}<p>${esc(m.rationale)}</p>
      <p class="hint">预期产物：${m.expectedArtifacts.map(esc).join("；") || "（未列）"}</p>
      <p class="hint">验收项：${m.acceptanceItems.map(esc).join("；") || "（未列）"}</p></div>`).join("");
    if (rec.unknowns.length) h += `<p class="hint">未知/待补：${rec.unknowns.map(esc).join("；")}</p>`;
    h += `<details class="mini"><summary>AI 原始返回</summary><pre>${esc(rec.raw)}</pre></details>`;
  }
  h += `</details>`;
  h += `<details class="mini" ${results.length ? "" : "open"}><summary>提交处理结果（Origin/MATLAB 等外部工具允许）</summary>
    <input id="res-method" placeholder="实际使用的方法（如 Origin 双指数衰减拟合）"/>
    <textarea id="res-params" rows="2" placeholder="关键参数（拟合区间/初值/软件版本等；缺参数不标可复现）"></textarea>
    <select id="res-adopt"><option value="">未采纳推荐（须填理由）</option>${(rec?.methods ?? []).map((m) => `<option value="${esc(m.name)}">采纳：${esc(m.name)}</option>`).join("")}</select>
    <input id="res-reason" placeholder="不采纳理由（简短）"/>
    <input id="res-note" placeholder="备注（可选）"/>
    <input id="res-files" type="file" multiple accept=".csv,.tsv,.json,.txt,.md,.png,.jpg,.jpeg,.webp"/>
    <p class="hint">只有图/脚本也可提交，但不标「可复现」；附数据文件（csv/tsv/json/txt/md）＋关键参数才可复现。</p>
    <button class="primary" id="res-submit">提交结果</button></details>`;
  h += results.map((r) => resultHtml(state, r)).join("");
  if (results.length && t.snapshot) h += `<details class="mini"><summary>本次固定快照（结果据此产出，可回看）</summary>${snapshotHtml(t.snapshot)}</details>`;
  h += `<details class="mini" open><summary>分析初稿（有序块 · 性质 · 固定引用 · 仅供参考，非最终结论）</summary>
    <button id="rep-create">新建初稿（钉住结果）</button>
    ${reps.map((r) => reportHtml(state, ui, r)).join("") || `<p class="hint">暂无报告。</p>`}</details>`;
  return h;
}

// ── 事件 ────────────────────────────────────────────────────

function readTextFile(file) {
  return new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsText(file); });
}

/** 报告编辑工作副本：未保存改动暂存于 ui.reportWorking[reportId]，refresh 后据此重渲染；接受后清空回落到库内状态。 */
function reportOf(box) {
  const id = box?.dataset?.repid;
  return id ? ctx.getState().reports.find((r) => r.id === id) ?? null : null;
}
function workingOf(rep) {
  const m = (ctx.ui.reportWorking ??= {});
  return (m[rep.id] ??= rep.blocks.map((b) => ({ ...b })));
}
function rowIndex(box, row) {
  return [...box.querySelectorAll(".repblocks > .reprow")].indexOf(row);
}
function renderRepBlocks(box, rep) {
  const holder = box.querySelector(".repblocks");
  if (holder) holder.innerHTML = repBlocksHtml(workingOf(rep), ctx.getState(), rep);
}

export function bindAnalysis(c) {
  ctx = c;
  const { api, ui, $, $$, refresh, refreshAfterJob, runBusy, runJob } = ctx;

  // 中栏：保存候选选择（cand-save）
  document.querySelector("#mid-content").addEventListener("click", async (ev) => {
    if (ev.target.id === "cand-save") {
      if (isDisplay()) { ctx.notify("mid", "展示态不可保存：试选只留在本页。"); return; }
      const t = currentTask(ctx.getState(), ui); if (!t) return;
      await runBusy(ev.target, "保存候选", async () => {
        const sel = selOf(ui, t);
        await api.setTaskCandidates(t.id, sel.map((o) => ({ ref: o.ref, included: o.included })));
        resetSel(ui, t); await refresh(); ctx.setStatus("候选选择已保存（旧快照不受影响）");
      }); return;
    }
  });

  // 中栏：勾选框即时同步到当前选择（不重渲染，保留滚动）
  document.querySelector("#mid-content").addEventListener("change", (ev) => {
    if (!ev.target.classList?.contains("cand-toggle")) return;
    const t = currentTask(ctx.getState(), ui); if (!t) return;
    const sel = selOf(ui, t); const i = Number(ev.target.dataset.idx);
    if (sel[i]) { sel[i].included = ev.target.checked; ctx.setDirty(true); }
  });

  // 右栏：分析相关动作（推荐 / 结果 / 报告 / 回查 / 导出）
  document.querySelector("#right-content").addEventListener("click", async (ev) => {
    try {
      if (ev.target.id === "an-recommend") {
        const t = currentTask(ctx.getState(), ui); if (!t) return;
        if (!t.subquestionId) { ctx.notify("right", "本次任务未选子问题：先补选子问题再推荐。"); return; }
        const purpose = $("#an-purpose").value.trim();
        if (!purpose) { ctx.notify("right", "推荐须写明研究目的。"); return; }
        const sel = selOf(ui, t);
        await runJob(ev.target, "方法推荐", async () => {
          let r;
          try {
            r = await api.recommendMethods(t.id, purpose, {
              subquestionId: t.subquestionId,
              optional: sel.map((o) => ({ ref: o.ref, included: o.included })),
              versions: selectionVersions(ctx.getState(), t, sel),
            });
          } catch (e) {
            const code = String(e?.details?.code ?? "");
            if (e?.status === 409 || /version|stale|conflict|改版|recheck/.test(code)) {
              const objs = e?.details?.objects ?? e?.details?.conflicts ?? [];
              ui.anRecheck = t.id;
              ui.anRecheckList = objs.map((x) => (typeof x === "string" ? x : x.label ?? `${x.kind}:${x.id}`));
              ctx.renderRight(); ctx.setStatus("范围已变：本次推荐已阻止，当前选择已保留");
              return;
            }
            throw e;
          }
          ui.anRecheck = null; ui.anRecheckList = null;
          ctx.setStatus(`快照已冻结 ${r.snapshotHash.slice(0, 12)}…`);
          await ctx.pollJob(r.jobId, "方法推荐");
          resetSel(ui, t);
          await refreshAfterJob(); ctx.setStatus("方法推荐完成（含验收项）");
        }); return;
      }
      if (ev.target.id === "res-submit") {
        const t = currentTask(ctx.getState(), ui); if (!t) return;
        await runBusy(ev.target, "提交结果", async () => {
          const attachments = [];
          for (const f of [...($("#res-files").files ?? [])]) {
            const content = /^image\/(png|jpeg|webp)$/.test(f.type)
              ? await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f); })
              : await readTextFile(f);
            attachments.push({ name: f.name, content });
          }
          const r = await api.submitResult(t.id, { method: $("#res-method").value, params: $("#res-params").value, reason: $("#res-reason").value, note: $("#res-note").value, adoptedRecommendation: $("#res-adopt").value || undefined, attachments });
          await refresh(); ctx.setStatus(r.reproducible ? "结果已提交：可复现" : `结果已提交（不可复现：${r.missing.join("；")}）`);
        }); return;
      }
      if (ev.target.classList.contains("res-edit-save")) {
        const box = ev.target.closest(".resedit"); const rid = box.dataset.rid;
        const before = ctx.getState().analysisResults.find((r) => r.id === rid);
        const v = (f) => box.querySelector(`[data-field="${f}"]`).value;
        await runBusy(ev.target, "修订结果", async () => {
          await api.editResult(rid, { method: v("method"), params: v("params"), note: v("note"), reason: v("reason") });
          const fields = [];
          if (before) { if (v("params") !== before.params) fields.push("params"); if (v("method") !== before.method) fields.push("method"); }
          ctx.setDirty(false); await refresh(); ctx.setStatus("结果已修订（留历史，可复现性重算）");
          await ctx.noteChangeHits("result", rid, fields);
        }); return;
      }
      if (ev.target.id === "rep-create") {
        const t = currentTask(ctx.getState(), ui);
        await runBusy(ev.target, "新建报告", async () => {
          const r = await api.createReport(ui.topicId || t?.topicId, t?.id);
          ui.reportId = r.reportId; await refresh(); ctx.setStatus("初稿已建（钉住结果与快照）");
        }); return;
      }
      if (ev.target.classList.contains("rep-add")) {
        const box = ev.target.closest(".rep"); const rep = reportOf(box); if (!rep) return;
        const nature = box.querySelector(".rep-newnature").value;
        workingOf(rep).push({ id: "", nature, text: "", refs: [], draft: false });
        renderRepBlocks(box, rep);
        ctx.setDirty(true); return;
      }
      if (ev.target.classList.contains("rep-del")) {
        const box = ev.target.closest(".rep"); const rep = reportOf(box); if (!rep) return;
        const idx = rowIndex(box, ev.target.closest(".reprow"));
        if (idx >= 0) workingOf(rep).splice(idx, 1);
        renderRepBlocks(box, rep);
        ctx.setDirty(true); return;
      }
      if (ev.target.classList.contains("rep-up") || ev.target.classList.contains("rep-down")) {
        const box = ev.target.closest(".rep"); const rep = reportOf(box); if (!rep) return;
        const w = workingOf(rep); const idx = rowIndex(box, ev.target.closest(".reprow"));
        const j = ev.target.classList.contains("rep-up") ? idx - 1 : idx + 1;
        if (idx >= 0 && j >= 0 && j < w.length) { [w[idx], w[j]] = [w[j], w[idx]]; renderRepBlocks(box, rep); ctx.setDirty(true); }
        return;
      }
      if (ev.target.classList.contains("ref-back")) {
        const body = ev.target.closest(".reprow").querySelector(".refnet-body");
        const kind = ev.target.dataset.kind, id = ev.target.dataset.id;
        await runJob(ev.target, "来源回查", async () => {
          const r = await api.backtrace(kind, id, "both");
          const byKind = {};
          for (const n of r.nodes) (byKind[n.kind] ??= []).push(n.label);
          body.innerHTML = `<div class="diffbox">${Object.entries(byKind).map(([k, arr]) => `<p class="hint"><b>${esc(fmtKind(k))}</b> ${arr.map(esc).join("、")}</p>`).join("")}${r.pending.length ? `<p class="hint">缺项：${r.pending.map(esc).join("；")}</p>` : ""}</div>`;
          ctx.setStatus(`回查 ${r.nodes.length} 个节点`);
        }); return;
      }
      if (ev.target.classList.contains("rep-docx")) { download(`/api/reports/${encodeURIComponent(ev.target.dataset.repid)}/export.docx`); ctx.setStatus("Word 已导出（快照，外部编辑不回流）"); return; }
      if (ev.target.classList.contains("rep-trace")) { download(`/api/reports/${encodeURIComponent(ev.target.dataset.repid)}/traceability.zip`); ctx.setStatus("追溯包已导出（含版本索引/许可过滤/manifest）"); return; }
      if (ev.target.classList.contains("rep-confirm")) {
        const box = ev.target.closest(".rep"); const repId = box.dataset.repid;
        const bid = ev.target.closest(".reprow").dataset.bid;
        await runBusy(ev.target, "确认草稿块", async () => {
          await api.confirmReportBlock(repId, bid, "已人工核对");
          const w = ui.reportWorking?.[repId]; const b = w?.find((x) => x.id === bid); if (b) b.draft = false;
          await refresh(); ctx.setStatus("AI 草稿块已人工确认");
        }); return;
      }
      if (ev.target.classList.contains("rep-draft")) {
        const box = ev.target.closest(".rep"); const repId = box.dataset.repid;
        await runBusy(ev.target, "生成草稿", async () => {
          const r = await api.draftReport(repId);
          const rep = reportOf(box); if (!rep) return;
          const w = workingOf(rep);
          for (const b of (r.blocks ?? [])) w.push({ ...b, id: "" });
          renderRepBlocks(box, rep);
          ctx.setDirty(true); ctx.setStatus(`草稿块 ${r.blocks.length} 个已入编辑器（未保存，须预览→接受）`);
        }); return;
      }
      if (ev.target.classList.contains("rep-preview")) {
        const box = ev.target.closest(".rep"); const repId = box.dataset.repid;
        let blocks;
        try { blocks = collectReportBlocks(box); }
        catch (e) { const h = ctx.humanError(e); ctx.setError("right", { panel: "right", message: h.message, detail: h.detail, retry: null }); return; }
        if (!blocks.length) { ctx.notify("right", "至少需要一个块。"); return; }
        await runBusy(ev.target, "预览改动", async () => {
          const r = await api.previewReport(repId, blocks);
          renderBlockDiff(box.querySelector(".rep-diff"), r.diff, repId);
          ctx.setStatus(r.diff.same ? "未检测到改动。" : "已生成块级 diff，确认后接受为新版本。");
        }); return;
      }
      if (ev.target.classList.contains("rep-accept")) {
        const box = ev.target.closest(".rep"); const repId = ev.target.dataset.repid; const baseRevision = Number(ev.target.dataset.rev);
        const reason = box.querySelector(".rep-reason").value.trim();
        if (!reason) { ctx.notify("right", "报告修订必须填写原因（留历史）。"); return; }
        const blocks = collectReportBlocks(box);
        await runBusy(ev.target, "接受改动", async () => {
          const r = await api.applyReport(repId, baseRevision, blocks, reason);
          if (ui.reportWorking) delete ui.reportWorking[repId];
          ui.reportId = repId; ctx.setDirty(false); await refresh(); ctx.setStatus(`改动已接受：新版本 ${fmtVersion(r.revision)}（留历史）`);
        }); return;
      }
    } catch (e) { const h = ctx.humanError(e); ctx.setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); }
  });

  // 右栏：报告块内联编辑 —— 文本/性质实时写入工作副本，refresh 不丢已改内容（N5）。
  const syncRepField = (ev) => {
    const el = ev.target, cls = el?.classList;
    if (!cls || !(cls.contains("rep-text") || cls.contains("rep-nature"))) return;
    const box = el.closest(".rep"); const rep = reportOf(box); if (!rep) return;
    const idx = rowIndex(box, el.closest(".reprow")); if (idx < 0) return;
    const b = workingOf(rep)[idx]; if (!b) return;
    if (cls.contains("rep-text")) b.text = el.value; else b.nature = el.value;
  };
  document.querySelector("#right-content").addEventListener("input", syncRepField);
  document.querySelector("#right-content").addEventListener("change", syncRepField);

  // 文档级：上游复核（重算 / 保留旧快照）
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.id === "an-recheck") {
      const task = currentTask(ctx.getState(), ui); if (!task?.snapshot) return;
      runJob(t, "重新推荐", async () => { const r = await api.recommendMethods(task.id, task.snapshot.purpose); await ctx.pollJob(r.jobId, "方法推荐"); ui.suppressRecheck = null; await refreshAfterJob(); ctx.setStatus("已按新快照重新推荐"); });
      return;
    }
    if (t.id === "an-keep") { const task = currentTask(ctx.getState(), ui); ui.suppressRecheck = task?.id ?? null; ctx.renderRight(); ctx.setStatus("保留旧快照（已忽略复核提示）"); return; }
  });
}
