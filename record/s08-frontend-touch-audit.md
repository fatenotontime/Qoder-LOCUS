# S08/S09 前端风格改动审计（2026-11-24）

> 背景：用户要求是「加一个设置页 + 文献库可视化」，**不是重构现有前端**。
> 本文只读盘点 `8120986..ec475f9` 范围内所有会影响外观、布局、既有入口与主题的改动，供决定回退范围。

## 结论摘要

- 新增组件（设置折扇、文献库展示模块）符合要求，可保留。
- **超出「只新增」范围的改动共 4 类**：删除冷色主题（样式+素材）、删除既有 AI 配置抽屉与模型设置入口、删除换卷/重绘入口、公开构建把首页整体替换成独立演示页。
- 业务页面渲染与后端逻辑未改（知识/分析/执行/记录页的渲染代码未动）。

## 一、被删除或改写的既有界面（超出新增范围）

| # | 范围 | 文件 | 具体改动 | 提交 | 性质 |
| --- | --- | --- | --- | --- | --- |
| 1 | 冷色主题样式 | `sciworkbench/public/styles.css` | 删除全部 `[data-theme="tech"]` 规则与旧 AI 面板段，共 **-444 行** | `28e1705` | 删除既有风格 |
| 2 | 冷色阶段样式 | `sciworkbench/public/knowledge-stage.css` | 删除 `[data-theme="tech"] .kzstage*`，**-24 行** | `28e1705` | 删除既有风格 |
| 3 | 冷色素材 | `sciworkbench/public/assets/tech/*` | **删除 26 个文件（约 3.9M）**：场景图、光晕、图标、纹理 | `28e1705` | 删除既有素材 |
| 4 | 换卷印章（主题切换） | `sciworkbench/public/index.html` | 删除 `#theme-seal` 按钮（brand-seal） | `28e1705` | 删除既有入口 |
| 5 | 换卷/重绘入口 | `sciworkbench/public/index.html` | 删除 `#replay-theme`（重绘并换卷按钮） | `28e1705` | 删除既有入口 |
| 6 | 首屏主题脚本 | `sciworkbench/public/index.html` | 删除读取 `locus.theme.v1` 的首屏内联脚本 | `28e1705` | 删除既有行为 |
| 7 | AI 配置抽屉 | `sciworkbench/public/index.html` | 删除 `#ai-drawer` 整个 aside 与 `data-open-ai` 入口 | `28e1705` | 删除既有功能界面 |
| 8 | 模型设置入口 | `sciworkbench/public/index.html` | 删除左栏 `#ai-open`「模型设置」按钮 | `28e1705` | 删除既有入口 |
| 9 | 顶部 AI 状态 | `sciworkbench/public/index.html` | `#ai-chip` 由可点开抽屉改为只读状态 | `28e1705` | 改变既有交互 |
| 10 | 换卷动画引擎 | `sciworkbench/public/app.js` | 删除换卷/重绘/主题切换整段（约 594 行变更中的主体，含 `quickSwitchTheme`/`replayAndRecast`/`applyTheme` tech 分支） | `28e1705` | 删除既有行为 |
| 11 | AI 抽屉逻辑 | `sciworkbench/public/app.js` | 删除 `openAiDrawer`/`closeAiDrawer`/`refreshAiState` 与相关监听 | `28e1705` | 删除既有行为 |
| 12 | 开卷动画锚点 | `sciworkbench/public/splash.js` | 锚点从 `#theme-seal` 改为 `.brand`（**+3/-2**） | `28e1705` | 适配被删节点 |
| 13 | 公开首页整体替换 | `locus-site/build-web.mjs` | `--mode=public` 时把 `web/index.html` 改写为**重定向到 `/demo/demo.html`** 的落地页 | `28e1705` | 替换前端入口 |

## 二、新增组件（符合「加设置页 + 文献库可视化」，建议保留）

| 范围 | 文件 | 说明 |
| --- | --- | --- |
| 设置页（折扇） | `locus-site/web-overlay/settings/settings-fan.js/.css` | 三签（外观/模型/关于）、焦点与减少动效、偏好持久化；独立模块，未改既有页 |
| 文献库可视化 | `locus-site/web-overlay/demo/*` | 三栏只读展示、原文定位、对比视图、报告回查、下一步依据、断网可用 |
| 展示数据 | `locus-site/demo-data/*` | 达尔文快照、原件、ZIP、许可说明（数据层，不涉及前端风格） |
| 构建能力 | `locus-site/build-web.mjs` 的 `--mode=public` 打包逻辑 | 打包 demo-data/settings、版本注入（其中「首页重定向」一项见上表 #13） |

## 三、未触及

- 知识页、分析页、执行/记录页、方案页的既有渲染逻辑与布局。
- 后端 `sciworkbench/server.ts`、服务层、领域层与测试。
- 暖色（paper）主题本身：样式与素材保留。

## 四、处置建议（待用户确认，未执行）

1. **恢复**：`styles.css`/`knowledge-stage.css` 的冷色规则、`assets/tech/*`、`index.html` 的 `#theme-seal`/`#replay-theme`/首屏主题脚本/`#ai-drawer`/`#ai-open`/`data-open-ai`、`app.js` 对应逻辑、`splash.js` 锚点。
2. **保留**：C 的设置折扇（作为**新增**入口，不改动既有入口）、B 的文献库可视化（建议改为接入现有前端的一个视图/面板，而不是独立 `demo.html` 整页）。
3. **去掉**：`--mode=public` 中把首页重定向到 `/demo/demo.html` 的改写（#13）；公开构建只做资源打包与新增入口注入。
4. 版本发布：线上当前仍是本次展示版；旧版字节级冻结包已定位（`artifactSha256=05bae069…`、`indexSha256=14a3d3ad…`），可在确认后原样回退。

## 六、处置执行（2026-11-24，按用户决定）

用户决定：**全恢复既有前端 + 设置折扇与文献库作为新增；文献库嵌入现有前端；立即回退线上**。

已执行：
1. **线上回退**：从本地发布状态目录取回旧版冻结包（`artifactSha256=05bae069…`、`indexSha256=14a3d3ad…`，与替换前描述符一致），按同一 project 重新发布。线上核验：首页恢复原工作台（含 `theme-seal`/`replay-theme`/`ai-drawer`）、`/assets/tech/*` 200、`/demo/demo.html` 404。线上响应体与本地冻结包字节不同（平台注入），故按特征标记而非字节哈希判定。
2. **源码恢复**（提交 `1f9d470`）：`git checkout 8120986 -- sciworkbench/public/{index.html,app.js,styles.css,knowledge-stage.css,splash.js} sciworkbench/public/assets/tech`，即还原上表 #1–#12 全部删除项；`sciworkbench/public` 相对基线现已无差异。
3. **构建层去掉首页替换**（同提交）：`--mode=public` 不再重定向到 `/demo/demo.html`、不再打包独立 demo 页；仅在既有首页注入 settings 折扇（CSS/入口/模块）与构建版本，不动既有入口与布局（上表 #13 已处理）。
4. **回归与冒烟**：`npm --prefix sciworkbench test` 353/353；离屏 Edge 冒烟——`#settings-open` 可展开扇面（900×900）、Esc 关闭、无页面异常（仅静态服务下 `/api` 404 属预期）。
5. 未发布新的恢复版；线上保持旧版，待文献库嵌入视图完成后再一并出候选。

待办：把 B 的文献库可视化从独立页改为**嵌入现有前端的视图/面板**（下一步）。

## 七、复现证据命令

```bash
git diff --stat 8120986..HEAD -- sciworkbench/public locus-site/build-web.mjs locus-site/functions
git diff 8120986..HEAD -- sciworkbench/public/index.html
git diff --numstat 8120986..HEAD -- sciworkbench/public/styles.css sciworkbench/public/knowledge-stage.css sciworkbench/public/splash.js
git diff --name-status 8120986..HEAD -- sciworkbench/public/assets
git diff 8120986..HEAD -- locus-site/build-web.mjs   # 首页重定向
```
