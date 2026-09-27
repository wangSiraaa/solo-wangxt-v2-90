import type { CSSProperties } from 'react';
import type { ProjectPage, TactileDiagram } from '../types';
import { PROCESS_PARAMS } from '../braille/processParams';
import { uid } from '../braille/sampleProject';

interface Props {
  page: ProjectPage;
  onChange: (page: ProjectPage) => void;
}

const field: CSSProperties = { width: '100%', font: 'inherit', padding: '4px 6px', boxSizing: 'border-box' };
const label: CSSProperties = { display: 'block', fontSize: 12, color: '#444', margin: '8px 0 2px' };

export function PageEditor({ page, onChange }: Props): JSX.Element {
  const update = (patch: Partial<ProjectPage>): void => onChange({ ...page, ...patch });

  const updateParagraph = (i: number, text: string): void => {
    const paragraphs = page.paragraphs.slice();
    paragraphs[i] = text;
    update({ paragraphs });
  };

  const updateDiagram = (patch: Partial<TactileDiagram>): void => {
    if (!page.diagram) return;
    update({ diagram: { ...page.diagram, ...patch } });
  };

  const toggleDot = (col: number, row: number): void => {
    if (!page.diagram) return;
    const key = `${col},${row}`;
    const set = new Set(page.diagram.dots);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    updateDiagram({ dots: [...set] });
  };

  return (
    <div>
      <label style={label}>标题（原文，转译后居中）</label>
      <input style={field} value={page.title} onChange={(e) => update({ title: e.target.value })} />

      <label style={label}>页码（原文，固定最后一行居中）</label>
      <input
        style={{ ...field, width: '80px' }}
        value={page.pageNumber}
        onChange={(e) => update({ pageNumber: e.target.value })}
      />

      <label style={label}>正文段落（按盲文行宽自动折行；空段落占一空行）</label>
      {page.paragraphs.map((p, i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <textarea
            style={{ ...field, minHeight: 44, resize: 'vertical' }}
            value={p}
            onChange={(e) => updateParagraph(i, e.target.value)}
          />
          <button
            type="button"
            onClick={() =>
              update({
                paragraphs: page.paragraphs.filter((_, j) => j !== i),
                diagramAfterParagraph: Math.max(0, Math.min(page.diagramAfterParagraph, page.paragraphs.length - 1)),
              })
            }
          >
            删除此段
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update({ paragraphs: [...page.paragraphs, ''] })}
      >
        + 添加段落
      </button>

      <hr style={{ margin: '12px 0', border: 0, borderTop: '1px solid #ccc' }} />

      {!page.diagram ? (
        <button
          type="button"
          onClick={() =>
            update({
              diagram: {
                id: uid(),
                cols: 12,
                rows: 8,
                pitchMm: PROCESS_PARAMS.diagramDefaultPitchMm,
                dots: [],
                lines: [],
                caption: '',
              },
              diagramAfterParagraph: page.paragraphs.length,
            })
          }
        >
          + 添加网格化触觉示意图
        </button>
      ) : (
        <DiagramEditor
          diagram={page.diagram}
          page={page}
          onChange={(d) => update({ diagram: d })}
          onRemove={() => update({ diagram: null })}
          onReposition={(after) => update({ diagramAfterParagraph: after })}
          onToggle={toggleDot}
        />
      )}
    </div>
  );
}

function DiagramEditor({
  diagram,
  page,
  onChange,
  onRemove,
  onReposition,
  onToggle,
}: {
  diagram: TactileDiagram;
  page: ProjectPage;
  onChange: (d: TactileDiagram) => void;
  onRemove: () => void;
  onReposition: (afterParagraph: number) => void;
  onToggle: (col: number, row: number) => void;
}): JSX.Element {
  const num = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));
  const dotSet = new Set(diagram.dots);
  return (
    <div>
      <strong>触觉示意图</strong>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '6px 0', alignItems: 'flex-end' }}>
        <label>
          列 <input type="number" min={1} max={40} value={diagram.cols}
            onChange={(e) => onChange({ ...diagram, cols: num(Number(e.target.value), 1, 40) })} />
        </label>
        <label>
          行 <input type="number" min={1} max={40} value={diagram.rows}
            onChange={(e) => onChange({ ...diagram, rows: num(Number(e.target.value), 1, 40) })} />
        </label>
        <label>
          网格步距(mm) <input type="number" min={PROCESS_PARAMS.diagramMinDotGapMm} step={0.5} style={{ width: 70 }}
            value={diagram.pitchMm}
            onChange={(e) => onChange({ ...diagram, pitchMm: Math.max(PROCESS_PARAMS.diagramMinDotGapMm, Number(e.target.value)) })} />
        </label>
        <label>
          图放在第几段之后
          <select
            style={{ display: 'block' }}
            value={page.diagramAfterParagraph}
            onChange={(e) => onReposition(Number(e.target.value))}
          >
            {Array.from({ length: page.paragraphs.length + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? '标题之后、正文之前' : `第 ${i} 段之后`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={{ fontSize: 12, color: '#666', margin: '2px 0 6px' }}>
        点击网格切换凸点；最小中心距固定 {PROCESS_PARAMS.diagramMinDotGapMm}mm。
      </p>
      <div
        role="grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${diagram.cols}, 18px)`,
          gap: 0,
          width: 'max-content',
          border: '1px solid #bbb',
          padding: 4,
          background: '#fafafa',
        }}
      >
        {Array.from({ length: diagram.rows }, (_, row) =>
          Array.from({ length: diagram.cols }, (_, col) => {
            const key = `${col},${row}`;
            const on = dotSet.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-label={`网格 ${col + 1}-${row + 1} ${on ? '已打点' : '空'}`}
                onClick={() => onToggle(col, row)}
                style={{
                  width: 18,
                  height: 18,
                  border: 0,
                  padding: 4,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: on ? 10 : 8,
                    height: on ? 10 : 8,
                    borderRadius: '50%',
                    background: on ? '#1a3d7c' : '#ddd',
                    margin: '0 auto',
                  }}
                />
              </button>
            );
          }),
        )}
      </div>
      <label style={label}>图注（原文；单独转译为盲文，强制置于图下方且不与正文重叠）</label>
      <input style={field} value={diagram.caption} onChange={(e) => onChange({ ...diagram, caption: e.target.value })} />
      <p style={{ fontSize: 12, color: '#666' }}>
        触觉连线通过下方坐标对编辑（格式 <code>c1,r1;c2,r2</code>）：
      </p>
      <textarea
        style={{ ...field, minHeight: 44 }}
        value={diagram.lines.map(([a, b]) => `${a};${b}`).join('\n')}
        onChange={(e) => {
          const lines = e.target.value
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
              const [a, b] = l.split(';');
              return [a?.trim(), b?.trim()] as [string, string];
            })
            .filter(([a, b]) => /^\d+,\d+$/.test(a) && /^\d+,\d+$/.test(b));
          onChange({ ...diagram, lines });
        }}
      />
      <button type="button" onClick={onRemove}>删除示意图</button>
    </div>
  );
}
