/**
 * 纯几何 PDF 内容流解析（仅用于测试一致性校验，不引入额外 PDF 库）。
 *
 * pdf-lib 对 3 页文档会：
 *  - 把页面树（含 /MediaBox）写入压缩对象流（ObjStm）；
 *  - 每页产出一个独立的 Flate 内容流，页面对象按创建顺序引用。
 *
 * pdf-lib 的圆由 4 条三次贝塞尔曲线构成：
 *   (cx-r, cy) m  (4 个 c)  f
 * 故圆心 = (第一条 c 的末点 x, m 点 y)，半径 = 该 x - m 点 x。
 * 线为 `x1 y1 m x2 y2 l S`。
 */
import zlib from 'node:zlib';

export interface PdfCircle {
  x: number;
  y: number;
  r: number;
}
export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}
export interface ParsedPdf {
  mediaBoxes: Array<[number, number, number, number]>;
  circles: PdfCircle[][];
  lines: PdfLine[][];
}

function inflateStreams(bytes: Uint8Array): Buffer[] {
  const s = Buffer.from(bytes);
  const out: Buffer[] = [];
  // 手动搜索 ">>\nstream\n" 锚点（不用 /g 正则循环：压缩数据内若有偶然锚点，
  // 正则会从误报点继续扫描，从而跳过其后真正的对象头）。
  let from = 0;
  for (;;) {
    const idx = s.indexOf('>>\nstream\n', from);
    const idxCrlf = s.indexOf('>>\r\nstream\r\n', from);
    let amIndex = idx;
    let amLen = '>>\nstream\n'.length;
    if (idxCrlf >= 0 && (idx < 0 || idxCrlf < idx)) {
      amIndex = idxCrlf;
      amLen = '>>\r\nstream\r\n'.length;
    }
    if (amIndex < 0) break;
    from = amIndex + amLen;

    const dictEnd = amIndex + 2;
    const head = s.lastIndexOf('obj', dictEnd);
    if (head < 0 || dictEnd - head > 2000) continue;
    const dict = s.subarray(head + 3, dictEnd).toString('latin1');
    // 真正的对象头一定以 "<< ... >>" 包裹
    if (!dict.trimStart().startsWith('<<') || !dict.includes('/FlateDecode')) continue;
    const lenMatch = /\/Length\s+(\d+)/.exec(dict);
    if (!lenMatch) continue;
    const start = amIndex + amLen;
    const len = Number(lenMatch[1]);
    // zlib 流固定以 0x78 开头，排除压缩数据内的伪锚点
    if (s[start] !== 0x78) continue;
    try {
      out.push(zlib.inflateSync(s.subarray(start, start + len)));
    } catch {
      /* 交叉引用流等非内容数据，跳过 */
    }
  }
  return out;
}

function parsePageStream(stream: string): { circles: PdfCircle[]; lines: PdfLine[] } {
  const circles: PdfCircle[] = [];
  const lines: PdfLine[] = [];
  // 以 "m"（moveto）为每个图元的起点，圆的路径内没有其它 moveto
  const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+m\s+([^]*?)(?:f|S|s|B\b)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    const x0 = Number(m[1]);
    const y0 = Number(m[2]);
    const body = m[3];
    // 收集 body 中所有数值 + 操作符
    const nums = Array.from(body.matchAll(/-?[\d.]+/g)).map((n) => Number(n[0]));
    if (/\s+l\b/.test(body) || body.trimEnd().endsWith(' l')) {
      // 线：body 内只有 x2 y2 l（可能重复一次 m）
      const lMatch = /(-?[\d.]+)\s+(-?[\d.]+)\s+l/.exec(body);
      const wMatch = /(-?[\d.]+)\s+w/.exec(stream.slice(Math.max(0, m.index - 200), m.index));
      if (lMatch) {
        lines.push({
          x1: x0,
          y1: y0,
          x2: Number(lMatch[1]),
          y2: Number(lMatch[2]),
          width: wMatch ? Number(wMatch[1]) : 0,
        });
      }
    } else if (body.includes(' c') || /\bc\b/.test(body)) {
      // 圆：第一条三次贝塞尔的最后两个数是终点 (cx, cy-r)
      const cMatch = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+c/.exec(body);
      if (cMatch) {
        const x3 = Number(cMatch[5]);
        const y3 = Number(cMatch[6]);
        circles.push({ x: x3, y: y0, r: x3 - x0 });
      }
    }
    void nums;
  }
  return { circles, lines };
}

export function parsePdf(bytes: Uint8Array): ParsedPdf {
  const inflated = inflateStreams(bytes);
  const mediaBoxes: ParsedPdf['mediaBoxes'] = [];
  const circles: PdfCircle[][] = [];
  const lines: PdfLine[][] = [];

  for (const buf of inflated) {
    const text = buf.toString('latin1');
    // 对象流中的页面 /MediaBox（pdf-lib 压缩对象流）
    const mbRe = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;
    let mm: RegExpExecArray | null;
    while ((mm = mbRe.exec(text))) {
      mediaBoxes.push([Number(mm[1]), Number(mm[2]), Number(mm[3]), Number(mm[4])]);
    }
    // 内容流：含 moveto + 贝塞尔/连线操作
    if (/\sm\b/.test(text) && (text.includes(' c') || text.includes(' l'))) {
      const parsed = parsePageStream(text);
      circles.push(parsed.circles);
      lines.push(parsed.lines);
    }
  }
  return { mediaBoxes, circles, lines };
}
