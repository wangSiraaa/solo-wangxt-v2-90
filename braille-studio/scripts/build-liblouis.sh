#!/usr/bin/env bash
# 从 liblouis 官方源码构建 WebAssembly 模块（项目固定版本 + 固定语言表）。
# 用法: bash scripts/build-liblouis.sh
# 产物: public/vendor/liblouis/{liblouis-wasm.mjs, liblouis-wasm.wasm, liblouis-wasm.data, tables/, PINNED.md}
set -euo pipefail

LIBLOUIS_VERSION="${LIBLOUIS_VERSION:-3.30.0}"
EMSDK_DIR="${EMSDK_DIR:-/tmp/emsdk}"
WORK=/tmp/liblouis-build
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/vendor/liblouis"
# 项目固定的指定语言表（入口表；include 闭包自动解析）
PINNED_TABLES="en-us-g1.ctb"

echo "== liblouis $LIBLOUIS_VERSION → WASM =="
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1 || { echo "emsdk 未就绪: $EMSDK_DIR"; exit 1; }
command -v emcc >/dev/null || { echo "emcc 不在 PATH"; exit 1; }

mkdir -p "$WORK" "$OUT/tables"
cd "$WORK"

TARBALL="liblouis-$LIBLOUIS_VERSION.tar.gz"
URL="https://github.com/liblouis/liblouis/releases/download/v$LIBLOUIS_VERSION/$TARBALL"
if [ ! -f "$TARBALL" ]; then
  echo "-- 下载 $URL"
  for i in 1 2 3 4 5 6 7 8; do
    curl -fSL -C - -o "$TARBALL" "$URL" && break
    echo "下载中断，续传 ($i)…"; sleep 2
  done
fi
rm -rf "liblouis-$LIBLOUIS_VERSION"
tar xzf "$TARBALL"
cd "liblouis-$LIBLOUIS_VERSION"

echo "-- 配置（emconfigure）"
emconfigure ./configure \
  --disable-shared --enable-static \
  --without-icu --without-libyaml --without-readline \
  --disable-ucs4 \
  CFLAGS="-O2" >/dev/null

echo "-- 编译（emmake）"
emmake make -j"$(nproc)" -C gnulib >/dev/null
emmake make -j"$(nproc)" -C liblouis >/dev/null
ls -la liblouis/.libs/liblouis.a

echo "-- 解析固定表的 include 闭包"
STAGE="$WORK/staged-tables"
rm -rf "$STAGE"; mkdir -p "$STAGE"
python3 - "$PWD/tables" "$STAGE" $PINNED_TABLES <<'PY'
import os, re, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
seen, stack = set(), list(sys.argv[3:])
inc = re.compile(r'^\s*include\s+(\S+)')
while stack:
    name = stack.pop()
    if name in seen: continue
    path = os.path.join(src, name)
    if not os.path.isfile(path):
        print(f"!! 缺少表文件 {name}", file=sys.stderr); sys.exit(1)
    seen.add(name)
    shutil.copy2(path, os.path.join(dst, name))
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            m = inc.match(line)
            if m: stack.append(m.group(1))
print("固定表闭包:", " ".join(sorted(seen)))
PY

echo "-- 链接 WASM"
emcc -O2 liblouis/.libs/liblouis.a -o "$OUT/liblouis-wasm.mjs" \
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FORCE_FILESYSTEM=1 \
  -s ENVIRONMENT=web,node \
  -s EXPORTED_FUNCTIONS=_lou_translate,_lou_translateString,_lou_charToDots,_lou_version,_malloc,_free \
  -s "EXPORTED_RUNTIME_METHODS=UTF8ToString,UTF16ToString,stringToUTF16,stringToUTF8,lengthBytesUTF8,getValue,setValue" \
  --embed-file "$STAGE@/tables"

cp "$STAGE"/* "$OUT/tables/"
{
  echo "# 固定的 liblouis WASM 构建"
  echo "- liblouis 版本: $LIBLOUIS_VERSION（$(echo "$URL")）"
  echo "- 构建: $(date -u +%Y-%m-%dT%H:%M:%SZ), emcc $(emcc --version | head -1)"
  echo "- 固定语言表（入口）: $PINNED_TABLES"
  echo "- 表文件 sha256:"
  (cd "$STAGE" && sha256sum * | sed 's/^/  /')
} > "$OUT/PINNED.md"

echo "== 完成 =="
ls -la "$OUT"
