import { describe, it, expect, beforeAll } from 'vitest';
import { louis } from '../src/braille/translator';

beforeAll(async () => {
  await louis.init();
});

describe('liblouis wasm 转译', () => {
  it('报告 liblouis 版本', () => {
    expect(louis.version()).toMatch(/3\.33\.0/);
  });

  it('长单词在 UEB 二级表下产生缩略（单元数 < 字符数）', () => {
    const word = 'internationalization';
    const r = louis.translate('en-ueb-g2.ctb', word);
    expect(r.cells.length).toBeGreaterThan(0);
    expect(r.cells.length).toBeLessThan(word.length);
    // 二级结果应包含缩写/组字点位，而一级必须逐字符
    const g1 = louis.translate('en-ueb-g1.ctb', word);
    expect(g1.cells.length).toBe(word.length);
    expect(r.cells.length).toBeLessThan(g1.cells.length);
  });

  it('数字以 UEB 数字符 ⠼ 开始，并在数字结束后回到字母位', () => {
    const r = louis.translate('en-ueb-g2.ctb', 'Room 207 opens');
    const braille = r.cells.map((c) => c.brailleChar).join('');
    // 数字符 dots 3-4-5-6
    expect(braille).toContain('⠼');
    const numSign = r.cells.findIndex((c) => c.brailleChar === '⠼');
    // 数字符之后紧跟 b(12) j(245) g(1245) = 2 0 7
    expect([r.cells[numSign + 1].brailleChar, r.cells[numSign + 2].brailleChar, r.cells[numSign + 3].brailleChar]).toEqual([
      '⠃',
      '⠚',
      '⠛',
    ]);
    // 数字后空格 -> 之后的 o 点位为 1-3-5（索引 0,2,4），不再带数字义
    const afterSpace = r.cells.slice(numSign + 4);
    const o = afterSpace.find(
      (c) => c.dots.slice(0, 6).join(',') === 'true,false,true,false,true,false',
    );
    expect(o).toBeDefined();
  });

  it('0830 这种前导 0 的数字序列点位正确', () => {
    const r = louis.translate('en-ueb-g1.ctb', '0830');
    const s = r.cells.map((c) => c.brailleChar).join('');
    // ⠼ j h c j = 0 8 3 0
    expect(s).toBe('⠼⠚⠓⠉⠚');
  });

  it('每个盲文单元携带有效原文区间，可用于对照高亮', () => {
    const text = 'hello world';
    const r = louis.translate('en-ueb-g1.ctb', text);
    for (const c of r.cells) {
      expect(c.sourceStart).toBeGreaterThanOrEqual(0);
      expect(c.sourceEnd).toBeLessThanOrEqual(text.length);
      expect(c.sourceEnd).toBeGreaterThanOrEqual(c.sourceStart);
    }
    // 第 1 个单元对应原文第 0 个字符 h
    expect(r.cells[0].sourceStart).toBe(0);
  });

  it('Unicode 直通表原样输出盲文模式符', () => {
    const r = louis.translate('unicode-braille.utb', '⠿⠋');
    expect(r.cells.map((c) => c.brailleChar).join('')).toBe('⠿⠋');
    expect(r.cells[0].dots.every(Boolean)).toBe(true);
  });
});
