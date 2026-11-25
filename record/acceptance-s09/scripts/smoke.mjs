import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://127.0.0.1:5280";
const OUT = process.env.OUT || "F:/Qoder dev competition/.worktrees/e2/record/acceptance-s09/evidence";

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
const page = await ctx.newPage();
const reqs = [];
page.on("request", (r) => reqs.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
page.on("console", (m) => console.log("[console]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()?.errorText));

await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "/screens/smoke_root.png", fullPage: false });

const info = await page.evaluate(() => {
  const html = document.documentElement;
  const nav = [...document.querySelectorAll("nav a, .nav-item, [data-nav]")].map((n) => (n.textContent || "").trim()).filter(Boolean);
  return {
    title: document.title,
    htmlTheme: html.getAttribute("data-theme"),
    htmlClass: html.className,
    bodyClass: document.body.className,
    hasDisplay: !!window.__LOCUS_DISPLAY__,
    display: window.__LOCUS_DISPLAY__ || null,
    navTexts: nav.slice(0, 30),
    hasThreeCol: !!document.querySelector(".col-left, .left, aside"),
    labelTexts: [...document.querySelectorAll("*")].map(e=>e.childElementCount===0?(e.textContent||"").trim():"").filter(t=>t.includes("展示课题")||t.includes("只读")).slice(0,5),
    ids: [...document.querySelectorAll("[id]")].map(e=>e.id).slice(0,80),
  };
});
console.log("INFO", JSON.stringify(info, null, 2));
const apiReqs = reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/"));
console.log("TOTAL_REQ", reqs.length, "API_REQ", apiReqs.length, JSON.stringify(apiReqs));
await browser.close();
