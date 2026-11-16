/**
 * 关系网络：双链（数据链 + 科学依据链）+ 溯源 + 归属（骨架）。
 * 见 10 §四、LIN01。引用固定 revision，不指向 latest。
 */
import type { Ref } from "./types.ts";

/** 四类关系语义：组织归属 / 来源溯源 / 处理依赖 / 科学支持。 */
export type EdgeKind = "affiliation" | "provenance" | "lineage" | "support";

export type EstablishedBy = "run" | "human";

export interface DependencyEdge {
  readonly from: Ref;
  readonly to: Ref;
  readonly edgeKind: EdgeKind;
  /** 定位精度不足时记录原因，不伪称单元级。 */
  readonly locator?: string;
  /** 依赖由何建立：实际运行或人工确认；非全靠 LLM 推断。 */
  readonly establishedBy: EstablishedBy;
}

export function refKey(ref: Ref): string {
  return `${ref.kind}:${ref.id}@${ref.revision}`;
}

/** 反向索引：被引用者 → 引用它的边。 */
export function reverseIndex(edges: readonly DependencyEdge[]): Map<string, DependencyEdge[]> {
  const index = new Map<string, DependencyEdge[]>();
  for (const edge of edges) {
    const key = refKey(edge.from);
    const bucket = index.get(key);
    if (bucket) bucket.push(edge);
    else index.set(key, [edge]);
  }
  return index;
}

export interface DownstreamOptions {
  /** 只沿这些关系类别传播；缺省=全部。 */
  readonly edgeKinds?: readonly EdgeKind[];
}

/**
 * 求某 ref 的下游（被影响者），可限定关系类别。
 * 用于：改一个数值 → 命中引用它的分析/图/报告块。
 */
export function downstreamOf(
  edges: readonly DependencyEdge[],
  start: Ref,
  options: DownstreamOptions = {},
): Ref[] {
  const allowed = options.edgeKinds ? new Set(options.edgeKinds) : null;
  const index = reverseIndex(edges);
  const seen = new Set<string>([refKey(start)]);
  const result: Ref[] = [];
  const queue: Ref[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as Ref;
    for (const edge of index.get(refKey(current)) ?? []) {
      if (allowed && !allowed.has(edge.edgeKind)) continue;
      const key = refKey(edge.to);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(edge.to);
      queue.push(edge.to);
    }
  }
  return result;
}

/** 数据链（实际处理依赖）下游。 */
export function dataLineageDownstream(edges: readonly DependencyEdge[], start: Ref): Ref[] {
  return downstreamOf(edges, start, { edgeKinds: ["lineage"] });
}

/** 科学依据链下游（解释/判断依赖的证据）。 */
export function supportDownstream(edges: readonly DependencyEdge[], start: Ref): Ref[] {
  return downstreamOf(edges, start, { edgeKinds: ["support"] });
}
