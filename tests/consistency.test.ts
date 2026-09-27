import { describe, it, expect, beforeAll } from 'vitest';
import { louis } from '../src/braille/translator';
import { layoutProject } from '../src/braille/layout';
import { renderLayout } from '../src/braille/canvasRender';
import { exportPdf } from '../src/braille/pdfExport';
import { parsePdf } from './pdfParse';
import { MockCtx } from './mockCanvas';
import { createSampleProject } from '../src/braille/sampleProject';
import { mmToPt, PROCESS_PARAMS } from '../src/braille/processParams';

const TOL_MM = 0.02; // 预览与 PDF 点位允许的数值误差（mm）
const PAGES_GAP_MM = 8;

beforeAll(async () => {
  await louis.init();
});

function buildLayout() {
  const project = createSampleProject();
  const layout = layoutProject(project, (text) => louis.translate(project.tableId, text));
  return { project, layout };
}

describe('预览 ↔ PDF 点位一致性（长单词 / 数字切换 / 图注页）', () => {
  it('PDF MediaBox 为真实页面尺寸（Letter mm -> pt）', async () => {
    const { project } = buildLayout();
    const bytes = await exportPdf(project, layoutProject(project, (t) => louis.translate(project.tableId, t)));
    const parsed = parsePdf(bytes);
    expect(parsed.mediaBoxes).toHaveLength(3);
    for (const mb of parsed.mediaBoxes) {
      expect(mb[2]).toBeCloseTo(mmToPt(project.pageWidthMm), 5);
      expect(mb[3]).toBeCloseTo(mmToPt(project.pageHeightMm), 5);
    }
  });

  it('每一个凸点在 Canvas 与 PDF 中的坐标、直径一一对应', async () => {
    const { project, layout } = buildLayout();
    expect(layout.warnings).toEqual([]);

    // 1) Canvas 侧（pxPerMm 取非整数比例，验证换算不是"凑数"）
    const pxPerMm = 1.37;
    const heightMm = project.pages.length * project.pageHeightMm + (project.pages.length - 1) * PAGES_GAP_MM;
    const ctx = new MockCtx(project.pageWidthMm * pxPerMm, heightMm * pxPerMm);
    renderLayout(ctx as unknown as CanvasRenderingContext2D, project, layout, {
      pxPerMm,
      showLabels: true,
      showGrid: true,
    });

    // 2) PDF 侧
    const bytes = await exportPdf(project, layout);
    const parsed = parsePdf(bytes);
    expect(parsed.circles).toHaveLength(3);

    for (let page = 0; page < 3; page++) {
      const yOffsetMm = page * (project.pageHeightMm + PAGES_GAP_MM);
      // Canvas 点（mm，左上原点）
      const canvasPts = ctx.arcs
        .map((a) => ({
          x: a.xPx / pxPerMm,
          y: a.yPx / pxPerMm - yOffsetMm,
          d: (a.rPx * 2) / pxPerMm,
        }))
        .filter((p) => p.y >= -0.01 && p.y <= project.pageHeightMm + 0.01);

      // PDF 点（pt -> mm，左下原点翻回左上）
      const pdfPts = parsed.circles[page].map((c) => ({
        x: c.x / (72 / 25.4),
        y: project.pageHeightMm - c.y / (72 / 25.4),
        d: (c.r * 2) / (72 / 25.4),
      }));

      expect(canvasPts.length).toBe(pdfPts.length);

      const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
      const pdfMap = new Map(pdfPts.map((p) => [key(p.x, p.y), p]));
      for (const cp of canvasPts) {
        const match = pdfMap.get(key(cp.x, cp.y));
        expect(match, `第 ${page + 1} 页缺失点 (${cp.x.toFixed(2)},${cp.y.toFixed(2)})`).toBeDefined();
        expect(Math.abs(match!.d - cp.d)).toBeLessThan(TOL_MM);
      }

      // 与版面引擎输出的真值三方核对
      const enginePts = layout.dots
        .filter((d) => d.origin.page === page)
        .map((d) => ({ x: d.xMm, y: d.yMm, d: d.diameterMm }));
      expect(enginePts.length).toBe(pdfPts.length);
      const canvasMap = new Map(canvasPts.map((p) => [key(p.x, p.y), p]));
      for (const ep of enginePts) {
        const cp = canvasMap.get(key(ep.x, ep.y));
        expect(cp, `引擎点未出现在预览 (${ep.x},${ep.y})`).toBeDefined();
        expect(Math.abs(cp!.d - ep.d)).toBeLessThan(TOL_MM);
      }
    }
  });

  it('示意图触觉连线两端坐标在 Canvas 与 PDF 中一致', async () => {
    const { project, layout } = buildLayout();
    const pxPerMm = 1.37;
    const heightMm = project.pages.length * project.pageHeightMm + 2 * PAGES_GAP_MM;
    const ctx = new MockCtx(project.pageWidthMm * pxPerMm, heightMm * pxPerMm);
    renderLayout(ctx as unknown as CanvasRenderingContext2D, project, layout, {
      pxPerMm,
      showLabels: false,
      showGrid: false,
    });
    const bytes = await exportPdf(project, layout);
    const parsed = parsePdf(bytes);
    expect(parsed.lines.length).toBeGreaterThan(0);

    // 第 3 页（索引 2）的 3 条连线
    const pdfLines = parsed.lines[2] ?? [];
    const yOffsetMm = 2 * (project.pageHeightMm + PAGES_GAP_MM);
    const canvasLines = ctx.segments
      .map((s) => ({
        x1: s.x1Px / pxPerMm,
        y1: s.y1Px / pxPerMm - yOffsetMm,
        x2: s.x2Px / pxPerMm,
        y2: s.y2Px / pxPerMm - yOffsetMm,
      }))
      .filter((l) => l.y1 >= -0.01 && l.y1 <= project.pageHeightMm + 0.01);
    expect(canvasLines.length).toBe(3);
    expect(pdfLines.length).toBe(3);

    const k = (n: number) => Number(n / (72 / 25.4)).toFixed(3);
    const pdfSet = new Set(
      pdfLines.map((l) =>
        [
          k(l.x1),
          (project.pageHeightMm - Number(k(l.y1))).toFixed(3),
          k(l.x2),
          (project.pageHeightMm - Number(k(l.y2))).toFixed(3),
        ].join('|'),
      ),
    );
    for (const cl of canvasLines) {
      expect(pdfSet.has([cl.x1.toFixed(3), cl.y1.toFixed(3), cl.x2.toFixed(3), cl.y2.toFixed(3)].join('|'))).toBe(true);
    }
  });

  it('样稿三类页面都真实渲染出盲文点，且图注页额外含示意图点与 3 条连线', async () => {
    const { project, layout } = buildLayout();
    const bytes = await exportPdf(project, layout);
    const parsed = parsePdf(bytes);
    const counts = parsed.circles.map((c) => c.length);
    expect(counts.every((c) => c > 50)).toBe(true);
    // 每页的凸点数应与版面引擎一致
    counts.forEach((c, i) => {
      expect(c).toBe(layout.dots.filter((d) => d.origin.page === i).length);
    });
    // 第 3 页（索引 2）含示意图点：与前两页不同，它有连线
    expect(parsed.lines[2]).toHaveLength(3);
    // 图注页盲文点数中包含图注 "Figure..." 转译出的点位（通过来源类型核对）
    const diagramDotCount = layout.dots.filter(
      (d) => d.origin.type === 'diagram' && d.origin.page === 2,
    ).length;
    expect(diagramDotCount).toBeGreaterThan(10);
    void PROCESS_PARAMS;
  });
});
