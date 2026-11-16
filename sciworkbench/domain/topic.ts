/**
 * 课题 / 子问题（阶段3）。
 * 契约：TOP01 最小创建仅名称+研究问题，其他逐步补齐；不阻塞。
 */
import type { Rev } from "./types.ts";

export interface Topic {
  readonly id: string;
  readonly revision: Rev;
  readonly name: string;
  readonly researchQuestion: string;
  readonly basis?: string;
  readonly goal?: string;
  readonly unknowns?: string[];
  readonly design?: string;
  readonly parentId?: string;
}

export type SubquestionKind = "declared" | "exploratory";

export interface Subquestion {
  readonly id: string;
  readonly revision: Rev;
  readonly topicId: string;
  readonly question: string;
  readonly kind: SubquestionKind;
}

export class TopicError extends Error {}

/** 最小创建：只有名称与研究问题；空则拒绝。 */
export function createTopic(name: string, researchQuestion: string): Topic {
  const n = (name ?? "").trim();
  const q = (researchQuestion ?? "").trim();
  if (!n) throw new TopicError("课题名称不能为空。");
  if (!q) throw new TopicError("研究问题不能为空。");
  return { id: `topic_${n}`, revision: 1, name: n, researchQuestion: q };
}

/** 分析必选子问题；可现场新建探索性问题，不增加课题创建门槛。 */
export function createSubquestion(
  topicId: string,
  question: string,
  kind: SubquestionKind = "declared",
): Subquestion {
  const q = (question ?? "").trim();
  if (!q) throw new TopicError("子问题不能为空。");
  return { id: `subq_${topicId}_${q}`, revision: 1, topicId, question: q, kind };
}

export type TaskNeed = "design" | "variables" | "criteria";

/**
 * 执行具体任务时检查缺项；返回该任务需要的、课题尚未补齐的字段。
 * 探索性研究不强迫预先有明确假设。
 */
export function missingForTask(topic: Topic, needs: readonly TaskNeed[]): TaskNeed[] {
  const missing: TaskNeed[] = [];
  for (const need of needs) {
    switch (need) {
      case "design":
        if (!topic.design) missing.push("design");
        break;
      case "variables":
        if (!topic.unknowns && !topic.goal) missing.push("variables");
        break;
      case "criteria":
        if (!topic.goal) missing.push("criteria");
        break;
    }
  }
  return missing;
}
