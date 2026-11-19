// 实验图布局模型（纯函数，浏览器/Node 共用）：
// 横向时间泳道——主线一条泳道，支路在分叉/汇合锚点之间平行展开。
// 未知时长不按零累计：其后偏移为下界 t≥X（approx=true），并明示未知步数。
export function computeLanes(steps) {
  const main = steps.filter((s) => !s.branch);
  let t = 0;
  let unknownSeen = false;
  const mainNodes = main.map((s) => {
    const offset = t;
    const approx = unknownSeen;
    if (s.durationMin === null || s.durationMin === undefined) unknownSeen = true;
    else t += s.durationMin;
    return { step: s, offset, approx };
  });
  const idx = new Map(main.map((s, i) => [s.id, i]));
  const names = [...new Set(steps.filter((s) => s.branch).map((s) => s.branch))];
  const lanes = names.map((name) => {
    const ls = steps.filter((s) => s.branch === name);
    const forkId = ls.map((s) => s.branchFrom).find(Boolean) ?? null;
    const mergeId = [...ls].reverse().map((s) => s.mergeInto).find(Boolean) ?? null;
    const forkIdx = forkId !== null && idx.has(forkId) ? idx.get(forkId) : null;
    const mergeIdx = mergeId !== null && idx.has(mergeId) ? idx.get(mergeId) : null;
    const anchored = forkIdx !== null && mergeIdx !== null;
    // 支路与主线第 forkIdx+1 .. mergeIdx-1 步并行；无锚点则横跨全程并明示。
    const start = anchored ? forkIdx + 1 : 0;
    const end = anchored ? Math.max(mergeIdx - 1, forkIdx + 1) : Math.max(main.length - 1, 0);
    return { name, steps: ls, forkIdx, mergeIdx, anchored, start, end };
  });
  return {
    main: mainNodes,
    lanes,
    cols: Math.max(main.length, 1),
    totalKnown: t,
    unknownCount: main.filter((s) => s.durationMin === null || s.durationMin === undefined).length,
  };
}

/** 时间标记：精确 t≈X；含未知前缀则为下界 t≥X。 */
export function timeLabel(offset, approx) {
  return `${approx ? "t≥" : "t≈"}${offset}min`;
}

/** 时长来源（四类）：规定/计算/估计/未知；旧数据按 estimated/durationMin 推导。 */
export function durationSourceOf(s) {
  const src = s && s.durationSource;
  if (src === "fixed" || src === "estimated" || src === "computed" || src === "unknown") return src;
  if (s == null || s.durationMin === null || s.durationMin === undefined) return "unknown";
  if (s.estimated) return "estimated";
  return "fixed";
}