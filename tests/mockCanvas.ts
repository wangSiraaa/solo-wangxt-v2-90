/** 记录所有几何调用的 CanvasRenderingContext2D mock，用于把预览点位还原为 mm */

export interface MockArc {
  xPx: number;
  yPx: number;
  rPx: number;
}
export interface MockSeg {
  x1Px: number;
  y1Px: number;
  x2Px: number;
  y2Px: number;
  widthPx: number;
}

export class MockCtx {
  arcs: MockArc[] = [];
  segments: MockSeg[] = [];
  canvas: { width: number; height: number };
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textBaseline = '';
  private pen: { x: number; y: number } | null = null;

  constructor(widthPx: number, heightPx: number) {
    this.canvas = { width: widthPx, height: heightPx };
  }
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  fillText(): void {}
  beginPath(): void {
    this.pen = null;
  }
  arc(x: number, y: number, r: number): void {
    this.arcs.push({ xPx: x, yPx: y, rPx: r });
  }
  moveTo(x: number, y: number): void {
    this.pen = { x, y };
  }
  lineTo(x: number, y: number): void {
    if (this.pen) this.segments.push({ x1Px: this.pen.x, y1Px: this.pen.y, x2Px: x, y2Px: y, widthPx: this.lineWidth });
    this.pen = { x, y };
  }
  fill(): void {}
  stroke(): void {}
  setLineDash(): void {}
  save(): void {}
  restore(): void {}
  scale(): void {}
}
