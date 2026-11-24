// LOCUS Site 业务代理 —— Qoder Sites 单函数入口（逻辑名 app）。
// 前端只请求本站 /functions/v1/app/*；本函数再请求**独立 HTTPS 后端** BACKEND_BASE_URL。
//
// 白名单：**逐条绑定「方法 + 路径」**（不自造前缀放行）。规则由「前端实际调用（public/lib/api.js）
// × 后端路由（server.ts）」对照五步流程得出；未列出的组合一律拒绝：
//   - 方法不属于 GET/POST/HEAD/OPTIONS → 405
//   - 方法+路径无匹配规则           → 404
// 模型配置/测试/列模型与恢复端点**不在白名单内**（等价禁用），评审不能改模型、不能让后端访问任意上游。
// 服务端凭据仅经 x-locus-site-token 头注入（来自服务端环境，不来自客户端）；透传 Cookie（会话隔离依赖）。
// 自包含无依赖；入口见 index.ts（Deno.serve(handler)）。

const BACKEND = (Deno.env.get("BACKEND_BASE_URL") ?? "").replace(/\/+$/, "");
const TOKEN = Deno.env.get("SITE_SERVER_TOKEN") ?? "";
const MAX_BODY = 60 * 1024 * 1024; // 60MB（上传经 base64 JSON 通道）

type Rule = { m: "GET" | "POST"; re: RegExp };

// ── 逐条白名单：方法 + 路径正则（来源：前端 api.js 的真实调用）──────────────
const RULES: Rule[] = [
  // 只读 / 溯源
  { m: "GET", re: /^\/api\/state$/ },
  { m: "GET", re: /^\/api\/ai\/status$/ },
  { m: "GET", re: /^\/api\/jobs\/[^/]+$/ },
  { m: "GET", re: /^\/api\/source\/[^/]+$/ },
  { m: "GET", re: /^\/api\/originals\/[^/]+$/ },
  { m: "GET", re: /^\/api\/backtrace$/ },
  { m: "GET", re: /^\/api\/export\/all\.zip$/ },
  { m: "GET", re: /^\/api\/reports\/[^/]+\/export\.docx$/ },
  { m: "GET", re: /^\/api\/reports\/[^/]+\/traceability\.zip$/ },
  { m: "GET", re: /^\/api\/templates\/[^/]+\/check$/ },
  { m: "GET", re: /^\/api\/analysis\/map$/ },
  { m: "GET", re: /^\/api\/analysis\/tasks\/[^/]+\/map$/ },
  // 知识命名空间（只读）
  { m: "GET", re: /^\/api\/knowledge\/container$/ },
  { m: "GET", re: /^\/api\/knowledge\/view$/ },
  { m: "GET", re: /^\/api\/knowledge\/items\/[^/]+$/ },
  { m: "GET", re: /^\/api\/knowledge\/runs\/[^/]+$/ },
  { m: "GET", re: /^\/api\/knowledge\/datasets\/[^/]+\/rows$/ },
  { m: "GET", re: /^\/api\/knowledge\/snapshots\/[^/]+$/ },
  { m: "GET", re: /^\/api\/knowledge\/snapshots\/[^/]+\/export$/ },
  { m: "GET", re: /^\/api\/knowledge\/references\/[^/]+$/ },
  // 课题 / 子问题
  { m: "POST", re: /^\/api\/topics$/ },
  { m: "POST", re: /^\/api\/topics\/[^/]+\/subquestions$/ },
  // 材料导入
  { m: "POST", re: /^\/api\/import\/literature$/ },
  { m: "POST", re: /^\/api\/import\/measurements$/ },
  { m: "POST", re: /^\/api\/import\/file$/ },
  { m: "POST", re: /^\/api\/import\/image$/ },
  // 文献 / 论文
  { m: "POST", re: /^\/api\/papers$/ },
  { m: "POST", re: /^\/api\/papers\/import-bibliography$/ },
  { m: "POST", re: /^\/api\/papers\/[^/]+\/update$/ },
  { m: "POST", re: /^\/api\/papers\/[^/]+\/attachments$/ },
  { m: "POST", re: /^\/api\/papers\/[^/]+\/topics$/ },
  // 证据卡 / 选一次
  { m: "POST", re: /^\/api\/cards$/ },
  { m: "POST", re: /^\/api\/cards\/[^/]+\/review$/ },
  { m: "POST", re: /^\/api\/cards\/batch-preview$/ },
  { m: "POST", re: /^\/api\/cards\/batch-confirm$/ },
  { m: "POST", re: /^\/api\/adoptions$/ },
  { m: "POST", re: /^\/api\/mappings$/ },
  { m: "POST", re: /^\/api\/comparisons$/ },
  { m: "POST", re: /^\/api\/tables\/[^/]+\/review$/ },
  // 方案 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR
  { m: "POST", re: /^\/api\/protocols$/ },
  { m: "POST", re: /^\/api\/protocols\/parse$/ },
  { m: "POST", re: /^\/api\/protocols\/upload$/ },
  { m: "POST", re: /^\/api\/protocols\/[^/]+\/edit$/ },
  { m: "POST", re: /^\/api\/templates$/ },
  { m: "POST", re: /^\/api\/templates\/[^/]+\/confirm$/ },
  { m: "POST", re: /^\/api\/executions$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/preparation$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/confirm-preparation$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/save-as-protocol$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/events$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/events\/[^/]+\/edit$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/pause-assist$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/pause$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/resume$/ },
  { m: "POST", re: /^\/api\/executions\/[^/]+\/done$/ },
  { m: "POST", re: /^\/api\/samples$/ },
  { m: "POST", re: /^\/api\/samples\/[^/]+\/states$/ },
  { m: "POST", re: /^\/api\/samples\/[^/]+\/rename$/ },
  { m: "POST", re: /^\/api\/measurements$/ },
  { m: "POST", re: /^\/api\/measurements\/[^/]+\/edit$/ },
  { m: "POST", re: /^\/api\/impacts\/[^/]+\/run$/ },
  { m: "POST", re: /^\/api\/ocr$/ },
  { m: "POST", re: /^\/api\/ocr\/manual$/ },
  { m: "POST", re: /^\/api\/ocr\/[^/]+\/confirm$/ },
  // 分析任务 / 结果 / 报告 / 对话
  { m: "POST", re: /^\/api\/analysis\/tasks$/ },
  { m: "POST", re: /^\/api\/analysis\/tasks\/[^/]+\/candidates$/ },
  { m: "POST", re: /^\/api\/analysis\/tasks\/[^/]+\/recommend$/ },
  { m: "POST", re: /^\/api\/analysis\/tasks\/[^/]+\/result$/ },
  { m: "POST", re: /^\/api\/analysis\/results\/[^/]+\/edit$/ },
  { m: "POST", re: /^\/api\/reports$/ },
  { m: "POST", re: /^\/api\/reports\/[^/]+\/preview$/ },
  { m: "POST", re: /^\/api\/reports\/[^/]+\/apply$/ },
  { m: "POST", re: /^\/api\/reports\/[^/]+\/blocks\/[^/]+\/confirm$/ },
  { m: "POST", re: /^\/api\/reports\/[^/]+\/draft$/ },
  { m: "POST", re: /^\/api\/chats$/ },
  { m: "POST", re: /^\/api\/chats\/[^/]+\/send$/ },
  { m: "POST", re: /^\/api\/chats\/[^/]+\/messages\/[^/]+\/(cancel|retry|adopt)$/ },
  { m: "POST", re: /^\/api\/change-hits$/ },
  // 知识命名空间（写 / 审阅）
  { m: "POST", re: /^\/api\/knowledge\/jobs$/ },
  { m: "POST", re: /^\/api\/knowledge\/jobs\/[^/]+\/(cancel|pause|resume)$/ },
  { m: "POST", re: /^\/api\/knowledge\/jobs\/[^/]+\/retry-chunk$/ },
  { m: "POST", re: /^\/api\/knowledge\/items\/[^/]+\/update$/ },
  { m: "POST", re: /^\/api\/knowledge\/items\/[^/]+\/review$/ },
  { m: "POST", re: /^\/api\/knowledge\/contexts\/[^/]+\/update$/ },
  { m: "POST", re: /^\/api\/knowledge\/contexts\/[^/]+\/review$/ },
  { m: "POST", re: /^\/api\/knowledge\/evidence\/[^/]+\/resolve$/ },
  { m: "POST", re: /^\/api\/knowledge\/cards\/[^/]+\/structure$/ },
  { m: "POST", re: /^\/api\/knowledge\/themes$/ },
  { m: "POST", re: /^\/api\/knowledge\/themes\/[^/]+\/update$/ },
  { m: "POST", re: /^\/api\/knowledge\/statements$/ },
  { m: "POST", re: /^\/api\/knowledge\/datasets$/ },
  { m: "POST", re: /^\/api\/knowledge\/datasets\/[^/]+\/update$/ },
  { m: "POST", re: /^\/api\/knowledge\/datasets\/[^/]+\/review$/ },
  { m: "POST", re: /^\/api\/knowledge\/mappings$/ },
  { m: "POST", re: /^\/api\/knowledge\/mappings\/[^/]+\/update$/ },
  { m: "POST", re: /^\/api\/knowledge\/mappings\/[^/]+\/review$/ },
  { m: "POST", re: /^\/api\/knowledge\/comparisons$/ },
  { m: "POST", re: /^\/api\/knowledge\/snapshots$/ },
  { m: "POST", re: /^\/api\/knowledge\/source-policies$/ },
];

// 显式禁列（不在 RULES 中，等价 403 语义；此处仅用于给出明确错误码与自检）：模型配置类 + 恢复。
const DISABLED = new Set([
  "/api/ai/config", "/api/ai/test", "/api/ai/models", "/api/restore",
]);

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  // Edge 活性检查：**只证明 Edge 自己活着**，不触后端（后端可达性另由真实业务请求验证）。
  if (p.endsWith("/healthz")) return json(200, { ok: true, edge: "alive" });

  if (!BACKEND || !TOKEN) return json(503, { error: "service_not_configured" });

  const idx = p.indexOf("/api/");
  if (idx < 0) return json(404, { error: "not found" });
  const apiPath = p.slice(idx);

  const method = req.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204 });
  if (!["GET", "POST", "HEAD"].includes(method)) return json(405, { error: "method not allowed" });

  if (DISABLED.has(apiPath) || [...DISABLED].some((d) => apiPath.startsWith(d + "/"))) {
    return json(403, { error: "forbidden" });
  }
  const rm = method === "HEAD" ? "GET" : method;
  if (!RULES.some((r) => r.m === rm && r.re.test(apiPath))) {
    return json(404, { error: "unknown route" });
  }

  const headers = new Headers();
  for (const h of ["content-type", "cookie", "accept", "accept-language"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("x-locus-site-token", TOKEN); // 服务端凭据（非客户端可控）

  let body: ArrayBuffer | undefined;
  if (method === "POST") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY) return json(413, { error: "payload too large" });
    body = buf;
  }

  let up: Response;
  try {
    up = await fetch(BACKEND + apiPath + url.search, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return json(502, { error: "upstream_unreachable" });
  }

  const out = new Headers();
  for (const h of ["content-type", "content-disposition", "cache-control", "etag"]) {
    const v = up.headers.get(h);
    if (v) out.set(h, v);
  }
  // 会话 Cookie 透传（会话隔离依赖；后端不设 Domain，浏览器按本站 origin 作用域）
  const setCookies = (up.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of setCookies) out.append("set-cookie", c);

  return new Response(up.body, { status: up.status, headers: out });
}
