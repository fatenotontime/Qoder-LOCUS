/**
 * 领域知识积累页：渲染（纯函数）＋事件注册（bindKnowledge）。
 * 渲染函数无 DOM；事件走文档级委托、closest() 命中。
 * 行为与拆分前一致：DOM、文案、接口、请求时序均不变。
 */
import { esc } from "../views.js";
import { fmtEnum, fmtReview, fmtUnknowns, fmtUncertain, fmtValue, fmtVersion } from "../format.js";
import { aiSproutHtml, knowledgeStageHtml, kzStageState, kzJobMatches } from "./knowledge-stage.js";

const ROLE_LABEL = { fulltext: "正文", supplement: "补充材料", other: "其他" };

let ctx = null;

/**
 * 幂等键（合同 §6.3）：由本次请求输入决定——同一表单重复点击得到同键同输入 → 后端复用既有 run；
 * 改了附件/目的即换键，不会把新意图当成旧任务的重放。
 */
function kzKey(o) {
  const s = `${o.paperId}|${[...o.attachmentIds].sort().join(",")}|${o.topicId ?? ""}|${o.subquestionId ?? ""}|${o.purpose}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return `kz_${h.toString(16)}_${s.length}`;
}

// ── 任务归属与找回（合同 §5.4：切页/刷新按持久 run 恢复，不依赖临时 job）──

const RUN_STATUS = { running: "running", paused: "paused", failed: "error", error: "error", completed: "done", done: "done", cancelled: "done" };

/** 由 state.knowledge.extractionRuns 里属于当前课题/文献的运行记录重建 ui.kzJob（仅当当前无任务时）。 */
function recoverJobFromRuns(state, ui) {
  if (ui.kzJob || !ui.topicId) return;
  const runs = state.knowledge?.extractionRuns ?? [];
  const mine = runs
    .filter((r) => r.topicId === ui.topicId && (!ui.paperId || (r.paperRef?.id ?? r.paperRef) === ui.paperId))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  const run = mine[0];
  if (!run) return;
  const chunks = run.chunks ?? [];
  const done = chunks.filter((c) => ["committed", "done", "ok", "extracted"].includes(c.status)).length;
  const chunkErrors = chunks.map((c, i) => ({ index: i, c })).filter(({ c }) => c.status === "failed" || c.error).map(({ index }) => ({ index }));
  ui.kzJob = {
    id: null, runId: run.id, topicId: run.topicId, paperId: run.paperRef?.id ?? ui.paperId ?? null,
    status: RUN_STATUS[run.status] ?? "idle", done, total: chunks.length,
    created: 0, chunkErrors, message: "已按运行记录恢复任务状态",
  };
  // 刷新/切页后按已存运行编号再核一次实时状态（不阻塞首屏）；有在跑 job 则续轮询。
  if (ui.kzResumeRunId !== run.id && (run.status === "running" || run.status === "paused")) {
    ui.kzResumeRunId = run.id;
    Promise.resolve(ctx.api.knowledgeRun?.(run.id)).then((resp) => {
      if (!resp || !ui.kzJob || ui.kzJob.runId !== run.id) return;
      const rr = resp.run ?? {}; const j = resp.job;
      const jstatus = j ? (j.status === "running" ? "running" : j.status === "paused" ? "paused" : j.status === "error" ? "error" : "done") : (RUN_STATUS[rr.status] ?? ui.kzJob.status);
      ui.kzJob = {
        ...ui.kzJob, id: resp.jobId ?? ui.kzJob.id, status: jstatus,
        done: j?.done ?? ui.kzJob.done, total: j?.total ?? ui.kzJob.total,
        created: j?.result?.created ?? ui.kzJob.created,
        createdItems: j?.result?.createdItems ?? ui.kzJob.createdItems ?? 0,
        pendingItems: j?.result?.pendingItems ?? ui.kzJob.pendingItems ?? 0,
        chunkErrors: j?.result?.chunkErrors ?? ui.kzJob.chunkErrors,
        message: j?.message ?? ui.kzJob.message,
      };
      ctx.renderRight?.(); softStageRender();
      if (resp.jobId && j && j.status === "running") pollKnowledgeJob(resp.jobId, run.id).then(() => ctx.refreshAfterJob()).catch(() => {});
    }).catch(() => {});
  }
}

/** 迹芽一次性事件：写入 ui.kzSprout（渲染时带 data-pulse，跨 refresh 保留），到时清掉，不重渲染中栏。 */
let sproutPulseTimer = null;
function sproutEvent(pose, token) {
  const ui = ctx.ui;
  if (ui.kzSproutLast === token) return;
  ui.kzSproutLast = token;
  ui.kzSprout = { pose, token };
  const el = document.querySelector(".kzstage .kz-sprout-art");
  if (el) el.dataset.pulse = pose;
  clearTimeout(sproutPulseTimer);
  sproutPulseTimer = setTimeout(() => { ui.kzSprout = null; const n = document.querySelector(".kzstage .kz-sprout-art"); if (n) delete n.dataset.pulse; }, pose === "review" ? 650 : 600);
}

/** 舞台状态切换时的中栏刷新：有未提交核对内容时跳过，保留正在核对的卡/备注/滚动。 */
function softStageRender() { if (!ctx.ui.dirty) ctx.renderMiddle?.(); }


const KZ_PART = (c) => (c.audit === "confirm" ? "cand" : c.audit === "skip" ? "skip" : c.audit === "exclude" ? "excl" : "todo");
const KZ_STATUS = { todo: "待审", cand: "已入候选", skip: "已跳过", excl: "已排除" };
/** 卡片归属的文献条目：显式 paperId 优先，旧数据按原件→论文附件回查（与服务端迁移口径一致）。 */
const kzCardPaper = (state, c) => c.paperId ?? state.attachments?.find((a) => a.assetId === c.assetId)?.paperId ?? "";
const kzPaperInTopic = (state, ui, paper) => (!ui.topicId ? true : (state.papers.find((p) => p.id === paper)?.topicIds?.includes(ui.topicId) ?? false));
const kzCards = (state, ui) => state.cards.filter((c) => { const pid = kzCardPaper(state, c); if (!kzPaperInTopic(state, ui, pid)) return false; return ui.paperId ? pid === ui.paperId : true; });

/** 原文区（显示层排版；原件字节不改）。章节标题、影印页码、段落间距；命中高亮。 */
function fmtSource(text, hi) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) { out.push(`<p>${esc(buf.join(" "))}</p>`); buf = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^#{1,6}\s+/.test(line)) { flush(); out.push(`<h4>${esc(line.replace(/^#{1,6}\s+/, ""))}</h4>`); continue; }
    if (/^（影印页|^\d{1,4}\s*$/.test(line)) { flush(); out.push(`<div class="kzpage">${esc(line)}</div>`); continue; }
    buf.push(line);
  }
  flush();
  let html = out.join("");
  if (hi && html.includes(esc(hi))) html = html.split(esc(hi)).join(`<mark>${esc(hi)}</mark>`);
  return html;
}

export function knowledgeLeftHtml(state, ui) {
  const paper = state.papers.find((p) => p.id === ui.paperId);
  if (!paper) return `<p class="hint">在左侧选择文献条目。</p>`;
  if (ui.topicId && !(paper.topicIds ?? []).includes(ui.topicId)) {
    return `<p class="hint">该条目不属于当前课题：请在本课题的文献里选择，或先在文献卷建立关联。</p>`;
  }
  const atts = state.attachments.filter((a) => a.paperId === ui.paperId);
  const asset = (ui.assetId && state.assets.find((a) => a.id === ui.assetId)) || state.assets.find((a) => a.id === atts[0]?.assetId);
  if (!asset) return `<p class="hint">该条目暂无附件。</p>`;
  return `<div class="kztextwrap"><div class="kztext-title">${esc(asset.name)}</div><div class="kztext" id="kz-text" data-asset="${esc(asset.id)}">${fmtSource(asset.text, ui.highlight)}</div></div>`;
}

function firstQuote(c) {
  return c.spans?.find((s) => s.matched)?.quote || c.locator?.sectionQuote || "";
}

// ── E3 分项审阅：知识项 / 条件 / 引文（数据随 /api/state 到达，动作走 §8.1 端点）──

const kzEnv = (state, coll, id) => (state.knowledge?.[coll] ?? []).find((e) => e.id === id) ?? null;
const kzItems = (state, cardId) => (state.knowledge?.items ?? []).filter((e) => e.payload?.cardId === cardId);
const kzPendingItems = (state, cardIds) => (state.knowledge?.items ?? [])
  .filter((e) => e.payload?.review?.status === "pending" && (!cardIds || cardIds.has(e.payload.cardId)));

/** 按钉住的版本读 payload（§4.2 旧版从 history 读，界面不退回最新版冒充）。 */
const kzEnvAt = (state, coll, ref) => {
  const env = kzEnv(state, coll, ref?.id);
  if (!env) return null;
  if (env.revision === ref.revision) return env.payload ?? {};
  const hit = (env.history ?? []).find((h) => h.revision === ref.revision);
  return hit ? hit.payload ?? {} : null;
};

/** 引用落后于引文当前版：不自动升级，只给人工「改绑当前版」入口（§4.6.9）。 */
function kzEvFollowHtml(state, ref, cls, extra) {
  const env = kzEnv(state, "evidence", ref?.id);
  if (!env || ref.revision === env.revision) return "";
  const at = kzEnvAt(state, "evidence", ref);
  return `<div class="kv stalev">本处引用${esc(fmtVersion(ref.revision))}：${esc(fmtEnum(at?.locationStatus))}`
    + `<button class="${cls}" ${extra} data-evid="${esc(ref.id)}" data-to="${esc(env.revision)}">改绑当前版</button>`
    + `<span class="hint">定位后不自动升级，改绑即回待审</span></div>`;
}

/** 一条引文：逐字原文可回查、定位状态由服务端给出；多处命中时列出全部出现位置供人工选定（含当前默认处）。 */
function kzEvidenceHtml(state, ref, follow = "") {
  const env = kzEnv(state, "evidence", ref.id);
  if (!env) return `<div class="kv warn">引文对象缺失（${esc(ref.id)}）：请重新提取或改为人工记录。</div>`;
  const p = env.payload ?? {};
  const cur = p.locator?.type === "text" ? p.locator.start : null;
  const offs = [...new Set([cur, ...(p.candidates ?? []).map((c) => c.locator?.start)].filter((s) => typeof s === "number"))].sort((a, b) => a - b);
  const picks = offs.length > 1
    ? `<div class="kzcands">出现位置：${offs.map((s, i) => `<button class="kz-pick${s === cur ? " now" : ""}" data-evid="${esc(env.id)}" data-rev="${env.revision}" data-start="${s}" data-quote="${esc(p.quote)}">第${i + 1}处${s === cur ? "（当前）" : ""}</button>`).join("")}</div>`
    : "";
  return `<div class="kzev">
    <div class="kv">引文：<button class="kz-locate" data-quote="${esc(p.quote)}">${esc(String(p.quote ?? "").slice(0, 48))}</button>
      <span class="badge">${esc(fmtEnum(p.locationStatus))}</span><span class="hint">${esc(fmtVersion(env.revision))}</span></div>
    ${picks}
    <div class="kv"><input class="kz-quote" data-evid="${esc(env.id)}" data-rev="${env.revision}" value="${esc(p.quote)}" placeholder="逐字粘贴要定位的原句" /><button class="kz-resolve" data-evid="${esc(env.id)}" data-rev="${env.revision}">定位</button><span class="hint">服务端按原件逐字核对，不符不会写成已定位</span></div>
    ${follow}
  </div>`;
}

/** 条件编辑：一次给出全部条件（服务端按整组替换），改动的条件回待审（§4.2）。 */
function kzCondEditHtml(env, conds) {
  const rows = conds.map((c) => {
    const v = c.value ?? {};
    const isScalar = v.kind === "scalar";
    const head = `<div class="kzcond-edit" data-condid="${esc(c.id)}">`;
    const name = `<input class="kcf-field" value="${esc(c.field?.raw ?? "")}" placeholder="条件名" />`;
    const raw = `<input class="kcf-raw" value="${esc(v.raw ?? "")}" placeholder="原样写法" />`;
    const num = `<input class="kcf-num" value="${isScalar ? esc(v.value ?? "") : ""}" placeholder="数值" />`;
    const unit = `<input class="kcf-unit" value="${isScalar ? esc(v.unit ?? "") : ""}" placeholder="单位" />`;
    const btn = `<button class="kcf-save" data-ctxid="${esc(env.id)}" data-rev="${env.revision}">改条件</button>`;
    const kind = `<span class="hint">${esc(fmtEnum(v.kind))}</span>`;
    return head + name + raw + num + unit + btn + kind + `</div>`;
  }).join("");
  return `<details class="kcedit"><summary>改条件（改动即回待审，留空即不改值）</summary>${rows}</details>`;
}

/** 条件对象：逐项审核；未审条件会挡住知识项确认（§4.2 顺序）。 */
function kzContextHtml(state, ref, allowFollow = true) {
  const env = kzEnv(state, "contexts", ref.id);
  if (!env) return `<div class="kv warn">条件对象缺失（${esc(ref.id)}）。</div>`;
  const p = env.payload ?? {};
  const conds = p.conditions ?? [];
  const condEv = (c) => (allowFollow ? (c.evidenceRefs ?? []).map((r) => kzEvidenceHtml(state, r,
    kzEvFollowHtml(state, r, "kef-cond", `data-ctxid="${esc(env.id)}" data-rev="${esc(env.revision)}" data-condid="${esc(c.id)}"`))).join("") : "");
  const rows = conds.map((c) => `<div class="kzcond"><span class="badge">${esc(fmtReview(c.review?.status))}</span> ${esc(c.field?.raw ?? "条件")}＝${esc(fmtValue(c.value))}<span class="hint">${esc(fmtEnum(c.obtainedBy))}</span>${c.review?.status === "pending" ? `<button class="kc-ok" data-ctxid="${esc(env.id)}" data-rev="${env.revision}" data-condid="${esc(c.id)}">确认</button>` : ""}${condEv(c)}</div>`).join("");
  return `<div class="kzctx"><div class="kv">适用条件（${esc(fmtReview(p.review?.status))}）：<input class="kc-basis" data-ctxid="${esc(env.id)}" placeholder="核对依据（必填）" /><button class="kc-all" data-ctxid="${esc(env.id)}" data-rev="${env.revision}">全部确认</button></div>
    ${rows || `<div class="kv hint">该项未绑条件。</div>`}
    ${conds.length ? kzCondEditHtml(env, conds) : ""}
    ${p.unknowns?.length ? `<div class="kv">条件未知项：${esc(fmtUnknowns(p.unknowns))}</div>` : ""}
  </div>`;
}

/** 一个知识项：内容＋值＋条件＋引文＋未知＋版本；动作只有确认/待补/排除，依据必填。 */
function kzItemHtml(state, env, ui) {
  const pinned = ui.kiView && ui.kiView.id === env.id ? ui.kiView : null;
  const p = pinned ? pinned.payload : env.payload ?? {};
  const rev = pinned ? pinned.revision : env.revision;
  const history = env.history ?? [];
  const evRefs = (p.evidenceRefs ?? []).map((b) => b.ref ?? b);
  const ctxRefs = p.contextRefs ?? [];
  const o = p.origin ?? {};
  const head = `<div class="kihead"><span class="badge">${esc(fmtEnum(p.nature))}</span><span class="hint">${esc(fmtEnum(p.contentType))}</span>
    <b>${esc(p.text)}</b><span class="badge">${esc(fmtReview(p.review?.status))}</span>
    <span class="hint">${esc(fmtVersion(rev))}${pinned ? "（旧版只读，条件仍可继续审阅）" : ""}</span></div>`;
  const unc = p.value?.uncertainty ? ` · ${esc(fmtUncertain(p.value))}` : "";
  const facts = `<div class="kv">值：${esc(fmtValue(p.value))}${unc} · 对象：${esc(p.subject?.raw ?? "—")}｜${esc(p.predicate?.raw ?? "—")}</div>`;
  const scope = p.scopeText ? `<div class="kv">范围：${esc(p.scopeText)}</div>` : "";
  const unk = p.unknowns?.length ? `<div class="kv">未知：${esc(fmtUnknowns(p.unknowns))}</div>` : "";
  const who = fmtEnum(o.sourceClass);
  const by = o.createdBy === "human" ? "人工记录" : o.createdBy === "import" ? "导入摘录" : "模型摘录";
  const sec = o.secondaryCitation ? "（二手转引）" : "";
  const origin = `<div class="kv">来源：${esc(who)}｜${esc(by)}${esc(sec)}</div>`;
  const ev = evRefs.map((r) => kzEvidenceHtml(state, r,
    pinned ? "" : kzEvFollowHtml(state, r, "kef-item", `data-iid="${esc(env.id)}" data-rev="${esc(env.revision)}"`))).join("");
  const ctx = ctxRefs.map((r) => kzContextHtml(state, r, !pinned)).join("");
  const opts = history.map((h) => `<option value="${esc(h.revision)}">${esc(fmtVersion(h.revision))}（${esc(h.reason)}）</option>`).join("");
  const picker = history.length ? `<select class="ki-old"><option value="">回查旧版</option>${opts}</select>` : "";
  const basis = `<input class="ki-basis" placeholder="核对依据（必填）" />`;
  const btnOk = `<button class="ki-ok" data-iid="${esc(env.id)}" data-rev="${esc(env.revision)}">确认</button>`;
  const btnInfo = `<button class="ki-info" data-iid="${esc(env.id)}" data-rev="${esc(env.revision)}">待补</button>`;
  const btnOut = `<button class="ki-out" data-iid="${esc(env.id)}" data-rev="${esc(env.revision)}">排除</button>`;
  const rawVal = esc(p.value?.raw ?? "");
  const numVal = esc(p.value?.value ?? "");
  const unitVal = esc(p.value?.unit ?? "");
  const scopeVal = esc(p.scopeText ?? "");
  const edit = `<details class="kiedit"><summary>改值/范围（改动即生成新版并回待审）</summary>
    <input class="ki-raw" value="${rawVal}" placeholder="原样写法，如 0.8 s" />
    <input class="ki-num" value="${numVal}" placeholder="数值，如 0.8" />
    <input class="ki-unit" value="${unitVal}" placeholder="单位，如 s" />
    <input class="ki-scope" value="${scopeVal}" placeholder="适用范围（可空）" />
    <button class="ki-save" data-iid="${esc(env.id)}" data-rev="${esc(env.revision)}">保存</button>
  </details>`;
  const acts = pinned
    ? `<div class="kiacts"><button class="ki-back" data-iid="${esc(env.id)}">回到当前版</button></div>`
    : `<div class="kiacts">${basis}${btnOk}${btnInfo}${btnOut}${picker}</div>${edit}`;
  return `<div class="kitem${pinned ? " oldview" : ""}" data-iid="${esc(env.id)}" data-rev="${esc(env.revision)}">${head}${facts}${scope}${unk}${origin}${ev}${ctx}${acts}</div>`;
}

/** 壳卡分项区：整卡状态由分项派生，这里只逐项操作（§4.6.5/§4.6.9）。 */
function kzShellHtml(state, card, ui) {
  const items = kzItems(state, card.id);
  if (!items.length) return `<p class="hint warn">该卡标记为结构化壳，但没有分项数据：请重新提取或联系修复。</p>`;
  const done = items.filter((e) => e.payload?.review?.status === "confirmed").length;
  return `<div class="kzshell"><div class="kv hint">分项 ${done}/${items.length} 已确认 · 整卡状态由此派生</div>
    ${items.map((e) => kzItemHtml(state, e, ui)).join("")}</div>`;
}

/** 旧卡显式结构化（§4.6.6）：一次一张卡，人工填写，不做全库自动转换。 */
function kzStructFormHtml(card) {
  return `<div class="kzstruct">
    <p class="hint">结构化＝把这张旧卡的判断改写成「引文＋条件＋知识项」，旧文本保留可回查；生成后一律待审。</p>
    <label>引文（逐字粘贴原文）<input class="ks-quote" value="${esc(firstQuote(card) || card.rawText.slice(0, 60))}" /></label>
    <label>引文来源<select class="ks-src"><option value="card">本卡记录</option><option value="asset">原件正文</option></select></label>
    <p class="hint">「本卡记录」＝在这张卡已归档的文字内逐字定位；「原件正文」＝锚定文献原件，需粘贴原件里的连续句子（版本由服务端锚定，不自称）。</p>
    <label>知识项文本<input class="ks-text" value="${esc(card.rawText.slice(0, 120))}" /></label>
    <div class="ksrow"><input class="ks-raw" placeholder="原样写法，如 0.8 s" /><input class="ks-num" placeholder="数值" /><input class="ks-unit" placeholder="单位" /></div>
    <label>条件（可空）<input class="ks-cond" placeholder="如：温度＝25 °C" /></label>
    <button class="ks-go" data-cid="${esc(card.id)}" data-rev="${card.revision}">结构化</button>
  </div>`;
}

/** 主题区：成员与「当前认识」（当前认识只允许已确认项，§4.7）。 */
function kzThemesHtml(state, ui) {
  const themes = state.knowledge?.themes ?? [];
  const pool = (state.knowledge?.items ?? []).filter((e) => !ui.topicId || (e.payload?.topicIds ?? []).includes(ui.topicId));
  const confirmed = pool.filter((e) => e.payload?.review?.status === "confirmed");
  if (!ui.topicId) return `<div class="kzthemes"><p class="hint warn">先在顶部选择课题：主题按课题归属，成员不能跨课题混入。</p></div>`;
  if (!pool.length) return `<div class="kzthemes"><p class="hint">本课题还没有知识项：先到「文献整理」发起语义提取，或在中栏「＋新建」记一条认识。</p></div>`;
  const boxes = (cls, chosen) => pool.map((e) => {
    const on = chosen.includes(e.id);
    const dis = cls === "kt-j" && e.payload?.review?.status !== "confirmed" ? " disabled" : "";
    return `<label class="ktbox${on ? " on" : ""}"><input type="checkbox" class="${cls}" value="${esc(e.id)}" data-rev="${e.revision}"${on ? " checked" : ""}${dis} />`
      + `<span class="badge">${esc(fmtEnum(e.payload?.nature))}</span>${esc(String(e.payload?.text ?? "").slice(0, 42))}</label>`;
  }).join("");
  const rows = themes.map((env) => {
    const p = env.payload ?? {};
    const memberIds = (p.members ?? []).map((r) => r.id);
    const judgIds = (p.currentJudgmentRefs ?? []).map((r) => r.id);
    return `<div class="ktheme" data-tid="${esc(env.id)}" data-rev="${env.revision}">
      <div class="kv"><b>${esc(p.name)}</b><span class="hint">　成员 ${(p.members ?? []).length} · 当前认识 ${(p.currentJudgmentRefs ?? []).length} · ${esc(fmtVersion(env.revision))}</span></div>
      ${p.definition ? `<div class="kv hint">${esc(p.definition)}</div>` : ""}
      <details class="ktedit"><summary>改成员 / 改当前认识</summary>
        <div class="kthint">成员（本课题的知识项）</div><div class="ktlist">${boxes("kt-m", memberIds)}</div>
        <div class="kthint">当前认识（仅已确认可选）</div><div class="ktlist">${boxes("kt-j", judgIds)}</div>
        <input class="kt-name" value="${esc(p.name)}" placeholder="主题名" />
        <input class="kt-def" value="${esc(p.definition ?? "")}" placeholder="定义（可空）" />
        <button class="kt-save" data-tid="${esc(env.id)}" data-rev="${env.revision}">保存</button>
      </details>
    </div>`;
  }).join("");
  return `<div class="kzthemes">
    <div class="kzq-head">主题 <span class="badge">${themes.length}</span></div>
    ${rows || `<p class="hint">还没有主题：在下方把相关分项归到一个主题，再指定「当前认识」。</p>`}
    <div class="ktnew">
      <div class="kthint">新主题名称</div><input class="kn-name" placeholder="如：pH 对响应时间的影响" />
      <div class="kthint">定义（可空）</div><input class="kn-def" placeholder="这个主题在回答什么" />
      <div class="kthint">成员</div><div class="ktlist">${boxes("kn-m", [])}</div>
      <div class="kthint">当前认识（已确认 ${confirmed.length} 项可选）</div><div class="ktlist">${boxes("kn-j", [])}</div>
      <button class="kn-go">创建主题</button>
      <p class="hint">未确认项不能进入「当前认识」；跨课题项需要显式同意才会加入。</p>
    </div>
  </div>`;
}

export function knowledgeWorkspaceHtml(state, ui) {
  if (ui.kzPanel === "themes") {
    return `${knowledgeStageHtml(state, ui)}<div class="kzpick"><button class="kz-panel ${ui.kzPanel === "themes" ? "" : "active"}" data-panel="cards">分项</button><button class="kz-panel active" data-panel="themes">主题</button></div>${kzThemesHtml(state, ui)}`;
  }
  const cards = kzCards(state, ui);
  const part = { todo: [], cand: [], skip: [], excl: [] };
  for (const c of cards) part[KZ_PART(c)].push(c);
  const tab = ui.kzTab && part[ui.kzTab] ? ui.kzTab : "todo";
  const tabs = [["todo", "待审"], ["cand", "已入候选"], ["skip", "已跳过"], ["excl", "已排除"]];
  const tabHtml = tabs.map(([k, l]) => `<button class="kztab ${k === tab ? "active" : ""}" data-kztab="${k}">${l} ${part[k].length}</button>`).join("");
  const rows = part[tab].map((c) => {    const open = ui.cardOpen === c.id;
    const type = c.kind ? fmtEnum(c.kind) : (c.extraction === "ai" ? "模型摘录" : "摘录");
    const q = firstQuote(c);
    // §4.6.5：新壳审核状态由知识项派生，旧整卡确认/排除端点会返回冲突 → 这里先不呈现该动作。
    const shell = Array.isArray(c.knowledgeItemIds) && c.knowledgeItemIds.length > 0;
    const acts = shell
      ? `<span class="hint">整卡状态由分项派生，此处仅可改备注与重要度。</span>`
      : tab === "todo"
        ? `<button class="kz-cand" data-cid="${c.id}">入候选</button><button class="kz-skip" data-cid="${c.id}">跳过</button><button class="kz-excl" data-cid="${c.id}">排除</button>`
        : `<button class="kz-undo" data-cid="${c.id}">撤回</button>`;
    return `<div class="kzcard ${open ? "open" : ""}" data-cid="${c.id}">
      <div class="kzhead"><button class="kz-open" data-cid="${c.id}"><span class="kztype">${esc(type)}</span> · <span class="kzsum">${esc(c.rawText.slice(0, 40))}</span></button><span class="badge">${shell ? "待逐项审" : KZ_STATUS[KZ_PART(c)]}</span></div>
      ${open ? `<div class="kzbody">
        <div class="kv">内容：${esc(c.rawText)}</div>
        ${c.scope ? `<div class="kv">适用范围：${esc(c.scope)}</div>` : ""}
        <div class="kv">重要程度：<select class="kz-imp" data-cid="${c.id}">${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v ? fmtEnum(v) : "未定"}</option>`).join("")}</select></div>
        <div class="kv">备注：<input class="kz-note" data-cid="${c.id}" value="${esc(ui.kzNoteDraft?.[c.id] ?? c.note)}" /></div>
        <div class="kv">原文位置：${q ? `<button class="kz-locate" data-cid="${c.id}" data-quote="${esc(q)}">看原文</button>` : `<span class="hint">定位不足</span>`}</div>
        ${tab === "todo" ? `<details class="kz-reason"><summary>排除原因（可选）</summary><input class="kz-exclr" data-cid="${c.id}" placeholder="可选，留空即不填" /></details>` : ""}
        ${shell ? kzShellHtml(state, c, ui) : ""}
        ${!shell && ui.kzStruct === c.id ? kzStructFormHtml(c) : ""}
        <div class="kzactions">${acts}${shell || tab !== "todo" ? "" : `<button class="kz-tostruct" data-cid="${c.id}">结构化</button>`}</div>
      </div>` : ""}
    </div>`;
  }).join("");
  return `${knowledgeStageHtml(state, ui)}<div class="kzpick"><button class="kz-panel active" data-panel="cards">分项</button><button class="kz-panel" data-panel="themes">主题</button></div>
    <div class="kzpick">文献：<select id="kz-paper">${(() => { const ps = state.papers.filter((p) => !ui.topicId || (p.topicIds ?? []).includes(ui.topicId)); return ps.length ? ps.map((p) => `<option value="${esc(p.id)}" ${p.id === ui.paperId ? "selected" : ""}>${esc(p.title)}</option>`).join("") : `<option>（本课题暂无文献）</option>`; })()}</select></div>
    <div class="kztabs">${tabHtml}</div>
    <div class="kzlist">${rows || `<p class="hint">此分区暂无卡片。</p>`}</div>
    <div class="kzfoot"><button class="kz-skipall">一键全部跳过</button><span class="hint">为时间紧准备，不推荐</span></div>`;
}

export function knowledgeQueueHtml(state, ui) {
  const queue = kzCards(state, ui).filter((c) => c.extraction === "ai" && KZ_PART(c) === "todo");
  const j = kzJobMatches(ui, ui.topicId, ui.paperId) ? ui.kzJob : null;
  const task = j ? `<div class="kzq-task">
    <span class="hint">${j.status === "running" ? `抽取中 ${j.done}/${j.total} 块，已出 ${j.created} 张／${j.pendingItems ?? 0} 项待审` : (j.status === "paused" ? `已暂停：已出 ${j.created} 张（${j.runStatus ?? "可继续"}）` : (j.cancelled ? `已取消，保留已出 ${j.created} 张` : esc(j.message ?? "")))}</span>
    ${j.status === "running" ? `<button class="kzq-pause">暂停</button><button class="kzq-cancel">取消</button>` : ""}
    ${j.status === "paused" ? `<button class="kzq-resume">继续</button><button class="kzq-cancel">取消</button>` : ""}
  </div>${(j.chunkErrors ?? []).map((e) => `<div class="kzq-err">第 ${e.index + 1} 块失败 · <button class="kzq-retry" data-index="${e.index}">重试</button></div>`).join("")}${(j.unresolvedLinks ?? []).length ? `<div class="kzq-warn">有 ${j.unresolvedLinks.length} 处表号/小节引用未能唯一定位，已在对应知识项标为待补来源。</div>` : ""}` : "";
  const paperCards = new Set(kzCards(state, ui).map((c) => c.id));
  const scopeIds = (ui.paperId || ui.topicId) ? paperCards : null;
  const pending = kzPendingItems(state, scopeIds);
  return `<div class="kzq">
    <div class="kzq-head">AI 待审队列 <span class="badge">新增 ${queue.length}</span></div>
    ${task}
    <div class="kzq-list">${queue.map((c) => `<button class="kzq-item" data-cid="${c.id}">${esc(c.kind ? fmtEnum(c.kind) : "摘录")} · ${esc(c.rawText.slice(0, 28))}</button>`).join("") || `<p class="hint">队列为空。</p>`}</div>
    <div class="kzq-head kzq-items">知识项待审 <span class="badge">${pending.length}</span></div>
    <div class="kzq-list">${pending.slice(0, 30).map((e) => `<button class="kzq-kitem" data-iid="${esc(e.id)}" data-cid="${esc(e.payload?.cardId ?? "")}">${esc(fmtEnum(e.payload?.nature))} · ${esc(String(e.payload?.text ?? "").slice(0, 28))}</button>`).join("") || `<p class="hint">没有待审知识项。</p>`}</div>
  </div>`;
}

// ── 中栏「＋新建」：语义提取表单（含机械草稿调试） ──────────

export function renderKnowledgeForm(box) {
  const state = ctx.getState();
  const { ui, $, $$ } = ctx;
  recoverJobFromRuns(state, ui);
  const p = state.papers.find((x) => x.id === ui.paperId && (!ui.topicId || (x.topicIds ?? []).includes(ui.topicId))) ?? null;
  const atts = p ? state.attachments.filter((a) => a.paperId === p.id) : [];
  const subqs = state.subquestions.filter((q) => !ui.topicId || q.topicId === ui.topicId);
  box.innerHTML = `
    <details class="mini" open>
      <summary>语义提取（选文献＋目的）</summary>
      ${p ? `<div class="hint">当前文献：${esc(p.title)}</div>
        ${atts.length ? atts.map((a) => `<label class="cmppick"><input type="checkbox" class="k-att" value="${a.id}" checked/> ${esc(state.assets.find((x) => x.id === a.assetId)?.name ?? a.assetId)}（${ROLE_LABEL[a.role]}）</label>`).join("") : `<p class="hint warn">该条目无附件；先到「文献整理」导入。</p>`}
        <textarea id="k-purpose" rows="2" placeholder="研究目的（必填）：围绕哪个研究问题提取？如：比较 pH 对 Km 的影响"></textarea>
        ${subqs.length ? `<select id="k-subq"><option value="">（不挂子问题）</option>${subqs.map((q) => `<option value="${q.id}">${esc(q.question)}</option>`).join("")}</select>` : ""}
        <div class="kz-ai-start">${aiSproutHtml(kzStageState(ui), "kz-ai-sprout")}<button class="primary" id="k-start" ${atts.length ? "" : "disabled"}>发起语义提取（独立 AI 任务）</button></div>
        <p class="hint">抽取单位是研究意义（数据＋条件/方法、结论＋依据、思路），不是逐行拆文本；结果进右栏待审区，须人工核对。等待期间可继续编辑，不会被覆盖。</p>`
      : `<p class="hint">先在下方选择文献条目（或到「文献整理」新建）。</p>`}
    </details>
    <details class="mini">
      <summary>新增认识（人工判断）</summary>
      <textarea id="kstm-text" rows="2" placeholder="写下你现在的判断，例如：该体系在 pH 7 下响应时间优于 1 s"></textarea>
      <div class="ksrow"><select id="kstm-nature">
        <option value="human_judgment">人工判断</option><option value="hypothesis">假设</option><option value="interpretation">解释</option><option value="observation">观察</option>
      </select><input id="kstm-scope" placeholder="适用范围（可空）" /></div>
      <button id="kstm-go" class="primary">记下</button>
      <p class="hint">没有原文支撑的判断只作为「人工判断／假设」进入待审，不会自称观察证据；确认后才能进入主题「当前认识」与正式分析。</p>
    </details>
    <details class="mini">
      <summary>机械草稿（开发调试）</summary>
      <input id="dbg-name" placeholder="文件名" />
      <textarea id="dbg-text" rows="2" placeholder="粘贴文本：逐段拆分为草稿卡，全部标记 mechanical"></textarea>
      <button id="dbg-import">导入机械草稿</button>
    </details>`;
  const start = $("#k-start");
  if (start) start.addEventListener("click", (ev) => ctx.runJob(ev.target, "语义知识提取", async () => {
    const attachmentIds = [...$$(".k-att")].filter((x) => x.checked).map((x) => x.value);
    const purpose = $("#k-purpose").value;
    const topicId = ui.topicId || undefined;
    const subquestionId = $("#k-subq")?.value || undefined;
    const r = await ctx.api.knowledgeJob({ paperId: p.id, attachmentIds, purpose, topicId, subquestionId, idempotencyKey: kzKey({ paperId: p.id, attachmentIds, topicId, subquestionId, purpose }) });
    if (r.replayed) {
      ctx.setStatus("同样的输入已提取过（沿用原任务，不重复抽取）。如需重跑请用「继续」或改选附件。");
      if (r.jobId) { await pollKnowledgeJob(r.jobId, r.runId); await ctx.refreshAfterJob(); }
      return;
    }
    ui.kzJob = { id: r.jobId, runId: r.runId, topicId, paperId: p.id, status: "running", done: 0, total: r.total ?? 0, created: 0, chunkErrors: [], message: "语义提取中…" };
    ctx.renderRight(); ctx.renderMiddle?.();
    const job = await pollKnowledgeJob(r.jobId, r.runId);
    await ctx.refreshAfterJob();
    if (job.status === "done") { ctx.setStatus(job.message); }
    else { const h = ctx.humanError(job.error ?? ""); ctx.setStatus("知识提取失败，详情见错误面板。"); ctx.setError("right", { panel: "right", message: `知识提取失败：${h.message}`, detail: h.detail, retry: null }); }
  }));
  const stm = $("#kstm-go");
  if (stm) stm.addEventListener("click", (ev) => ctx.runBusy(ev.target, "记录认识", async () => {
    const text = $("#kstm-text").value.trim();
    if (!text) { ctx.setStatus("先写下判断本身：内容为空时不新增知识项。"); return; }
    if (!ui.topicId) { ctx.setStatus("先在顶部选择课题：认识必须归属到具体课题。"); return; }
    const nature = $("#kstm-nature").value;
    const scopeText = $("#kstm-scope").value.trim();
    await ctx.api.createStatement({ topicId: ui.topicId, text, nature, createdBy: "human", ...(scopeText ? { scopeText } : {}) });
    await ctx.refresh();
    ctx.setStatus("已记为待审知识项：人工确认后才进入当前认识与正式分析");
  }));
  $("#dbg-import").addEventListener("click", (ev) => ctx.runBusy(ev.target, "导入机械草稿", async () => {
    const r = await ctx.api.importLiterature($("#dbg-name").value || "debug.md", $("#dbg-text").value, "draft", ui.topicId || undefined);
    await ctx.refresh(); ctx.setStatus(`机械草稿已导入：${r.created} 张（全部标记 mechanical，仅供调试）`);
  }));
}

// ── 事件 ────────────────────────────────────────────────────

async function kzAct(fn, msg) {
  try { const r = await fn(); ctx.setDirty(false); await ctx.refresh(); ctx.setStatus(typeof msg === "function" ? msg(r) : msg); }
  catch (e) { const h = ctx.humanError(e); ctx.setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); }
}

/** 知识抽取流式轮询：只更新右栏队列（不动中栏编辑）。runId 随 job 一起留存，重启后仍可继续/重试。 */
async function pollKnowledgeJob(jobId, runId) {
  const { api, ui } = ctx;
  for (let i = 0; i < 2400; i++) {
    const job = await api.getJob(jobId);
    const prev = ui.kzJob ?? {};
    const createdItems = job.result?.createdItems ?? 0;
    const pendingItems = job.result?.pendingItems ?? 0;
    ui.kzJob = {
      id: jobId, runId: runId ?? job.result?.runId ?? prev.runId ?? null,
      topicId: prev.topicId ?? ui.topicId, paperId: prev.paperId ?? ui.paperId,
      status: job.status, done: job.done ?? 0, total: job.total ?? 0, created: job.result?.created ?? 0,
      createdItems, pendingItems, runStatus: job.result?.runStatus ?? null,
      unresolvedLinks: job.result?.unresolvedLinks ?? [], chunkErrors: job.result?.chunkErrors ?? [],
      cancelled: job.result?.cancelled, message: job.message,
    };
    // 新卡待审：按本批新增（createdItems 增加）抬头一次，同批去重。
    const newPending = createdItems > (prev.createdItems ?? 0) && createdItems > 0;
    if (newPending) sproutEvent("review", `${runId}:${createdItems}`);
    ctx.renderRight();
    if (job.status === "done" || job.status === "error" || job.status === "paused") return job;
    await new Promise((r) => setTimeout(r, 700));
  }
  return { status: "error", error: "等待超时" };
}

/** 「温度＝25 °C」拆成名称与值，免得显示成「温度＝温度＝25 °C」。 */
export function kzCondSplit(text) {
  const s = String(text ?? "").trim();
  const at = s.search(/[=＝:：]/);
  if (at < 0) return { name: s, rhs: s };
  return { name: s.slice(0, at).trim(), rhs: s.slice(at + 1).trim() };
}

/** 值表单 → TypedValue：给了数字按单值，只给文字按类别；空则不动值。 */
function kzValueFrom(raw, num, unit) {
  const r = (raw ?? "").trim();
  const n = (num ?? "").trim();
  const u = (unit ?? "").trim();
  if (n && Number.isFinite(Number(n))) return { kind: "scalar", raw: r || n, value: n, unit: u };
  if (r) return { kind: "category", raw: r, label: r };
  return null;
}

/** 勾选框 → 固定版本引用：只带当前列表里的 revision，绝不落到「最新版」。 */
function kzRefsFrom(els, kind) {
  return [...els].filter((x) => x.checked).map((x) => ({ kind, id: x.value, revision: Number(x.dataset.rev) }));
}

/** 条件/分项写入后按返回值说清后果：还剩几个条件待审、哪些项被打回（§4.2 顺序＋§4.7 复检）。 */
function kzAfterNote(r, base) {
  const bits = [];
  const pend = (r?.pendingConditions ?? []).length;
  const aff = (r?.affectedItems ?? []).length;
  if (pend) bits.push(`还有 ${pend} 个条件待审`);
  if (aff) bits.push(`${aff} 个已确认知识项因引用变化回到待审`);
  return bits.length ? `${base}：${bits.join("；")}。` : base;
}

/** 主题写入：跨课题成员要用户显式同意后才带 allowCrossTopic 重放。 */
async function kzThemeCommit(call) {
  try { await call(false); }
  catch (e) {
    if (e?.details?.code !== "cross_topic_confirmation_required") throw e;
    if (!confirm("有成员不属于本课题：确认把它跨课题加入该主题吗？（不确认则不写入）")) throw e;
    await call(true);
  }
}

/** 同一容器内的核对依据；空依据不提交（合同要求「为什么确认」可见）。 */
function kzBasis(scope, sel) {
  const v = (scope?.querySelector(sel)?.value ?? "").trim();
  if (!v) ctx.setError("mid", { panel: "mid", message: "先写核对依据：确认/待补/排除都要留下判断理由。", detail: "", retry: null });
  return v;
}

/** 未提交的审阅草稿：切面板/跳卡/回当前版前先确认，不静默丢弃用户写下的依据。 */
const KZ_DRAFT = ".ki-basis, .ki-raw, .ki-num, .ki-unit, .ki-scope, .kc-basis, .kz-quote, .kz-note, .kcf-field, .kcf-raw, .kcf-num, .kcf-unit, .ks-quote, .ks-text, .ks-raw, .ks-num, .ks-unit, .ks-cond, .kt-name, .kt-def, .kn-name, .kn-def";
function kzDropDraft() {
  if (!ctx.ui.dirty) return true;
  if (!confirm("有未提交的审阅内容（依据／值／条件／主题名／备注），切换会丢弃。确定继续？")) return false;
  ctx.setDirty(false);
  return true;
}

/** 供 app.js 在「离开知识页」前调用：返回 true=可离开，false=用户取消。
 *  签名：kzLeaveGuard(): boolean
 *  依据 ui.dirty（含 .kz-note 备注、依据/值/条件/主题草稿）决定是否弹确认；未提交则不静默丢弃。 */
export function kzLeaveGuard() { return kzDropDraft(); }

export function bindKnowledge(c) {
  ctx = c;
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    const { ui, api, renderMiddle, renderShell } = ctx;
    const tab = t.closest?.(".kztab");
    if (tab) { ui.kzTab = tab.dataset.kztab; ui.cardOpen = null; renderMiddle(); return; }
    const open = t.closest?.(".kz-open");
    if (open) { ui.cardOpen = ui.cardOpen === open.dataset.cid ? null : open.dataset.cid; renderMiddle(); return; }
    const qi = t.closest?.(".kzq-item");
    if (qi) { ui.kzTab = "todo"; ui.cardOpen = qi.dataset.cid; renderMiddle(); return; }
    const loc = t.closest?.(".kz-locate");
    if (loc) { ui.highlight = loc.dataset.quote || null; renderShell(); const m = document.querySelector("#kz-text mark"); if (m) m.scrollIntoView({ block: "center" }); return; }
    const CANCEL = t.closest?.(".kzq-cancel");
    if (CANCEL) {
      if (ui.kzJob?.id) api.cancelKnowledgeJob(ui.kzJob.id, ui.kzJob.runId).then(() => ctx.setStatus("已请求取消：保留已出内容"))
        .catch((e) => { const h = ctx.humanError(e); ctx.setError("right", { panel: "right", message: `取消任务失败：${h.message}`, detail: h.detail, retry: null }); });
      return;
    }
    const PAUSE = t.closest?.(".kzq-pause");
    if (PAUSE) {
      if (ui.kzJob?.id) { ctx.setStatus("正在请求暂停…");
        api.pauseKnowledgeJob(ui.kzJob.id, ui.kzJob.runId).then(() => { ui.kzJob = { ...ui.kzJob, status: "paused" }; ctx.renderRight(); softStageRender(); ctx.setStatus("已请求暂停：保留已出内容"); })
          .catch((e) => { const h = ctx.humanError(e); ctx.setError("right", { panel: "right", message: `暂停任务失败：${h.message}`, detail: h.detail, retry: null }); }); }
      return;
    }
    const RESUME = t.closest?.(".kzq-resume");
    if (RESUME) {
      if (ui.kzJob?.id) { ui.kzJob = { ...ui.kzJob, status: "running" }; ctx.renderRight(); softStageRender(); ctx.setStatus("正在恢复任务…");
        api.resumeKnowledgeJob(ui.kzJob.id, ui.kzJob.runId).then(() => pollKnowledgeJob(ui.kzJob.id, ui.kzJob.runId)).then((job) => ctx.refreshAfterJob().then(() => ctx.setStatus(job.status === "done" ? job.message : "已恢复")))
          .catch((e) => { const h = ctx.humanError(e); ctx.setError("right", { panel: "right", message: `恢复任务失败：${h.message}`, detail: h.detail, retry: null }); }); }
      return;
    }
    const RETRY = t.closest?.(".kzq-retry");
    if (RETRY) {
      const idx = Number(RETRY.dataset.index);
      if (ui.kzJob?.id) { RETRY.disabled = true; api.retryKnowledgeChunk(ui.kzJob.id, idx, ui.kzJob.runId)
        .then(async (r) => { await ctx.refreshAfterJob(); ui.kzJob = { ...ui.kzJob, chunkErrors: (ui.kzJob.chunkErrors ?? []).filter((e) => e.index !== idx), created: ui.kzJob.created + (r.created ?? 0) }; ctx.renderRight(); ctx.setStatus(`第 ${idx + 1} 块已重试（新增 ${r.created} 张）`); })
        .catch((e) => { const h = ctx.humanError(e); ctx.setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); RETRY.disabled = false; }); }
      return;
    }
    const act = t.closest?.(".kz-cand, .kz-skip, .kz-excl, .kz-undo");
    if (act) {
      const cid = act.dataset.cid;
      if (act.classList.contains("kz-cand")) { kzAct(() => api.reviewCard(cid, { audit: "confirm" }), "已入候选"); return; }
      if (act.classList.contains("kz-skip")) { kzAct(() => api.reviewCard(cid, { audit: "skip" }), "已跳过（可回来）"); return; }
      if (act.classList.contains("kz-excl")) { const inp = act.closest(".kzcard")?.querySelector(".kz-exclr"); const reason = (inp?.value ?? "").trim(); kzAct(() => api.reviewCard(cid, reason ? { audit: "exclude", reason } : { audit: "exclude" }), "已排除"); return; }
      if (act.classList.contains("kz-undo")) { kzAct(() => api.reviewCard(cid, { audit: "unreviewed" }), "已撤回（回到待审）"); return; }
    }
    const skipall = t.closest?.(".kz-skipall");
    if (skipall) {
      if (!confirm("一键全部跳过：为时间紧准备，不推荐。确定跳过本页所有待审旧卡？（结构化知识壳不在跳过范围）")) return;
      const ids = kzCards(ctx.getState(), ui).filter((c) => !(c.knowledgeItemIds?.length > 0) && ["unreviewed", "need_info"].includes(c.audit)).map((c) => c.id);
      kzAct(async () => { for (const id of ids) await api.reviewCard(id, { audit: "skip" }); }, `已跳过 ${ids.length} 张`);
      return;
    }
    // ── E3 分项审阅：面板切换 / 引文定位 / 条件确认 / 分项审核 / 改值 / 旧版回查 / 结构化 / 主题 ──
    const panel = t.closest?.(".kz-panel");
    if (panel) { if (!kzDropDraft()) return; ui.kzPanel = panel.dataset.panel; ui.cardOpen = null; ui.kiView = null; renderMiddle(); return; }
    const tostruct = t.closest?.(".kz-tostruct");
    if (tostruct) { ui.kzStruct = ui.kzStruct === tostruct.dataset.cid ? null : tostruct.dataset.cid; renderMiddle(); return; }
    const qk = t.closest?.(".kzq-kitem");
    if (qk) {
      if (!kzDropDraft()) return;
      const card = ctx.getState().cards.find((c) => c.id === qk.dataset.cid);
      ui.kzPanel = "cards";
      if (card) ui.kzTab = KZ_PART(card);
      ui.cardOpen = qk.dataset.cid || null;
      ui.kiView = null;
      renderMiddle();
      const el = document.querySelector(`.kitem[data-iid="${CSS.escape(qk.dataset.iid)}"]`);
      if (el) el.scrollIntoView({ block: "center" });
      return;
    }
    const pick = t.closest?.(".kz-pick");
    if (pick) {
      kzAct(() => api.resolveKnowledgeEvidence(pick.dataset.evid, { baseRevision: Number(pick.dataset.rev), candidate: { start: Number(pick.dataset.start) }, basis: "人工在多处命中里选定这一处" }), "已按选定位置重定引文");
      return;
    }
    const resolve = t.closest?.(".kz-resolve");
    if (resolve) {
      const quote = (resolve.closest(".kzev")?.querySelector(".kz-quote")?.value ?? "").trim();
      if (!quote) { ctx.setError("mid", { panel: "mid", message: "先粘贴要定位的原句：逐字比对才有意义。", detail: "", retry: null }); return; }
      kzAct(() => api.resolveKnowledgeEvidence(resolve.dataset.evid, { baseRevision: Number(resolve.dataset.rev), quote }), "已逐字核对原文（对不上不会写成已定位）");
      return;
    }
    const follow = t.closest?.(".kef-item, .kef-cond");
    if (follow) {
      const st = ctx.getState();
      const evid = follow.dataset.evid;
      const to = Number(follow.dataset.to);
      const newRef = { kind: "evidence", id: evid, revision: to };
      const isItem = follow.classList.contains("kef-item");
      const env = isItem
        ? (st.knowledge?.items ?? []).find((e) => e.id === follow.dataset.iid)
        : (st.knowledge?.contexts ?? []).find((e) => e.id === follow.dataset.ctxid);
      if (!env) { ctx.setError("mid", { panel: "mid", message: "这条记录已不在当前数据里：请刷新后再改绑，不凭旧界面保存。", detail: "", retry: null }); return; }
      const patch = isItem
        ? { evidenceRefs: (env.payload.evidenceRefs ?? []).map((b) => ((b?.ref ?? b)?.id === evid ? (b?.ref ? { ...b, ref: newRef } : newRef) : b)) }
        : { conditions: (env.payload.conditions ?? []).map((c) => (c.id === follow.dataset.condid
          ? { id: c.id, field: c.field, value: c.value, appliesTo: c.appliesTo, obtainedBy: c.obtainedBy, evidenceRefs: (c.evidenceRefs ?? []).map((r) => (r?.id === evid ? newRef : r)) }
          : { id: c.id, field: c.field, value: c.value, appliesTo: c.appliesTo, obtainedBy: c.obtainedBy, evidenceRefs: c.evidenceRefs ?? [] })) };
      kzAct(() => (isItem
        ? api.updateKnowledgeItem(env.id, { baseRevision: Number(follow.dataset.rev), patch, reason: "引文定位后改绑当前版" })
        : api.updateKnowledgeContext(env.id, { baseRevision: Number(follow.dataset.rev), patch, reason: "引文定位后改绑当前版" })),
        `引文已改绑${fmtVersion(to)}，${isItem ? "知识项" : "该条件"}回到待审：逐字核对后再确认`);
      return;
    }
    const condOne = t.closest?.(".kc-ok");
    if (condOne) {
      const basis = kzBasis(condOne.closest(".kzctx"), ".kc-basis");
      if (!basis) return;
      kzAct(() => api.reviewKnowledgeContext(condOne.dataset.ctxid, { baseRevision: Number(condOne.dataset.rev), decision: "confirmed", basis, conditionIds: [condOne.dataset.condid] }), (r) => kzAfterNote(r, "该条件已确认"));
      return;
    }
    const condAll = t.closest?.(".kc-all");
    if (condAll) {
      const basis = kzBasis(condAll.closest(".kzctx"), ".kc-basis");
      if (!basis) return;
      kzAct(() => api.reviewKnowledgeContext(condAll.dataset.ctxid, { baseRevision: Number(condAll.dataset.rev), decision: "confirmed", basis }), (r) => kzAfterNote(r, "条件已按清单确认"));
      return;
    }
    const condSave = t.closest?.(".kcf-save");
    if (condSave) {
      const box = condSave.closest(".kzctx");
      const editRow = condSave.closest(".kzcond-edit");
      const ctxId = condSave.dataset.ctxid;
      const env = (ctx.getState().knowledge?.contexts ?? []).find((e) => e.id === ctxId);
      if (!env || !editRow) { ctx.setError("mid", { panel: "mid", message: "这条条件已不在当前数据里：请刷新后再改，不凭旧界面保存。", detail: "", retry: null }); return; }
      const target = editRow.dataset.condid;
      const conditions = (env.payload.conditions ?? []).map((c) => {
        const row = c.id === target ? editRow : null;
        const fieldText = row ? (row.querySelector(".kcf-field")?.value ?? "").trim() : "";
        const value = row ? (kzValueFrom(row.querySelector(".kcf-raw")?.value, row.querySelector(".kcf-num")?.value, row.querySelector(".kcf-unit")?.value) ?? c.value) : c.value;
        return { id: c.id, field: fieldText ? { raw: fieldText } : c.field, value, appliesTo: c.appliesTo, evidenceRefs: c.evidenceRefs ?? [], obtainedBy: c.obtainedBy };
      });
      kzAct(() => api.updateKnowledgeContext(ctxId, { baseRevision: Number(condSave.dataset.rev), patch: { conditions }, reason: "人工核对后修订" }),
        (r) => `${r.affectedItems?.length ? `条件已改：${r.affectedItems.length} 个引用它的知识项回待审` : "条件已改（改动的条件回待审）"}`);
      return;
    }
    const iact = t.closest?.(".ki-ok, .ki-info, .ki-out");
    if (iact) {
      const box = iact.closest(".kitem");
      const basis = kzBasis(box, ".ki-basis");
      if (!basis) return;
      const decision = iact.classList.contains("ki-ok") ? "confirmed" : iact.classList.contains("ki-info") ? "needs_info" : "excluded";
      kzAct(async () => { const r = await api.reviewKnowledgeItem(iact.dataset.iid, { baseRevision: Number(iact.dataset.rev), decision, basis }); ui.kiView = null; if (decision === "confirmed") sproutEvent("stamped", `in:${iact.dataset.iid}:${r.revision}`); return r; },
        (r) => `${decision === "confirmed" ? "已确认" : decision === "needs_info" ? "已标待补" : "已排除"}（${fmtVersion(r.revision)}）${r.cardAudit ? ` · 整卡状态：${fmtEnum(r.cardAudit)}` : ""}`);
      return;
    }
    const save = t.closest?.(".ki-save");
    if (save) {
      const box = save.closest(".kitem");
      const patch = {};
      const value = kzValueFrom(box?.querySelector(".ki-raw")?.value, box?.querySelector(".ki-num")?.value, box?.querySelector(".ki-unit")?.value);
      if (value) patch.value = value;
      const scopeText = (box?.querySelector(".ki-scope")?.value ?? "").trim();
      if (scopeText) patch.scopeText = scopeText;
      if (!Object.keys(patch).length) { ctx.setStatus("没有需要保存的更改。"); return; }
      kzAct(async () => { await api.updateKnowledgeItem(save.dataset.iid, { baseRevision: Number(save.dataset.rev), patch, reason: "人工核对后修订" }); ui.kiView = null; }, "已存为新版（科学内容改动回到待审）");
      return;
    }
    const back = t.closest?.(".ki-back");
    if (back) { if (!kzDropDraft()) return; ui.kiView = null; renderMiddle(); return; }
    const go = t.closest?.(".ks-go");
    if (go) {
      const box = go.closest(".kzstruct");
      const quote = (box?.querySelector(".ks-quote")?.value ?? "").trim();
      const text = (box?.querySelector(".ks-text")?.value ?? "").trim();
      if (!quote || !text) { ctx.setError("mid", { panel: "mid", message: "结构化要同时给出逐字引文和知识项文本：缺一项就不生成。", detail: "", retry: null }); return; }
      const cond = (box?.querySelector(".ks-cond")?.value ?? "").trim();
      const value = kzValueFrom(box?.querySelector(".ks-raw")?.value, box?.querySelector(".ks-num")?.value, box?.querySelector(".ks-unit")?.value);
      const topicIds = ui.topicId ? [ui.topicId] : undefined;
      const condParts = kzCondSplit(cond);
      const condValue = kzValueFrom(condParts.rhs, "", "") ?? { kind: "category", raw: condParts.rhs, label: condParts.rhs };
      const srcCard = ctx.getState().cards.find((c) => c.id === go.dataset.cid);
      const anchorAsset = box?.querySelector(".ks-src")?.value === "asset" && srcCard?.assetId;
      const sourceRef = anchorAsset ? { kind: "asset", id: srcCard.assetId } : undefined;
      kzAct(async () => {
        await api.structureCard(go.dataset.cid, {
          baseRevision: Number(go.dataset.rev),
          evidence: [{ localId: "e1", ...(sourceRef ? { sourceRef } : {}), quote }],
          contexts: cond ? [{ localId: "c1", subject: text.slice(0, 60), ...(topicIds ? { topicIds } : {}), conditions: [{ id: "kcn_1", field: { raw: condParts.name.slice(0, 60) }, value: condValue, appliesTo: { subject: "本项判断", stage: "本次实验" }, obtainedBy: "human_record" }] }] : [],
          items: [{ localId: "i1", contentType: "claim", nature: "observation", text, ...(value ? { value } : {}), evidenceRefs: [{ localId: "e1" }], ...(cond ? { contextRefs: [{ kind: "context", localId: "c1" }] } : {}), ...(topicIds ? { topicIds } : {}) }],
        });
        ui.kzStruct = null;
        ui.cardOpen = go.dataset.cid;
        ui.kzTab = "todo";
      }, "已结构化这一张卡：引文／条件／知识项全部待审");
      return;
    }
    const tsave = t.closest?.(".kt-save");
    if (tsave) {
      const row = tsave.closest(".ktheme");
      const members = kzRefsFrom(row?.querySelectorAll(".kt-m") ?? [], "item");
      if (!members.length) { ctx.setError("mid", { panel: "mid", message: "主题至少要有一个成员：勾选要归入的知识项。", detail: "", retry: null }); return; }
      const judgments = kzRefsFrom(row?.querySelectorAll(".kt-j") ?? [], "item");
      const name = (row?.querySelector(".kt-name")?.value ?? "").trim();
      const definition = (row?.querySelector(".kt-def")?.value ?? "").trim();
      const patch = { members, currentJudgmentRefs: judgments, ...(name ? { name } : {}), ...(definition ? { definition } : {}) };
      kzAct(() => kzThemeCommit((allow) => api.updateTheme(tsave.dataset.tid, { baseRevision: Number(tsave.dataset.rev), patch, allowCrossTopic: allow })),
        (r) => `主题已更新：成员 ${r?.members ?? members.length} 项 · 当前认识 ${r?.currentJudgmentRefs ?? judgments.length} 项`);
      return;
    }
    const kgo = t.closest?.(".kn-go");
    if (kgo) {
      const box = kgo.closest(".ktnew");
      const name = (box?.querySelector(".kn-name")?.value ?? "").trim();
      const members = kzRefsFrom(box?.querySelectorAll(".kn-m") ?? [], "item");
      if (!name || !members.length) { ctx.setError("mid", { panel: "mid", message: "新主题要有名称和至少一个成员。", detail: "", retry: null }); return; }
      const judgments = kzRefsFrom(box?.querySelectorAll(".kn-j") ?? [], "item");
      const definition = (box?.querySelector(".kn-def")?.value ?? "").trim();
      kzAct(() => kzThemeCommit((allowCrossTopic) => api.createTheme({ topicId: ui.topicId, name, ...(definition ? { definition } : {}), members, currentJudgmentRefs: judgments, allowCrossTopic }), { name, definition, members, currentJudgmentRefs: judgments }), "主题已创建");
      return;
    }
  });
  document.addEventListener("change", async (ev) => {
    const { ui } = ctx;
    if (ev.target.id === "kz-paper") {
      if (!kzDropDraft()) { ctx.renderMiddle(); return; }
      ui.paperId = ev.target.value; ui.assetId = null; ui.cardOpen = null; ui.highlight = null; ui.kzJob = null; ui.kiView = null; ui.kzStruct = null; ctx.clearAllErrors(); ctx.renderAll(); return;
    }
    if (ev.target.classList.contains("kz-imp")) { const cid = ev.target.dataset.cid; kzAct(() => ctx.api.reviewCard(cid, { importance: ev.target.value || null }), "重要程度已记"); return; }
    if (ev.target.classList.contains("ki-old")) {
      const box = ev.target.closest(".kitem");
      const iid = box?.dataset.iid;
      const rev = Number(ev.target.value);
      if (!iid) return;
      if (!rev) { ui.kiView = null; ctx.renderMiddle(); return; }
      try {
        const r = await ctx.api.knowledgeItem(iid, rev, ctx.ui.topicId || undefined);
        ui.kiView = { id: iid, revision: r.revision, payload: r.payload };
        ctx.renderMiddle();
        ctx.setStatus(`正在回查${fmtVersion(r.revision)}（只读，不可直接审核）`);
      } catch (e) { const h = ctx.humanError(e); ctx.setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); }
      return;
    }
    if (ev.target.classList.contains("kt-m") || ev.target.classList.contains("kt-j") || ev.target.classList.contains("kn-m") || ev.target.classList.contains("kn-j")) {
      ev.target.closest("label")?.classList.toggle("on", ev.target.checked);
    }
  });
  document.addEventListener("focusout", (ev) => {
    if (ev.target.classList.contains("kz-note")) {
      const cid = ev.target.dataset.cid; const val = ev.target.value;
      if (ctx.ui.kzNoteDraft) delete ctx.ui.kzNoteDraft[cid];
      kzAct(() => ctx.api.reviewCard(cid, { note: val }), "备注已记");
    }
  });
  // E3：审阅草稿（依据/值/主题/备注）只存在于页面上，标记为未保存，避免刷新或后台任务把它冲掉。
  document.addEventListener("input", (ev) => {
    if (ev.target.classList?.contains("kz-note")) { (ctx.ui.kzNoteDraft ??= {})[ev.target.dataset.cid] = ev.target.value; ctx.setDirty(true); return; }
    if (ev.target.matches?.(KZ_DRAFT)) ctx.setDirty(true);
  });
}
