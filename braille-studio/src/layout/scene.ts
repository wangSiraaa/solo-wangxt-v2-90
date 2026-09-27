/**
 * 预览场景构建：把版面模型转换为与设备无关的绘制指令。
 * Canvas 组件逐条绘制这些指令；一致性测试用它核对“预览点位 === 模型点位”。
 */

import { DOT_DIAMETER_MM } from "./geometry";
import type { LayoutResult } from "./paginate";
import type { LayoutSettings } from "../model/types";

export interface SceneDot {
  xMm: number;
  yMm: number;
  rMm: number;
  block: string;
}

export interface PageScene {
  pageIndex: number;
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: LayoutSettings["marginMm"];
  dots: SceneDot[];
  boxes: { xMm: number; yMm: number; wMm: number; hMm: number; kind: string; label: string }[];
}

/** 预览与 PDF 共用同一份点位：直接取 layout.pages[i].dots */
export function buildPageScene(layout: LayoutResult, pageIndex: number, settings: LayoutSettings): PageScene {
  const page = layout.pages[pageIndex];
  if (!page) throw new Error(`页码越界: ${pageIndex}`);
  return {
    pageIndex,
    pageWidthMm: settings.pageWidthMm,
    pageHeightMm: settings.pageHeightMm,
    marginMm: settings.marginMm,
    dots: page.dots.map((d) => ({
      xMm: d.xMm,
      yMm: d.yMm,
      rMm: DOT_DIAMETER_MM / 2,
      block: d.block,
    })),
    boxes: page.boxes.map((b) => ({
      xMm: b.xMm, yMm: b.yMm, wMm: b.wMm, hMm: b.hMm, kind: b.kind, label: b.label,
    })),
  };
}
