// M5 夹具生成器（自生成、可公开合成数据）。运行：node _build-fixtures.mjs
// 生成：samples/samples.json、runs/<task>-old.json、<task>-new.json、new-incomparable.json、
//       ocr/symbols.png、ocr/symbols_unclear.png、ocr/table.png、ocr/manifest.json。
// 提示词 hash 取自已冻结的 baseline/（由 `node scripts/m-eval.ts freeze` 生成）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const shaBuf = (b) => createHash("sha256").update(b).digest("hex");

// ── 自制图：5x7 点阵字（含数字、-、.、m、V、?），画出与验收点匹配的符号/表格 ──
const FONT = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "m": ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
};
function canvas(w, h) {
  const g = Array.from({ length: h }, () => Array.from({ length: w }, () => [255, 255, 255]));
  const set = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) g[y][x] = [0, 0, 0]; };
  const text = (s, x0, y0, sc = 1) => {
    let cx = x0;
    for (const ch of s) {
      const gl = FONT[ch];
      if (gl) for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++) if (gl[ry][rx] === "1") for (let sy = 0; sy < sc; sy++) for (let sx = 0; sx < sc; sx++) set(cx + rx * sc + sx, y0 + ry * sc + sy);
      cx += 6 * sc;
    }
  };
  const line = (x1, y1, x2, y2) => { if (x1 === x2) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) set(x1, y); else if (y1 === y2) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) set(x, y1); };
  return { g, text, line };
}

// ── 样本（12 = 4 任务 × 2 调试 + 1 留出）────────────────────
const samples = [
  { id: "ks-normal", taskId: "knowledge_struct", split: "tuning", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "研究目的：考察温度对产率的影响\n文献材料（第 1/1 部分）：\n在 25 °C 下产率为 60%。在 40 °C 下产率为 82%。",
    acceptancePoints: ["输出为固定结构 {schemaVersion,evidence,contexts,cards,relations}", "evidence.quote 在原文逐字存在", "未知条件列入 unknowns"] },
  { id: "ks-missing", taskId: "knowledge_struct", split: "tuning", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "研究目的：了解某反应\n文献材料（第 1/1 部分）：\n该反应在适宜条件下进行，产率良好。",
    acceptancePoints: ["未写明温度/时间列入 unknowns，不得补造", "不得臆造库内 ID"] },
  { id: "ks-holdout", taskId: "knowledge_struct", split: "holdout", kind: "synthetic", provenance: "本路自建合成（可公开）；验收答案不进入发送输入",
    input: "研究目的：pH 对酶活的影响\n文献材料（第 1/1 部分）：\npH 6 相对活性 50%，pH 7 为 100%，pH 8 为 20%。",
    acceptancePoints: ["结构合法且引用逐字", "不得出现禁止字段 audit/revision/stableId/history"] },

  { id: "ocr-normal", taskId: "handwriting_ocr", split: "tuning", kind: "synthetic", provenance: "自制符号图（非真实手写样本）",
    input: "自制符号图 ocr/symbols.png：含数值 25 与 -3.5 及单位 mV", img: "symbols.png",
    acceptancePoints: ["数值/符号与图一致", "不清晰处以 ? 占位"] },
  { id: "ocr-missing", taskId: "handwriting_ocr", split: "tuning", kind: "synthetic", provenance: "自制符号图（非真实手写样本）",
    input: "自制符号图 ocr/symbols_unclear.png：第二位数字不清、单位缺失", img: "symbols_unclear.png",
    acceptancePoints: ["不清晰处保持未知，不猜测", "单位缺失留空或标未知"] },
  { id: "ocr-holdout", taskId: "handwriting_ocr", split: "holdout", kind: "synthetic", provenance: "自制表格图（非真实手写样本）",
    input: "自制表格图 ocr/table.png：2 列 3 行数值表（1.0–6.0）", img: "table.png",
    acceptancePoints: ["表格结构保持", "数值逐格一致"] },

  { id: "pa-normal", taskId: "pause_assist", split: "tuning", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "方案快照：浸泡 90 天；暂停时执行到第 2 步（第 30 天）。",
    acceptancePoints: ["风险基于给定快照", "恢复检查项具体"] },
  { id: "pa-missing", taskId: "pause_assist", split: "tuning", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "方案快照：步骤时长未知；暂停时执行状态未记录。",
    acceptancePoints: ["未知项列入 unknowns", "不臆造时长"] },
  { id: "pa-holdout", taskId: "pause_assist", split: "holdout", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "方案快照：低温保存 7 天；暂停时已冷冻。",
    acceptancePoints: ["只给建议，不替人做决定"] },

  { id: "ia-normal", taskId: "impact_assess", split: "tuning", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "变更：样品总量由 10 改为 12。上下文快照：执行/样品/测量。",
    acceptancePoints: ["逐条给出受影响对象与类别", "证据不足用 needs_review"] },
  { id: "ia-missing", taskId: "impact_assess", split: "tuning", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "变更：备注文字调整。上下文快照：仅方案。",
    acceptancePoints: ["不得把‘没找到证据’说成‘无影响’"] },
  { id: "ia-holdout", taskId: "impact_assess", split: "holdout", kind: "synthetic", provenance: "本路自建合成（可公开）",
    input: "变更：温度由 25 改为 30。上下文快照：执行/测量/结果。",
    acceptancePoints: ["类别限于 timing/execution/comparability/analysis/interpretation"] },
];

// ── OCR 自制图（像素 → PNG），并绑定图像内容 hash ──
function png(width, height, px) {
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const rows = [];
  for (let y = 0; y < height; y++) { const r = Buffer.alloc(width * 3 + 1); for (let x = 0; x < width; x++) { const [rr, gg, bb] = px(x, y); r[1 + x * 3] = rr; r[2 + x * 3] = gg; r[3 + x * 3] = bb; } rows.push(r); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const mkSymbols = () => { const c = canvas(120, 44); c.text("25", 6, 6, 2); c.text("-3.5", 6, 26, 2); c.text("mV", 84, 26, 2); return png(120, 44, (x, y) => c.g[y][x]); };
const mkUnclear = () => { const c = canvas(96, 30); c.text("2?", 6, 6, 2); return png(96, 30, (x, y) => c.g[y][x]); };
const mkTable = () => {
  const c = canvas(120, 60);
  c.line(4, 4, 116, 4); c.line(4, 24, 116, 24); c.line(4, 44, 116, 44); c.line(4, 4, 4, 56); c.line(60, 4, 60, 56); c.line(116, 4, 116, 56);
  const cells = [["1.0", "3.0"], ["2.0", "4.0"], ["5.0", "6.0"]];
  cells.forEach((row, ri) => row.forEach((t, ci) => c.text(t, 10 + ci * 56, 9 + ri * 20, 1)));
  return png(120, 60, (x, y) => c.g[y][x]);
};
const images = { "symbols.png": mkSymbols(), "symbols_unclear.png": mkUnclear(), "table.png": mkTable() };
const imgHash = (name) => shaBuf(images[name]);

const withHash = samples.map(({ img, ...s }) => ({ ...s, inputHash: sha(s.input), ...(img ? { imageHash: imgHash(img) } : {}) }));

// ── 模拟输出（明确标为模拟）────────────────────────────────
const ksOk = JSON.stringify({ schemaVersion: 1, evidence: [{ localId: "e1", sourceBlockId: "b1", quote: "产率为 60%" }], contexts: [], cards: [], relations: [] });
const ksOk2 = JSON.stringify({ schemaVersion: 1, evidence: [{ localId: "e1", sourceBlockId: "b1", quote: "产率良好" }], contexts: [], cards: [], relations: [] });
const ksOk3 = JSON.stringify({ schemaVersion: 1, evidence: [{ localId: "e1", sourceBlockId: "b1", quote: "pH 7 为 100%" }], contexts: [], cards: [], relations: [] });
const ksOld1 = JSON.stringify({ schemaVersion: 1, revision: 1, evidence: [], contexts: [], cards: [], relations: [] });
const ksOld2 = JSON.stringify({ schemaVersion: 1, evidence: [], contexts: [], cards: [] });

const ocrOk = JSON.stringify({ records: [{ rawText: "25 mV", fields: { value: "25", unit: "mV" }, unknowns: [] }] });
const ocrOk2 = JSON.stringify({ records: [{ rawText: "2? mV", fields: { value: "2?", unit: "" }, unknowns: ["第二位数字不清", "单位缺失"] }] });
const ocrOk3 = JSON.stringify({ records: [{ rawText: "1.0,3.0\n2.0,4.0\n5.0,6.0", fields: {}, unknowns: [] }] });

const paOk = JSON.stringify({ risks: ["浸泡超期风险"], resumeChecks: ["检查溶液是否污染"], unknowns: [] });
const paOk2 = JSON.stringify({ risks: ["时长未知→无法评估超期"], resumeChecks: ["补记暂停时执行状态"], unknowns: ["步骤时长"] });
const paOld1 = JSON.stringify({ risks: ["浸泡超期风险"], unknowns: [] });

const iaOk = JSON.stringify({ summary: "总量变更影响执行与测量", assessment: "impact", items: [{ targetKind: "sample", targetId: "s1", category: "execution", finding: "总量变化", reason: "直接影响", evidenceRefs: [], unknowns: [], suggestedAction: "复核" }] });
const iaOk2 = JSON.stringify({ summary: "仅备注变化，未找到科学影响证据", assessment: "needs_review", items: [{ targetKind: "protocol", targetId: "p1", category: "analysis", finding: "备注变化", reason: "证据不足", evidenceRefs: [], unknowns: ["是否影响分析"], suggestedAction: "人工复核" }] });
const iaOk3 = JSON.stringify({ summary: "温度变更影响可比性", assessment: "impact", items: [{ targetKind: "measurement", targetId: "m1", category: "comparability", finding: "温度不同", reason: "可比性受影响", evidenceRefs: [], unknowns: [], suggestedAction: "更换基线" }] });

// ── 逐任务 old / new（模拟）────────────────────────────────
function baselineFor(taskId) {
  const b = JSON.parse(readFileSync(join(HERE, "baseline", `${taskId}.json`), "utf8"));
  return { versionLabel: b.versionLabel, systemHash: b.systemHash, schemaHash: b.schemaHash };
}
function run(taskId, setId, pairs, extra = {}) {
  const runs = pairs.map(([sampleId, rawOutput]) => {
    const smp = withHash.find((s) => s.id === sampleId);
    let parsed = null, parseError = null;
    try { parsed = JSON.parse(rawOutput); } catch (e) { parseError = String(e.message); }
    return { sampleId, status: parseError ? "parse_error" : "ok", rawOutput, parsed, parseError, processedInputHash: sha(smp.input), ...(smp.imageHash ? { imageHash: smp.imageHash } : {}) };
  });
  return {
    setId, taskId, modelId: "simulated-model", params: { temperature: "0" }, mode: "simulated",
    at: "2026-11-22T00:00:00+08:00", prompt: baselineFor(taskId),
    processing: { processorVersion: "input/v1", params: {} }, runs, ...extra,
  };
}

const sets = {
  "knowledge_struct-old": run("knowledge_struct", "ks-old", [["ks-normal", ksOld1], ["ks-missing", ksOld2], ["ks-holdout", ksOk3]]),
  "knowledge_struct-new": run("knowledge_struct", "ks-new", [["ks-normal", ksOk], ["ks-missing", ksOk2], ["ks-holdout", ksOk3]]),
  "knowledge_struct-new-incomparable": run("knowledge_struct", "ks-new-inc", [["ks-normal", ksOk], ["ks-missing", ksOk2], ["ks-holdout", ksOk3]], { params: { temperature: "0.7" } }),
  "handwriting_ocr-old": run("handwriting_ocr", "ocr-old", [["ocr-normal", ocrOk], ["ocr-missing", ocrOk2], ["ocr-holdout", ocrOk3]]),
  "handwriting_ocr-new": run("handwriting_ocr", "ocr-new", [["ocr-normal", ocrOk], ["ocr-missing", ocrOk2], ["ocr-holdout", ocrOk3]]),
  "pause_assist-old": run("pause_assist", "pa-old", [["pa-normal", paOld1], ["pa-missing", paOk2], ["pa-holdout", paOk]]),
  "pause_assist-new": run("pause_assist", "pa-new", [["pa-normal", paOk], ["pa-missing", paOk2], ["pa-holdout", paOk]]),
  "impact_assess-old": run("impact_assess", "ia-old", [["ia-normal", iaOk], ["ia-missing", iaOk2], ["ia-holdout", iaOk3]]),
  "impact_assess-new": run("impact_assess", "ia-new", [["ia-normal", iaOk], ["ia-missing", iaOk2], ["ia-holdout", iaOk3]]),
};

// ── 写出 ───────────────────────────────────────────────────
function ensure(p) { mkdirSync(dirname(join(HERE, p)), { recursive: true }); }
function out(p, content) { ensure(p); writeFileSync(join(HERE, p), content); }

out("samples/samples.json", JSON.stringify({ note: "可公开合成样本：4 任务 ×（2 调试 + 1 留出）", samples: withHash }, null, 2));
for (const [name, set] of Object.entries(sets)) out(`runs/${name}.json`, JSON.stringify(set, null, 2));
for (const [name, buf] of Object.entries(images)) out(`ocr/${name}`, buf);
out("ocr/manifest.json", JSON.stringify({
  note: "自制符号/表格图（点阵合成，含 25 / -3.5 / mV 与 1.0–6.0），用于离线评测记录格式演示；明确**不是已验证真实手写样本**，不代表模型效果。",
  files: Object.entries(images).map(([file, buf]) => ({ file, sha256: shaBuf(buf), bytes: buf.length })),
}, null, 2));

console.log("fixtures 已生成：samples=%d，runSets=%d，ocr=%d", withHash.length, Object.keys(sets).length, Object.keys(images).length);
