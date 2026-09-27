/**
 * PDF 导出（pdf-lib）。
 *
 * 页面尺寸 = 真实纸张尺寸（mm → pt），每个凸点按版面模型的 mm 坐标画实心圆，
 * 与 Canvas 预览共用同一份点位数据（layout.pages[i].dots），保证点位一致。
 * 全部在本地完成，不调用任何云服务。
 */

import { PDFDocument, rgb } from "pdf-lib";
import { DOT_DIAMETER_MM, mmToPt } from "../layout/geometry";
import type { LayoutResult } from "../layout/paginate";
import type { ProjectDoc } from "../model/types";

export async function exportPdf(layout: LayoutResult, doc: ProjectDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title || doc.name || "Braille Document");
  pdf.setCreator("Braille Studio (local, liblouis WASM + pdf-lib)");
  pdf.setProducer("braille-studio");
  pdf.setCreationDate(new Date());
  // 说明写入元数据而非附加页，保证 PDF 页数与版面页数一一对应
  pdf.setSubject(
    `Table: ${doc.settings.tableId} (pinned); cells/line: ${doc.settings.cellsPerLine}; ` +
      `Final tactile quality must be verified by proofing on the actual embosser.`,
  );

  const wPt = mmToPt(doc.settings.pageWidthMm);
  const hPt = mmToPt(doc.settings.pageHeightMm);
  const rPt = mmToPt(DOT_DIAMETER_MM / 2);

  for (const pageLayout of layout.pages) {
    const page = pdf.addPage([wPt, hPt]);
    for (const d of pageLayout.dots) {
      // PDF 坐标系原点在左下角，y 轴向上 → 翻转 y
      page.drawCircle({
        x: mmToPt(d.xMm),
        y: hPt - mmToPt(d.yMm),
        size: rPt,
        color: rgb(0, 0, 0),
      });
    }
  }

  return pdf.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
