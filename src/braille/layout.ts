/**
 * 纯函数版面引擎：把工程模型 + 各段盲文转译结果排版为真实毫米坐标。
 *
 * 坐标约定：原点为纸张左上角，x 向右、y 向下；
 * 盲文"行坐标"指该行第 1 点（左上角凸点）的中心位置。
 *
 * Canvas 预览与 pdf-lib 导出共用本模块输出的 dots / diagramLines，
 * 两条链路仅做 mm -> 像素 / mm -> pt 的线性换算，因此点位天然一致。
 */
import { PROCESS_PARAMS } from './processParams';
import type {
  LaidDiagram,
  LaidLine,
  LaidPage,
  Layout,
  PlacedDot,
  PlacedLine,
  Project,
  ProjectPage,
  TranslatedSegment,
} from '../types';

const P = PROCESS_PARAMS;

/** 根据纸张尺寸与页边距计算每行可容纳的盲文单元数 */
export function cellsPerLine(project: Project): number {
  const usable = project.pageWidthMm - project.marginLeftMm - project.marginRightMm;
  return Math.max(1, Math.floor((usable + P.cellPitchMm - P.dotHorizontalGapMm) / P.cellPitchMm));
}

/** 每页可容纳的盲文行数 */
export function linesPerPage(project: Project): number {
  const usable = project.pageHeightMm - project.marginTopMm - project.marginBottomMm;
  return Math.max(1, Math.floor((usable + P.linePitchMm - P.dotVerticalGapMm) / P.linePitchMm));
}

/** 示意图本体占位（mm）：网格点中心从原点起按 pitchMm 排列 */
export function diagramSize(d: { rows: number; cols: number; pitchMm: number }): {
  widthMm: number;
  heightMm: number;
} {
  return {
    widthMm: (d.cols - 1) * d.pitchMm + P.dotDiameterMm,
    heightMm: (d.rows - 1) * d.pitchMm + P.dotDiameterMm,
  };
}

/** 一个示意图块（含图注及图-注间距）占多少盲文行（向上取整，保证不重叠） */
export function diagramLineCount(d: { rows: number; pitchMm: number }, captionBrailleLines: number): number {
  const diagramHeight = (d.rows - 1) * d.pitchMm + P.dotDiameterMm;
  const gapLines = 1; // 图与图注之间至少留一行
  const captionLines = Math.max(1, captionBrailleLines);
  const totalMm = diagramHeight + (gapLines + captionLines) * P.linePitchMm;
  return Math.ceil(totalMm / P.linePitchMm);
}

function blockWidthMm(cellCount: number): number {
  if (cellCount <= 0) return 0;
  return (cellCount - 1) * P.cellPitchMm + P.dotHorizontalGapMm + P.dotDiameterMm;
}

function centerStartX(project: Project, cellCount: number): number {
  const usable = project.pageWidthMm - project.marginLeftMm - project.marginRightMm;
  return project.marginLeftMm + Math.max(0, (usable - blockWidthMm(cellCount)) / 2);
}

/**
 * 按行宽折行。折行发生在盲文空格单元（U+2800）处，
 * 与触觉读者逐行摸读的物理换行一致。
 */
export function wrapCells(
  cells: TranslatedSegment['cells'],
  cpl: number,
): TranslatedSegment['cells'][] {
  if (cells.length === 0) return [[]];
  const lines: TranslatedSegment['cells'][] = [];
  let cur: TranslatedSegment['cells'] = [];
  for (const cell of cells) {
    if (cur.length >= cpl) {
      lines.push(cur);
      cur = [];
    }
    cur.push(cell);
  }
  lines.push(cur);
  return lines;
}

export interface TranslateFn {
  (text: string): { cells: TranslatedSegment['cells'] };
}

type FlowItem =
  | { type: 'title'; seg: TranslatedSegment }
  | { type: 'body'; seg: TranslatedSegment; paraIndex: number }
  | { type: 'blank' }
  | { type: 'diagram' };

/** 生成一页内从上到下的排版流（标题 -> 正文/图 -> 页码由外层固定最后一行） */
export function buildFlow(page: ProjectPage, translate: TranslateFn): FlowItem[] {
  const flow: FlowItem[] = [];
  if (page.title.trim()) {
    flow.push({ type: 'title', seg: { kind: 'title', text: page.title, cells: translate(page.title).cells } });
  }
  page.paragraphs.forEach((text, i) => {
    flow.push({
      type: 'body',
      seg: { kind: 'body', text, cells: translate(text).cells },
      paraIndex: i,
    });
    const last = i === page.paragraphs.length - 1;
    if (!last) flow.push({ type: 'blank' });
    if (page.diagram && page.diagramAfterParagraph === i + 1) flow.push({ type: 'diagram' });
  });
  if (page.diagram && page.diagramAfterParagraph >= page.paragraphs.length) {
    flow.push({ type: 'diagram' });
  }
  return flow;
}

function makeLaidLine(
  project: Project,
  kind: LaidLine['kind'],
  cells: LaidLine['cells'],
  sourceText: string,
  lineNo: number,
  sourceRef: string,
  centered: boolean,
): LaidLine {
  return {
    kind,
    cells,
    sourceText,
    xMm: centered ? centerStartX(project, cells.length) : project.marginLeftMm,
    yMm: project.marginTopMm + lineNo * P.linePitchMm,
    cellCount: cells.length,
    lineNo,
    sourceRef,
  };
}

export function layoutProject(project: Project, translate: TranslateFn): Layout {
  const cpl = cellsPerLine(project);
  const lpp = linesPerPage(project);
  const warnings: string[] = [];
  const dots: PlacedDot[] = [];
  const diagramLines: PlacedLine[] = [];
  const laidPages: LaidPage[] = [];

  project.pages.forEach((page, pageIndex) => {
    const laidLines: LaidLine[] = [];
    let laidDiagram: LaidDiagram | null = null;
    let lineNo = 0;

    const pageNumReserve = page.pageNumber.trim().length > 0 ? 1 : 0;
    const maxBodyLine = lpp - pageNumReserve;

    const emitWrapped = (seg: TranslatedSegment, centered: boolean, sourceRef: string): void => {
      for (const cells of wrapCells(seg.cells, cpl)) {
        if (lineNo >= maxBodyLine) {
          warnings.push(
            `第 ${pageIndex + 1} 页内容溢出：${sourceRef}（${lineNo + 1}/${lpp} 行已满），后续内容被裁切，请增大纸张或减少内容`,
          );
          return;
        }
        laidLines.push(makeLaidLine(project, seg.kind, cells, seg.text, lineNo, sourceRef, centered));
        lineNo += 1;
      }
    };

    for (const item of buildFlow(page, translate)) {
      if (item.type === 'title') {
        emitWrapped(item.seg, true, '标题');
      } else if (item.type === 'body') {
        if (item.seg.text.trim()) {
          emitWrapped(item.seg, false, `正文第 ${item.paraIndex + 1} 段`);
        } else if (lineNo < maxBodyLine) {
          lineNo += 1; // 空段落占一空行
        }
      } else if (item.type === 'blank') {
        if (lineNo < maxBodyLine) lineNo += 1;
      } else if (item.type === 'diagram') {
        const d = page.diagram!;
        if (d.pitchMm < P.diagramMinDotGapMm) {
          warnings.push(
            `第 ${pageIndex + 1} 页示意图网格间距 ${d.pitchMm}mm 小于最小点距 ${P.diagramMinDotGapMm}mm，已按 ${P.diagramMinDotGapMm}mm 处理`,
          );
        }
        const pitch = Math.max(d.pitchMm, P.diagramMinDotGapMm);
        const safeDiagram = { ...d, pitchMm: pitch };

        const captionCells = d.caption.trim() ? translate(d.caption).cells : [];
        const captionWrapped = wrapCells(captionCells, cpl);
        const captionLineCount = Math.max(1, captionWrapped.length);
        const need = diagramLineCount(safeDiagram, captionLineCount);

        if (lineNo + need > maxBodyLine) {
          warnings.push(
            `第 ${pageIndex + 1} 页示意图及图注需要 ${need} 行，当前位置仅剩 ${Math.max(0, maxBodyLine - lineNo)} 行；内容将溢出，请调整插入位置或分页`,
          );
        }

        const size = diagramSize(safeDiagram);
        const diagramX =
          project.marginLeftMm +
          Math.max(0, (project.pageWidthMm - project.marginLeftMm - project.marginRightMm - size.widthMm) / 2);
        const y = project.marginTopMm + lineNo * P.linePitchMm;

        const captionStartLine =
          lineNo + Math.ceil((size.heightMm + P.linePitchMm) / P.linePitchMm);
        const capLaid: LaidLine[] = [];
        captionWrapped.forEach((cells, ci) => {
          const no = captionStartLine + ci;
          capLaid.push(makeLaidLine(project, 'caption', cells, d.caption, no, '图注', true));
          if (no >= maxBodyLine) {
            warnings.push(`第 ${pageIndex + 1} 页图注第 ${ci + 1} 行溢出，可能与页码重叠`);
          }
        });

        laidDiagram = {
          xMm: diagramX,
          yMm: y,
          widthMm: size.widthMm,
          heightMm: size.heightMm,
          diagram: safeDiagram,
          captionLines: capLaid,
          totalHeightMm: need * P.linePitchMm,
        };
        capLaid.forEach((l) => laidLines.push(l));
        lineNo += need;
      }
    }

    if (page.pageNumber.trim()) {
      const seg: TranslatedSegment = {
        kind: 'pagenum',
        text: page.pageNumber,
        cells: translate(page.pageNumber).cells,
      };
      const cells = wrapCells(seg.cells, cpl)[0] ?? [];
      laidLines.push(makeLaidLine(project, 'pagenum', cells, page.pageNumber, lpp - 1, '页码', true));
    }

    // 非重叠校验：示意图整体矩形（含图注带）不得与普通盲文行点带相交
    if (laidDiagram) {
      const bandTop = laidDiagram.yMm - P.dotDiameterMm / 2;
      const bandBottom = laidDiagram.yMm + laidDiagram.totalHeightMm - P.dotDiameterMm / 2;
      const captionSet = new Set(laidDiagram.captionLines);
      for (const l of laidLines) {
        if (captionSet.has(l)) continue;
        const top = l.yMm - P.dotDiameterMm / 2;
        const bottom = l.yMm + 2 * P.dotVerticalGapMm + P.dotDiameterMm / 2;
        if (bottom > bandTop && top < bandBottom) {
          warnings.push(
            `第 ${pageIndex + 1} 页第 ${l.lineNo + 1} 行盲文与示意图/图注区域重叠（行 y=${l.yMm.toFixed(1)}mm）`,
          );
        }
      }
    }

    // 由版面行生成绝对凸点
    for (const line of laidLines) {
      line.cells.forEach((cell, ci) => {
        const cellX = line.xMm + ci * P.cellPitchMm;
        cell.dots.forEach((on, di) => {
          if (!on) return;
          dots.push({
            xMm: cellX + (di % 2) * P.dotHorizontalGapMm,
            yMm: line.yMm + Math.floor(di / 2) * P.dotVerticalGapMm,
            diameterMm: P.dotDiameterMm,
            origin: { type: 'braille', page: pageIndex, line: line.lineNo, cell: ci, dot: di },
          });
        });
      });
    }

    // 示意图凸点与触觉连线
    if (laidDiagram) {
      const d = laidDiagram.diagram;
      const pointAt = (key: string) => {
        const m = /^(-?\d+),(-?\d+)$/.exec(key);
        if (!m) return null;
        const col = Number(m[1]);
        const row = Number(m[2]);
        if (col < 0 || col >= d.cols || row < 0 || row >= d.rows) return 'oob' as const;
        return { xMm: laidDiagram!.xMm + col * d.pitchMm, yMm: laidDiagram!.yMm + row * d.pitchMm, col, row };
      };
      for (const key of d.dots) {
        const pt = pointAt(key);
        if (pt === 'oob') {
          warnings.push(`第 ${pageIndex + 1} 页示意图点 "${key}" 超出 ${d.cols}×${d.rows} 网格，已忽略`);
          continue;
        }
        if (!pt) {
          warnings.push(`第 ${pageIndex + 1} 页示意图含非法网格坐标 "${key}"，已忽略`);
          continue;
        }
        dots.push({
          xMm: pt.xMm,
          yMm: pt.yMm,
          diameterMm: P.dotDiameterMm,
          origin: { type: 'diagram', page: pageIndex, col: pt.col, row: pt.row },
        });
      }
      d.lines.forEach(([a, b], i) => {
        const pa = pointAt(a);
        const pb = pointAt(b);
        if (!pa || pa === 'oob' || !pb || pb === 'oob') {
          warnings.push(`第 ${pageIndex + 1} 页示意图第 ${i + 1} 条连线坐标非法或越界，已忽略`);
          return;
        }
        const dist = Math.hypot(pa.xMm - pb.xMm, pa.yMm - pb.yMm);
        if (dist < P.diagramMinDotGapMm) {
          warnings.push(
            `第 ${pageIndex + 1} 页示意图连线 ${a}->${b} 长度 ${dist.toFixed(1)}mm 小于最小点距 ${P.diagramMinDotGapMm}mm`,
          );
        }
        diagramLines.push({
          x1Mm: pa.xMm,
          y1Mm: pa.yMm,
          x2Mm: pb.xMm,
          y2Mm: pb.yMm,
          widthMm: P.dotDiameterMm,
          page: pageIndex,
        });
      });
    }

    laidPages.push({ pageIndex, lines: laidLines, diagram: laidDiagram });
  });

  return { pages: laidPages, dots, diagramLines, warnings };
}
