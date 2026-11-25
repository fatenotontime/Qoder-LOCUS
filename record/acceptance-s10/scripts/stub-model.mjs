// 本机 OpenAI 兼容模型替身（验收专用，非产品代码）。
// 用法: node stub-model.mjs <port=5290> <logfile.jsonl>
// 端点: POST /v1/chat/completions  (GET /v1/models)
// 行为:
//   - 按 system 提示词判定任务（analysis_recommend / knowledge_struct / 其它）。
//   - knowledge_struct 默认延迟 LOCUS_STUB_KDELAY_MS(8000) 后返回一条合法批次（1 张卡）。
//   - analysis_recommend 默认延迟 LOCUS_STUB_RDELAY_MS(3000)，返回固定方法。
//   - 记录每次请求的 system 摘要、user 正文（不含请求头）到 logfile。
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.argv[2] || 5290);
const LOG = process.argv[3] || "stub-model.jsonl";
const KDELAY = Number(process.env.LOCUS_STUB_KDELAY_MS || 8000);
const RDELAY = Number(process.env.LOCUS_STUB_RDELAY_MS || 3000);

function logLine(o) {
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
}

// 从 user 正文里解析「块ID：X」与材料片段，造一条逐字可定位的卡。
function buildKnowledgeStruct(user) {
  const bid = (user.match(/块ID：\s*(\S+)/) || [])[1] || "blk_unknown";
  const matIdx = user.indexOf("文献材料");
  const material = matIdx >= 0 ? user.slice(matIdx).replace(/^[^\n]*\n/, "") : user;
  // 取一段可在原文逐字匹配的引文（去掉换行，取 8~30 字的连续子串）。
  const flat = material.replace(/\s+/g, " ").trim();
  let quote = flat.slice(0, Math.min(24, flat.length));
  if (quote.length < 6) quote = flat || "海水漂流";
  const text = `验收替身卡：${quote.slice(0, 20)}`;
  return {
    schemaVersion: 1,
    evidence: [{ localId: "e1", sourceBlockId: bid, quote }],
    contexts: [{ localId: "c1", subject: "漂流的种子/茎枝", group: "", stage: "", method: "", conditions: [], unknowns: [], evidenceLocalIds: ["e1"] }],
    cards: [{
      localId: "k1",
      summary: text,
      items: [{
        contentType: "observation", nature: "observation", text,
        subject: { raw: "干旱茎枝" }, predicate: { raw: "漂浮时长" },
        value: { kind: "scalar", raw: "≈30 天", value: "30", unit: "天" },
        contextLocalIds: ["c1"], evidenceLocalIds: ["e1"],
        scopeText: "", unknowns: [], secondaryCitation: false,
      }],
    }],
    relations: [],
  };
}

function buildAnalysisRecommend() {
  return {
    methods: [{
      name: "验收替身·生存分析（Kaplan–Meier）",
      software: "R survival / Python lifelines",
      rationale: "上下文含漂浮天数与是否萌发的成对记录，适合按处理组比较存活曲线。（替身固定输出）",
      expectedArtifacts: ["按处理组的存活曲线图", "中位漂浮天数表"],
      acceptanceItems: ["曲线置信区间已标注", "分组样本量与输入表一致"],
    }],
    unknowns: ["替身未评估样本独立性，需人工判断"],
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/v1/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "locus-audit-stub" }] }));
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/v1/chat/completions")) {
    res.writeHead(404); res.end("not found"); return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    const msgs = parsed.messages || [];
    const system = (msgs.find((m) => m.role === "system")?.content || "");
    const user = (msgs.find((m) => m.role === "user")?.content || "");
    let task = "other";
    if (system.includes("数据分析方法推荐助手")) task = "analysis_recommend";
    else if (system.includes("科研文献知识提取助手")) task = "knowledge_struct";
    else if (system.includes("文献证据抽取助手")) task = "literature_extract";
    logLine({ task, systemHead: system.slice(0, 40), user, userLen: user.length });

    let payload, delay;
    if (task === "knowledge_struct") { payload = buildKnowledgeStruct(user); delay = KDELAY; }
    else if (task === "analysis_recommend") { payload = buildAnalysisRecommend(); delay = RDELAY; }
    else if (task === "literature_extract") { payload = { cards: [] }; delay = 500; }
    else { payload = {}; delay = 500; }

    const content = JSON.stringify(payload);
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    }, delay);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  logLine({ boot: true, port: PORT, kdelay: KDELAY, rdelay: RDELAY });
  console.log(`stub-model up on 127.0.0.1:${PORT} log=${LOG}`);
});
