# 阶段2 · API 与运行契约

> 路由可变，**契约不变**。所有接口返回不得把"请求成功"当"科学确认"。

## 1. 统一约定

- **统一任务对象**：`{ taskId, type, status, currentRevision, errorCode?, retryable, idempotencyKey }`。
- **任务状态**：`queued | running | succeeded | failed | cancelled`。**复核状态另存**（`draft | reviewed | adopted | excluded | withdrawn`）；`succeeded ≠ confirmed`。
- **幂等**：写操作带 `Idempotency-Key`；重试**不重复入库**；**过期响应不得覆盖当前 revision**。
- **并发**：实体写带 `If-Match: <revision>`；冲突返回 `409` + 可恢复冲突体（含 `currentRevision`）。
- **权限**：私有对象**服务端校验**，不靠前端隐藏 ID；下载 ZIP/导入校验路径、类型、大小，**不执行**包内宏/脚本。
- **错误码**：`400 invalid_input` / `403 forbidden` / `404 not_found` / `409 conflict` / `422 unprocessable`（结构/来源校验失败）/ `429 rate_limited`(retryable) / `502 upstream_error`(retryable) / `504 upstream_timeout`(retryable)。

## 2. 路由分组（按路径/事件）

| 组 | 路由（示意） | 说明 |
| --- | --- | --- |
| 课题 | `POST /topics`、`PATCH /topics/{id}`、`POST /topics/{id}/subquestions` | 最小创建仅 name+question |
| 素材 | `POST /assets`（hash 重复拒收）、`GET /assets/{id}`（签名引用）、`POST /assets/{id}/withdraw` | 原件不覆盖；撤回≠删除 |
| 文献 LIT | `POST /lit/parse`、`GET /lit/cards`、`PATCH /lit/cards/{id}`、`POST /lit/cards/batch-review`、`POST /lit/compare` | 抽取/核对/采用分开；批审先展示共享条件 |
| 方案 EXP | `POST /protocols`、`POST /protocols/{id}/templates`、`POST /protocols/{id}/resources-check`(可跳过) | 图=视图；执行实际层另存 |
| 执行 OCR | `POST /executions`、`POST /executions/{id}/sessions`、`POST /samples`、`POST /measurements` | 先记后补；未知不伪造 |
| 上下文 ANA | `POST /context/preview`、`POST /context/freeze`、`POST /analysis/tasks`、`POST /analysis/tasks/{id}/runs` | 冻结后固定 revision |
| 报告 REP | `POST /reports`、`POST /reports/{id}/diff`、`POST /reports/{id}/accept`、`GET /reports/{id}/export` | 对话默认只讨论 |
| 变更 LIN | `GET /changes/{id}`、`GET /dependencies?ref=`、`POST /impact/tasks`、`POST /reviews` | 确定性传播 + AI 语义评估分栏 |
| 任务 | `GET /tasks/{id}`、`POST /tasks/{id}/retry`、`POST /tasks/{id}/cancel` | 统一任务对象 |

## 3. 关键契约（不变式）

1. 引用固定 revision；**无全局 latest 依赖**。
2. 上传/解析/导出可异步；**失败不得产生已确认态**。
3. 上下文冻结后，后台新数据**不自动改变**进行中的分析。
4. 报告数值/图表绑定 `resultRef`（固定 revision）；解释绑定 evidence/task。
5. 影响任务：`status` 与 `assessment` 分离；**failure ⇒ 不显示 no_supported_impact_found**。
6. 较新改动到达 ⇒ 旧影响分析置 `stale`，引用旧快照供查，**不覆盖**。

## 4. 来源定位（复用 01 §6）

写接口返回 `locator`：文献 `{kind, page?, region?, sectionQuote?, table?, figureCaption?}`；数据 `{region?, fieldPath?, sheetName?, cellRange?}`。**定位不足 → 扩大复核并明示**。

## 5. 最小可测接口（骨架已实现，见 `sciworkbench/`）

| 接口 | 形态 | 对应契约 |
| --- | --- | --- |
| `classifyPath(asset)` | 纯函数 → `literature \| protocol \| data` | 三路径 |
| `classifyEvent(op)` | 纯函数 → `public_import \| user_execution` | 两事件 |
| `downstreamOf(edges, ref)` | 图遍历 → 受影响的 refs | 双链 |
| `propagate({changeKind, target})` | 纯函数 → 受影响集合 + 复核类别 | LIN03/I06 |
| `backtrace(originKind)` | 纯函数 → 该类型的回查链原型 | 回查网络 |
| `ImpactAssessment` 状态机 | `transition(state,event)` | 03 Edit Impact |
| AI 配置/模型 | `GET /api/ai/status`、`POST /api/ai/config`（保存即落盘本机 `ai-config.json`）、`DELETE /api/ai/config`（删盘）、`POST /api/ai/test`、`POST /api/ai/models`（可用模型列表 + 联通性） | ADR-0024；Key 不入 Git/日志/导出 |
