import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SRC = "F:/Qoder dev competition/record/showcase";
const OUT_DIR = "C:/Users/PC/.qoder/app/chat-session-visualizations/78293572-535c-41d2-b712-648c689a94b1/visualizations";
mkdirSync(OUT_DIR, { recursive: true });

const names = { "01": "splash", "02": "topic-paper", "03": "topic-tech", "04": "record-paper", "05": "analysis-paper", "06": "knowledge-paper", "07": "protocol-tech" };
const map = {};
for (const [n, slug] of Object.entries(names)) map[n] = "data:image/jpeg;base64," + readFileSync(`${SRC}/${n}-${slug}.jpg`).toString("base64");

let html = readFileSync("scripts/_showcase-template.html", "utf8");
html = html.split("__IMGMAP__").join(JSON.stringify(map));
if (/__IMG/.test(html)) throw new Error("unreplaced placeholder");
const out = `${OUT_DIR}/locus-frontend-showcase.html`;
writeFileSync(out, html);
console.log("written", out, html.length, "chars", Buffer.byteLength(html), "bytes");