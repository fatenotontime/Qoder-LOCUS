/**
 * 知识基座（合同 §5.2 源历史、§4.2 固定版本解析）：源引用求值、纳管归档、固定版本解析。
 * 共享函数，供总览/wiki/比较/AI 读取与导出复用；不做网络、不做 UI。
 *
 * 原则：
 * - 首次引用当前源时保存基线，不扫描全库复制历史（纳管范围由引用闭包决定）。
 * - sourceVersions 每个键（kind+id+version）只追加一次，不覆盖。
 * - payload 为该类型完整可回查内容，不递归包含 knowledge 自身；原件保留实际 text。
 * - 外部手工改 state 导致已归档同版本 hash 不符 → content_mismatch，不覆盖存档。
 */
import type { LocusState } from "../store.ts";
import { contentHash } from "../store.ts";
import {
  type KnowledgeState,
  type SourceKind,
  type SourceRef,
  type SourceVersionRecord,
  canonicalHash,
  sourceRef as makeSourceRef,
} from "../domain/knowledge.ts";

const now = () => new Date().toISOString();
const sourceKey = (r: SourceRef) => `${r.kind}:${r.id}@${r.version}`;

/** 该类型的完整可回查 payload（不递归 knowledge；不存在返回 undefined）。 */
export function sourcePayload(state: LocusState, kind: SourceKind, id: string): unknown | undefined {
  switch (kind) {
    case "topic": return state.topics.find((x) => x.id === id);
    case "subquestion": return state.subquestions.find((x) => x.id === id);
    case "paper": return state.papers.find((x) => x.id === id);
    case "attachment": return state.attachments.find((x) => x.id === id);
    case "asset": return state.assets.find((x) => x.id === id); // 含实际 text
    case "card": return state.cards.find((x) => x.id === id);
    case "table": return state.tables.find((x) => x.id === id);
    case "protocol": return state.protocols.find((x) => x.id === id);
    case "template": return state.templates.find((x) => x.id === id);
    case "execution": return state.executions.find((x) => x.id === id);
    case "sample": return state.samples.find((x) => x.id === id);
    case "measurement": return state.measurements.find((x) => x.id === id);
    case "result": return state.analysisResults.find((x) => x.id === id);
    case "report": return state.reports.find((x) => x.id === id);
    case "ocr": return state.ocrs.find((x) => x.id === id);
    case "report_block": {
      const reportId = id.includes("#") ? id.slice(0, id.indexOf("#")) : "";
      const blockId = id.includes("#") ? id.slice(id.indexOf("#") + 1) : id;
      const rep = state.reports.find((r) => r.id === reportId);
      return rep?.blocks.find((b) => b.id === blockId || b.id === id);
    }
    case "chat_proposal": {
      for (const chat of state.chats) {
        for (const m of chat.messages) {
          const p = m.proposals.find((x) => `${chat.id}/${m.id}/${x.targetId}` === id || x.targetId === id);
          if (p) return p;
        }
      }
      return undefined;
    }
    default: return undefined;
  }
}

/** 某类型当前 SourceRef 的版本标识：业务修订 r:N；无修订的纳管对象 k:N；不可变原件 sha256:HASH。 */
function currentVersion(kind: SourceKind, obj: Record<string, unknown>): string {
  if (kind === "asset") {
    const h = typeof obj.hash === "string" ? obj.hash : contentHash(String(obj.text ?? ""));
    return `sha256:${h}`;
  }
  if (kind === "attachment") return "k:1";
  if (typeof obj.revision === "number") return `r:${obj.revision}`;
  return "k:1";
}

/** 求某业务对象当前 SourceRef（version + contentHash）。对象不存在返回 null。 */
export function currentSourceRef(state: LocusState, kind: SourceKind, id: string): SourceRef | null {
  const payload = sourcePayload(state, kind, id);
  if (payload === undefined || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  return makeSourceRef(kind, id, currentVersion(kind, obj), canonicalHash(payload));
}

/** 纳管：同键只追加一次；已存在即复用，不覆盖。 */
export function archiveSourceVersion(k: KnowledgeState, ref: SourceRef, payload: unknown): KnowledgeState {
  const key = sourceKey(ref);
  if (k.sourceVersions.some((v) => sourceKey(v.sourceRef) === key)) return k;
  const rec: SourceVersionRecord = { sourceRef: ref, archivedAt: now(), payload };
  return { ...k, sourceVersions: [...k.sourceVersions, rec] };
}

/** 便捷：求当前 SourceRef 并纳管（首次引用基线）。 */
export function ensureArchived(state: LocusState, k: KnowledgeState, kind: SourceKind, id: string): { ref: SourceRef; knowledge: KnowledgeState } | null {
  const ref = currentSourceRef(state, kind, id);
  if (!ref) return null;
  const payload = sourcePayload(state, kind, id);
  return { ref, knowledge: archiveSourceVersion(k, ref, payload) };
}

/** 读某固定版本 payload；不存在返回 null。 */
export function readSourceVersion(k: KnowledgeState, ref: SourceRef): unknown | null {
  const hit = k.sourceVersions.find((v) => sourceKey(v.sourceRef) === sourceKey(ref));
  return hit ? hit.payload : null;
}

export type SourceVersionResolution =
  | { readonly status: "ok"; readonly payload: unknown; readonly ref: SourceRef }
  | { readonly status: "source_missing" }
  | { readonly status: "history_unavailable"; readonly ref: SourceRef }
  | { readonly status: "content_mismatch"; readonly ref: SourceRef; readonly expected: string; readonly actual: string };

/**
 * 固定版本解析（读路径，不写库）：
 * 1. 来源对象已不存在 → source_missing（不读 latest 冒充旧版）。
 * 2. 已归档同版本 → 校验 contentHash；不符 → content_mismatch（不覆盖存档）。
 * 3. 未归档但请求的正是当前版本且 hash 相符 → ok（当前基线可读）。
 * 4. 否则 → history_unavailable（不推测补齐）。
 */
export function resolveSourceVersion(state: LocusState, k: KnowledgeState, ref: SourceRef): SourceVersionResolution {
  const payloadNow = sourcePayload(state, ref.kind, ref.id);
  const archived = k.sourceVersions.find((v) => sourceKey(v.sourceRef) === sourceKey(ref));
  if (archived) {
    const actual = canonicalHash(archived.payload);
    if (actual !== ref.contentHash) return { status: "content_mismatch", ref, expected: ref.contentHash, actual };
    return { status: "ok", payload: archived.payload, ref };
  }
  if (payloadNow === undefined || payloadNow === null) return { status: "source_missing" };
  const current = currentSourceRef(state, ref.kind, ref.id);
  if (current && current.version === ref.version && current.contentHash === ref.contentHash) {
    return { status: "ok", payload: payloadNow, ref };
  }
  return { status: "history_unavailable", ref };
}

/** 供读取闭包：给定来源种类/ID 解析其“当前”固定引用。 */
export function sourceRefOf(state: LocusState, kind: SourceKind, id: string): SourceRef {
  const ref = currentSourceRef(state, kind, id);
  if (!ref) throw new Error(`来源不存在：${kind} ${id}`);
  return ref;
}