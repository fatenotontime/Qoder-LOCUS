/**
 * 领域知识积累（5C）：从选定文献发起语义提取，单位是研究意义。
 * 与文献整理（条目/附件管理）在对象与界面层分开；收藏不触发解析。
 * 后台任务完成只追加待审卡（合并写回，ADR-0018 同口径），不换当前审阅版本。
 * 机械草稿（旧逐段拆分）明确标记，不与语义提取结果混淆。
 */
import { randomUUID } from "node:crypto";
import type { AssetRecord, LitCardRecord, LocusState, PaperEntry } from "../store.ts";
import { contentHash } from "../store.ts";
import { AppError } from "./app.ts";
import { AiError } from "./ai.ts";

const now = () => new Date().toISOString();

export interface KnowledgeJobInput {
  paperId: string;
  attachmentIds: string[];
  purpose: string;
  topicId?: string;
  subquestionId?: string;
}

/** 发起前同步校验：条目/附件存在、目的明确；固定输入快照（版本/hash），后台不改范围。 */
export function prepareKnowledge(state: LocusState, input: { paperId: string; attachmentIds?: string[]; purpose: string; topicId?: string; subquestionId?: string }): { jobInput: KnowledgeJobInput; assets: AssetRecord[]; snapshotHash: string } {
  const paper = state.papers.find((p) => p.id === input.paperId);
  if (!paper) throw new AppError(404, `论文条目不存在：${input.paperId}`);
  const purpose = String(input.purpose ?? "").trim();
  if (!purpose) throw new AppError(422, "请写明研究目的：知识提取围绕具体研究问题，不是无目的拆文本。");
  let atts = state.attachments.filter((a) => a.paperId === paper.id);
  if (input.attachmentIds?.length) atts = atts.filter((a) => input.attachmentIds!.includes(a.id));
  if (atts.length === 0) throw new AppError(422, "该条目没有可解析附件；请先在文献整理中导入附件。");
  const assets = atts.map((a) => {
    const asset = state.assets.find((x) => x.id === a.assetId);
    if (!asset) throw new AppError(404, `附件原件缺失：${a.assetId}`);
    return asset;
  });
  if (input.topicId && !state.topics.some((t) => t.id === input.topicId)) throw new AppError(404, `课题不存在：${input.topicId}`);
  if (input.subquestionId && !state.subquestions.some((q) => q.id === input.subquestionId)) throw new AppError(404, `子问题不存在：${input.subquestionId}`);
  const jobInput: KnowledgeJobInput = { paperId: paper.id, attachmentIds: atts.map((a) => a.id), purpose, topicId: input.topicId, subquestionId: input.subquestionId };
  const snapshotHash = contentHash(JSON.stringify({ paperId: paper.id, paperRevision: paper.revision, assets: assets.map((a) => ({ id: a.id, hash: a.hash })), purpose }));
  return { jobInput, assets, snapshotHash };
}

const KINDS = new Set(["data", "argument", "method", "idea"]);

/** 校验并映射语义提取输出：引文逐段对原件匹配；不匹配明示定位不足，不静默补造。 */
export function mapKnowledgeCards(paper: PaperEntry, assets: AssetRecord[], cards: unknown[]): LitCardRecord[] {
  if (!Array.isArray(cards)) throw new AiError("知识提取结果结构不符：cards 非数组。");
  const out: LitCardRecord[] = [];
  for (const c of cards) {
    const card = c as {
      kind?: string; rawText?: string; spans?: { quote?: string }[];
      extracted?: { fields?: Record<string, string>; units?: string[]; conditions?: string[] };
      scope?: string; interpretation?: string; unknowns?: string[]; secondaryCitation?: boolean;
    };
    const rawText = String(card.rawText ?? "").trim();
    if (!rawText) throw new AiError("知识提取结果含空概述。");
    const kind = KINDS.has(String(card.kind)) ? (card.kind as LitCardRecord["kind"]) : "argument";
    const unknowns = Array.isArray(card.unknowns) ? card.unknowns.map(String) : [];
    const quotes = (Array.isArray(card.spans) ? card.spans : []).map((s) => String(s?.quote ?? "").trim()).filter(Boolean);
    if (quotes.length === 0) throw new AiError(`卡「${rawText.slice(0, 30)}…」缺少原文引文（spans）；无法回查的提取不接收。`);
    const spans = quotes.map((quote) => {
      const hit = assets.find((a) => a.text.includes(quote));
      if (!hit) unknowns.push(`引文未在原件中逐字匹配（定位不足）：${quote.slice(0, 40)}…`);
      return { assetId: hit?.id ?? assets[0].id, quote, matched: Boolean(hit) };
    });
    const primary = spans.find((s) => s.matched) ?? spans[0];
    const extracted = {
      fields: card.extracted?.fields ?? {},
      units: Array.isArray(card.extracted?.units) ? card.extracted.units.map(String) : [],
      conditions: Array.isArray(card.extracted?.conditions) ? card.extracted.conditions.map(String) : [],
    };
    out.push({
      id: `card_${randomUUID()}`,
      assetId: primary.assetId,
      paperId: paper.id,
      kind,
      rawText,
      locator: { sectionQuote: primary.matched ? primary.quote.slice(0, 120) : "" },
      spans,
      extracted,
      scope: String(card.scope ?? "").trim(),
      interpretation: String(card.interpretation ?? "").trim(),
      unknowns,
      secondaryCitation: card.secondaryCitation === true,
      audit: "unreviewed",
      importance: null,
      note: "",
      reason: "",
      extraction: "ai",
      mechanical: false,
      revision: 1,
      history: [],
      createdAt: now(),
      updatedAt: now(),
    });
  }
  return out;
}

/**
 * 完成时合并写回：对**最新** state 只追加本 job 新卡；
 * 同条目同概述已存在 → 跳过（重试/重复提交不重复入库）；等待期编辑不受影响。
 */
export function applyKnowledge(state: LocusState, paperId: string, cards: LitCardRecord[]): { state: LocusState; created: number; skipped: number } {
  const existing = new Set(state.cards.filter((c) => c.paperId === paperId).map((c) => c.rawText));
  const fresh = cards.filter((c) => !existing.has(c.rawText));
  return { state: { ...state, cards: [...state.cards, ...fresh] }, created: fresh.length, skipped: cards.length - fresh.length };
}