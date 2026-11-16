/**
 * 三条业务路径 + 两个事件（骨架）。
 * 铁律：先分路径，再分事件。见 docs/stage0/05_DATAFLOW_WALKTHROUGH.md
 */
import type { EntityKind } from "./types.ts";

/** 上传/导入时用户或系统声明的材料角色。 */
export type UploadRole = "literature" | "protocol" | "experimental_data";

/** 三条不同业务路径。 */
export type BusinessPath = "lit" | "protocol" | "data";

export function pathOfRole(role: UploadRole): BusinessPath {
  switch (role) {
    case "literature":
      return "lit";
    case "protocol":
      return "protocol";
    case "experimental_data":
      return "data";
  }
}

/** 每条路径的入口材料类型与产生的实体（顺序即主要流转）。 */
export function artifactsOfPath(path: BusinessPath): { entry: string; produces: EntityKind[] } {
  switch (path) {
    case "lit":
      return {
        entry: "文献 PDF/网页/题录",
        produces: ["SourceAsset", "EvidenceCard", "TopicEvidence", "EvidenceAdoption", "NameMapping", "Comparison"],
      };
    case "protocol":
      return { entry: "方案文件/手填/AI", produces: ["ProtocolRevision", "RecordTemplateRevision"] };
    case "data":
      return { entry: "仪器文件/谱图/表格/纸记录", produces: ["SourceAsset", "Measurement", "Execution", "Session"] };
  }
}

/** 操作类型（用户意图）。 */
export type OperationKind = "import_public_data" | "run_experiment";

/** 两个事件：同一次"导入"结果不同。 */
export type EventKind = "public_import" | "user_execution";

export function eventOfOperation(op: OperationKind): EventKind {
  return op === "import_public_data" ? "public_import" : "user_execution";
}

/** 是否产生用户自己的执行事实（Execution/Session）。 */
export function producesUserExecution(op: OperationKind): boolean {
  return op === "run_experiment";
}

/** 是否新建用户样品身份。 */
export function createsUserSample(op: OperationKind): boolean {
  return op === "run_experiment";
}

/**
 * 该事件是否可宣称"用户原创科研"。
 * 公开数据导入不得宣称用户原创。
 */
export function claimsUserOriginal(op: OperationKind): boolean {
  return op === "run_experiment";
}

/** 当只有文件级可追踪（如作者外部结果方法不足）时标记。 */
export const FILE_LEVEL_ONLY = "file_level_only" as const;
