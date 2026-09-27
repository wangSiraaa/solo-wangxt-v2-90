/**
 * 无障碍出版工作室 —— 本地盲文版面编排。
 * 全部计算在本地完成：liblouis WASM 转译（固定语言表）、Canvas 预览、
 * pdf-lib 导出、IndexedDB 保存；不调用任何云服务。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createEmptyDoc, type ProjectDoc } from "./model/types";
import { initTranslator, type Translator } from "./braille/translator";
import { layoutDocument, type LayoutResult } from "./layout/paginate";
import { exportPdf, downloadPdf } from "./export/pdf";
import { saveProject, loadProject, listProjects } from "./db/idb";
import { DiagramEditor } from "./components/DiagramEditor";
import { Preview } from "./components/Preview";
import { MappingPanel } from "./components/MappingPanel";
import { PINNED_TABLES } from "./braille/tables";

export default function App() {
  const [doc, setDoc] = useState<ProjectDoc>(createEmptyDoc);
  const [translator, setTranslator] = useState<Translator | null>(null);
  const [translatorError, setTranslatorError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedSeg, setSelectedSeg] = useState<number | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  const saveTimer = useRef<number | undefined>(undefined);

  // 加载本地 WASM 模块（只加载一次）
  useEffect(() => {
    initTranslator()
      .then(setTranslator)
      .catch((e) => setTranslatorError(String(e)));
  }, []);

  // 文档变化 → 重新排版（防抖）
  useEffect(() => {
    if (!translator) return;
    const t = window.setTimeout(() => {
      setLayout(layoutDocument(doc, translator));
      setPageIndex((p) => p); // 保持当前页（越界时 Preview 内部收敛）
    }, 200);
    return () => window.clearTimeout(t);
  }, [doc, translator]);

  // 自动保存到 IndexedDB（防抖；不打扰工程列表）
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveProject(doc).then(
        () => setSaveMsg(`已自动保存 ${new Date().toLocaleTimeString()}`),
        () => setSaveMsg("自动保存失败"),
      );
    }, 1200);
    return () => window.clearTimeout(saveTimer.current);
  }, [doc]);

  const refreshProjects = () => listProjects().then(setProjects).catch(() => {});
  useEffect(() => {
    refreshProjects();
  }, []);

  const newProject = () => {
    const d = createEmptyDoc();
    d.id = crypto.randomUUID();
    d.name = `未命名工程 ${new Date().toLocaleDateString()}`;
    setDoc(d);
    setSelectedSeg(null);
    setPageIndex(0);
  };

  const errors = useMemo(() => layout?.issues.filter((i) => i.severity === "error") ?? [], [layout]);
  const warnings = useMemo(() => layout?.issues.filter((i) => i.severity === "warning") ?? [], [layout]);

  const highlight = useMemo(() => {
    if (selectedSeg === null || !layout) return null;
    const seg = layout.segments[selectedSeg];
    if (!seg) return null;
    return seg.cells.map((c) => ({ pageIndex: c.pageIndex, row: c.row, col: c.col }));
  }, [selectedSeg, layout]);

  const doExport = async () => {
    if (!layout) return;
    const bytes = await exportPdf(layout, doc);
    downloadPdf(bytes, `${doc.name || "braille"}.pdf`);
  };

  const doLoad = async (id: string) => {
    const p = await loadProject(id);
    if (p) setDoc(p);
  };

  const set = (patch: Partial<ProjectDoc>) => setDoc((d) => ({ ...d, ...patch, updatedAt: Date.now() }));
  const setSettings = (patch: Partial<ProjectDoc["settings"]>) =>
    setDoc((d) => ({ ...d, settings: { ...d.settings, ...patch }, updatedAt: Date.now() }));

  return (
    <div className="app">
      <header>
        <h1>无障碍出版工作室 · 盲文版面编排</h1>
        <span className="badge">本地运行 · 无云服务</span>
        <span className="badge">
          {translator ? `liblouis ${translator.version()}（WASM）` : translatorError ? "WASM 加载失败" : "WASM 加载中…"}
        </span>
        <span className="badge">{saveMsg}</span>
      </header>

      {translatorError && <div className="error">liblouis WASM 加载失败：{translatorError}</div>}

      <div className="columns">
        <section className="editor">
          <h2>版面编辑</h2>
          <label>
            工程名
            <input value={doc.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            标题
            <input value={doc.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label>
            正文（段落以空行分隔）
            <textarea
              rows={10}
              value={doc.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="输入正文，例如含长单词与数字：supercalifragilisticexpialidocious, order 123 code A1B2 …"
            />
          </label>

          <fieldset>
            <legend>页面与行宽</legend>
            <label>
              语言表（项目固定）
              <select
                value={doc.settings.tableId}
                onChange={(e) => setSettings({ tableId: e.target.value })}
              >
                {PINNED_TABLES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
            <label>
              行宽（盲文方/行）
              <input
                type="number"
                min={4}
                max={layout?.maxCellsPerLine ?? 40}
                value={doc.settings.cellsPerLine}
                onChange={(e) => setSettings({ cellsPerLine: Number(e.target.value) })}
              />
            </label>
            {layout && (
              <div className="hint">
                本页最多 {layout.maxCellsPerLine} 方/行 · {layout.linesPerPage} 行/页
                （内容区 {layout.contentRows} 行{doc.settings.showPageNumbers ? "，末行留给页码" : ""}）
              </div>
            )}
            <label>
              页面尺寸
              <select
                value={`${doc.settings.pageWidthMm}x${doc.settings.pageHeightMm}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split("x").map(Number);
                  setSettings({ pageWidthMm: w, pageHeightMm: h });
                }}
              >
                <option value="210x297">A4（210×297mm）</option>
                <option value="297x210">A4 横向（297×210mm）</option>
                <option value="279.4x279.4">盲文纸 11×11in（279.4×279.4mm）</option>
              </select>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={doc.settings.showPageNumbers}
                onChange={(e) => setSettings({ showPageNumbers: e.target.checked })}
              />
              输出页码（独占末行）
            </label>
          </fieldset>

          <fieldset>
            <legend>触觉示意图（网格化）</legend>
            <DiagramEditor
              diagram={doc.diagram}
              onChange={(diagram) => set({ diagram })}
            />
          </fieldset>

          <div className="row">
            <button onClick={doExport} disabled={!layout || errors.length > 0}>
              导出 PDF（真实页面尺寸）
            </button>
            <button onClick={() => saveProject(doc).then(refreshProjects)}>保存工程</button>
            <button onClick={newProject}>新建工程</button>
            <select onChange={(e) => e.target.value && doLoad(e.target.value)} value="">
              <option value="">载入工程…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{new Date(p.updatedAt).toLocaleString()}）
                </option>
              ))}
            </select>
          </div>

          {errors.length > 0 && (
            <div className="error">
              <b>版面错误（阻止导出）：</b>
              <ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="warning">
              <b>警告：</b>
              <ul>{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}
          <p className="hint">
            提示：点位、行距采用题目给定的示例工艺参数（点距 2.5mm / 方距 6.0mm / 行距 10.0mm / 点径 1.5mm）。
            最终触读质量仍需在实际设备上打样确认。
          </p>
        </section>

        <section className="preview-col">
          {layout && (
            <>
              <Preview
                layout={layout}
                settings={doc.settings}
                pageIndex={pageIndex}
                onPageChange={setPageIndex}
                highlight={highlight}
              />
              <MappingPanel
                segments={layout.segments}
                selected={selectedSeg}
                onSelect={setSelectedSeg}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
