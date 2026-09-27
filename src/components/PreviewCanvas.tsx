import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layout, Project } from '../types';
import { renderLayout } from '../braille/canvasRender';
import { PROCESS_PARAMS } from '../braille/processParams';

interface Props {
  project: Project;
  layout: Layout;
  pageIndex: number;
}

export function PreviewCanvas({ project, layout, pageIndex }: Props): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [selectedCell, setSelectedCell] = useState<{ line: number; cell: number } | null>(null);

  // 预览缩放：让纸张宽度适配容器，但渲染时按物理 mm 精确换算
  const pxPerMm = 2.4;
  const size = useMemo(
    () => ({ widthMm: project.pageWidthMm, heightMm: project.pageHeightMm }),
    [project.pageWidthMm, project.pageHeightMm],
  );
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = size.widthMm * pxPerMm * dpr;
    canvas.height = size.heightMm * pxPerMm * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderLayout(ctx, project, layout, { pxPerMm, showLabels, showGrid, singlePage: pageIndex });
  }, [project, layout, showLabels, showGrid, size, dpr, pageIndex]);

  const page = layout.pages[pageIndex];

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <canvas
          ref={ref}
          style={{
            width: size.widthMm * pxPerMm,
            height: size.heightMm * pxPerMm,
            boxShadow: '0 1px 6px rgba(0,0,0,.25)',
          }}
        />
      </div>
      <label style={{ fontSize: 13, marginRight: 12 }}>
        <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> 页边距参考
      </label>
      <label style={{ fontSize: 13 }}>
        <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> 原文 / 盲文对照标记
      </label>

      {page && (
        <div style={{ marginTop: 10 }}>
          <h4 style={{ margin: '8px 0 4px' }}>原文 ↔ 盲文逐行对照（点击高亮）</h4>
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #ddd', fontSize: 13 }}>
            {page.lines.map((line, li) => (
              <button
                key={li}
                type="button"
                onClick={() =>
                  setSelectedCell((cur) =>
                    cur && cur.line === line.lineNo ? null : { line: line.lineNo, cell: 0 },
                  )
                }
                style={{
                  display: 'grid',
                  gridTemplateColumns: '54px 1fr 1fr',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 8px',
                  border: 0,
                  borderBottom: '1px solid #eee',
                  background: selectedCell?.line === line.lineNo ? '#fff8d8' : 'transparent',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <span style={{ color: '#888' }}>
                  {kindLabel(line.kind)} 第{line.lineNo + 1}行
                </span>
                <span lang="en" style={{ color: '#073', wordBreak: 'break-all' }}>
                  {line.sourceText || <em style={{ color: '#aaa' }}>（空行）</em>}
                </span>
                <span style={{ color: '#b00', fontFamily: 'monospace', fontSize: 15, letterSpacing: 2 }}>
                  {line.cells.map((c) => c.brailleChar).join('')}
                </span>
              </button>
            ))}
          </div>
          {selectedCell && (
            <CellDetail layout={layout} pageIndex={pageIndex} line={selectedCell.line} />
          )}
        </div>
      )}
    </div>
  );
}

function kindLabel(k: string): string {
  return k === 'title' ? '标题' : k === 'body' ? '正文' : k === 'caption' ? '图注' : k === 'pagenum' ? '页码' : '空行';
}

function CellDetail({
  layout,
  pageIndex,
  line,
}: {
  layout: Layout;
  pageIndex: number;
  line: number;
}): JSX.Element | null {
  const laid = layout.pages[pageIndex]?.lines.find((l) => l.lineNo === line);
  if (!laid) return null;
  return (
    <div style={{ fontSize: 12, color: '#444', marginTop: 4 }}>
      该行起始点物理坐标（纸张左上角，mm）：x={laid.xMm.toFixed(2)}，y={laid.yMm.toFixed(2)}；
      单元横向节距 {PROCESS_PARAMS.cellPitchMm}mm，行节距 {PROCESS_PARAMS.linePitchMm}mm。
    </div>
  );
}
