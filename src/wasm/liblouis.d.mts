/**
 * emscripten MODULARIZE + EXPORT_ES6 生成的模块类型声明。
 * 实际文件由 wasm/build.sh 产出（SINGLE_FILE，wasm 内嵌为 base64）。
 */
export interface LouModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _louweb_version(): number;
  _louweb_set_table_path(pathPtr: number): void;
  _louweb_check_table(tableListPtr: number): number;
  _louweb_translate(
    tableListPtr: number,
    inPtr: number,
    inLen: number,
    outPtr: number,
    outCap: number,
    inputPosPtr: number,
    outputPosPtr: number,
  ): number;
  UTF16ToString(ptr: number): string;
  stringToUTF16(str: string, ptr: number, maxBytes: number): void;
  UTF8ToString(ptr: number): string;
  allocateUTF8(str: string): number;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
}

export interface LouModuleFactory {
  (): Promise<LouModule>;
}

declare const factory: LouModuleFactory;
export default factory;
