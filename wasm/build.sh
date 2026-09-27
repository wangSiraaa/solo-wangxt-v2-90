#!/usr/bin/env bash
# 从上游 liblouis 源码构建本项目专用的单文件 ES module（内嵌 wasm + 固定语言表）。
# 用法：LL_SRC=/path/to/liblouis-3.33.0 ./wasm/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LL_SRC="${LL_SRC:-/tmp/build/liblouis-3.33.0}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/liblouis" "$STAGE/tables"

# 1) 生成头文件与最小 config.h（widechar = unsigned short，与 UTF-16 对齐）
cp "$LL_SRC"/liblouis/*.c "$STAGE/liblouis/"
cp "$LL_SRC"/liblouis/internal.h "$STAGE/liblouis/"
sed 's/@WIDECHAR_TYPE@/unsigned short int/' "$LL_SRC/liblouis/liblouis.h.in" > "$STAGE/liblouis/liblouis.h"
cat > "$STAGE/liblouis/config.h" <<EOF
#ifndef LOUISCFG_H
#define LOUISCFG_H
#define PACKAGE_VERSION "3.33.0"
#define _GL_CONFIG_H_INCLUDED 1
/* 语言表打包在 MEMFS 的 /tables（见下方 --embed-file） */
#define TABLESDIR "/tables"
/* 不使用 wchar，宽字符固定为 unsigned short（UTF-16 码元） */
#endif
EOF

# 2) 固定语言表：仅打包项目指定的表及其 include 闭包
TABLES=(
  unicode.dis
  en-ueb-g2.ctb en-ueb-g1.ctb en-ueb-chardefs.uti en-ueb-math.ctb
  braille-patterns.cti latinLetterDef6Dots.uti latinUppercaseComp6.uti
  spaces.uti text_nabcc.dis unicode-braille.utb
)
for t in "${TABLES[@]}"; do
  cp "$LL_SRC/tables/$t" "$STAGE/tables/"
done

cp "$ROOT/wasm/shim.c" "$STAGE/shim.c"

# 3) emcc 编译：SINGLE_FILE + ES6 + MEMFS 内嵌表
SRC_FILES=(
  "$STAGE"/liblouis/{commonTranslationFunctions.c,compileTranslationTable.c,logging.c,lou_backTranslateString.c,lou_translateString.c,maketable.c,metadata.c,pattern.c,utils.c}
)

emcc \
  -O2 \
  -I"$STAGE/liblouis" \
  -s ENVIRONMENT=web,worker,node \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s SINGLE_FILE=1 \
  -s EXPORTED_RUNTIME_METHODS='["UTF16ToString","stringToUTF16","UTF8ToString","allocateUTF8","HEAPU16","HEAP32","HEAP8","FS"]' \
  -s FILESYSTEM=1 \
  -s EXPORT_NAME=createLiblouis \
  -s "EXPORTED_FUNCTIONS=['_malloc','_free','_louweb_version','_louweb_set_table_path','_louweb_check_table','_louweb_translate']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s STACK_SIZE=8388608 \
  -s DISABLE_EXCEPTION_CATCHING=1 \
  --no-entry \
  --embed-file "$STAGE/tables@/tables" \
  "${SRC_FILES[@]}" "$STAGE/shim.c" \
  -o "$ROOT/src/wasm/liblouis.mjs"

echo "生成: $ROOT/src/wasm/liblouis.mjs ($(stat -c%s "$ROOT/src/wasm/liblouis.mjs") bytes)"
