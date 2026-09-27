/**
 * Canvas 预览：逐点绘制版面模型（layout.pages[i].dots），
 * 与 PDF 导出共用同一份点位数据，保证预览与 PDF 点位一致。
 */

import { useEffect, useRef } from "react";
import { CELL_HEIGHT_MM, CELL_PITCH_MM, CELL_WIDTH_MM, DOT_DIAMETER_MM, LINE_PITCH_MM } from "../layout/geometry";
import type { LayoutResult } from "../layout/paginate";
import type { LayoutSettings } from "../model/types";

interface Props {
  layout: LayoutResult;
  settings: LayoutSettings;
  pageIndex: number;
  onPageChange: (i: number) => void;
  /** 高亮的对应关系段（cells 为页面网格坐标） */
  highlight: { pageIndex: number; row: number; col: number }[] | null;
}

const SCALE = 3; // px / mm

export function Preview({ layout, settings, pageIndex, onPageChange, highlight }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const page = layout.pages[Math.min(pageIndex, layout.pages.length - 1)];

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !page) return;
    const ctx = cv.getContext("2d")!;
    const w = settings.pageWidthMm * SCALE;
    const h = settings.pageHeightMm * SCALE;
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // 纸张
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#333";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    // 版心（边距）虚线
    ctx.strokeStyle = "#ccc";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
      settings.marginMm.left * SCALE,
      settings.marginMm.top * SCALE,
      (settings.pageWidthMm - settings.marginMm.left - settings.marginMm.right) * SCALE,
      (settings.pageHeightMm - settings.marginMm.top - settings.marginMm.bottom) * SCALE,
    );
    ctx.setLineDash([]);

    // 元素包围盒（防重叠校验的可视化）
    const boxColor: Record<string, string> = {
      title: "#8a2be2", body: "#1e90ff", diagram: "#2e8b57",
      caption: "#ff8c00", pageNumber: "#888",
    };
    ctx.lineWidth = 1;
    for (const b of page.boxes) {
      ctx.strokeStyle = boxColor[b.kind] ?? "#999";
      ctx.strokeRect(b.xMm * SCALE, b.yMm * SCALE, b.wMm * SCALE, b.hMm * SCALE);
    }

    // 高亮对应段
    if (highlight) {
      ctx.fillStyle = "rgba(255, 165, 0, 0.35)";
      for (const hc of highlight) {
        if (hc.pageIndex !== page.index) continue;
        ctx.fillRect(
          (settings.marginMm.left + hc.col * CELL_PITCH_MM - 1) * SCALE,
          (settings.marginMm.top + hc.row * LINE_PITCH_MM - 1) * SCALE,
          (CELL_WIDTH_MM + 2) * SCALE,
          (CELL_HEIGHT_MM + 2) * SCALE,
        );
      }
    }

    // 凸点（与 PDF 相同的点位与半径）
    ctx.fillStyle = "#000";
    const r = (DOT_DIAMETER_MM / 2) * SCALE;
    for (const d of page.dots) {
      ctx.beginPath();
      ctx.arc(d.xMm * SCALE, d.yMm * SCALE, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [page, settings, highlight]);

  if (!page) return null;
  return (
    <div className="preview">
      <div className="row">
        <button disabled={pageIndex <= 0} onClick={() => onPageChange(pageIndex - 1)}>上一页</button>
        <span>
          第 {page.index + 1} / {layout.pages.length} 页 · {page.dots.length} 点
        </span>
        <button disabled={pageIndex >= layout.pages.length - 1} onClick={() => onPageChange(pageIndex + 1)}>下一页</button>
      </div>
      <canvas ref={ref} className="page-canvas" />
    </div>
  );
}
