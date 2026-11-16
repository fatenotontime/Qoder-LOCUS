/**
 * OpenAI 兼容 AI 解析（健壮版 v3）。
 * 配置：运行时可从网页设置，仅进程内存；重启失效；不写文件/浏览器持久存储/日志/Git。
 * 任务：文献抽取 / 方案解析 / 手写识别 为三个独立任务，各自 prompt 与输出结构，不混用。
 * 健壮性：JSON 提取容错；解析失败重试一次；对超时/429/5xx 有上限重试；文献分块并回报进度；原始响应回传供审计。
 */

export interface AiConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly key: string;
  /** 单次请求超时（毫秒）。缺省 120000。 */
  readonly timeoutMs?: number;
}

export type TaskName = "literature_extract" | "protocol_parse" | "handwriting_ocr" | "impact_assess" | "pause_assist";

export interface TaskDef {
  readonly name: TaskName;
  readonly system: string;
  readonly schema: string;
}

export const TASKS: Record<TaskName, TaskDef> = {
  literature_extract: {
    name: "literature_extract",
    system:
      "你是文献证据抽取助手。只从给定文本中抽取可逐项核查的内容片段，生成结构化证据卡草稿；" +
      "不得补造文本中不存在的数据；不确定处列入 unknowns；条件（温度/pH/缓冲液等）单列 conditions；" +
      "若片段是综述转引他人结果（二手），secondaryCitation 置 true。只返回 JSON，键必须用双引号。",
    schema:
      '{"cards":[{"rawText":"原文片段","locator":{"sectionQuote":"用于回查的原文短引"},"extracted":{"fields":{"键":"值"},"units":["单位"],"conditions":["条件"]},"unknowns":["未知项"],"secondaryCitation":false}]}',
  },
  protocol_parse: {
    name: "protocol_parse",
    system:
      "你是实验方案结构化助手。把给定的方法/方案文本整理成可编辑的结构化方案草稿；" +
      "不得补造未写明的条件或设备；未知项列入 unknowns。" +
      "原文写明的时长必须拆到 durationMin（分钟数字），不要只埋在操作文本里；原文未给时长则 durationMin 置 null，不得估计；" +
      "原文给了时长但无法确定是精确还是约计时，estimated 置 true。只返回 JSON，键必须用双引号。",
    schema:
      '{"protocol":{"purpose":"目的","inputs":["输入"],"steps":[{"op":"操作（不含时长数字）","durationMin":null,"estimated":false,"note":"备注"}],"conditions":["条件"],"criteria":"完成判据","unknowns":["未知项"]}}',
  },
  handwriting_ocr: {
    name: "handwriting_ocr",
    system:
      "你是手写实验记录识别助手。逐字转录图中的记录，保留单位与数值，辨认不清用 ? 占位；" +
      "不得猜测数值或单位。只返回 JSON，键必须用双引号。",
    schema: '{"records":[{"rawText":"转录文本","fields":{"键":"值"},"unknowns":["未知项"]}]}',
  },
  impact_assess: {
    name: "impact_assess",
    system:
      "你是科研变更影响评估助手。输入包含一处已发生的变更与其上下文快照（方案/执行/样品/测量）。" +
      "只做语义影响评估：时间传播等确定性数学已由系统算出，不要重复猜数学。" +
      "逐条给出受影响的对象、类别（timing/execution/comparability/analysis/interpretation）、发现、理由、证据引用、未知项与建议动作；" +
      "证据不足时用 needs_review，不得把“没找到证据”说成“无影响”。只返回 JSON，键必须用双引号。",
    schema:
      '{"summary":"一句话摘要","assessment":"impact|no_supported_impact_found|needs_review","items":[{"targetKind":"对象类型","targetId":"对象ID","category":"timing|execution|comparability|analysis|interpretation","finding":"发现","reason":"理由","evidenceRefs":["引用"],"unknowns":["未知项"],"suggestedAction":"建议动作"}]}',
  },
  pause_assist: {
    name: "pause_assist",
    system:
      "你是实验暂停辅助助手。根据给定的方案快照与暂停时的执行状态，提示样品/时间相关风险与恢复前检查项；" +
      "只提建议，不替人做决定；不确定的列入 unknowns。只返回 JSON，键必须用双引号。",
    schema: '{"risks":["风险"],"resumeChecks":["恢复前检查"],"unknowns":["未知项"]}',
  },
};

export const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 600000;

const clampTimeout = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(n)));
};

export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  return normalizeAiConfig({ baseUrl: env.LOCUS_AI_BASE_URL, model: env.LOCUS_AI_MODEL, key: env.LOCUS_AI_KEY, timeoutMs: env.LOCUS_AI_TIMEOUT_MS });
}

export function normalizeAiConfig(input: { baseUrl?: unknown; model?: unknown; key?: unknown; timeoutMs?: unknown }): AiConfig | null {
  const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input.model ?? "").trim();
  const key = String(input.key ?? "").trim();
  if (!baseUrl || !model || !key) return null;
  return { baseUrl, model, key, timeoutMs: clampTimeout(input.timeoutMs) };
}

let runtimeConfig: AiConfig | null = aiConfigFromEnv();
export function getAiConfig(): AiConfig | null { return runtimeConfig; }
export function setAiConfig(input: { baseUrl?: unknown; model?: unknown; key?: unknown; timeoutMs?: unknown }): boolean {
  const cfg = normalizeAiConfig(input);
  if (!cfg) return false;
  runtimeConfig = cfg;
  return true;
}
export function clearAiConfig(): void { runtimeConfig = null; }

export function describeConfig(cfg: AiConfig | null): { configured: boolean; baseUrl: string; model: string; timeoutMs: number } {
  return cfg
    ? { configured: true, baseUrl: cfg.baseUrl, model: cfg.model, timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS }
    : { configured: false, baseUrl: "", model: "", timeoutMs: DEFAULT_TIMEOUT_MS };
}

export class AiError extends Error {}

// ── JSON 提取容错 ───────────────────────────────────────────
function stripFence(s: string): string {
  return s.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
}
function deTrailingComma(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}
function quoteBareKeys(s: string): string {
  return s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}
export function extractJson(text: string): unknown {
  const raw = String(text ?? "").trim();
  if (!raw) throw new AiError("模型返回为空。");
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  const sliced = a >= 0 && b > a ? raw.slice(a, b + 1) : raw;
  const candidates = [raw, stripFence(raw), sliced, deTrailingComma(sliced), quoteBareKeys(deTrailingComma(sliced)), quoteBareKeys(deTrailingComma(stripFence(sliced)))];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* next */ }
  }
  throw new AiError("模型未返回可解析的 JSON（已尝试去围栏/去尾逗号/补引号）。");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 单次请求；对超时/429/5xx 有上限重试（退避）。images 为 dataURL（视觉任务）。 */
async function postChat(cfg: AiConfig, system: string, user: string, images?: string[]): Promise<string> {
  const userContent = images && images.length > 0
    ? [{ type: "text", text: user }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : user;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastErr: Error = new AiError("模型请求失败。");
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: userContent }] }),
        signal: controller.signal,
      });
      if (res.status === 429) { lastErr = new AiError("模型限流（429）。"); await sleep(600 * (attempt + 1)); continue; }
      if (res.status >= 500) { lastErr = new AiError(`模型服务错误（HTTP ${res.status}）。`); await sleep(600 * (attempt + 1)); continue; }
      if (!res.ok) throw new AiError(`模型请求失败：HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? "";
      if (!content) throw new AiError("模型返回为空。");
      return content;
    } catch (e) {
      const err = e as Error;
      if (err instanceof AiError) throw err;
      if (err.name === "AbortError") { lastErr = new AiError(`模型请求超时（${Math.round(timeoutMs / 1000)}s）。`); await sleep(400); continue; }
      throw new AiError(`模型调用错误：${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** 调一次任务；解析失败时用“严格 JSON”提示再试一次。返回 {value, raw}。 */
export async function runTask(cfg: AiConfig, task: TaskName, input: string, images?: string[]): Promise<{ value: unknown; raw: string }> {
  const def = TASKS[task];
  const system = `${def.system}\n输出 JSON 结构：${def.schema}`;
  const first = await postChat(cfg, system, input, images);
  try {
    return { value: extractJson(first), raw: first };
  } catch {
    const stricter = `${system}\n重要：上一次输出不是合法 JSON。请只返回严格 JSON（键必须双引号，无注释、无多余文字）。`;
    const second = await postChat(cfg, stricter, input, images);
    return { value: extractJson(second), raw: second };
  }
}

// ── 文献抽取：分块 + 进度回调 + 原始响应回传 ────────────────
const CHUNK_CHARS = 4000;
const MAX_CHUNKS = 24;

export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (p.length > size) {
      if (buf) { chunks.push(buf); buf = ""; }
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    if ((buf + "\n\n" + p).length > size && buf) { chunks.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf) chunks.push(buf);
  return chunks.filter((c) => c.trim().length > 0);
}

export interface LiteratureExtractResult {
  cards: unknown[];
  raws: { index: number; content: string }[];
}

export async function extractLiterature(
  cfg: AiConfig,
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<LiteratureExtractResult> {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new AiError("文档为空。");
  if (chunks.length > MAX_CHUNKS) throw new AiError(`文档过长：需分 ${chunks.length} 块，超过上限 ${MAX_CHUNKS} 块。请拆分后再导入。`);
  const total = chunks.length;
  const cards: unknown[] = [];
  const raws: { index: number; content: string }[] = [];
  for (let i = 0; i < total; i++) {
    const { value, raw } = await runTask(cfg, "literature_extract", chunks[i]);
    raws.push({ index: i, content: raw });
    const obj = value as { cards?: unknown };
    if (!obj || !Array.isArray(obj.cards)) throw new AiError(`第 ${i + 1}/${total} 块抽取结果结构不符：缺少 cards。`);
    cards.push(...obj.cards);
    onProgress?.(i + 1, total);
  }
  return { cards, raws };
}