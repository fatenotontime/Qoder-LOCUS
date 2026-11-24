# demo 模块 · 公开展示流水线与逐页交互（B 交付）

面向评委的**只读**公开展示入口：直接进入暖色预置课题，按「文献库 → 科研内核 → 下一步指导」体验；卡片与结果可点开，引用能回到原件；**无后端、无登录、无模型网关**也能走完主线。本模块不碰公共入口，由 D 挂载。

## 模块路径

```
locus-site/web-overlay/demo/
  demo.html            独立展示页（<html data-theme="paper">，链 ../styles.css + ./demo.css）
  demo-app.js          入口：initDemo(options)；hash 路由 + 三栏渲染 + 事件委托
  snapshot-adapter.js  只读快照适配器（唯一数据出口，无写方法）
  demo.css             demo-* 壳与页内组件样式（复用 paper 主题变量）
  READ_PATHS.md        B.1 读路径盘点（当前提交的 getState / getSource / originalUrl / backtrace /
                       knowledgeItem / knowledgeContainer / 分析上下文地图 调用与返回形态）
  dev-serve.mjs        本地静态自测服务（仅开发用，不进发布包）
  fixture/snapshot.json 接线夹具（fixture:true，待 A 正式快照替换）
  tests/adapter.test.mjs 适配器单测（node --test，13 项）
```

## 初始化入口与参数

```js
import { initDemo } from "./demo-app.js";
const handle = await initDemo({
  root: document.querySelector("#locus-demo-root"), // 必填：挂载容器
  dataUrl: "/demo-data/snapshot.json",              // 快照地址（默认同值）
  topicId: "TP1",                                   // 可选：覆盖主课题
  zipUrl: "/demo-data/sample.zip",                  // 可选：加载失败时的兜底 ZIP 入口
  silent: false,                                    // 可选：不弹载入提示
});
handle.navigate("papers", { paperId: "P1" });        // 可选：外部驱动路由
```

- 自动挂载：容器带 `data-demo-auto` 时，`demo.html` 内的模块脚本会自动调用 `initDemo`。
- 返回 `{ navigate, render, data }`；`data` 是适配器 API（只读）。
- 任何读取缺项都抛 `DemoMissingError`（`code:"DEMO_MISSING"`，带 `path` 与 `reason`），页面就地显示「缺项 + 具体原因」，**不渲染假数据**。

## B 消费契约（给 A / D）

快照 = 一次冻结的 `LocusState`（与 `GET /api/state` 同形，字段见 `sciworkbench/store.ts:579`）＋ 一个 `demo` 扩展块。`demo` 内为公开展示专用产物：

```jsonc
{
  "schemaVersion": 1, "fixtureVersion": "...", "sourceCommit": "...", "projectId": "...", "generatedAt": "...",
  "fixture": false,                 // true=接线夹具，页面显示醒目横幅
  "mainTopicId": "TP1", "version": 9,
  "topics": [...], "papers": [...], "assets": [...], "attachments": [...], "cards": [...], "tables": [...],
  "comparisons": [...], "protocols": [...], "executions": [...], "samples": [...], "measurements": [...],
  "analysisTasks": [...], "analysisResults": [...], "reports": [...], "chats": [...],
  "knowledge": { "items": [...], "contexts": [...], "evidence": [...], "relations": [...], "extractionRuns": [...] },
  "demo": {
    "mainProtocolId": "...", "mainExecutionId": "...", "mainTaskId": "...", "mainChatId": "...",
    "zip": { "fileName": "...", "sha256": "...", "sizeBytes": 0, "url": "/demo-data/xxx.zip" },
    "sources": { "A1": { "originalUrl": "https://...", "license": "CC BY 4.0", "provenance": "..." } },
    "contextMaps": { "AN1": { /* GET /api/analysis/tasks/:id/map 的原样结果 */ } },
    "knowledgeContainer": { /* 可选：GET /api/knowledge/container 的原样结果；缺省则知识页走 items 明细 */ },
    "suggestions": [ { "id": "...", "title": "...", "text": "...",
      "basis": { "divergence": [], "dataGaps": [], "distinguishing": [], "uncertainty": [] }, "aiPreset": true } ],
    "preset": { "ai": true, "model": "...", "generatedAt": "...", "reviewedBy": "..." }
  }
}
```

硬性要求：
- `demo.contextMaps[taskId]`：**必须是实跑生成的图**（`/api/analysis/tasks/:id/map` 结果）。缺失即报缺项，页面**不现场合成图**。
- `zip.url` 与 `zip.sha256`：正式快照必须给出；缺失时「下载样本 ZIP」按钮禁用并说明。
- `sources[assetId]`：可公开外链与许可；有站内 `assets[].text` 时优先内嵌原文，外链只作来源标注。
- 预生成内容都要有标识（`preset`、`aiPreset`、卡片 `extraction`/`audit`）；夹具内容在页面顶部显式标注。

## 覆盖的只读路由（全部映射到快照字段，见 READ_PATHS.md）

| 展示位置 | 读取路径 | 快照来源 |
| --- | --- | --- |
| 全站 | `getState` | 快照根对象 |
| 文献·原件定位 | `getSource(assetId)` | 由 `cards/tables` 派生，与 `services/app.ts:774` 同形 |
| 文献·原件 | `originalUrl` | `demo.sources[assetId]` / `assets[].text` |
| 报告/结果·回查 | `backtrace(kind,id,dir)` | `demo.backtrace`（可选）否则由快照引用派生 |
| 知识·按版本读 | `knowledgeItem(id, revision)` | `knowledge.items[].payload/history`（严格按版本，缺版报缺项） |
| 知识·容器 | `knowledgeContainer()` | `demo.knowledgeContainer`（缺省报缺项） |
| 分析·上下文地图 | `analysis/tasks/:id/map` | `demo.contextMaps[taskId]`（实跑图） |

**不触碰**：所有写接口、`/api/ai/*`、`/api/jobs/*`、`/api/restore`、`/functions/v1/app/*`。适配器无任何 `create/update/review/...` 写方法（单测断言）。

## 右栏展开与回溯行为

- **文献**：右栏列证据卡，默认折叠（只显示标题 / 出处 / 审阅状态）；点开显示条件、数据/论据、出处定位、知识条目关系。点「在原文中定位」在中间原文**逐字高亮**；中间「对比视图」显示比较分组，条目可「看这张卡」跳回。选中态用 `.active`，切换/返回后由 hash 恢复原课题与列表位置。
- **内核**：方案页**先图后步骤**（图由 `computeLanes` 画，点节点看条件/来源）；执行页**先执行与测量**再按「偏差/样品/数据表」看明细；分析页**先结果**再上下文地图（实跑图）、方法/版本/原始表/原件。
- **下一步指导**：只显示 1–2 条（`demo.suggestions` 截取前 2 条），点「查看依据」展开证据分歧 / 待补数据 / 可区分解释 / 不确定性。
- **对话**：直接展示预生成记录（`chats[].messages`），每条来源为可点引用；`status` 用「预生成」标签。
- **迹芽**：右栏复用既有 `aiSproutHtml`；**仅当 `knowledge.extractionRuns` 有真实回执时**才显示流水线，否则显示「待机，不画进度」。不制作/改动迹芽素材。
- **无服务边界**：左栏底部固定一个「在线试玩待开放」折叠块，解释一次；上传/写入/即时解析/实时对话（对话页另有内联块）默认收起。页面失败显示「展示加载失败 + 路径/原因 + 重试 + 下载样本 ZIP」。

## 需要 D 在共享入口做的接线点

1. **生成目录**：把 `web-overlay/demo/` 复制进发布 `web/demo/`，把 A 的正式快照放到 `web/demo-data/snapshot.json`（ZIP 放 `web/demo-data/`）。demo 内部用相对路径 `../styles.css`、`../lib/*`、`../demo-data/snapshot.json`，与 `web/` 布局对齐。
2. **入口**：两种接法任选——
   - 独立页：发布 `web/demo/demo.html`，`demo.html` 内 `<script type="module">` 已自动 `initDemo`；
   - 内嵌：在 `index.html`（或某入口页）放 `<div id="locus-demo-root" data-demo-auto data-data-url="/demo-data/snapshot.json">` 并加载 `demo-app.js`。
3. **模式识别**：`build-web.mjs` 在公开构建里选中主课题并（可选）把入口指向 `demo/demo.html`；不改 `demo/` 内文件。
4. **不变量**：`demo/` 依赖 `lib/lanes.js`、`lib/format.js`、`lib/pages/knowledge-stage.js`，构建须保留这些公共模块；theme 固定 `paper`（C 负责）。
5. 若把 `dataUrl`/`zipUrl` 改成别的路径，通过 `initDemo` 参数或 `data-data-url` 传入，不改代码。

## 给 E 的三条点击路径

1. **文献双引用**：`#/papers?paper=P1&att=AT1&card=C1` →（右栏）点「在原文中定位」→ 中间原文高亮该句；点中间「对比视图」→ 分组「漆酶最适／考察条件」→ 对 C2 行点「看这张卡」→ 跳到 P2 原文与 C2 卡。
2. **报告回查**：`#/analysis?task=AN1` → 右栏「分析初稿」块 B1 引用「执行 EX1」→ 点「回查」→ 记录卷（执行/偏差）；块 B2 引用「结果 R1」→ 点「回查」→ 分析卷结果与上下文地图。
3. **下一步指导**：`#/topic` → 右栏「先补齐同口径条件点再谈可比性」→ 点「查看依据」→ 展开四类依据（证据分歧 / 待补数据 / 可区分解释 / 不确定性）。

## 自测

```bash
node --test locus-site/web-overlay/demo/tests/adapter.test.mjs   # 适配器单测（13 项）
node locus-site/web-overlay/demo/dev-serve.mjs 8787              # 本地自测站
# 打开 http://127.0.0.1:8787/demo/demo.html
```

> 当前自测用的是 **`fixture/snapshot.json`（接线夹具，fixture:true）**，内容取自仓库内公开样本（CC BY），所有 AI/结果字段均标注「模拟 / 占位」。**正式验收须等 A 的正式快照合入后重跑**——本模块对 A 正式包的适配结果尚未验证。
