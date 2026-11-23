/**
 * LOCUS 最小 Web 闭环 — 零依赖本地服务（v2）。
 * 运行：node server.ts   （默认 http://127.0.0.1:5173）
 * AI 配置：启动时读环境变量，其次读本机数据目录下的 ai-config.json（见 services/ai-config.ts）。
 * 网页保存/清除会同步落盘/删盘；配置文件含 Key，仅本机、不入 Git/日志/导出。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonFileStore, type LocusState, type Store } from "./store.ts";
import { AiError, clearAiConfig, describeConfig, getAiConfig, listAiModels, setAiConfig, testAiConnection } from "./services/ai.ts";
import { loadAiConfigFile, removeAiConfigFile, saveAiConfigFile } from "./services/ai-config.ts";
import {
  AppError,
  addManualCard,
  applyLiterature,
  batchConfirm,
  batchPreview,
  binaryAssetKind,
  createComparison,
  createMapping,
  createSubquestion,
  createTopic,
  importLiterature,
  importMeasurements,
  importParsedFile,
  makeBinaryAsset,
  mapAiLiteratureCards,
  parsedSummaryText,
  prepareLiterature,
  reviewCard,
  reviewTable,
  sourceView,
  upsertAdoption,
} from "./services/app.ts";
import { ImportError, OriginalStore, listWorkbookSheets, parseBytes } from "./services/import-formats/index.ts";
import {
  addManualOcr,
  addMeasurement,
  addSampleState,
  appendEvent,
  completeExecution,
  confirmOcr,
  confirmPreparation,
  confirmTemplate,
  createProtocol,
  createSample,
  createTemplate,
  editEvent,
  editMeasurement,
  editProtocol,
  importImage,
  pauseAssist,
  pauseExecution,
  protocolDraftFromAi,
  registerImpact,
  renameSample,
  resumeExecution,
  runImpactAssessment,
  runOcr,
  saveExecutionAsProtocol,
  startExecution,
  templateProtocolCheck,
  updatePreparation,
  uploadProtocolSource,
} from "./services/experiment.ts";
import { extractLiterature, runTask } from "./services/ai.ts";
import {
  createAnalysisTask, setTaskCandidates, buildSnapshot, snapshotInput, applyRecommendation,
  submitResult, editResult, archiveResultFile, createReport,
  previewReportEdit, applyReportEdit, confirmReportBlock, draftReportBlocks,
  createChat, chatScopeSnapshot, chatHistoryInput, appendChatTurn, applyChatResponse,
  failChat, cancelChat, retryChat, adoptProposal, recoverInterruptedChats,
} from "./services/analysis.ts";
import { traverseNetwork, changeHits } from "./services/references.ts";
import { buildContextMap, parsePicks } from "./services/context-map.ts";
import { buildReportDocx, buildTraceabilityPackage, buildWholeLibraryPackage, inspectLibraryJson, countsOf } from "./services/export.ts";
import { addPaperAttachment, createPaper, importBibliography, linkPaperTopic, updatePaper } from "./services/papers.ts";
import {
  buildKnowledgeBatch, chunkInputTexts, commitKnowledgeChunk, prepareKnowledgeRun, settleRun, validateKnowledgeBatch,
  type BuiltBatch, type KnowledgeRunInput, type SearchSpace, type StructBatch,
} from "./services/knowledge.ts";
import { extractKnowledgeStructChunk, knowledgeStructInput } from "./services/ai.ts";
import { ensureArchived, resolveSourceVersion } from "./services/knowledge-base.ts";
import {
  createKnowledgeDataset, createKnowledgeComparison, createKnowledgeMapping, createKnowledgeStatement,
  createKnowledgeTheme, readDatasetRows, readKnowledge, readKnowledgeVersion, resolveKnowledgeEvidence,
  reviewKnowledgeContext, reviewKnowledgeDataset, reviewKnowledgeItem, reviewKnowledgeMapping,
  structureLegacyCard, updateKnowledgeContext, updateKnowledgeDataset, updateKnowledgeItem,
  updateKnowledgeMapping, updateKnowledgeTheme,
  assertKnowledgeAccess, freezeKnowledge, knowledgeAccess, readSnapshotKnowledge, readSnapshotDatasetRows,
  resolveSnapshotToken, upsertSourcePolicy, buildKnowledgeContainer, knowledgePipelineStatus, snapshotAccessRefs,
} from "./services/knowledge-base.ts";
import { exportKnowledge, buildKnowledgePackage } from "./services/knowledge-export.ts";
import type { ExtractionRunRecord, ExtractionRunStatus, SourceKind, SourceRef } from "./domain/knowledge.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
const DATA_PATH = process.env.LOCUS_DATA ?? join(HERE, "data", "state.json");
const AUDIT_DIR = join(dirname(DATA_PATH), "audit");
/** AI 配置落盘位置：随数据目录（`sciworkbench/data/` 已被 .gitignore 覆盖）。含 Key，不入库。 */
const AI_CONFIG_PATH = process.env.LOCUS_AI_CONFIG ?? join(dirname(DATA_PATH), "ai-config.json");
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 5173);
const MAX_BODY = 8 * 1024 * 1024;

/** 审计：留存模型原始响应（不含认证头）；写入数据区，不入 Git。失败不阻断主流程。 */
function writeAudit(assetId: string, audit: { raws: { index: number; content: string }[]; model: string }, task = "literature_extract"): void {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(join(AUDIT_DIR, `${assetId}.json`), JSON.stringify({ assetId, at: new Date().toISOString(), task, model: audit.model, raws: audit.raws }, null, 2), "utf8");
  } catch {
    /* 审计失败不影响导入结果 */
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/** 知识提取任务的运行控制句柄（内存）；持久判定以 run.status/receipt 为准。 */
export interface KnowledgeControl {
  runId: string;
  cancel(): void;
  pause(): void;
  resume(): void;
  retryChunk(index: number): Promise<{ created: number; skipped: number; createdItems: number; pendingItems: number; replayed: boolean; discarded: boolean; duplicateCandidates: string[] }>;
}

export interface Job {
  id: string;
  status: "running" | "done" | "error" | "paused";
  done: number;
  total: number;
  message: string;
  result?: {
    assetId?: string; created?: number; reminder?: boolean; protocolId?: string; impactId?: string;
    ocrIds?: string[]; discarded?: boolean; paperId?: string; skipped?: number;
    chunkErrors?: { index: number; error: string; recoverable: boolean }[];
    cancelled?: boolean; paused?: boolean;
    /** 知识提取（合同 §5.4/§6）：jobId 与持久 runId 同时返回；计数按阅读壳与知识项分别给出。 */
    runId?: string; runStatus?: ExtractionRunStatus; createdItems?: number; pendingItems?: number;
    duplicateCandidates?: string[]; unresolvedLinks?: string[];
  };
  error?: string;
}

export async function createApp(store: Store, opts: { aiConfigPath?: string; originalRoot?: string } = {}) {
  const aiConfigPath = opts.aiConfigPath;
  // 二进制原件专用根目录（state.json 外置）：未显式指定时用实例级临时目录（测试用），生产由 main 传数据目录下 originals/。
  const originals = new OriginalStore(opts.originalRoot ?? join(tmpdir(), `locus-originals-${randomUUID()}`));
  // 启动读回本机保存的 AI 配置（环境变量优先；两者都无则未配置）。
  if (aiConfigPath && !getAiConfig()) {
    const saved = loadAiConfigFile(aiConfigPath);
    if (saved) setAiConfig({ baseUrl: saved.baseUrl, model: saved.model, key: saved.key, timeoutMs: saved.timeoutMs });
  }
  let state: LocusState = await store.load();
  // 启动恢复：服务重启后仍为 running 的模型消息成孤儿 → 标失败可重试（job 仅在内存）。
  {
    const rec = recoverInterruptedChats(state);
    if (rec.recovered > 0) { await store.save(rec.state); state = rec.state; }
  }
  /**
   * 单写入边界（合同 §5.1）：所有持久化写操作串行进入队列；changeFn 在队列执行时读取最新 state。
   * 保存成功后才发布内存 state；单笔失败不挂死队列，后续提交继续。
   */
  let commitQueue: Promise<void> = Promise.resolve();
  function commitState<T>(changeFn: (latest: LocusState) => Promise<T> | T): Promise<T> {
    const run = commitQueue.then(() => changeFn(state));
    commitQueue = run.then(() => {}, () => {});
    return run;
  }
  const jobs = new Map<string, Job>();
  // 任务身份/重复提交守卫：同一原件的方案解析同时只允许一个在跑 job。
  const parsingAssets = new Set<string>();
  const recommendingTasks = new Set<string>();
  // 知识提取运行控制（合同 §5.3/§5.4）：运行时 jobId ↔ 持久 runId；取消/暂停/继续/重试以 run 与 receipt 为准。
  const knowledgeRuns = new Map<string, KnowledgeControl>();
  const knowledgeJobByRun = new Map<string, string>();
  /** 循环内的软控制位（内存）：真正的取消/暂停判定以已提交 run.status 与 receipt 为准。 */
  const knowledgeSignals = new Map<string, { cancelling: boolean; pausing: boolean; running: boolean; fatal: string | null }>();

  /** 队列外准备出的单块结果（模型已回、整批校验已通过），供队列内构建＋提交复用。 */
  type PreparedChunk = { index: number; chunkId: string; batch: StructBatch; spaces: SearchSpace[]; unresolvedLinks: string[]; raw: string };
  type ChunkCommitOutcome = { created: number; skipped: number; createdItems: number; pendingItems: number; replayed: boolean; discarded: boolean; duplicateCandidates: string[] };
  const RUN_STATUS_TEXT: Record<ExtractionRunStatus, string> = {
    running: "进行中", paused: "已暂停", completed: "全部块已入库", partial: "部分块失败",
    failed: "全部块失败", cancelled: "已取消", interrupted: "已中断（服务重启，可继续/重试）",
  };

  const knowledgeRun = (runId: string): ExtractionRunRecord | undefined =>
    state.knowledge.extractionRuns.find((r) => r.id === runId);
  const knowledgeJobOf = (runId: string): Job | undefined => {
    const jobId = knowledgeJobByRun.get(runId);
    return jobId ? jobs.get(jobId) : undefined;
  };
  /** jobId 或 runId 均可定位持久 run（重启后 jobId 失效，界面带 runId 继续）。 */
  const resolveKnowledgeRunId = (ident: string, bodyRunId?: unknown): string | null => {
    const byJob = knowledgeJobByRun.get(String(bodyRunId ?? ""));
    if (byJob) return String(bodyRunId);
    if (knowledgeRun(String(bodyRunId ?? ""))) return String(bodyRunId);
    const mapped = knowledgeRuns.get(ident)?.runId;
    if (mapped) return mapped;
    return knowledgeRun(ident) ? ident : null;
  };
  /** 计数一律从已提交 run 的 receipt 推导：重放不重复计数，重启后仍正确。 */
  const recountKnowledgeJob = (runId: string) => {
    const job = knowledgeJobOf(runId);
    const run = knowledgeRun(runId);
    if (!job || !job.result || !run) return;
    const receipts = run.chunks.filter((c) => c.receipt).map((c) => c.receipt!);
    job.result.created = receipts.reduce((n, c) => n + c.response.created, 0);
    job.result.createdItems = receipts.reduce((n, c) => n + c.response.createdItems, 0);
    job.result.pendingItems = receipts.reduce((n, c) => n + c.response.pendingItems, 0);
    job.result.runStatus = run.status;
    job.total = run.chunks.length;
    job.done = run.chunks.filter((c) => c.status !== "pending").length;
  };
  const pushUnique = (arr: string[] | undefined, ...items: string[]) => {
    if (!arr) return;
    for (const x of items) if (!arr.includes(x)) arr.push(x);
  };

  /** 模型调用（队列外）：读冻结块 → 结构化提取 → 整批校验；已成功块返回 undefined 表示重放。 */
  const prepareKnowledgeChunkModel = async (cfg: NonNullable<ReturnType<typeof getAiConfig>>, runId: string, index: number): Promise<PreparedChunk | undefined> => {
    const run = knowledgeRun(runId);
    if (!run) throw new AppError(404, `提取任务不存在：${runId}`);
    const chunk = run.chunks[index];
    if (!chunk) throw new AppError(422, `块序号越界：${index}`);
    if (chunk.receipt) return undefined;
    const { chunkText, supplements, spaces, blockIds, unresolvedLinks } = chunkInputTexts(state, run, chunk);
    const input = knowledgeStructInput(run.purpose, chunk.id, chunkText, index, run.chunks.length, supplements.map((s) => ({ blockId: s.blockId, text: s.text })));
    const { value, raw } = await extractKnowledgeStructChunk(cfg, input);
    return { index, chunkId: chunk.id, batch: validateKnowledgeBatch(value, blockIds), spaces, unresolvedLinks, raw };
  };

  /** 块提交（队列内）：成功批次与壳/实体/receipt 同笔；失败/取消分别落 failed/discarded。 */
  const commitKnowledgeChunkNow = (runId: string, index: number, prepared: PreparedChunk | null, errorMsg?: string): Promise<ChunkCommitOutcome> =>
    commitState(async (latest) => {
      const run = latest.knowledge.extractionRuns.find((r) => r.id === runId);
      if (!run) throw new AppError(404, `提取任务不存在：${runId}`);
      const chunk = run.chunks[index];
      if (!chunk) throw new AppError(422, `块不存在：${runId} 第 ${index} 块`);
      const built: BuiltBatch | null = prepared
        ? buildKnowledgeBatch(latest, run, chunk, prepared.batch, prepared.spaces, prepared.unresolvedLinks)
        : null;
      const res = commitKnowledgeChunk(latest, runId, chunk.id, built, prepared?.raw, errorMsg);
      if (res.state !== latest) { await store.save(res.state); state = res.state; }
      return {
        created: res.replayed ? 0 : res.created,
        skipped: res.replayed ? 1 : 0,
        createdItems: res.replayed ? 0 : res.createdItems,
        pendingItems: res.replayed ? 0 : res.pendingItems,
        replayed: res.replayed === true, discarded: res.discarded === true,
        duplicateCandidates: res.duplicateCandidates,
      };
    });

  /** run 级状态落库（循环收尾/暂停/取消）。 */
  const settleKnowledgeRun = (runId: string, opts: { cancelled?: boolean; paused?: boolean; settled?: boolean }): Promise<ExtractionRunRecord | undefined> =>
    commitState(async (latest) => {
      const next = settleRun(latest, runId, opts);
      await store.save(next); state = next;
      return next.knowledge.extractionRuns.find((r) => r.id === runId);
    });

  /** 重试收尾：全部块已定（无 pending/failed）时把 run 状态回推为 completed，避免"最后一块重试成功却仍显示部分完成"。 */
  const settleKnowledgeRunWhenAllSettled = (runId: string): Promise<void> =>
    commitState(async (latest) => {
      const run = latest.knowledge.extractionRuns.find((r) => r.id === runId);
      if (!run) return;
      if (run.status === "cancelled" || run.status === "paused" || run.status === "interrupted") return;
      if (run.chunks.some((c) => c.status === "pending" || c.status === "failed" || c.status === "discarded")) return;
      const at = new Date().toISOString();
      const next: LocusState = {
        ...latest,
        knowledge: { ...latest.knowledge, extractionRuns: latest.knowledge.extractionRuns.map((r) => (r.id === runId ? { ...r, status: "completed" as const, updatedAt: at } : r)) },
      };
      await store.save(next); state = next;
    });

  /** 失败块单独重试（合同 §5.3）：复用冻结输入与块 ID；已成功块由 receipt 重放，不重调模型。job 在不在都可执行。 */
  const retryKnowledgeChunk = async (cfg: NonNullable<ReturnType<typeof getAiConfig>>, runId: string, index: number): Promise<ChunkCommitOutcome> => {
    const run = knowledgeRun(runId);
    if (!run) throw new AppError(404, `提取任务不存在：${runId}`);
    if (!Number.isInteger(index) || index < 0 || index >= run.chunks.length) throw new AppError(422, `块序号越界：${index}`);
    const job = knowledgeJobOf(runId);
    let prepared: PreparedChunk | null = null;
    let errorMsg: string | undefined;
    let recoverable = true;
    try {
      prepared = (await prepareKnowledgeChunkModel(cfg, runId, index)) ?? null;
    } catch (e) {
      errorMsg = (e as Error).message ?? "提取失败";
      recoverable = !(e instanceof AiError && e.fatal);
      prepared = null;
    }
    const out = await commitKnowledgeChunkNow(runId, index, prepared, errorMsg);
    await settleKnowledgeRunWhenAllSettled(runId); // 状态与块结果一致后，下面 recount 取到的是新状态
    if (job?.result) {
      if (out.replayed) pushUnique(undefined);
      if (errorMsg === undefined && !out.discarded) job.result.chunkErrors = (job.result.chunkErrors ?? []).filter((x) => x.index !== index);
      else if (errorMsg !== undefined) job.result.chunkErrors = [...(job.result.chunkErrors ?? []), { index, error: errorMsg, recoverable }];
      pushUnique(job.result.duplicateCandidates, ...out.duplicateCandidates);
      recountKnowledgeJob(runId);
      job.message = errorMsg !== undefined
        ? `第 ${index + 1} 块重试仍失败：${errorMsg}`
        : `第 ${index + 1} 块${out.replayed ? "已有回执（未重复入库）" : out.discarded ? "已丢弃（任务已取消）" : "重试成功"}`;
    }
    return out;
  };

  /** 逐块调度（队列外跑模型，队列内逐块提交）：单块失败隔离，致命错误停止后续块并保留已产出。 */
  const runKnowledgeLoop = async (cfg: NonNullable<ReturnType<typeof getAiConfig>>, runId: string): Promise<void> => {
    const signals = knowledgeSignals.get(runId)!;
    const job = knowledgeJobOf(runId)!;
    if (signals.running) return;
    signals.running = true;
    const total = knowledgeRun(runId)?.chunks.length ?? 0;
    try {
      for (let index = 0; index < total; index++) {
        const run = knowledgeRun(runId);
        const chunk = run?.chunks[index];
        if (!run || !chunk) break;
        if (chunk.receipt) continue; // 已成功块不重调模型
        if (signals.cancelling || run.status === "cancelled") break;
        if (signals.pausing) break;
        job.message = `第 ${index + 1}/${total} 块，已出 ${job.result?.created ?? 0} 张`;
        let prepared: PreparedChunk | null = null;
        let errorMsg: string | undefined;
        let recoverable = true;
        try {
          prepared = (await prepareKnowledgeChunkModel(cfg, runId, index)) ?? null;
        } catch (e) {
          errorMsg = (e as Error).message ?? "提取失败";
          recoverable = !(e instanceof AiError && e.fatal);
          prepared = null;
        }
        if (prepared) {
          const out = await commitKnowledgeChunkNow(runId, index, prepared);
          if (out.replayed) job.result!.skipped = (job.result!.skipped ?? 0) + 1;
          pushUnique(job.result!.duplicateCandidates, ...out.duplicateCandidates);
          pushUnique(job.result!.unresolvedLinks, ...prepared.unresolvedLinks);
        } else {
          await commitKnowledgeChunkNow(runId, index, null, errorMsg);
          job.result!.chunkErrors = [...(job.result!.chunkErrors ?? []), { index, error: errorMsg!, recoverable }];
          job.message = `第 ${index + 1}/${total} 块失败`;
          if (!recoverable) { signals.fatal = errorMsg!; break; }
        }
        recountKnowledgeJob(runId);
      }
    } finally {
      signals.running = false;
    }
    const cancelled = signals.cancelling || knowledgeRun(runId)?.status === "cancelled";
    const paused = !cancelled && signals.pausing;
    const settled = await settleKnowledgeRun(runId, { cancelled, paused, settled: true });
    recountKnowledgeJob(runId);
    const created = job.result?.created ?? 0;
    const failedCount = job.result?.chunkErrors?.length ?? 0;
    const tail = `（${RUN_STATUS_TEXT[settled?.status ?? "partial"]}）`;
    if (cancelled) { job.status = "done"; job.result!.cancelled = true; job.message = `已取消：保留已出 ${created} 张${tail}`; }
    else if (paused) { job.status = "paused"; job.result!.paused = true; job.message = `已暂停：已出 ${created} 张（可继续）`; }
    else if (signals.fatal) { job.status = "error"; job.error = signals.fatal; job.message = `任务中断：${signals.fatal}${tail}`; }
    else { job.status = "done"; job.message = `${settled?.status === "completed" ? "完成" : "结束"}：新增 ${created} 张待审阅读壳${failedCount ? `，${failedCount} 块失败（可逐块重试）` : ""}${tail}`; }
    if (settled?.status === "completed") knowledgeSignals.delete(runId);
  };

  /** 为持久 run 建 job 句柄并启动调度；重启后按 receipt 跳过已成功块。 */
  const startKnowledgeRun = (cfg: NonNullable<ReturnType<typeof getAiConfig>>, runId: string): string => {
    const existing = knowledgeJobByRun.get(runId);
    if (existing && jobs.get(existing)?.status === "running") return existing;
    const run = knowledgeRun(runId)!;
    const id = existing && jobs.has(existing) && knowledgeSignals.has(runId) ? existing : `job_${randomUUID()}`;
    if (!knowledgeSignals.has(runId)) knowledgeSignals.set(runId, { cancelling: false, pausing: false, running: false, fatal: null });
    const job: Job = {
      id, status: "running", done: 0, total: run.chunks.length, message: "语义提取中…",
      result: {
        paperId: run.paperRef.id, runId, created: 0, skipped: 0, createdItems: 0, pendingItems: 0,
        chunkErrors: run.chunks.map((c, i) => (c.status === "failed" ? { index: i, error: c.error ?? "提取失败", recoverable: true } : null)).filter((x): x is { index: number; error: string; recoverable: boolean } => x !== null),
        duplicateCandidates: [], unresolvedLinks: [], runStatus: run.status,
      },
    };
    jobs.set(id, job); trimJobs();
    knowledgeJobByRun.set(runId, id);
    knowledgeRuns.set(id, {
      runId,
      cancel: () => { knowledgeSignals.get(runId)!.cancelling = true; },
      pause: () => { knowledgeSignals.get(runId)!.pausing = true; },
      resume: () => { knowledgeSignals.get(runId)!.pausing = false; },
      retryChunk: (index: number) => retryKnowledgeChunk(cfg, runId, index),
    });
    void runKnowledgeLoop(cfg, runId);
    return id;
  };

  const trimJobs = () => { if (jobs.size > 20) { for (const k of jobs.keys()) { if (jobs.size <= 20) break; jobs.delete(k); } } };
  // 重启恢复（合同 §5.3）：内存 job 不能假称仍在跑——持久 run 的 running 一律标 interrupted，候选与 receipt 保留。
  {
    const interrupted = state.knowledge.extractionRuns.filter((r) => r.status === "running");
    if (interrupted.length > 0) {
      await commitState(async (latest) => {
        const at = new Date().toISOString();
        const next: LocusState = {
          ...latest,
          knowledge: {
            ...latest.knowledge,
            extractionRuns: latest.knowledge.extractionRuns.map((r) => (r.status === "running" ? { ...r, status: "interrupted" as const, updatedAt: at } : r)),
          },
        };
        await store.save(next); state = next;
      });
    }
  }

  /** 5E 对话 job：发送时冻结快照；写回前检查取消（在途请求无法中止，结果丢弃不写回）。 */
  const startChatJob = (chatId: string, messageId: string, userText: string): string => {
    const chat = state.chats.find((c) => c.id === chatId)!;
    const cfg = getAiConfig()!;
    const snapshot = chatScopeSnapshot(state, chat, userText, cfg.model);
    const input = `${snapshotInput(snapshot)}\n\n讨论历史：\n${chatHistoryInput(chat)}`;
    const id = `job_${randomUUID()}`;
    const job: Job = { id, status: "running", done: 0, total: 1, message: "上下文讨论中…" };
    jobs.set(id, job); trimJobs();
    void (async () => {
      try {
        const { value, raw } = await runTask(cfg, "context_chat", input);
        // 模型调用在队列外；写回在队列内对最新 state 合并，取消检查也在队列内做。
        let discarded = false;
        await commitState(async (latest) => {
          const cur = latest.chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId);
          if (!cur || cur.status === "cancelled") { discarded = true; return; }
          const next = applyChatResponse(latest, chatId, messageId, value, snapshot);
          await store.save(next); state = next;
        });
        if (discarded) {
          job.status = "done"; job.result = { messageId, discarded: true }; job.message = "已取消：结果丢弃，未写回"; return;
        }
        writeAudit(chatId, { raws: [{ index: 0, content: raw }], model: cfg.model }, "context_chat");
        job.status = "done"; job.result = { messageId, snapshotHash: snapshot.hash }; job.message = "完成";
      } catch (e) {
        const msg = (e as Error).message ?? "失败";
        await commitState(async (latest) => {
          const cur = latest.chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId);
          if (cur && cur.status === "running") { const next = failChat(latest, chatId, messageId, msg); await store.save(next); state = next; }
        }).catch(() => {});
        job.status = "error"; job.error = msg;
      }
    })();
    return id;
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((res, rej) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) { rej(new AppError(413, "请求体过大。")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
      req.on("error", rej);
    });

  const send = (res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") => {
    const payload = type.startsWith("application/json") ? JSON.stringify(body) : (body as string);
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(payload);
  };

  const sendBinary = (res: ServerResponse, status: number, buf: Buffer, filename: string, type: string) => {
    // 文件名须转义：CR/LF 会令 Node 拒绝写头（整个附件回取 → 500），引号会产出畸形 content-disposition。
    // 纯 ASCII 安全名保持原样（既有下载名不变）；含非 ASCII 时补 RFC 5987 filename*，并留 ASCII fallback。
    const clean = filename.replace(/[\r\n"]/g, "_");
    const disposition = /^[\x20-\x7e]*$/.test(clean)
      ? `attachment; filename="${clean}"`
      : `attachment; filename="${clean.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
    res.writeHead(status, { "content-type": type, "content-disposition": disposition, "cache-control": "no-store" });
    res.end(buf);
  };

  const serveStatic = (res: ServerResponse, urlPath: string) => {
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.replace(/^\/+/, ""));
    const target = resolve(PUBLIC_DIR, normalize(rel));
    if (!target.startsWith(PUBLIC_DIR) || !existsSync(target) || !statSync(target).isFile()) {
      send(res, 404, "Not Found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, readFileSync(target), MIME[extname(target)] ?? "application/octet-stream");
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const path = url.pathname;
      const method = req.method ?? "GET";

      // 竞赛接入：业务 API 仅接受站点代理（Edge Function）携带的服务端凭据。
      // 未配置 LOCUS_SITE_TOKEN 时不启用 → 私网/本地测试与现有测试行为不变。
      const siteToken = process.env.LOCUS_SITE_TOKEN;
      if (siteToken && path.startsWith("/api/") && req.headers["x-locus-site-token"] !== siteToken) {
        send(res, 401, { error: "未授权：业务 API 仅限站点代理调用。" }); return;
      }

      if (!path.startsWith("/api/")) { serveStatic(res, path); return; }

      if (method === "GET" && path === "/api/state") { send(res, 200, state); return; }
      if (method === "GET" && path === "/api/ai/status") { send(res, 200, describeConfig(getAiConfig())); return; }
      const repDocx = path.match(/^\/api\/reports\/([^/]+)\/export\.docx$/);
      if (method === "GET" && repDocx) {
        const rep = state.reports.find((r) => r.id === decodeURIComponent(repDocx[1]));
        if (!rep) { send(res, 404, { error: "报告不存在" }); return; }
        sendBinary(res, 200, buildReportDocx(state, rep), `report-${rep.id}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); return;
      }
      const repTrace = path.match(/^\/api\/reports\/([^/]+)\/traceability\.zip$/);
      if (method === "GET" && repTrace) {
        const t = buildTraceabilityPackage(state, decodeURIComponent(repTrace[1]));
        sendBinary(res, 200, t.buffer, `traceability-${decodeURIComponent(repTrace[1])}.zip`, "application/zip"); return;
      }
      if (method === "GET" && path === "/api/export/all.zip") {
        sendBinary(res, 200, buildWholeLibraryPackage(state), "locus-library.zip", "application/zip"); return;
      }
      if (method === "GET" && path === "/api/backtrace") {        const kind = url.searchParams.get("kind") ?? "";
        const id = url.searchParams.get("id") ?? "";
        const dir = (url.searchParams.get("dir") as "down" | "up" | "both" | null) ?? "both";
        const kinds = url.searchParams.get("edgeKinds");
        const t = traverseNetwork(state, `${kind}:${id}`, {
          direction: dir,
          edgeKinds: kinds ? (kinds.split(",") as never) : undefined,
        });
        if (!t.start) { send(res, 404, { error: `节点不存在：${kind}:${id}` }); return; }
        send(res, 200, { ok: true, start: t.start, nodes: t.nodes, edges: t.edges, downstreamByKind: t.downstreamByKind, pending: t.pending }); return;
      }
      // 上下文地图（只读；ADR-0027）：建任务前按 pick 推导 / 任务按当前选择。
      if (method === "GET" && path === "/api/analysis/map") {
        const topicId = url.searchParams.get("topicId") ?? "";
        if (!topicId) { send(res, 404, { error: "缺少 topicId。" }); return; }
        const pick = parsePicks(url.searchParams.get("pick"));
        const map = buildContextMap(state, { topicId, subquestionId: url.searchParams.get("subquestionId") ?? undefined, pick });
        send(res, 200, map); return;
      }
      const taskMap = path.match(/^\/api\/analysis\/tasks\/([^/]+)\/map$/);
      if (method === "GET" && taskMap) {
        const taskId = decodeURIComponent(taskMap[1]);
        const task = state.analysisTasks.find((t) => t.id === taskId);
        if (!task) { send(res, 404, { error: `分析任务不存在：${taskId}` }); return; }
        const map = buildContextMap(state, { topicId: task.topicId, subquestionId: task.subquestionId, taskId });
        send(res, 200, map); return;
      }
      if (method === "GET" && path.startsWith("/api/jobs/")) {
        const job = jobs.get(decodeURIComponent(path.slice("/api/jobs/".length)));
        if (!job) { send(res, 404, { error: "任务不存在" }); return; }
        send(res, 200, job);
        return;
      }
      // 持久提取任务：job 仅内存，run 落库；重启后仍可按 runId 查看块状态与 receipt（rawResponse 属审计，不默认返回）。
      const kRunGet = path.match(/^\/api\/knowledge\/runs\/([^/]+)$/);
      if (method === "GET" && kRunGet) {
        const run = knowledgeRun(decodeURIComponent(kRunGet[1]));
        if (!run) { send(res, 404, { error: `提取任务不存在：${kRunGet[1]}` }); return; }
        send(res, 200, {
          ok: true,
          run: { ...run, chunks: run.chunks.map((c) => ({ ...c, rawResponse: undefined })) },
          jobId: knowledgeJobByRun.get(run.id) ?? null,
          job: knowledgeJobOf(run.id) ?? null,
        });
        return;
      }
      // §8.1 指定版本读取：revision 必填，读不到即拒绝，绝不用最新版冒充旧版（§4.2）。
      const kItemGet = path.match(/^\/api\/knowledge\/items\/([^/]+)$/);
      if (method === "GET" && kItemGet) {
        const id = decodeURIComponent(kItemGet[1]);
        const raw = url.searchParams.get("revision");
        const env = state.knowledge.items.find((x) => x.id === id);
        if (!env) { send(res, 404, { error: `知识项不存在：${id}` }); return; }
        if (url.searchParams.get("snapshotId")) {
          const snapId = url.searchParams.get("snapshotId")!;
          const snap = state.knowledge.snapshots.find((s) => s.snapshotId === snapId);
          if (!snap) { send(res, 404, { error: `快照不存在：${snapId}`, code: "snapshot_missing" }); return; }
          if (raw === null || raw === "") { send(res, 422, { error: "读取知识项必须指定 revision（版本）。", code: "revision_required" }); return; }
          const revision = Number(raw);
          if (!Number.isInteger(revision) || revision < 1) { send(res, 422, { error: `revision 不合法：${raw}`, code: "revision_required" }); return; }
          const payload = readSnapshotKnowledge(snap, { kind: "item", id, revision });
          if (payload === null) { send(res, 404, { error: `快照 ${snapId} 内没有 ${id} 第 ${revision} 版（不退回当前库）。`, code: "revision_unavailable" }); return; }
          assertKnowledgeAccess(state, "localRead", (payload as { sourceRefs?: SourceRef[] }).sourceRefs ?? []);
          send(res, 200, { ok: true, snapshotId: snapId, id, revision, payload });
          return;
        }
        if (raw === null || raw === "") { send(res, 422, { error: "读取知识项必须指定 revision（版本）。", code: "revision_required" }); return; }
        const revision = Number(raw);
        if (!Number.isInteger(revision) || revision < 1) { send(res, 422, { error: `revision 不合法：${raw}`, code: "revision_required" }); return; }
        const payload = readKnowledgeVersion(state.knowledge, { kind: "item", id, revision });
        if (payload === null) { send(res, 404, { error: `知识项 ${id} 的第 ${revision} 版不可读（仅追加历史里没有该版本）。`, code: "revision_unavailable" }); return; }
        const topicId = url.searchParams.get("topicId");
        const p = payload as { topicIds?: string[] };
        if (topicId && !(p.topicIds ?? []).includes(topicId)) { send(res, 422, { error: `该版本不属于课题 ${topicId}。`, code: "topic_mismatch" }); return; }
        send(res, 200, { ok: true, id, revision, payload, availableRevisions: [env.revision, ...env.history.map((h) => h.revision)].sort((a, b) => a - b) });
        return;
      }
      // E6-A 容器数据接线（只读；复用 §7.1 读取路径与门槛）：返回元素/聚合/计数/同源列表与稳定 token。
      if (method === "GET" && path === "/api/knowledge/container") {
        const source = url.searchParams.get("source") === "snapshot" ? "snapshot" : "current";
        const num = (k: string) => { const v = url.searchParams.get(k); return v === null || v === "" ? undefined : Number(v); };
        const container = buildKnowledgeContainer(state, {
          source,
          topicId: url.searchParams.get("topicId") ?? undefined,
          snapshotId: url.searchParams.get("snapshotId") ?? undefined,
          themeId: url.searchParams.get("themeId") ?? undefined,
          subquestionId: url.searchParams.get("subquestionId") ?? undefined,
          text: url.searchParams.get("text") ?? undefined,
          contentType: url.searchParams.get("contentType") ?? undefined,
          nature: url.searchParams.get("nature") ?? undefined,
          sourceClass: url.searchParams.get("sourceClass") ?? undefined,
          metricId: url.searchParams.get("metricId") ?? undefined,
          condition: url.searchParams.get("condition") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          mode: url.searchParams.get("mode") === "explore" ? "explore" : "formal",
          cursor: num("cursor"),
          pageSize: num("pageSize"),
        });
        // 闭包检查：无来源项按其稳定 ID 判策略；含派生上游
        assertKnowledgeAccess(state, "localRead", container.elements.filter((e) => e.kind === "item").map((e) => e.ref));
        send(res, 200, { ok: true, ...container });
        return;
      }
      // E6-A 流水线状态（只读；计数只来自已落库回执）。
      const kPipeline = path.match(/^\/api\/knowledge\/pipeline\/([^/]+)$/);
      if (method === "GET" && kPipeline) {
        const st = knowledgePipelineStatus(state, decodeURIComponent(kPipeline[1]));
        if (!st) { send(res, 404, { error: `提取任务不存在：${kPipeline[1]}`, code: "run_missing" }); return; }
        send(res, 200, { ok: true, ...st });
        return;
      }
      // §8.1 统一读取（§7.1）：current 必须 topicId；不写 state；viewId = 内容 hash；筛选/分页。
      if (method === "GET" && path === "/api/knowledge/view") {
        const source = url.searchParams.get("source") === "snapshot" ? "snapshot" : "current";
        const num = (k: string) => { const v = url.searchParams.get(k); return v === null || v === "" ? undefined : Number(v); };
        const view = readKnowledge(state, {
          source,
          topicId: url.searchParams.get("topicId") ?? undefined,
          snapshotId: url.searchParams.get("snapshotId") ?? undefined,
          themeId: url.searchParams.get("themeId") ?? undefined,
          subquestionId: url.searchParams.get("subquestionId") ?? undefined,
          text: url.searchParams.get("text") ?? undefined,
          contentType: url.searchParams.get("contentType") ?? undefined,
          nature: url.searchParams.get("nature") ?? undefined,
          sourceClass: url.searchParams.get("sourceClass") ?? undefined,
          metricId: url.searchParams.get("metricId") ?? undefined,
          condition: url.searchParams.get("condition") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          mode: url.searchParams.get("mode") === "explore" ? "explore" : "formal",
          cursor: num("cursor"),
          pageSize: num("pageSize"),
        });
        assertKnowledgeAccess(state, "localRead", view.items.flatMap((i) => (i.payload as { sourceRefs?: SourceRef[] }).sourceRefs ?? []));
        send(res, 200, { ok: true, ...view });
        return;
      }
      // §8.1 数据集行读取：按固定表版本返回选定行列 + typed metadata；范围越界即拒（不用前 30 行摘要代替）。
      const kdsRows = path.match(/^\/api\/knowledge\/datasets\/([^/]+)\/rows$/);
      if (method === "GET" && kdsRows) {
        const raw = url.searchParams.get("revision");
        if (raw === null || raw === "") { send(res, 422, { error: "读取数据集行必须指定 revision（版本）。", code: "revision_required" }); return; }
        const revision = Number(raw);
        if (!Number.isInteger(revision) || revision < 1) { send(res, 422, { error: `revision 不合法：${raw}`, code: "revision_required" }); return; }
        const snapId = url.searchParams.get("snapshotId");
        if (snapId) {
          const snap = state.knowledge.snapshots.find((s) => s.snapshotId === snapId);
          if (!snap) { send(res, 404, { error: `快照不存在：${snapId}`, code: "snapshot_missing" }); return; }
          const out = readSnapshotDatasetRows(snap, decodeURIComponent(kdsRows[1]), revision);
          assertKnowledgeAccess(state, "localRead", [out.sourceRef]);
          send(res, 200, { ok: true, snapshotId: snapId, ...out, hasMore: false, nextCursor: null, totalKnown: out.rows.length });
          return;
        }
        const parseIdx = (k: string): number[] | undefined => {
          const v = url.searchParams.get(k);
          return v === null || v === "" ? undefined : v.split(",").filter((s) => s.trim() !== "").map((s) => Number(s));
        };
        const out = readDatasetRows(state, decodeURIComponent(kdsRows[1]), {
          revision, rowIndices: parseIdx("rowIndices"), columnIndices: parseIdx("columnIndices"),
          cursor: Number(url.searchParams.get("cursor") ?? 0) || 0, pageSize: Number(url.searchParams.get("pageSize") ?? 0) || undefined,
        });
        send(res, 200, { ok: true, ...out });
        return;
      }
      // §8.1 快照：GET 返回 manifest 与固定内容（不重新生成）；export 由同一快照导出并复检 §7.5。
      const ksnapGet = path.match(/^\/api\/knowledge\/snapshots\/([^/]+)$/);
      if (method === "GET" && ksnapGet) {
        const snap = state.knowledge.snapshots.find((s) => s.snapshotId === decodeURIComponent(ksnapGet[1]));
        if (!snap) { send(res, 404, { error: `快照不存在：${ksnapGet[1]}`, code: "snapshot_missing" }); return; }
        assertKnowledgeAccess(state, "localRead", snap.sourceVersionRefs);
        send(res, 200, { ok: true, snapshot: { snapshotId: snap.snapshotId, createdAt: snap.createdAt, schemaVersion: snap.schemaVersion, projectionVersion: snap.projectionVersion, mode: snap.mode, scope: snap.scope, contentHash: snap.contentHash, coverage: snap.coverage, excluded: snap.excluded, sourceVersionRefs: snap.sourceVersionRefs, mappingRefs: snap.mappingRefs, content: snap.content } });
        return;
      }
      const ksnapExport = path.match(/^\/api\/knowledge\/snapshots\/([^/]+)\/export$/);
      if (method === "GET" && ksnapExport) {
        const snap = state.knowledge.snapshots.find((s) => s.snapshotId === decodeURIComponent(ksnapExport[1]));
        if (!snap) { send(res, 404, { error: `快照不存在：${ksnapExport[1]}`, code: "snapshot_missing" }); return; }
        assertKnowledgeAccess(state, "export", snapshotAccessRefs(snap));
        const format = (url.searchParams.get("format") ?? "zip") as "zip" | "json" | "wiki" | "csv";
        if (!["zip", "json", "wiki", "csv"].includes(format)) { send(res, 422, { error: `不支持的导出格式：${format}`, code: "format_invalid" }); return; }
        const datasetId = url.searchParams.get("datasetId") ?? undefined;
        const comparisonId = url.searchParams.get("comparisonId") ?? undefined;
        if (format === "csv" && (!!datasetId === !!comparisonId)) { send(res, 422, { error: "CSV 导出须在 datasetId 与 comparisonId 中二选一。", code: "csv_target_required" }); return; }
        const variant = url.searchParams.get("variant") === "sheet-safe" ? "sheet-safe" : "machine";
        const out = exportKnowledge(snap, { format, datasetId, comparisonId, variant });
        const buf = Buffer.isBuffer(out.data) ? out.data : Buffer.from(out.data, "utf8");
        sendBinary(res, 200, buf, out.filename, out.contentType);
        return;
      }
      const kRefToken = path.match(/^\/api\/knowledge\/references\/([^/]+)$/);
      if (method === "GET" && kRefToken) {
        const snapId = url.searchParams.get("snapshotId");
        if (!snapId) { send(res, 422, { error: "读取快照引用必须指定 snapshotId。", code: "snapshot_required" }); return; }
        const snap = state.knowledge.snapshots.find((s) => s.snapshotId === snapId);
        if (!snap) { send(res, 404, { error: `快照不存在：${snapId}`, code: "snapshot_missing" }); return; }
        const hit = resolveSnapshotToken(snap, decodeURIComponent(kRefToken[1]));
        if (!hit) { send(res, 404, { error: `快照内没有该 token：${kRefToken[1]}`, code: "token_missing" }); return; }
        if (hit.kind === "source") {
          const ref = hit.ref as SourceRef;
          assertKnowledgeAccess(state, "localRead", [ref]);
          const resv = resolveSourceVersion(state, state.knowledge, ref);
          if (resv.status !== "ok") { send(res, 410, { error: `该来源版本不可用：${resv.status}`, code: resv.status, token: kRefToken[1], ref }); return; }
          send(res, 200, { ok: true, snapshotId: snapId, token: kRefToken[1], kind: hit.kind, ref, label: hit.label, payload: resv.payload });
          return;
        }
        const ref = hit.ref as import("./domain/knowledge.ts").KnowledgeRef;
        const payload = readSnapshotKnowledge(snap, ref);
        assertKnowledgeAccess(state, "localRead", payload ? ((payload as { sourceRefs?: SourceRef[] }).sourceRefs ?? []) : []);
        if (payload === null) { send(res, 410, { error: "该 token 指向的快照对象不可读。", code: "history_unavailable", token: kRefToken[1], ref }); return; }
        send(res, 200, { ok: true, snapshotId: snapId, token: kRefToken[1], kind: hit.kind, ref, label: hit.label, payload });
        return;
      }
      if (method === "DELETE" && path === "/api/ai/config") {
        clearAiConfig();
        if (aiConfigPath) removeAiConfigFile(aiConfigPath);
        send(res, 200, describeConfig(getAiConfig()));
        return;
      }      if (method === "GET" && path.startsWith("/api/source/")) {
        send(res, 200, sourceView(state, decodeURIComponent(path.slice("/api/source/".length))));
        return;
      }
      // 二进制原件回取：按 M OriginalStore 标识取回原字节（校验 hash 一致），附原文件名与 media type。
      const origGet = path.match(/^\/api\/originals\/([^/]+)$/);
      if (method === "GET" && origGet) {
        const id = decodeURIComponent(origGet[1]);
        if (!originals.has(id)) { send(res, 404, { error: `原件不存在：${id}` }); return; }
        const meta = originals.meta(id);
        const bytes = originals.retrieve(id);
        sendBinary(res, 200, Buffer.from(bytes), meta.fileName, meta.mediaTypeGuess);
        return;
      }
      const tmplCheck = path.match(/^\/api\/templates\/([^/]+)\/check$/);
      if (method === "GET" && tmplCheck) {
        send(res, 200, templateProtocolCheck(state, decodeURIComponent(tmplCheck[1])));
        return;
      }

      if (method === "POST") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

        if (path === "/api/ai/config") {
          const ok = setAiConfig({ baseUrl: body.baseUrl, model: body.model, key: body.key, timeoutMs: body.timeoutMs });
          if (!ok) { send(res, 400, { error: "AI 配置不完整：需要 baseUrl / model / key。" }); return; }
          const cfg = getAiConfig()!;
          if (aiConfigPath) saveAiConfigFile(aiConfigPath, cfg); // 落盘：重启后仍可用；文件在本机数据目录，不入库
          send(res, 200, describeConfig(cfg));
          return;
        }
        if (path === "/api/topics") {
          const r = createTopic(state, { name: String(body.name ?? ""), researchQuestion: String(body.researchQuestion ?? "") });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, topicId: r.topic.id });
          return;
        }
        const subMatch = path.match(/^\/api\/topics\/([^/]+)\/subquestions$/);
        if (subMatch) {
          const r = createSubquestion(state, { topicId: decodeURIComponent(subMatch[1]), question: String(body.question ?? ""), kind: body.kind as "declared" | "exploratory" | undefined });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, subquestionId: r.subquestion.id });
          return;
        }
        // ── 文献整理（5A/5C）：条目/附件管理，不触发强制解析 ──
        if (path === "/api/papers") {
          const r = createPaper(state, {
            title: String(body.title ?? ""), authors: body.authors as string[] | string | undefined,
            year: body.year as string | undefined, doi: body.doi as string | undefined,
            source: body.source as string | undefined, license: body.license as string | undefined,
            topicIds: body.topicIds as string[] | undefined, note: body.note as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, paperId: r.paper.id });
          return;
        }
        if (path === "/api/papers/import-bibliography") {
          const fmt = body.format === "csl-json" ? "csl-json" : "bibtex";
          const r = importBibliography(state, { format: fmt, text: String(body.text ?? "") });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, created: r.created.map((p) => p.id), skipped: r.skipped });
          return;
        }
        const paperUpd = path.match(/^\/api\/papers\/([^/]+)\/update$/);
        if (paperUpd) {
          const r = updatePaper(state, decodeURIComponent(paperUpd[1]), body as Parameters<typeof updatePaper>[2]);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, paperId: r.paper.id, revision: r.paper.revision });
          return;
        }
        const paperAtt = path.match(/^\/api\/papers\/([^/]+)\/attachments$/);
        if (paperAtt) {
          const r = addPaperAttachment(state, {
            paperId: decodeURIComponent(paperAtt[1]), name: String(body.name ?? ""), text: String(body.text ?? ""),
            role: body.role as "fulltext" | "supplement" | "other" | undefined, version: body.version as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, attachmentId: r.attachment.id, assetId: r.assetId });
          return;
        }
        const paperTopic = path.match(/^\/api\/papers\/([^/]+)\/topics$/);
        if (paperTopic) {
          const r = linkPaperTopic(state, decodeURIComponent(paperTopic[1]), String(body.topicId ?? ""), body.link !== false);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, topicIds: r.paper.topicIds });
          return;
        }
        // ── 领域知识积累（合同 §6）：显式附件＋研究目的 → 固定 run 输入 → 逐块结构化入库（新壳＋实体同笔）──
        if (path === "/api/knowledge/jobs") {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 400, { error: "未配置 AI：请在页面「AI 配置」填写 baseUrl / 模型 / Key。" }); return; }
          const input: KnowledgeRunInput = {
            paperId: String(body.paperId ?? ""),
            attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map((x) => String(x)) : (body.attachmentIds as never),
            purpose: String(body.purpose ?? ""),
            topicId: body.topicId ? String(body.topicId) : undefined,
            subquestionId: body.subquestionId ? String(body.subquestionId) : undefined,
            idempotencyKey: String(body.idempotencyKey ?? ""),
          };
          // 校验先于落库与模型调用：非法输入不建 run、不产生知识、不调模型（T06）。
          const { run: fresh, assets, inputHash } = prepareKnowledgeRun(state, input);
          const sameKey = state.knowledge.extractionRuns.filter((r) => r.idempotencyKey === fresh.idempotencyKey);
          const replay = sameKey.find((r) => r.inputHash === inputHash);
          if (replay) {
            // 同键同输入：返回既有 run，不新建、不重调模型（§6.3）；未跑完由「继续」显式续跑。
            send(res, 200, { ok: true, replayed: true, jobId: knowledgeJobByRun.get(replay.id) ?? null, runId: replay.id, total: replay.chunks.length, runStatus: replay.status });
            return;
          }
          if (sameKey.length > 0) {
            send(res, 409, { error: "幂等键已被不同输入使用（附件、目的或来源版本已变化）。请复用原任务或换新幂等键。", code: "idempotency_conflict" });
            return;
          }
          // 纳管固定来源：论文条目＋各选定附件原件，首次引用保存基线（§5.2）。
          let k = state.knowledge;
          const toArchive: [SourceKind, string][] = [["paper", fresh.paperRef.id], ...assets.map((a) => ["asset", a.id] as [SourceKind, string])];
          for (const [kind, srcId] of toArchive) {
            const ensured = ensureArchived(state, k, kind, srcId);
            if (!ensured) { send(res, 404, { error: `来源不存在：${kind} ${srcId}` }); return; }
            k = ensured.knowledge;
          }
          const withRun: LocusState = { ...state, knowledge: { ...k, extractionRuns: [...k.extractionRuns, fresh] } };
          await store.save(withRun); state = withRun;
          const jobId = startKnowledgeRun(cfg, fresh.id);
          send(res, 202, { ok: true, jobId, runId: fresh.id, total: fresh.chunks.length, inputHash, runStatus: fresh.status });
          return;
        }
        const kjAction = path.match(/^\/api\/knowledge\/jobs\/([^/]+)\/(cancel|pause|resume)$/);
        if (kjAction) {
          const runId = resolveKnowledgeRunId(decodeURIComponent(kjAction[1]), body.runId);
          if (!runId) { send(res, 404, { error: "该抽取任务不在运行，也没有对应的持久记录（可能已完成或已清理）。" }); return; }
          const action = kjAction[2];
          const ctl = knowledgeRuns.get(knowledgeJobByRun.get(runId) ?? "");
          if (action === "cancel") {
            ctl?.cancel();
            const next = settleRun(state, runId, { cancelled: true });
            await store.save(next); state = next;
            recountKnowledgeJob(runId);
            const job = knowledgeJobOf(runId);
            if (job && !knowledgeSignals.get(runId)?.running) {
              job.status = "done"; job.result = { ...job.result, cancelled: true };
              job.message = `已取消：保留已出 ${job.result?.created ?? 0} 张（${RUN_STATUS_TEXT.cancelled}）`;
            }
            send(res, 200, { ok: true, runId, runStatus: next.knowledge.extractionRuns.find((r) => r.id === runId)!.status });
            return;
          }
          if (action === "pause") {
            if (knowledgeSignals.get(runId)?.running) {
              ctl?.pause();
              send(res, 200, { ok: true, runId, runStatus: knowledgeRun(runId)!.status, pending: true, message: "已请求暂停：在途块完成后停止" });
              return;
            }
            const next = settleRun(state, runId, { paused: true, settled: false });
            await store.save(next); state = next;
            recountKnowledgeJob(runId);
            const st = next.knowledge.extractionRuns.find((r) => r.id === runId)!.status;
            send(res, 200, { ok: true, runId, runStatus: st });
            return;
          }
          const cfg = getAiConfig();
          if (!cfg) { send(res, 400, { error: "未配置 AI：无法继续抽取。" }); return; }
          ctl?.resume();
          const next = settleRun(state, runId, { settled: false });
          await store.save(next); state = next;
          const resumed = next.knowledge.extractionRuns.find((r) => r.id === runId)!;
          if (resumed.status === "running") {
            const jobId = startKnowledgeRun(cfg, runId);
            send(res, 200, { ok: true, jobId, runId, runStatus: resumed.status, total: resumed.chunks.length });
            return;
          }
          recountKnowledgeJob(runId);
          send(res, 200, { ok: true, runId, runStatus: resumed.status });
          return;
        }
        const kjRetry = path.match(/^\/api\/knowledge\/jobs\/([^/]+)\/retry-chunk$/);
        if (kjRetry) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 400, { error: "未配置 AI：无法重试该块。" }); return; }
          const runId = resolveKnowledgeRunId(decodeURIComponent(kjRetry[1]), body.runId);
          if (!runId) { send(res, 404, { error: "该抽取任务没有对应的持久记录，无法重试该块。" }); return; }
          const out = await retryKnowledgeChunk(cfg, runId, Number(body.index));
          send(res, 200, { ok: true, runId, ...out });
          return;
        }
        // ── E3 分项人审（§8.1）：内容修订与审核分开；过期编辑 409，夹带生命周期字段 422 ──
        const kiUpdate = path.match(/^\/api\/knowledge\/items\/([^/]+)\/update$/);
        if (kiUpdate) {
          const r = updateKnowledgeItem(state, decodeURIComponent(kiUpdate[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, id: r.item.id, revision: r.item.revision, review: r.item.payload.review.status, scientific: r.scientific });
          return;
        }
        const kiReview = path.match(/^\/api\/knowledge\/items\/([^/]+)\/review$/);
        if (kiReview) {
          const r = reviewKnowledgeItem(state, decodeURIComponent(kiReview[1]), body);
          await store.save(r.state); state = r.state;
          const card = r.state.cards.find((c) => c.id === r.item.payload.cardId);
          send(res, 200, { ok: true, id: r.item.id, revision: r.item.revision, review: r.item.payload.review.status, cardAudit: card?.audit ?? null });
          return;
        }
        const kcUpdate = path.match(/^\/api\/knowledge\/contexts\/([^/]+)\/update$/);
        if (kcUpdate) {
          const r = updateKnowledgeContext(state, decodeURIComponent(kcUpdate[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, id: r.context.id, revision: r.context.revision, review: r.context.payload.review.status, scientific: r.scientific, affectedItems: r.affectedItems });
          return;
        }
        const kcReview = path.match(/^\/api\/knowledge\/contexts\/([^/]+)\/review$/);
        if (kcReview) {
          const r = reviewKnowledgeContext(state, decodeURIComponent(kcReview[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, id: r.context.id, revision: r.context.revision, review: r.context.payload.review.status, pendingConditions: r.pendingConditions, affectedItems: r.affectedItems });
          return;
        }
        const keResolve = path.match(/^\/api\/knowledge\/evidence\/([^/]+)\/resolve$/);
        if (keResolve) {
          const r = resolveKnowledgeEvidence(state, decodeURIComponent(keResolve[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, id: r.evidence.id, revision: r.evidence.revision, locationStatus: r.locationStatus, candidateOffsets: r.candidateOffsets });
          return;
        }
        const kStructure = path.match(/^\/api\/knowledge\/cards\/([^/]+)\/structure$/);
        if (kStructure) {
          const r = structureLegacyCard(state, decodeURIComponent(kStructure[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, cardId: r.card.id, cardRevision: r.card.revision, audit: r.card.audit, itemIds: r.itemIds, contextIds: r.contextIds, evidenceIds: r.evidenceIds });
          return;
        }
        // ── E4 数据集／映射／比较（§8.1）：只编辑含义与绑定，不改原表数值；固定版本引用 ──
        if (path === "/api/knowledge/datasets") {
          const r = createKnowledgeDataset(state, body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, datasetId: r.dataset.id, revision: r.dataset.revision });
          return;
        }
        const kdsUpdate = path.match(/^\/api\/knowledge\/datasets\/([^/]+)\/update$/);
        if (kdsUpdate) {
          const r = updateKnowledgeDataset(state, decodeURIComponent(kdsUpdate[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, datasetId: r.dataset.id, revision: r.dataset.revision });
          return;
        }
        const kdsReview = path.match(/^\/api\/knowledge\/datasets\/([^/]+)\/review$/);
        if (kdsReview) {
          const r = reviewKnowledgeDataset(state, decodeURIComponent(kdsReview[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, datasetId: r.dataset.id, revision: r.dataset.revision, review: r.dataset.payload.review.status });
          return;
        }
        if (path === "/api/knowledge/mappings") {
          const r = createKnowledgeMapping(state, body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, mappingId: r.mapping.id, revision: r.mapping.revision, review: r.mapping.payload.review.status });
          return;
        }
        const kmUpdate = path.match(/^\/api\/knowledge\/mappings\/([^/]+)\/update$/);
        if (kmUpdate) {
          const r = updateKnowledgeMapping(state, decodeURIComponent(kmUpdate[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, mappingId: r.mapping.id, revision: r.mapping.revision, review: r.mapping.payload.review.status });
          return;
        }
        const kmReview = path.match(/^\/api\/knowledge\/mappings\/([^/]+)\/review$/);
        if (kmReview) {
          const r = reviewKnowledgeMapping(state, decodeURIComponent(kmReview[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, mappingId: r.mapping.id, revision: r.mapping.revision, review: r.mapping.payload.review.status });
          return;
        }
        if (path === "/api/knowledge/comparisons") {
          const r = createKnowledgeComparison(state, body);
          await store.save(r.state); state = r.state;
          send(res, 200, {
            ok: true, comparisonId: r.comparison.id, revision: r.comparison.revision,
            decision: r.decision, reasonCodes: r.reasonCodes,
            computedValue: r.comparison.payload.computedValue, formatting: r.comparison.payload.formatting,
          });
          return;
        }
        if (path === "/api/knowledge/snapshots") {
          const r = freezeKnowledge(state, body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, snapshotId: r.snapshot.snapshotId, contentHash: r.snapshot.contentHash, mode: r.snapshot.mode, coverage: r.snapshot.coverage, excluded: r.snapshot.excluded.length, dataReady: true });
          return;
        }
        if (path === "/api/knowledge/source-policies") {
          const r = upsertSourcePolicy(state, body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, policyId: r.policy.id, revision: r.policy.revision, allowLocalRead: r.policy.allowLocalRead, allowExport: r.policy.allowExport, allowAiSend: r.policy.allowAiSend });
          return;
        }
        if (path === "/api/knowledge/themes") {
          const r = createKnowledgeTheme(state, body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, id: r.theme.id, revision: r.theme.revision, members: r.theme.payload.members.length });
          return;
        }
        const kThemeUpdate = path.match(/^\/api\/knowledge\/themes\/([^/]+)\/update$/);
        if (kThemeUpdate) {
          const r = updateKnowledgeTheme(state, decodeURIComponent(kThemeUpdate[1]), body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, id: r.theme.id, revision: r.theme.revision, members: r.theme.payload.members.length, currentJudgmentRefs: r.theme.payload.currentJudgmentRefs.length });
          return;
        }
        if (path === "/api/knowledge/statements") {
          const r = createKnowledgeStatement(state, body);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, id: r.item.id, revision: r.item.revision, review: r.item.payload.review.status, nature: r.item.payload.nature });
          return;
        }
        if (path === "/api/import/file") {
          const name = String(body.name ?? "").trim();
          if (!name) { send(res, 422, { error: "缺少文件名。" }); return; }
          const rawB64 = String(body.dataBase64 ?? "");
          const b64 = rawB64.startsWith("data:") && rawB64.includes(",") ? rawB64.slice(rawB64.indexOf(",") + 1) : rawB64;
          if (!b64) { send(res, 422, { error: "缺少文件内容（dataBase64）。" }); return; }
          const bytes = new Uint8Array(Buffer.from(b64, "base64"));
          if (bytes.length === 0) { send(res, 422, { error: "文件内容为空或不是合法 base64。" }); return; }
          // 先用内存字节判定格式：不支持的格式在落盘前拒绝，避免留下无引用的孤儿原件。
          let parsed = await parseBytes(bytes, name);
          if (parsed.status === "unsupported") {
            send(res, 422, { error: parsed.unknowns.map((u) => u.message).join("；") || "不支持的格式。", parse: { status: parsed.status, format: parsed.format } });
            return;
          }
          // XLSX 默认规则（工作表人工选择后置）：取首个「可见且非空」的工作表解析；无则退回首个可见表。
          if (parsed.format === "xlsx" && parsed.tables.length === 0) {
            const sheets = parsed.sheets ?? (await listWorkbookSheets(bytes));
            const pick = sheets.find((s) => s.state === "visible" && !s.isEmpty) ?? sheets.find((s) => s.state === "visible") ?? sheets[0];
            if (pick) parsed = await parseBytes(bytes, name, { sheet: pick.name });
          }
          const saved = originals.save(bytes, name); // 超限抛 ImportError(original_too_large)，去重按原始字节 hash
          const parsedWithSource = { ...parsed, sourceId: saved.id };
          const kind = body.kind === "literature" || body.kind === "measurement" || body.kind === "protocol" ? body.kind as "literature" | "measurement" | "protocol" : binaryAssetKind(parsedWithSource.format, name);
          const paperId = typeof body.paperId === "string" && body.paperId ? body.paperId : undefined;
          const asset = makeBinaryAsset({
            kind, name, originalId: saved.id, mediaType: saved.mediaTypeGuess, byteLength: saved.byteLength,
            hash: saved.hash, summary: parsedSummaryText(parsedWithSource), topicId: body.topicId as string | undefined,
          });
          const outcome = importParsedFile(state, asset, parsedWithSource, { topicId: body.topicId as string | undefined, paperId });
          await store.save(outcome.state); state = outcome.state;
          send(res, 200, {
            ok: true, assetId: asset.id, originalId: saved.id, kind,
            parse: { status: outcome.status, format: outcome.format, warnings: outcome.warnings, unknowns: outcome.unknowns },
            created: outcome.created,
          });
          return;
        }
        if (path === "/api/import/literature") {
          const mode = (body.mode as "draft" | "ai") ?? "draft";
          const input = { name: String(body.name ?? ""), text: String(body.text ?? ""), mode, topicId: body.topicId as string | undefined };
          if (mode === "ai") {
            const cfg = getAiConfig();
            if (!cfg) { send(res, 400, { error: "未配置 AI：请在页面「AI 配置」填写 baseUrl / 模型 / Key。" }); return; }
            // 第一阶段同步完成：校验/查重早拒；AI 计算与 state 写回分离，
            // 完成时对**最新** state 只追加本 job 的新实体，不覆盖等待期编辑。
            const { asset } = prepareLiterature(state, input);
            const id = `job_${randomUUID()}`;
            const job: Job = { id, status: "running", done: 0, total: 0, message: "处理中…" };
            jobs.set(id, job); trimJobs();
            void (async () => {
              try {
                const result = await extractLiterature(cfg, asset.text, (done, total) => { job.done = done; job.total = total; job.message = `第 ${done}/${total} 块`; });
                const cards = mapAiLiteratureCards(asset, result.cards);
                const audit = { raws: result.raws, model: cfg.model };
                try {
                  await commitState(async (latest) => {
                    const r = applyLiterature(latest, asset, cards, input.topicId, audit);
                    await store.save(r.state); state = r.state;
                    writeAudit(asset.id, audit);
                    job.status = "done"; job.result = { assetId: asset.id, created: r.created, reminder: r.reminder }; job.message = "完成";
                  });
                } catch (e) {
                  if (e instanceof AppError && e.status === 409) {
                    // 等待期间同内容已从别路入库：丢弃本次结果，不产生重复原件
                    job.status = "done"; job.result = { assetId: (e.details?.existingAssetId as string) ?? undefined, discarded: true }; job.message = "等待期间同内容已入库，本次 AI 结果已丢弃（未重复入库）。";
                  } else throw e;
                }
              } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
            })();
            send(res, 202, { ok: true, jobId: id });
            return;
          }
          const r = await importLiterature(state, input, getAiConfig());
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, created: r.created, assetId: r.asset.id, mode: "draft", reminder: r.reminder });
          return;
        }
        if (path === "/api/import/measurements") {
          const hr = body.headerRows;
          const pf = body.profile;
          const r = importMeasurements(state, { name: String(body.name ?? ""), csv: String(body.csv ?? ""), topicId: body.topicId as string | undefined, headerRows: hr === 1 || hr === 2 ? hr : "auto", profile: pf === "plain-table" || pf === "enzymeML-blocks" ? pf : "auto" });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, created: r.created, tableCount: state.tables.filter((t) => t.assetId === r.asset.id).length, assetId: r.asset.id });
          return;
        }
        const cardMatch = path.match(/^\/api\/cards\/([^/]+)\/review$/);
        if (cardMatch) {
          const next = reviewCard(state, decodeURIComponent(cardMatch[1]), {
            audit: body.audit as never,
            importance: (body.importance ?? undefined) as never,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
            rawText: body.rawText as string | undefined,
            secondaryCitation: body.secondaryCitation as boolean | undefined,
            extracted: body.extracted as never,
          });
          await store.save(next); state = next; send(res, 200, { ok: true }); return;
        }
        if (path === "/api/cards") {
          const r = addManualCard(state, {
            assetId: String(body.assetId ?? ""),
            rawText: String(body.rawText ?? ""),
            sectionQuote: body.sectionQuote as string | undefined,
            fields: body.fields as Record<string, string> | undefined,
            units: body.units as string[] | undefined,
            conditions: body.conditions as string[] | undefined,
            unknowns: body.unknowns as string[] | undefined,
            secondaryCitation: body.secondaryCitation === true,
            reason: body.reason as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, cardId: r.card.id }); return;
        }
        if (path === "/api/cards/batch-preview") {
          send(res, 200, batchPreview(state, (body.ids as string[]) ?? [])); return;
        }
        if (path === "/api/cards/batch-confirm") {
          const next = batchConfirm(state, (body.ids as string[]) ?? [], body.ack === true);
          await store.save(next); state = next; send(res, 200, { ok: true }); return;
        }
        if (path === "/api/adoptions") {
          const r = upsertAdoption(state, {
            cardId: String(body.cardId ?? ""),
            subquestionId: String(body.subquestionId ?? ""),
            decision: body.decision as "adopt" | "exclude",
            reason: body.reason as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, adoptionId: r.adoption.id }); return;
        }
        if (path === "/api/mappings") {
          const r = createMapping(state, {
            original: String(body.original ?? ""),
            mapped: String(body.mapped ?? ""),
            basis: String(body.basis ?? ""),
            topicId: body.topicId as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, mappingId: r.mapping.id }); return;
        }
        if (path === "/api/comparisons") {
          const r = createComparison(state, {
            topicId: String(body.topicId ?? ""),
            subquestionId: body.subquestionId as string | undefined,
            cardIds: (body.cardIds as string[]) ?? [],
            filters: body.filters as string[] | undefined,
            conversions: body.conversions as string[] | undefined,
            exclusions: body.exclusions as string[] | undefined,
            note: body.note as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, comparisonId: r.comparison.id }); return;
        }
        const tblMatch = path.match(/^\/api\/tables\/([^/]+)\/review$/);
        if (tblMatch) {
          const tableId = decodeURIComponent(tblMatch[1]);
          const before = state.tables.find((t) => t.id === tableId);
          let next = reviewTable(state, tableId, {
            columnUpdates: body.columnUpdates as never,
            cellUpdates: body.cellUpdates as never,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
          });
          const after = next.tables.find((t) => t.id === tableId);
          // 表格数值修订 → 登记影响分析（确定性部分无；AI 语义评估待跑）。课题经原件取。
          const tableTopic = after ? next.assets.find((a) => a.id === after.assetId)?.topicId : undefined;
          if (before && after && after.revision > before.revision && tableTopic) {
            next = registerImpact(next, {
              topicId: tableTopic,
              change: { entityKind: "table", entityId: tableId, revision: after.revision, summary: `表格修订 r${after.revision}` },
              aiConfigured: getAiConfig() !== null,
            }).state;
          }
          await store.save(next); state = next; send(res, 200, { ok: true }); return;
        }

        // ── 4C：方案 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR ──
        if (path === "/api/protocols") {
          const r = createProtocol(state, {
            topicId: String(body.topicId ?? ""),
            name: String(body.name ?? ""),
            sourceKind: body.sourceKind as "user" | "reconstructed" | "ai-draft" | undefined,
            sourceAssetId: body.sourceAssetId as string | undefined,
            purpose: body.purpose as string | undefined,
            inputs: body.inputs as string[] | undefined,
            steps: (body.steps as never[]) ?? [],
            conditions: body.conditions as string[] | undefined,
            criteria: body.criteria as string | undefined,
            unknowns: body.unknowns as string[] | undefined,
            sourceFragments: body.sourceFragments as string[] | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, protocolId: r.protocol.id }); return;
        }
        // 5D：上传方案原件直接归档为 protocol 类（不进文献候选库），随后走方案解析。
        if (path === "/api/protocols/upload") {
          const r = uploadProtocolSource(state, { name: String(body.name ?? ""), text: String(body.text ?? ""), topicId: body.topicId as string | undefined });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, assetId: r.asset.id }); return;
        }
        if (path === "/api/protocols/parse") {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法解析方案。原件已归档的可稍后解析；也可先手工创建方案。" }); return; }
          const assetId = String(body.assetId ?? "");
          const asset = state.assets.find((a) => a.id === assetId);
          if (!asset) { send(res, 404, { error: `原件不存在：${assetId}` }); return; }
          // 从论文方法重构须标明不是作者原始方案；reconstructed 仅接受文献类原件。
          const sourceKind = body.sourceKind === "reconstructed" ? "reconstructed" : "ai-draft";
          if (sourceKind === "reconstructed" && asset.kind !== "literature") { send(res, 422, { error: "重构来源须为文献/论文附件原件。" }); return; }
          const topicId = String(body.topicId ?? asset.topicId ?? "");
          const name = String(body.name ?? `${asset.name} · 方案草稿`);
          if (parsingAssets.has(assetId)) { send(res, 409, { error: "该原件已有方案解析任务在运行，请等待完成，勿重复提交。" }); return; }
          parsingAssets.add(assetId);
          const id = `job_${randomUUID()}`;
          const job: Job = { id, status: "running", done: 0, total: 1, message: "方案解析中…" };
          jobs.set(id, job); trimJobs();
          void (async () => {
            try {
              const { value, raw } = await runTask(cfg, "protocol_parse", asset.text.slice(0, 12000));
              const draft = protocolDraftFromAi(value, assetId);
              await commitState(async (latest) => {
                const r = createProtocol(latest, { topicId, name, sourceKind, sourceAssetId: assetId, ...draft });
                await store.save(r.state); state = r.state;
                writeAudit(assetId, { raws: [{ index: 0, content: raw }], model: cfg.model }, "protocol_parse");
                job.status = "done"; job.result = { protocolId: r.protocol.id, assetId }; job.message = "完成";
              });
            } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
            finally { parsingAssets.delete(assetId); }
          })();
          send(res, 202, { ok: true, jobId: id }); return;
        }
        const protoEdit = path.match(/^\/api\/protocols\/([^/]+)\/edit$/);
        if (protoEdit) {
          const r = editProtocol(state, decodeURIComponent(protoEdit[1]), {
            name: body.name as string | undefined,
            purpose: body.purpose as string | undefined,
            inputs: body.inputs as string[] | undefined,
            steps: body.steps as never,
            conditions: body.conditions as string[] | undefined,
            criteria: body.criteria as string | undefined,
            unknowns: body.unknowns as string[] | undefined,
            sourceFragments: body.sourceFragments as string[] | undefined,
            reason: String(body.reason ?? ""),
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, revision: r.protocol.revision }); return;
        }
        if (path === "/api/templates") {
          const r = createTemplate(state, {
            protocolId: String(body.protocolId ?? ""),
            protocolRevision: typeof body.protocolRevision === "number" ? body.protocolRevision : undefined,
            fields: body.fields as string[] | undefined,
            aiDraft: body.aiDraft === true,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, templateId: r.template.id }); return;
        }
        const tmplConfirm = path.match(/^\/api\/templates\/([^/]+)\/confirm$/);
        if (tmplConfirm) {
          const r = confirmTemplate(state, decodeURIComponent(tmplConfirm[1]), body.fields as string[] | undefined);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        if (path === "/api/executions") {
          const r = startExecution(state, {
            topicId: String(body.topicId ?? ""),
            protocolId: String(body.protocolId ?? ""),
            protocolRevision: typeof body.protocolRevision === "number" ? body.protocolRevision : undefined,
            templateId: body.templateId as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, executionId: r.execution.id }); return;
        }
        // ── 5D：执行准备稿 → 确认快照 → 另存新方案 ──
        const execPrep = path.match(/^\/api\/executions\/([^/]+)\/preparation$/);
        if (execPrep) {
          const r = updatePreparation(state, decodeURIComponent(execPrep[1]), {
            adjustments: body.adjustments as never,
            notes: body.notes as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, adjustments: r.execution.preparation?.adjustments.length ?? 0 }); return;
        }
        const execConfirm = path.match(/^\/api\/executions\/([^/]+)\/confirm-preparation$/);
        if (execConfirm) {
          const r = confirmPreparation(state, decodeURIComponent(execConfirm[1]));
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, impactId: r.impactId, confirmedAt: r.execution.preparation?.confirmedAt }); return;
        }
        const execSaveAs = path.match(/^\/api\/executions\/([^/]+)\/save-as-protocol$/);
        if (execSaveAs) {
          const r = saveExecutionAsProtocol(state, decodeURIComponent(execSaveAs[1]), { name: String(body.name ?? "") });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, protocolId: r.protocol.id }); return;
        }
        const execEvents = path.match(/^\/api\/executions\/([^/]+)\/events$/);
        if (execEvents) {
          const r = appendEvent(state, decodeURIComponent(execEvents[1]), {
            kind: body.kind as never,
            stepId: body.stepId as string | undefined,
            text: body.text as string | undefined,
            actual: body.actual as never,
            at: body.at as string | undefined,
            backfilled: body.backfilled === true,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, eventId: r.execution.events[r.execution.events.length - 1].id }); return;
        }
        const evEdit = path.match(/^\/api\/executions\/([^/]+)\/events\/([^/]+)\/edit$/);
        if (evEdit) {
          const r = editEvent(state, decodeURIComponent(evEdit[1]), decodeURIComponent(evEdit[2]), {
            text: body.text as string | undefined,
            actual: body.actual as never,
            reason: body.reason as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        const execPauseAssist = path.match(/^\/api\/executions\/([^/]+)\/pause-assist$/);
        if (execPauseAssist) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法给出暂停建议。可直接人工暂停。" }); return; }
          const r = await pauseAssist(cfg, state, decodeURIComponent(execPauseAssist[1]));
          send(res, 200, r); return;
        }
        const execPause = path.match(/^\/api\/executions\/([^/]+)\/pause$/);
        if (execPause) {
          const r = pauseExecution(state, decodeURIComponent(execPause[1]), {
            reason: String(body.reason ?? ""),
            risks: body.risks as string[] | undefined,
            resumeChecks: body.resumeChecks as string[] | undefined,
            aiSuggested: body.aiSuggested === true,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        const execResume = path.match(/^\/api\/executions\/([^/]+)\/resume$/);
        if (execResume) {
          const r = resumeExecution(state, decodeURIComponent(execResume[1]), String(body.humanDecision ?? ""));
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        const execDone = path.match(/^\/api\/executions\/([^/]+)\/done$/);
        if (execDone) {
          const r = completeExecution(state, decodeURIComponent(execDone[1]));
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        if (path === "/api/samples") {
          const r = createSample(state, {
            topicId: String(body.topicId ?? ""),
            executionId: body.executionId as string | undefined,
            shortName: String(body.shortName ?? ""),
            displayName: body.displayName as string | undefined,
            origin: body.origin as "user" | "public" | undefined,
            amount: (body.amount as never) ?? { value: "", unit: "" },
            handling: body.handling as string | undefined,
            use: body.use as string | undefined,
            note: body.note as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, sampleId: r.sample.id }); return;
        }
        const smpStates = path.match(/^\/api\/samples\/([^/]+)\/states$/);
        if (smpStates) {
          const r = addSampleState(state, decodeURIComponent(smpStates[1]), {
            amount: (body.amount as never) ?? { value: "", unit: "" },
            handling: body.handling as string | undefined,
            use: body.use as string | undefined,
            note: body.note as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, revision: r.sample.states.length }); return;
        }
        const smpRename = path.match(/^\/api\/samples\/([^/]+)\/rename$/);
        if (smpRename) {
          const r = renameSample(state, decodeURIComponent(smpRename[1]), String(body.displayName ?? ""));
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        if (path === "/api/measurements") {
          const r = addMeasurement(state, {
            topicId: String(body.topicId ?? ""),
            sampleId: String(body.sampleId ?? ""),
            sampleStateRevision: typeof body.sampleStateRevision === "number" ? body.sampleStateRevision : undefined,
            time: body.time as string | undefined,
            method: body.method as string | undefined,
            instrument: body.instrument as string | undefined,
            value: String(body.value ?? ""),
            unit: body.unit as string | undefined,
            cellRef: body.cellRef as never,
            note: body.note as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, measurementId: r.measurement.id }); return;
        }
        const measEdit = path.match(/^\/api\/measurements\/([^/]+)\/edit$/);
        if (measEdit) {
          const r = editMeasurement(state, decodeURIComponent(measEdit[1]), {
            value: body.value as string | undefined,
            unit: body.unit as string | undefined,
            method: body.method as string | undefined,
            instrument: body.instrument as string | undefined,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        const impRun = path.match(/^\/api\/impacts\/([^/]+)\/run$/);
        if (impRun) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：语义影响无法评估（这不等于“无影响”）。" }); return; }
          const impactId = decodeURIComponent(impRun[1]);
          if (!state.impacts.some((i) => i.id === impactId)) { send(res, 404, { error: `影响分析不存在：${impactId}` }); return; }
          const id = `job_${randomUUID()}`;
          const job: Job = { id, status: "running", done: 0, total: 1, message: "影响评估中…" };
          jobs.set(id, job); trimJobs();
          void (async () => {
            try {
              // 写回只合并本条影响记录，其余实体保持最新已提交值；已被标 stale 的不被旧评估复活。
              const r = await runImpactAssessment(async () => state, async (s) => {
                await commitState(async (latest) => {
                  const incoming = s.impacts.find((i) => i.id === impactId);
                  const curNow = latest.impacts.find((i) => i.id === impactId);
                  if (!incoming || !curNow) return;
                  if (curNow.status === "stale" && incoming.status !== "stale") return;
                  const next = { ...latest, impacts: latest.impacts.map((i) => (i.id === impactId ? incoming : i)) };
                  await store.save(next); state = next;
                });
              }, impactId, cfg);
              job.status = "done";
              job.result = { impactId, discarded: r.discarded };
              job.message = r.ok ? "完成" : r.discarded ? "已有更新改动，旧评估结果已丢弃（stale 守卫）" : `失败：${r.error}`;
              if (!r.ok && !r.discarded) { job.status = "error"; job.error = r.error; }
            } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
          })();
          send(res, 202, { ok: true, jobId: id }); return;
        }
        if (path === "/api/import/image") {
          const r = importImage(state, { name: String(body.name ?? ""), dataUrl: String(body.dataUrl ?? ""), topicId: body.topicId as string | undefined });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, assetId: r.asset.id }); return;
        }
        if (path === "/api/ocr") {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法识别。可用人工转录兜底（标 manual）。" }); return; }
          const assetId = String(body.assetId ?? "");
          const asset = state.assets.find((a) => a.id === assetId);
          if (!asset) { send(res, 404, { error: `原件不存在：${assetId}` }); return; }
          const id = `job_${randomUUID()}`;
          const job: Job = { id, status: "running", done: 0, total: 1, message: "识别中…" };
          jobs.set(id, job); trimJobs();
          void (async () => {
            try {
              const r = await runOcr(cfg, asset);
              await commitState(async (latest) => {
                const next = { ...latest, ocrs: [...latest.ocrs, ...r.ocrs] };
                await store.save(next); state = next;
              });
              writeAudit(assetId, { raws: [{ index: 0, content: r.raw }], model: r.model }, "handwriting_ocr");
              job.status = "done"; job.result = { assetId, created: r.ocrs.length, ocrIds: r.ocrs.map((o) => o.id) }; job.message = "完成";
            } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
          })();
          send(res, 202, { ok: true, jobId: id }); return;
        }
        if (path === "/api/ocr/manual") {
          const r = addManualOcr(state, String(body.assetId ?? ""), {
            rawText: String(body.rawText ?? ""),
            fields: body.fields as Record<string, string> | undefined,
            unknowns: body.unknowns as string[] | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, ocrId: r.ocr.id }); return;
        }
        const ocrConfirm = path.match(/^\/api\/ocr\/([^/]+)\/confirm$/);
        if (ocrConfirm) {
          const r = confirmOcr(state, decodeURIComponent(ocrConfirm[1]), {
            rawText: body.rawText as string | undefined,
            fields: body.fields as Record<string, string> | undefined,
            unknowns: body.unknowns as string[] | undefined,
            reason: body.reason as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        // ── 5E：分析任务 / 方法推荐 / 结果提交 / 初步报告 / 上下文对话 ──
        if (path === "/api/restore") {
          const json = String(body.json ?? "");
          const chk = inspectLibraryJson(json, body.sha256 ? String(body.sha256) : undefined);
          if (!chk.ok) { send(res, 422, { error: chk.error }); return; }
          // 隔离恢复：写入临时文件并严格加载；**绝不覆盖主实例数据文件**。
          const target = join(tmpdir(), `locus-restore-${Date.now()}.json`);
          writeFileSync(target, json, "utf8");
          let restored: LocusState;
          try { restored = await new JsonFileStore(target).loadStrict(); }
          catch (e) { send(res, 422, { error: `恢复失败：${(e as Error).message}` }); return; }
          send(res, 200, { ok: true, isolatedPath: target, version: restored.version, counts: countsOf(restored) }); return;
        }
        if (path === "/api/ai/test") {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 400, { error: "未配置 AI：先填写三项并保存。" }); return; }
          const r = await testAiConnection(cfg);
          send(res, 200, r); return;
        }
        if (path === "/api/ai/models") {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 400, { error: "未配置 AI：先填写三项并保存。" }); return; }
          const r = await listAiModels(cfg);
          send(res, 200, r); return;
        }
        if (path === "/api/change-hits") {          const r = changeHits(state, {
            kind: String(body.kind ?? ""), id: String(body.id ?? ""),
            fields: Array.isArray(body.fields) ? (body.fields as string[]).map(String) : undefined,
            withdrawn: body.withdrawn === true,
          });
          send(res, 200, { ok: true, ...r }); return;
        }
        if (path === "/api/analysis/tasks") {
          const r = createAnalysisTask(state, {
            topicId: String(body.topicId ?? ""), subquestionId: body.subquestionId as string | undefined,
            title: String(body.title ?? ""), core: body.core as unknown[], optional: body.optional as unknown[] | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, taskId: r.task.id }); return;
        }
        const atCandidates = path.match(/^\/api\/analysis\/tasks\/([^/]+)\/candidates$/);
        if (atCandidates) {
          const r = setTaskCandidates(state, decodeURIComponent(atCandidates[1]), body.optional as { ref: unknown; included: boolean }[]);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true }); return;
        }
        const atRecommend = path.match(/^\/api\/analysis\/tasks\/([^/]+)\/recommend$/);
        if (atRecommend) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法推荐方法。上下文地图仍可编辑。" }); return; }
          const taskId = decodeURIComponent(atRecommend[1]);
          const task = state.analysisTasks.find((t) => t.id === taskId);
          if (!task) { send(res, 404, { error: `分析任务不存在：${taskId}` }); return; }
          const purpose = String(body.purpose ?? "").trim();
          if (!purpose) { send(res, 422, { error: "推荐须写明研究目的。" }); return; }
          if (recommendingTasks.has(taskId)) { send(res, 409, { error: "该任务已有推荐在运行，请等待完成，勿重复提交。" }); return; }
          const snapshot = buildSnapshot(state, task, purpose, cfg.model, "analysis_recommend/v1");
          recommendingTasks.add(taskId);
          const id = `job_${randomUUID()}`;
          const job: Job = { id, status: "running", done: 0, total: 1, message: "方法推荐中…" };
          jobs.set(id, job); trimJobs();
          void (async () => {
            try {
              const { value, raw } = await runTask(cfg, "analysis_recommend", snapshotInput(snapshot));
              await commitState(async (latest) => {
                const r = applyRecommendation(latest, taskId, value, raw, snapshot);
                await store.save(r.state); state = r.state;
                writeAudit(taskId, { raws: [{ index: 0, content: raw }], model: cfg.model }, "analysis_recommend");
                job.status = "done";
                job.result = { taskId, methods: r.task.recommendation!.methods.length, snapshotHash: snapshot.hash };
                job.message = "完成";
              });
            } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
            finally { recommendingTasks.delete(taskId); }
          })();
          send(res, 202, { ok: true, jobId: id, snapshotHash: snapshot.hash }); return;
        }
        const atResult = path.match(/^\/api\/analysis\/tasks\/([^/]+)\/result$/);
        if (atResult) {
          const taskId = decodeURIComponent(atResult[1]);
          const task = state.analysisTasks.find((t) => t.id === taskId);
          if (!task) { send(res, 404, { error: `分析任务不存在：${taskId}` }); return; }
          const attachments = (body.attachments ?? []) as { name?: unknown; content?: unknown }[];
          const assetIds: string[] = [];
          // 多实体一笔提交：先在局部累积，保存成功后才整体发布（失败不发布任何一半）。
          let next = state;
          for (const att of attachments) {
            const r = archiveResultFile(next, { name: String(att.name ?? ""), content: String(att.content ?? ""), topicId: task.topicId });
            next = r.state; assetIds.push(r.asset.id);
          }
          const r = submitResult(next, taskId, {
            method: String(body.method ?? ""), params: body.params as string | undefined,
            reason: body.reason as string | undefined, note: body.note as string | undefined,
            assetIds, adoptedRecommendation: body.adoptedRecommendation as string | undefined,
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, resultId: r.result.id, reproducible: r.result.reproducible, missing: r.result.missing, assetIds }); return;
        }
        const resEdit = path.match(/^\/api\/analysis\/results\/([^/]+)\/edit$/);
        if (resEdit) {
          const r = editResult(state, decodeURIComponent(resEdit[1]), {
            method: body.method as string | undefined, params: body.params as string | undefined,
            note: body.note as string | undefined, reason: String(body.reason ?? ""),
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, revision: r.result.revision, reproducible: r.result.reproducible }); return;
        }
        if (path === "/api/reports") {
          const r = createReport(state, { topicId: String(body.topicId ?? ""), taskId: body.taskId as string | undefined });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, reportId: r.report.id }); return;
        }
        const repPreview = path.match(/^\/api\/reports\/([^/]+)\/preview$/);
        if (repPreview) {
          const r = previewReportEdit(state, decodeURIComponent(repPreview[1]), { blocks: body.blocks });
          send(res, 200, { ok: true, baseRevision: r.baseRevision, diff: r.diff }); return;
        }
        const repApply = path.match(/^\/api\/reports\/([^/]+)\/apply$/);
        if (repApply) {
          const r = applyReportEdit(state, decodeURIComponent(repApply[1]), {
            baseRevision: Number(body.baseRevision), blocks: body.blocks, reason: String(body.reason ?? ""),
          });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, revision: r.report.revision, diff: r.diff }); return;
        }
        const repConfirm = path.match(/^\/api\/reports\/([^/]+)\/blocks\/([^/]+)\/confirm$/);
        if (repConfirm) {
          const r = confirmReportBlock(state, decodeURIComponent(repConfirm[1]), decodeURIComponent(repConfirm[2]), String(body.reason ?? ""));
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, revision: r.report.revision }); return;
        }
        const repDraft = path.match(/^\/api\/reports\/([^/]+)\/draft$/);
        if (repDraft) {
          const r = draftReportBlocks(state, decodeURIComponent(repDraft[1]));
          send(res, 200, { ok: true, blocks: r.blocks }); return;
        }
        if (path === "/api/chats") {
          const r = createChat(state, { topicId: String(body.topicId ?? ""), subquestionId: body.subquestionId as string | undefined, scope: body.scope as unknown[] | undefined });
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, chatId: r.chat.id }); return;
        }
        const chatSend = path.match(/^\/api\/chats\/([^/]+)\/send$/);
        if (chatSend) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法讨论。范围与对象仍可查看。" }); return; }
          const chatId = decodeURIComponent(chatSend[1]);
          const r = appendChatTurn(state, chatId, String(body.text ?? ""));
          await store.save(r.state); state = r.state;
          const jobId = startChatJob(chatId, r.messageId, String(body.text ?? ""));
          send(res, 202, { ok: true, jobId, messageId: r.messageId }); return;
        }
        const chatCancel = path.match(/^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/cancel$/);
        if (chatCancel) {
          const next = cancelChat(state, decodeURIComponent(chatCancel[1]), decodeURIComponent(chatCancel[2]));
          await store.save(next); state = next;
          send(res, 200, { ok: true }); return;
        }
        const chatRetry = path.match(/^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/retry$/);
        if (chatRetry) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法重试。" }); return; }
          const chatId = decodeURIComponent(chatRetry[1]);
          const messageId = decodeURIComponent(chatRetry[2]);
          const next = retryChat(state, chatId, messageId);
          await store.save(next); state = next;
          const chat = state.chats.find((c) => c.id === chatId)!;
          const idx = chat.messages.findIndex((m) => m.id === messageId);
          const userText = idx > 0 ? chat.messages[idx - 1].content : "";
          const jobId = startChatJob(chatId, messageId, userText);
          send(res, 202, { ok: true, jobId, messageId }); return;
        }
        const chatAdopt = path.match(/^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/adopt$/);
        if (chatAdopt) {
          const r = adoptProposal(state, decodeURIComponent(chatAdopt[1]), decodeURIComponent(chatAdopt[2]), Number(body.index), body.confirmed === true);
          await store.save(r.state); state = r.state;
          send(res, 200, { ok: true, applied: r.applied }); return;
        }
      }

      send(res, 404, { error: "未知接口" });
    } catch (err) {
      if (err instanceof AiError) send(res, 502, { error: err.message });
      else if (err instanceof ImportError) send(res, err.code === "original_too_large" ? 413 : 422, { error: err.message });
      else if (err instanceof AppError) send(res, err.status, { error: err.message, ...(err.details ?? {}) });
      else if (err instanceof SyntaxError) send(res, 400, { error: "JSON 解析失败" });
      else send(res, 500, { error: (err as Error).message ?? "内部错误" });
    }
  };
  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const m = req.method ?? "GET";
    // 只读请求直接读已提交 state（GET 不落库、不排队）；写请求串行进入单提交边界。
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") { void handle(req, res); return; }
    // 失败块重试要调模型：合同禁止队列内网络调用，故该路由不入队，其写入仍经 commitState。
    if (m === "POST" && /^\/api\/knowledge\/jobs\/[^/]+\/retry-chunk$/.test(new URL(req.url ?? "/", "http://localhost").pathname)) { void handle(req, res); return; }
    void commitState(() => handle(req, res));
  };
  const server = createServer(onRequest);
  // 暴露请求处理器，供会话隔离路由（createSessionRouter）复用同一闭包内的 state/store；不改变默认单实例行为。
  (server as ServerWithHandler).__locusHandler = onRequest;
  return server;
}

/** 带可复用请求处理器的 http.Server（会话隔离路由复用其闭包内的 state/store）。 */
type ServerWithHandler = import("node:http").Server & {
  __locusHandler?: (req: IncomingMessage, res: ServerResponse) => void;
};

/**
 * 竞赛会话隔离路由（最小实现）：
 * - 每个浏览器会话（Cookie `locus_sid`）拥有**独立可写工作区**：自己的 `state.json` 与 `originals/`。
 * - 新会话若提供了**只读公开样本底稿**（samplePath/sampleOriginals），则复制为会话初始数据；否则以空工作区起步。
 * - sid 严格校验（仅 32 位十六进制）后用于文件路径，杜绝目录穿越。
 * - `/healthz` 不建会话、只回健康状态。
 * 仅当入口读到 `LOCUS_SESSION_ISOLATION=1` 时启用；不改动默认单实例行为与现有测试。
 */
export async function createSessionRouter(opts: {
  dataRoot: string;
  aiConfigPath?: string;
  samplePath?: string;
  sampleOriginals?: string;
}): Promise<ServerWithHandler> {
  const SID_COOKIE = "locus_sid";
  const SID_RE = /^[a-f0-9]{32}$/;
  type Sess = { handler: (req: IncomingMessage, res: ServerResponse) => void };
  const sessions = new Map<string, Sess>();
  const pending = new Map<string, Promise<Sess>>();

  const cookieSid = (req: IncomingMessage): string | null => {
    const raw = req.headers.cookie;
    if (!raw) return null;
    for (const part of raw.split(";")) {
      const idx = part.indexOf("=");
      if (idx < 0) continue;
      if (part.slice(0, idx).trim() === SID_COOKIE) {
        const v = part.slice(idx + 1).trim();
        if (SID_RE.test(v)) return v;
      }
    }
    return null;
  };

  const loadSession = (sid: string): Promise<Sess> => {
    const existing = sessions.get(sid);
    if (existing) return Promise.resolve(existing);
    const inflight = pending.get(sid);
    if (inflight) return inflight;
    const p = (async (): Promise<Sess> => {
      const sessionDir = join(opts.dataRoot, "sessions", sid);
      const statePath = join(sessionDir, "state.json");
      const originalRoot = join(sessionDir, "originals");
      mkdirSync(sessionDir, { recursive: true });
      if (!existsSync(statePath) && opts.samplePath && existsSync(opts.samplePath)) {
        copyFileSync(opts.samplePath, statePath);
        if (opts.sampleOriginals && existsSync(opts.sampleOriginals)) cpSync(opts.sampleOriginals, originalRoot, { recursive: true });
      }
      const app = (await createApp(new JsonFileStore(statePath), { aiConfigPath: opts.aiConfigPath, originalRoot })) as ServerWithHandler;
      const handler = app.__locusHandler;
      if (!handler) throw new Error("会话处理器未暴露（createApp 未返回 __locusHandler）。");
      const s: Sess = { handler };
      sessions.set(sid, s);
      pending.delete(sid);
      return s;
    })();
    pending.set(sid, p);
    return p;
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, isolation: "session" }));
      return;
    }
    let sid = cookieSid(req);
    if (!sid) sid = randomUUID().replace(/-/g, "");
    // 每次响应回写 cookie：刷新保持同一会话；新请求无 cookie 时开启新会话。
    res.setHeader("set-cookie", `${SID_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
    loadSession(sid).then((s) => s.handler(req, res)).catch((e) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `会话初始化失败：${(e as Error).message}` }));
    });
  };

  return createServer(onRequest) as ServerWithHandler;
}

// 仅在被直接运行时才监听（被 import 时不产生副作用，便于测试）。
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 竞赛模式：缺少站点服务端凭据则**拒绝启动**（不静默降级为无鉴权）。
  if (process.env.LOCUS_COMPETITION === "1" && !process.env.LOCUS_SITE_TOKEN) {
    console.error("竞赛模式（LOCUS_COMPETITION=1）缺少 LOCUS_SITE_TOKEN：拒绝启动。");
    process.exit(1);
  }
  const isolation = process.env.LOCUS_SESSION_ISOLATION === "1";
  const app = isolation
    ? await createSessionRouter({
        dataRoot: dirname(DATA_PATH),
        aiConfigPath: AI_CONFIG_PATH,
        samplePath: process.env.LOCUS_SAMPLE_STATE,
        sampleOriginals: process.env.LOCUS_SAMPLE_ORIGINALS,
      })
    : await createApp(new JsonFileStore(DATA_PATH), { aiConfigPath: AI_CONFIG_PATH, originalRoot: join(dirname(DATA_PATH), "originals") });
  app.listen(PORT, "127.0.0.1", () => {
    const d = describeConfig(getAiConfig());
    const where = isolation ? join(dirname(DATA_PATH), "sessions") : DATA_PATH;
    console.log(`LOCUS ${isolation ? "server (session-isolated)" : "dev server"}: http://127.0.0.1:${PORT}  (data: ${where})`);
    console.log(`AI: ${d.configured ? `已配置 model=${d.model} @ ${d.baseUrl}` : "未配置（在左下角「模型设置」里填写；保存后本机留存，不入库）"}`);
  });
}
