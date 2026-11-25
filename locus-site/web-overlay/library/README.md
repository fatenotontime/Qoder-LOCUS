# 文献库可视化 · 嵌入视图（S09）

在**既有三栏工作台内部**新增的「文献库」视图：论文条目列表 / 原文定位 / 证据卡展开 /
两端对照 / 引用回查。只读、自包含、不接管路由，不改动现有前端与主题。

## 文件

| 文件 | 作用 | 是否进发布产物 |
| --- | --- | --- |
| `library-view.js` | 渲染入口 `renderLibraryPane(container, { baseUrl })` | 是（`web/library/`） |
| `library-view.css` | 样式，全部 `.lv-` 前缀，复用 paper 主题变量 | 是 |
| `a-snapshot.js` | demo-data 多文件 → 适配器快照（结构搬运，缺文件报错） | 是 |
| `snapshot-adapter.js` | 只读适配器（`createDemoData`，无写方法，缺项抛 `DemoMissingError`） | 是 |
| `tests/adapter.test.mjs` | 适配器单测（`node --test` 可跑） | 否 |
| `tests/a-snapshot.test.mjs`、`tests/a-chains.test.mjs` | 正式包与两条业务链单测 | 否 |
| `tests/smoke-cdp.mjs` | 无头 Edge 冒烟与回归（开发自测） | 否 |

`a-snapshot.js` / `snapshot-adapter.js` 自 `web-overlay/demo/` 原样搬用（未改一行，`diff` 可证），
仅测试夹具相对路径按目录深度调整。

## 初始化参数

```js
import { renderLibraryPane } from "/library/library-view.js";
await renderLibraryPane(container, {
  baseUrl: "/demo-data",     // 快照根：读取 `${baseUrl}/snapshot/*.json`、`${baseUrl}/SHA256SUMS.txt`
  // fetch, zipUrl, topicId, snapshot 可选
});
```

- `container`：**给定容器**（既有的中栏 `#mid-content` 内 `#lv-mount`）。视图在其内部渲染，
  不产生自己的 `<html>` 外壳、不接管路由/hash。
- `baseUrl`：站点内快照路径。公开站点为 `/demo-data`。
- 返回 `{ render, data, navigate }`；`data` 为只读适配器实例。
- 缺项（对象/版本/来源缺失）调用适配器即抛 `DemoMissingError`，就地显示「缺项」原因，**不补造数据**。

## 数据路径

快照文件（`locus-site/demo-data/snapshot/`，构建时打包进 `web/demo-data/`）：
`state.json`、`knowledge.json`、`context-map.json`、`references.json`、`ai-products.json`、
`next-steps.json`、`manifest.json`；外链原件在 `originals/`，站内路径约定见
`locus-site/demo-data/docs/站内映射.md`。视图消费：`papers/attachments/assets/cards`（state）、
`knowledge.items`（卡片关系与引文）、`comparisons`、`references`（回查网络）。

## 与现有前端的接线点（全部为**新增**，不改既有行为）

1. `sciworkbench/public/lib/views.js`：`NAV_ITEMS` **末尾追加** `["library","文献库"]`；
   并新增 `NAV_CHARS.library`（字印「库」）与 `NAV_ICONS.library`。
2. `sciworkbench/public/app.js`：
   - `renderMiddle()` 内**新增**一个分支（`ui.nav === "library"`）——在 `#mid-content` 注入
     `#lv-mount` 并**动态 import** `/library/library-view.js` 渲染；失败仅影响本页。
   - `restoreUi()` 白名单数组**追加** `"library"`。
3. `locus-site/build-web.mjs`：**trial 与 public 两种模式**都复制
   `web-overlay/library/{library-view.js,library-view.css,a-snapshot.js,snapshot-adapter.js}`
   到 `web/library/`（照 settings 只复制运行必需文件；`tests/` 不进产物）。

无新增 `/api` 调用：视图只按 `baseUrl` 读取静态快照；无后端时以 demo-data 走只读展示。

## 自测

```bash
# 适配器单测（28 项）
node --test "locus-site/web-overlay/library/tests/*.test.mjs"

# 冒烟与回归（先构建 public 产物）
node locus-site/build-web.mjs "$(pwd)/sciworkbench/public" locus-site/web --mode=public
node locus-site/web-overlay/library/tests/smoke-cdp.mjs   # 证据见 tests/_evidence/
```

## 未完成 / 边界

- 视图为**只读展示**：审阅、导入、AI 提取等写操作不在此实现。
- `baseUrl` 由接线方写死为 `/demo-data`；若换快照根需改接线或传参。
- 冒烟脚本为开发自测，依赖本机 Edge 与固定端口（`WEB_PORT=8795`、`CDP_PORT=9336`），不随产物发布。
- 未做：深链（hash）定位到具体卡片/对照；多论文条目下的视图内筛选。
