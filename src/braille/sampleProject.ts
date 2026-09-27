/** 新建工程与内置验证样稿 */
import type { Project, TactileDiagram } from '../types';
import { PROCESS_PARAMS } from './processParams';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * 验证样稿：
 *  - 第 1 页：长单词（触发 UEB 二级缩略点位）
 *  - 第 2 页：数字切换（UEB 数字符 ⠼ + 降回字母位）
 *  - 第 3 页：带图注的网格化触觉示意图（图形、图注、正文不重叠）
 */
export function createSampleProject(): Project {
  const diagram: TactileDiagram = {
    id: uid(),
    cols: 14,
    rows: 9,
    pitchMm: PROCESS_PARAMS.diagramDefaultPitchMm,
    // 一个简单的"房间路线"L 形 + 起点/终点标记
    dots: [
      '1,1', '2,1', '3,1', '4,1', '5,1',
      '5,2', '5,3', '5,4',
      '5,5', '6,5', '7,5', '8,5', '9,5',
      '1,7', '12,1',
    ],
    lines: [
      ['1,1', '5,1'],
      ['5,1', '5,5'],
      ['5,5', '9,5'],
    ],
    caption: 'Figure 1. Route to Room 207 in 2026.',
  };

  return {
    id: uid(),
    name: '验证样稿：长单词 / 数字 / 图注',
    tableId: 'en-ueb-g2.ctb',
    // US Letter（真实页面尺寸，写入 PDF MediaBox）
    pageWidthMm: 215.9,
    pageHeightMm: 279.4,
    marginTopMm: 20,
    marginBottomMm: 20,
    marginLeftMm: 20,
    marginRightMm: 20,
    pages: [
      {
        id: uid(),
        title: 'Long Word Contractions',
        pageNumber: '1',
        paragraphs: [
          'Uncontracted braille spells every letter. Contracted braille uses short forms.',
          'The internationalization team uncharacteristically acknowledged the straightforward accessibility requirement before demonstration.',
          'Compare the dot patterns cell by cell with the uncontracted table.',
        ],
        diagram: null,
        diagramAfterParagraph: 0,
      },
      {
        id: uid(),
        title: 'Number Signs',
        pageNumber: '2',
        paragraphs: [
          'In UEB a number sign precedes digits. Readers then return to letters automatically.',
          'Room 207 opens at 0830 and closes at 1745. Call extension 31415 or send 2 messages.',
          'Read 3 apples, 12 books, and 2026 pages without losing the letter context.',
        ],
        diagram: null,
        diagramAfterParagraph: 0,
      },
      {
        id: uid(),
        title: 'Tactile Diagram',
        pageNumber: '3',
        paragraphs: [
          'Follow the raised line from the start dot to the end dot. The route turns once, and the caption is brailled below the figure without overlap.',
        ],
        diagram,
        diagramAfterParagraph: 1,
      },
    ],
    updatedAt: Date.now(),
  };
}

export function createBlankProject(): Project {
  return {
    id: uid(),
    name: '未命名工程',
    tableId: 'en-ueb-g2.ctb',
    pageWidthMm: 215.9,
    pageHeightMm: 279.4,
    marginTopMm: 20,
    marginBottomMm: 20,
    marginLeftMm: 20,
    marginRightMm: 20,
    pages: [
      {
        id: uid(),
        title: '',
        pageNumber: '1',
        paragraphs: [''],
        diagram: null,
        diagramAfterParagraph: 0,
      },
    ],
    updatedAt: Date.now(),
  };
}
