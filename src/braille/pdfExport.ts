/**
 * pdf-lib 导出：把版面引擎输出的真实毫米坐标转换为 PDF 点（pt），
 * 写入与纸张一致的 MediaBox，并在每个凸点位置绘制实心圆。
 *
 * 注意：普通 PDF 阅读器/打印机只能看到"点的平面图"。
 * 触觉凸点需要具备凸点压印能力的盲文打样/制版设备；
 * 本导出保证的是点位几何坐标的一致性，而非触感本身。
 */
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { mmToPt } from './processParams';
import type { Layout, Project } from '../types';

const INK = rgb(0, 0, 0);
const LINE_GRAY = rgb(0.35, 0.35, 0.35);

function drawDot(page: PDFPage, xMm: number, yMm: number, diameterMm: number, pageHeightMm: number): void {
  const r = mmToPt(diameterMm / 2);
  // PDF 坐标原点在左下角，需要翻转 y
  const cx = mmToPt(xMm);
  const cy = mmToPt(pageHeightMm - yMm);
  page.drawCircle({ x: cx, y: cy, size: r, color: INK });
}

export async function exportPdf(project: Project, layout: Layout): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(project.name);
  doc.setCreator('Tactile Publishing Studio');
  doc.setSubject('Braille transcription preview (geometric dot positions)');

  const widthPt = mmToPt(project.pageWidthMm);
  const heightPt = mmToPt(project.pageHeightMm);

  project.pages.forEach((_p, pageIndex) => {
    const page = doc.addPage([widthPt, heightPt]);
    const dots = layout.dots.filter((d) => d.origin.page === pageIndex);
    for (const dot of dots) drawDot(page, dot.xMm, dot.yMm, dot.diameterMm, project.pageHeightMm);

    // 触觉连线（示意图）：以较细实线连接网格点
    const lines = layout.diagramLines.filter((l) => l.page === pageIndex);
    for (const l of lines) {
      page.drawLine({
        start: { x: mmToPt(l.x1Mm), y: mmToPt(project.pageHeightMm - l.y1Mm) },
        end: { x: mmToPt(l.x2Mm), y: mmToPt(project.pageHeightMm - l.y2Mm) },
        thickness: mmToPt(l.widthMm),
        color: LINE_GRAY,
      });
    }
  });

  return doc.save();
}
