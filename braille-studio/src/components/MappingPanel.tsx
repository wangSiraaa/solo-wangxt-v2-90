/**
 * 原文↔盲文对应关系面板：按词列出 原文 → 盲文（Unicode 盲文 + 落点页/行/列），
 * 点击条目在预览中高亮对应盲文格。
 */

import { dotsToUnicodeBraille } from "../layout/geometry";
import type { CorrespondenceSegment } from "../layout/paginate";

interface Props {
  segments: CorrespondenceSegment[];
  selected: number | null;
  onSelect: (i: number | null) => void;
}

const BLOCK_LABEL: Record<string, string> = {
  title: "标题", body: "正文", caption: "图注", diagram: "示意图", pageNumber: "页码",
};

export function MappingPanel({ segments, selected, onSelect }: Props) {
  return (
    <div className="mapping-panel">
      <h3>原文 ↔ 盲文对应</h3>
      <div className="mapping-list">
        {segments.length === 0 && <div className="hint">（暂无内容）</div>}
        {segments.map((seg, i) => (
          <button
            key={i}
            className={`mapping-item ${selected === i ? "selected" : ""}`}
            onClick={() => onSelect(selected === i ? null : i)}
            title={`源文本 [${seg.srcStart}, ${seg.srcEnd})`}
          >
            <span className="src">{seg.word}</span>
            <span className="arrow">→</span>
            <span className="brl">{seg.cells.map((c) => dotsToUnicodeBraille(c.dots)).join("")}</span>
            <span className="meta">
              {BLOCK_LABEL[seg.block]}
              {seg.cells.length > 0 &&
                ` · p${seg.cells[0].pageIndex + 1} 行${seg.cells[0].row + 1} 列${seg.cells[0].col + 1}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
