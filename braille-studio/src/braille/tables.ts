/**
 * 项目固定的指定语言表。
 *
 * 表文件来自 liblouis 官方发布版（版本见 vendor/liblouis/PINNED.md），
 * 在构建 WASM 时通过 --embed-file 直接打进 liblouis-wasm.data，
 * 运行时只访问本地文件，不加载任何云端资源。
 * 如需更换/新增语言表：修改 scripts/build-liblouis.sh 中的 PINNED_TABLES 后重新构建。
 */

export interface PinnedTable {
  id: string;
  /** 人类可读名称 */
  label: string;
  /** 入口表文件（位于 WASM 虚拟文件系统 /tables 下） */
  entryFile: string;
}

export const PINNED_TABLES: PinnedTable[] = [
  {
    id: "en-us-g1",
    label: "英语（美国）一级盲文 / English (US) Grade 1",
    entryFile: "/tables/en-us-g1.ctb",
  },
];

export const getTable = (id: string): PinnedTable => {
  const t = PINNED_TABLES.find((t) => t.id === id);
  if (!t) throw new Error(`未固定的语言表: ${id}（项目仅允许使用固定表）`);
  return t;
};
