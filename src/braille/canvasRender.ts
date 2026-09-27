/**
 * Canvas 预览渲染：与 PDF 导出共用同一套毫米坐标（layout.dots /
 * layout.diagramLines），仅做 mm -> 像素换算。
 *
 * 提供两种叠加视图：
 *  - dots：盲文点 + 示意图点/线（触觉层）
 *  - labels：在盲文点旁叠加原文/盲文 Unicode，便于原文↔盲文对照
 */
import { PROCESS_PARAMS } from './processParams';
import type { Layout, Project } from '../types';

export interface RenderOptions {
  /** 每毫米对应像素数（DPR 已由调用方乘入 ctx.scale） */
  pxPerMm: number;
  showLabels: boolean;
  showGrid: boolean;
  /** 仅渲染指定页（索引）；不传时渲染全部页（纵向排列，主要用于导出/调试） */
  singlePage?: number;
}

export function renderLayout(
  ctx: CanvasRenderingContext2D,
  project: Project,
  layout: Layout,
  opts: RenderOptions,
): void {
  const { pxPerMm } = opts;
  const pagesGapMm = 8;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#f5f5f0';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  project.pages.forEach((_, pageIndexAll) => {
    if (opts.singlePage !== undefined && pageIndexAll !== opts.singlePage) return;
    // 单页模式下选中页绘制在画布顶部；多页模式按序纵向排列
    const pageIndex = opts.singlePage ?? pageIndexAll;
    const oy = opts.singlePage !== undefined ? 0 : pageIndex * (project.pageHeightMm + pagesGapMm);
    const ox = 0;

    // 纸张
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.fillRect(ox * pxPerMm, oy * pxPerMm, project.pageWidthMm * pxPerMm, project.pageHeightMm * pxPerMm);
    ctx.strokeRect(ox * pxPerMm, oy * pxPerMm, project.pageWidthMm * pxPerMm, project.pageHeightMm * pxPerMm);

    // 页边距参考框
    if (opts.showGrid) {
      ctx.strokeStyle = '#d9d9d9';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        (ox + project.marginLeftMm) * pxPerMm,
        (oy + project.marginTopMm) * pxPerMm,
        (project.pageWidthMm - project.marginLeftMm - project.marginRightMm) * pxPerMm,
        (project.pageHeightMm - project.marginTopMm - project.marginBottomMm) * pxPerMm,
      );
      ctx.setLineDash([]);
    }

    // 触觉连线
    ctx.strokeStyle = '#555';
    ctx.lineWidth = Math.max(1, PROCESS_PARAMS.dotDiameterMm * pxPerMm * 0.55);
    for (const l of layout.diagramLines) {
      if (l.page !== pageIndex) continue;
      ctx.beginPath();
      ctx.moveTo((ox + l.x1Mm) * pxPerMm, (oy + l.y1Mm) * pxPerMm);
      ctx.lineTo((ox + l.x2Mm) * pxPerMm, (oy + l.y2Mm) * pxPerMm);
      ctx.stroke();
    }

    // 全部凸点（盲文点 + 示意图点同一物理直径）
    for (const dot of layout.dots) {
      if (dot.origin.page !== pageIndex) continue;
      const cx = (ox + dot.xMm) * pxPerMm;
      const cy = (oy + dot.yMm) * pxPerMm;
      const r = (dot.diameterMm / 2) * pxPerMm;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (dot.origin.type === 'diagram') {
        ctx.fillStyle = '#1a3d7c';
      } else {
        ctx.fillStyle = '#000';
      }
      ctx.fill();
    }

    if (opts.showLabels) {
      const laid = layout.pages[pageIndex];
      if (laid) {
        ctx.font = `${Math.max(8, 2.5 * pxPerMm)}px ui-monospace, monospace`;
        ctx.textBaseline = 'middle';
        for (const line of laid.lines) {
          // 只标注本行盲文单元对应的原文片段（由单元的 sourceStart/sourceEnd 求并集），
          // 避免折行时整段原文在每行重复。完整原文↔盲文对照由下方表格展示。
          let s = Infinity;
          let e = 0;
          for (const c of line.cells) {
            if (c.sourceStart < s) s = c.sourceStart;
            if (c.sourceEnd > e) e = c.sourceEnd;
          }
          const chars = Array.from(line.sourceText);
          const slice = Number.isFinite(s) && e > s ? chars.slice(s, e).join('') : '';
          const yPx = (oy + line.yMm + 6.8) * pxPerMm; // 点带（0~5mm）下方、下一盲文行（10mm）之前
          ctx.fillStyle = 'rgba(0,90,40,0.85)';
          ctx.fillText(slice, line.xMm * pxPerMm, yPx);
        }
      }
    }
  });
}

/** 画布总尺寸（像素，未含 DPR） */
export function canvasSizeMm(project: Project): { widthMm: number; heightMm: number } {
  return {
    widthMm: project.pageWidthMm,
    heightMm: project.pages.length * project.pageHeightMm + (project.pages.length - 1) * 8,
  };
}
