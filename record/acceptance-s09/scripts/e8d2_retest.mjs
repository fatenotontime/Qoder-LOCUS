import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "fs";
import crypto from "crypto";

const PUB = process.env.PUB, PER = process.env.PER, OUT = process.env.OUT;
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });

async function libCheck(base, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const reqs = [], errs = [];
  page.on("request", (r) => reqs.push({ url: r.url(), method: r.method() }));
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(base + "/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3500);
  const ov = await page.evaluate(() => document.getElementById("overlay")?.className || "");
  if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2500); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.click('.navitem[data-nav="library"]', { timeout: 5000 }).catch(() => page.click('.navitem[data-nav="library"]', { force: true }));
  await page.waitForTimeout(3500);
  const dom = await page.evaluate(() => ({
    mount: (document.querySelector("#lv-mount")?.innerHTML || "").slice(0, 120),
    papers: document.querySelectorAll("#lv-mount .lv-paper").length,
    cards: document.querySelectorAll("#lv-mount .lv-card").length,
    miss: !!document.querySelector("#lv-mount .lv-miss"),
    hint: (document.querySelector("#lv-mount .hint")?.textContent || "").slice(0, 120),
    tabs: [...document.querySelectorAll("#lv-mount .lv-tab")].map((b) => b.textContent.trim()),
  }));
  // 个人态额外：切课题应仍在内存（此实例仅一个课题，跳过）
  await page.screenshot({ path: `${OUT}/screens/e8d2_${tag}_library.png` });
  await ctx.close();
  return {
    tag, errs,
    demoDataHits: reqs.filter((r) => r.url.includes("/demo-data/")).length,
    apiHits: reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/")).length,
    total: reqs.length, dom,
  };
}
const per = await libCheck(PER, "personal");
const pub = await libCheck(PUB, "public");

// E1/E5 抽检（公开源）
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
const reqs = []; page.on("request", (r) => reqs.push(r.url()));
await page.goto(PUB + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(3500);
const ov = await page.evaluate(() => document.getElementById("overlay")?.className || "");
if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2500); }
const e1 = await page.evaluate(() => ({ url: location.href, theme: document.documentElement.dataset.theme, displayMode: document.documentElement.dataset.displayMode || null, badge: !!document.querySelector(".display-badge"), navItems: [...document.querySelectorAll(".navitem[data-nav]")].length }));
let e5 = {};
try { const zip = await page.$('#right-content a[href*="locus-demo-public.zip"]'); const href = zip ? await zip.evaluate((a) => a.href) : null; if (href) { const resp = await ctx.request.get(href); const buf = await resp.body(); e5 = { href, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") }; } } catch (e) { e5 = { error: String(e).slice(0, 80) }; }
const api = reqs.filter((u) => u.includes("/api/") || u.includes("/functions/")).length;
await ctx.close();
await browser.close();

const out = { personal: per, public: pub, e1, e5, e1ApiHits: api };
fs.writeFileSync(OUT + "/raw/e8d2_retest.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
