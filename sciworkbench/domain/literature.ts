/**
 * 文献证据与审阅（阶段3）。
 * 契约：抽取 / 人工核对 / 课题重要程度 / 任务采用 四个维度分开（LIT01–LIT11）。
 * EvidenceCard 为**文献专用**，非所有实验读数的统一容器。
 */
import type { Locator, Ref, Rev } from "./types.ts";

/** 人工核对动作。 */
export type AuditDecision = "confirm" | "need_info" | "exclude" | "skip";
/** 课题重要程度（独立维度，可空）。 */
export type Importance = "high" | "medium" | "low";
/** 候选库状态。 */
export type CandidateState = "unreviewed" | "pending" | "reviewed" | "adopted";

export class LiteratureError extends Error {}

export interface CardReview {
  readonly audit: AuditDecision;
  readonly importance?: Importance | null;
  readonly note?: string;
  readonly reason?: string;
}

export interface LiteratureEvidenceCard {
  readonly id: string;
  readonly revision: Rev;
  readonly sourceRef: Ref<"SourceAsset">;
  readonly locator: Locator;
  readonly rawText: string;
  readonly extracted: { readonly fields: Record<string, string>; readonly units?: string[] };
  readonly unknowns: string[];
  readonly review: CardReview;
  /** 是否为综述转引（二手），不计多份独立证据。 */
  readonly secondaryCitation?: boolean;
  readonly adoption?: { readonly taskRef: Ref; readonly decision: "adopt" | "exclude"; readonly reason?: string };
}

export interface CardPatch {
  /** 修改了关键数值/抽取字段？ */
  readonly keyValueChanged?: boolean;
  /** 排除了已采用证据？ */
  readonly excludingAdopted?: boolean;
  /** 撤回确认？ */
  readonly withdrawing?: boolean;
}

/** 应用一次人工核对：三维独立；关键修改须原因。 */
export function reviewCard(
  card: LiteratureEvidenceCard,
  decision: AuditDecision,
  patch: CardPatch & { importance?: Importance | null; note?: string; reason?: string } = {},
): LiteratureEvidenceCard {
  const reason = (patch.reason ?? "").trim();
  const needsReason =
    (patch.keyValueChanged && patch.excludingAdopted !== true) ||
    patch.excludingAdopted === true ||
    patch.withdrawing === true;
  if (needsReason && !reason) {
    throw new LiteratureError("修改关键数值 / 排除已采用 / 撤回确认，必须填写简短原因。");
  }
  const nextReview: CardReview = {
    audit: decision,
    importance: patch.importance ?? card.review.importance ?? null,
    note: patch.note ?? card.review.note,
    reason: reason || card.review.reason,
  };
  return { ...card, revision: card.revision + 1, review: nextReview };
}

/** 候选库状态：跳过 ≠ 不重要 ≠ 正式依据。 */
export function candidateState(card: LiteratureEvidenceCard): CandidateState {
  if (card.adoption) return "adopted";
  switch (card.review.audit) {
    case "skip":
      return "unreviewed"; // 保持未复核，可探索，不当正式依据
    case "need_info":
      return "pending";
    case "exclude":
      return "reviewed";
    case "confirm":
      return "reviewed";
  }
}

/** 正式采用是否被允许：缺定位不得用于正式判断。 */
export function canAdoptFormally(card: LiteratureEvidenceCard): boolean {
  const l = card.locator;
  const hasLocator = Boolean(l.page || l.region || l.sectionQuote || l.table || l.figureCaption || l.cellRange);
  return card.review.audit === "confirm" && hasLocator;
}

export function adoptForTask(
  card: LiteratureEvidenceCard,
  taskRef: Ref,
  decision: "adopt" | "exclude" = "adopt",
  reason?: string,
): LiteratureEvidenceCard {
  if (decision === "adopt" && !canAdoptFormally(card)) {
    throw new LiteratureError("不足以正式采用：核对未确认或缺少原文定位（可先暂存搜索）。");
  }
  return { ...card, revision: card.revision + 1, adoption: { taskRef, decision, reason } };
}

/** 批量审阅：必须先呈现共享条件、缺项、异常，经确认才可整组确认。 */
export interface BatchPreview {
  readonly sharedConditions: string[];
  readonly missing: string[];
  readonly anomalies: string[];
  readonly requiresAck: boolean;
}

export function batchReviewPreview(cards: readonly LiteratureEvidenceCard[]): BatchPreview {
  const conditions = new Set<string>();
  const missing: string[] = [];
  const anomalies: string[] = [];
  for (const c of cards) {
    for (const u of c.extracted.units ?? []) conditions.add(u);
    if (!c.locator.page && !c.locator.region && !c.locator.sectionQuote) missing.push(c.id);
    if (c.unknowns.length > 0) anomalies.push(c.id);
  }
  return {
    sharedConditions: [...conditions],
    missing,
    anomalies,
    requiresAck: cards.length > 1,
  };
}

/** 批量确认：未先 ack 则拒绝（不把未展示数据静默一起确认）。 */
export function batchConfirm(cards: readonly LiteratureEvidenceCard[], ack: boolean): LiteratureEvidenceCard[] {
  const preview = batchReviewPreview(cards);
  if (preview.requiresAck && !ack) {
    throw new LiteratureError("批量确认前必须先呈现共享条件/缺项/异常并确认。");
  }
  return cards.map((c) => reviewCard(c, "confirm", { importance: c.review.importance }));
}

// ── 查重（LIT07）────────────────────────────────────────────
export type DedupAction = "reject_exact" | "same_doi_new_version" | "same_doi_unverified" | "title_similar_hint" | "distinct";

export interface SourceFingerprint {
  readonly fileHash: string;
  readonly doi?: string;
  readonly contentHash?: string;
  readonly title?: string;
}

export function dedupAction(a: SourceFingerprint, b: SourceFingerprint): DedupAction {
  if (a.fileHash && a.fileHash === b.fileHash) return "reject_exact";
  if (a.doi && a.doi === b.doi) {
    // P3 反例：同 DOI 但内容 hash 未知 → 不得误拒（可能是修订版/补充材料），只提示待核实。
    if (!a.contentHash || !b.contentHash) return "same_doi_unverified";
    if (a.contentHash !== b.contentHash) return "same_doi_new_version";
    return "reject_exact";
  }
  if (a.title && b.title && normalise(a.title) === normalise(b.title)) return "title_similar_hint";
  return "distinct";
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

// ── 命名映射与比较（LIT09 / LIT10）───────────────────────────
export interface NameMapping {
  readonly original: string;
  readonly mapped: string;
  readonly basis: string;
}

export function mapName(original: string, mapped: string, basis: string): NameMapping {
  if (!original.trim() || !mapped.trim()) throw new LiteratureError("原名与映射名均不能为空。");
  if (!basis.trim()) throw new LiteratureError("命名映射必须有来源依据；禁止仅按同名自动合并。");
  return { original: original.trim(), mapped: mapped.trim(), basis: basis.trim() };
}

export interface ComparisonInput {
  readonly dataRevision: string;
  readonly filters: string[];
  readonly conversions: string[];
  readonly exclusions: string[];
  readonly nameMappings: NameMapping[];
}

export interface ComparisonSnapshot extends ComparisonInput {
  readonly snapshotId: string;
}

export function freezeComparison(input: ComparisonInput): ComparisonSnapshot {
  // P4 反例：快照 id 必须覆盖全部输入（筛选/换算/排除/映射），否则不同口径共用同一 id。
  const payload = JSON.stringify([input.dataRevision, input.filters, input.conversions, input.exclusions, input.nameMappings]);
  let h = 0;
  for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) | 0;
  return { ...input, snapshotId: `cmp_${input.dataRevision}_${(h >>> 0).toString(36)}` };
}

/** 新文献进入库：只提醒是否重比，不自动推翻旧结论。 */
export function newMaterialReminder(
  existing: readonly ComparisonSnapshot[],
  newCards: readonly LiteratureEvidenceCard[],
): boolean {
  return existing.length > 0 && newCards.length > 0;
}

// ── 汇总分层（LIT11）────────────────────────────────────────
export type ClaimLayer = "observation" | "disagreement" | "assumption";

export interface SummaryClaim {
  readonly layer: ClaimLayer;
  readonly text: string;
  readonly evidenceRefs: readonly string[];
  /** 人工认可不足以把假设升级为事实。 */
  readonly endorsed?: boolean;
}

export function summarize(claims: readonly SummaryClaim[]): Record<ClaimLayer, SummaryClaim[]> {
  const out: Record<ClaimLayer, SummaryClaim[]> = { observation: [], disagreement: [], assumption: [] };
  for (const c of claims) out[c.layer].push(c);
  return out;
}

/** 观察类陈述必须引证据；无引用则明示。 */
export function unbackedObservations(claims: readonly SummaryClaim[]): SummaryClaim[] {
  return claims.filter((c) => c.layer === "observation" && c.evidenceRefs.length === 0);
}

/** 独立证据计数：综述转引（二手）不计为多份独立证据；未确认的不计。 */
export function independentEvidenceCount(cards: readonly LiteratureEvidenceCard[]): number {
  return cards.filter((c) => !c.secondaryCitation && c.review.audit === "confirm").length;
}

/** 人工认可假设不改变其层级（endorsed 仅为标记）。 */
export function endorse(claim: SummaryClaim): SummaryClaim {
  return { ...claim, endorsed: true };
}

