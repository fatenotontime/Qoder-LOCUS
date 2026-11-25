目标文件：sciworkbench/server.ts（A 数据与任务所有）
对应：第一组 3.1（同一行保存同时含「实际步骤」与「偏差」→ 两条事件一次后端保存）
前端已就绪：`lib/api.js` 新增 `appendEvents(execId, events)`，请求体 `{ events: [ {...}, {...} ] }`。

现状（server.ts 行 1289-1301）：`/api/executions/:id/events` 只读单事件字段
（body.kind/stepId/text/actual/at/backfilled），一次一条。前端原本为一次行保存发两次追加，
存在「步骤已入、偏差失败」的半步状态。

建议契约（向后兼容）：
- 若 `body.events` 为数组：在同一事务内逐条 `appendEvent`，全部成功才整体发布；
  任一失败整体不发布（与 result 提交的「多实体一笔提交」风格一致，行 1564-1575）。
- 否则维持原单事件路径不变（既有调用方零影响）。
- 响应：`{ ok: true, eventIds: [...] }`（单事件路径仍返回 `eventId`）。

参考实现（伪代码）：
```ts
if (execEvents) {
  const execId = decodeURIComponent(execEvents[1]);
  if (Array.isArray(body.events)) {
    let next = state; const ids: string[] = [];
    for (const ev of body.events) {
      const r = appendEvent(next, execId, { kind: ev.kind, stepId: ev.stepId, text: ev.text, actual: ev.actual, at: ev.at, backfilled: ev.backfilled === true });
      next = r.state; ids.push(r.execution.events[r.execution.events.length - 1].id);
    }
    await store.save(next); state = next;
    send(res, 200, { ok: true, eventIds: ids }); return;
  }
  // …原单事件路径…
}
```

回归要点（给 A）：
- 新增用例：一次提交 [step, deviation] → 执行事件各追加 1 条，事件类型与 stepId 引用正确；
  人为让第二条失败 → 两条都不入库（无半步）。
- 重试：前端 runBusy 重试重复同一动作，事件只应追加一次（单次批量请求本身满足）。
- 兼容：既有单事件调用（暂停/恢复/备注等）行为与响应字段不变。
