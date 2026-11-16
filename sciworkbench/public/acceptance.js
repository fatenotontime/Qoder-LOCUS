const $ = (s) => document.querySelector(s);
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const MATS = [
  {
    key: "csv", name: "EnzymeML_SLAC_pH3__Data.csv", file: "samples/slac-ph3-data.csv", kind: "text",
    title: "实验数据库（条件记录 CSV）", path: "路径② 实验数据",
    src: "DaRUS DOI 10.18419/DARUS-3337 · CC BY 4.0 · 30 组动力学测定之 pH3 条件块",
    act: "上传并构建数据表", route: "/api/import/measurements",
    body: (text, topicId) => ({ name: MATS[0].name, csv: text, topicId, headerRows: "auto", profile: "auto" }),
    stage: "核验未开始",
    summary: (st, a) => {
      const ts = st.tables.filter((t) => t.assetId === a.id);
      const rows = ts.reduce((n, t) => n + t.rows.length, 0);
      return `${ts.length} 张表 · ${rows} 行（含标记行）· 单元格核验未开始`;
    },
    advanced: (st, a) => st.tables.some((t) => t.assetId === a.id && t.revision > 1),
  },
  {
    key: "proto", name: "protocol-source.md", file: "samples/protocol-source.md", kind: "text",
    title: "实验方案（原作者 notebook 节选）", path: "路径① 文献证据 → 方案解析",
    src: "DaRUS DOI 10.18419/DARUS-3337 · CC BY 4.0 · 译述节选",
    act: "上传方案原件（草稿卡路径）", route: "/api/import/literature",
    body: (text, topicId) => ({ name: MATS[1].name, text, topicId, mode: "draft" }),
    stage: "方案解析未开始",
    summary: (st, a) => `${st.cards.filter((c) => c.assetId === a.id).length} 张草稿卡 · 方案尚未解析（主界面「AI 解析」或手工构建）`,
    advanced: (st, a) => st.protocols.some((p) => p.sourceAssetId === a.id),
  },
  {
    key: "hand", name: "handwriting-record.jpg", file: "samples/handwriting-record.jpg", kind: "image",
    title: "手写实验记录（网络来源真实手写件）", path: "路径③ 实验记录 · OCR",
    src: "知乎 @你知道我不知道（水印署名）· 大学物理实验记录 · 与 SLAC 课题不同源，仅演示 OCR 与人工确认门禁 · 无许可声明，不作再授权",
    act: "上传图片原件", route: "/api/import/image",
    body: (dataUrl, topicId) => ({ name: MATS[2].name, dataUrl, topicId }),
    stage: "识别未开始",
    summary: (st, a) => `原图已归档（${(a.bytes / 1024).toFixed(0)}KB，不压缩转码）· OCR 未开始（主界面识别或人工转录兜底）`,
    advanced: (st, a) => st.ocrs.some((o) => o.assetId === a.id),
  },
  {
    key: "meth", name: "methods-source.md", file: "samples/methods-source.md", kind: "text",
    title: "方法学文献（处理路径依据）", path: "路径① 文献证据",
    src: "DaRUS DOI 10.18419/DARUS-3337 · CC BY 4.0",
    act: "上传并构建草稿卡", route: "/api/import/literature",
    body: (text, topicId) => ({ name: MATS[3].name, text, topicId, mode: "draft" }),
    stage: "核验未开始",
    summary: (st, a) => {
      const cs = st.cards.filter((c) => c.assetId === a.id);
      return `${cs.length} 张草稿卡 · ${cs.filter((c) => c.audit === "unreviewed").length} 张待核验`;
    },
    advanced: (st, a) => st.cards.some((c) => c.assetId === a.id && c.audit !== "unreviewed"),
  },
];

let state = null;
let topicId = null;
const out = (key, html) => { $(`#out-${key}`).innerHTML = html; };

function statusOf(m) {
  const a = state.assets.find((x) => x.name === m.name);
  if (!a) return { a: null, badge: '<span class="badge wait">待上传</span>' };
  if (m.advanced(state, a)) return { a, badge: `<span class="badge done">已上传 · 已推进（${m.stage.replace("未开始", "已开始")}）</span>` };
  return { a, badge: `<span class="badge uploaded">已上传 · ${m.stage}</span>` };
}

function render() {
  const t = state.topics[0];
  topicId = t?.id ?? null;
  $("#envnote").innerHTML = `验收环境：<code>data/acceptance.json</code> · 课题 ${state.topics.length} · 子问题 ${state.subquestions.length} · 原件 ${state.assets.length} · 表 ${state.tables.length} · 卡 ${state.cards.length} · 方案 ${state.protocols.length} · OCR ${state.ocrs.length}。<strong>不含你主实例的历史记录。</strong>`;
  $("#topic-body").innerHTML = t
    ? `<p><strong>${esc(t.name)}</strong></p><p class="hint">${esc(t.researchQuestion)}</p>
       <ul class="subq">${state.subquestions.filter((s) => s.topicId === t.id).map((s) => `<li class="${s.kind}">${esc(s.question)} <span class="badge ${s.kind === "exploratory" ? "warn" : "confirm"}">${s.kind === "exploratory" ? "探索性" : "已声明"}</span></li>`).join("")}</ul>`
    : '<p class="hint warn">尚无课题：先运行 node scripts/acceptance-seed.ts data/acceptance.json</p>';
  $("#mat-grid").innerHTML = MATS.map((m) => {
    const { a, badge } = statusOf(m);
    return `<div class="card matcard" id="mat-${m.key}">
      <h2 style="font-size:var(--text)">${esc(m.title)} ${badge}</h2>
      <div class="src">${esc(m.path)} · ${esc(m.src)}</div>
      <div class="acts">
        <button class="primary" id="up-${m.key}" ${a ? "disabled" : ""}>${m.act}</button>
        <button id="dup-${m.key}" ${a ? "" : "disabled"}>再传一次（验 409 拒重）</button>
        <button id="prev-${m.key}">预览原件</button>
        ${a ? '<a href="/" style="font-size:var(--text-sm)">主界面继续 →</a>' : ""}
      </div>
      <div id="prevbox-${m.key}"></div>
      <div class="out" id="out-${m.key}">${a ? `<span class="ok">${esc(m.summary(state, a))}</span>` : ""}</div>
    </div>`;
  }).join("");
  for (const m of MATS) {
    $(`#up-${m.key}`).onclick = () => upload(m, false);
    $(`#dup-${m.key}`).onclick = () => upload(m, true);
    $(`#prev-${m.key}`).onclick = () => preview(m);
  }
}

async function contentOf(m) {
  const r = await fetch(m.file);
  if (!r.ok) throw new Error(`样本文件缺失：${m.file}`);
  if (m.kind === "image") {
    const blob = await r.blob();
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  return await r.text();
}

async function upload(m, isDup) {
  const btn = $(`#up-${m.key}`); const dbtn = $(`#dup-${m.key}`);
  btn.disabled = dbtn.disabled = true;
  out(m.key, "上传中…（调用真实导入函数）");
  try {
    const content = await contentOf(m);
    const { status, j } = await api(m.route, m.body(content, topicId));
    if (status === 409) {
      out(m.key, `<span class="${isDup ? "ok" : "err"}">409 拒重：${esc(j.error)}${j.existingAssetId ? ` <code>${esc(j.existingAssetId)}</code>` : ""}${isDup ? "（预期行为：指向已有原件，不产生重复）" : ""}</span>`);
    } else if (status >= 400) {
      out(m.key, `<span class="err">${status}：${esc(j.error)}</span>`);
    } else {
      await load();
      const a = state.assets.find((x) => x.name === m.name);
      out(m.key, `<span class="ok">构建完成：${esc(m.summary(state, a))}</span>`);
      return;
    }
  } catch (e) {
    out(m.key, `<span class="err">${esc(e.message)}</span>`);
  }
  btn.disabled = !!statusOf(m).a; dbtn.disabled = !statusOf(m).a;
}

async function preview(m) {
  const box = $(`#prevbox-${m.key}`);
  if (box.innerHTML) { box.innerHTML = ""; return; }
  if (m.kind === "image") { box.innerHTML = `<img class="prev" src="${m.file}" alt="手写实验记录（网络来源）">`; return; }
  const text = await contentOf(m);
  const lines = text.split("\n");
  box.innerHTML = `<pre class="prev">${esc(lines.slice(0, 30).join("\n"))}${lines.length > 30 ? `\n…（共 ${lines.length} 行，预览前 30 行）` : ""}</pre>`;
}

async function load() {
  state = await (await fetch("/api/state")).json();
  render();
}
await load();
const ai = await (await fetch("/api/ai/status")).json();
$("#envnote").innerHTML += ai.configured
  ? ` AI 已配置（${esc(ai.model)}）：上传构建不依赖 AI；解析/识别可在主界面发起。`
  : " AI 未配置：上传构建走草稿/原图归档路径，不冒充 AI；如需 AI 解析/识别请在主界面配置。";