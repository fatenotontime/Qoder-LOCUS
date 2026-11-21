/**
 * 集中格式化词表（前端唯一来源）：时间、英文枚举、版本、重复名。
 * 纯函数、无 DOM —— 供 app.js 与 node:test 共用（自动检查据此断言渲染文本）。
 */

/** 本地短时间：11-18 12:35；空值给空串，避免出现 ISO。 */
export function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace("T", " ").slice(0, 16);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 英文枚举 → 中文（集中管理，界面不得直接出现英文枚举）。 */
export const ENUM = {
  // 子问题
  declared: "已定", exploratory: "探索中",
  // 核对/候选
  unreviewed: "待审", need_info: "待补", confirm: "已确认", exclude: "已排除", skip: "已跳过",
  // 抽取来源
  manual: "人工", ai: "模型", draft: "草稿", "ai-draft": "模型草稿", reconstructed: "重构",
  user: "自建", public: "公开",
  // 执行
  active: "进行中", paused: "已暂停", done: "已结束",
  preparing: "准备中", recording: "记录中",
  // 附件角色
  fulltext: "正文", supplement: "补充材料", other: "其他",
  // 卡类型
  data: "数据", argument: "论证", method: "方法", idea: "思路",
  // 重要程度
  high: "高", medium: "中", low: "低",
  // 结果采信
  author: "作者", reproduced: "复现", external: "外部",
  // 影响类别（experiment.ts CATEGORIES）
  timing: "时序", execution: "执行", comparability: "可比性", analysis: "分析", interpretation: "解释",
  // 评估结论
  impact: "有影响", no_supported_impact_found: "未发现支持的影响", needs_review: "需人工复核",
  // 影响建议落点
  "execution-note": "执行备注", "report-toVerify": "报告待验证",
  // ── 知识分项（合同 §4.3：审核状态 / 性质 / 内容类型 / 值形态 / 定位 / 条件来源 / 未知原因 / 来源类别）──
  pending: "待审", confirmed: "已确认", excluded: "已排除", withdrawn: "已撤回", needs_info: "待补",
  observation: "观察", hypothesis: "假设", interpretation: "解释", to_verify: "待验证", human_judgment: "人工判断",
  definition: "定义", claim: "论断", limitation: "局限", question: "问题",
  scalar: "单值", bound: "界限", range: "区间", category: "类别", summary: "概述", missing: "缺失",
  gt: "大于", gte: "不小于", lt: "小于", lte: "不大于",
  SD: "标准差", SE: "标准误", CI: "置信区间",
  matched: "已定位", ambiguous: "多处命中", unmatched: "未定位", source_unreadable: "原件不可读", source_missing: "来源不可读",
  source_explicit: "原文明说", human_record: "人工记录", human_assumption: "人工假设",
  not_in_selected_material: "不在所选材料内", unprocessed_source: "来源未处理",
  not_reported_in_checked_scope: "核对范围内未报告", ambiguous: "有歧义（多处命中）", conflicting: "互相矛盾",
  not_measured: "未测量", below_detection_limit: "低于检出限",
  unparsed_numeric: "数字未解析", unresolved_link: "表号/小节未定位",
  literature_report: "文献报告", literature_reconstructed_data: "文献重构数据",
  local_observation: "本地观察", historical_reconstruction: "历史重建",
  local_measurement: "本地测量", human_statement: "人工陈述", model_suggestion: "模型建议",
};
export function fmtEnum(k) { return ENUM[k] ?? k ?? ""; }

/** 对象类型 → 中文（回查分组标题、快照碎片、影响落点；与后端 KIND_CN 同构）。 */
export const KIND_LABEL = {
  topic: "课题", subquestion: "子问题", paper: "论文", attachment: "附件", asset: "原件", card: "知识卡",
  protocol: "方案", template: "记录模板", execution: "执行", sample: "样品", measurement: "测量", table: "数据表",
  task: "分析任务", result: "分析结果", report: "分析初稿", block: "报告块", chat: "对话",
  execution_step: "执行步骤", "execution-note": "执行备注", "report-toVerify": "报告待验证",
};
export function fmtKind(k) { return KIND_LABEL[k] ?? ENUM[k] ?? k ?? ""; }

/** 版本号：一律「第N版」。 */
export function fmtVersion(n) { return `第${n}版`; }

/**
 * 名称去重：主名与编号相同时只显一次。
 * 例：short="SEA-94", display="SEA-94" → "SEA-94"；display="种子组", short="SEA-94" → "种子组（SEA-94）"。
 */
export function fmtNameOnce(display, short) {
  const d = (display ?? "").trim(), s = (short ?? "").trim();
  if (!d) return s;
  if (!s || d === s || d.includes(s)) return d;
  return `${d}（${s}）`;
}

/** 从 ISO 时间串取日期部分（用于列表摘要），本地短格式。 */
export function fmtDay(iso) { return fmtTime(iso).slice(0, 5); }

// ── 知识分项呈现（合同 §4.3：值形态、未知原因；缺什么显式说什么，不做默认值兜底）──

/** 值 → 中文短语：单值/界限/区间/类别/概述/缺失；单位缺失显式写「未记单位」。 */
export function fmtValue(v) {
  if (!v || typeof v !== "object") return "未填值";
  const hasUnit = v.kind === "scalar" || v.kind === "bound" || v.kind === "range" || v.kind === "summary";
  const u = !hasUnit ? "" : v.unit === "1" ? "（无量纲）" : v.unit ? ` ${v.unit}` : "（未记单位）";
  switch (v.kind) {
    case "scalar": return v.value === null || v.value === undefined ? `${v.raw ?? "—"}${u}` : `${v.value}${u}`;
    case "bound": return `${fmtEnum(v.operator ?? "")} ${v.value ?? v.raw ?? "—"}${u}`;
    case "range": return `介于 ${v.lower ?? "—"}–${v.upper ?? "—"}${u}`;
    case "category": return `${v.label ?? v.raw ?? "—"}`;
    case "summary": {
      const stat = v.statistic ? `${fmtEnum(v.statistic)} ` : "";
      const n = v.sampleSize ? ` · n=${v.sampleSize}` : "";
      return `${stat}${v.value ?? v.raw ?? "—"}${u}${n}`.trim();
    }
    case "missing": return `缺失（${fmtReasonCode(v.reasonCode)}）`;
    default: return `未知形态（${fmtEnum(v.kind ?? "")}）`;
  }
}

/** 不确定度：只写模型给出的类型与数值，不自称置信水平。 */
export function fmtUncertain(v) {
  const u = v?.uncertainty;
  if (!u) return "";
  return `${fmtEnum(u.type ?? "不确定度")} ${u.value ?? "—"}`;
}

export function fmtReasonCode(code) { return ENUM[code] ?? (code ? "其他（未登记原因，需修复数据）" : "其他"); }

/** 未知项：原因码 + 说明（合同要求「缺什么、为什么缺」都可见；Unknown.detail 为正式字段）。 */
export function fmtUnknowns(list) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return "";
  return arr.map((u) => {
    const detail = u?.detail ?? u?.note;
    return `？${fmtReasonCode(u?.reasonCode)}${detail ? `：${detail}` : ""}`;
  }).join("　");
}

/** 审核状态短语（分项/条件通用）。 */
export function fmtReview(status) { return fmtEnum(status ?? "pending"); }

