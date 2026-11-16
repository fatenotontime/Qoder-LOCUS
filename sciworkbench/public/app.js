// LOCUS 三栏工作台前端（本地开发版）。
// 左：课题/子问题/材料与导入；中：原始材料（可高亮定位）；右：结构化结果与核对。
// 防护：所有写操作禁用按钮 + 处理中提示 + 内联错误 + 可重试；离开前脏检查。
import { api } from "./lib/api.js";
import { computeLanes, timeLabel } from "./lib/lanes.js";

let state = { topics: [], subquestions: [], assets: [], cards: [], tables: [], adoptions: [], mappings: [], comparisons: [], protocols: [], templates: [], executions: [], samples: [], measurements: [], impacts: [], ocrs: [] };
const ui = { nav: "literature", topicId: "", assetId: null, tableId: null, highlight: null, cell: null, dirty: false, busy: false, cardFilter: "all", groupSel: new Set(), batch: null, ack: false, protocolId: null, executionId: null, stepSel: null, viewRev: null, editEventId: null, pauseSuggest: null };
let lastAction = null; // { label, run }

// 选择态持久（仅非敏感 UI 选择：页签/课题/材料/表块），刷新后归属正确。
const UI_KEY = "locus.ui.v1";
let uiRestored = false;
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ nav: ui.nav, topicId: ui.topicId, assetId: ui.assetId, tableId: ui.tableId, cardFilter: ui.cardFilter, protocolId: ui.protocolId, executionId: ui.executionId })); } catch {}
}
function restoreUi() {
  if (uiRestored) return;
  uiRestored = true;
  try {
    const s = JSON.parse(localStorage.getItem(UI_KEY) ?? "null");
    if (!s) return;
    if (["literature", "measurement", "protocol", "record"].includes(s.nav)) ui.nav = s.nav;
    if (s.cardFilter === "all" || s.cardFilter === "pending" || s.cardFilter === "reviewed") ui.cardFilter = s.cardFilter;
    if (state.topics.some((t) => t.id === s.topicId)) ui.topicId = s.topicId;
    if (state.assets.some((a) => a.id === s.assetId)) ui.assetId = s.assetId;
    if (state.tables.some((t) => t.id === s.tableId)) ui.tableId = s.tableId;
    if (state.protocols.some((p) => p.id === s.protocolId)) ui.protocolId = s.protocolId;
    if (state.executions.some((e) => e.id === s.executionId)) ui.executionId = s.executionId;
  } catch {}
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const topicName = (id) => state.topics.find((t) => t.id === id)?.name;

async function refresh() {
  state = await api.getState();
  restoreUi();
  if (ui.assetId && !state.assets.some((a) => a.id === ui.assetId)) ui.assetId = null;
  if (ui.tableId && !state.tables.some((t) => t.id === ui.tableId)) ui.tableId = null;
  if (ui.topicId && !state.topics.some((t) => t.id === ui.topicId)) ui.topicId = "";
  if (ui.protocolId && !state.protocols.some((p) => p.id === ui.protocolId)) ui.protocolId = null;
  if (ui.executionId && !state.executions.some((e) => e.id === ui.executionId)) ui.executionId = null;
  renderAll();
}

function setStatus(m) { $("#status").textContent = m; }

/** 按 BOM 解码文本文件（UTF-8 / UTF-16LE / UTF-16BE），避免 UTF-16 仪器导出被误判。 */
async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let enc = "utf-8";
  if (u8[0] === 0xff && u8[1] === 0xfe) enc = "utf-16le";
  else if (u8[0] === 0xfe && u8[1] === 0xff) enc = "utf-16be";
  return new TextDecoder(enc).decode(buf).replace(/^\uFEFF/, "");
}
function showBanner(msg, retry) {
  const b = $("#banner"); b.hidden = false; b.className = "banner error";
  b.innerHTML = `<span>${esc(msg)}</span>`;
  if (retry) {
    const btn = document.createElement("button"); btn.textContent = "重试"; btn.className = "primary";
    btn.addEventListener("click", async () => { hideBanner(); if (ui.busy) return; try { await retry(); } catch (e) { showBanner(String(e.message ?? e), retry); } });
    b.appendChild(btn);
  }
}
function hideBanner() { $("#banner").hidden = true; }

/** 所有写操作：禁用按钮 + 处理中 + 错误内联 + 可重试。 */
async function runBusy(btn, label, fn) {
  if (ui.busy) return;
  ui.busy = true; hideBanner();
  const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "处理中…"; }
  lastAction = { label, run: () => runBusy(btn, label, fn) };
  setStatus(`${label}…`);
  try { await fn(); }
  catch (e) { showBanner(`${label}失败：${e.message ?? e}`, lastAction.run); }
  finally { ui.busy = false; if (btn) { btn.disabled = false; btn.textContent = old; } }
}

function materials() {
  return state.assets.filter((a) => a.kind === ui.nav && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
}
function currentAsset() { return state.assets.find((a) => a.id === ui.assetId) ?? null; }

/** 切换前脏检查；返回 true 表示可离开。 */
function guardLeave() {
  if (!ui.dirty) return true;
  if (confirm("当前有未保存的编辑，确定离开？未保存内容会丢失。")) { ui.dirty = false; return true; }
  return false;
}

function renderAll() {
  setStatus(`课题 ${state.topics.length} · 材料 ${state.assets.length} · 证据卡 ${state.cards.length} · 表格 ${state.tables.length} · 方案 ${state.protocols.length} · 执行 ${state.executions.length} · 样品 ${state.samples.length}`);
  $$(".navitem").forEach((x) => x.classList.toggle("active", x.dataset.nav === ui.nav));
  renderTopics(); renderSubq(); renderImportBox(); renderMaterials(); renderLitTools(); renderMiddle(); renderRight();
  saveUi();
}

function renderTopics() {
  $("#topic-select").innerHTML = [`<option value="">（全部课题）</option>`]
    .concat(state.topics.map((t) => `<option value="${t.id}" ${t.id === ui.topicId ? "selected" : ""}>${esc(t.name)}</option>`)).join("");
}
function renderSubq() {
  const list = state.subquestions.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  $("#subq-list").innerHTML = list.length
    ? list.map((s) => `<li class="${s.kind}">${esc(s.question)} <span class="hint">(${s.kind})</span></li>`).join("")
    : `<li class="hint">暂无子问题${ui.topicId ? "" : "（先选课题）"}</li>`;
}
function renderImportBox() {
  const hints = {
    literature: "文献：上传 Markdown/纯文本，或粘贴文本（其他格式解析器未配置）",
    measurement: "实验数据：上传/粘贴 CSV（保留表格结构）",
    protocol: "方案：手工创建或从文献 AI 解析；版本固定，编辑追加新快照",
    record: "记录：按固定方案版本执行；实际层编辑不改源方案",
  };
  $("#nav-hint").textContent = hints[ui.nav] ?? "";
  const box = $("#import-box");
  if (ui.nav === "protocol") { renderProtocolImport(box); return; }
  if (ui.nav === "record") { renderRecordImport(box); return; }
  if (ui.nav === "literature") {
    box.innerHTML = `
      <details class="mini" ${state.assets.length ? "" : "open"}>
        <summary>导入文献</summary>
        <input id="lit-name" placeholder="来源名称（如 SLAC methods-source.md）" />
        <input id="lit-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" />
        <textarea id="lit-text" rows="3" placeholder="或粘贴 Markdown/文本…"></textarea>
        <div class="row"><select id="lit-mode"><option value="draft">draft 草稿</option><option value="ai">AI 抽取</option></select>
        <button class="primary" id="lit-import">导入</button></div>
      </details>`;
    $("#lit-import").addEventListener("click", (ev) => runBusy(ev.target, "导入文献", async () => {
      const file = $("#lit-file").files?.[0];
      let text = $("#lit-text").value, name = $("#lit-name").value;
      if (file) { text = await readTextFile(file); if (!name) name = file.name; }
      const mode = $("#lit-mode").value;
      const r = await api.importLiterature(name, text, mode, ui.topicId || undefined);
      $("#lit-text").value = ""; if ($("#lit-file")) $("#lit-file").value = "";
      if (r.jobId) {
        for (let i = 0; i < 1200; i++) {
          const job = await api.getJob(r.jobId);
          setStatus(`AI 抽取：${job.message}`);
          if (job.status === "done") { ui.assetId = job.result.assetId; await refresh(); setStatus(`AI 导入成功：${job.result.created} 张证据卡`); if (job.result.reminder) showReminder(); return; }
          if (job.status === "error") throw new Error(job.error || "AI 抽取失败");
          await new Promise((res) => setTimeout(res, 700));
        }
        throw new Error("AI 抽取等待超时（请查看服务日志）");
      }
      await refresh(); ui.assetId = r.assetId; renderAll();
      setStatus(`导入成功：${r.created} 张证据卡（draft）`);
      if (r.reminder) showReminder();
    }));
  } else {
    box.innerHTML = `
      <details class="mini" ${state.assets.length ? "" : "open"}>
        <summary>导入实验数据（CSV）</summary>
        <input id="meas-name" placeholder="文件名（如 EnzymeML_SLAC_pH3__Data.csv）" />
        <input id="meas-file" type="file" accept=".csv,.tsv,text/csv,text/plain" />
        <textarea id="meas-text" rows="2" placeholder="或粘贴 CSV…"></textarea>
        <div class="row"><label>表头行</label>
          <select id="meas-hdr"><option value="auto">自动</option><option value="1">1 行</option><option value="2">2 行（两级）</option></select>
          <label>格式</label>
          <select id="meas-profile"><option value="auto">自动</option><option value="plain-table">单表</option><option value="enzymeML-blocks">分块</option></select>
          <button class="primary" id="meas-import">导入</button></div>
      </details>`;
    $("#meas-import").addEventListener("click", (ev) => runBusy(ev.target, "导入数据", async () => {
      const file = $("#meas-file").files?.[0];
      let csv = $("#meas-text").value, name = $("#meas-name").value;
      if (file) { csv = await readTextFile(file); if (!name) name = file.name; }
      const r = await api.importMeasurements(name, csv, ui.topicId || undefined, $("#meas-hdr")?.value ?? "auto", $("#meas-profile")?.value ?? "auto");
      $("#meas-text").value = ""; if ($("#meas-file")) $("#meas-file").value = "";
      await refresh(); ui.assetId = r.assetId; renderAll();
      setStatus(`导入成功：${r.tableCount ?? 1} 张表 · ${r.created} 行`);
    }));
  }
}
function renderMaterials() {
  const box = $("#material-list");
  if (ui.nav === "protocol") {
    const ps = state.protocols.filter((p) => !ui.topicId || p.topicId === ui.topicId);
    box.innerHTML = ps.length
      ? ps.map((p) => `<div class="material ${p.id === ui.protocolId ? "active" : ""}" data-pid="${p.id}">
          <div class="m-title">${esc(p.name)}</div>
          <div class="m-meta">r${p.revision} · ${p.sourceKind === "user" ? "用户编写" : p.sourceKind === "reconstructed" ? "重构（已标来源）" : "AI 草稿"} · ${p.revisions[p.revisions.length - 1].steps.length} 步</div>
        </div>`).join("")
      : `<p class="hint">本课题暂无方案。先创建或从文献解析。</p>`;
    return;
  }
  if (ui.nav === "record") {
    const es = state.executions.filter((e) => !ui.topicId || e.topicId === ui.topicId);
    const STATUS = { active: "进行中", paused: "已暂停", done: "已结束" };
    box.innerHTML = es.length
      ? es.map((e) => {
          const p = state.protocols.find((x) => x.id === e.protocolId);
          return `<div class="material ${e.id === ui.executionId ? "active" : ""}" data-eid="${e.id}">
            <div class="m-title">${esc(p?.name ?? e.protocolId)} <span class="badge ${e.status === "paused" ? "warn" : e.status === "active" ? "confirm" : ""}">${STATUS[e.status]}</span></div>
            <div class="m-meta">固定 r${e.protocolRevision} · ${e.events.length} 事件${e.templateId ? " · 用模板" : ""}</div>
          </div>`;
        }).join("")
      : `<p class="hint">暂无执行。选择方案（及已确认模板）后开始。</p>`;
    return;
  }
  const list = materials();
  box.innerHTML = list.length
    ? list.map((a) => `<div class="material ${a.id === ui.assetId ? "active" : ""}" data-id="${a.id}">
        <div class="m-title">${esc(a.name)}</div>
        <div class="m-meta">${a.kind === "literature" ? "文献" : "数据"} · ${a.bytes}B ${a.topicId ? "· " + esc(topicName(a.topicId) ?? "") : "· 未归类"}</div>
      </div>`).join("")
    : `<p class="hint">当前${ui.nav === "literature" ? "文献" : "数据"}（${ui.topicId ? "本课题" : "全部"}）暂无材料。</p>`;
}
function renderMiddle() {
  const note = $("#mid-note"), content = $("#mid-content");
  if (ui.nav === "protocol") {
    const p = currentProtocol();
    $("#mid-title").textContent = p ? `原始材料 · ${p.name}` : "原始材料";
    if (!p) { note.hidden = true; content.textContent = "在左栏选择或创建方案。"; return; }
    const src = p.sourceAssetId ? state.assets.find((a) => a.id === p.sourceAssetId) : null;
    if (src) {
      note.hidden = false; note.textContent = `方法来源原件：${src.name}（${p.sourceKind}）`;
      content.innerHTML = ui.highlight && src.text.includes(ui.highlight)
        ? esc(src.text).replace(esc(ui.highlight), `<mark>${esc(ui.highlight)}</mark>`)
        : esc(src.text);
    } else {
      note.hidden = false; note.textContent = p.sourceKind === "user" ? "用户编写方案：无外部原件，下方为固定版本快照。" : "来源片段见快照 sourceFragments。";
      content.textContent = fmtSnapshot(viewSnapshot(p));
    }
    return;
  }
  if (ui.nav === "record") {
    const a = currentAsset();
    if (a && a.kind === "image") {
      $("#mid-title").textContent = `原始图片 · ${a.name}`;
      note.hidden = false; note.textContent = "原图归档（不压缩转码）；识别结果在右栏，须人工确认。";
      content.innerHTML = `<img class="ocrimg" src="${a.text}" alt="${esc(a.name)}" />`;
      return;
    }
    const e = currentExecution();
    $("#mid-title").textContent = e ? `固定方案快照 · r${e.protocolRevision}` : "原始材料";
    if (!e) { note.hidden = true; content.textContent = "在左栏选择执行，或选择手写图片。"; return; }
    const p = state.protocols.find((x) => x.id === e.protocolId);
    const snap = p?.revisions.find((r) => r.revision === e.protocolRevision);
    note.hidden = false; note.textContent = `执行固定引用 r${e.protocolRevision}（当前方案 r${p?.revision ?? "?"}）；实际层编辑不改此快照。`;
    content.textContent = snap ? fmtSnapshot(snap) : "（方案快照缺失）";
    return;
  }
  const a = currentAsset();
  $("#mid-title").textContent = a ? `原始材料 · ${a.name}` : "原始材料";
  if (!a) { note.hidden = true; content.textContent = "在左栏选择或导入材料。"; return; }
  if (!ui.highlight) { note.hidden = true; content.innerHTML = esc(a.text); return; }
  if (a.text.includes(ui.highlight)) { note.hidden = true; content.innerHTML = esc(a.text).replace(esc(ui.highlight), `<mark>${esc(ui.highlight)}</mark>`); }
  else { note.hidden = false; note.textContent = "定位不足：未能在原件中精确匹配该条目，已展示完整原件。"; content.innerHTML = esc(a.text); }
}
function renderRight() {
  if (ui.nav === "protocol") { $("#right-title").textContent = "方案与实验图"; $("#right-content").innerHTML = protocolHtml(); return; }
  if (ui.nav === "record") { $("#right-title").textContent = "实验记录"; $("#right-content").innerHTML = recordHtml(); return; }
  const a = currentAsset();
  if (!a) { $("#right-title").textContent = "结构化结果"; $("#right-content").innerHTML = `<p class="hint">选中材料后，这里显示结构化草稿与核对操作。</p>`; return; }
  if (a.kind === "literature") { $("#right-title").textContent = "证据卡"; $("#right-content").innerHTML = cardsHtml(a.id); }
  else { $("#right-title").textContent = "数据表格"; $("#right-content").innerHTML = tableHtml(a.id); }
}
/** 候选库状态（与后端 candidateStateOf 同口径）：跳过保未复核；采用独立于核对。 */
function candState(c) {
  if (state.adoptions.some((a) => a.cardId === c.id && a.decision === "adopt")) return "adopted";
  if (c.audit === "need_info") return "pending";
  if (c.audit === "confirm" || c.audit === "exclude") return "reviewed";
  return "unreviewed";
}
const CAND_LABEL = { unreviewed: "未复核", pending: "待补信息", reviewed: "已审候选", adopted: "已采用" };

function cardsHtml(assetId) {
  const all = state.cards.filter((c) => c.assetId === assetId);
  const inFilter = (c) => ui.cardFilter === "all" ? true
    : ui.cardFilter === "pending" ? ["unreviewed", "pending"].includes(candState(c))
    : ["reviewed", "adopted"].includes(candState(c));
  const cards = all.filter(inFilter);
  const nPend = all.filter((c) => ["unreviewed", "pending"].includes(candState(c))).length;
  const nRev = all.length - nPend;
  const asset = state.assets.find((a) => a.id === assetId);
  const subqs = state.subquestions.filter((q) => !asset?.topicId || q.topicId === asset.topicId);
  const independent = all.filter((c) => c.audit === "confirm" && !c.secondaryCitation).length;

  const tabs = `<div class="tabs">
    ${[["all", `全部 ${all.length}`], ["pending", `待审 ${nPend}`], ["reviewed", `已审候选 ${nRev}`]].map(([k, label]) => `<button class="tab ${ui.cardFilter === k ? "active" : ""}" data-filter="${k}">${label}</button>`).join("")}
    <span class="hint">独立证据 ${independent}（不含转引/未确认）</span>
  </div>`;

  const batchBar = `<div class="row batchbar">
    <button class="batch-preview" ${ui.groupSel.size ? "" : "disabled"}>组审预览（已选 ${ui.groupSel.size}）</button>
    <button class="batch-clear" ${ui.groupSel.size ? "" : "disabled"}>清空选择</button>
  </div>`;
  const batchPanel = ui.batch ? `<div class="item batchpanel">
    <div class="meta">组审预览 · ${ui.batch.count} 张（先呈现共享条件，确认后才整组通过）</div>
    <div>共享条件：${ui.batch.sharedConditions.length ? ui.batch.sharedConditions.map(esc).join("、") : "（无）"}</div>
    <div>缺定位：${ui.batch.missing.length ? ui.batch.missing.map((id) => esc(id)).join("、") : "（无）"}</div>
    <div>缺项/异常：${ui.batch.anomalies.length ? ui.batch.anomalies.map((id) => esc(id)).join("、") : "（无）"}</div>
    <div class="row"><label><input type="checkbox" id="batch-ack" ${ui.ack ? "checked" : ""}/> 我已查看上述共享条件/缺项/异常</label>
      <button class="primary batch-confirm" ${ui.ack ? "" : "disabled"}>整组确认</button>
      <button class="batch-cancel">取消</button></div>
  </div>` : "";

  const manualForm = `<details class="mini">
    <summary>手动补卡（人工观察/摘录，标注 manual）</summary>
    <textarea id="mc-raw" rows="2" placeholder="证据内容（必填）"></textarea>
    <input id="mc-quote" placeholder="定位引文：粘贴原件中的连续片段（可留空＝定位不足，不得正式采用）" />
    <textarea id="mc-fields" rows="2" placeholder="字段，每行 键=值（如 Km=0.5）"></textarea>
    <div class="row"><input id="mc-units" placeholder="单位（逗号分隔）" /><input id="mc-conditions" placeholder="条件（逗号分隔）" /></div>
    <div class="row"><input id="mc-unknowns" placeholder="缺项（逗号分隔）" /><input id="mc-reason" placeholder="原因（标转引时必填）" /></div>
    <div class="row"><label><input type="checkbox" id="mc-secondary" /> 综述转引（二手）</label><button class="primary" id="mc-add">补卡</button></div>
  </details>`;

  const body = cards.length ? cards.map((c) => {
    const cs = candState(c);
    const adps = state.adoptions.filter((a) => a.cardId === c.id);
    const fields = Object.entries(c.extracted?.fields ?? {});
    return `
    <div class="item" data-id="${c.id}">
      <div class="meta"><label class="grpwrap"><input type="checkbox" class="grp" data-id="${c.id}" ${ui.groupSel.has(c.id) ? "checked" : ""}/></label>
        抽取 <span class="badge ${c.extraction === "ai" ? "ai" : ""}">${c.extraction}</span> · 核对 <span class="badge ${c.audit}">${c.audit}</span> · 候选 <span class="badge cand-${cs}">${CAND_LABEL[cs]}</span>${c.secondaryCitation ? ` · <span class="badge secondary">转引(二手)</span>` : ""} · rev ${c.revision}</div>
      <div class="raw linkable" title="点击在原文件中定位">${esc(c.rawText)}</div>
      ${!c.locator.sectionQuote ? `<div class="hint warn">定位不足：无原文定位，不得用于正式采用。</div>` : ""}
      <details class="mini ex"><summary>字段/条件/缺项${c.unknowns.length ? `（缺项 ${c.unknowns.length}）` : ""}</summary>
        ${fields.map(([k, v]) => `<div class="row"><label>${esc(k)}</label><input data-fkey="${esc(k)}" value="${esc(v)}" /></div>`).join("") || `<p class="hint">暂无抽取字段。</p>`}
        <div class="row"><input data-field="newkey" placeholder="新字段名" /><input data-field="newval" placeholder="值" /></div>
        <div class="row"><label>单位</label><input data-field="units" value="${esc((c.extracted?.units ?? []).join(","))}" /></div>
        <div class="row"><label>条件</label><input data-field="conditions" value="${esc((c.extracted?.conditions ?? []).join(","))}" /></div>
        ${c.unknowns.length ? `<div class="hint warn">缺项：${c.unknowns.map(esc).join("、")}</div>` : ""}
        <div class="row"><button class="save-fields">保存字段/单位/条件</button></div>
      </details>
      <div class="row"><label>核对</label>
        <select data-field="audit">${["unreviewed", "confirm", "need_info", "exclude", "skip"].map((v) => `<option ${v === c.audit ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label>重要</label>
        <select data-field="importance">${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v || "—"}</option>`).join("")}</select>
        <button class="sec-toggle">${c.secondaryCitation ? "取消转引标记" : "标记转引(二手)"}</button>
      </div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(c.note)}" /></div>
      <div class="row"><label>原因</label><input data-field="reason" value="${esc(c.reason)}" placeholder="排除/改关键文本/标转引时必填" />
        <button class="save">保存</button><button class="history-btn">历史(${c.history.length})</button></div>
      <div class="row adopt">
        <label>任务</label>
        ${subqs.length ? `<select data-field="adoptSubq">${subqs.map((q) => `<option value="${q.id}">${esc(q.question)}</option>`).join("")}</select>
        <select data-field="adoptDecision"><option value="adopt">采用</option><option value="exclude">排除</option></select>
        <input data-field="adoptReason" placeholder="原因（排除必填）" />
        <button class="adopt-btn">记录</button>` : `<span class="hint">先在左栏创建子问题，才能按任务采用。</span>`}
      </div>
      ${adps.length ? `<div class="adoptlist">${adps.map((a) => `<span class="badge ${a.decision === "adopt" ? "adopted" : "exclude"}" title="${esc(a.reason)}">${a.decision === "adopt" ? "采用" : "排除"} · ${esc(state.subquestions.find((q) => q.id === a.subquestionId)?.question ?? a.subquestionId)}（卡 rev ${a.cardRevision}）</span>`).join("")}</div>` : ""}
    </div>`;
  }).join("") : `<p class="hint">${all.length ? "当前筛选下无证据卡。" : "暂无证据卡。"}</p>`;

  return tabs + batchBar + batchPanel + manualForm + body;
}

/** 左栏文献工具：命名映射 + 条件比较（仅文献导航显示）。 */
function renderLitTools() {
  const box = $("#lit-tools");
  if (ui.nav === "record") { renderRecordTools(box); return; }
  if (ui.nav !== "literature") { box.innerHTML = ""; return; }
  const maps = state.mappings.filter((m) => !ui.topicId || !m.topicId || m.topicId === ui.topicId);
  const cmps = state.comparisons.filter((c) => !ui.topicId || c.topicId === ui.topicId);
  const confirmed = state.cards.filter((c) => c.audit === "confirm" && (!ui.topicId || state.assets.find((a) => a.id === c.assetId)?.topicId === ui.topicId));
  const DIV = { single: "单源", consistent: "一致", value_diff: "值分歧", conditions_diff: "条件差异" };
  box.innerHTML = `
    <details class="mini" id="map-box">
      <summary>命名映射（${maps.length}）</summary>
      ${maps.map((m) => `<div class="hint">${esc(m.original)} → ${esc(m.mapped)}（依据：${esc(m.basis)}）</div>`).join("") || `<p class="hint">暂无映射。原名保留，映射须有依据。</p>`}
      <div class="row"><input id="map-original" placeholder="原名" /><input id="map-mapped" placeholder="映射名" /></div>
      <div class="row"><input id="map-basis" placeholder="来源依据（必填）" /><button id="map-create">添加映射</button></div>
    </details>
    <details class="mini" id="cmp-box">
      <summary>条件比较（${cmps.length}）</summary>
      ${ui.topicId ? `
        <div class="hint">仅已确认证据卡可入比较；快照固定卡版本，不自动合并/平均。</div>
        ${confirmed.length ? confirmed.map((c) => `<label class="cmppick"><input type="checkbox" class="cmp-card" value="${c.id}" /> ${esc(c.rawText.slice(0, 40))}（rev ${c.revision}）</label>`).join("") : `<p class="hint">本课题暂无已确认证据卡。</p>`}
        <div class="row"><input id="cmp-filters" placeholder="筛选（逗号分隔）" /><input id="cmp-conversions" placeholder="换算（逗号分隔）" /></div>
        <div class="row"><input id="cmp-exclusions" placeholder="排除（逗号分隔）" /><button class="primary" id="cmp-create">固定快照比较</button></div>
      ` : `<p class="hint">先选课题。</p>`}
      ${cmps.map((cmp) => `
        <div class="item cmp" data-id="${cmp.id}">
          <div class="meta">快照 ${esc(cmp.snapshot.dataRevision.slice(0, 10))} · ${esc(cmp.snapshot.pinnedAt)}${cmp.reviewFlags.length ? ` · <span class="badge warn">需复核（${cmp.reviewFlags.length} 张卡已修改）</span>` : ""}</div>
          <div class="hint">口径：筛选[${cmp.snapshot.filters.map(esc).join("、") || "—"}] 换算[${cmp.snapshot.conversions.map(esc).join("、") || "—"}] 排除[${cmp.snapshot.exclusions.map(esc).join("、") || "—"}]</div>
          ${cmp.groups.map((g) => `<div class="cmpgroup">
            <strong>${esc(g.name)}</strong> <span class="badge div-${g.divergence}">${DIV[g.divergence]}</span>
            ${g.entries.map((e) => `<div class="hint">${esc(e.value)}${e.unit ? " " + esc(e.unit) : ""} · 条件[${e.conditions.map(esc).join("、") || "—"}] · 卡${esc(e.cardId.slice(5, 13))} rev${e.cardRevision}${e.originalName !== e.mappedName ? `（原名 ${esc(e.originalName)}）` : ""}</div>`).join("")}
            ${g.unresolved.map((u) => `<div class="hint warn">${esc(u)}</div>`).join("")}
          </div>`).join("")}
          <div class="row"><button class="cmp-again" data-id="${cmp.id}">按当前版本重新比较（新快照）</button></div>
        </div>`).join("")}
    </details>`;
}

function showReminder() {
  const b = $("#banner"); b.hidden = false; b.className = "banner info";
  b.innerHTML = `<span>新文献已入库：既有比较快照保持不变。是否按新版本重新比较？</span>`;
  const btn = document.createElement("button"); btn.textContent = "打开比较"; btn.className = "primary";
  btn.addEventListener("click", () => { hideBanner(); const d = $("#cmp-box"); if (d) d.open = true; });
  b.appendChild(btn);
}
function tableHtml(assetId) {
  const ts = state.tables.filter((x) => x.assetId === assetId);
  if (!ts.length) return `<p class="hint">暂无表格。</p>`;
  const t = ts.find((x) => x.id === ui.tableId) ?? ts[0];
  const markers = new Set(t.markerRows ?? []);
  const head = t.columns.map((name, i) => `<th><div>${esc(name)}</div>
    <input data-col="${i}" data-k="unit" value="${esc(t.columnMeta[i].unit)}" placeholder="单位" />
    <select data-col="${i}" data-k="decision">${["unreviewed", "confirm", "need_info"].map((v) => `<option ${v === t.columnMeta[i].decision ? "selected" : ""}>${v}</option>`).join("")}</select></th>`).join("");
  const body = t.rows.map((r, ri) => `<tr${markers.has(ri) ? ` class="marker" title="块标记行：原件中的分块标题（非测量行），保留原样"` : ""}>${t.columns.map((_, ci) => `<td class="cell" data-row="${ri}" data-col="${ci}">${esc(r[ci] ?? "")}</td>`).join("")}</tr>`).join("");
  const cell = ui.cell && ui.cell.tableId === t.id ? ui.cell : null;
  const pick = ts.length > 1 ? `<div class="row"><label>表块</label><select id="table-pick">${ts.map((x) => `<option value="${x.id}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>` : "";
  return `
    <div class="item" data-id="${t.id}">
      ${pick}
      <div class="meta">${t.rows.length} 行（${t.rows.length - markers.size} 数据 · ${markers.size} 标记）× ${t.columns.length} 列 · rev ${t.revision}</div>
      <div class="tablewrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(t.note)}" />
        <label>原因</label><input data-field="reason" placeholder="改单元格数值时必填" />
        <button class="save-cols">保存列设置</button><button class="history-btn">历史(${t.history.length})</button></div>
      ${cell ? `<div class="row celledit"><label>单元格 r${cell.row}·c${cell.col}</label>
        <input data-field="cellValue" value="${esc(t.rows[cell.row]?.[cell.col] ?? "")}" />
        <input data-field="cellReason" placeholder="更正原因（必填）" />
        <button class="save-cell">保存单元格</button><button class="cancel-cell">取消</button></div>` : `<p class="hint">点击中间原件中的行可定位；点击单元格后再改数值（需原因）。</p>`}
    </div>`;
}

// ── 4C：方案 / 实验图 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR ──

function currentProtocol() { return state.protocols.find((p) => p.id === ui.protocolId) ?? null; }
function currentExecution() { return state.executions.find((e) => e.id === ui.executionId) ?? null; }
function viewSnapshot(p) { return p.revisions.find((r) => r.revision === (ui.viewRev ?? p.revision)) ?? p.revisions[p.revisions.length - 1]; }

function fmtSnapshot(s) {
  const lines = [`目的：${s.purpose || "（未写）"}`, `输入：${s.inputs.join("、") || "（未写）"}`, "步骤："];
  const L = computeLanes(s.steps);
  const mainById = new Map(L.main.map((m) => [m.step.id, m]));
  for (const st of s.steps) {
    const dur = st.durationMin === null ? "时长未知" : `${st.durationMin}min${st.estimated ? "（估计）" : ""}`;
    const branch = st.branch ? `［支路:${st.branch}］` : "";
    if (!st.branch) {
      const m = mainById.get(st.id);
      lines.push(`  ${timeLabel(m.offset, m.approx)}  ${st.op}  ${dur}${st.observeEnd ? `  终点:${st.observeEnd}` : ""}`);
    } else {
      const anchors = st.branchFrom || st.mergeInto ? `［分叉自:${st.branchFrom ?? "未指定"} / 汇合入:${st.mergeInto ?? "未指定"}］` : "";
      lines.push(`  ${st.op}  ${dur}${branch}${anchors}${st.observeEnd ? `  终点:${st.observeEnd}` : ""}`);
    }
    for (const [k, v] of Object.entries(st.params)) lines.push(`      ${k}=${v}`);
    if (st.note) lines.push(`      注：${st.note}`);
  }
  if (L.unknownCount) lines.push(`（主线有 ${L.unknownCount} 步时长未知：其后偏移为下界 t≥，未按零累计；已知总时长 ${L.totalKnown}min）`);
  lines.push(`条件：${s.conditions.join("、") || "（未写）"}`, `判据：${s.criteria || "（未写）"}`);
  if (s.unknowns.length) lines.push(`未知项：${s.unknowns.join("、")}`);
  if (s.sourceFragments.length) lines.push("方法来源片段：", ...s.sourceFragments.map((f) => `  「${f}」`));
  lines.push(`（r${s.revision} · ${s.at} · 原因：${s.reason}）`);
  return lines.join("\n");
}

/** 步骤行格式：操作 | 时长分钟(可空) | 支路名(可空) | est(可空) */
function parseStepsText(text) {
  return String(text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [op, dur, branch, est] = l.split("|").map((x) => (x ?? "").trim());
    return { op, durationMin: dur === "" ? null : Number(dur), branch: branch || null, estimated: est === "est" || est === "估计" };
  });
}

async function pollJob(jobId, label) {
  for (let i = 0; i < 1200; i++) {
    const job = await api.getJob(jobId);
    setStatus(`${label}：${job.message}`);
    if (job.status === "done") return job.result ?? {};
    if (job.status === "error") throw new Error(job.error || `${label}失败`);
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error(`${label}等待超时`);
}

function renderProtocolImport(box) {
  const lits = state.assets.filter((a) => a.kind === "literature" && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
  box.innerHTML = `
    <details class="mini" ${state.protocols.length ? "" : "open"}>
      <summary>新建方案（手工）</summary>
      <input id="proto-name" placeholder="方案名称" />
      <select id="proto-src"><option value="user">用户编写</option><option value="reconstructed">公开材料重构（须标来源）</option></select>
      <input id="proto-purpose" placeholder="目的" />
      <textarea id="proto-steps" rows="4" placeholder="每行一步：操作 | 时长分钟 | 支路名 | est&#10;例：配缓冲液 | 10 | |&#10;孵育 | 30 | | est&#10;对照 | 60 | 对照支路 |"></textarea>
      <input id="proto-criteria" placeholder="完成判据" />
      <input id="proto-frag" placeholder="来源片段（重构时必填，逗号分隔）" />
      <button class="primary" id="proto-create">创建方案</button>
    </details>
    <details class="mini">
      <summary>AI 解析方案（独立任务）</summary>
      ${lits.length ? `<select id="parse-asset">${lits.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
      <button id="proto-parse">解析为方案草稿</button>
      <p class="hint">草稿标 ai-draft 并固定来源原件；须人工编辑确认。</p>` : `<p class="hint">先在「文献证据」导入方法文本。</p>`}
    </details>`;
  $("#proto-create").addEventListener("click", (ev) => runBusy(ev.target, "创建方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const sourceKind = $("#proto-src").value;
    await api.createProtocol({
      topicId: ui.topicId, name: $("#proto-name").value, sourceKind,
      purpose: $("#proto-purpose").value, criteria: $("#proto-criteria").value,
      steps: parseStepsText($("#proto-steps").value),
      sourceFragments: splitList($("#proto-frag").value),
    });
    await refresh(); setStatus("方案已创建（r1）");
  }));
  const parseBtn = $("#proto-parse");
  if (parseBtn) parseBtn.addEventListener("click", (ev) => runBusy(ev.target, "AI 解析方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const r = await api.parseProtocol($("#parse-asset").value, ui.topicId);
    const res = await pollJob(r.jobId, "方案解析");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refresh();
    setStatus("方案草稿已生成（ai-draft，须人工确认）");
  }));
}

function renderRecordImport(box) {
  const ps = state.protocols.filter((p) => !ui.topicId || p.topicId === ui.topicId);
  const tmpls = state.templates.filter((t) => t.humanConfirmed);
  box.innerHTML = `
    <details class="mini" ${state.executions.length ? "" : "open"}>
      <summary>开始执行（固定方案版本）</summary>
      ${ps.length ? `<select id="exec-proto">${ps.map((p) => `<option value="${p.id}">${esc(p.name)}（r${p.revision}）</option>`).join("")}</select>
      <select id="exec-tmpl"><option value="">不用模板</option>${tmpls.map((t) => `<option value="${t.id}">模板 r${t.protocolRevision} · ${t.fields.length} 字段</option>`).join("")}</select>
      <button class="primary" id="exec-start">开始执行</button>
      <p class="hint">执行固定引用所选方案版本；之后方案修订不影响本执行。</p>` : `<p class="hint">先在「方案与图」创建方案。</p>`}
    </details>`;
  const btn = $("#exec-start");
  if (btn) btn.addEventListener("click", (ev) => runBusy(ev.target, "开始执行", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const r = await api.startExecution({ topicId: ui.topicId, protocolId: $("#exec-proto").value, templateId: $("#exec-tmpl").value || undefined });
    ui.executionId = r.executionId; ui.assetId = null; await refresh(); setStatus("执行已开始（固定方案版本）");
  }));
}

/** 实验图：横向时间泳道——主线一条泳道，支路在分叉/汇合锚点间平行展开；
 * 未知时长不按零累计（其后 t≥ 下界）；无锚点明示不猜；点击节点 → 下方固定编辑器。 */
function diagramHtml(p, snap) {
  const L = computeLanes(snap.steps);
  const node = (s, offset, approx) => {
    const dur = s.durationMin === null ? `<span class="badge warn">时长未知</span>` : `<span class="badge ${s.estimated ? "warn" : "confirm"}">${s.durationMin}min${s.estimated ? "·估计" : ""}</span>`;
    return `<div class="dnode ${ui.stepSel === s.id ? "sel" : ""}" data-step="${s.id}">
      <div class="dop">${esc(s.op)}</div>
      <div class="dmeta">${offset !== null ? `<span class="dtime">${timeLabel(offset, approx)}</span>` : ""}${dur}${s.observeEnd ? `<span class="hint">终点:${esc(s.observeEnd)}</span>` : ""}</div>
    </div>`;
  };
  let html = `<div class="diagram" style="grid-template-columns:repeat(${L.cols},minmax(110px,1fr))">`;
  L.main.forEach((m, i) => {
    html += `<div class="dcell" style="grid-column:${i + 1};grid-row:1">${node(m.step, m.offset, m.approx)}${i < L.main.length - 1 ? `<span class="darrow-h">→</span>` : ""}</div>`;
  });
  L.lanes.forEach((lane, li) => {
    const forkOp = lane.forkIdx !== null ? L.main[lane.forkIdx].step.op : null;
    const mergeOp = lane.mergeIdx !== null ? L.main[lane.mergeIdx].step.op : null;
    const anchorText = lane.anchored
      ? `分叉自「${esc(forkOp)}」之后 · 汇合入「${esc(mergeOp)}」之前`
      : `<span class="badge warn">锚点未指定（横跨全程，不猜）</span>`;
    html += `<div class="dlane ${lane.anchored ? "" : "unanchored"}" style="grid-column:${lane.start + 1}/${lane.end + 2};grid-row:${li + 2}">
      <div class="dlane-title">支路 · ${esc(lane.name)} · ${anchorText}</div>
      <div class="dlane-nodes">${lane.steps.map((s) => node(s, null, false)).join(`<span class="darrow-h">→</span>`)}</div>
    </div>`;
  });
  html += `</div><p class="hint">横向为时间推进方向；列宽等分（非时间比例），时间以 t≈/t≥ 标记。${L.unknownCount ? `主线有 ${L.unknownCount} 步时长未知：其后偏移为下界 t≥，未按零累计。` : ""}已知主线总时长 ${L.totalKnown}min。</p>`;
  return html;
}

function stepEditorHtml(p, snap) {
  const s = ui.stepSel === "new" ? { id: "", op: "", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "" } : snap.steps.find((x) => x.id === ui.stepSel);
  if (!s) return `<div class="stepeditor"><p class="hint">点击图中节点编辑步骤；保存将追加方案新快照（旧版本不动）。</p>
    <div class="row"><input id="newstep-op" placeholder="新步骤操作名" /><button id="step-add">添加步骤</button></div></div>`;
  const paramsText = Object.entries(s.params).map(([k, v]) => `${k}=${v}`).join("\n");
  const mainOpts = (cur) => snap.steps.filter((x) => !x.branch).map((x) => `<option value="${x.id}" ${x.id === cur ? "selected" : ""}>${esc(x.op)}</option>`).join("");
  return `<div class="stepeditor">
    <div class="meta">${ui.stepSel === "new" ? "新步骤" : `编辑步骤 · ${esc(s.op)}`}（保存 → 方案 r${p.revision + 1}）</div>
    <div class="row"><label>操作</label><input id="se-op" value="${esc(s.op)}" /></div>
    <div class="row"><label>时长(分)</label><input id="se-dur" type="number" min="0" value="${s.durationMin ?? ""}" placeholder="空=未知" />
      <label><input id="se-est" type="checkbox" ${s.estimated ? "checked" : ""}/> 估计</label>
      <label>支路</label><input id="se-branch" value="${esc(s.branch ?? "")}" placeholder="空=主线" /></div>
    <div class="row"><label>分叉自</label><select id="se-fork"><option value="">（未指定）</option>${mainOpts(s.branchFrom)}</select>
      <label>汇合入</label><select id="se-merge"><option value="">（未指定）</option>${mainOpts(s.mergeInto)}</select>
      <span class="hint">支路锚点：仅支路步骤生效；未指定则图中明示不猜</span></div>
    <div class="row"><label>观察终点</label><input id="se-end" value="${esc(s.observeEnd)}" /></div>
    <textarea id="se-params" rows="2" placeholder="参数，每行 键=值">${esc(paramsText)}</textarea>
    <div class="row"><label>备注</label><input id="se-note" value="${esc(s.note)}" /></div>
    <div class="row"><input id="se-reason" placeholder="修改原因（必填）" /><button class="primary" id="step-save">保存步骤</button><button id="step-cancel">取消</button></div>
  </div>`;
}

/** 影响分析面板：确定性传播与 AI 语义评估分栏；失败/未配置/stale 明示，不暗示无影响。 */
function impactHtml(entityIds) {
  const imps = state.impacts
    .filter((i) => entityIds.includes(i.change.entityId) && (!ui.topicId || i.topicId === ui.topicId))
    .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!imps.length) return `<div class="item impactpanel"><div class="meta">AI 影响分析</div><p class="hint">保存方案/记录/样品/测量修改后，这里自动登记影响分析。</p></div>`;
  const STATUS = { pending: "待评估", running: "评估中", completed: "已完成", failed: "评估失败", stale: "已过时" };
  const ASSESS = { impact: "有影响", no_supported_impact_found: "未发现支持的影响", needs_review: "需人工复核" };
  return `<div class="item impactpanel"><div class="meta">AI 影响分析（${imps.length}）<span class="hint">确定性时间传播独立计算；AI 只做语义评估</span></div>
    ${imps.map((i) => {
      const disp = i.status === "failed" ? "failed" : i.status === "stale" ? (i.assessment === "no_supported_impact_found" ? "needs_review" : i.assessment ?? "not_analyzed") : i.status === "completed" ? i.assessment : "not_analyzed";
      const dispLabel = disp === "failed" ? "评估失败（≠无影响）" : disp === "not_analyzed" ? "未分析/进行中" : disp === "needs_review" ? "需人工复核" : ASSESS[disp];
      return `<details class="mini imp" ${i === imps[0] ? "open" : ""}>
        <summary><span class="badge ${i.status === "failed" ? "exclude" : i.status === "stale" ? "warn" : i.status === "completed" ? "confirm" : "cand-pending"}">${STATUS[i.status]}</span>
          ${esc(i.change.summary)} <span class="hint">${esc(i.createdAt)}</span></summary>
        <div class="hint">结论口径：<strong>${esc(dispLabel)}</strong>${i.status === "stale" ? "（旧结论仅供历史查看，已有更新改动）" : ""}${i.error ? ` · 错误：${esc(i.error)}` : ""}</div>
        ${i.deterministic.timeShifts.length ? `<div class="hint">确定性时间传播：${esc(i.deterministic.note)}</div>
          <table class="grid"><thead><tr><th>步骤</th><th>平移(min)</th><th>主线总时长(min)</th></tr></thead><tbody>
          ${i.deterministic.timeShifts.map((s) => `<tr><td>${esc(s.op)}</td><td>${s.deltaMin > 0 ? "+" : ""}${s.deltaMin}</td><td>${s.newTotalMin}</td></tr>`).join("")}</tbody></table>`
          : `<div class="hint">${esc(i.deterministic.note)}</div>`}
        ${i.summary ? `<div>${esc(i.summary)}</div>` : ""}
        ${i.items.length ? `<div class="hint">逐条（${i.items.length}）：</div>${i.items.map((it) => `<div class="impitem">
          <span class="badge secondary">${esc(it.category)}</span> <strong>${esc(it.finding)}</strong>
          <div class="hint">对象：${esc(it.targetKind)} ${esc(it.targetId)}${it.targetRevision ? ` r${it.targetRevision}` : ""} · 理由：${esc(it.reason)}</div>
          ${it.evidenceRefs.length ? `<div class="hint">证据：${it.evidenceRefs.map(esc).join("、")}</div>` : ""}
          ${it.unknowns.length ? `<div class="hint warn">未知：${it.unknowns.map(esc).join("、")}</div>` : ""}
          ${it.suggestedAction ? `<div class="hint">建议：${esc(it.suggestedAction)}</div>` : ""}
        </div>`).join("")}` : ""}
        ${(i.status === "pending" || i.status === "failed") ? `<div class="row"><button class="imp-run" data-id="${i.id}">运行 AI 语义评估</button></div>` : ""}
      </details>`;
    }).join("")}
  </div>`;
}

function protocolHtml() {
  const p = currentProtocol();
  if (!p) return `<p class="hint">在左栏选择方案。图中节点可点击编辑；保存追加新快照，旧版本与已固定的执行/模板不受影响。</p>`;
  const snap = viewSnapshot(p);
  const viewingOld = snap.revision !== p.revision;
  const tmpls = state.templates.filter((t) => t.protocolId === p.id);
  return `
    <div class="item" data-id="${p.id}">
      <div class="meta">${esc(p.name)} · 当前 r${p.revision} · 来源 ${p.sourceKind}${p.sourceAssetId ? `（${esc(state.assets.find((a) => a.id === p.sourceAssetId)?.name ?? p.sourceAssetId)}）` : ""}</div>
      <div class="row"><label>查看版本</label>
        <select id="proto-rev">${p.revisions.map((r) => `<option value="${r.revision}" ${r.revision === snap.revision ? "selected" : ""}>r${r.revision} · ${esc(r.reason)}</option>`).join("")}</select>
        <button id="proto-export">导出 JSON</button>
        <button disabled title="占位：AI 重排未实现（仅确定性布局）">AI 重排（未实现）</button>
        <button class="history-btn">快照历史(${p.revisions.length})</button></div>
      ${viewingOld ? `<p class="hint warn">正在查看旧快照 r${snap.revision}（只读）；编辑将基于最新 r${p.revision} 追加。</p>` : ""}
      ${diagramHtml(p, snap)}
      ${!viewingOld ? stepEditorHtml(p, snap) : ""}
      ${!viewingOld ? `<details class="mini"><summary>方案元信息编辑</summary>
        <div class="row"><label>目的</label><input data-field="purpose" value="${esc(snap.purpose)}" /></div>
        <div class="row"><label>判据</label><input data-field="criteria" value="${esc(snap.criteria)}" /></div>
        <div class="row"><label>条件</label><input data-field="conditions" value="${esc(snap.conditions.join(","))}" /></div>
        <div class="row"><label>未知项</label><input data-field="unknowns" value="${esc(snap.unknowns.join(","))}" /></div>
        <div class="row"><input data-field="reason" placeholder="修改原因（必填）" /><button class="primary" id="proto-save">保存元信息</button></div>
      </details>` : ""}
    </div>
    ${impactHtml([p.id])}
    <div class="item"><div class="meta">记录模板（${tmpls.length}）</div>
      ${tmpls.map((t) => `<div class="row tmpl" data-id="${t.id}">
        <span class="badge ${t.humanConfirmed ? "confirm" : "cand-pending"}">${t.humanConfirmed ? "已确认" : "待确认"}</span>
        ${t.aiDraft ? `<span class="badge ai">AI 草稿</span>` : ""}
        <span class="hint">固定 r${t.protocolRevision}${t.protocolRevision !== p.revision ? `（方案已变 → 当前 r${p.revision}，复用前须比较）` : ""} · ${t.fields.length} 字段</span>
        ${!t.humanConfirmed ? `<button class="tmpl-confirm">人工确认</button>` : `<button class="tmpl-use">用于执行</button>`}
      </div>`).join("") || `<p class="hint">暂无模板。</p>`}
      <div class="row"><label><input type="checkbox" id="tmpl-ai" /> AI 草稿</label><button id="tmpl-create">生成模板（固定 r${p.revision}）</button></div>
    </div>`;
}

function recordHtml() {
  const a = currentAsset();
  if (a && a.kind === "image") return ocrHtml(a);
  const e = currentExecution();
  if (!e) return `<p class="hint">在左栏选择执行；或选择手写图片进行 OCR。</p>`;
  const p = state.protocols.find((x) => x.id === e.protocolId);
  const snap = p?.revisions.find((r) => r.revision === e.protocolRevision);
  const samples = state.samples.filter((s) => s.topicId === e.topicId);
  const meas = state.measurements.filter((m) => m.topicId === e.topicId);
  const KIND = { start: "开始", step: "步骤", pause: "暂停", resume: "恢复", note: "备注", deviation: "偏差" };
  const suggest = ui.pauseSuggest;
  return `
    <div class="item" data-id="${e.id}">
      <div class="meta">${esc(p?.name ?? e.protocolId)} · 固定 r${e.protocolRevision} · <span class="badge ${e.status === "paused" ? "warn" : e.status === "active" ? "confirm" : ""}">${e.status}</span>${e.templateId ? " · 模板" : ""}</div>
      ${e.status === "active" ? `<div class="row"><input id="pause-reason" placeholder="暂停原因（必填）" />
        <button id="exec-assist">AI 暂停建议</button><button class="primary" id="exec-pause">暂停</button><button id="exec-done">结束执行</button></div>
        ${suggest ? `<div class="hint">AI 建议（仅建议，采纳由人决定）：风险[${suggest.risks.map(esc).join("、") || "—"}] 恢复检查[${suggest.resumeChecks.map(esc).join("、") || "—"}]${suggest.unknowns.length ? ` 未知[${suggest.unknowns.map(esc).join("、")}]` : ""}</div>` : ""}` : ""}
      ${e.status === "paused" && e.pausedState ? `<div class="celledit">
        <div class="hint">暂停于 ${esc(e.pausedState.at)} · 原因：${esc(e.pausedState.reason)}${e.pausedState.aiSuggested ? "（含 AI 建议）" : ""}</div>
        <div class="hint">风险：${e.pausedState.risks.map(esc).join("、") || "—"} · 恢复检查：${e.pausedState.resumeChecks.map(esc).join("、") || "—"}</div>
        <div class="row"><input id="resume-decision" placeholder="人的恢复决定（必填）" /><button class="primary" id="exec-resume">恢复执行</button></div>
      </div>` : ""}
      <div class="pane-title">事件时间线（${e.events.length}）</div>
      ${e.events.map((ev) => ui.editEventId === ev.id ? `<div class="celledit" data-evid="${ev.id}">
          <div class="row"><label>内容</label><input data-field="evText" value="${esc(ev.text)}" /></div>
          <div class="row"><label>实际用量</label><input data-field="evAmount" value="${esc(ev.actual.amount ?? "")}" />
            <label>实际时长</label><input data-field="evDur" type="number" min="0" value="${ev.actual.durationMin ?? ""}" /></div>
          <div class="row"><input data-field="evReason" placeholder="修改原因（必填）" /><button class="primary ev-save">保存</button><button class="ev-cancel">取消</button></div>
        </div>` : `<div class="evrow" data-evid="${ev.id}">
          <span class="badge ${ev.kind === "deviation" ? "exclude" : ev.kind === "pause" ? "warn" : ""}">${KIND[ev.kind]}</span>
          <span class="hint">${esc(ev.at)}${ev.backfilled ? " · 后补" : ""}</span>
          <span>${esc(ev.text)}</span>
          ${ev.actual.amount ? `<span class="hint">用量 ${esc(ev.actual.amount)}</span>` : ""}
          ${ev.actual.durationMin !== undefined ? `<span class="hint">实际 ${ev.actual.durationMin}min</span>` : ""}
          ${ev.kind === "step" || ev.kind === "note" || ev.kind === "deviation" ? `<button class="ev-edit">编辑(${ev.history.length})</button>` : ""}
        </div>`).join("")}
      <details class="mini"><summary>追加事件</summary>
        <div class="row"><select id="ev-kind"><option value="step">步骤</option><option value="note">备注</option><option value="deviation">偏差</option></select>
          <select id="ev-step">${(snap?.steps ?? []).map((s) => `<option value="${s.id}">${esc(s.op)}</option>`).join("")}</select></div>
        <div class="row"><input id="ev-text" placeholder="内容（备注/偏差必填）" /></div>
        <div class="row"><input id="ev-amount" placeholder="实际用量" /><input id="ev-dur" type="number" min="0" placeholder="实际时长(分)" />
          <label><input type="checkbox" id="ev-backfill" /> 后补</label><button class="primary" id="ev-add">追加</button></div>
      </details>
    </div>
    <div class="item"><div class="meta">样品与测量（本课题）</div>
      ${samples.map((s) => `<div class="smprow" data-id="${s.id}">
        <strong>${esc(s.shortName)}</strong> ${esc(s.displayName)} <span class="hint">${s.origin === "public" ? "公开导入" : "用户"} · ${s.states.length} 状态</span>
        <div class="hint">最新：${esc(s.states[s.states.length - 1].amount.value)} ${esc(s.states[s.states.length - 1].amount.unit)}${s.states[s.states.length - 1].amount.estimated ? "（估计）" : ""} · ${esc(s.states[s.states.length - 1].handling || "—")}</div>
      </div>`).join("") || `<p class="hint">暂无样品（左栏新建）。</p>`}
      <details class="mini"><summary>新增测量（固定样品状态版本）</summary>
        ${samples.length ? `<div class="row"><select id="meas-sample">${samples.map((s) => `<option value="${s.id}">${esc(s.shortName)} ${esc(s.displayName)}</option>`).join("")}</select>
          <select id="meas-srev">${samples[0].states.map((st) => `<option value="${st.revision}">状态 r${st.revision}</option>`).join("")}</select></div>
        <div class="row"><input id="meas-value" placeholder="测量值（必填）" /><input id="meas-unit" placeholder="单位" /></div>
        <div class="row"><input id="meas-method" placeholder="方法" /><input id="meas-instr" placeholder="仪器" /></div>
        <div class="row"><input id="meas-note" placeholder="备注" /><button class="primary" id="meas-add">记录测量</button></div>` : `<p class="hint">先建样品。</p>`}
      </details>
      ${meas.map((m) => `<div class="item meas" data-id="${m.id}">
        <div class="meta">${esc(state.samples.find((s) => s.id === m.sampleId)?.shortName ?? m.sampleId)} · 状态 r${m.sampleStateRevision} · rev ${m.revision}${m.cellRef ? ` · 回链表 ${esc(m.cellRef.tableId.slice(4, 12))} r${m.cellRef.row}c${m.cellRef.col}` : ""}</div>
        <div class="row"><input data-field="mValue" value="${esc(m.value)}" /><input data-field="mUnit" value="${esc(m.unit)}" />
          <input data-field="mMethod" value="${esc(m.method)}" /><input data-field="mInstr" value="${esc(m.instrument)}" /></div>
        <div class="row"><input data-field="mNote" value="${esc(m.note)}" /><input data-field="mReason" placeholder="修改原因（必填）" />
          <button class="meas-save">保存</button><button class="history-btn">历史(${m.history.length})</button></div>
      </div>`).join("")}
    </div>
    ${impactHtml([e.id, ...samples.map((s) => s.id), ...meas.map((m) => m.id)])}`;
}

function ocrHtml(asset) {
  const ocrs = state.ocrs.filter((o) => o.assetId === asset.id);
  return `
    <div class="item" data-id="${asset.id}">
      <div class="meta">手写记录 · ${esc(asset.name)} · 原图已归档</div>
      <div class="row"><button class="primary" id="ocr-ai">AI 识别（视觉独立任务）</button><span class="hint">失败不降级为假 AI；可人工转录兜底（标 manual）。</span></div>
      <details class="mini"><summary>人工转录（兜底）</summary>
        <textarea id="ocr-raw" rows="3" placeholder="逐字转录，不清处用 ? 占位"></textarea>
        <textarea id="ocr-fields" rows="2" placeholder="字段，每行 键=值"></textarea>
        <div class="row"><input id="ocr-unknowns" placeholder="未知项（逗号分隔）" /><button id="ocr-manual-add">保存转录草稿</button></div>
      </details>
    </div>
    ${ocrs.map((o) => `<div class="item ocr" data-id="${o.id}">
      <div class="meta"><span class="badge ${o.extraction === "ai" ? "ai" : ""}">${o.extraction}</span>
        <span class="badge ${o.status === "confirmed" ? "confirm" : "cand-pending"}">${o.status === "confirmed" ? "已确认" : "草稿"}</span> · rev ${o.revision}</div>
      <div class="row"><label>转录</label><input data-field="oRaw" value="${esc(o.rawText)}" /></div>
      ${Object.entries(o.fields).map(([k, v]) => `<div class="row"><label>${esc(k)}</label><input data-ofkey="${esc(k)}" value="${esc(v)}" /></div>`).join("")}
      <div class="row"><input data-field="oNewKey" placeholder="新字段名" /><input data-field="oNewVal" placeholder="值" /></div>
      ${o.unknowns.length ? `<div class="hint warn">未知：${o.unknowns.map(esc).join("、")}</div>` : ""}
      <div class="row"><input data-field="oReason" placeholder="修改原因（改转录/数值必填）" />
        <button class="primary ocr-confirm">${o.status === "confirmed" ? "再次确认" : "人工确认"}</button><button class="history-btn">历史(${o.history.length})</button></div>
    </div>`).join("")}`;
}

/** 左栏工具：方案导航=模板；记录导航=样品/图片；文献导航=映射/比较。 */
function renderRecordTools(box) {
  const samples = state.samples.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  const imgs = state.assets.filter((a) => a.kind === "image" && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
  box.innerHTML = `
    <div class="pane-title">样品（短号稳定，改名不破引用）</div>
    ${samples.map((s) => `<div class="item smp" data-id="${s.id}">
      <div class="meta"><strong>${esc(s.shortName)}</strong> · ${s.states.length} 状态</div>
      <div class="row"><input data-field="smpName" value="${esc(s.displayName)}" /><button class="smp-rename">改名</button></div>
      <details class="mini"><summary>追加状态（分样/处理/用途）</summary>
        <div class="row"><input data-field="stValue" placeholder="用量（必填）" /><input data-field="stUnit" placeholder="单位" />
          <label><input type="checkbox" data-field="stEst" /> 估计</label></div>
        <div class="row"><input data-field="stHandling" placeholder="处理" /><input data-field="stUse" placeholder="用途" /></div>
        <div class="row"><input data-field="stNote" placeholder="备注" /><button class="smp-state">追加状态</button></div>
      </details>
      <div class="hint">历史：${s.states.map((st) => `r${st.revision} ${esc(st.amount.value)}${esc(st.amount.unit)}${st.amount.estimated ? "(估)" : ""}`).join(" → ")}</div>
    </div>`).join("") || `<p class="hint">暂无样品。</p>`}
    <details class="mini"><summary>新建样品</summary>
      <div class="row"><input id="smp-short" placeholder="短号（唯一，如 S1）" /><input id="smp-display" placeholder="显示名（可后改）" /></div>
      <div class="row"><input id="smp-value" placeholder="用量（必填）" /><input id="smp-unit" placeholder="单位" />
        <label><input type="checkbox" id="smp-est" /> 估计</label></div>
      <div class="row"><input id="smp-handling" placeholder="处理" /><input id="smp-use" placeholder="用途" /></div>
      <button class="primary" id="smp-create">创建样品</button>
    </details>
    <div class="pane-title">手写图片（OCR）</div>
    <details class="mini"><summary>上传原图（PNG/JPEG/WebP）</summary>
      <input id="img-file" type="file" accept="image/png,image/jpeg,image/webp" />
      <button id="img-import">归档原图</button>
    </details>
    ${imgs.map((a) => `<div class="material ${a.id === ui.assetId ? "active" : ""}" data-aid="${a.id}">
      <div class="m-title">${esc(a.name)}</div><div class="m-meta">图片 · ${a.bytes}B · OCR ${state.ocrs.filter((o) => o.assetId === a.id).length}</div>
    </div>`).join("") || `<p class="hint">暂无图片。真实手写公开材料缺位时可用人工转录兜底。</p>`}`;
}

// ── 事件 ────────────────────────────────────────────────────
$("#nav").addEventListener("click", (ev) => {
  const b = ev.target.closest(".navitem"); if (!b || b.disabled) return;
  if (!guardLeave()) return;
  ui.nav = b.dataset.nav; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.stepSel = null; ui.viewRev = null; ui.editEventId = null; ui.pauseSuggest = null;
  $$(".navitem").forEach((x) => x.classList.toggle("active", x === b));
  renderAll();
});
$("#topic-select").addEventListener("change", (e) => { if (!guardLeave()) { renderTopics(); return; } ui.topicId = e.target.value; ui.assetId = null; ui.highlight = null; ui.groupSel.clear(); ui.batch = null; ui.protocolId = null; ui.executionId = null; ui.stepSel = null; ui.viewRev = null; renderAll(); });
$("#topic-create").addEventListener("click", (ev) => runBusy(ev.target, "创建课题", async () => {
  const r = await api.createTopic($("#topic-name").value, $("#topic-q").value);
  ui.topicId = r.topicId; await refresh(); setStatus("课题已创建");
}));
$("#subq-create").addEventListener("click", (ev) => runBusy(ev.target, "创建子问题", async () => {
  if (!ui.topicId) throw new Error("请先选择/创建一个课题");
  await api.createSubquestion(ui.topicId, $("#subq-q").value, $("#subq-kind").value); $("#subq-q").value = ""; await refresh(); setStatus("子问题已创建");
}));
$("#material-list").addEventListener("click", (ev) => {
  const el = ev.target.closest(".material"); if (!el) return;
  if (el.dataset.pid) {
    if (el.dataset.pid === ui.protocolId) return;
    if (!guardLeave()) return;
    ui.protocolId = el.dataset.pid; ui.stepSel = null; ui.viewRev = null; ui.highlight = null; renderAll(); return;
  }
  if (el.dataset.eid) {
    if (el.dataset.eid === ui.executionId) return;
    if (!guardLeave()) return;
    ui.executionId = el.dataset.eid; ui.editEventId = null; ui.pauseSuggest = null; ui.assetId = null; renderAll(); return;
  }
  if (el.dataset.id === ui.assetId) return;
  if (!guardLeave()) return;
  ui.assetId = el.dataset.id; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderAll();
});
$("#right-content").addEventListener("change", (ev) => {
  if (ev.target.id === "table-pick") { ui.tableId = ev.target.value; ui.cell = null; renderRight(); }
  if (ev.target.id === "proto-rev") { ui.viewRev = Number(ev.target.value); ui.stepSel = null; renderMiddle(); renderRight(); }
  if (ev.target.id === "meas-sample") {
    const s = state.samples.find((x) => x.id === ev.target.value);
    $("#meas-srev").innerHTML = (s?.states ?? []).map((st) => `<option value="${st.revision}">状态 r${st.revision}</option>`).join("");
  }
  if (ev.target.classList.contains("grp")) {
    const id = ev.target.dataset.id;
    if (ev.target.checked) ui.groupSel.add(id); else ui.groupSel.delete(id);
    renderRight();
  }
  if (ev.target.id === "batch-ack") { ui.ack = ev.target.checked; renderRight(); }
});
$("#right-content").addEventListener("input", (ev) => { if (ev.target.closest(".item")) ui.dirty = true; });
$("#right-content").addEventListener("click", async (ev) => {
  const item = ev.target.closest(".item");
  const val = (f) => item?.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  try {
    if (ev.target.classList.contains("tab")) { ui.cardFilter = ev.target.dataset.filter; renderRight(); saveUi(); return; }
    if (ev.target.classList.contains("batch-preview")) {
      ui.batch = await api.batchPreview([...ui.groupSel]); ui.ack = false; renderRight(); return;
    }
    if (ev.target.classList.contains("batch-clear")) { ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderRight(); return; }
    if (ev.target.classList.contains("batch-cancel")) { ui.batch = null; ui.ack = false; renderRight(); return; }
    if (ev.target.classList.contains("batch-confirm")) {
      await runBusy(ev.target, "整组确认", async () => {
        await api.batchConfirm([...ui.groupSel], ui.ack);
        ui.groupSel.clear(); ui.batch = null; ui.ack = false; ui.dirty = false;
        await refresh(); setStatus("整组已确认（含修订历史）");
      }); return;
    }
    if (ev.target.id === "mc-add") {
      await runBusy(ev.target, "手动补卡", async () => {
        const fields = {};
        for (const line of $("#mc-fields").value.split(/\n/)) {
          const i = line.indexOf("=");
          if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
        await api.addCard({
          assetId: ui.assetId, rawText: $("#mc-raw").value, sectionQuote: $("#mc-quote").value,
          fields, units: splitList($("#mc-units").value), conditions: splitList($("#mc-conditions").value),
          unknowns: splitList($("#mc-unknowns").value), secondaryCitation: $("#mc-secondary").checked, reason: $("#mc-reason").value,
        });
        ui.dirty = false; await refresh(); setStatus("补卡成功（manual，待核对）");
      }); return;
    }
    if (ev.target.classList.contains("dnode")) { ui.stepSel = ev.target.closest(".dnode").dataset.step; renderRight(); return; }
    if (!item) return;
    if (ev.target.classList.contains("history-btn")) {
      const id = item.dataset.id;
      const obj = state.cards.find((c) => c.id === id) ?? state.tables.find((t) => t.id === id)
        ?? state.ocrs.find((o) => o.id === id) ?? state.measurements.find((m) => m.id === id);
      if (obj) { openHistory(obj); return; }
      const p = state.protocols.find((x) => x.id === id);
      if (p) {
        openHistory({ revision: p.revision, history: p.revisions.map((r) => ({ revision: r.revision, field: "整版快照", before: r.revision > 1 ? `r${r.revision - 1}` : "—", after: `${r.steps.length} 步`, reason: r.reason, at: r.at })) });
        return;
      }
      return;
    }
    if (ev.target.classList.contains("raw") && ev.target.classList.contains("linkable")) {
      const c = state.cards.find((x) => x.id === item.dataset.id); ui.highlight = c?.locator.sectionQuote || c?.rawText || null; renderMiddle(); return;
    }
    if (ev.target.classList.contains("save-fields")) {
      const fields = {};
      item.querySelectorAll("[data-fkey]").forEach((inp) => { fields[inp.dataset.fkey] = inp.value; });
      const nk = val("newkey").trim();
      if (nk) fields[nk] = val("newval");
      await runBusy(ev.target, "保存字段", async () => {
        await api.reviewCard(item.dataset.id, { extracted: { fields, units: splitList(val("units")), conditions: splitList(val("conditions")) }, reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("字段/单位/条件已保存（含修订历史）");
      }); return;
    }
    if (ev.target.classList.contains("sec-toggle")) {
      const c = state.cards.find((x) => x.id === item.dataset.id);
      await runBusy(ev.target, "转引标记", async () => {
        await api.reviewCard(item.dataset.id, { secondaryCitation: !c.secondaryCitation, reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus(c.secondaryCitation ? "已取消转引标记" : "已标记转引（二手，不计独立证据）");
      }); return;
    }
    if (ev.target.classList.contains("adopt-btn")) {
      await runBusy(ev.target, "记录采用", async () => {
        await api.adopt(item.dataset.id, val("adoptSubq"), val("adoptDecision"), val("adoptReason"));
        ui.dirty = false; await refresh(); setStatus("任务采用/排除已记录（独立于核对）");
      }); return;
    }
    if (ev.target.classList.contains("cell")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      ui.cell = { tableId: t.id, row: Number(ev.target.dataset.row), col: Number(ev.target.dataset.col) };
      ui.highlight = lineOf(t, ui.cell.row); renderMiddle(); renderRight(); return;
    }
    if (ev.target.classList.contains("cancel-cell")) { ui.cell = null; renderRight(); return; }
    if (ev.target.classList.contains("save-cell") && ui.cell) {
      await runBusy(ev.target, "保存单元格", async () => {
        await api.reviewTable(ui.cell.tableId, { cellUpdates: [{ row: ui.cell.row, col: ui.cell.col, value: val("cellValue") }], reason: val("cellReason") });
        ui.cell = null; ui.dirty = false; await refresh(); setStatus("单元格已保存（含修订历史）");
      }); return;
    }
    if (ev.target.classList.contains("save")) {
      await runBusy(ev.target, "保存核对", async () => {
        await api.reviewCard(item.dataset.id, { audit: val("audit"), importance: val("importance") || null, note: val("note"), reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("已保存（含修订历史）");
      }); return;
    }
    if (ev.target.classList.contains("save-cols")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      await runBusy(ev.target, "保存列设置", async () => {
        const columnUpdates = t.columns.map((_, i) => ({ index: i, unit: item.querySelector(`[data-col="${i}"][data-k="unit"]`).value, decision: item.querySelector(`[data-col="${i}"][data-k="decision"]`).value }));
        await api.reviewTable(t.id, { columnUpdates, note: val("note"), reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("列设置已保存");
      }); return;
    }
    // ── 4C 操作 ──
    if (ev.target.id === "step-cancel") { ui.stepSel = null; renderRight(); return; }
    if (ev.target.id === "step-add") {
      const op = $("#newstep-op").value.trim();
      if (!op) throw new Error("新步骤操作名不能为空");
      const p = currentProtocol();
      const latest = p.revisions[p.revisions.length - 1];
      await runBusy(ev.target, "添加步骤", async () => {
        await api.editProtocol(p.id, { steps: [...latest.steps, { op, durationMin: null, branch: null, estimated: false }], reason: `添加步骤：${op}` });
        ui.dirty = false; await refresh(); setStatus(`已添加步骤（方案 r${p.revision + 1}）`);
      }); return;
    }
    if (ev.target.id === "step-save") {
      const p = currentProtocol();
      const latest = p.revisions[p.revisions.length - 1];
      const params = {};
      for (const line of $("#se-params").value.split(/\n/)) { const i = line.indexOf("="); if (i > 0) params[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      const durRaw = $("#se-dur").value;
      const edited = {
        id: ui.stepSel === "new" ? undefined : ui.stepSel,
        op: $("#se-op").value, params, note: $("#se-note").value,
        durationMin: durRaw === "" ? null : Number(durRaw),
        estimated: $("#se-est").checked, branch: $("#se-branch").value.trim() || null, observeEnd: $("#se-end").value,
        branchFrom: $("#se-fork")?.value || null, mergeInto: $("#se-merge")?.value || null,
      };
      const steps = ui.stepSel === "new" ? [...latest.steps, edited] : latest.steps.map((s) => (s.id === ui.stepSel ? { ...s, ...edited, id: s.id } : s));
      await runBusy(ev.target, "保存步骤", async () => {
        await api.editProtocol(p.id, { steps, reason: $("#se-reason").value });
        ui.stepSel = null; ui.dirty = false; await refresh(); setStatus("步骤已保存（追加新快照，旧版本不动）");
      }); return;
    }
    if (ev.target.id === "proto-export") {
      const p = currentProtocol();
      const blob = new Blob([JSON.stringify(viewSnapshot(p), null, 2)], { type: "application/json" });
      const aEl = document.createElement("a");
      aEl.href = URL.createObjectURL(blob); aEl.download = `${p.name}_r${viewSnapshot(p).revision}.json`;
      aEl.click(); URL.revokeObjectURL(aEl.href); setStatus("已导出当前快照 JSON"); return;
    }
    if (ev.target.id === "proto-save") {
      const p = currentProtocol();
      await runBusy(ev.target, "保存方案元信息", async () => {
        await api.editProtocol(p.id, { purpose: val("purpose"), criteria: val("criteria"), conditions: splitList(val("conditions")), unknowns: splitList(val("unknowns")), reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("方案元信息已保存（新快照）");
      }); return;
    }
    if (ev.target.classList.contains("tmpl-confirm")) {
      const tid = ev.target.closest(".tmpl").dataset.id;
      await runBusy(ev.target, "确认模板", async () => { await api.confirmTemplate(tid); ui.dirty = false; await refresh(); setStatus("模板已人工确认，可复用"); }); return;
    }
    if (ev.target.classList.contains("tmpl-use")) {
      const tid = ev.target.closest(".tmpl").dataset.id;
      const t = state.templates.find((x) => x.id === tid);
      await runBusy(ev.target, "按模板开始执行", async () => {
        const r = await api.startExecution({ topicId: ui.topicId || currentProtocol().topicId, protocolId: t.protocolId, protocolRevision: t.protocolRevision, templateId: tid });
        ui.executionId = r.executionId; ui.nav = "record"; ui.dirty = false; await refresh(); setStatus("执行已开始（固定模板所指方案版本）");
      }); return;
    }
    if (ev.target.id === "tmpl-create") {
      await runBusy(ev.target, "生成模板", async () => {
        await api.createTemplate({ protocolId: ui.protocolId, aiDraft: $("#tmpl-ai").checked });
        ui.dirty = false; await refresh(); setStatus("模板已生成（固定当前方案版本；AI 草稿须人工确认）");
      }); return;
    }
    if (ev.target.classList.contains("imp-run")) {
      const iid = ev.target.dataset.id;
      await runBusy(ev.target, "AI 影响评估", async () => {
        const r = await api.runImpact(iid);
        const res = await pollJob(r.jobId, "影响评估");
        await refresh();
        setStatus(res.discarded ? "已有更新改动：旧评估被丢弃（stale 守卫）" : "影响评估完成");
      }); return;
    }
    if (ev.target.id === "exec-assist") {
      await runBusy(ev.target, "AI 暂停建议", async () => {
        ui.pauseSuggest = await api.pauseAssist(ui.executionId);
        renderRight(); setStatus("AI 建议已给出（仅建议，是否采纳由人决定）");
      }); return;
    }
    if (ev.target.id === "exec-pause") {
      await runBusy(ev.target, "暂停执行", async () => {
        await api.pauseExecution(ui.executionId, {
          reason: $("#pause-reason").value,
          risks: ui.pauseSuggest?.risks ?? [], resumeChecks: ui.pauseSuggest?.resumeChecks ?? [],
          aiSuggested: !!ui.pauseSuggest,
        });
        ui.pauseSuggest = null; ui.dirty = false; await refresh(); setStatus("已暂停（状态与风险已记录）");
      }); return;
    }
    if (ev.target.id === "exec-resume") {
      await runBusy(ev.target, "恢复执行", async () => {
        await api.resumeExecution(ui.executionId, $("#resume-decision").value);
        ui.dirty = false; await refresh(); setStatus("已恢复（人的决定已记录）");
      }); return;
    }
    if (ev.target.id === "exec-done") {
      await runBusy(ev.target, "结束执行", async () => { await api.completeExecution(ui.executionId); await refresh(); setStatus("执行已结束"); }); return;
    }
    if (ev.target.classList.contains("ev-edit")) { ui.editEventId = ev.target.closest(".evrow").dataset.evid; renderRight(); return; }
    if (ev.target.classList.contains("ev-cancel")) { ui.editEventId = null; renderRight(); return; }
    if (ev.target.classList.contains("ev-save")) {
      const evid = ev.target.closest(".celledit").dataset.evid;
      const durRaw = val("evDur");
      await runBusy(ev.target, "保存记录修订", async () => {
        await api.editEvent(ui.executionId, evid, {
          text: val("evText"),
          actual: { amount: val("evAmount"), ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) },
          reason: val("evReason"),
        });
        ui.editEventId = null; ui.dirty = false; await refresh(); setStatus("记录已原位修订（留历史，不改源方案）");
      }); return;
    }
    if (ev.target.id === "ev-add") {
      const durRaw = $("#ev-dur").value;
      await runBusy(ev.target, "追加事件", async () => {
        await api.appendEvent(ui.executionId, {
          kind: $("#ev-kind").value, stepId: $("#ev-step").value || undefined, text: $("#ev-text").value,
          actual: { amount: $("#ev-amount").value, ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) },
          backfilled: $("#ev-backfill").checked,
        });
        ui.dirty = false; await refresh(); setStatus("事件已追加");
      }); return;
    }
    if (ev.target.id === "meas-add") {
      await runBusy(ev.target, "记录测量", async () => {
        await api.addMeasurement({
          topicId: ui.topicId || currentExecution().topicId, sampleId: $("#meas-sample").value,
          sampleStateRevision: Number($("#meas-srev").value), value: $("#meas-value").value, unit: $("#meas-unit").value,
          method: $("#meas-method").value, instrument: $("#meas-instr").value, note: $("#meas-note").value,
        });
        ui.dirty = false; await refresh(); setStatus("测量已记录（固定样品状态版本）");
      }); return;
    }
    if (ev.target.classList.contains("meas-save")) {
      await runBusy(ev.target, "保存测量修订", async () => {
        await api.editMeasurement(item.dataset.id, { value: val("mValue"), unit: val("mUnit"), method: val("mMethod"), instrument: val("mInstr"), note: val("mNote"), reason: val("mReason") });
        ui.dirty = false; await refresh(); setStatus("测量已修订（留历史）");
      }); return;
    }
    if (ev.target.id === "ocr-ai") {
      await runBusy(ev.target, "AI 识别", async () => {
        const r = await api.runOcr(ui.assetId);
        const res = await pollJob(r.jobId, "手写识别");
        await refresh(); setStatus(`识别完成：${res.created} 条草稿（须人工确认）`);
      }); return;
    }
    if (ev.target.id === "ocr-manual-add") {
      const fields = {};
      for (const line of $("#ocr-fields").value.split(/\n/)) { const i = line.indexOf("="); if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      await runBusy(ev.target, "保存转录", async () => {
        await api.manualOcr(ui.assetId, { rawText: $("#ocr-raw").value, fields, unknowns: splitList($("#ocr-unknowns").value) });
        ui.dirty = false; await refresh(); setStatus("人工转录草稿已保存（manual）");
      }); return;
    }
    if (ev.target.classList.contains("ocr-confirm")) {
      const fields = {};
      item.querySelectorAll("[data-ofkey]").forEach((inp) => { fields[inp.dataset.ofkey] = inp.value; });
      const nk = val("oNewKey").trim(); if (nk) fields[nk] = val("oNewVal");
      await runBusy(ev.target, "确认 OCR", async () => {
        await api.confirmOcr(item.dataset.id, { rawText: val("oRaw"), fields, reason: val("oReason") });
        ui.dirty = false; await refresh(); setStatus("OCR 记录已人工确认（修订留历史）");
      }); return;
    }
  } catch (e) { showBanner(String(e.message ?? e)); }
});
function lineOf(t, ri) {
  const lines = currentAsset().text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return (lines[ri + 1] ?? "").trim() || null;
}
const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
$("#lit-tools").addEventListener("click", (ev) => {
  const t = ev.target;
  const imgEl = t.closest?.(".material[data-aid]");
  if (imgEl) {
    if (!guardLeave()) return;
    ui.assetId = imgEl.dataset.aid; ui.executionId = null; ui.highlight = null; renderAll(); return;
  }
  if (t.id === "smp-create") {
    runBusy(t, "创建样品", async () => {
      if (!ui.topicId) throw new Error("请先选择/创建课题");
      await api.createSample({
        topicId: ui.topicId, executionId: ui.executionId || undefined,
        shortName: $("#smp-short").value, displayName: $("#smp-display").value,
        amount: { value: $("#smp-value").value, unit: $("#smp-unit").value, estimated: $("#smp-est").checked },
        handling: $("#smp-handling").value, use: $("#smp-use").value,
      });
      await refresh(); setStatus("样品已创建（短号唯一，状态追加式）");
    }); return;
  }
  if (t.classList.contains("smp-rename")) {
    const item = t.closest(".smp");
    runBusy(t, "样品改名", async () => {
      await api.renameSample(item.dataset.id, item.querySelector('[data-field="smpName"]').value);
      await refresh(); setStatus("显示名已改（短号与引用不变）");
    }); return;
  }
  if (t.classList.contains("smp-state")) {
    const item = t.closest(".smp");
    const v = (f) => item.querySelector(`[data-field="${f}"]`)?.value ?? "";
    runBusy(t, "追加样品状态", async () => {
      await api.addSampleState(item.dataset.id, {
        amount: { value: v("stValue"), unit: v("stUnit"), estimated: item.querySelector('[data-field="stEst"]').checked },
        handling: v("stHandling"), use: v("stUse"), note: v("stNote"),
      });
      await refresh(); setStatus("样品状态已追加（历史不改写）");
    }); return;
  }
  if (t.id === "img-import") {
    runBusy(t, "归档原图", async () => {
      const file = $("#img-file").files?.[0];
      if (!file) throw new Error("请先选择图片文件");
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("读取图片失败")); fr.readAsDataURL(file); });
      const r = await api.importImage(file.name, dataUrl, ui.topicId || undefined);
      ui.assetId = r.assetId; ui.executionId = null; await refresh(); setStatus("原图已归档（可选择 AI 识别或人工转录）");
    }); return;
  }
  if (t.id === "map-create") {
    runBusy(t, "添加映射", async () => {
      await api.createMapping($("#map-original").value, $("#map-mapped").value, $("#map-basis").value, ui.topicId || undefined);
      await refresh(); setStatus("映射已添加（原名保留，依据必填）");
    }); return;
  }
  if (t.id === "cmp-create") {
    runBusy(t, "固定快照比较", async () => {
      const cardIds = [...$$(".cmp-card")].filter((x) => x.checked).map((x) => x.value);
      if (!cardIds.length) throw new Error("请先勾选已确认证据卡。");
      await api.createComparison({ topicId: ui.topicId, cardIds, filters: splitList($("#cmp-filters").value), conversions: splitList($("#cmp-conversions").value), exclusions: splitList($("#cmp-exclusions").value) });
      await refresh(); setStatus("比较快照已固定（追加式，不覆盖旧结论）");
    }); return;
  }
  if (t.classList.contains("cmp-again")) {
    runBusy(t, "重新比较", async () => {
      const cmp = state.comparisons.find((c) => c.id === t.dataset.id);
      const cardIds = [...new Set(cmp.groups.flatMap((g) => g.entries.map((e) => e.cardId)))];
      await api.createComparison({ topicId: cmp.topicId, subquestionId: cmp.subquestionId, cardIds, filters: cmp.snapshot.filters, conversions: cmp.snapshot.conversions, exclusions: cmp.snapshot.exclusions });
      await refresh(); setStatus("已按当前卡版本生成新快照（旧快照保留）");
    });
  }
});
function openHistory(obj) {
  if (!obj) return;
  $("#drawer-title").textContent = "修订历史";
  $("#drawer-meta").textContent = `当前 rev ${obj.revision} · 共 ${obj.history.length} 条`;
  $("#drawer-body").innerHTML = obj.history.length === 0 ? `<p class="hint">暂无修订记录。</p>`
    : `<table class="grid"><thead><tr><th>rev</th><th>字段</th><th>前</th><th>后</th><th>原因</th><th>时间</th></tr></thead><tbody>${
        obj.history.slice().reverse().map((h) => `<tr><td>${h.revision}</td><td>${esc(h.field)}</td><td class="raw">${esc(h.before)}</td><td class="raw">${esc(h.after)}</td><td>${esc(h.reason)}</td><td>${esc(h.at)}</td></tr>`).join("")
      }</tbody></table>`;
  $("#drawer").hidden = false;
}
$("#drawer-close").addEventListener("click", () => { $("#drawer").hidden = true; });
window.addEventListener("beforeunload", (e) => { if (ui.dirty) { e.preventDefault(); e.returnValue = ""; } });

async function refreshAiState() {
  const s = await api.aiStatus();
  $("#ai-state").textContent = s.configured
    ? `已配置 · ${s.model} @ ${s.baseUrl} · 超时 ${Math.round((s.timeoutMs ?? 120000) / 1000)}s（仅进程内存）`
    : "未配置：填写三项并保存后，文献导入可选 AI 抽取";
}
$("#ai-save").addEventListener("click", (ev) => runBusy(ev.target, "保存 AI 配置", async () => {
  const secs = Number($("#ai-timeout").value);
  const timeoutMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined;
  const s = await api.setAiConfig($("#ai-base").value, $("#ai-model").value, $("#ai-key").value, timeoutMs); $("#ai-key").value = ""; await refreshAiState();
  setStatus(s.configured ? `AI 已配置 · ${s.model}` : "AI 配置未生效");
}));
$("#ai-clear").addEventListener("click", (ev) => runBusy(ev.target, "清除 AI 配置", async () => { await api.clearAiConfig(); await refreshAiState(); setStatus("AI 配置已清除"); }));

refreshAiState().catch(() => {});
refresh().catch((e) => showBanner(`加载失败：${e.message}`));
