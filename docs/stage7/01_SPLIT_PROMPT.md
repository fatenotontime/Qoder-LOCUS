# 提示词：拆分「领域知识积累」与「数据处理与分析」两页（行为不变）

> 给 Qoder 的执行提示词。目的：让这两页的渲染与事件各自落在独立文件，便于前端协作者在不误伤其他页的前提下重做。
> 这是**纯重构**：用户看到的页面、DOM、文案、接口一律不变。先读 `AGENTS.md`、`record/HANDOFF.md` §二（硬约束）、`docs/stage7/00_FRONTEND_COLLAB_GUIDE.md`。

## 一、范围

只动 `sciworkbench/public/`：

- 新增 `public/lib/pages/knowledge.js`、`public/lib/pages/analysis.js`。
- 瘦身 `public/app.js`、`public/lib/views.js`；同步改 `tests/frontend-render.test.ts` 的导入。
- **不动**：后端、API、`styles.css`、`index.html`、其余五页（课题/文献/方案/记录/对话）的任何逻辑。

## 二、搬什么

### knowledge.js（领域知识积累）
- 从 `lib/views.js` 搬入：`knowledgeLeftHtml`、`knowledgeWorkspaceHtml`、`knowledgeQueueHtml`（及其仅供它们使用的私有辅助函数）。
- 从 `app.js` 搬入：`renderKnowledgeForm`、`pollKnowledgeJob`、`kzAct`，以及全部 `kz*` / `kzq-*` 事件：`kztab`、`kz-open`、`kzq-item`、`kz-locate`、`kzq-cancel/pause/resume/retry`、`kz-cand/skip/excl/undo/skipall`、`kz-imp`（change）、`kz-note`（focusout）。
- `renderMiddle` / `renderRight` / 左栏里 `ui.nav === "knowledge"` 的分支改为调用本模块，标题与提示文字原样保留。

### analysis.js（数据处理与分析）
- 从 `app.js` 搬入：`currentTask`、`renderAnalysisForm`、`contextMapHtml`、`snapshotHtml`、`blockRowHtml`、`reportHtml`、`collectReportBlocks`、`renderBlockDiff`、`resultHtml`、`analysisUpstreamChanged`、`analysisRightHtml`、`download`。
- 搬入对应事件：
  - `#mid-content` 监听里的 `cand-save`；
  - `#right-content` 监听里的 `an-recommend`、`res-submit`、`res-edit-save`、`rep-create/add/del/up/down`、`ref-back`、`rep-docx`、`rep-trace`、`rep-confirm`、`rep-draft`、`rep-preview`、`rep-accept`；
  - `an-create`（`renderAnalysisForm` 内部绑定）。
- **留在 app.js**：对话页全部内容（`chat*`、`chat-adopt` 等），以及分析与对话共用的 `topicObjects`、`refLabel`、`humanVer`。共用函数不得复制两份，抽到 `lib/refs.js` 由两边导入。
- `tbl-open` / `openTableMax`（表格最大化）属共用，留在 app.js，分析页只触发它。

## 三、模块约定

1. 渲染函数写成纯函数 `(state, ui, ...)`，**模块顶层不得访问 DOM**，使 node 能直接导入并断言。
2. 事件通过 `bindKnowledge(ctx)` / `bindAnalysis(ctx)` 注册，由 `app.js` 启动时调用一次。
3. `ctx` 只传需要的：`getState()`（`state` 会被重新赋值，不要传值）、`ui`、`api`、`$`、`$$`、`refresh`、`refreshAfterJob`、`renderShell`、`renderMiddle`、`renderRight`、`setStatus`、`setError`、`humanError`、`runBusy`、`runJob`、`saveUi`、`noteChangeHits`。
4. 保持文档级委托与 `closest()` 命中，不用 `target.classList` 判断（HANDOFF 硬约束）。
5. 从共享的 `#right-content` / `#mid-content` 监听里**摘出**分支时：逐段确认前置语句（如 `const item = ev.target.closest(".item")` 之后的 `return`）不会让摘出的分支行为变化；摘出后在新模块里挂**独立监听**，原监听里不留死代码。
6. **拿不准归属的分支留在 app.js**，并在汇报里列出，不要硬搬。
7. 保持纯 JS，禁止 TS 类型语法；无构建步骤、无新依赖。服务端按 `public/` 静态提供，确认 `/lib/pages/*.js` 能被访问。

## 四、禁止

- 改任何 HTML 结构、class、id、`data-*`、文案、样式；
- 加动效、加功能、改状态机、改请求时序；
- 改后端与 API。

## 五、验证（全部通过才算完成）

1. **渲染等价**：拆分前，用现有测试夹具与 `acceptance-darwin` 数据，导出这两页中栏与右栏的 HTML 快照；拆分后逐字节比对，必须一致。
2. `cd sciworkbench && npm test` 全过（不少于 187 项）；`node scripts/frontend-text-check.ts` 7/7。
3. **离屏点击走查**（Edge）：
   - 知识页：切页签、展开卡、入候选/跳过/排除/撤回、定位原文、暂停/继续/取消、失败块重试、全部跳过；
   - 分析页：勾选候选并保存、推荐、提交结果、报告块增删排序、预览并接受、确认草稿块、导出 Word/追溯包。
4. 新增测试：两个模块在 node 下可导入；`frontend-render.test.ts` 改为从新模块导入知识页渲染函数，断言保持不变。
5. 完成后核对 `docs/stage7/00_FRONTEND_COLLAB_GUIDE.md` 的「页面地图」，路径或函数名有出入时**改文档**，以代码为准。

## 六、收尾

- 分两个提交：知识页拆分、分析页拆分；每个提交带 `Turn:` / `Agent:` trailer。
- 按 AGENTS.md §8 收尾：先 `git log` 取真实 hash，再写台账与轮次记录。
- 不提交用户未跟踪材料（`vibe_images/`、`record/screenshots/from-pictures/`、`reference reseach data/` 下的解压目录）。
- 汇报需包含：搬了哪些函数、留在 app.js 的存疑分支清单、快照比对结果、走查结果。
