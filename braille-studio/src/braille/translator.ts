/**
 * liblouis WebAssembly 封装。
 *
 * 加载项目内固定的 WASM 构建（public/vendor/liblouis/，由 scripts/build-liblouis.sh
 * 从 liblouis 官方源码用 Emscripten 构建），使用项目固定的指定语言表转译。
 * 通过 lou_translate 的 inputPos/outputPos 数组获得 原文↔盲文 的逐格对应关系。
 * 浏览器与 Node（测试）共用同一加载逻辑，不访问任何云服务。
 */

import { getTable } from "./tables";
import { unicodeBrailleToDots } from "../layout/geometry";

/** Emscripten 模块的最小类型描述（只声明用到的导出） */
export interface LiblouisModule {
  _lou_translate(
    tableList: number, inbuf: number, inlen: number, outbuf: number, outlen: number,
    typeform: number, spacing: number, outputPos: number, inputPos: number,
    cursorPos: number, mode: number,
  ): number;
  _lou_charToDots(tableList: number, inbuf: number, outbuf: number, length: number, mode: number): number;
  _lou_version(): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  UTF8ToString(ptr: number): string;
  UTF16ToString(ptr: number): string;
  stringToUTF16(str: string, outPtr: number, maxBytes: number): void;
  stringToUTF8(str: string, outPtr: number, maxBytes: number): void;
  lengthBytesUTF8(str: string): number;
  getValue(ptr: number, type: "i8" | "i16" | "i32" | "i64" | "float" | "double" | "*"): number;
  setValue(ptr: number, value: number, type: "i8" | "i16" | "i32" | "i64" | "float" | "double" | "*"): void;
}

type ModuleFactory = (opts?: { locateFile?: (f: string) => string }) => Promise<LiblouisModule>;

/** 单个输出格：点位 bitmask + 对应的原文字符下标 */
export interface TranslatedCell {
  dots: number;
  /** 该格对应的原文字符位置（lou_translate outputPos） */
  srcIndex: number;
}

export interface TranslationResult {
  /** 原文 */
  text: string;
  /** 逐格盲文（含空格格，dots=0） */
  cells: TranslatedCell[];
}

export interface Translator {
  version(): string;
  translate(text: string, tableId: string): TranslationResult;
}

let modulePromise: Promise<LiblouisModule> | null = null;

/**
 * 加载 WASM 模块（单例）。
 * @param baseUrl 模块文件所在目录的 URL/路径；浏览器默认 "/vendor/liblouis/"，
 *                测试（Node）传入绝对路径或 file:// URL。
 */
export function loadLiblouisModule(baseUrl = "/vendor/liblouis/"): Promise<LiblouisModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const glueUrl = baseUrl.replace(/\/?$/, "/") + "liblouis-wasm.mjs";
      const factory = (await import(/* @vite-ignore */ glueUrl)).default as ModuleFactory;
      return factory({ locateFile: (f) => baseUrl.replace(/\/?$/, "/") + f });
    })();
  }
  return modulePromise;
}

export async function initTranslator(baseUrl?: string): Promise<Translator> {
  const mod = await loadLiblouisModule(baseUrl);

  // lou_version 返回 char*（UTF-8），不是 widechar
  const version = () => mod.UTF8ToString(mod._lou_version());

  const allocUtf8 = (s: string): number => {
    const ptr = mod._malloc(mod.lengthBytesUTF8(s) + 1);
    mod.stringToUTF8(s, ptr, mod.lengthBytesUTF8(s) + 1);
    return ptr;
  };

  const rd16 = (p: number) => mod.getValue(p, "i16") & 0xffff;
  const rd32 = (p: number) => mod.getValue(p, "i32");
  const wr16 = (p: number, v: number) => mod.setValue(p, v & 0xffff, "i16");
  const wr32 = (p: number, v: number) => mod.setValue(p, v, "i32");

  /** 把一段已转译的显示字符批量转换为点位 bitmask（lou_charToDots） */
  const charsToDots = (tablePtr: number, chars: number[]): number[] => {
    const n = chars.length;
    const inbuf = mod._malloc(n * 2 + 2);
    const outbuf = mod._malloc(n * 2 + 2);
    try {
      for (let i = 0; i < n; i++) wr16(inbuf + i * 2, chars[i]);
      const ok = mod._lou_charToDots(tablePtr, inbuf, outbuf, n, 0);
      if (!ok) throw new Error("lou_charToDots 失败");
      const dots: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = rd16(outbuf + i * 2);
        // 兼容两种返回形式：U+28xx 盲文区 或 裸点位值
        dots.push(v >= 0x2800 && v <= 0x28ff ? unicodeBrailleToDots(v) : v & 0xff);
      }
      return dots;
    } finally {
      mod._free(inbuf);
      mod._free(outbuf);
    }
  };

  const translate = (text: string, tableId: string): TranslationResult => {
    const table = getTable(tableId);
    if (text.length === 0) return { text, cells: [] };

    const tablePtr = allocUtf8(table.entryFile);
    const inlen = text.length; // UTF-16 码元数 = widechar 数（--disable-ucs4 构建）
    const outcap = inlen * 4 + 64;

    const inbuf = mod._malloc(inlen * 2 + 2);
    const outbuf = mod._malloc(outcap * 2);
    const inlenPtr = mod._malloc(4);
    const outlenPtr = mod._malloc(4);
    // 注意 liblouis 的数组尺寸语义（见 lou_translateString.c）：
    //   inputPos[k]  = 第 k 个输出格对应的输入位置 → 按输出长度 outcap 分配
    //   outputPos[j] = 第 j 个输入字符对应的输出位置 → 按输入长度 inlen 分配
    const inputPosPtr = mod._malloc(outcap * 4);
    const outputPosPtr = mod._malloc(inlen * 4);
    const cursorPosPtr = mod._malloc(4);

    try {
      mod.stringToUTF16(text, inbuf, inlen * 2 + 2);
      wr32(inlenPtr, inlen);
      wr32(outlenPtr, outcap);
      wr32(cursorPosPtr, -1);

      const ok = mod._lou_translate(
        tablePtr, inbuf, inlenPtr, outbuf, outlenPtr,
        0, 0, outputPosPtr, inputPosPtr, cursorPosPtr, 0,
      );
      if (!ok) throw new Error(`liblouis 转译失败（表 ${table.entryFile}）`);

      const outlen = rd32(outlenPtr);
      const chars: number[] = [];
      const srcIdx: number[] = [];
      for (let i = 0; i < outlen; i++) {
        chars.push(rd16(outbuf + i * 2));
        srcIdx.push(rd32(inputPosPtr + i * 4)); // 第 i 格 ↔ 原文 inputPos[i]
      }

      // 显示字符 → 点位。Unicode 盲文区可直接取低 8 位，其余走 lou_charToDots。
      let dotsArr: number[];
      if (chars.every((c) => c >= 0x2800 && c <= 0x28ff)) {
        dotsArr = chars.map(unicodeBrailleToDots);
      } else {
        dotsArr = charsToDots(tablePtr, chars);
      }

      const cells: TranslatedCell[] = dotsArr.map((dots, i) => ({
        dots,
        srcIndex: Math.min(Math.max(srcIdx[i] ?? 0, 0), inlen - 1),
      }));
      return { text, cells };
    } finally {
      mod._free(tablePtr);
      mod._free(inbuf);
      mod._free(outbuf);
      mod._free(inlenPtr);
      mod._free(outlenPtr);
      mod._free(outputPosPtr);
      mod._free(inputPosPtr);
      mod._free(cursorPosPtr);
    }
  };

  return { version, translate };
}
