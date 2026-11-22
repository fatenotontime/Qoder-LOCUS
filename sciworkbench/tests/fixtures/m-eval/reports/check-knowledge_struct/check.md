# 离线检查/回放（非模型调用）

- 任务：knowledge_struct
- 运行：ks-new（模式 simulated）
- 提示词与基线一致：是

## ks-normal（tuning）
- [ok] json_parse：输出是合法 JSON — ok
- [ok] field:schemaVersion：顶层含 schemaVersion — ok
- [ok] array:evidence：顶层 evidence 为数组 — ok
- [ok] array:contexts：顶层 contexts 为数组 — ok
- [ok] array:cards：顶层 cards 为数组 — ok
- [ok] array:relations：顶层 relations 为数组 — ok
- [ok] forbidden_fields：不得出现字段 audit/revision/stableId/history — ok
- 语义项待人工判断：3 项

## ks-missing（tuning）
- [ok] json_parse：输出是合法 JSON — ok
- [ok] field:schemaVersion：顶层含 schemaVersion — ok
- [ok] array:evidence：顶层 evidence 为数组 — ok
- [ok] array:contexts：顶层 contexts 为数组 — ok
- [ok] array:cards：顶层 cards 为数组 — ok
- [ok] array:relations：顶层 relations 为数组 — ok
- [ok] forbidden_fields：不得出现字段 audit/revision/stableId/history — ok
- 语义项待人工判断：3 项

## ks-holdout（holdout）
- [ok] json_parse：输出是合法 JSON — ok
- [ok] field:schemaVersion：顶层含 schemaVersion — ok
- [ok] array:evidence：顶层 evidence 为数组 — ok
- [ok] array:contexts：顶层 contexts 为数组 — ok
- [ok] array:cards：顶层 cards 为数组 — ok
- [ok] array:relations：顶层 relations 为数组 — ok
- [ok] forbidden_fields：不得出现字段 audit/revision/stableId/history — ok
- 语义项待人工判断：3 项
