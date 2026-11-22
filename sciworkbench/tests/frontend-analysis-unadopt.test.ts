/**
 * 知识页接线 item4 回归护栏：「撤回采用（排除）」事件分支必须真实发出 4 参 adopt。
 * 覆盖两条路径：
 *  1) 空原因 → 不发出 adopt，改为提示中止（不代填默认值）；
 *  2) 有原因 → 以 4 参 api.adopt(cardId, subq, "exclude", <原因>) 发出。
 * 走真实 bindAnalysis 的事件委托路径（最小 DOM 桩），故把 analysis.js 里
 * api.adopt(..., "exclude", reason) 的 reason 去掉会让本测试失败。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bindAnalysis } from "../public/lib/pages/analysis.js";

// ── 最小 DOM 桩：仅覆盖 bindAnalysis 撤回分支所需的子集 ──
class El {
  tagName: string;
  id = "";
  dataset: Record<string, string> = {};
  value = "";
  _class = "";
  _html = "";
  _children: El[] = [];
  _parent: El | null = null;
  _listeners: Record<string, ((ev: unknown) => unknown)[]> = {};
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get className() { return this._class; }
  set className(v: string) { this._class = v ?? ""; }
  get classList() {
    const self = this;
    return {
      contains: (c: string) => self._class.split(/\s+/).includes(c),
      add: (c: string) => { if (!self.classList.contains(c)) self._class = `${self._class} ${c}`.trim(); },
      remove: (c: string) => { self._class = self._class.split(/\s+/).filter((x) => x !== c).join(" "); },
    };
  }
  get children() { return this._children; }
  append(c: El) { c._parent = this; this._children.push(c); return c; }
  after(node: El) { const p = this._parent; if (!p) return; const i = p._children.indexOf(this); p._children.splice(i + 1, 0, node); node._parent = p; }
  set innerHTML(html: string) {
    this._html = html;
    this._children = parseClasses(html).map((cls) => { const e = new El("span"); e.className = cls; e._parent = this; return e; });
  }
  get innerHTML() { return this._html; }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel: string) {
    const out: El[] = [];
    const match = (n: El) => sel.startsWith(".") ? n.classList.contains(sel.slice(1)) : sel.startsWith("#") ? n.id === sel.slice(1) : n.tagName === sel.toUpperCase();
    const walk = (n: El) => { for (const c of n._children) { if (match(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  closest(sel: string) { let n: El | null = this; while (n) { if (sel.startsWith(".") ? n.classList.contains(sel.slice(1)) : n.id === sel.slice(1)) return n; n = n._parent; } return null; }
  addEventListener(type: string, fn: (ev: unknown) => unknown) { (this._listeners[type] ??= []).push(fn); }
  dispatch(type: string, ev: unknown) { return (this._listeners[type] ?? []).map((fn) => fn(ev)); }
  focus() {}
}
function parseClasses(html: string): string[] {
  const out: string[] = [];
  const re = /<\w+\b[^>]*class="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function makeDoc() {
  const body = new El("body");
  const mid = new El("div"); mid.id = "mid-content"; body.append(mid);
  const right = new El("div"); right.id = "right-content"; body.append(right);
  const doc = {
    createElement: (t: string) => new El(t),
    querySelector: (s: string) => body.querySelector(s),
    querySelectorAll: (s: string) => body.querySelectorAll(s),
    addEventListener: () => {},
  };
  return { doc, mid };
}

function makeCtx(calls: unknown[][], notified: unknown[]) {
  return {
    api: { adopt: async (...args: unknown[]) => { calls.push(args); return { ok: true }; } },
    ui: { nav: "analysis", taskId: "at1", topicId: "t1" },
    $: () => null,
    $$: () => [],
    refresh: async () => {},
    refreshAfterJob: async () => {},
    runBusy: async (_btn: unknown, _label: unknown, fn: () => Promise<void>) => { await fn(); },
    runJob: async (_btn: unknown, _label: unknown, fn: () => Promise<void>) => { await fn(); },
    getState: () => ({ analysisTasks: [] }),
    setDirty: () => {},
    setStatus: () => {},
    notify: (_pos: unknown, msg: unknown) => { notified.push(msg); return true; },
    invalidateAnalysisMap: () => {},
  };
}

/** 展开「撤回采用」原因输入，返回其 .an-unadopt 包裹元素。 */
function openUnadopt(mid: El, cardId = "c1", subq = "q1") {
  const li = new El("li"); li.className = "anmap-node"; mid.append(li);
  const undo = new El("button"); undo.className = "an-adopt undo"; undo.dataset.card = cardId; undo.dataset.subq = subq; li.append(undo);
  mid.dispatch("click", { target: undo });
  const wrap = li.querySelector(".an-unadopt");
  assert.ok(wrap, "点「撤回采用」应展开原因输入");
  return wrap;
}

test("撤回采用：空原因 → 不发 adopt 请求，改为提示中止（不代填默认值）", async () => {
  const { doc, mid } = makeDoc();
  (globalThis as unknown as { document: unknown }).document = doc;
  const calls: unknown[][] = []; const notified: unknown[] = [];
  bindAnalysis(makeCtx(calls, notified) as never);
  const wrap = openUnadopt(mid);
  const ok = wrap.querySelector(".an-unadopt-ok");
  await Promise.all(mid.dispatch("click", { target: ok }));
  assert.equal(calls.length, 0, "空原因不得发出 adopt");
  assert.ok(notified.some((m) => String(m).includes("撤回采用需填写原因")), "应提示中止");
});

test("撤回采用：有原因 → 以 4 参 api.adopt(cardId, subq, \"exclude\", reason) 发出", async () => {
  const { doc, mid } = makeDoc();
  (globalThis as unknown as { document: unknown }).document = doc;
  const calls: unknown[][] = []; const notified: unknown[] = [];
  bindAnalysis(makeCtx(calls, notified) as never);
  const wrap = openUnadopt(mid, "cardX", "sqX");
  wrap.querySelector(".an-unadopt-reason").value = "与本研究口径不符";
  const ok = wrap.querySelector(".an-unadopt-ok");
  await Promise.all(mid.dispatch("click", { target: ok }));
  assert.equal(calls.length, 1, "有原因应发出一次 adopt");
  assert.equal(calls[0].length, 4, "adopt 必须带 4 个参数（含原因）");
  assert.deepEqual(calls[0], ["cardX", "sqX", "exclude", "与本研究口径不符"]);
});
