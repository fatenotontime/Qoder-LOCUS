# 提示词对比报告（离线）

> 运行模式：旧=simulated，新=simulated。simulated 为模拟输出，不能证明候选更好。

- 任务：knowledge_struct
- 旧运行：ks-old
- 新运行：ks-new
- 可比性：不可比
- 说明：未检测到提示词变化，无法把差异归因于改词。

## 逐样本

| 样本 | 旧判断 | 新判断 | 类别 | 备注 |
| --- | --- | --- | --- | --- |
| ks-normal | fail | pending | needs_review | tuning · synthetic |
| ks-missing | fail | pending | needs_review | tuning · synthetic |
| ks-holdout | pending | pending | needs_review | holdout · synthetic |

## 汇总

| 类别 | 数量 |
| --- | --- |
| fixed | 0 |
| new_failure | 0 |
| still_failing | 0 |
| needs_review | 3 |
| unchanged_pass | 0 |
