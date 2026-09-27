/**
 * 工程文档模型：标题、正文、页码设置、一个网格化触觉示意图（含图注）、版面设置。
 * 整个对象可 JSON 序列化，直接存入 IndexedDB。
 */

export interface MarginMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutSettings {
  /** 真实页面尺寸 (mm)，默认 A4 */
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: MarginMm;
  /** 行宽：每行盲文方数（用户按盲文单元设置） */
  cellsPerLine: number;
  /** 项目固定的指定语言表 id（见 braille/tables.ts） */
  tableId: string;
  /** 是否输出页码（页码独占页面末行，避免与正文重叠） */
  showPageNumbers: boolean;
}

export interface DiagramSpec {
  /** 网格列数 / 行数（单位：点。点间距 = 工艺参数最小间距 2.5mm） */
  cols: number;
  rows: number;
  /** row-major 位图：1 = 凸点，0 = 空。长度 = cols * rows */
  dots: number[];
  /** 图注（随示意图一起排版，不与正文重叠） */
  caption: string;
}

export interface ProjectDoc {
  id: string;
  name: string;
  title: string;
  /** 正文，段落以换行分隔 */
  body: string;
  diagram: DiagramSpec;
  settings: LayoutSettings;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: LayoutSettings = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginMm: { top: 20, right: 20, bottom: 20, left: 20 },
  cellsPerLine: 28,
  tableId: "en-us-g1",
  showPageNumbers: true,
};

export const emptyDiagram = (cols = 24, rows = 16): DiagramSpec => ({
  cols,
  rows,
  dots: new Array<number>(cols * rows).fill(0),
  caption: "",
});

export const createEmptyDoc = (): ProjectDoc => ({
  id: "default",
  name: "未命名工程",
  title: "",
  body: "",
  diagram: emptyDiagram(),
  settings: { ...DEFAULT_SETTINGS, marginMm: { ...DEFAULT_SETTINGS.marginMm } },
  updatedAt: Date.now(),
});
