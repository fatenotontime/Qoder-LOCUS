// 打包评委 ZIP（纯 Node，无网络、无外部依赖，STORED 存储法，输出确定性）。
// 内容：originals/ 原件与数据集 + docs/ 来源许可与五步走查 + 顶层 README。
// 运行：node locus-site/demo-data/tools/build-judge-zip.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..");
const ZIP_PATH = join(OUT, "locus-demo-public.zip");

// ── CRC32 ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// ── 收集文件 ──
const entries = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else entries.push({ name: relative(OUT, p).split(sep).join(posix.sep), data: readFileSync(p) });
  }
};
walk(join(OUT, "originals"));
walk(join(OUT, "docs"));

const zipReadme = `# LOCUS 公开展示 · 评委样本包

本包为「种子经海水漂流后的萌发（达尔文 1859）」公开展示样本，全部原件为公有领域，可自由查看与再分发。

- originals/            可再分发原件与数据集（达尔文原文摘录、Wikisource 影印页 wikitext、CSV 数据集）
- docs/来源与许可.md    来源、许可、页码两套编号、性质声明
- docs/五步走查.md      展示主线五步走查
- docs/站内映射.md      站内对象 ↔ 本包文件映射

对照站上文献与数据请看 docs/站内映射.md。校验值见随仓库提供的 SHA256SUMS.txt。
`;
entries.unshift({ name: "README.md", data: Buffer.from(zipReadme, "utf8") });
// 保持确定性排序（README 在最前）
entries.sort((a, b) => (a.name === "README.md" ? -1 : b.name === "README.md" ? 1 : a.name < b.name ? -1 : 1));

// ── 组 ZIP（STORED）──
const local = [];
const central = [];
let offset = 0;
const DOS_TIME = 0, DOS_DATE = 33; // 1980-01-01
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, "utf8");
  const crc = crc32(e.data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(0, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
  local.push(lh, nameBuf, e.data);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(0, 10); ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);
  offset += lh.length + nameBuf.length + e.data.length;
}
const localBuf = Buffer.concat(local);
const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(localBuf.length, 16); eocd.writeUInt16LE(0, 20);
const zipBuf = Buffer.concat([localBuf, centralBuf, eocd]);
writeFileSync(ZIP_PATH, zipBuf);

const sha = createHash("sha256").update(zipBuf).digest("hex");
console.log("ZIP 完成：", { file: relative(resolve(HERE, "../../.."), ZIP_PATH), entries: entries.length, bytes: zipBuf.length, sha256: sha });
for (const e of entries) console.log("  -", e.name, e.data.length);
