// 内部验收专用：OpenAI 兼容「模拟桩」模型服务（真实模型未授权，见 P8 任务书 §2）。
// 仅实现验收所需任务（protocol_parse / context_chat）；输出为确定性桩数据，**不是**真实模型推理。
// 用法：P8_MOCK_PORT=5186 node scripts/_acceptance-p8-mock-ai.ts
// 然后让被测服务指向它：LOCUS_AI_BASE_URL=http://127.0.0.1:5186/v1 LOCUS_AI_MODEL=mock-stub LOCUS_AI_KEY=stub
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = Number(process.env.P8_MOCK_PORT ?? 5186);

// 任务判定：优先用 schema 的 ASCII 标记（对编码稳健），中文提示词作兜底。
function taskOf(system: string): string {
  if (system.includes('"protocol"') && system.includes("durationMin")) return "protocol_parse";
  if (system.includes("execution-note") && system.includes('"answer"')) return "context_chat";
  if (system.includes('"cards"') && system.includes("rawText")) return "literature_extract";
  if (system.includes("实验方案结构化")) return "protocol_parse";
  if (system.includes("科研上下文讨论")) return "context_chat";
  if (system.includes("文献证据抽取")) return "literature_extract";
  return "unknown";
}

// ③ 方案解析桩：据文献「重构成」可编辑方案草稿；缺项如实列入 unknowns，不补造。
function protocolParse(): unknown {
  return {
    protocol: {
      purpose: "比较新鲜与干燥茎枝/果实在海水中的漂浮时长与浸后萌发（据达尔文 1859 第十一章重构，非本地实测方案）。模拟桩输出，真实模型待授权。",
      inputs: ["94 种带熟果的茎枝与果实", "海水（盐度未写明）"],
      steps: [
        { op: "采集 94 种带熟果的茎枝与果实", durationMin: null, estimated: false, note: "原文陈述" },
        { op: "干燥部分茎枝，保留新鲜组作对照", durationMin: null, estimated: false, note: "" },
        { op: "置于海水浸泡并计时", durationMin: null, estimated: false, note: "盐度/温度原文未写明" },
        { op: "取出后种植并观察萌发", durationMin: null, estimated: false, note: "记录是否萌发" },
      ],
      conditions: ["海水浸泡"],
      criteria: "记录漂浮天数（新鲜 vs 干燥）与浸后是否萌发；未量化条件明示未知",
      unknowns: ["海水盐度未写明", "温度未写明", "浸泡容器未写明"],
    },
  };
}

// ⑤ 上下文对话桩：只依据给定上下文作答；proposals 若匹配到执行 ID 则给一条待复核建议。
function contextChat(user: string): unknown {
  const execId = user.match(/exec_[0-9a-f-]{36}/)?.[0];
  const proposals = execId
    ? [{ targetKind: "execution-note", targetId: execId, preview: "复核：海浪条件下漂浮时间应短于静水实验，传播量级估计或需下修（模拟桩建议，待人工确认）。" }]
    : [];
  return {
    answer:
      "据给定上下文（达尔文 1859 第十一章证据卡）：作者自述「暴露于海浪者漂浮时间应短于静水实验」，故传播量级估计或需下修；马滕斯实测 18/98 漂浮 42 天且仍能萌发属新证据，需复核既有解释，不覆盖旧结论。（模拟桩输出，真实模型待授权）",
    sources: ["证据卡·作者修正意见", "证据卡·马滕斯实测", "证据卡·作者推断"],
    proposals,
  };
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    const raw = await readBody(req);
    let sys = "";
    let user = "";
    try {
      const body = JSON.parse(raw) as { messages?: { role?: string; content?: unknown }[] };
      for (const m of body.messages ?? []) {
        const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        if (m.role === "system") sys += c;
        if (m.role === "user") user += c;
      }
    } catch { /* 保持为空 */ }
    const task = taskOf(sys);
    const value = task === "protocol_parse" ? protocolParse() : task === "context_chat" ? contextChat(user) : {};
    console.log(`[mock-ai] task=${task} → 返回模拟桩（真实模型待授权）`);
    const payload = { id: "mock", object: "chat.completion", model: "mock-stub", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(value) }, finish_reason: "stop" }] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "mock-ai: 仅实现 POST */chat/completions" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-ai] 模拟桩模型服务：http://127.0.0.1:${PORT}/v1  （真实模型待授权；仅验收用）`);
});
