# display 模块 · 展示模式数据适配器（B 交付，S09-T18）

把 A 的静态快照接进**原工作台**（`sciworkbench/public/app.js`）：公开展示构建打开 `/` 时仍由原工作台启动，
读层换成这里产出的只读 api，从 Site 托管的静态快照取数，**无需 Node、无业务 API 请求**。

本目录只做数据层，不引入 `demo-app.js` 的整页外壳、不碰公共入口 `index.html` / `app.js`。

## 模块路径

```
locus-site/web-overlay/display/
  display-api.js              唯一交付：displayConfig() / createDisplayApi()
  tests/display-api.test.mjs  11 项单测：真实 demo-data 断言返回形态、引用不悬空、缺项报错、无 /api
  README.md                   本文件
```

依赖（只读复用，不修改）：

- `../demo/a-snapshot.js` 的 `loadASnapshot({ baseUrl })`：多文件装载，组合成适配器快照。
- `../demo/snapshot-adapter.js` 的 `createDemoData(snapshot, { topicId })` 与 `DemoMissingError`：只读查询与缺项错误。

## 导出接口

```js
export function displayConfig(win = window)   // 解析 window.__LOCUS_DISPLAY__ → 对象 | null
export async function createDisplayApi({ baseUrl, topicId, zipUrl, fetch } = {})
```

`createDisplayApi` 返回**已冻结**的只读对象，方法名/签名对齐 `sciworkbench/public/lib/api.js` 读接口子集：

| 方法 | 返回形态（与在线一致） | 数据来源 |
| --- | --- | --- |
| `getState()` | `LocusState`（topics/subquestions/assets/papers/attachments/cards/tables/adoptions/mappings/comparisons/templates/protocols/executions/samples/measurements/impacts/ocrs/analysisTasks/analysisResults/reports/chats + knowledge 均为数组） | `state.json` 为主体，`knowledge` 用 `knowledge.json` 派生结果覆盖；附 `display` 元信息 |
| `getSource(assetId)` | `{ asset, points[] }`，`points[] = { id, kind:"card"\|"table", locate }` | `state.json` 的 assets/cards/tables |
| `backtrace(kind, id, dir)` | `{ ok, start:{kind,id}, nodes[], edges[], downstreamByKind, pending[] }` | `references.json` 真实网络（缺则 adapter 由 state 派生） |
| `knowledgeItem(id, revision, topicId?)` | `{ ok, id, revision, payload, availableRevisions[] }` | `knowledge.json` 严格按 `version` 读取 |
| `aiStatus()` | `{ configured:false, baseUrl:"", model:"预生成", timeoutMs:0 }` | 固定占位，**不请求后端** |
| `getJob(id)` | `{ id, status:"error", error:"展示模式不提供后台任务（只读）", message:"展示模式" }` | 固定占位，**不请求后端** |
| `contextMap(taskId)` | 该任务实跑上下文图（含 `scope/nodes/edges/gaps`） | `context-map.json` 的 `mapTask`（按 `scope.taskId` 归位） |
| `zipInfo()` | `{ fileName, sha256, url }`，`url` 优先注入的 `zipUrl` | `manifest/SHA256SUMS` 派生的 `state.demo.zip` |
| `suggestions()` | 下一步指导数组（1~2 条，含 `basis`） | `next-steps.json` 派生的 `state.demo.suggestions` |

> 三个展示增量方法缺项时一律抛 `DemoMissingError`：`contextMap` 无该任务、`zipInfo` 无文件名/校验、`suggestions` 为空。

- 任一处缺项一律抛 `DemoMissingError`（`code:"DEMO_MISSING"`，带 `path`/`reason`），**不补造数据**。
- 任何方法都不请求 `/api/...`；只读 `baseUrl` 下的静态文件（单测断言开启）。

## 快照字段映射（A 文件 → 展示态）

| A 文件 | 消费内容 | 展示落点 |
| --- | --- | --- |
| `snapshot/state.json` | `LocusState` 顶层集合 | `getState()` 主体；`getSource()` 原件与定位点 |
| `snapshot/knowledge.json` | 知识条目扁平结构 | 派生为带 `payload` 的知识信封 → `state.knowledge.items`；`knowledgeItem()` 严格按版本 |
| `snapshot/references.json` | 真实引用网络 `nodes/edges` | `backtrace()` 起点与可达节点 |
| `snapshot/manifest.json` | `projectId/schemaVersion/fixtureVersion/sourceCommit/generatedAt` | `display.*` 元信息、固定主课题 |
| `snapshot/context-map.json` / `next-steps.json` / `ai-products.json` / `SHA256SUMS.txt` | 上下文图、下一步、AI 产物登记、ZIP 校验 | 由 `a-snapshot.js` 装入 `state.demo`；`contextMap()` / `suggestions()` / `zipInfo()` 分别暴露，`state.demo` 仍完整保留 |

`state.display` 附加字段：`{ mode:"display", readOnly:true, mainTopicId, topicId, schemaVersion, fixtureVersion, sourceCommit, projectId, generatedAt }`。

## 与 app.js 的接线点（D 负责）

`app.js` 已消费下列读接口，接线时用 `createDisplayApi` 的只读实现替换在线实现即可，**视图代码零改动**：

| 调用点 | 位置 | 说明 |
| --- | --- | --- |
| `api.getState()` | `app.js:611` `refresh()`（由 `bootstrap()` 于 `:603` 首次调用） | 第一次状态读取前必须先构造好展示 api；`refresh()` 默认选中 `state.topics[0]`（=`display.mainTopicId`） |
| `api.getSource(assetId)` | 原件查看 | 返回 `{asset, points}`，与在线 `sourceView` 同形 |
| `api.backtrace(kind,id,dir)` | `lib/pages/analysis.js:358` 报告块「回查」 | 需要 `nodes` 与 `pending`（已补齐） |
| `api.knowledgeItem(id,rev,topicId)` | `lib/pages/knowledge.js:695` 旧版回查 | 严格按版本，缺版报错 |
| `api.aiStatus()` | `app.js:2574` `refreshAiState()` | 固定 `configured:false / model:"预生成"` |
| `api.getJob(id)` | `app.js:1239`、`knowledge.js:397` 轮询 | 固定终态 `error`，任何轮询立即停止 |

`state.mappings / impacts / ocrs / adoptions` 由 `state.json` 补齐（本快照为空数组），避免 `app.js:1105/1476/1768` 等无守卫访问崩溃。

## D 接线参数

**模块路径**：`locus-site/web-overlay/display/display-api.js`（随 Site 构建为静态资源；按构建输出调整 import 相对路径）。

**调用方式**（在 `app.js` 第一次 `api.getState()` 之前）：

```js
import { displayConfig, createDisplayApi } from "./web-overlay/display/display-api.js"; // 路径按构建布局调整
import { api as onlineApi } from "./lib/api.js";

const cfg = displayConfig(); // 公开展示构建注入 window.__LOCUS_DISPLAY__ 才有值；本地/trial 为 null
const api = cfg
  ? await createDisplayApi({ baseUrl: cfg.baseUrl ?? "/demo-data", topicId: cfg.topicId, zipUrl: cfg.zipUrl })
  : onlineApi;
// 之后 bootstrap()/refresh() 等一律走 api
```

> `app.js` 现以 `import { api }` 单例调用读接口。若不便改 import，D 可在启动时把这些只读方法覆盖到现有 `api` 对象上：
> `{ getState, getSource, backtrace, knowledgeItem, aiStatus, getJob, contextMap, zipInfo, suggestions }` 来自 `await createDisplayApi(...)`。

**配置对象 `window.__LOCUS_DISPLAY__` 字段**：

```js
window.__LOCUS_DISPLAY__ = {
  baseUrl: "/demo-data",          // 静态快照目录（站点路径）；默认 "../demo-data"
  topicId: "topic_f6bff443-…",    // 可选：固定预存课题；缺省用 manifest.projectId
  zipUrl: "/demo-data/locus-demo-public.zip", // 可选：zipInfo().url 覆盖；缺省用快照内置 url
  label: "展示课题 · 只读",        // 可选：UI 文案（由 D 渲染，本模块不画 UI）
  mode: "display",                // 可选：信息字段
  readOnly: true,                 // 可选：信息字段
};
```

`displayConfig()` 兼容对象字面量与 JSON 字符串两种注入形式；解析失败或未注入返回 `null`（走在线 api）。

## 已知缺项 / 边界

- **只实现读子集**：`api.js` 里的写/上传/解析/对话/保存等方法本模块不提供。展示模式下 D 需收起或禁用这些入口（手册 §B.5）。
- **`getJob` 为固定终态错误**，不提供任何进度；展示模式不触发后台任务。
- **上下文图 / 下一步 / ZIP** 已由 `contextMap(taskId)`、`suggestions()`、`zipInfo()` 暴露（接口扩展经协调者批准）；`getState()` 仍完整保留 `state.demo`，D 可从二者任一取 E4/E5 所需数据。
- **`ocrs / mappings / impacts / adoptions`** 取自 `state.json`，当前快照为空数组；非补造，A 导出若有则原样带上。
- **原件外部链接**：`state.json` 的 `assets[].text` 优先内嵌原文；外链由 `manifest.originals` 提供（在 `state.demo.sources`）。
- **旧展示链接兼容**（`/demo/demo.html` 重定向到原工作台）：属 D 的公共入口接线，不在本模块范围。
- **未做浏览器端联调**：本模块只交付数据层并以单测验证；真实工作台渲染由 D 接线后由 E 走查。
