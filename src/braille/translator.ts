/**
 * liblouis WebAssembly 封装：加载固定语言表并把原文转译为 Unicode 盲文，
 * 同时保留每个盲文单元与原文字符之间的对应关系（inputPos / outputPos）。
 *
 * 表文件在编译期通过 emscripten --embed-file 打包进 MEMFS /tables，
 * 运行时仅访问内存文件系统，无任何网络/云调用。
 */
import type { BrailleCell, TableId } from '../types';
import { TABLE_OPTIONS } from '../types';
import type { LouModule } from '../wasm/liblouis.d.mts';
import createLou from '../wasm/liblouis.mjs';

export interface TranslateResult {
  cells: BrailleCell[];
  brailleText: string;
}

class LouisEngine {
  private module: LouModule | null = null;
  private loadedTables = new Set<TableId>();

  async init(): Promise<void> {
    if (this.module) return;
    const mod = await (createLou as unknown as () => Promise<LouModule>)();
    // 表搜索路径 /tables 由编译期 TABLESDIR 宏写死（见 wasm/build.sh），无需运行期设置。
    this.module = mod;
  }

  version(): string {
    if (!this.module) return 'not-loaded';
    const ptr = this.module._louweb_version();
    return ptr ? this.module.UTF8ToString(ptr) : 'unknown';
  }

  private ensureTable(tableId: TableId): void {
    const mod = this.module;
    if (!mod) throw new Error('liblouis 未初始化');
    if (this.loadedTables.has(tableId)) return;
    const file = TABLE_OPTIONS.find((t) => t.id === tableId)?.file;
    if (!file) throw new Error(`未知语言表: ${tableId}`);
    // unicode.dis 必须位于表列表首位，liblouis 才会把点位输出为
    // U+28xx Unicode 盲文模式符（见 unicode.dis 文件头说明）。
    // unicode-braille.utb 自身直通盲文模式符，不需要前缀。
    const list = file === 'unicode-braille.utb' ? file : `unicode.dis,${file}`;
    const pathPtr = mod.allocateUTF8(list);
    const ok = mod._louweb_check_table(pathPtr);
    mod._free(pathPtr);
    if (!ok) throw new Error(`语言表加载失败（未编译进 wasm）: ${file}`);
    this.loadedTables.add(tableId);
  }

  /**
   * 转译一段原文。liblouis 返回：
   *  - inputPos[i]  = 第 i 个盲文单元对应到的原文下标
   *  - outputPos[j] = 第 j 个原文字符对应到的盲文单元下标
   */
  translate(tableId: TableId, text: string): TranslateResult {
    const mod = this.module;
    if (!mod) throw new Error('liblouis 未初始化');
    this.ensureTable(tableId);
    const file = TABLE_OPTIONS.find((t) => t.id === tableId)!.file;
    const tableList = file === 'unicode-braille.utb' ? file : `unicode.dis,${file}`;

    // 以 UTF-16 码元为单位（liblouis widechar = unsigned short）
    const inUnits = Array.from(text).length;
    if (inUnits === 0) return { cells: [], brailleText: '' };

    const outCap = inUnits * 2 + 16;
    const tablePtr = mod.allocateUTF8(tableList);
    const inBytes = (inUnits + 1) * 2;
    const outBytes = (outCap + 1) * 2;
    const inPtr = mod._malloc(inBytes);
    const outPtr = mod._malloc(outBytes);
    const inputPosPtr = mod._malloc(outCap * 4);
    const outputPosPtr = mod._malloc((inUnits + 1) * 4);
    try {
      mod.stringToUTF16(text, inPtr, inBytes);
      mod.HEAP32.fill(-1, inputPosPtr >> 2, (inputPosPtr >> 2) + outCap);
      const ret = mod._louweb_translate(
        tablePtr,
        inPtr,
        inUnits,
        outPtr,
        outCap,
        inputPosPtr,
        outputPosPtr,
      );
      if (ret < 0) throw new Error(`liblouis 转译失败: ${JSON.stringify(text.slice(0, 40))}`);
      const cellCount = ret;

      const chars = Array.from(text);
      // 每个原文码元对应的盲文单元
      const outputPos: number[] = [];
      for (let j = 0; j < inUnits; j++) {
        outputPos.push(mod.HEAP32[(outputPosPtr >> 2) + j]);
      }
      const cells: BrailleCell[] = [];
      for (let i = 0; i < cellCount; i++) {
        const codeUnit = mod.HEAPU16[(outPtr >> 1) + i];
        const brailleChar = String.fromCharCode(codeUnit);
        // Unicode 盲文模式符 U+2800..U+28FF，低 8 位即 8 点位图
        const pattern = codeUnit - 0x2800;
        const dots: boolean[] = [];
        for (let d = 0; d < 6; d++) dots.push(((pattern >> d) & 1) === 1);
        const sourceStart = mod.HEAP32[(inputPosPtr >> 2) + i];
        let sourceEnd = sourceStart + 1;
        if (i + 1 < cellCount) {
          const nextStart = mod.HEAP32[(inputPosPtr >> 2) + i + 1];
          if (nextStart >= sourceStart) sourceEnd = Math.max(sourceEnd, nextStart);
        } else {
          sourceEnd = inUnits;
        }
        // 空格单元（U+2800）通常由 outputPos 中的原文空格产生；
        // 若位置映射无效，则退化为空区间，避免错位高亮。
        const safeStart = sourceStart >= 0 && sourceStart < inUnits ? sourceStart : 0;
        const safeEnd = sourceEnd > safeStart && sourceEnd <= inUnits ? sourceEnd : safeStart;
        cells.push({
          dots,
          brailleChar,
          sourceStart: Math.min(safeStart, chars.length),
          sourceEnd: Math.min(safeEnd, chars.length),
        });
      }
      return { cells, brailleText: cells.map((c) => c.brailleChar).join('') };
    } finally {
      mod._free(tablePtr);
      mod._free(inPtr);
      mod._free(outPtr);
      mod._free(inputPosPtr);
      mod._free(outputPosPtr);
    }
  }
}

export const louis = new LouisEngine();
