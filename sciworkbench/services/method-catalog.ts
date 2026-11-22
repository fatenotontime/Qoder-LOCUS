/**
 * M 方法评测路（先行）· M3：方法与前提目录。
 *
 * 交付：五类本地方法目录（描述统计 / 时间·参数趋势图 / 线性拟合·校准 / 独立两组比较 /
 *       配对前后比较）＋「方法前提」的**确定性判断**（ready / needs_info / not_applicable）
 *       ＋可序列化的评测快照（含目录版本/hash、收到的事实与确认状态、问题与判断）。
 *
 * 边界（与 M_METHOD_EVAL_LANE_EXECUTION_PROMPT 一致）：
 *  - 纯函数、零 npm 依赖（仅 node 内置 crypto 用于 hash）。
 *  - 不写 AnalysisTaskRecord、不确认知识、不调用模型、不改既有 reproducible 含义。
 *  - 这是**可审阅的操作内容**，不是自动执行器：工具函数名/参数/示例须可核实，未实跑者如实标注。
 *  - 窄输入：只吃本模块定义的方法事实；不扫原文件、不重复解析、不把前 30 行摘录当事实来源。
 */
import { createHash } from "node:crypto";

// ── 方法标识 ────────────────────────────────────────────────

export type MethodId =
  | "descriptive_stats"
  | "trend_plot"
  | "linear_fit"
  | "independent_two_group"
  | "paired_pre_post";

export const METHOD_IDS: readonly MethodId[] = [
  "descriptive_stats",
  "trend_plot",
  "linear_fit",
  "independent_two_group",
  "paired_pre_post",
];

// ── 方法事实（窄输入）────────────────────────────────────────
// 每项带 unknown / inferred / confirmed 三态；inferred 是机器推断，不自动视为人工确认。

export type FactStatus = "unknown" | "inferred" | "confirmed";

export interface Fact {
  /** 已确认或推断的事实值；unknown 时为 null。 */
  readonly value: string | null;
  readonly status: FactStatus;
  /** 事实来源位置（可选，便于复查）。 */
  readonly source?: string;
}

/** 明确已由人确认的事实。 */
export const confirmed = (value: string, source?: string): Fact => ({ value, status: "confirmed", source });
/** 机器推断，尚待人工确认。 */
export const inferred = (value: string, source?: string): Fact => ({ value, status: "inferred", source });
/** 未知。 */
export const unknownFact = (): Fact => ({ value: null, status: "unknown" });

export type FactKey =
  | "purpose"
  | "columns"
  | "columnTypes"
  | "units"
  | "validCounts"
  | "groups"
  | "independence"
  | "pairing"
  | "pairingKey"
  | "batch"
  | "errorMeaning"
  | "xAxis"
  | "yAxis"
  | "order"
  | "xValues"
  | "fitRange"
  | "calibrationUse"
  | "distribution";

/** 缺失的键视为 unknown；不按位置猜值。 */
export type MethodFacts = Partial<Record<FactKey, Fact>>;

/** 约定的判定取值（保证判断可复现、可测）。 */
export const FACT_VALUES = {
  independence: { independent: "independent", dependent: "dependent" },
  pairing: { paired: "paired", unpaired: "unpaired" },
  xValues: { varies: "varies", constant: "constant" },
  xAxis: { ordered: "ordered", unordered: "unordered" },
} as const;

// ── 目录条目结构 ────────────────────────────────────────────

export interface Precondition {
  readonly key: FactKey;
  readonly label: string;
  /** 缺信息（或推断未确认）时抛给用户的具体问题。 */
  readonly question: string;
}

export interface ToolOp {
  readonly tool: string;
  readonly functions: readonly string[];
  readonly note?: string;
}

export interface CatalogEntry {
  readonly id: MethodId;
  readonly version: string;
  readonly title: string;
  readonly appliesTo: string;
  readonly inputRequirements: readonly string[];
  /** 关键前提：须**已确认**才给出可执行的完整操作。 */
  readonly required: readonly Precondition[];
  /** 触发 not_applicable 的判定项。 */
  readonly reject?: readonly { readonly key: FactKey; readonly whenValue: string; readonly reason: string }[];
  readonly toolPath: readonly ToolOp[];
  readonly steps: readonly string[];
  readonly paramsToFill: readonly string[];
  readonly artifacts: readonly string[];
  readonly acceptance: readonly string[];
  readonly misuse: readonly string[];
  readonly example: { readonly description: string; readonly datasetRef?: string };
  readonly toolVersion: string;
  readonly runtimeStatus: "verified" | "unverified";
}

/** 冒烟测试所用隔离环境（合成数据实跑，未改全局环境）。 */
export const TOOL_ENV = {
  python: "3.13.7",
  pandas: "2.3.2",
  numpy: "2.3.4",
  scipy: "1.16.3",
  matplotlib: "3.10.7",
} as const;

const V = `pandas ${TOOL_ENV.pandas} / numpy ${TOOL_ENV.numpy}`;
const VS = `scipy ${TOOL_ENV.scipy} / numpy ${TOOL_ENV.numpy}`;
const VM = `matplotlib ${TOOL_ENV.matplotlib} / numpy ${TOOL_ENV.numpy}`;

// ── 五类目录（固定，不扩成学科百科）─────────────────────────

function buildCatalog(): Record<MethodId, CatalogEntry> {
  return {
    descriptive_stats: {
      id: "descriptive_stats",
      version: "1",
      title: "描述统计",
      appliesTo: "了解已知数值列的分布与缺失",
      inputRequirements: ["一个或多个已知数值列", "测量含义与单位状态", "有效值定义与缺失规则"],
      required: [
        { key: "purpose", label: "研究目的", question: "这次描述统计是回答什么问题？" },
        { key: "columns", label: "选定的数值列", question: "要对哪几列做描述？" },
        { key: "units", label: "单位状态", question: "各列的单位是否已知？未知请标出，不要臆造单位。" },
        { key: "validCounts", label: "有效计数与缺失规则", question: "缺失如何标记、有效值如何判定？" },
      ],
      toolPath: [
        {
          tool: "pandas",
          functions: ["pandas.read_csv(path)", "series.count()", "series.isna().sum()", "series.describe()", "series.std(ddof=1)"],
          note: "describe() 的 std 与 std() 默认 ddof=1（样本标准差）；numpy.std 默认 ddof=0（总体）。SE≠SD，未声明不要混用。",
        },
      ],
      steps: [
        "读取数据：df = pandas.read_csv(path)",
        "按已确认选列取子集：cols = [...]",
        "逐列有效计数 n = df[c].count()；缺失 n_miss = df[c].isna().sum()",
        "逐列汇总 df[c].describe()（count/mean/std/min/25%/50%/75%/max）",
        "在报告中标明 std 的 ddof；未确认分组时只给整体描述",
      ],
      paramsToFill: ["输入数据文件路径", "选列清单", "缺失标记规则", "std 的 ddof 取值"],
      artifacts: ["逐列统计表（列名、n、缺失数、均值、中位数、标准差(ddof)、最小值、最大值）"],
      acceptance: ["每列 n 等于该列非缺失值个数", "std 的 ddof 已声明", "未确认分组时报告中不出现分组结论"],
      misuse: ["把 std 当作 SE", "对未处理缺失的列直接汇总", "分组未知却给出分组结论"],
      example: { description: "对合成 sample_basic.csv 的 value 列做整体描述", datasetRef: "fixtures/m-method/data/sample_basic.csv" },
      toolVersion: V,
      runtimeStatus: "verified",
    },

    trend_plot: {
      id: "trend_plot",
      version: "1",
      title: "时间 / 参数趋势图",
      appliesTo: "查看响应随已知横轴的变化",
      inputRequirements: ["已知横轴列与纵轴列", "两轴的含义与单位", "顺序（是否按横轴排序）", "分组/重复测量信息"],
      required: [
        { key: "purpose", label: "研究目的", question: "这张图要看什么趋势？" },
        { key: "xAxis", label: "横轴含义与单位", question: "横轴代表什么量、单位是什么？" },
        { key: "yAxis", label: "纵轴含义与单位", question: "纵轴代表什么量、单位是什么？" },
        { key: "units", label: "单位状态", question: "两轴的单位是否已知？" },
        { key: "order", label: "顺序", question: "是否按横轴升序排列后再连线？" },
        { key: "groups", label: "分组/序列", question: "不同样品或序列如何分组？分组未知时不能连线（应先确认分组或改描述统计）。" },
      ],
      reject: [
        { key: "xAxis", whenValue: FACT_VALUES.xAxis.unordered, reason: "横轴为无序分类，连线会制造并不存在的趋势；应改用描述统计或分类比较" },
      ],
      toolPath: [
        {
          tool: "matplotlib",
          functions: ["matplotlib.pyplot.subplots()", "numpy.argsort(x)", "axes.plot(x_sorted, y_sorted, marker='o')", "axes.scatter(x, y)", "axes.set_xlabel(...)", "axes.set_ylabel(...)", "figure.savefig(out)"],
          note: "先按已确认分组与轴处理；保留行→点映射；不同样品/不同序列不得无条件连成一条轨迹。",
        },
      ],
      steps: [
        "读取数据并确认横纵轴列、单位与分组列",
        "按横轴升序排序：idx = numpy.argsort(x)；保留原始行号映射",
        "每组各画一条线 ax.plot（分组已确认）；分组未知则不得连线",
        "设置轴标签与单位 ax.set_xlabel/set_ylabel",
        "保存图 figure.savefig(out) 并导出行→点映射表",
      ],
      paramsToFill: ["输入数据文件路径", "横轴列", "纵轴列", "分组列（可选）", "排序方向"],
      artifacts: ["趋势图（PNG）", "行→点映射表（原始行号、x、y、分组）"],
      acceptance: ["每个已确认分组各一条线", "横轴按声明排序", "行→点映射可复查", "未确认分组时不合并不同序列"],
      misuse: ["不排序直接连线", "把不同样品连成一条时间轨迹", "忽略单位或轴含义"],
      example: { description: "对合成 sample_trend.csv 按 group 分组画 time→readout 趋势", datasetRef: "fixtures/m-method/data/sample_trend.csv" },
      toolVersion: VM,
      runtimeStatus: "verified",
    },

    linear_fit: {
      id: "linear_fit",
      version: "1",
      title: "线性拟合 / 校准",
      appliesTo: "在声明范围内拟合 x 与 y",
      inputRequirements: ["数值 x、y 列", "单位", "x 是否变化", "拟合范围", "观测独立性", "校准用途（若为校准）"],
      required: [
        { key: "purpose", label: "研究目的", question: "拟合/校准的目的是什么？" },
        { key: "columns", label: "x、y 列", question: "哪列是 x、哪列是 y？" },
        { key: "units", label: "单位", question: "x、y 的单位是什么？" },
        { key: "xValues", label: "x 是否变化", question: "x 在观测中是否变化？（常量 x 无法拟合）" },
        { key: "fitRange", label: "拟合范围", question: "拟合并解释的范围是什么？不要外推。" },
        { key: "independence", label: "观测独立性", question: "各观测是否相互独立？（重复测量会改变误差结构）" },
        { key: "calibrationUse", label: "校准方向/用途", question: "是否为校准？校准方向（x→y 还是 y→x）与用途是什么？未知不得外推。" },
        { key: "errorMeaning", label: "误差含义", question: "报告的误差指什么（斜率 SE / 预测 SE / 残差 SD）？" },
      ],
      reject: [
        { key: "xValues", whenValue: FACT_VALUES.xValues.constant, reason: "x 无变化，无法估计斜率；请改换自变量或说明" },
      ],
      toolPath: [
        {
          tool: "scipy + matplotlib",
          functions: ["scipy.stats.linregress(x, y)", "resid = y - (slope*x + intercept)", "matplotlib.pyplot.subplots()", "axes.scatter(x, resid)", "axes.axhline(0)"],
          note: "linregress 返回 slope/intercept/rvalue/pvalue/stderr（斜率的 SE，非预测 SE）。输出参数而非因果结论；校准方向或误差含义未知先问，不外推。",
        },
      ],
      steps: [
        "确认 x、y 为数值列、单位、x 变化、拟合范围与独立性",
        "在声明范围内取子集（不要用范围外点）",
        "拟合：res = scipy.stats.linregress(x, y)",
        "计算残差 resid = y - (res.slope*x + res.intercept) 并画残差图",
        "报告 slope/intercept/rvalue/pvalue/stderr，并声明拟合范围",
      ],
      paramsToFill: ["输入数据文件路径", "x 列", "y 列", "拟合范围（x 上下限）", "是否为校准及其方向"],
      artifacts: ["拟合参数表（slope/intercept/rvalue/pvalue/stderr）", "拟合线图", "残差图"],
      acceptance: ["拟合范围已声明且未外推", "报告的是参数与残差，不含因果断言", "x 非常量", "校准用途/误差含义已确认或明确标未知"],
      misuse: ["超范围外推", "把相关系数当因果", "x 为常量仍强行拟合", "把斜率 SE 当预测 SE"],
      example: { description: "对合成 sample_fit.csv 在 [0,10] 范围内做 y~x 线性拟合", datasetRef: "fixtures/m-method/data/sample_fit.csv" },
      toolVersion: VS,
      runtimeStatus: "verified",
    },

    independent_two_group: {
      id: "independent_two_group",
      version: "1",
      title: "独立两组比较",
      appliesTo: "比较两组独立观测",
      inputRequirements: ["两组定义", "响应变量", "实验单位", "独立性", "重复/批次信息"],
      required: [
        { key: "purpose", label: "研究目的", question: "要比较两组的什么响应？" },
        { key: "groups", label: "两组定义", question: "哪两组？各自的纳入条件是什么？" },
        { key: "columns", label: "响应变量列", question: "响应变量是哪一列？" },
        { key: "independence", label: "独立性", question: "两组观测是否相互独立？（技术重复不能当独立 n）" },
        { key: "batch", label: "重复/批次", question: "是否存在批次或重复结构？实验单位是什么？" },
        { key: "distribution", label: "分布/样本条件", question: "响应分布与每组样本量是否满足检验前提（偏态/离群/极小样本需说明）？" },
      ],
      reject: [
        { key: "independence", whenValue: FACT_VALUES.independence.dependent, reason: "两组非独立（存在配对或重复结构），应改用配对前后比较" },
      ],
      toolPath: [
        {
          tool: "scipy.stats",
          functions: ["scipy.stats.ttest_ind(a, b, equal_var=False)"],
          note: "equal_var=False 即 Welch 检验，放宽方差齐性但**仍要求独立性**；不以「Welch」名义忽略独立性与分布/样本条件。",
        },
      ],
      steps: [
        "确认两组定义、响应变量、实验单位与独立性",
        "按组取出响应向量 a、b（a、b 为独立观测）",
        "Welch 检验：res = scipy.stats.ttest_ind(a, b, equal_var=False)",
        "报告各组 n、均值、标准差与检验统计量/p 值",
      ],
      paramsToFill: ["输入数据文件路径", "分组列", "响应变量列", "参与比较的两个组名"],
      artifacts: ["Welch t 检验结果（statistic、pvalue）", "各组 n/均值/标准差"],
      acceptance: ["确认两组独立；技术重复未计入独立 n", "每组样本量与统计量一并报告", "分布/样本条件不适时不宣称结论"],
      misuse: ["把技术重复当独立 n", "存在配对结构仍用独立两组检验", "忽略分布/样本量条件"],
      example: { description: "对合成 sample_groups.csv 比较 control 与 treated 两组", datasetRef: "fixtures/m-method/data/sample_groups.csv" },
      toolVersion: VS,
      runtimeStatus: "verified",
    },

    paired_pre_post: {
      id: "paired_pre_post",
      version: "1",
      title: "配对前后比较",
      appliesTo: "比较同一实验单位的两次观测",
      inputRequirements: ["配对标识", "前后（pre/post）定义", "重复 ID / 缺对处理", "差值尺度", "差值分布前提"],
      required: [
        { key: "purpose", label: "研究目的", question: "要比较同一单位的哪两次观测？" },
        { key: "pairing", label: "配对标识", question: "是否成对？（不得按行顺序自动配对）" },
        { key: "pairingKey", label: "实际配对键", question: "用哪一列作为配对键？（只写“成对”不足，须给出具体列）" },
        { key: "columns", label: "pre/post 列", question: "哪列是前测、哪列是后测？" },
        { key: "units", label: "单位", question: "pre/post 的单位是什么？" },
        { key: "distribution", label: "差值分布前提", question: "差值的分布是否已检查（正态/离群）？前提不满足时应提问，不悄悄换检验。" },
      ],
      reject: [
        { key: "pairing", whenValue: FACT_VALUES.pairing.unpaired, reason: "无配对键，不按行顺序自动配对；应改用独立两组比较" },
      ],
      toolPath: [
        {
          tool: "scipy.stats",
          functions: ["scipy.stats.ttest_rel(pre, post)", "d = post - pre", "scipy.stats.shapiro(d)"],
          note: "先验证配对（键唯一、无缺对）与差值前提；差值分布偏离正态时应提问或提示本目录无更合适方法，不悄悄换检验。",
        },
      ],
      steps: [
        "确认配对键、pre/post 定义与单位",
        "按配对键对齐，剔除或标记缺对，检查键唯一",
        "计算差值 d = post - pre，检查差值分布（如 shapiro(d)）",
        "配对 t 检验：res = scipy.stats.ttest_rel(pre, post)",
        "报告配对数、差值均值与统计量/p 值",
      ],
      paramsToFill: ["输入数据文件路径", "配对键列", "pre 列", "post 列", "缺对处理规则"],
      artifacts: ["配对 t 检验结果（statistic、pvalue）", "配对数、差值均值", "差值分布图"],
      acceptance: ["配对键唯一且显式；未按行顺序配对", "缺对已剔除或标记", "差值分布前提已检查"],
      misuse: ["按行顺序自动配对", "缺对未处理", "差值分布未查即套用配对检验"],
      example: { description: "对合成 sample_paired.csv 按 id 配对比较 pre→post", datasetRef: "fixtures/m-method/data/sample_paired.csv" },
      toolVersion: VS,
      runtimeStatus: "verified",
    },
  };
}

export const METHOD_CATALOG: Readonly<Record<MethodId, CatalogEntry>> = buildCatalog();

export function getEntry(id: MethodId): CatalogEntry {
  return METHOD_CATALOG[id];
}

// ── hash / 稳定序列化 ───────────────────────────────────────

function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 深拷贝：快照不得引用可变对象（facts/条目/步骤），否则后续编辑会漂移旧快照。 */
const deepCopy = <T>(v: T): T => structuredClone(v);
export { deepCopy };

/** 单条目录内容的 hash（只覆盖该条内容，改动其他条目不使其漂移）。 */
export function entryHash(entry: CatalogEntry): string {
  return sha256(stableStringify(entry));
}

// ── 目录快照 ────────────────────────────────────────────────

export interface CatalogSnapshotEntry {
  readonly id: MethodId;
  readonly version: string;
  readonly hash: string;
  /** 该条目的完整正文深拷贝（快照自带内容，不引用可变目录对象）。 */
  readonly entry: CatalogEntry;
}
export interface CatalogSnapshot {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly entries: readonly CatalogSnapshotEntry[];
  readonly hash: string;
}

export const CATALOG_ID = "locus-local-methods";
export const CATALOG_VERSION = "1";

export function catalogSnapshot(): CatalogSnapshot {
  const entries = METHOD_IDS.map((id) => {
    const entry = deepCopy(METHOD_CATALOG[id]);
    return { id, version: entry.version, hash: entryHash(entry), entry };
  });
  return { catalogId: CATALOG_ID, catalogVersion: CATALOG_VERSION, entries, hash: sha256(stableStringify(entries)) };
}

// ── 方法前提判断 ────────────────────────────────────────────

export type MethodStatus = "ready" | "needs_info" | "not_applicable";

export interface MethodGap {
  readonly key: FactKey;
  readonly label: string;
  readonly status: FactStatus;
  readonly question: string;
}

export interface MethodJudgment {
  readonly method: MethodId;
  readonly entryVersion: string;
  readonly entryHash: string;
  readonly status: MethodStatus;
  readonly satisfied: readonly string[];
  readonly gaps: readonly MethodGap[];
  readonly questions: readonly string[];
  readonly notApplicableReason?: string;
  /** 仅当 status==="ready" 时给出可执行的完整操作；否则为 null。 */
  readonly executableSteps: readonly string[] | null;
  readonly factsEcho: MethodFacts;
}

const isConfirmed = (f: Fact | undefined): f is Fact => !!f && f.status === "confirmed";

/** 判断单个方法。未知不等于否定；机器推断不自动视为人工确认；一条方法被阻断不影响其他方法。 */
export function evaluateMethod(id: MethodId, facts: MethodFacts): MethodJudgment {
  const entry = METHOD_CATALOG[id];
  const eHash = entryHash(entry);

  // 先看触发 not_applicable 的确认事实（未知等于不触发）。
  for (const r of entry.reject ?? []) {
    const f = facts[r.key];
    if (f && f.status === "confirmed" && f.value === r.whenValue) {
      return {
        method: id,
        entryVersion: entry.version,
        entryHash: eHash,
        status: "not_applicable",
        satisfied: [],
        gaps: [],
        questions: [],
        notApplicableReason: r.reason,
        executableSteps: null,
        factsEcho: deepCopy(facts),
      };
    }
  }

  const satisfied: string[] = [];
  const gaps: MethodGap[] = [];
  for (const p of entry.required) {
    const f = facts[p.key];
    if (isConfirmed(f)) satisfied.push(p.label);
    else gaps.push({ key: p.key, label: p.label, status: f?.status ?? "unknown", question: p.question });
  }

  const status: MethodStatus = gaps.length === 0 ? "ready" : "needs_info";
  return {
    method: id,
    entryVersion: entry.version,
    entryHash: eHash,
    status,
    satisfied,
    gaps,
    questions: gaps.map((g) => g.question),
    executableSteps: status === "ready" ? deepCopy(entry.steps) : null,
    factsEcho: deepCopy(facts),
  };
}

// ── 评测快照 ────────────────────────────────────────────────

export interface ProfileRef {
  readonly version?: string;
  readonly hash?: string;
}

export interface EvaluationSnapshot {
  readonly catalog: CatalogSnapshot;
  readonly facts: MethodFacts;
  readonly judgments: readonly MethodJudgment[];
  /** 输入含 M2 画像版本/hash 时原样带上；没有则 null 且 profileMissing=true（不杜撰）。 */
  readonly profileRef: ProfileRef | null;
  readonly profileMissing: boolean;
  /** 调用方可选传入的观测时间（不影响任何 hash）。 */
  readonly at?: string;
}

export function evaluateAll(facts: MethodFacts, opts: { profileRef?: ProfileRef | null; at?: string } = {}): EvaluationSnapshot {
  const factsCopy = deepCopy(facts);
  const judgments = METHOD_IDS.map((id) => evaluateMethod(id, factsCopy));
  const profileRef = opts.profileRef ?? null;
  const snap: EvaluationSnapshot = {
    catalog: catalogSnapshot(),
    facts: factsCopy,
    judgments,
    profileRef,
    profileMissing: !profileRef,
    ...(opts.at ? { at: opts.at } : {}),
  };
  return snap;
}

/** 稳定序列化（键排序、无时间漂移）；同一输入恒得同一字符串，便于存证。 */
export function serializeEvaluation(snap: EvaluationSnapshot): string {
  return stableStringify(snap);
}

export { stableStringify };
