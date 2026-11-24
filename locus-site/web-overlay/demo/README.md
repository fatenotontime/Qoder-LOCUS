# demo 模块 · 公开展示流水线与逐页交互（B 交付）

面向评委的**只读**公开展示入口：直接进入暖色预置课题，按「文献库 → 科研内核 → 下一步指导」体验；卡片与结果可点开，引用能回到原件；**无后端、无登录、无模型网关**也能走完主线。本模块不碰公共入口，由 D 挂载。

当前已接入 **A 的正式包**（`locus-site/demo-data/`，`verificationStatus=verified-local`）并用本地静态站逐页验证。

## 模块路径

```
locus-site/web-overlay/demo/
  demo.html            独立展示页（<html data-theme="paper">，链 ../styles.css + ./demo.css）
  demo-app.js          入口：initDemo(options)；hash 路由 + 三栏渲染 + 事件委托
  a-snapshot.js        装载器：把 A 的 demo-data 多文件结构搬运成适配器快照（只搬不改）
  snapshot-adapter.js  只读快照适配器（唯一数据出口，无写方法）
  demo.css             demo-* 壳与页内组件（复用 paper 主题变量）
  READ_PATHS.md        B.1 读路径盘点（真实调用、返回形态、A 数据落点）
  dev-serve.mjs        本地静态自测服务（仅开发用，不进发布包）
  fixture/snapshot.json 自造夹具（仅供适配器单测，页面不再使用）
  tests/               24 项单测：adapter（夹具）＋ a-snapshot（A 正式包）
```

## 初始化入口与参数

```js
import { initDemo } from "./demo-app.js";
import { loadASnapshot } from "./a-snapshot.js";

const handle = await initDemo({
  root: document.querySelector("#locus-demo-root"),
  loader: () => loadASnapshot({ baseUrl: "/demo-data", zipUrl: "/demo-data/locus-demo-public.zip" }),
  // 也可：snapshot: <已装载快照>  或  dataUrl: "/demo-data/snapshot.json"（单文件快照）
  topicId: "topic_f6bff443-…", // 可选：覆盖主课题
  silent: false,
});
```

- `loader` / `snapshot` / `dataUrl` 三选一；`demo.html` 默认用 `loader: loadASnapshot({ baseUrl: "../demo-data" })`。
- 返回 `{ navigate, render, data }`；`data` 是只读适配器 API。
- 缺项一律抛 `DemoMissingError`（`code:"DEMO_MISSING"`，带 `path`/`reason`），页面就地显示「缺项 + 具体原因」，**不渲染假数据**。

## 数据接口（实际对接 A 的目录）

`a-snapshot.js` 按下列**明确文件**装载（缺文件即报缺项）：

| A 文件 | 用途 | 展示落点 |
| --- | --- | --- |
| `snapshot/state.json` | `LocusState`（topics/papers/assets/cards/tables/protocols/executions/samples/measurements/analysisTasks/analysisResults/reports/chats） | 全站主体；`getState` 同源 |
| `snapshot/knowledge.json` | 知识条目（10 项，扁平结构）+ 跨来源比较 | 派生为带 `payload` 的知识信封；比较按 A 形状渲染（sides / commonMetric / conditionDiff / unknownFields / caveat） |
| `snapshot/context-map.json` | `mapTask`（13 节点/18 边，实跑）/ `mapPre` | 分析页上下文地图，**原样使用，不现场合成** |
| `snapshot/references.json` | 真实引用网络（34 节点/75 边） | `backtrace` 直接使用该网络 |
| `snapshot/next-steps.json` | 2 条下一步（分歧/缺口→补什么→区分什么→仍不确定） | 首页右栏「下一步指导」，含可点证据卡 |
| `snapshot/ai-products.json` | `modelRunThisSession=false`，逐项 unverified | `preset.ai=false`、页脚「未调用（未授权）」 |
| `snapshot/manifest.json` | 版本、原件清单（assetId→文件/许可/SHA-256） | 页头元信息；原件外链与许可 |
| `SHA256SUMS.txt` | ZIP 校验值 | 「下载样本 ZIP」按钮与 `demo.zip.sha256` |

硬性要求（已实现）：
- `assets[].text` 存在时**优先内嵌原文**；`manifest.originals` 的外链只作来源标注（Public Domain）。
- 卡片定位用 `card.locator.sectionQuote`（逐字英文引文），不是中文摘要 `rawText`。
- 知识项按 `version` 严格读取，缺版报缺项；容器未导出即报缺项（不伪造 token）。
- 模型本轮未运行：`preset.ai=false`，对话/建议标「人工整理」「待验证」，不冒充预生成。

### 如改为单文件快照

适配器也接受「`LocusState` 根 + `demo` 扩展块」的单文件（见 `fixture/snapshot.json` 示例）。此时 `demo.contextMaps[taskId]`、`demo.zip`、`demo.suggestions` 等须由导出方提供；缺失即报缺项。

## 覆盖的只读路由（详见 READ_PATHS.md）

| 展示位置 | 读取路径 | 数据落点 |
| --- | --- | --- |
| 全站 | `getState` | `snapshot/state.json` |
| 文献·定位 | `getSource(assetId)` | 由 `cards/tables` 派生，同 `services/app.ts:774` |
| 文献·原件 | `originalUrl` | `manifest.originals` + `assets[].text` |
| 回查 | `backtrace(kind,id,dir)` | `snapshot/references.json` |
| 知识·按版本 | `knowledgeItem(id, revision)` | `snapshot/knowledge.json` → 信封 |
| 知识·容器 | `knowledgeContainer()` | 未导出 → 报缺项 |
| 分析·地图 | `analysis/tasks/:id/map` | `snapshot/context-map.json.mapTask` |

**不触碰**：写接口、`/api/ai/*`、`/api/jobs/*`、`/api/restore`、`/functions/v1/app/*`。适配器无 `create/update/review/...` 写方法（单测断言），页面实测无 `/api` 请求。

## 逐页交互（B.2–B.6）

- **文献库优先**：左＝论文条目，中＝原始材料（逐字高亮），右＝证据卡（默认折叠：标题/出处/审阅状态；点开看条件、数据/论据、出处定位、知识条目关系）。「对比视图」按 A 的两侧比较显示，可「看这张卡」或「回查原文」。
- **内核可见**：方案页先图后步骤（图按 `computeLanes` 相对时间布局，点节点看条件/来源）；执行页先执行与测量，再按「偏差/样品/数据表」看明细；分析页先结果，再上下文地图（实跑 13 节点）、方法/版本/原始表/原件。
- **下一步与对话**：右栏 1–2 条建议，点「查看依据」展开四类依据并附可点证据卡；对话展示预生成消息，来源可点回对象；`preset.ai=false` 时标「人工整理」而非「预生成」。
- **迹芽**：右栏复用既有 `aiSproutHtml`；`knowledge.extractionRuns` 为空（A 本轮无抽取回执）→ 显示「没有真实任务回执，迹芽待机」，不画进度。素材未改动。
- **无服务边界**：左栏底部「在线试玩待开放」折叠块（解释一次）；上传/写入/即时解析/实时对话均收起；加载失败显示「展示加载失败 + 路径/原因 + 重试 + 下载样本 ZIP」。

## 需要 D 在共享入口做的接线点

1. **生成目录**：把 `web-overlay/demo/` 复制进发布 `web/demo/`；把 A 的 `locus-site/demo-data/` 复制为发布 `web/demo-data/`（含 `snapshot/`、`originals/`、`locus-demo-public.zip`、`SHA256SUMS.txt`）。demo 内相对路径 `../styles.css`、`../lib/*`、`../demo-data/*` 与该布局对齐。
2. **入口**：发布 `web/demo/demo.html`（已自动 `initDemo` + `loadASnapshot`）；或在内嵌容器 `<div id="locus-demo-root" data-demo-auto>` 处加载 `demo-app.js`。
3. **模式识别**：`build-web.mjs` 公开构建选中主课题、可把入口指向 `demo/demo.html`；不改 `demo/` 内文件。
4. **依赖不变量**：`demo/` 依赖 `lib/lanes.js`、`lib/format.js`、`lib/pages/knowledge-stage.js`（构建须保留）；主题固定 `paper`（C 负责）。
5. ZIP 入口指向 `web/demo-data/locus-demo-public.zip`；如路径不同，用 `loadASnapshot({ zipUrl })` 或 `initDemo` 参数覆盖。

## 给 E 的三条点击路径

1. **文献双引用**：`#/papers` → 右栏任选一张已确认卡 → 「在原文中定位」（中间英文原文逐字高亮）→ 中间「对比视图」→「静水实验 vs 真实海水」任一侧点「回查原文」→ 命中该侧引文；「看这张卡」回到卡详情。卡片 `card_8a4e4db2…` 为「干燥榛子漂 90 天」已确认卡。
2. **报告回查**：`#/analysis?task=atask_9cf2587e…` → 右栏 4 个报告块，块内引用卡片点「回查」→ 文献卷定位到对应卡/原文；块引用执行/表时跳记录卷。
3. **下一步指导**：`#/topic` → 右栏「在真实海浪/干湿交替条件下复测…」→「查看依据」→ 展开四类依据，底部证据卡 chip 可点回文献卷。

## 自测

```bash
node --test locus-site/web-overlay/demo/tests/   # 24 项（adapter 13 + a-snapshot 11）
node locus-site/web-overlay/demo/dev-serve.mjs 8788   # 本地静态站（/demo-data 指向 A 正式包）
# http://127.0.0.1:8788/demo/demo.html
```

- 实测（离屏浏览器，A 正式包）：全站无 `.demo-miss`、无控制台错误；文献定位/对比回查命中；知识项按第 2 版读取并回查引文；方案图 4 节点可点；执行 3 分项与 10 行表；分析地图 13 节点、报告 4 块回查有效；对话 2 条；下一步依据 2 条、证据 chip 可点；无任何 `/api` 或 `/functions` 请求；ZIP 按钮可用（哈希取自 `SHA256SUMS.txt`）。
- **未测**：截图（本环境无可见画布，未取证）；1280/1024/390 窄屏布局（属 C/E）；A 的 `docs/五步走查.md` 全流程走查；ZIP 实际解包哈希复核（属 E）。
