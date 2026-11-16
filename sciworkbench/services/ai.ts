/**
 * OpenAI 兼容 AI 解析（健壮版）。
 * 配置：运行时可从网页设置，仅进程内存；重启失效；不写文件/浏览器持久存储/日志/Git。
 * 任务：文献抽取 / 方案解析 / 手写识别 为三个独立任务，各自 prompt 与输出结构，不混用。
 * 健壮性：JSON 提取容错；失败一次受限重试；文献按段落分块抽取；原始响应回传供审计留存。
 */

export interface AiConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly key: string;
}

export type TaskName = "literature_extract" | "protocol_parse" | "handwriting_ocr";

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
      "不得补造文本中不存在的数据；不确定处列入 unknowns。只返回 JSON，键必须用双引号。",
    schema:
      '{"cards":[{"rawText":"原文片段","locator":{"sectionQuote":"用于回查的原文短引"},"extracted":{"fields":{"键":"值"},"units":["单位"]},"unknowns":["未知项"]}]}',
  },
  protocol_parse: {
    name: "protocol_parse",
    system:
      "你是实验方案结构化助手。把给定的方法/方案文本整理成可编辑的结构化方案草稿；" +
      "不得补造未写明的条件或设备；未知项列入 unknowns。只返回 JSON，键必须用双引号。",
    schema:
      '{"protocol":{"purpose":"目的","inputs":["输入"],"operations":["操作"],"conditions":["条件"],"criteria":"完成判据","unknowns":["未知项"]}}',
  },
  handwriting_ocr: {
    name: "handwriting_ocr",
    system:
      "你是手写实验记录识别助手。逐字转录图中的记录，保留单位与数值，辨认不清用 ? 占位；" +
      "不得猜测数值或单位。只返回 JSON，键必须用双引号。",
    schema: '{"records":[{"rawText":"转录文本","fields":{"键":"值"},"unknowns":["未知项"]}]}',
  },
};

/** 从环境变量读取配置（可选初始值）。 */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  return normalizeAiConfig({ baseUrl: env.LOCUS_AI_BASE_URL, model: env.LOCUS_AI_MODEL, key: env.LOCUS_AI_KEY });
}

export function normalizeAiConfig(input: { baseUrl?: unknown; model?: unknown; key?: unknown }): AiConfig | null {
  const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input.model ?? "").trim();
  const key = String(input.key ?? "").trim();
  if (!baseUrl || !model || !key) return null;
  return { baseUrl, model, key };
}

// ── 运行时配置：仅进程内存 ──
let runtimeConfig: AiConfig | null = aiConfigFromEnv();
export function getAiConfig(): AiConfig | null { return runtimeConfig; }
export function setAiConfig(input: { baseUrl?: unknown; model?: unknown; key?: unknown }): boolean {
  const cfg = normalizeAiConfig(input);
  if (!cfg) return false;
  runtimeConfig = cfg;
  return true;
}
export function clearAiConfig(): void { runtimeConfig = null; }

/** 供 /api/ai/status 报告；**绝不返回 key**。 */
export function describeConfig(cfg: AiConfig | null): { configured: boolean; baseUrl: string; model: string } {
  return cfg ? { configured: true, baseUrl: cfg.baseUrl, model: cfg.model } : { configured: false, baseUrl: "", model: "" };
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

/** 依序尝试多种清洗后解析；全失败抛 AiError。 */
export function extractJson(text: string): unknown {
  const raw = String(text ?? "").trim();
  if (!raw) throw new AiError("模型返回为空。");
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  const sliced = a >= 0 && b > a ? raw.slice(a, b + 1) : raw;
  const candidates = [
    raw,
    stripFence(raw),
    sliced,
    deTrailingComma(sliced),
    quoteBareKeys(deTrailingComma(sliced)),
    quoteBareKeys(deTrailingComma(stripFence(sliced))),
  ];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  throw new AiError("模型未返回可解析的 JSON（已尝试去围栏/去尾逗号/补引号）。");
}

// ── 单次调用 ────────────────────────────────────────────────
async function postChat(cfg: AiConfig, system: string, user: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new AiError("模型限流（429），请稍后重试。");
    if (!res.ok) throw new AiError(`模型请求失败：HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) throw new AiError("模型返回为空。");
    return content;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error).name === "AbortError") throw new AiError("模型请求超时。");
    throw new AiError(`模型调用错误：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 调一次任务；解析失败时用“严格 JSON”提示重试一次。返回 {value, raw}。 */
export async function runTask(cfg: AiConfig, task: TaskName, input: string, timeoutMs = 60000): Promise<{ value: unknown; raw: string }> {
  const def = TASKS[task];
  const system = `${def.system}\n输出 JSON 结构：${def.schema}`;
  const first = await postChat(cfg, system, input, timeoutMs);
  try {
    return { value: extractJson(first), raw: first };
  } catch {
    const stricter = `${system}\n重要：上一次输出不是合法 JSON。请只返回严格 JSON（键必须双引号，无注释、无多余文字）。`;
    const second = await postChat(cfg, stricter, input, timeoutMs);
    return { value: extractJson(second), raw: second };
  }
}

// ── 文献抽取：分块 + 重试 + 原始响应回传 ────────────────────
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
  /** 扁平化后的 card 原始对象（未映射，交由 app 层校验）。 */
  cards: unknown[];
  /** 每个分块的原始模型响应（供审计留存；不含认证头）。 */
  raws: { index: number; content: string }[];
}

export async function extractLiterature(cfg: AiConfig, text: string): Promise<LiteratureExtractResult> {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new AiError("文档为空。");
  if (chunks.length > MAX_CHUNKS) {
    throw new AiError(`文档过长：需分 ${chunks.length} 块，超过上限 ${MAX_CHUNKS} 块。请拆分后再导入。`);
  }
  const cards: unknown[] = [];
  const raws: { index: number; content: string }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const { value, raw } = await runTask(cfg, "literature_extract", chunks[i]);
    raws.push({ index: i, content: raw });
    const obj = value as { cards?: unknown };
    if (!obj || !Array.isArray(obj.cards)) throw new AiError(`第 ${i + 1} 块抽取结果结构不符：缺少 cards。`);
    cards.push(...obj.cards);
  }
  return { cards, raws };
}