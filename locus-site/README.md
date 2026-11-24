# LOCUS Site 接入工程（准备态，未创建/未发布）

> 目标链路：`评委浏览器 → Qoder Site（静态页面 + 单函数 app 代理） → 独立 HTTPS 后端（BACKEND_BASE_URL）→ Node 127.0.0.1`
> 前端**只请求 Site**（同源 `/functions/v1/app/*`）；Site 的 `app` 函数再请求后端。主机待定不影响本工程。

## 目录

```
site/
  functions/
    index.ts        # Qoder Sites 单函数入口：Deno.serve(handler)
    handler.ts      # 代理实现（白名单/禁用/凭据/透传 Cookie，自包含无依赖）
  dev/function-local.ts   # 本机 Deno 校验入口（不打进发布包）
  web-overlay/site-shim.js  # 前端 shim：/api/* → /functions/v1/app
  build-web.mjs     # 由 LOCUS public/ 生成 web/ 并注入 shim
  web/              # 生成物（勿手改；由 build-web.mjs 产出）
```

## 1) 生成前端 web/

```bash
node build-web.mjs "F:/Qoder dev competition/sciworkbench/public"
# 产出 ./web：整份 LOCUS 前端 + site-shim.js，并在 index.html 的 <head> 注入 shim
```
> shim 只做两件事：把 `fetch('/api/...')` 与 `href="/api/..."`（原件下载）改写到 `/functions/v1/app/api/...`。不改 app.js / lib/api.js。

## 2) Qoder Sites 准备输入（发布前）

- `functionDirectory = functions`（逻辑名 `app`，运行时 `edge`，入口 `index.ts`）。
- `webDirectory = web`（静态站点，`index.html`）。
- `spa = false`（本项目为多文件静态站，非 SPA）。
- `secretNames = ["BACKEND_BASE_URL", "SITE_SERVER_TOKEN"]`（函数经 `Deno.env.get` 读取）。
  - `BACKEND_BASE_URL`：后端根地址（如 `https://<target-host>`），**唯一需要改的接入点**。
  - `SITE_SERVER_TOKEN`：Site→后端服务端凭据（随机串）。
  - 值在 Portal Settings 的专用输入里填写；**不进源码/参数/聊天/前端**。

## 3) 后端（独立 HTTPS 主机）环境

```bash
LOCUS_COMPETITION=1            # 竞赛模式：缺 LOCUS_SITE_TOKEN 则拒绝启动
LOCUS_SITE_TOKEN=<与 SITE_SERVER_TOKEN 相同>
LOCUS_SESSION_ISOLATION=1      # 每会话独立工作区（Cookie locus_sid）
LOCUS_DATA=<持久盘>/state.json
# 模型：LOCUS_AI_BASE_URL / LOCUS_AI_MODEL / LOCUS_AI_KEY（Key 由你私网注入，不入盘/日志）
```
- 后端已实现：配置令牌后，`/api/*` 无 `x-locus-site-token` 头 → **401**；`/healthz` 与静态资源不受限。

## 4) 白名单：逐条「方法 + 路径」（已落实到 `handler.ts` 的 `RULES`）

- 规则由「前端实际调用（`public/lib/api.js`）× 后端路由（`server.ts`）」对照五步流程得出，**逐条绑定方法与路径**（不用前缀放行）：
  - 方法不属于 `GET/POST/HEAD/OPTIONS` → **405**；`OPTIONS` → 204。
  - 方法+路径无匹配规则 → **404**（新增接口**不会**被旧前缀自动放行）。
- **不在白名单 = 禁用**：模型配置/测试/列模型（`/api/ai/config|test|models`）与 `/api/restore` 显式 **403**。
  → 评委不能改模型、不能令后端访问任意上游、不能触发恢复。
- 会话：透传 `Cookie` 与 `Set-Cookie`（后端 `locus_sid` 不设 Domain，按本站 origin 生效）。
- 竞赛页面：构建时**收掉「AI 配置」入口**（`build-web.mjs` 静态移除按钮 + shim CSS 兜底），避免评委打开必然失败的表单。

## 5) 待验证（目标机确定后）

- `deno check functions/index.ts`（当前环境无 Deno，未跑）。
- **后端可达性**：Site 的 `/healthz` **只证明 Edge 自己活着**（不触后端，后端地址填错也会 200）。
  需从**实际发布的预览站**发起一条**确实到达目标 Node** 的业务请求（如 `GET /api/state` 经函数转发）作为证据。
- 从**实际发布的预览站**验证：上传（base64 大包）、会话 Cookie 往返、原件下载字节一致。
- 双会话跑公开样本五步（隔离 + 全链路）；无登录状态入口、公网链路、限流/访问策略。
- `handler.ts` 的本地 24 项代理测试（白名单/禁用/透传）保留为**回归证据**（Deno 不在时的 Node 等价核验）。

## 红线

- 凭据只存 Site Secrets 与后端受限配置；不进浏览器/源码/报告/日志。
- 浏览器与上传内容不能指定后端访问本机/私网/任意上游（后端只认固定 `BACKEND_BASE_URL`，函数仅转发 `/api/*` 白名单）。