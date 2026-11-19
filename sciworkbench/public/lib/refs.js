/**
 * 分析与对话共用：对象引用读取与展示（纯函数，无 DOM）。
 * 供 app.js（对话页）与 lib/pages/analysis.js（分析页）导入，避免复制两份。
 */
import { fmtTime, fmtKind } from "./format.js";

/** 把任意字符串里的 ISO 时间替换成本地短格式（用于服务端生成的摘要文本）。 */
export const deIso = (s) => String(s ?? "").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (m) => fmtTime(m));

/** 服务端摘要文本里可能夹带的英文枚举/裸版本 → 中文（仅用于展示）。 */
export const humanVer = (s) => String(s ?? "")
  .replace(/rev (\d+)/g, "第$1版")
  .replace(/\br(\d+)\b/g, "第$1版")
  .replace(/ai-draft/g, "模型草稿").replace(/reconstructed/g, "重构")
  .replace(/unreviewed/g, "待审").replace(/need_info/g, "待补")
  .replace(/exploratory/g, "探索中").replace(/declared/g, "已定")
  .replace(/confirm/g, "已确认").replace(/exclude/g, "已排除").replace(/\bskip\b/g, "已跳过");

/** 历史文献重构对象 → 展示后缀（非本地实测，全链路明示）。 */
export function reconTag(state, kind, id) {
  if (kind === "execution") return state.executions.find((x) => x.id === id)?.origin === "reconstructed" ? "（文献重构）" : "";
  if (kind === "protocol") return state.protocols.find((x) => x.id === id)?.sourceKind === "reconstructed" ? "（文献重构）" : "";
  if (kind === "table") return state.tables.find((x) => x.id === id)?.origin === "reconstructed" ? "（文献重构）" : "";
  if (kind === "measurement") {
    const m = state.measurements.find((x) => x.id === id);
    const o = m?.origin ?? state.samples.find((s) => s.id === m?.sampleId)?.origin;
    return o === "reconstructed" ? "（文献重构）" : "";
  }
  if (kind === "sample") return state.samples.find((x) => x.id === id)?.origin === "reconstructed" ? "（文献重构）" : "";
  if (kind === "result") {
    // 结果沿任务核心/已选候选继承来源性质（与后端 refOrigin 一致）。
    const res = state.analysisResults.find((x) => x.id === id);
    const task = res && state.analysisTasks.find((t) => t.id === res.taskId);
    const refs = task ? [...task.core, ...task.optional.filter((o) => o.included).map((o) => o.ref)] : [];
    if (refs.some((r) => reconTag(state, r.kind, r.id))) return "（文献重构）";
  }
  return "";
}

/** 引用对象在库中找不到 → 缺口标记（与后端缺件节点一致；note/snapshot 非证据对象，不标缺）。 */
export function missingTag(state, kind, id) {
  if (kind === "measurement") return (state.measurements.some((x) => x.id === id) || state.assets.some((x) => x.id === id)) ? "" : "（缺失）";
  const coll = {
    execution: state.executions, protocol: state.protocols, table: state.tables, card: state.cards,
    asset: state.assets, subquestion: state.subquestions, result: state.analysisResults, report: state.reports, sample: state.samples,
  }[kind];
  if (!coll) return "";
  return coll.some((x) => x.id === id) ? "" : "（缺失）";
}

/** 对象引用 → 人话标签。 */
export function refLabel(state, ref) {
  let label;
  switch (ref.kind) {
    case "execution": { const e = state.executions.find((x) => x.id === ref.id); const p = e && state.protocols.find((x) => x.id === e.protocolId); label = `执行 · ${p?.name ?? ref.id}${reconTag(state, "execution", ref.id)}`; break; }
    case "protocol": label = `方案 · ${state.protocols.find((x) => x.id === ref.id)?.name ?? ref.id}${reconTag(state, "protocol", ref.id)}`; break;
    case "measurement": {
      const mr = state.measurements.find((x) => x.id === ref.id);
      if (mr) { const s = state.samples.find((x) => x.id === mr.sampleId); label = `测量 · ${s?.shortName ?? ""} ${mr.value}${mr.unit}${reconTag(state, "measurement", ref.id)}`; }
      else label = `测量原件 · ${state.assets.find((x) => x.id === ref.id)?.name ?? ref.id}`;
      break;
    }
    case "table": label = `数据表 · ${state.tables.find((x) => x.id === ref.id)?.name ?? ref.id}${reconTag(state, "table", ref.id)}`; break;
    case "card": { const c = state.cards.find((x) => x.id === ref.id); label = `知识卡 · ${c?.scope || Object.values(c?.extracted?.fields ?? {})[0] || ref.id}`; break; }
    case "asset": label = `原件 · ${state.assets.find((x) => x.id === ref.id)?.name ?? ref.id}`; break;
    case "subquestion": label = `子问题 · ${state.subquestions.find((x) => x.id === ref.id)?.question ?? ref.id}`; break;
    default: label = `${fmtKind(ref.kind)}:${ref.id}`;
  }
  return label + missingTag(state, ref.kind, ref.id);
}

/** 当前课题下可被分析/对话引用的对象集合。 */
export function topicObjects(state, ui) {
  const tid = ui.topicId;
  const execs = state.executions.filter((e) => !tid || e.topicId === tid);
  const tables = state.tables.filter((t) => { const a = state.assets.find((x) => x.id === t.assetId); return !tid || !a?.topicId || a.topicId === tid; });
  const meas = state.measurements.filter((m) => !tid || m.topicId === tid);
  const protos = state.protocols.filter((p) => !tid || p.topicId === tid);
  const cards = state.cards.filter((c) => { const p = state.papers.find((x) => x.id === c.paperId); return c.audit === "confirm" && (!tid || !p || !p.topicIds.length || p.topicIds.includes(tid)); });
  return { execs, tables, meas, protos, cards };
}
