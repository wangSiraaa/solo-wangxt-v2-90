/**
 * 工艺参数（题目给定的示例工艺参数，项目固定，单位 mm）。
 *
 * 采用标准盲文凸点工艺（BANA / Library of Congress Specification 800 风格）：
 *  - 点径 1.5mm，点与点最小中心距 2.5mm（点阵最小间距）
 *  - 方（cell）内 2 列 3 行，方间距 6.0mm，行间距 10.0mm
 *
 * 所有版面计算（Canvas 预览与 PDF 导出共用）都以这里的常量为唯一来源，
 * 任何两个凸点（正文、图注、触觉示意图）的中心距不得小于 MIN_DOT_PITCH_MM。
 */

/** 凸点直径 (mm) */
export const DOT_DIAMETER_MM = 1.5;
/** 点阵最小间距：相邻凸点中心距 (mm) —— 题目给定的示例工艺参数 */
export const MIN_DOT_PITCH_MM = 2.5;
/** 一方之内相邻点的中心距 (mm)，等于最小间距 */
export const DOT_PITCH_MM = MIN_DOT_PITCH_MM;
/** 相邻方（盲文 cell）的水平中心距 (mm) */
export const CELL_PITCH_MM = 6.0;
/** 相邻盲文行的行距 (mm) */
export const LINE_PITCH_MM = 10.0;
/** 一方的高度（3 行点）(mm) */
export const CELL_HEIGHT_MM = 2 * DOT_PITCH_MM; // 5.0
/** 一方的宽度（2 列点）(mm) */
export const CELL_WIDTH_MM = DOT_PITCH_MM; // 2.5

export const MM_PER_PT = 25.4 / 72;
export const mmToPt = (mm: number): number => mm / MM_PER_PT;
export const ptToMm = (pt: number): number => pt * MM_PER_PT;

/** 6 点盲文的点位：bit0..bit5 = 点1..点6；同时兼容 8 点（bit6/7 = 点7/8） */
export interface DotOffset {
  dx: number; // 相对方原点的水平偏移 (mm)
  dy: number; // 相对方原点的垂直偏移 (mm)
}

/**
 * 标准点序：
 *  点1(0,0) 点4(2.5,0)
 *  点2(0,2.5) 点5(2.5,2.5)
 *  点3(0,5) 点6(2.5,5)
 *  点7(0,7.5) 点8(2.5,7.5)  —— 仅 8 点盲文
 */
export const DOT_OFFSETS: DotOffset[] = [
  { dx: 0, dy: 0 }, // 点1
  { dx: 0, dy: DOT_PITCH_MM }, // 点2
  { dx: 0, dy: 2 * DOT_PITCH_MM }, // 点3
  { dx: DOT_PITCH_MM, dy: 0 }, // 点4
  { dx: DOT_PITCH_MM, dy: DOT_PITCH_MM }, // 点5
  { dx: DOT_PITCH_MM, dy: 2 * DOT_PITCH_MM }, // 点6
  { dx: 0, dy: 3 * DOT_PITCH_MM }, // 点7
  { dx: DOT_PITCH_MM, dy: 3 * DOT_PITCH_MM }, // 点8
];

/** Unicode 盲文区（U+2800–U+28FF）低 8 位即点位 bitmask */
export const unicodeBrailleToDots = (ch: number): number => ch & 0xff;

/** 点位 bitmask → Unicode 盲文字符（用于对应关系面板的可读显示） */
export const dotsToUnicodeBraille = (dots: number): string =>
  String.fromCodePoint(0x2800 + (dots & 0xff));
