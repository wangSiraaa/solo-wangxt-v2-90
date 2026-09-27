# 无障碍出版工作室（Tactile Publishing Studio）

本地运行的盲文段落与简单触觉示意图编排工具。**全程不调用任何云服务**：盲文转译由
liblouis 的 WebAssembly 构建在浏览器内完成，语言表在编译期打包进 wasm；工程保存于
浏览器 IndexedDB；PDF 由 pdf-lib 在本地生成。

## 功能

- **React + TypeScript 版面编辑**：标题、正文段落、页码、网格化触觉示意图。
- **liblouis WebAssembly**（上游 3.33.0，自行 emscripten 编译）：
  - 固定使用项目指定的语言表，编译进 MEMFS，运行期无网络：
    `en-ueb-g2.ctb`（UEB 二级缩略）、`en-ueb-g1.ctb`（UEB 一级非缩略）、
    `unicode-braille.utb`（盲文模式符直通校对）。
  - 输出 Unicode 盲文（U+28xx），并通过 `lou_translate` 的 `inputPos/outputPos`
    保留**每个盲文单元 ↔ 原文字符**的对应关系。
- **Canvas 预览点阵**：真实毫米坐标，支持页边距参考与"原文/盲文对照"标注；
  预览面板下方提供逐行原文 ↔ 盲文 Unicode 对照表。
- **pdf-lib 导出**：MediaBox 为真实页面尺寸（mm→pt），每个凸点按同一套毫米坐标绘制圆。
- **IndexedDB 工程持久化**：防抖自动保存，刷新后恢复最近工程。
- **非重叠保证**：图形、图注、正文按盲文行网格分区；页码固定最后一行；
  放不下时产生显式版面告警而非静默重叠。

## 工艺参数（题目给定的示例工艺参数，见 `src/braille/processParams.ts`）

| 参数 | 值 |
| --- | --- |
| 凸点直径 | 1.5 mm |
| 单元内横/纵最小点距 | 2.5 / 2.5 mm |
| 单元节距 / 行节距 | 6 / 10 mm |
| 示意图网格最小点距 | 2.5 mm（默认网格 5 mm） |

US Letter（215.9 × 279.4 mm，20mm 边距）下容量为 29 单元/行 × 24 行。

## 预览 ↔ PDF 点位一致性的实现方式

Canvas 与 PDF **不各自计算点位**，二者都只消费 `layoutProject()` 输出的
`dots: PlacedDot[]` 与 `diagramLines: PlacedLine[]`（毫米坐标）：

- Canvas：`x(px) = xMm * pxPerMm`
- PDF：`x(pt) = xMm * 72/25.4`，并做左下/左上原点的 y 翻转

因此任意一个凸点在预览与 PDF 中的坐标、直径一一对应。测试 `tests/consistency.test.ts`
用 liblouis 真实转译内置验证样稿（长单词、数字切换、带图注页），并直接解析生成的
PDF 内容流（贝塞尔圆心、线段端点、MediaBox），与引擎真值和 Canvas mock 三方核对。

## 验证样稿（"载入验证样稿"）

1. **长单词页**：`internationalization`、`uncharacteristically` 等在 UEB 二级下产生
   缩略点位（单元数少于字符数；单元测试同时对照一级表逐字符结果）。
2. **数字切换页**：`Room 207`、`0830`、`31415` 等验证数字符 `⠼`（dots 3-4-5-6）、
   数字符后按数字义读点（b j g = 2 0 7）、空格后自动降回字母位。
3. **带图注页**：网格化 L 形触觉路线（凸点 + 触觉连线）+ 独立起终点 +
   居中图注 `Figure 1. Route to Room 207 in 2026.`，图形/图注/正文不重叠。

## 触读质量（重要）

PDF 与 Canvas 保证的是**凸点几何位置**的一致与正确。普通办公打印机只能输出平面墨迹；
最终凸点高度、触感区分度、点形牢度与纸张适应性**仍需在实际盲文打样/制版设备
（如盲文压印机/热膨胀纸设备）上打样确认**。应用在导出后会显示该提示。

## 开发

```bash
npm install
npm run dev          # 本地开发
npm test             # vitest 单元/一致性测试（Node 内直接跑 wasm）
npm run test:e2e     # Playwright 端到端（需先 npm run dev）
npm run build
```

### 重新构建 liblouis wasm

需要 emscripten（脚本默认读取 `/tmp/build/liblouis-3.33.0` 的上游源码；
可用 `LL_SRC=/path/to/liblouis-3.33.0` 覆盖）：

```bash
LL_SRC=/path/to/liblouis-3.33.0 ./wasm/build.sh
# 产出 src/wasm/liblouis.mjs（SINGLE_FILE，wasm + 语言表内嵌，约 0.7MB）
```

固定语言表清单（含 include 闭包）在 `wasm/build.sh` 的 `TABLES` 数组中维护。

## 目录

```
src/
  braille/
    processParams.ts   工艺参数（mm）与 mm↔pt
    translator.ts      liblouis wasm 封装（Unicode 盲文 + 原文映射）
    layout.ts          纯函数版面引擎（行宽折行/不重叠/绝对点位）
    canvasRender.ts    Canvas 渲染（消费 layout 点位）
    pdfExport.ts       pdf-lib 导出（消费同一 layout 点位）
    sampleProject.ts   内置验证样稿
  components/          PageEditor / PreviewCanvas
  storage/             IndexedDB
  wasm/liblouis.mjs    emscripten 构建产物（内嵌 wasm + 固定语言表）
wasm/
  shim.c               liblouis C 封装层
  build.sh             emcc 构建脚本
tests/
  translator.test.ts   转译：长单词缩略、数字符切换、映射区间
  layout.test.ts       几何：行宽、最小点距、不重叠、页码、溢出告警
  consistency.test.ts  预览/PDF/引擎 三方点位一致性 + 真实页面尺寸
  e2e.spec.ts          浏览器端到端：wasm 加载、Canvas、IndexedDB、PDF 下载
```

## 许可说明

liblouis 为 LGPL-2.1+；本项目以独立可替换的 wasm 产物方式链接它。
