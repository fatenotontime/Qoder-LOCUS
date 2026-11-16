/**
 * 按对象类型的回查链（骨架）。
 * 契约：回查是**网络**，不同来源类型的链不同；不是一条固定串联链。
 * 见 docs/stage0/05_DATAFLOW_WALKTHROUGH.md §5。
 */
import type { EntityKind } from "./types.ts";

/** 值/陈述的来源类型。 */
export type OriginKind =
  | "internal_result"        // LOCUS 内部处理结果
  | "author_external_result" // 作者外部结果
  | "literature_value"       // 文献数值/插图
  | "experimental_context"   // 实验背景/判据/目标
  | "raw_measurement";       // 原始实验测量

export interface BacktraceStep {
  readonly kind: EntityKind;
  readonly note?: string;
}

/**
 * 该来源类型的回查链原型（顺序即回查路径）。
 * 注意：不同原型经过的节点不同——文献值**不经过** Run/Measurement；
 * 实验背景**不回到**任何测量。
 */
export function backtraceChain(origin: OriginKind): BacktraceStep[] {
  switch (origin) {
    case "internal_result":
      return [
        { kind: "ResultRevision" },
        { kind: "Run", note: "输入快照/方法/参数/软件版本" },
        { kind: "SourceAsset", note: "上游结果或原始表（列/单元/图系列）" },
      ];
    case "author_external_result":
      return [
        { kind: "ResultRevision", note: "authorKind=author（外部提供）" },
        { kind: "SourceAsset", note: "作者来源文件/图" },
      ];
    case "literature_value":
      return [
        { kind: "EvidenceCard" },
        { kind: "SourceAsset", note: "文献定位：页序/区域/表号行列/图注" },
      ];
    case "experimental_context":
      return [
        { kind: "Topic" },
        { kind: "Subquestion", note: "及来源（文献/计划）" },
      ];
    case "raw_measurement":
      return [
        { kind: "Measurement" },
        { kind: "SampleState" },
        { kind: "Execution" },
        { kind: "ProtocolRevision", note: "执行固定引用的方案版本" },
      ];
  }
}

/** 是否只能追踪到文件级（方法不足，不硬造 Run）。 */
export function canOnlyReachFileLevel(origin: OriginKind): boolean {
  return origin === "author_external_result";
}

/** 该回查链是否经过某个实体类型。 */
export function chainPassesThrough(origin: OriginKind, kind: EntityKind): boolean {
  return backtraceChain(origin).some((step) => step.kind === kind);
}

/** 定位精度不足时应扩大的复核范围（返回说明，供界面明示）。 */
export const LOCATOR_GAP_NOTICE = "定位精度不足：扩大复核范围并明示，不伪称单元级已追踪";

export function traceLabel(origin: OriginKind): string {
  return backtraceChain(origin).map((s) => s.kind).join(" → ");
}
