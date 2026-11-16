/**
 * OpenAI 兼容 AI 解析。
 * 配置：每次启动从环境变量读取，**仅当前进程内存**，重启失效；
 *      不写文件、不写浏览器持久存储、不入日志、不入 Git。
 * 任务：文献抽取 / 方案解析 / 手写识别 为**三个独立任务**，各自 prompt 与输出结构，不混用。
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
  /** 期望的 JSON 结构说明（写入提示词；不依赖服务端 response_format）。 */
  readonly schema: string;
}

/** 三个独立任务定义（提示词与输出结构分开）。 */
export const TASKS: Record<TaskName, TaskDef> = {
  literature_extract: {
    name: "literature_extract",
    system:
      "你是文献证据抽取助手。只从给定文本中抽取可逐项核查的内容片段，生成结构化证据卡草稿；" +
      "不得补造文本中不存在的数据；不确定处列入 unknowns。只返回 JSON。",
    schema:
      '{"cards":[{"rawText":"原文片段","locator":{"sectionQuote":"用于回查的原文短引"},"extracted":{"fields":{"键":"值"},"units":["单位"]},"unknowns":["未知项"]}]}',
  },
  protocol_parse: {
    name: "protocol_parse",
    system:
      "你是实验方案结构化助手。把给定的方法/方案文本整理成可编辑的结构化方案草稿；" +
      "不得补造未写明的条件或设备；未知项列入 unknowns。只返回 JSON。",
    schema:
      '{"protocol":{"purpose":"目的","inputs":["输入"],"operations":["操作"],"conditions":["条件"],"criteria":"完成判据","unknowns":["未知项"]}}',
  },
  handwriting_ocr: {
    name: "handwriting_ocr",
    system:
      "你是手写实验记录识别助手。逐字转录图中的记录，保留单位与数值，辨认不清用 ? 占位；" +
      "不得猜测数值或单位。只返回 JSON。",
    schema: '{"records":[{"rawText":"转录文本","fields":{"键":"值"},"unknowns":["未知项"]}]}',
  },
};

/** 从环境变量读取配置；缺任一项返回 null（不报错、不落盘）。 */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  return normalizeAiConfig({ baseUrl: env.LOCUS_AI_BASE_URL, model: env.LOCUS_AI_MODEL, key: env.LOCUS_AI_KEY });
}

/** 规范化输入：去空格、去尾斜杠；三项齐全才算有效。 */
export function normalizeAiConfig(input: { baseUrl?: unknown; model?: unknown; key?: unknown }): AiConfig | null {
  const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input.model ?? "").trim();
  const key = String(input.key ?? "").trim();
  if (!baseUrl || !model || !key) return null;
  return { baseUrl, model, key };
}

// ── 运行时配置：仅进程内存；重启失效；不写文件/浏览器持久存储/日志/Git ──
let runtimeConfig: AiConfig | null = aiConfigFromEnv();

/** 当前进程内的 AI 配置（可能来自环境变量或网页配置）。 */
export function getAiConfig(): AiConfig | null {
  return runtimeConfig;
}

/** 由网页设置（仅内存）。非法输入返回 false，不改动现有配置。 */
export function setAiConfig(input: { baseUrl?: unknown; model?: unknown; key?: unknown }): boolean {
  const cfg = normalizeAiConfig(input);
  if (!cfg) return false;
  runtimeConfig = cfg;
  return true;
}

export function clearAiConfig(): void {
  runtimeConfig = null;
}

/** 供 /api/ai/status 报告；**绝不返回 key**。 */
export function describeConfig(cfg: AiConfig | null): { configured: boolean; baseUrl: string; model: string } {
  return cfg
    ? { configured: true, baseUrl: cfg.baseUrl, model: cfg.model }
    : { configured: false, baseUrl: "", model: "" };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new AiError("模型返回中没有 JSON。");
  const end = text.lastIndexOf("}");
  const slice = end > start ? text.slice(start, end + 1) : text.slice(start);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new AiError(`模型 JSON 解析失败：${(e as Error).message}`);
  }
}

export class AiError extends Error {}

/** 调用 OpenAI 兼容 /chat/completions。key 只在请求头使用，不进日志。 */
export async function runTask(cfg: AiConfig, task: TaskName, input: string, timeoutMs = 60000): Promise<unknown> {
  const def = TASKS[task];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: "system", content: `${def.system}\n输出 JSON 结构：${def.schema}` },
          { role: "user", content: input },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new AiError(`模型请求失败：HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) throw new AiError("模型返回为空。");
    return extractJson(content);
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error).name === "AbortError") throw new AiError("模型请求超时。");
    throw new AiError(`模型调用错误：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
