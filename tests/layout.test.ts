import { describe, it, expect } from 'vitest';
import { PROCESS_PARAMS } from '../src/braille/processParams';
import {
  cellsPerLine,
  linesPerPage,
  layoutProject,
  diagramSize,
} from '../src/braille/layout';
import { createSampleProject, createBlankProject } from '../src/braille/sampleProject';
import type { Project, TranslatedSegment } from '../src/types';

/** 确定性假转译：1 个字符 -> 1 个盲文单元，仅占用点 1，便于几何测试 */
function fakeTranslate(text: string): { cells: TranslatedSegment['cells'] } {
  return {
    cells: Array.from(text).map((ch, i) => ({
      dots: [true, false, false, false, false, false],
      brailleChar: ch === ' ' ? '⠀' : '⠁',
      sourceStart: i,
      sourceEnd: i + 1,
    })),
  };
}

describe('版面几何', () => {
  it('行宽按盲文单元参数计算', () => {
    const p = createBlankProject();
    const usable = p.pageWidthMm - p.marginLeftMm - p.marginRightMm;
    const expectCells = Math.floor((usable + PROCESS_PARAMS.cellPitchMm - PROCESS_PARAMS.dotHorizontalGapMm) / PROCESS_PARAMS.cellPitchMm);
    expect(cellsPerLine(p)).toBe(expectCells);
    // Letter 215.9 - 40 = 175.9mm 可用宽 => (175.9+3.5)/6 = 29
    expect(cellsPerLine(p)).toBe(29);
    expect(linesPerPage(p)).toBe(24);
  });

  it('相邻凸点的最小中心距不小于工艺参数 2.5mm', () => {
    const project = createSampleProject();
    const layout = layoutProject(project, fakeTranslate);
    const dots = layout.dots;
    let min = Infinity;
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        if (dots[i].origin.page !== dots[j].origin.page) continue;
        const d = Math.hypot(dots[i].xMm - dots[j].xMm, dots[i].yMm - dots[j].yMm);
        if (d > 0.0001 && d < min) min = d;
      }
    }
    expect(min).toBeGreaterThanOrEqual(PROCESS_PARAMS.diagramMinDotGapMm - 1e-9);
  });

  it('同一单元左右列/上下行间距严格为 2.5mm', () => {
    const project = createBlankProject();
    project.pages[0].title = '';
    project.pages[0].paragraphs = ['ab'];
    // 用带两点的假转译：a => 点1+点4（左右列），b => 点1+点2（上下行）
    const t2 = (text: string) => ({
      cells: Array.from(text).map(() => ({
        dots: [true, true, false, true, false, false],
        brailleChar: '⠫',
        sourceStart: 0,
        sourceEnd: 1,
      })),
    });
    const layout = layoutProject(project, t2);
    const pageDots = layout.dots.filter((d) => d.origin.page === 0);
    const xs = [...new Set(pageDots.map((d) => Number(d.xMm.toFixed(6))))].sort((a, b) => a - b);
    const ys = [...new Set(pageDots.map((d) => Number(d.yMm.toFixed(6))))].sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(PROCESS_PARAMS.dotHorizontalGapMm, 9);
    expect(ys[1] - ys[0]).toBeCloseTo(PROCESS_PARAMS.dotVerticalGapMm, 9);
  });

  it('图形、图注、正文在样稿第 3 页互不重叠且无告警', () => {
    const project = createSampleProject();
    const layout = layoutProject(project, fakeTranslate);
    expect(layout.warnings).toEqual([]);
    const page3 = layout.pages[2];
    expect(page3.diagram).not.toBeNull();

    const dg = page3.diagram!;
    const captionYs = new Set(dg.captionLines.map((l) => l.lineNo));
    const occupiedBands: Array<[number, number]> = [];
    for (const line of page3.lines) {
      if (captionYs.has(line.lineNo)) continue;
      occupiedBands.push([line.yMm - 0.75, line.yMm + 2 * PROCESS_PARAMS.dotVerticalGapMm + 0.75]);
    }
    const figTop = dg.yMm - 0.75;
    const figBottom = dg.yMm + dg.totalHeightMm - 0.75;
    for (const [t, b] of occupiedBands) {
      expect(b <= figTop || t >= figBottom).toBe(true);
    }
  });

  it('页码固定在最后一行且居中', () => {
    const project = createSampleProject();
    const layout = layoutProject(project, fakeTranslate);
    const lpp = linesPerPage(project);
    for (const [i, page] of layout.pages.entries()) {
      const pn = page.lines.find((l) => l.kind === 'pagenum')!;
      expect(pn.lineNo).toBe(lpp - 1);
      expect(pn.yMm).toBeCloseTo(project.marginTopMm + (lpp - 1) * PROCESS_PARAMS.linePitchMm, 9);
      // 居中：起始 x > 左边距
      expect(pn.xMm).toBeGreaterThan(project.marginLeftMm);
      void i;
    }
  });

  it('正文超长时产生溢出告警而不是静默覆盖页码', () => {
    const project = createBlankProject();
    project.pages[0].title = '';
    project.pages[0].paragraphs = ['a'.repeat(5000)];
    const layout = layoutProject(project, fakeTranslate);
    expect(layout.warnings.some((w) => w.includes('溢出'))).toBe(true);
    const pn = layout.pages[0].lines.find((l) => l.kind === 'pagenum');
    expect(pn).toBeDefined();
  });

  it('示意图尺寸由网格与步距决定，且点不超出纸张', () => {
    const project = createSampleProject();
    const d = project.pages[2].diagram!;
    const size = diagramSize(d);
    expect(size.widthMm).toBe((d.cols - 1) * d.pitchMm + PROCESS_PARAMS.dotDiameterMm);
    const layout = layoutProject(project, fakeTranslate);
    for (const dot of layout.dots) {
      expect(dot.xMm).toBeGreaterThanOrEqual(project.marginLeftMm - 1e-9);
      expect(dot.xMm + dot.diameterMm / 2).toBeLessThanOrEqual(project.pageWidthMm - project.marginRightMm + 1e-9);
    }
  });

  it('拒绝小于最小点距的网格步距（产生告警）', () => {
    const project: Project = {
      ...createBlankProject(),
      pages: [
        {
          ...createBlankProject().pages[0],
          diagram: {
            id: 'x',
            cols: 3,
            rows: 3,
            pitchMm: 1.5,
            dots: ['0,0', '1,0'],
            lines: [],
            caption: 'Fig',
          },
          diagramAfterParagraph: 1,
        },
      ],
    };
    const layout = layoutProject(project, fakeTranslate);
    expect(layout.warnings.some((w) => w.includes('最小点距'))).toBe(true);
  });
});
