/**
 * 版面编排引擎。
 *
 * 输入工程文档 + 转译器，输出：
 *  - 每页每个凸点的精确位置（mm，页面左上角原点）—— Canvas 预览与 PDF 导出共用
 *  - 所有版面元素的包围盒 + 防重叠校验（图形、图注、正文、页码互不重叠）
 *  - 原文↔盲文逐词对应关系（供预览面板查看）
 *
 * 行宽以盲文方（cell）计；长词超过行宽时按行宽硬拆分并记录警告。
 * 示意图 + 图注作为原子块排版，放不下时整体移到下一页。
 */

import {
  CELL_HEIGHT_MM,
  CELL_PITCH_MM,
  CELL_WIDTH_MM,
  DOT_DIAMETER_MM,
  DOT_OFFSETS,
  DOT_PITCH_MM,
  LINE_PITCH_MM,
  MIN_DOT_PITCH_MM,
} from "./geometry";
import type { ProjectDoc } from "../model/types";
import type { Translator, TranslationResult } from "../braille/translator";

export type BlockKind = "title" | "body" | "diagram" | "caption" | "pageNumber";

export interface PlacedCell {
  pageIndex: number;
  /** 网格位置（单位：方 / 行） */
  col: number;
  row: number;
  dots: number;
  /** 对应关系：来源块与原文下标 */
  block: BlockKind;
  paraIndex: number;
  srcIndex: number;
}

export interface PlacedDot {
  pageIndex: number;
  xMm: number;
  yMm: number;
  block: BlockKind;
}

export interface BoundingBox {
  pageIndex: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  kind: BlockKind;
  label: string;
}

export interface DiagramPlacement {
  pageIndex: number;
  originXMm: number;
  originYMm: number;
  cols: number;
  rows: number;
  dots: number[];
}

export interface PageLayout {
  index: number;
  cells: PlacedCell[];
  dots: PlacedDot[];
  boxes: BoundingBox[];
  diagram: DiagramPlacement | null;
}

/** 原文↔盲文对应段（按词） */
export interface CorrespondenceSegment {
  block: BlockKind;
  paraIndex: number;
  word: string;
  wordIndex: number;
  srcStart: number;
  srcEnd: number;
  cells: { dots: number; pageIndex: number; row: number; col: number }[];
}

export interface LayoutIssue {
  severity: "error" | "warning";
  message: string;
}

export interface LayoutResult {
  pages: PageLayout[];
  segments: CorrespondenceSegment[];
  issues: LayoutIssue[];
  /** 派生量，供 UI 显示 */
  linesPerPage: number;
  contentRows: number;
  maxCellsPerLine: number;
}

interface WordToken {
  word: string;
  srcStart: number;
  srcEnd: number; // 不含
  cells: { dots: number; srcIndex: number }[];
}

/** 把段落转译结果按原文空格切回词单元（数字/字母指示符归属于触发它的词） */
function tokenize(tr: TranslationResult): { words: WordToken[] } {
  const words: WordToken[] = [];
  const text = tr.text;
  const isSpace = (i: number) => /\s/.test(text[i] ?? " ");
  let cur: WordToken | null = null;
  for (const cell of tr.cells) {
    const i = cell.srcIndex;
    if (isSpace(i)) {
      cur = null; // 空格本身也是一格空白盲文，换行时天然分隔
      continue;
    }
    if (!cur || i < cur.srcStart || i >= cur.srcEnd) {
      // 找到/新建覆盖 i 的词
      let s = i;
      while (s > 0 && !isSpace(s - 1)) s--;
      let e = i;
      while (e < text.length && !isSpace(e)) e++;
      cur = { word: text.slice(s, e), srcStart: s, srcEnd: e, cells: [] };
      words.push(cur);
    }
    cur.cells.push({ dots: cell.dots, srcIndex: cell.srcIndex });
  }
  return { words };
}

/** 词 → 行（贪婪换行；超行长词硬拆分，返回警告） */
function wrapWords(
  words: WordToken[],
  cellsPerLine: number,
  warnings: LayoutIssue[],
  blockLabel: string,
): { dots: number; srcIndex: number }[][] {
  const lines: { dots: number; srcIndex: number }[][] = [];
  let cur: { dots: number; srcIndex: number }[] = [];
  const flush = () => {
    if (cur.length > 0) lines.push(cur);
    cur = [];
  };
  for (const w of words) {
    let remaining = w.cells;
    // 超行长词：硬拆分（盲文排版对超长串的处理方式），记录警告
    if (remaining.length > cellsPerLine) {
      warnings.push({
        severity: "warning",
        message: `${blockLabel}：长词 “${w.word}” 共 ${remaining.length} 方，超过行宽 ${cellsPerLine} 方，已按行宽硬拆分`,
      });
      flush();
      while (remaining.length > cellsPerLine) {
        lines.push(remaining.slice(0, cellsPerLine));
        remaining = remaining.slice(cellsPerLine);
      }
      cur = remaining;
      continue;
    }
    // 词间空一方；放不下则换行
    if (cur.length > 0 && cur.length + 1 + remaining.length > cellsPerLine) {
      flush();
      cur = remaining.slice();
    } else {
      // 词间空格：归属于词前的间隙（srcIndex 指向前一个字符），不计入任何词
      if (cur.length > 0) cur.push({ dots: 0, srcIndex: w.srcStart - 1 });
      cur = cur.concat(remaining);
    }
  }
  flush();
  return lines;
}

export function layoutDocument(doc: ProjectDoc, translator: Translator): LayoutResult {
  const issues: LayoutIssue[] = [];
  const s = doc.settings;
  const contentWidthMm = s.pageWidthMm - s.marginMm.left - s.marginMm.right;
  const contentHeightMm = s.pageHeightMm - s.marginMm.top - s.marginMm.bottom;

  const maxCellsPerLine = Math.floor((contentWidthMm - CELL_WIDTH_MM) / CELL_PITCH_MM) + 1;
  const linesPerPage = Math.floor((contentHeightMm - CELL_HEIGHT_MM) / LINE_PITCH_MM) + 1;
  const contentRows = s.showPageNumbers ? linesPerPage - 1 : linesPerPage; // 末行留给页码

  let cellsPerLine = s.cellsPerLine;
  if (cellsPerLine > maxCellsPerLine) {
    issues.push({
      severity: "error",
      message: `行宽 ${cellsPerLine} 方超出页面可容纳的 ${maxCellsPerLine} 方，已按 ${maxCellsPerLine} 方排版`,
    });
    cellsPerLine = maxCellsPerLine;
  }
  if (cellsPerLine < 4) {
    issues.push({ severity: "error", message: "行宽过小（< 4 方），无法排版" });
    cellsPerLine = Math.max(4, Math.min(maxCellsPerLine, 4));
  }

  // ---------- 转译 ----------
  const t = (text: string) => translator.translate(text, s.tableId);
  const titleTr = t(doc.title);
  const paraTexts = doc.body.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
  const paraTrs = paraTexts.map(t);
  const captionTr = t(doc.diagram.caption);

  // ---------- 行构建 ----------
  interface Line {
    cells: { dots: number; srcIndex: number }[];
    block: BlockKind;
    paraIndex: number;
    align: "left" | "center";
  }
  const blocks: { lines: Line[]; blankAfter: number }[] = [];

  if (doc.title.trim().length > 0) {
    const { words } = tokenize(titleTr);
    const lines = wrapWords(words, cellsPerLine, issues, "标题").map((cells) => ({
      cells, block: "title" as const, paraIndex: 0, align: "center" as const,
    }));
    blocks.push({ lines, blankAfter: 1 });
  }

  paraTrs.forEach((tr, pi) => {
    const { words } = tokenize(tr);
    const lines = wrapWords(words, cellsPerLine, issues, `正文第 ${pi + 1} 段`).map((cells) => ({
      cells, block: "body" as const, paraIndex: pi, align: "left" as const,
    }));
    blocks.push({ lines, blankAfter: 1 });
  });

  // 示意图块：图形行 + 图注行，原子放置
  const dg = doc.diagram;
  const diagramWidthMm = (dg.cols - 1) * DOT_PITCH_MM;
  const diagramHeightMm = (dg.rows - 1) * DOT_PITCH_MM;
  const diagramLineRows = Math.max(1, Math.ceil((diagramHeightMm + DOT_DIAMETER_MM) / LINE_PITCH_MM));
  const hasDiagram = dg.dots.some((d) => d !== 0);
  let diagramBlock: { lineRows: number; captionLines: Line[] } | null = null;
  if (hasDiagram || dg.caption.trim().length > 0) {
    if (diagramWidthMm + DOT_DIAMETER_MM > contentWidthMm + 1e-9) {
      issues.push({
        severity: "error",
        message: `触觉示意图宽 ${(diagramWidthMm + DOT_DIAMETER_MM).toFixed(1)}mm 超出版心 ${contentWidthMm.toFixed(1)}mm，无法放置`,
      });
    }
    const { words } = tokenize(captionTr);
    const captionLines = dg.caption.trim().length > 0
      ? wrapWords(words, cellsPerLine, issues, "图注").map((cells) => ({
          cells, block: "caption" as const, paraIndex: 0, align: "center" as const,
        }))
      : [];
    diagramBlock = { lineRows: hasDiagram ? diagramLineRows : 0, captionLines };
  }

  // ---------- 分页 ----------
  const pages: PageLayout[] = [];
  const segments: CorrespondenceSegment[] = [];
  let page: PageLayout = { index: 0, cells: [], dots: [], boxes: [], diagram: null };
  let row = 0;
  const newPage = () => {
    pages.push(page);
    page = { index: pages.length, cells: [], dots: [], boxes: [], diagram: null };
    row = 0;
  };

  const cellBox = (r: number, col0: number, colN: number, kind: BlockKind, label: string): BoundingBox => ({
    pageIndex: page.index,
    xMm: s.marginMm.left + col0 * CELL_PITCH_MM,
    yMm: s.marginMm.top + r * LINE_PITCH_MM,
    wMm: (colN - col0) * CELL_PITCH_MM + CELL_WIDTH_MM,
    hMm: CELL_HEIGHT_MM,
    kind,
    label,
  });

  const placeLine = (line: Line) => {
    if (row >= contentRows) newPage();
    const startCol =
      line.align === "center" ? Math.max(0, Math.floor((cellsPerLine - line.cells.length) / 2)) : 0;
    line.cells.forEach((c, i) => {
      page.cells.push({
        pageIndex: page.index,
        col: startCol + i,
        row,
        dots: c.dots,
        block: line.block,
        paraIndex: line.paraIndex,
        srcIndex: c.srcIndex,
      });
    });
    if (line.cells.length > 0) {
      page.boxes.push(
        cellBox(row, startCol, startCol + line.cells.length - 1, line.block,
          line.block === "title" ? "标题" : line.block === "caption" ? "图注" : "正文"),
      );
    }
    // 对应关系：按词聚合
    row++;
  };

  // 逐块放置
  for (const b of blocks) {
    for (const line of b.lines) placeLine(line);
    for (let i = 0; i < b.blankAfter; i++) {
      if (row >= contentRows) newPage();
      else row++;
    }
  }

  if (diagramBlock && (diagramBlock.lineRows > 0 || diagramBlock.captionLines.length > 0)) {
    const need = diagramBlock.lineRows + diagramBlock.captionLines.length;
    if (need > contentRows) {
      issues.push({
        severity: "error",
        message: `示意图+图注共需 ${need} 行，超过单页容量 ${contentRows} 行，无法放置`,
      });
    } else {
      if (row + need > contentRows) newPage(); // 原子块整体换页
      if (diagramBlock.lineRows > 0) {
        const originX = s.marginMm.left + Math.max(0, (contentWidthMm - diagramWidthMm) / 2);
        const originY = s.marginMm.top + row * LINE_PITCH_MM;
        page.diagram = {
          pageIndex: page.index,
          originXMm: originX,
          originYMm: originY,
          cols: dg.cols,
          rows: dg.rows,
          dots: dg.dots,
        };
        page.boxes.push({
          pageIndex: page.index,
          xMm: originX,
          yMm: originY,
          wMm: diagramWidthMm + DOT_DIAMETER_MM,
          hMm: diagramHeightMm + DOT_DIAMETER_MM,
          kind: "diagram",
          label: "触觉示意图",
        });
        row += diagramBlock.lineRows;
      }
      for (const cl of diagramBlock.captionLines) placeLine(cl);
    }
  }

  // ---------- 页码（独占末行，居中） ----------
  if (s.showPageNumbers) {
    const allPages = [...pages, page];
    allPages.forEach((p, idx) => {
      const tr = t(String(idx + 1));
      const n = tr.cells.length;
      const startCol = Math.max(0, Math.floor((cellsPerLine - n) / 2));
      tr.cells.forEach((c, i) => {
        p.cells.push({
          pageIndex: p.index,
          col: startCol + i,
          row: linesPerPage - 1,
          dots: c.dots,
          block: "pageNumber",
          paraIndex: -1,
          srcIndex: c.srcIndex,
        });
      });
      p.boxes.push({
        pageIndex: p.index,
        xMm: s.marginMm.left + startCol * CELL_PITCH_MM,
        yMm: s.marginMm.top + (linesPerPage - 1) * LINE_PITCH_MM,
        wMm: n * CELL_PITCH_MM + CELL_WIDTH_MM,
        hMm: CELL_HEIGHT_MM,
        kind: "pageNumber",
        label: "页码",
      });
    });
  }

  pages.push(page);

  // ---------- 生成点阵（每页所有凸点的 mm 坐标） ----------
  for (const p of pages) {
    for (const c of p.cells) {
      const baseX = s.marginMm.left + c.col * CELL_PITCH_MM;
      const baseY = s.marginMm.top + c.row * LINE_PITCH_MM;
      DOT_OFFSETS.forEach((off, bit) => {
        if (c.dots & (1 << bit)) {
          p.dots.push({ pageIndex: p.index, xMm: baseX + off.dx, yMm: baseY + off.dy, block: c.block });
        }
      });
    }
    if (p.diagram) {
      const d = p.diagram;
      for (let r = 0; r < d.rows; r++) {
        for (let col = 0; col < d.cols; col++) {
          if (d.dots[r * d.cols + col]) {
            p.dots.push({
              pageIndex: p.index,
              xMm: d.originXMm + col * DOT_PITCH_MM,
              yMm: d.originYMm + r * DOT_PITCH_MM,
              block: "diagram",
            });
          }
        }
      }
    }
    p.dots.sort((a, b) => a.yMm - b.yMm || a.xMm - b.xMm);
  }

  // ---------- 对应关系段（按词，含落点坐标） ----------
  const buildSegments = (tr: TranslationResult, block: BlockKind, paraIndex: number) => {
    const { words } = tokenize(tr);
    words.forEach((w, wi) => {
      const segCells: CorrespondenceSegment["cells"] = [];
      for (const p of pages) {
        for (const c of p.cells) {
          if (c.block === block && c.paraIndex === paraIndex && c.srcIndex >= w.srcStart && c.srcIndex < w.srcEnd) {
            segCells.push({ dots: c.dots, pageIndex: p.index, row: c.row, col: c.col });
          }
        }
      }
      segments.push({
        block, paraIndex, word: w.word, wordIndex: wi,
        srcStart: w.srcStart, srcEnd: w.srcEnd, cells: segCells,
      });
    });
  };
  if (doc.title.trim().length > 0) buildSegments(titleTr, "title", 0);
  paraTrs.forEach((tr, pi) => buildSegments(tr, "body", pi));
  if (dg.caption.trim().length > 0) buildSegments(captionTr, "caption", 0);

  // ---------- 校验：包围盒不重叠、点在页面内、点距不小于工艺参数 ----------
  issues.push(...validateLayout(pages, s.pageWidthMm, s.pageHeightMm));

  return { pages, segments, issues, linesPerPage, contentRows, maxCellsPerLine };
}

const boxesOverlap = (a: BoundingBox, b: BoundingBox): boolean =>
  a.pageIndex === b.pageIndex &&
  a.xMm < b.xMm + b.wMm - 1e-9 &&
  b.xMm < a.xMm + a.wMm - 1e-9 &&
  a.yMm < b.yMm + b.hMm - 1e-9 &&
  b.yMm < a.yMm + a.hMm - 1e-9;

export function validateLayout(pages: PageLayout[], pageW: number, pageH: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  // 1) 图形、图注、正文、页码包围盒两两不重叠
  for (const p of pages) {
    for (let i = 0; i < p.boxes.length; i++) {
      for (let j = i + 1; j < p.boxes.length; j++) {
        if (boxesOverlap(p.boxes[i], p.boxes[j])) {
          issues.push({
            severity: "error",
            message: `第 ${p.index + 1} 页：「${p.boxes[i].label}」与「${p.boxes[j].label}」版面重叠`,
          });
        }
      }
    }
  }

  // 2) 所有凸点在页面范围内
  for (const p of pages) {
    for (const d of p.dots) {
      const r = DOT_DIAMETER_MM / 2;
      if (d.xMm - r < -1e-9 || d.xMm + r > pageW + 1e-9 || d.yMm - r < -1e-9 || d.yMm + r > pageH + 1e-9) {
        issues.push({
          severity: "error",
          message: `第 ${p.index + 1} 页：凸点 (${d.xMm.toFixed(2)}, ${d.yMm.toFixed(2)})mm 超出页面`,
        });
      }
    }
  }

  // 3) 点阵最小间距 ≥ 工艺参数（空间网格法，O(n)）
  for (const p of pages) {
    const grid = new Map<string, PlacedDot[]>();
    const key = (x: number, y: number) => `${Math.floor(x / MIN_DOT_PITCH_MM)}:${Math.floor(y / MIN_DOT_PITCH_MM)}`;
    for (const d of p.dots) {
      const k = key(d.xMm, d.yMm);
      const arr = grid.get(k) ?? [];
      arr.push(d);
      grid.set(k, arr);
    }
    for (const d of p.dots) {
      const gx = Math.floor(d.xMm / MIN_DOT_PITCH_MM);
      const gy = Math.floor(d.yMm / MIN_DOT_PITCH_MM);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = grid.get(`${gx + dx}:${gy + dy}`);
          if (!arr) continue;
          for (const o of arr) {
            if (o === d) continue;
            const dist = Math.hypot(o.xMm - d.xMm, o.yMm - d.yMm);
            if (dist < MIN_DOT_PITCH_MM - 1e-9) {
              issues.push({
                severity: "error",
                message: `第 ${p.index + 1} 页：点 (${d.xMm.toFixed(2)}, ${d.yMm.toFixed(2)}) 与 (${o.xMm.toFixed(2)}, ${o.yMm.toFixed(2)}) 间距 ${dist.toFixed(3)}mm 小于最小间距 ${MIN_DOT_PITCH_MM}mm`,
              });
              return issues; // 避免刷屏，存在违例即可
            }
          }
        }
      }
    }
  }
  return issues;
}
