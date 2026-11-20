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
