# E8 交接（进行中：E8-A 数据层已完成并经返工修复）

> 范围：知识库防偏移执行合同 **E8 其余模块逐类贯通**（§10 E8；判据 **T46 子用例**＋既有 origin/reference/report 守卫回归）。
> 状态：**E8-A 数据层 = 已完成并两轮返工**（首版 `d2404a7` → 返工一 `8e71803` · 01:05 → 返工二 `af72db9` · 01:30 → 返工三 `4a63f55` · 01:49，依审计 S04-T18）；**页面层（wiki/总览入口）与「方法页、局部关系图、引用跳转实测」= 阻塞（等 E6-B）**；E8 整体**未 passed**。
> 依据：合同 §10 E8；过程见 [会话记录 S05-T11](sessions/2026-11-21_session-05.md#s05-t11)（首版）与 [S05-T12](sessions/2026-11-21_session-05.md#s05-t12)（返工），台账 #98/#100。

## 一句话状态

六类业务对象（方案与模板／执行／样品／分析结果／报告块／已采纳对话）都能**以"知识来源"身份被统一读取**：固定来源（含版本/内容 hash）、可读文本、性质继承、课题归属可验证性、可用前置、报告块**当时引用的版本**且**真解析**；来源更正后**版本递增**（新引用可解析、旧版本仍可读）；**未采纳的对话提案不能进知识**；这些类型**也能进 AI 输入**并接受引用校验。页面层入口与浏览器实测仍未做（等 E6-B）。

## 返工修掉的三条真实缺陷（用户复现）

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 执行来源更正后再次归档 → `content_mismatch` | 无业务 revision 的对象版本固定为 `k:1`，更正后仍复用同一版本号而内容不同，新引用命中旧归档 | `currentVersion` 改为按**内容 hash 复用、否则递增 `k:N`**（`k:1`→`k:2`） |
| 未采纳的对话提案仍能进正式知识 | 只有适配层的 `usable=false`，**没有必经入口** | 新增 `adoptChatProposalToKnowledge`：必经 `assertSourceUsableForKnowledge`（未采纳 → **422 `source_not_usable`**）；采纳只落**待审**并写采纳依据 |
| 报告引用只列出未真解析／部分类型 AI 读取未贯通 | `pinnedRefs` 仅陈列；AI 输入只认 item | 新增 `resolvePinnedRefs`（**读归档当时版本**，取不到给原因；`note`/`snapshot` 特例）＋`knowledgeSourceFragment`；`buildKnowledgeAiInput` 支持 `sourceRefs`（E8 各类型进 AI 输入，未采纳被拒），`validateAiReferences` 认外部对象 `kind:id@version` |

## 审计事故与处置（PR #20 未通过）

- **截图混入**：解冲突时误用 `git add -A record/`，把 `record/screenshots/from-pictures/`（38 张用户截图）提交进 PR #20。→ 已**取消跟踪（磁盘文件保留）**，并从 main 重建干净分支 `fix/s05-e8a-v2`，diff 无 `record/screenshots/**`。
- **截图一度被删**：误提交后它们成为 tracked 文件，切换分支时被 git 从工作区删除。→ 已 `git checkout HEAD -- record/screenshots/from-pictures` **还原 38 张**。
- **未落库他人未提交改动**：协作方（S04-T15）在台账/`session-04` 的未提交审计记录**未被提交**（提交前备份、提交时临时移除、提交后复原；md5 一致）。
- **PR #20 不合并**，改由新分支提交；本交接随新 PR。

## 逐类口径（勿在页面层改回）

同首版（见 [S05-T11](sessions/2026-11-21_session-05.md#s05-t11)）：方法来源≠执行性质；公开样品不伪装本地、无执行关联仍可存在；报告块＝派生陈述并解析当时 refs 版本；聊天仅明确采纳进知识；AI 草稿模板未人工确认不可进知识。

## 验证

- `npm --prefix sciworkbench test` → **346/346 pass**（返工一 T46g–T46j；返工二 T46k–T46n＋E7-A②；返工三 T46o/T46p/T46q/T46r）。
- 返工三（按审计 S04-T18 的**组合路径**最小修正）：`accessClosure`＋`knowledgeAccess` 走依赖闭包（**无来源项以自身 item 策略**；派生项展开上游来源；**报告块展开其固定引用**）；调用方改传「引用」；`assertSourceRefsUsable` 按**被引用版本**判定采纳/确认（不追授旧版）；`assertFixedRefsIntact` 接入确认/正式分析/AI；`resolvePinnedRefs` 加 **hash 完整性核验**（坏归档不可用）。
- 返工二修四条阻断：**旧入口不可绕过**（`assertSourceRefsUsable` 接入通用创建＋确认入口）、**权限接线**（AI 输入过 localRead＋aiSend、导出补许可、容器过 localRead）、**跨课题拦截**、**报告引用接线**（report_block 引用不可解析不放行）。**行为变更**：E7 发送须显式授权（§7.5 默认拒绝，界面授权属 E7-B）。
- 未调真实模型；未启动实例；未触碰 5184/5187/5191。

## 未做（如实）

E8 页面层（wiki/总览入口、方法页、关系图、引用跳转实测）待 **E6-B**；E7-B 同因；真实模型/外部工具待 **S03**；B1 待 **S07**；**§12.2 容量未测**；E4 旧比较适配待用户决定。
