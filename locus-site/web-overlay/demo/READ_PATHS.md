# B.1 读路径盘点（基线 `8120986`）

> 逐条核对当前提交里公开展示会触及的只读读取路径、返回形态与缺口处理。
> 结论：公开端**只**按下列明确路径匹配；未列路径一律报「缺项」，不包装接受更新的假 API。
> 引用行号取自 worktree `feat/s08-b-demo-web` 基线工作树。

## 1. 当前应用的真实读路径

| 名称 | 调用处 | 请求 | 返回形态 | 公开端处理 |
| --- | --- | --- | --- | --- |
| `getState` | `sciworkbench/public/app.js:611` → `lib/api.js:3` | `GET /api/state` | 整份 `LocusState`：`version` + `topics/subquestions/assets/papers/attachments/cards/tables/adoptions/mappings/comparisons/protocols/templates/executions/samples/measurements/impacts/ocrs/analysisTasks/analysisResults/reports/chats/knowledge`（`sciworkbench/store.ts:579`） | 快照即一次冻结的 `LocusState`（外加 `demo` 扩展块）。适配器只读、`Object.freeze` 不改写。缺课题/缺主课题 → 报缺项。 |
| `getSource` | `lib/api.js:22`；服务端 `server.ts:731` | `GET /api/source/:assetId` | `SourceView = { asset: AssetRecord, points: {id, kind:"card"\|"table", locate}[] }`（`services/app.ts:774`） | 按 `assetId` 返回同形对象；素材不存在 → 抛 `DemoMissingError`。 |
| `originalUrl` | 前端无此字面量；原件读取有两条实路：① `state.assets[].text`（`getState` 内嵌正文）；② 站内原件下载链接 `href="/api/..."`，由 `locus-site/web-overlay/site-shim.js:26-37` 改写到 Site 函数 | 无独立接口 | 无 `originalUrl` 字段；可公开外链目前只藏在 `papers[].source` 文本里 | 公开端从 `snapshot.demo.sources[assetId].originalUrl`（A 导出）或 `papers[].source` 取合法外链；都没有 → 报缺项并给站内相对原件（`assets[].text`）。**不伪造 URL。** |
| `backtrace` | `lib/pages/analysis.js:358` → `lib/api.js:74`；服务端 `server.ts:515` | `GET /api/backtrace?kind=&id=&dir=` | `{ ok, start, nodes, edges, downstreamByKind, pending }`（`domain/backtrace.ts` 网络遍历） | 优先读 `snapshot.demo.backtrace[key]`（A 预导出）；缺省由快照内引用（附件/证据/结果/报告块）派生同名结构。起点对象不存在 → 报缺项。 |
| `knowledgeItem` | `lib/api.js:83`；服务端 `server.ts:563-591` | `GET /api/knowledge/items/:id?revision=&topicId=` | `{ ok, id, revision, payload, availableRevisions[] }`；`revision` 必填，读不到即 404（不退回最新版）；`topicId` 不符 422 | 严格按 `revision` 读包络版本；版本不存在 → 抛缺项（含可用版本号）。 |
| `knowledgeContainer` | 服务端 `server.ts:593`；`lib/api.js` **无封装**（当前前端未直接调用） | `GET /api/knowledge/container?topicId=&...` | `{ ok, viewId, scope, mode, elements[], totals, counts, undivided, byTheme, bySource, sources, cardIndex, dedupNote, warnings, hasMore, nextCursor }`（`services/knowledge-base.ts:2503`） | 仅当 A 在 `snapshot.demo.knowledgeContainer` 预生成时读取并展示；未提供 → 该路径报缺项，知识页改用 `knowledge.items` 明细（另一条明确路径），**不派发假容器 token**。 |
| 分析上下文地图 | 服务端 `server.ts:527`（建任务前）/`:534`（按任务）；前端 `lib/pages/analysis.js:77` | `GET /api/analysis/map?topicId=` / `GET /api/analysis/tasks/:id/map` | `ContextMap = { ok, scope, nodes[{key,kind,id,label,version?,external?,role,selectable,gaps[]}], edges[{from,to,edgeKind,establishedBy,note?}], gaps, truncated }`（`services/context-map.ts`） | **必须用实跑生成的图**：读 `snapshot.demo.contextMaps[taskId]`；缺失 → 报缺项 + 指向 `GET /api/analysis/tasks/:id/map` 的说明，**不现场合成**。 |
| 报告/结果/表格 | `app.js:936`、`lib/pages/analysis.js:176,136` | 均来自 `getState` 集合 | `reports[].blocks[].refs[]`（`kind/id/version/label`）、`analysisResults[].assetIds`、`tables[].rows/columns` | 直接消费快照集合；引用对象缺失 → 页内标缺项（不静默）。 |

## 2. 公开端不触碰的路径

以下路径一律**不调用**（无后端、无登录、无模型网关）：

- 所有 `POST/PUT/DELETE`：上传、导入、解析、审阅、采纳、执行记录、OCR、知识提取、报告改写、对话发送。
- `GET /api/ai/status|test|models`、`POST /api/ai/config`。
- `GET /api/jobs/:id`（任务轮询）、`/api/knowledge/runs|jobs`、`/api/restore`。
- 任何 `/functions/v1/app/*` 代理调用。

公开端界面上凡是需要上述能力的位置，一律收起并**解释一次**「在线试玩待开放」（见 `demo-app.js` 的 `boundaryNote()`）。

## 3. 缺口提示约定

- 适配器抛 `DemoMissingError(path, reason)`：`code = "DEMO_MISSING"`，带 `path` 与 `reason`。
- 页面捕获后在该栏显示可读提示 + 独立 ZIP 下载入口（`snapshot.demo.zip`）。
- 不存在的对象 ID、断开的引用、版本不符、缺字段，都必须显示**具体原因**（哪个对象、哪条路径），不渲染占位假数据。
