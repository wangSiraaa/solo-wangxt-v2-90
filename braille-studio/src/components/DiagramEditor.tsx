/**
 * 网格化触觉示意图编辑器。
 * 网格交点 = 一个凸点位置，点间距 = 工艺参数最小间距 2.5mm；点击切换凸点。
 */

import { useEffect, useRef } from "react";
import { DOT_PITCH_MM } from "../layout/geometry";
import type { DiagramSpec } from "../model/types";

interface Props {
  diagram: DiagramSpec;
  onChange: (d: DiagramSpec) => void;
}

const PX_PER_DOT = 14; // 屏幕像素/点距（仅编辑界面，与输出无关）

export function DiagramEditor({ diagram, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { cols, rows, dots } = diagram;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const w = (cols - 1) * PX_PER_DOT + 2 * PX_PER_DOT;
    const h = (rows - 1) * PX_PER_DOT + 2 * PX_PER_DOT;
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = PX_PER_DOT + c * PX_PER_DOT;
        const y = PX_PER_DOT + r * PX_PER_DOT;
        const on = dots[r * cols + c] !== 0;
        ctx.beginPath();
        ctx.arc(x, y, on ? 5 : 3, 0, Math.PI * 2);
        if (on) {
          ctx.fillStyle = "#111";
          ctx.fill();
        } else {
          ctx.strokeStyle = "#bbb";
          ctx.stroke();
        }
      }
    }
  }, [cols, rows, dots]);

  const toggle = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const c = Math.round((x - PX_PER_DOT) / PX_PER_DOT);
    const r = Math.round((y - PX_PER_DOT) / PX_PER_DOT);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    const next = dots.slice();
    next[r * cols + c] = next[r * cols + c] ? 0 : 1;
    onChange({ ...diagram, dots: next });
  };

  const resize = (newCols: number, newRows: number) => {
    const nc = Math.max(2, Math.min(64, newCols));
    const nr = Math.max(2, Math.min(48, newRows));
    const next = new Array<number>(nc * nr).fill(0);
    for (let r = 0; r < Math.min(rows, nr); r++)
      for (let c = 0; c < Math.min(cols, nc); c++) next[r * nc + c] = dots[r * cols + c];
    onChange({ ...diagram, cols: nc, rows: nr, dots: next });
  };

  const demo = () => {
    // 示例图形：边框 + 对角线（验证最小间距排列）
    const next = new Array<number>(cols * rows).fill(0);
    for (let c = 0; c < cols; c++) {
      next[c] = 1;
      next[(rows - 1) * cols + c] = 1;
    }
    for (let r = 0; r < rows; r++) {
      next[r * cols] = 1;
      next[r * cols + cols - 1] = 1;
    }
    for (let i = 0; i < Math.min(cols, rows); i++) next[i * cols + i] = 1;
    onChange({ ...diagram, dots: next });
  };

  const widthMm = ((cols - 1) * DOT_PITCH_MM).toFixed(1);
  const heightMm = ((rows - 1) * DOT_PITCH_MM).toFixed(1);

  return (
    <div className="diagram-editor">
      <div className="row">
        <label>
          列
          <input
            type="number"
            value={cols}
            min={2}
            max={64}
            onChange={(e) => resize(Number(e.target.value), rows)}
          />
        </label>
        <label>
          行
          <input
            type="number"
            value={rows}
            min={2}
            max={48}
            onChange={(e) => resize(cols, Number(e.target.value))}
          />
        </label>
        <button onClick={demo}>示例图形</button>
        <button onClick={() => onChange({ ...diagram, dots: dots.map(() => 0) })}>清空</button>
      </div>
      <div className="hint">
        {cols}×{rows} 点 · 实物 {widthMm}×{heightMm} mm · 点距 {DOT_PITCH_MM}mm（最小间距工艺参数）
      </div>
      <canvas ref={canvasRef} onClick={toggle} className="diagram-canvas" />
      <label className="caption-label">
        图注
        <input
          type="text"
          value={diagram.caption}
          placeholder="例如：Figure 1: a ramp"
          onChange={(e) => onChange({ ...diagram, caption: e.target.value })}
        />
      </label>
    </div>
  );
}
