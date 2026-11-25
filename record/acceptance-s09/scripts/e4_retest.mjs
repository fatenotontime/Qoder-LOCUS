import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "fs";
import crypto from "crypto";

const BASE = process.env.BASE, TRIAL = process.env.TRIAL, OUT = process.env.OUT;
const R = { reqs: [], e4: {}, e1: {}, e5: {}, e6trial: {} };
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("request", (r) => R.reqs.push({ url: r.url(), method: r.method() }));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
async function unroll() { await page.waitForTimeout(3500); const ov = await page.evaluate(() => document.getElementById("overlay")?.className || ""); if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2500); } }
async function clickNav(k) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); await page.click(`.navitem[data-nav="${k}"]`, { timeout: 5000 }).catch(() => page.click(`.navitem[data-nav="${k}"]`, { force: true })); await page.waitForTimeout(1000); }

// ── E4 复验 ──
await page.goto(BASE + "/", { waitUntil: "networkidle" }); await unroll();
await clickNav("topic");
// 展开每条建议
const summaries = await page.$$("#right-content details.mini > summary");
R.e4.suggestionCount = 0;
await page.evaluate(() => { document.querySelectorAll("#right-content details.mini").forEach((d) => { if (/^\d+\./.test(d.querySelector("summary")?.textContent || "")) d.open = true; }); });
await page.waitForTimeout(600);
R.e4.panel = await page.evaluate(() => {
  const rc = document.querySelector("#right-content");
  const txt = (rc?.textContent || "").replace(/\s+/g, " ");
  const tItems = [...rc.querySelectorAll("details.mini")].filter((d) => /^\d+\./.test(d.querySelector("summary")?.textContent || ""));
  return {
    hasNextSteps: /下一步指导/.test(txt), count: tItems.length,
    titles: tItems.map((d) => (d.querySelector("summary")?.textContent || "").replace(/\s+/g, " ").trim()),
    dump: tItems.map((d) => (d.querySelector(".item")?.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 2),
    hasUnti: tItems.some((d) => /（未提）/.test(d.textContent || "")),
    hasRefBack: rc.querySelectorAll(".demo-ref-back").length,
  };
});
R.e4.suggestionCount = R.e4.panel.count;
// 点第一条的「可回查」引用 → 就地展开 refnet-body
const rb = await page.$(".demo-ref-back");
if (rb) {
  await rb.click({ force: true }); await page.waitForTimeout(2500);
  R.e4.refBack = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll("#right-content .refnet-body")];
    return { n: bodies.length, filled: bodies.map((b) => (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140)).filter(Boolean) };
  });
}
await page.screenshot({ path: OUT + "/screens/e4_retest_topic.png" });

// ── E1 抽检：暖色、无重定向、零 /api ──
await page.goto(BASE + "/", { waitUntil: "networkidle" }); await unroll();
R.e1.info = await page.evaluate(() => ({
  url: location.href, theme: document.documentElement.dataset.theme,
  displayMode: document.documentElement.dataset.displayMode || null,
  badge: (document.querySelector("#display-badge")?.textContent || "").trim(),
  curtopic: (document.querySelector("#curtopic")?.textContent || "").trim().replace(/\s+/g, " "),
  navItems: [...document.querySelectorAll(".navitem[data-nav]")].map((n) => n.getAttribute("data-nav")),
}));

// ── E5 抽检：下载 ZIP 哈希 ──
await clickNav("topic");
const zipHref = await page.$eval('#right-content a[href*="locus-demo-public.zip"]', (a) => a.href).catch(() => null);
R.e5.href = zipHref;
if (zipHref) { const resp = await ctx.request.get(zipHref); const buf = await resp.body(); R.e5.bytes = buf.length; R.e5.sha256 = crypto.createHash("sha256").update(buf).digest("hex"); }

// ── E6-trial 抽检：冷色可用 ──
const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const tp = await tctx.newPage();
await tp.goto(TRIAL + "/", { waitUntil: "networkidle" }); await tp.waitForTimeout(3500);
const tov = await tp.evaluate(() => document.getElementById("overlay")?.className || ""); if (tov.includes("awaiting")) { await tp.mouse.click(720, 450); await tp.waitForTimeout(2500); }
await tp.click("#theme-seal").catch(() => {}); await tp.waitForTimeout(2500);
R.e6trial = await tp.evaluate(() => ({ displayCfg: !!window.__LOCUS_DISPLAY__, theme: document.documentElement.dataset.theme, bodyClass: document.body.className }));
await tctx.close();

R.api = R.reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/"));
R.total = R.reqs.length;
await browser.close();
fs.writeFileSync(OUT + "/raw/e4_retest.json", JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
