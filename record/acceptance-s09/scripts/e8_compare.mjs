import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "fs";

const PUB = process.env.PUB, PER = process.env.PER, OUT = process.env.OUT;
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });

async function run(base, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const reqs = [];
  page.on("request", (r) => reqs.push({ url: r.url(), method: r.method() }));
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(base + "/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3500);
  const ov = await page.evaluate(() => document.getElementById("overlay")?.className || "");
  if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2500); }

  const nav = async (k) => { await page.keyboard.press("Escape"); await page.waitForTimeout(200); await page.click(`.navitem[data-nav="${k}"]`, { timeout: 5000 }).catch(() => page.click(`.navitem[data-nav="${k}"]`, { force: true })); await page.waitForTimeout(1200); };

  const R = { tag, base, errs };
  R.boot = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    displayMode: document.documentElement.dataset.displayMode || null,
    hasCfg: !!window.__LOCUS_DISPLAY__,
    navItems: [...document.querySelectorAll(".navitem[data-nav]")].map((n) => n.getAttribute("data-nav")),
    banner: !!document.querySelector(".display-badge"),
    curtopic: (document.querySelector("#curtopic")?.textContent || "").trim().replace(/\s+/g, " "),
  }));

  const cap = async () => page.evaluate(() => {
    const cls = (sel) => [...document.querySelectorAll(sel)].map((e) => (e.className || "").toString().trim()).filter(Boolean);
    return {
      bodyNav: document.body.dataset.nav,
      midTitle: (document.querySelector("#mid-title")?.textContent || "").trim(),
      midClasses: cls("#mid-content > *, #mid-content [class]").slice(0, 60),
      rightClasses: cls("#right-content > *, #right-content [class]").slice(0, 60),
    };
  });

  R.views = {};
  for (const k of ["papers", "knowledge", "protocol", "record", "analysis"]) {
    await nav(k);
    R.views[k] = await cap();
  }
  // 交互：知识卡展开
  await nav("knowledge");
  const cardSel = ".kz-card, .kzrow, .item .kzrow, [data-kz-card], .kzi-row, [data-cardid]";
  R.interact = {};
  R.interact.cardBefore = await page.evaluate(() => document.querySelectorAll("[aria-expanded]").length);
  const firstBtn = await page.$("#mid-content [aria-expanded], #right-content [aria-expanded], .kz-card, .kzrow");
  if (firstBtn) { await firstBtn.click({ force: true }).catch(() => {}); await page.waitForTimeout(900); }
  R.interact.cardAfter = await page.evaluate(() => ({
    expanded: document.querySelectorAll('[aria-expanded="true"]').length,
    detail: !!document.querySelector(".kz-detail, .kzrow.open, .card-open, .kzstruct, .lv-cdetail"),
  }));
  // 表格
  await nav("analysis");
  const tbl = await page.$(".tbl-open");
  R.interact.tblOpen = !!tbl;
  if (tbl) { await tbl.click({ force: true }).catch(() => {}); await page.waitForTimeout(1000); }
  R.interact.tableShown = await page.evaluate(() => ({ hasTableMax: !!document.querySelector("#table-max"), hasTable: !!document.querySelector("table") }));

  R.reqs = reqs;
  R.apiReqs = reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/"));
  R.demoReq = reqs.filter((r) => r.url.includes("/demo-data/"));
  R.libPages = [...new Set(reqs.map((r) => { const m = r.url.match(/\/lib\/pages\/([^?]+)/); return m ? m[1] : null; }).filter(Boolean))].sort();
  await page.screenshot({ path: `${OUT}/screens/e8_${tag}_knowledge.png` });
  await ctx.close();
  return R;
}

const pub = await run(PUB, "public");
const per = await run(PER, "personal");

function overlap(a, b) {
  const A = new Set(a), B = new Set(b);
  const onlyA = [...A].filter((x) => !B.has(x));
  const onlyB = [...B].filter((x) => !A.has(x));
  return { common: [...A].filter((x) => B.has(x)).length, onlyA, onlyB };
}
const out = { pub, per, cmp: {} };
for (const k of ["navItems"]) out.cmp.k = overlap(pub.boot.navItems, per.boot.navItems);
out.cmp.libPages = overlap(pub.libPages, per.libPages);
for (const v of ["knowledge", "protocol", "analysis", "record", "papers"]) {
  out.cmp["mid_" + v] = overlap(pub.views[v].midClasses, per.views[v].midClasses);
  out.cmp["right_" + v] = overlap(pub.views[v].rightClasses, per.views[v].rightClasses);
}
await browser.close();
fs.writeFileSync(OUT + "/raw/e8_compare.json", JSON.stringify(out, null, 2));
console.log("written");
