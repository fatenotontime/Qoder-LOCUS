# S10 · B 角色（工作台交互）接线提案索引

本目录是 **executor-b3** 对 `sciworkbench/public/app.js`、`index.html`、`sciworkbench/server.ts`
的**最小改动提案**（这些文件由集成负责人拥有，B 不直接改）。`sciworkbench/public/lib/**` 下的改动
已在分支 `feat/s10-b-workbench-ui` 直接提交，不在提案范围。

| 文件 | 目标 | 对应执行包条目 |
| --- | --- | --- |
| `index-html.diff` | 引入 `lib/s10-workbench.css`（迹芽素材样式、窄屏补充） | 第一组 4；第三组 4 |
| `app-js-r03-row-drafts.diff` | 行草稿按执行×步骤存放；保存失败保留；步骤+偏差一次提交 | 第一组 3.1/3.3/3.4 |
| `app-js-r02-topic-switch.diff` | 三条切换入口收口；异步回执按发起课题归属；不全局清 kzJob | 第一组 2；4 |
| `app-js-r04-kzjob-leave.diff` | 离开知识页保留任务归属（配合 lib 的 run 找回） | 第一组 4.2/4.3 |
| `app-js-entries-routing.diff` | 列表→详情→返回、浏览器前进后退、刷新恢复 | 第一组 2.4；第三组 1 |
| `server-events-batch.md` | `POST /api/executions/:id/events` 接受 `{events:[...]}`（R03 一次提交两条事件） | 第一组 3.1 |

## 已在 lib 落地、无需集成方改动的部分
- `lib/pages/knowledge-stage.js`：迹芽五图层读卷 / 静态图（减少动态）/ 抬头·盖印脉冲；`kzJobMatches` 归属判断；舞台计数按课题+文献范围。
- `lib/pages/knowledge.js`：`recoverJobFromRuns` 由 `state.knowledge.extractionRuns` 按归属找回任务；轮询只更右栏队列；新卡/归入触发迹芽事件并去重。
- `lib/pages/analysis.js`：每任务当前选择 `selOf`；图/列表同源；子问题必选；「确认范围并推荐」携带 `subquestionId + optional + versions`；版本冲突（409/code 含 version/stale/conflict）阻止并保留选择；展示态试选只留本页；结果可回看固定快照；缺关联显示「待补」。
- `lib/api.js`：`recommendMethods(id,purpose,extra)` 透传选择与版本；新增 `appendEvents(execId, events)`（前端已就绪，待服务端支持）。
- `lib/s10-workbench.css`：迹芽素材样式与窄屏补充（需 `index-html.diff` 引入）。

## 验证（原生 Node，端口 5393；基线 b7086c4）
- R01：`recommend` 请求体由 `{purpose}` 变为 `{purpose, subquestionId, optional:[{ref,included}], versions:{...}}`，取消的卡 `included:false`。
- R02：切到空课题 B 后，`kzq-task` 显示「(无任务)」、舞台 `data-state=idle`（不再串入 A 的回执）。
- R04：刷新知识页后由运行记录恢复 `kzstage` 与队列（`failed`/计数按 run 回填）。
- 迹芽：`pose=reading` 时 5 图层、容器 48px；`prefers-reduced-motion` 下图层 `display:none`、静态图 `block`；舞台无 `<img>`（沿用「不回显外部文本」测试）。

## 落地状态（executor-i，分支 `feat/s10-integration`，commit 55faf47）

| 提案 | 状态 | 落地位置（`sciworkbench/public/app.js` / `index.html`） |
| --- | --- | --- |
| `index-html.diff` | 已落地 | `index.html` 在 `knowledge-stage.css` 后引入 `/lib/s10-workbench.css`；中栏新增 `#detail-back[data-back]` |
| `app-js-r04-kzjob-leave.diff` | 部分 | `renderShell` 已删「离开知识页清 `ui.kzJob`」；`kzLeaveGuard` 未由 lib 导出 → 本次跳过该调用（见待依赖） |
| `app-js-r02-topic-switch.diff` | 已落地（有偏差） | 新增 `switchTopic(nextId)`，收口 `#topic-select` / `.material[data-topicpick]` / `.goto[data-topic]` 三入口。**按集成指令不清 `kzJob`**（原提案置 null），归属改由 lib `kzJobMatches` 过滤 |
| `app-js-r03-row-drafts.diff` | 已落地 | `ui.stepDrafts` + `captureStepDraft` 委托；`stepsTableHtml` 草稿回填；行保存改一次 `api.appendEvents`，成功只清该行草稿、失败就地 `.rowerr` |
| `app-js-entries-routing.diff` | 已落地（有加强） | `DETAIL_ID_FIELD/routeHash/pushDetailRoute/applyRoute/backToList/detailExists` + `popstate`；列表→详情入历史、返回按钮 `[data-back]`、刷新失效详情回落列表。`pushDetailRoute` 打开详情前先 `replaceState` 列表 URL，保证浏览器后退回到该模块列表 |
| `server-events-batch.md` | 未处理（A 负责） | 服务端仍只接受单事件；见待依赖 |

### 待依赖
- **lib 导出 `kzLeaveGuard`**：`lib/pages/knowledge.js` 现仅有内部 `kzDropDraft()`；app.js 侧离开知识页前的未提交核对内容确认暂缺（本次未自造导出）。
- **服务端 `POST /api/executions/:id/events` 接受 `{events:[...]}`**：A 未就绪前，前端已发 `{events:[...]}`；R03 成功路径的端到端验证以拦截转发逐条单事件模拟该端点完成。
- 路由对 `papers` 详情：该页 `renderShell` 会默认选中首篇论文，浏览器后退回落列表后仍自动选中首项（非本轮验收点，未改）。
