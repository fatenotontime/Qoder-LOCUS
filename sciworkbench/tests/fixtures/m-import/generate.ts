/**
 * M 导入路 · 夹具生成源（自生成、可公开）。
 * 产出**真格式**文件（非改后缀的文本），供 m-import-* 测试使用。
 * 用法：node tests/fixtures/m-import/generate.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from "docx";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = (name: string, data: Uint8Array | Buffer) => {
  writeFileSync(join(HERE, name), Buffer.from(data));
  console.log("wrote", name, Buffer.from(data).length, "bytes");
};

async function makeTextPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([400, 300]);
  p1.drawText("Page one alpha", { x: 40, y: 250, size: 16, font, color: rgb(0, 0, 0) });
  p1.drawText("second line", { x: 40, y: 220, size: 12, font });
  const p2 = pdf.addPage([400, 300]);
  p2.drawText("Page two beta \u00e9\u00fc\u00b0\u00d7\u00b1\u00b5", { x: 40, y: 250, size: 16, font });
  return pdf.save();
}

async function makeScannedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const p = pdf.addPage([400, 300]);
  p.drawRectangle({ x: 20, y: 20, width: 360, height: 260, color: rgb(0.8, 0.8, 0.8) });
  return pdf.save();
}

async function makeMixedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([400, 300]);
  p1.drawText("readable page 1", { x: 40, y: 250, size: 16, font });
  const p2 = pdf.addPage([400, 300]);
  p2.drawRectangle({ x: 20, y: 20, width: 360, height: 260, color: rgb(0.7, 0.7, 0.7) }); // 无文字页
  return pdf.save();
}

async function makeDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("段落一 中文内容 alpha")] }),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph("r1c1")] }), new TableCell({ children: [new Paragraph("r1c2")] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph("r2c1")] }), new TableCell({ children: [new Paragraph("r2c2")] })] }),
            ],
          }),
          new Paragraph({ children: [new TextRun("段落二 中文内容 omega")] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** 合并表头 A1:B1（A1=7）——回归：合并非主格不得伪复制主格值。 */
async function makeMergedXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("M");
  ws.mergeCells("A1:B1");
  ws.getCell("A1").value = 7;
  ws.getCell("A2").value = 1;
  ws.getCell("B2").value = 2;
  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

/** 日期格——回归：确定性表示（UTC ISO），不得用本机 locale 文本。 */
async function makeDatesXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("D");
  const c = ws.getCell("A1");
  c.value = new Date(Date.UTC(2024, 0, 1));
  c.numFmt = "yyyy-mm-dd";
  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

/** 同格两段落 + 列表——回归：段落/列表项不得粘连。 */
async function makeCellMultiDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("10"), new Paragraph("20")] }),
                  new TableCell({ children: [new Paragraph("x")] }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: "alpha", bullet: { level: 0 } }),
          new Paragraph({ text: "beta", bullet: { level: 0 } }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function makeXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet("Data");
  data.getCell("A1").value = "x";
  data.getCell("B1").value = "y";
  data.getCell("A2").value = 1;
  // B2 空（稀疏行）
  data.getCell("A3").value = 2;
  data.getCell("B3").value = 3;
  // 空行（第 4 行整体留空），第 5 行合并 B5:C5
  data.getCell("A5").value = 5;
  data.mergeCells("B5:C5");
  data.getCell("B5").value = "merged";

  const second = wb.addWorksheet("Second", { state: "hidden" });
  second.getCell("A1").value = { formula: "SUM(Data!A2:A3)", result: 3 }; // 有缓存值
  second.getCell("A2").value = { formula: "Data!A5" }; // 无缓存值

  wb.addWorksheet("Empty");

  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

const textFiles: [string, string][] = [
  ["sample.md", "# Title\n\nParagraph one.\n\n- item a\n- item b\n"],
  ["sample.txt", "line one\r\nline two\r\n\r\nline four\r\n"],
  ["sample-bom.csv", "\uFEFFx,y\r\n1,2\r\n3,4\r\n"],
  ["sample-quoted.csv", 'name,note\n"Smith, J","line1\nline2"\n'],
  ["sample.tsv", "a\tb\n1\t2\n"],
  ["sparse-l3.csv", "x,y\n1,\n2,3\n"],
  ["multilevel.csv", "P,,Q,\nName,Val,Name,Val\np,1,q,2\n"],
  ["single-cell.csv", ",\n   Data,\nID,Type,Name,Val,Unit\n0,Time [min],,,\n0,Abs,r,1,u\n"],
];

export async function generateAll(): Promise<void> {
  out("text-2page.pdf", await makeTextPdf());
  out("scanned.pdf", await makeScannedPdf());
  out("mixed.pdf", await makeMixedPdf());
  out("p-t-p.docx", await makeDocx());
  out("multi-sheet.xlsx", await makeXlsx());
  out("merged.xlsx", await makeMergedXlsx());
  out("dates.xlsx", await makeDatesXlsx());
  out("cell-multi.docx", await makeCellMultiDocx());
  for (const [name, content] of textFiles) out(name, Buffer.from(content, "utf8"));
  // 损坏文件（非真 PDF）
  out("corrupt.pdf", Buffer.from("%PDF-1.4 this is not a real pdf body", "latin1"));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate.ts")) {
  await generateAll();
}
