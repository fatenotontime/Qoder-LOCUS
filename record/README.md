# record 目录说明

本目录记录 **LOCUS** 项目（「2026 Qoder 高校创造力大赛」参赛作品）全过程。

> ⚠️ 记录规范以仓库根目录 [AGENT.md](../AGENT.md) 为准：**主线是 Git 提交历史**，并行分支用**双线记录**，时间不作为主线。

## 目录结构

- `COMMIT_LEDGER.md` — **提交台账（唯一权威）**：双线表 + 对话轮次索引
- `00_competition_brief.md` — 比赛规则速查（从官网提炼）
- `sessions/` — 每轮对话的叙述性记录（会话日志、页面快照）
- `screenshots/` — 关键节点截图（**由用户负责提供**）
- `submission/` — 最终作品帖草稿及相关材料（后续按需创建）

## 约定

1. 截图由**用户**负责；agent 只在记录中引用其路径。
2. 文字记录由 **agent** 每轮依据 `git log` 真实结果更新，先有提交后有记录。
3. 每次会话新增一份 `sessions/YYYY-MM-DD_session-NN.md`，记录本会话结论、决定、待办。
4. 页面结构快照（无头抓取）存 `sessions/page_*_snapshot.txt`，作为截图缺位时的兜底证据。
5. 源码项目在仓库其它目录（`sciworkbench/` 等）。
