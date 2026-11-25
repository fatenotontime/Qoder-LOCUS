import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "fs";

const BASE = process.env.BASE;
const OUT = process.env.OUT;
const res = { e1: {}, reqs: [] };

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("request", (r) => res.reqs.push({ url: r.url(), method: r.method(), type: r.resourceType() }));

async function snapInfo() {
  return page.evaluate(() => {
    const vis = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { hidden: e.hidden, visible: r.width > 0 && r.height > 0 }; };
    const notice = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && (e.textContent || "").includes("界面资源没有加载"));
    return {
      url: location.href,
      title: document.title,
      theme: document.documentElement.getAttribute("data-theme"),
      displayMode: document.documentElement.dataset.displayMode || null,
      displayCfg: window.__LOCUS_DISPLAY__ || null,
      curtopic: (document.querySelector("#curtopic")?.textContent || "").trim(),
      badge: (document.querySelector("#display-badge")?.textContent || "").trim(),
      navItems: [...document.querySelectorAll(".navitem[data-nav]")].map((n) => n.getAttribute("data-nav")),
      cols: { left: !!document.querySelector(".col-left,.left,aside.left,.err-left"), hasMid: !!document.querySelector("#mid-content"), hasRight: !!document.querySelector("#right-content") },
      themeSeal: vis("#theme-seal"),
      noticeVisible: notice ? (notice.getBoundingClientRect().width > 0 && notice.getBoundingClientRect().height > 0) : false,
    };
  });
}

// —— 第一次打开 / ——
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1200);
res.e1.firstLoad = await snapInfo();
await page.screenshot({ path: OUT + "/screens/e1_root_first.png" });

// —— 刷新 ——
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1000);
res.e1.afterReload = await snapInfo();
await page.screenshot({ path: OUT + "/screens/e1_root_reload.png" });

// —— 旧链接 /demo/demo.html ——
await page.goto(BASE + "/demo/demo.html", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1200);
res.e1.legacyUrl = await snapInfo();
await page.screenshot({ path: OUT + "/screens/e1_legacy.png" });

res.apiRequests = res.reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/"));
res.totalRequests = res.reqs.length;
await browser.close();
fs.writeFileSync(OUT + "/raw/e1.json", JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
