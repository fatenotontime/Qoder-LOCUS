// 从 Europe PMC 拉取公开论文全文（JATS XML）并转为可读文本，附来源与许可署名。
// 用法：node scripts/fetch-paper.ts <PMCID> [输出文件] [--xml 本地XML]
// 仅用于验收材料：只处理开放获取（CC BY 等）论文；不改写原文，不做节选冒充全文。
import { readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const xmlFlag = argv.indexOf("--xml");
const localXml = xmlFlag >= 0 ? argv[xmlFlag + 1] : null;
const positional = argv.filter((a, i) => (xmlFlag < 0 || (i !== xmlFlag && i !== xmlFlag + 1)) && !a.startsWith("--"));
const pmcid = positional[0];
const outFile = positional[1] ?? `data/paper-${pmcid}.md`;
if (!pmcid) { console.error("用法：node scripts/fetch-paper.ts <PMCID> [输出文件] [--xml 本地XML]"); process.exit(1); }

const xml = localXml
  ? await readFile(localXml, "utf8")
  : await (async () => {
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Europe PMC 返回 ${r.status}：${url}`);
      return r.text();
    })();

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x?([0-9a-fA-F]+);/g, (_, c) => String.fromCodePoint(parseInt(c, 16)));

// 轻量 JATS 遍历：按元素规则抽取正文文本，跳过参考文献与元数据噪声。
const SKIP = new Set(["ref-list", "ack", "fn-group", "author-notes", "processing-meta", "journal-meta", "contrib-group", "aff", "funding-group", "custom-meta-group", "article-categories", "kwd-group", "permissions", "self-uri", "sub-article", "article-id", "article-version", "issue-id", "pub-date", "date", "history", "volume", "issue", "fpage", "lpage", "elocation-id", "article-categories"]);
const out: string[] = [];
const meta: Record<string, string> = {};
let skipDepth = 0;
const stack: string[] = [];
const buf = { text: "" };
const tokens = String(xml).match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? [];

function flush(prefix = "", suffix = "\n") {
  const t = buf.text.replace(/\s+/g, " ").trim();
  buf.text = "";
  if (t) out.push(prefix + unescape(t) + suffix);
}

for (const tok of tokens) {
  if (tok.startsWith("<!--") || tok.startsWith("<!")) continue;
  if (tok.startsWith("<")) {
    const close = tok.startsWith("</");
    const name = tok.replace(/^<\/?/, "").replace(/[\s/>].*$/, "").toLowerCase();
    if (!close && SKIP.has(name)) { skipDepth++; stack.push(name); continue; }
    if (close) {
      if (SKIP.has(name)) { skipDepth = Math.max(0, skipDepth - 1); stack.pop(); continue; }
      stack.pop();
      if (skipDepth) continue;
      if (name === "article-title") flush("", "\n\n");
      else if (name === "journal-title" && !meta.journal) flush("期刊：", "\n");
      else if (name === "p") { flush("", "\n\n"); out.push(""); }
      else if (name === "title" && stack[stack.length - 1] === "sec") flush("", "\n");
      else if (name === "caption") flush("[图表] ", "\n");
      else if (name === "license-p") flush("[许可] ", "\n");
      else if (name === "label") flush("", "\n");
      else if (name === "cell") { buf.text += " | "; }
      else if (name === "row") { flush("", "\n"); }
      else if (name === "supplementary-material") flush("[补充材料] ", "\n");
      continue;
    }
    // 开标签
    const parent = stack[stack.length - 1];
    stack.push(name);
    if (/<[^>]*\/>$/.test(tok)) {
      stack.pop();
      if (skipDepth && SKIP.has(name)) skipDepth = Math.max(0, skipDepth - 1);
      continue;
    }
    if (name === "title" && parent === "sec") { flush(); out.push("\n\n## "); }
    if (name === "abstract" && !/abstract-type/.test(tok)) { flush(); out.push("\n\n[摘要] "); }
    continue;
  }
  if (skipDepth) continue;
  buf.text += tok;
}
// front 元数据（标题/DOI/日期/许可）从原 XML 直取，避免顺序耦合
const clean = (s: string) => unescape(s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
const grab = (re: RegExp) => clean(re.exec(String(xml))?.[1] ?? "");
const title = grab(/<article-title[^>]*>([\s\S]*?)<\/article-title>/);
const doi = (String(xml).match(/pub-id-type="doi"[^>]*>([^<]+)</) ?? [])[1] ?? "";
const license = grab(/<license[\s\S]*?<license-p[^>]*>([\s\S]*?)<\/license-p>/) || "见原文";
const year = (String(xml).match(/<year[^>]*>(\d{4})<\/year>/) ?? [])[1] ?? "";
const journal = grab(/<journal-title[^>]*>([\s\S]*?)<\/journal-title>/);
const authors = [...String(xml).matchAll(/<contrib[^>]*contrib-type="author"[\s\S]*?<\/contrib>/g)].map((m) => {
  const s = clean(/(<surname[^>]*>[\s\S]*?<\/surname>)/.exec(m[0])?.[1] ?? "");
  const g = clean(/(<given-names[^>]*>[\s\S]*?<\/given-names>)/.exec(m[0])?.[1] ?? "");
  return [g, s].filter(Boolean).join(" ");
}).filter(Boolean).slice(0, 12).join("、");

const today = new Date().toISOString().slice(0, 10);
const header = [
  `# ${title}`,
  "",
  `来源：Europe PMC ${pmcid} · DOI ${doi} · ${journal} (${year}) · 许可：${license}`,
  `作者：${authors || "（见原文）"}`,
  `原始全文：https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML（获取于 ${today}）`,
  `说明：本文件由 scripts/fetch-paper.ts 从公开 JATS 全文机械转换（未改写内容）；署名与许可见上，转载/引用请遵循原文许可。`,
  "",
  "---",
  "",
].join("\n");

const body = out.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
await writeFile(outFile, header + body + "\n");
console.log(`已写出 ${outFile}（${title.slice(0, 60)}…，${(header + body).length} 字符，许可 ${license.slice(0, 40)}）`);
