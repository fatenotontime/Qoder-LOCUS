/**
 * 确定性传播 + 影响分析状态机（骨架）。
 * 契约：确定性传播 + AI 语义评估分栏；AI 不重复猜数学；失败/未配置 ≠ 无影响。
 * 见 02 LIN03 / 03 §Edit Impact / 05 I-V01–V13。
 */

/** 变更类型（决定复核范围，不靠 LLM）。 */
export type ChangeKind =
  | "value"          // 确认表中一个数值
  | "unit_or_ownership" // 单位/样品归属
  | "method_or_params"  // 方法/参数/代码
  | "criteria_or_goal"  // 研究目标/判据
  | "title_or_note";    // 标题/备注

export interface ReviewPlan {
  /** 需重算/重生成下游数值？ */
  readonly recompute: boolean;
  /** 需建新 Run（方法/参数/代码变化）？ */
  readonly newRun: boolean;
  /** 相关分析/图表需复核？ */
  readonly reviewAnalysis: boolean;
  /** 解释/结论需复核？ */
  readonly reviewInterpretation: boolean;
  readonly reason: string;
}

/** 按变更类型分流（LIN03/I06）：不是所有改动一律报警。 */
export function planForChange(kind: ChangeKind): ReviewPlan {
  switch (kind) {
    case "value":
      return {
        recompute: true, newRun: false, reviewAnalysis: true, reviewInterpretation: true,
        reason: "数值变更命中真正引用它的分析/图表/报告块",
      };
    case "unit_or_ownership":
      return {
        recompute: true, newRun: false, reviewAnalysis: true, reviewInterpretation: true,
        reason: "单位/样品归属变更影响相关处理、比较与解释；保留旧输入",
      };
    case "method_or_params":
      return {
        recompute: false, newRun: true, reviewAnalysis: true, reviewInterpretation: true,
        reason: "方法/参数/代码变更应建立新 Run；旧 Run 可还原，不覆盖旧报告",
      };
    case "criteria_or_goal":
      return {
        recompute: false, newRun: false, reviewAnalysis: false, reviewInterpretation: true,
        reason: "目标/判据变更主要影响解释；数值无理由不强制重算",
      };
    case "title_or_note":
      return {
        recompute: false, newRun: false, reviewAnalysis: false, reviewInterpretation: false,
        reason: "标题/备注变更通常不重算、不误报",
      };
  }
}

/** 影响分析任务状态（03 §Edit Impact）。 */
export type ImpactStatus = "pending" | "running" | "completed" | "failed" | "stale";

/** AI 语义评估结论（仅在 completed 时有意义）。 */
export type AssessmentImpact = "impact" | "no_supported_impact_found" | "needs_review";

export interface ImpactState {
  readonly status: ImpactStatus;
  readonly assessment?: AssessmentImpact;
  /** 输入快照 hash；较新改动到达则旧分析 stale、引用旧快照供查。 */
  readonly snapshotHash?: string;
}

export type ImpactEvent =
  | { readonly type: "start" }
  | { readonly type: "complete"; readonly assessment: AssessmentImpact; readonly snapshotHash: string }
  | { readonly type: "fail" }
  | { readonly type: "invalidate" };

/** 状态机：pending → running → completed|failed；任意非终态可被 invalidate 置 stale。 */
export function transition(state: ImpactState, event: ImpactEvent): ImpactState {
  switch (event.type) {
    case "start":
      return state.status === "pending" ? { status: "running" } : state;
    case "complete":
      return state.status === "running"
        ? { status: "completed", assessment: event.assessment, snapshotHash: event.snapshotHash }
        : state;
    case "fail":
      return state.status === "running" ? { status: "failed" } : state;
    case "invalidate":
      return state.status === "stale" ? state : { status: "stale", assessment: state.assessment, snapshotHash: state.snapshotHash };
  }
}

/**
 * 决定界面应展示什么。
 * 硬约束：failed / 未配置 ⇒ **不得**展示 no_supported_impact_found；
 * running/pending ⇒ 显示"未分析/进行中"，不暗示无影响。
 */
export function displayAssessment(state: ImpactState): AssessmentImpact | "not_analyzed" | "failed" {
  switch (state.status) {
    case "pending":
    case "running":
      return "not_analyzed";
    case "failed":
      return "failed";
    case "stale":
      // 旧结果仅供历史查看，不当作当前结论。
      return state.assessment === "no_supported_impact_found" ? "needs_review" : state.assessment ?? "not_analyzed";
    case "completed": {
      const a = state.assessment ?? "needs_review";
      // 防御：任何"无影响"结论都必须有 completed 支撑。
      return a;
    }
  }
}

/** 断言式守卫：把非法组合纠正为 needs_review。 */
export function normalizeAssessment(state: ImpactState): ImpactState {
  if (state.status === "failed" && state.assessment === "no_supported_impact_found") {
    return { status: "failed", assessment: "needs_review", snapshotHash: state.snapshotHash };
  }
  return state;
}
