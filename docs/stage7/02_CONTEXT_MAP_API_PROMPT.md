# 提示词：上下文地图只读接口（后端）

> 给 Qoder 的执行提示词。先读 `AGENTS.md`、`record/HANDOFF.md` §二、`docs/stage7/00_FRONTEND_COLLAB_GUIDE.md` §四.B。
> 背景：分析页的「上下文地图」要从勾选清单改成真正的地图，由前端协作者设计。前端需要一个**只读**接口拿到节点与边。
> 同时把「必选自动推导」从前端收进后端：它现在写在 `public/app.js` 的 `renderAnalysisForm`（测量 → 样品 → 执行 → 方案），协作者重做界面时容易丢。
> 用户已拍板（2026-11-19）：要新增该接口。

## 一、范围

只动后端：`services/`、`server.ts`、`tests/`、`docs/architecture/`。

- **不动**前端（拆分与地图界面由别处负责），**不改**现有路由与 `createAnalysisTask` / `setTaskCandidates` 的行为，**不改**存储结构（store 版本不升）。
- 接口只读：不写 state、不调用 `store.save`、不触发 AI、不起 job。
- 前端现有的推导逻辑保持不动；新函数与它**结果一致**，用测试固定。待地图界面接入后再删旧推导，不在本轮做。

## 二、接口

```
GET /api/analysis/map?topicId=&subquestionId=&pick=table:ID,measurement:ID   建任务前：按所选数据推导
GET /api/analysis/tasks/:id/map                                              任务已建：按任务当前选择
```

返回：

```
{
  ok: true,
  scope: { topicId, subquestionId?, taskId?, frozen? },   // frozen＝任务已冻结快照
  nodes: [{
    key, kind, id, label, version?, external?,
    role: "core" | "selected" | "optional" | "context",
    selectable: boolean,        // 可勾选加入/取消（core 与 context 为 false）
    gaps: [{ code, label }]     // 本节点缺口，label 为中文短词，如「来源缺失」
  }],
  edges: [{ from, to, edgeKind, establishedBy, note? }],   // from/to 为 node.key
  gaps: [{ key, code, label }],                            // 汇总
  truncated: boolean
}
```

角色含义：

- `core`：必选，锁定不可取消。建任务前由 `pick` 推导，已建任务取 `task.core`。
- `selected`：候选且已选。任务取 `optional[].included === true`；建任务前，已入候选的知识卡默认为 `selected`。
- `optional`：可选但未选。
- `context`：仅用于看清来源的节点（课题、子问题、样品、文献条目等），不可选。

## 三、规则

1. **推导**（建任务前模式）：`pick` 里的测量 → 其样品 → 执行 → 方案，一并为 `core`；表直接为 `core`。缺任何一环不报错、不阻塞，该节点记 `gaps`（如样品无执行 → 「来源缺失」）。推导逻辑抽成独立纯函数 `deriveCore(state, picks)`，不依赖 HTTP。
2. **边只来自 `buildNetwork`**：不补造、不新增边类型；`edgeKind` 沿用 归属 / 溯源 / 数据链 / 科学依据 四类。**同课题不等于连线**。
3. **节点范围**：本课题（`topicId`）下可被选入的对象，加上它们沿真实引用向上追溯到的来源节点（作 `context`），再加课题与子问题。跨课题节点只在作为上游来源出现时才进来，且为 `context`。
4. **可选对象类型**以 `resolveFragment` 支持的 kind 为准（执行、测量、数据表、方案、知识卡）。知识卡只取 `audit === "confirm"`（ADR-0022，已入候选）。
5. **有界且确定**：节点上限默认 300，超出置 `truncated: true`；同一 state 多次调用结果顺序一致（按 key 排序）。
6. **不含大文本**：节点只带 `label` 等短字段，不带原件正文。
7. 错误：`topicId` 缺失或不存在 → 404；`pick` 里对象不存在或不属本课题 → 422，信息写明是哪一项；任务不存在 → 404。

## 四、测试（新增 `tests/context-map.test.ts`）

- 推导：选一个测量 → `core` 含其样品对应的执行与方案；选表 → 仅表；缺环时记缺口、不报错。
- 推导结果与前端现有逻辑一致（用同一夹具对照）。
- 角色：已建任务的 `core` / `selected` / `optional` / `context` 分类正确；`core` 的 `selectable` 为 false。
- **边不造假**：返回的每条边都存在于 `buildNetwork(state).edges`。
- 跨课题：另一课题的对象不会作为可选节点出现。
- 知识卡：仅已入候选的出现在可选里。
- 确定性与上限：重复调用顺序一致；构造超限数据时 `truncated` 为真。
- 只读：调用前后 state 深度相等，未调用保存。
- 路由层：404 / 422 各一条；用达尔文验收数据（`acceptance-darwin`）跑一次真实形状。

## 五、文档与记录

- `docs/architecture/02_API_CONTRACT.md`：登记两个接口与返回结构。
- `docs/architecture/04_ADR.md`：新增 ADR-0024（只读地图接口复用 `buildNetwork`；必选推导后端化；前端旧推导待地图接入后删除），状态 `accepted`（用户 2026-11-19）。
- `docs/stage7/00_FRONTEND_COLLAB_GUIDE.md` §四.B：把「预期形状」改为本接口的实际结构，以代码为准。
- `docs/stage5/02_HIDDEN_FEATURES.md`：「上下文地图」一行补上该接口。

## 六、验证与收尾

- `cd sciworkbench && npm test` 全过（不少于现有数量，另加新增）；`node scripts/frontend-text-check.ts` 仍 7/7。
- 用 `curl` 或脚本对 5184 验收实例各调一次两个接口，汇报节点数、边数、`core` 清单与缺口。
- 一个提交即可；按 AGENTS.md §8 收尾，提交带 `Turn:` / `Agent:` trailer；不提交用户未跟踪材料。
- 汇报需含：`deriveCore` 与前端旧逻辑的对照结果、`truncated` 的触发条件、未覆盖的对象类型。
