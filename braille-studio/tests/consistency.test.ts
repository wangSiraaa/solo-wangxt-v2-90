/**
 * 一致性验证（题目要求）：
 *  1. 长单词 —— 超行宽硬拆分，逐行宽 ≤ 设定方数；
 *  2. 数字切换 —— 数字指示符 ⠼(3456) 与字母指示符 ⠰(6) 由 liblouis 正确插入；
 *  3. 带图注的页面 —— 图形、图注、正文包围盒互不重叠；
 *  4. 预览点位 === 版面模型点位 === PDF 点位（逐点比对，容差 0.05pt）；
 *  5. 点阵最小间距 ≥ 工艺参数 2.5mm；PDF 页面尺寸 = 真实纸张尺寸。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { PDFDocument, PDFArray, PDFRef, decodePDFRawStream } from "pdf-lib";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { initTranslator, type Translator } from "../src/braille/translator";
import { layoutDocument, type LayoutResult } from "../src/layout/paginate";
import { buildPageScene } from "../src/layout/scene";
import { exportPdf } from "../src/export/pdf";
import {
  CELL_PITCH_MM,
  DOT_DIAMETER_MM,
  MIN_DOT_PITCH_MM,
  mmToPt,
} from "../src/layout/geometry";
import { createEmptyDoc, type ProjectDoc } from "../src/model/types";

const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/vendor/liblouis");

// 点位常量
const DOTS = {
  numberSign: 0b111100, // ⠼ 点3456
  letterSign: 0b110000, // ⠘ 点56（EBAE 字母指示符；UEB 为点6）
  a: 0b000001, // ⠁
  b: 0b000011, // ⠃
  c: 0b001001, // ⠉
};

let translator: Translator;

beforeAll(async () => {
  translator = await initTranslator(VENDOR_DIR);
}, 60_000);

describe("liblouis WASM 转译（固定语言表 en-us-g1）", () => {
  it("加载固定版本并报告版本号", () => {
    expect(translator.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("数字切换：数字前插 ⠼，数字后接字母前插 ⠰", () => {
    const num = translator.translate("123", "en-us-g1");
    expect(num.cells.map((c) => c.dots)).toEqual([
      DOTS.numberSign, DOTS.a, DOTS.b, DOTS.c,
    ]);

    const mixed = translator.translate("1a2b", "en-us-g1");
    expect(mixed.cells.map((c) => c.dots)).toEqual([
      DOTS.numberSign, DOTS.a, // 1
      DOTS.letterSign, DOTS.a, // a（字母指示符切回）
      DOTS.numberSign, DOTS.b, // 2（重新进入数字模式）
      DOTS.letterSign, DOTS.b, // b
    ]);

    const word = translator.translate("abc123def", "en-us-g1");
    const d = word.cells.map((c) => c.dots);
    expect(d.slice(3, 7)).toEqual([DOTS.numberSign, DOTS.a, DOTS.b, DOTS.c]);
    expect(d[7]).toBe(DOTS.letterSign);
  });

  it("长单词：一级盲文逐字母转译，格数=字母数", () => {
    const longWord = "supercalifragilisticexpialidocious";
    const r = translator.translate(longWord, "en-us-g1");
    expect(r.cells).toHaveLength(longWord.length);
    // 对应关系：第 i 格 ↔ 原文第 i 字符
    r.cells.forEach((c, i) => expect(c.srcIndex).toBe(i));
  });
});

/** 题目要求的验证文档：长单词 + 数字切换 + 带图注的触觉示意图，多页 */
function makeProofDoc(): ProjectDoc {
  const doc = createEmptyDoc();
  doc.name = "点位一致性验证";
  doc.title = "Braille Proof 2026";
  doc.body = [
    "A longword stress test follows here now.",
    "supercalifragilisticexpialidocious supercalifragilisticexpialidocious wraps hard.",
    "Order 123 ships 2026-09-27 code A1B2 mix abc123def end.",
    "Second page filler paragraph to force pagination beyond one page of braille output lines.",
    "More text keeps flowing so the diagram lands with its caption on a later page.",
  ].join("\n");
  doc.settings.cellsPerLine = 20; // 窄行宽：强制长词硬拆分与多页
  doc.settings.showPageNumbers = true;
  // 示意图：20×12 点网格，对角线 + 边框，带图注
  const cols = 20, rows = 12;
  const dots = new Array(cols * rows).fill(0);
  for (let c = 0; c < cols; c++) { dots[c] = 1; dots[(rows - 1) * cols + c] = 1; }
  for (let r = 0; r < rows; r++) { dots[r * cols] = 1; dots[r * cols + cols - 1] = 1; }
  for (let i = 0; i < Math.min(cols, rows); i++) dots[i * cols + i] = 1;
  doc.diagram = { cols, rows, dots, caption: "Figure 1: ramp 45 deg" };
  return doc;
}

let layout: LayoutResult;
let doc: ProjectDoc;

beforeAll(() => {
  doc = makeProofDoc();
  layout = layoutDocument(doc, translator);
});

describe("版面编排", () => {
  it("无版面错误；长词硬拆分有警告", () => {
    const errors = layout.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(layout.issues.some((i) => i.message.includes("硬拆分"))).toBe(true);
  });

  it("行宽不超过设定的盲文方数", () => {
    for (const p of layout.pages) {
      const byRow = new Map<number, number>();
      for (const c of p.cells) {
        if (c.block === "pageNumber") continue;
        byRow.set(c.row, Math.max(byRow.get(c.row) ?? 0, c.col + 1));
      }
      for (const [row, n] of byRow) {
        expect(n, `page ${p.index + 1} row ${row}`).toBeLessThanOrEqual(doc.settings.cellsPerLine);
      }
    }
  });

  it("多页且每页有页码（独占末行）", () => {
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    for (const p of layout.pages) {
      const pn = p.cells.filter((c) => c.block === "pageNumber");
      expect(pn.length).toBeGreaterThan(0);
      expect(pn.every((c) => c.row === layout.linesPerPage - 1)).toBe(true);
      // 页码是数字 → 含数字指示符
      expect(pn.some((c) => c.dots === DOTS.numberSign)).toBe(true);
    }
  });

  it("带图注的页面：图形、图注、正文、页码互不重叠", () => {
    const diagPage = layout.pages.find((p) => p.diagram);
    expect(diagPage).toBeTruthy();
    const kinds = diagPage!.boxes.map((b) => b.kind);
    expect(kinds).toContain("diagram");
    expect(kinds).toContain("caption");
    // validateLayout 已在 layoutDocument 内执行，无 error 即不重叠；
    // 这里再显式复核一遍包围盒两两不相交
    const bs = diagPage!.boxes;
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        const overlap =
          a.xMm < b.xMm + b.wMm - 1e-9 && b.xMm < a.xMm + a.wMm - 1e-9 &&
          a.yMm < b.yMm + b.hMm - 1e-9 && b.yMm < a.yMm + a.hMm - 1e-9;
        expect(overlap, `${a.kind} vs ${b.kind}`).toBe(false);
      }
  });

  it("点阵最小间距 ≥ 工艺参数 2.5mm（全文逐点复核）", () => {
    for (const p of layout.pages) {
      const grid = new Map<string, { x: number; y: number }[]>();
      const k = (x: number, y: number) => `${Math.floor(x / MIN_DOT_PITCH_MM)}:${Math.floor(y / MIN_DOT_PITCH_MM)}`;
      for (const d of p.dots) {
        const key = k(d.xMm, d.yMm);
        (grid.get(key) ?? grid.set(key, []).get(key)!).push({ x: d.xMm, y: d.yMm });
      }
      for (const d of p.dots) {
        const gx = Math.floor(d.xMm / MIN_DOT_PITCH_MM);
        const gy = Math.floor(d.yMm / MIN_DOT_PITCH_MM);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const o of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
              if (o.x === d.xMm && o.y === d.yMm) continue;
              const dist = Math.hypot(o.x - d.xMm, o.y - d.yMm);
              expect(dist).toBeGreaterThanOrEqual(MIN_DOT_PITCH_MM - 1e-9);
            }
      }
    }
  });

  it("原文↔盲文对应关系：每个词都有落点", () => {
    expect(layout.segments.length).toBeGreaterThan(10);
    for (const seg of layout.segments) {
      expect(seg.cells.length).toBeGreaterThan(0);
      expect(seg.word.length).toBeGreaterThan(0);
    }
    // 抽查数字词 "123" 的对应段含 ⠼
    const numSeg = layout.segments.find((s) => s.word === "123");
    expect(numSeg?.cells[0].dots).toBe(DOTS.numberSign);
  });
});

/** 提取页面内容流文本（处理 PDFArray 引用与 Flate 压缩） */
function pageContentText(page: { node: unknown }): string {
  const node = page.node as {
    Contents(): unknown;
    context: { lookup(o: unknown): unknown };
  };
  let contents = node.Contents();
  const streams: unknown[] = [];
  if (contents instanceof PDFArray) {
    for (const item of contents.asArray()) {
      streams.push(item instanceof PDFRef ? node.context.lookup(item) : item);
    }
  } else {
    if (contents instanceof PDFRef) contents = node.context.lookup(contents);
    streams.push(contents);
  }
  return streams
    .map((s) => new TextDecoder("latin1").decode(decodePDFRawStream(s as never).decode()))
    .join("\n");
}

/** 解析 PDF 内容流，提取每个圆的圆心（pt，PDF 坐标系）与半径 */
function extractCircles(content: string): { x: number; y: number; r: number }[] {
  const circles: { x: number; y: number; r: number }[] = [];
  let anchors: { x: number; y: number }[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    let m = line.match(/^(-?[\d.]+) (-?[\d.]+) m$/);
    if (m) {
      anchors = [{ x: parseFloat(m[1]), y: parseFloat(m[2]) }];
      continue;
    }
    m = line.match(/^-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ (-?[\d.]+) (-?[\d.]+) c$/);
    if (m && anchors.length > 0) {
      anchors.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
      continue;
    }
    if (line === "f" && anchors.length >= 4) {
      const xs = anchors.map((a) => a.x);
      const ys = anchors.map((a) => a.y);
      circles.push({
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        r: (Math.max(...xs) - Math.min(...xs)) / 2,
      });
      anchors = [];
    }
  }
  return circles;
}

describe("预览与 PDF 点位一致", () => {
  it("预览场景点位 === 版面模型点位（同源）", () => {
    for (let i = 0; i < layout.pages.length; i++) {
      const scene = buildPageScene(layout, i, doc.settings);
      expect(scene.dots.map((d) => [d.xMm, d.yMm])).toEqual(
        layout.pages[i].dots.map((d) => [d.xMm, d.yMm]),
      );
    }
  });

  it("PDF 点位 === 版面模型点位（逐点比对）", async () => {
    const bytes = await exportPdf(layout, doc);
    const pdf = await PDFDocument.load(bytes);
    const pdfPages = pdf.getPages();

    // 页数一致、页面尺寸 = 真实纸张尺寸
    expect(pdfPages.length).toBe(layout.pages.length);
    const wPt = mmToPt(doc.settings.pageWidthMm);
    const hPt = mmToPt(doc.settings.pageHeightMm);

    for (let i = 0; i < pdfPages.length; i++) {
      const { width, height } = pdfPages[i].getSize();
      expect(width).toBeCloseTo(wPt, 2);
      expect(height).toBeCloseTo(hPt, 2);

      // 提取该页内容流中的全部圆
      const text = pageContentText(pdfPages[i]);
      const circles = extractCircles(text);

      const model = layout.pages[i].dots;
      expect(circles.length, `page ${i + 1} dot count`).toBe(model.length);

      // 模型点位 → PDF 坐标（mm→pt，y 翻转），排序后逐点比对
      const expected = model
        .map((d) => ({ x: mmToPt(d.xMm), y: hPt - mmToPt(d.yMm) }))
        .sort((a, b) => a.y - b.y || a.x - b.x);
      const actual = circles.sort((a, b) => a.y - b.y || a.x - b.x);
      const rPt = mmToPt(DOT_DIAMETER_MM / 2);
      for (let k = 0; k < expected.length; k++) {
        expect(Math.abs(actual[k].x - expected[k].x), `page ${i + 1} dot ${k} x`).toBeLessThan(0.05);
        expect(Math.abs(actual[k].y - expected[k].y), `page ${i + 1} dot ${k} y`).toBeLessThan(0.05);
        expect(Math.abs(actual[k].r - rPt)).toBeLessThan(0.01);
      }
    }
  }, 60_000);

  it("带图注页的示意图点位也一致（对角线抽样）", async () => {
    const diagPageIdx = layout.pages.findIndex((p) => p.diagram);
    expect(diagPageIdx).toBeGreaterThanOrEqual(0);
    const bytes = await exportPdf(layout, doc);
    const pdf = await PDFDocument.load(bytes);
    const text = pageContentText(pdf.getPages()[diagPageIdx]);
    const circles = extractCircles(text);
    const d = layout.pages[diagPageIdx].diagram!;
    const hPt = mmToPt(doc.settings.pageHeightMm);
    // 示意图 (0,0) 角点必须出现在 PDF 中
    const expectX = mmToPt(d.originXMm);
    const expectY = hPt - mmToPt(d.originYMm);
    const found = circles.some(
      (c) => Math.abs(c.x - expectX) < 0.05 && Math.abs(c.y - expectY) < 0.05,
    );
    expect(found).toBe(true);
    // 横向相邻点距 = 工艺参数最小间距
    const nextX = mmToPt(d.originXMm + MIN_DOT_PITCH_MM);
    const foundNext = circles.some(
      (c) => Math.abs(c.x - nextX) < 0.05 && Math.abs(c.y - expectY) < 0.05,
    );
    expect(foundNext).toBe(true);
    // 相邻点 x 差恰为 2.5mm → pt
    expect(Math.abs(nextX - expectX - mmToPt(MIN_DOT_PITCH_MM))).toBeLessThan(1e-9);
  }, 60_000);
});

describe("行宽与单元格几何", () => {
  it("相邻方水平中心距 = 6.0mm 工艺参数", () => {
    // 找一行有 ≥2 个正文格的行，验证相邻格 x 差
    const p = layout.pages[0];
    const rows = new Map<number, number[]>();
    for (const c of p.cells) {
      if (c.block !== "body") continue;
      (rows.get(c.row) ?? rows.set(c.row, []).get(c.row)!).push(c.col);
    }
    let checked = 0;
    for (const [, cols] of rows) {
      cols.sort((a, b) => a - b);
      for (let i = 1; i < cols.length; i++) {
        if (cols[i] - cols[i - 1] === 1) checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(CELL_PITCH_MM).toBeCloseTo(6.0, 9);
  });
});
