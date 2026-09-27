import { useEffect, useMemo, useState } from 'react';
import { useStudio } from './state/useStudio';
import { PageEditor } from './components/PageEditor';
import { PreviewCanvas } from './components/PreviewCanvas';
import { createSampleProject, createBlankProject } from './braille/sampleProject';
import { loadAllProjects } from './storage/projectStore';
import { exportPdf } from './braille/pdfExport';
import { TABLE_OPTIONS } from './types';
import type { ProjectPage } from './types';
import { mmToPt, PROCESS_PARAMS } from './braille/processParams';
import { cellsPerLine, linesPerPage } from './braille/layout';
import { uid } from './braille/sampleProject';

function blankPage(): ProjectPage {
  return { id: uid(), title: '', pageNumber: '', paragraphs: [''], diagram: null, diagramAfterParagraph: 0 };
}

export default function App(): JSX.Element {
  const [initial, setInitial] = useState(() => createSampleProject());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // 启动时恢复最近工程（纯本地 IndexedDB），完成后再挂载工作室，避免恢复值被初始值覆盖
    loadAllProjects()
      .then((list) => {
        if (list.length > 0) {
          list.sort((a, b) => b.updatedAt - a.updatedAt);
          setInitial(list[0]);
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, []);

  const { ready, engineVersion, initError, project, layout, saving, savedAt, updateProject, replaceProject } = useStudio(initial);
  const [pageIndex, setPageIndex] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [prototypeNotice, setPrototypeNotice] = useState(false);

  // 若工程页数变化，修正当前页下标
  useEffect(() => {
    if (pageIndex >= project.pages.length) setPageIndex(project.pages.length - 1);
  }, [project.pages.length, pageIndex]);

  const warnings = useMemo(() => layout?.warnings ?? [], [layout]);

  if (!hydrated) return <main style={{ padding: 24 }}>正在从本地 IndexedDB 恢复工程…</main>;

  const page = project.pages[pageIndex];

  const downloadPdf = async (): Promise<void> => {
    if (!layout) return;
    setPdfBusy(true);
    try {
      const bytes = await exportPdf(project, layout);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPrototypeNotice(true);
    } finally {
      setPdfBusy(false);
    }
  };

  if (initError) {
    return <main style={{ padding: 24, color: '#b00' }}>liblouis 初始化失败：{initError}</main>;
  }
  if (!ready || !layout || !page) return <main style={{ padding: 24 }}>正在加载本地 liblouis WebAssembly 引擎…</main>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px,440px) 1fr', gap: 0, height: '100vh' }}>
      {/* 左：编辑栏 */}
      <aside style={{ borderRight: '1px solid #ccc', overflow: 'auto', padding: 16, background: '#f7f7f4' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>无障碍出版工作室</h1>
        <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>
          本地编排 · liblouis {engineVersion}（WebAssembly）· 无云服务
        </p>
        <input
          value={project.name}
          onChange={(e) => updateProject((p) => void (p.name = e.target.value))}
          style={{ width: '100%', font: 'inherit', padding: 6, boxSizing: 'border-box' }}
        />

        <fieldset style={{ margin: '10px 0', border: '1px solid #ccc' }}>
          <legend style={{ fontSize: 12 }}>固定语言表（编译进 wasm）</legend>
          {TABLE_OPTIONS.map((t) => (
            <label key={t.id} style={{ display: 'block', fontSize: 13, margin: '3px 0' }}>
              <input
                type="radio"
                name="table"
                checked={project.tableId === t.id}
                onChange={() => updateProject((p) => void (p.tableId = t.id))}
              />{' '}
              {t.label}
            </label>
          ))}
        </fieldset>

        <fieldset style={{ margin: '10px 0', border: '1px solid #ccc', fontSize: 13 }}>
          <legend>纸张与页边距（mm，真实页面尺寸）</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <NumField label="页宽" value={project.pageWidthMm} onChange={(v) => updateProject((p) => void (p.pageWidthMm = v))} />
            <NumField label="页高" value={project.pageHeightMm} onChange={(v) => updateProject((p) => void (p.pageHeightMm = v))} />
            <NumField label="上边距" value={project.marginTopMm} onChange={(v) => updateProject((p) => void (p.marginTopMm = v))} />
            <NumField label="下边距" value={project.marginBottomMm} onChange={(v) => updateProject((p) => void (p.marginBottomMm = v))} />
            <NumField label="左边距" value={project.marginLeftMm} onChange={(v) => updateProject((p) => void (p.marginLeftMm = v))} />
            <NumField label="右边距" value={project.marginRightMm} onChange={(v) => updateProject((p) => void (p.marginRightMm = v))} />
          </div>
          <p style={{ fontSize: 12, margin: '6px 0 0', color: '#555' }}>
            版面容量：{cellsPerLine(project)} 单元/行 × {linesPerPage(project)} 行；
            页面 {mmToPt(project.pageWidthMm).toFixed(1)} × {mmToPt(project.pageHeightMm).toFixed(1)} pt（写入 PDF MediaBox）。
          </p>
        </fieldset>

        <div style={{ display: 'flex', gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0}>上一页</button>
          <span style={{ fontSize: 13, alignSelf: 'center' }}>
            第 {pageIndex + 1} / {project.pages.length} 页
          </span>
          <button
            type="button"
            onClick={() => setPageIndex((i) => Math.min(project.pages.length - 1, i + 1))}
            disabled={pageIndex === project.pages.length - 1}
          >
            下一页
          </button>
          <button
            type="button"
            onClick={() =>
              updateProject((p) => {
                const np = blankPage();
                np.pageNumber = String(p.pages.length + 1);
                p.pages.splice(pageIndex + 1, 0, np);
              })
            }
          >
            + 页
          </button>
          <button
            type="button"
            disabled={project.pages.length <= 1}
            onClick={() =>
              updateProject((p) => {
                p.pages.splice(pageIndex, 1);
              })
            }
          >
            删除本页
          </button>
        </div>

        <PageEditor
          key={page.id}
          page={page}
          onChange={(np) => updateProject((p) => void (p.pages[pageIndex] = np))}
        />

        <hr style={{ margin: '14px 0', border: 0, borderTop: '1px solid #ccc' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={downloadPdf} disabled={pdfBusy} style={{ fontWeight: 600 }}>
            {pdfBusy ? '导出中…' : '导出 PDF（真实页面尺寸）'}
          </button>
          <button type="button" onClick={() => replaceProject(createSampleProject())}>
            载入验证样稿
          </button>
          <button type="button" onClick={() => replaceProject(createBlankProject())}>
            新建空白工程
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#666' }}>
          {saving ? '正在保存到本地 IndexedDB…' : savedAt ? `已本地保存 ${new Date(savedAt).toLocaleTimeString()}` : '编辑后自动本地保存'}
          <br />
          已保存工程数：<SavedCount />
        </p>
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>工艺参数（题目给定的示例参数）</summary>
          <ul style={{ fontSize: 12, color: '#444' }}>
            <li>凸点直径 {PROCESS_PARAMS.dotDiameterMm} mm</li>
            <li>单元内横/纵最小点距 {PROCESS_PARAMS.dotHorizontalGapMm}/{PROCESS_PARAMS.dotVerticalGapMm} mm</li>
            <li>单元节距 {PROCESS_PARAMS.cellPitchMm} mm，行节距 {PROCESS_PARAMS.linePitchMm} mm</li>
            <li>示意图网格最小点距 {PROCESS_PARAMS.diagramMinDotGapMm} mm</li>
          </ul>
        </details>
      </aside>

      {/* 右：预览栏 */}
      <section style={{ overflow: 'auto', padding: 16, background: '#ecece7' }}>
        {warnings.length > 0 && (
          <div style={{ background: '#fff3cd', border: '1px solid #e0a800', padding: 8, marginBottom: 10, fontSize: 13 }}>
            <strong>版面告警（{warnings.length}）：</strong>
            <ul style={{ margin: '4px 0 0 18px' }}>
              {warnings.slice(0, 8).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <PreviewCanvas project={project} layout={layout} pageIndex={pageIndex} />

        {prototypeNotice && (
          <div style={{ marginTop: 12, padding: 10, background: '#e8f0fe', border: '1px solid #8ab4f8', fontSize: 13 }}>
            <strong>触读质量提示：</strong>
            PDF 中每个圆的圆心、直径与 Canvas 预览按同一套毫米坐标生成，点位几何一致；
            但普通打印机输出的是平面墨迹，<strong>最终凸点高度、触感区分度与耐久度仍需在实际盲文打样/制版设备上打样确认</strong>。
          </div>
        )}
      </section>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <label style={{ fontSize: 12 }}>
      {label}
      <br />
      <input
        type="number"
        step={0.1}
        value={value}
        style={{ width: '100%', boxSizing: 'border-box' }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function SavedCount(): JSX.Element {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    loadAllProjects()
      .then((l) => setN(l.length))
      .catch(() => setN(null));
  }, []);
  return <>{n ?? '—'}</>;
}
