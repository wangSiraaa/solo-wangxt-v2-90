/** 工程数据模型（全部可序列化，保存于 IndexedDB） */

/** 固定可选的 liblouis 语言表（项目固定的指定语言表，不允许任意指定） */
export type TableId = 'en-ueb-g2.ctb' | 'en-ueb-g1.ctb' | 'unicode-braille.utb';

export interface TableOption {
  id: TableId;
  /** 表文件名，编译进 wasm MEMFS 的 /tables 下 */
  file: string;
  label: string;
  note: string;
}

export const TABLE_OPTIONS: TableOption[] = [
  {
    id: 'en-ueb-g2.ctb',
    file: 'en-ueb-g2.ctb',
    label: 'UEB 二级（英语缩略，Grade 2）',
    note: 'Unified English Braille, contracted — 长单词会使用缩略点位',
  },
  {
    id: 'en-ueb-g1.ctb',
    file: 'en-ueb-g1.ctb',
    label: 'UEB 一级（英语非缩略，Grade 1）',
    note: 'Unified English Braille, un-contracted — 逐字符点位',
  },
  {
    id: 'unicode-braille.utb',
    file: 'unicode-braille.utb',
    label: 'Unicode 盲文直通表',
    note: '输入 ⠿ 等盲文模式符时原样输出，用于校对点位',
  },
];

/** 网格化触觉示意图 */
export interface TactileDiagram {
  id: string;
  /** 网格列数 / 行数（每格默认 5mm，>= 最小点距 2.5mm） */
  cols: number;
  rows: number;
  /** 网格步距（mm），不得小于 diagramMinDotGapMm */
  pitchMm: number;
  /** 已打点的网格坐标集合，"col,row" */
  dots: string[];
  /** 触觉连线：两个网格坐标之间的线段（col,row 顺序） */
  lines: Array<[string, string]>;
  /** 图注（原文，会单独转译为盲文，强制与图同页且不重叠） */
  caption: string;
}

/** 正文块 */
export interface BodyBlock {
  id: string;
  /** 原文段落；空字符串表示空段落（占一空行） */
  text: string;
  /** 示意图块在正文中的插入位置：放在第 afterParagraph 个文字段之后 */
  afterParagraph: number;
}

export interface ProjectPage {
  id: string;
  /** 页首标题（原文，单独一行排版，转译后居中） */
  title: string;
  /** 页码字符串（原文，如 "1"；转译后放在页面最后一行居中） */
  pageNumber: string;
  /** 正文段落（按顺序，标题之后、示意图之外的文字） */
  paragraphs: string[];
  /** 本页的触觉示意图（每页最多一个，含图注） */
  diagram: TactileDiagram | null;
  /** 示意图插入在第几段文字之后（0 = 标题与第一段之间） */
  diagramAfterParagraph: number;
}

export interface Project {
  id: string;
  name: string;
  tableId: TableId;
  /** 纸张尺寸（mm，真实页面尺寸，写入 PDF MediaBox） */
  pageWidthMm: number;
  pageHeightMm: number;
  /** 页边距（mm） */
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  pages: ProjectPage[];
  updatedAt: number;
}

/** 盲文单元：一个 6/8 点单元及其与原文的对应关系 */
export interface BrailleCell {
  /** 六个（或八个）点是否凸起，索引 0..5 = 点 1..6 */
  dots: boolean[];
  /** 盲文 Unicode 字符（⠿），liblouis 直接输出 */
  brailleChar: string;
  /** 该单元对应的原文区间 [start,end)（在其所属段落原文中的下标） */
  sourceStart: number;
  sourceEnd: number;
}

export interface TranslatedLine {
  kind: 'title' | 'body' | 'caption' | 'pagenum' | 'blank';
  /** 盲文单元序列（blank 行为空） */
  cells: BrailleCell[];
  /** 该行所属原文（整段），用于原文/盲文对照 */
  sourceText: string;
  /** 该行在整篇版面中的序号 */
  lineIndex: number;
}

/** 版面中绝对位置上的一个凸点 */
export interface PlacedDot {
  xMm: number;
  yMm: number;
  /** 凸点直径（mm），盲文点与示意图点一致 */
  diameterMm: number;
  /** 来源标记，便于对照高亮与测试 */
  origin:
    | { type: 'braille'; page: number; line: number; cell: number; dot: number }
    | { type: 'diagram'; page: number; col: number; row: number };
}

/** 版面中绝对位置上的一条触觉连线（示意图网格点之间） */
export interface PlacedLine {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  widthMm: number;
  page: number;
}

/** 一行排版结果 */
export interface LaidLine {
  kind: TranslatedLine['kind'];
  cells: BrailleCell[];
  sourceText: string;
  /** 该行第一个单元第 1 点的中心坐标（mm，相对纸张左上角） */
  xMm: number;
  yMm: number;
  /** 行内单元数（含尾部空格不裁切） */
  cellCount: number;
  /** 所属逻辑行序号（同一页内） */
  lineNo: number;
  /** 原文来源：页号 / 段号 */
  sourceRef: string;
}

export interface LaidDiagram {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  diagram: TactileDiagram;
  /** 图注行 */
  captionLines: LaidLine[];
  /** 图占行高（含图注） */
  totalHeightMm: number;
}

export interface LaidPage {
  pageIndex: number;
  lines: LaidLine[];
  diagram: LaidDiagram | null;
}

export interface Layout {
  pages: LaidPage[];
  dots: PlacedDot[];
  diagramLines: PlacedLine[];
  /** 排版告警（溢出、重叠等），UI 中必须展示 */
  warnings: string[];
}

/** 每段原文转译结果 */
export interface TranslatedSegment {
  kind: TranslatedLine['kind'];
  text: string;
  cells: BrailleCell[];
}
