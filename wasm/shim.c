/*
 * liblouis-web —— 最小 C 封装层
 *
 * 仅暴露本项目所需的能力：
 *   - 设置表搜索路径
 *   - 加载/校验语言表
 *   - UTF-16 输入 -> Unicode 盲文输出（ucBrl 模式），
 *     同时返回 inputPos/outputPos 供原文/盲文对照
 *
 * 由 emscripten 编译为 SINGLE_FILE ES module（src/wasm/liblouis.mjs），
 * 语言表通过 --embed-file 打包进 MEMFS，运行期无任何网络请求。
 */
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "liblouis.h"

EMSCRIPTEN_KEEPALIVE
const char *louweb_version(void) {
	return lou_version();
}

EMSCRIPTEN_KEEPALIVE
void louweb_set_table_path(const char *path) {
	lou_setDataPath(path);
}

/* 返回 1 成功 / 0 失败（表缺失或编译错误） */
EMSCRIPTEN_KEEPALIVE
int louweb_check_table(const char *tableList) {
	return lou_getTable(tableList) != NULL ? 1 : 0;
}

/*
 * 将以 UTF-16 码元计长度的字符串转译为 Unicode 盲文。
 *
 * inbuf        : UTF-16 输入
 * inLen        : 输入长度（码元数）
 * outbuf       : UTF-16 输出缓冲（由调用方分配，长度 >= inLen*2 + 16）
 * outCap       : 输出缓冲容量
 * inputPos     : 长度 = outCap，输出：每个盲文单元对应的输入字符下标
 * outputPos    : 长度 = inLen，输出：每个输入字符对应的盲文单元下标
 * 返回值：成功时盲文单元数（>=0），失败时 -1。
 */
EMSCRIPTEN_KEEPALIVE
int louweb_translate(const char *tableList, const uint16_t *inbuf, int inLen,
		uint16_t *outbuf, int outCap, int *inputPos, int *outputPos) {
	int actualIn = inLen;
	int actualOut = outCap;
	int cursor = 0;
	int ok = lou_translate(tableList, (const widechar *)inbuf, &actualIn,
			(widechar *)outbuf, &actualOut, NULL, NULL, outputPos, inputPos,
			&cursor, ucBrl | partialTrans);
	if (!ok)
		return -1;
	return actualOut;
}
