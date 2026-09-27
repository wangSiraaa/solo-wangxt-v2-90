/**
 * 工艺参数（题目给定的示例工艺参数，来源：BANA / Library of Congress
 * 盲文制版规范中最常用的一组标称尺寸，单位均为毫米 mm）。
 *
 * 这些常量同时用于 Canvas 预览与 pdf-lib 导出，保证两条渲染链路
 * 计算出来的凸点坐标完全一致。
 */
export const PROCESS_PARAMS = {
  /** 凸点直径（embossed dot base diameter） */
  dotDiameterMm: 1.5,
  /** 同一盲文单元内 1-2 列之间的最小水平中心距 */
  dotHorizontalGapMm: 2.5,
  /** 同一盲文单元内相邻点行之间的最小垂直中心距 */
  dotVerticalGapMm: 2.5,
  /** 相邻盲文单元对应凸点间的水平中心距（cell pitch） */
  cellPitchMm: 6,
  /** 相邻盲文行对应凸点间的垂直中心距（line pitch） */
  linePitchMm: 10,
  /** 触觉示意图网格点之间允许的最小中心距 */
  diagramMinDotGapMm: 2.5,
  /** 触觉示意图默认网格间距（>= 最小中心距） */
  diagramDefaultPitchMm: 5,
  /** 盲文单元顶部留白：点 1 中心到单元名义左上角的距离 */
  cellTopPaddingMm: 0,
} as const;

export const MM_PER_PT = 25.4 / 72; // 1 pt = 0.352777… mm
export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}
