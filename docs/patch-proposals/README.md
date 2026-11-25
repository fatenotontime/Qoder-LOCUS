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
- `lib/pages/knowledge.js`：`recoverJobFromRuns` 由 `state.knowledge.extractionRuns` 按归属找回任务，并用 `api.knowledgeRun(runId)` 复核实时状态、有在跑 job 则续轮询；轮询只更右栏队列；新卡/归入触发迹芽事件并去重；左栏原文、文献下拉、卡片/舞台/队列全部按 topicId 作用域（切课题不再串 A 的内容）；备注 `kz-note` 草稿记于 `ui.kzNoteDraft` 并纳入未保存守卫（切页返回不丢）；导出 `kzLeaveGuard(): boolean` 供 app.js 在离开知识页前调用。
- `lib/pages/analysis.js`：每任务当前选择 `selOf`；图/列表同源；子问题必选；「确认范围并推荐/重新推荐」按 A 契约发 `{workspace:true, topicId, subquestionId, core:[{kind,id,version?}], optional:[{ref,included,version?}], versions:{"kind:id":"…"}}`（版本串与后端 `referenceVersion` 同构：表/测量/方案/卡=`r{n}`、执行=`e{rev}@{updatedAt}`、原件=`h{hash}`、子问题=`k{kind}`、知识项=`r{rev}`）；`selection_stale`(409) 阻止并保留选择、标注复核对象；展示态试选只留本页；结果可回看固定快照；缺关联显示「待补」。建任务带 `workspace:true`（服务端据此强制子问题）。
- `lib/api.js`：`recommendMethods(id,purpose,extra)` 透传选择与版本；新增 `appendEvents(execId, events)`（前端已就绪，待服务端支持）。
- `lib/s10-workbench.css`：迹芽素材样式与窄屏补充（需 `index-html.diff` 引入）。

## 验证（原生 Node，端口 5393；基线 b7086c4）
- R01：`recommend` 请求体由 `{purpose}` 变为 `{purpose, subquestionId, optional:[{ref,included}], versions:{...}}`，取消的卡 `included:false`。
- R02：切到空课题 B 后，`kzq-task` 显示「(无任务)」、舞台 `data-state=idle`（不再串入 A 的回执）。
- R04：刷新知识页后由运行记录恢复 `kzstage` 与队列（`failed`/计数按 run 回填）。
- 迹芽：`pose=reading` 时 5 图层、容器 48px；`prefers-reduced-motion` 下图层 `display:none`、静态图 `block`；舞台无 `<img>`（沿用「不回显外部文本」测试）。
