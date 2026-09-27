/**
 * 端到端浏览器测试（Playwright）：
 *  在真实浏览器中验证 wasm 初始化、Canvas 渲染、PDF 导出下载与 IndexedDB 保存。
 *  运行：PLAYWRIGHT_BASE=http://127.0.0.1:5199 npx playwright test tests/e2e.spec.ts
 */
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import zlib from 'node:zlib';

const BASE = process.env.PLAYWRIGHT_BASE ?? 'http://127.0.0.1:5199';

let browser: Browser;
let page: Page;
let context: import('@playwright/test').BrowserContext;

test.beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
    executablePath: process.env.CHROMIUM_BIN || undefined,
  });
});
test.afterAll(async () => {
  await browser.close();
});

test.beforeEach(async () => {
  // 每个测试使用独立 context：IndexedDB 相互隔离，避免并行/串行污染
  context = await browser.newContext();
  page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  (page as unknown as { __errs: string[] }).__errs = errors;
});

test.afterEach(async () => {
  await context.close();
});

async function gotoApp(): Promise<void> {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await expect(page.getByText(/liblouis 3\.33\.0/)).toBeVisible({ timeout: 30000 });
}

test('页面加载、wasm 引擎就绪、Canvas 画出凸点', async () => {
  await gotoApp();
  await page.waitForTimeout(500);

  const dotCount = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return -1;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // 统计黑色（盲文点）和深蓝色（示意图点）像素
    let blackish = 0;
    for (let i = 0; i < img.length; i += 4) {
      const [r, g, b] = [img[i], img[i + 1], img[i + 2]];
      if (r < 40 && g < 40 && b < 40) blackish++;
    }
    return blackish;
  });
  expect(dotCount).toBeGreaterThan(500);

  // 第 1 页（长单词）对照表里应能看到盲文模式符与英文原文
  await page.getByText('原文 ↔ 盲文逐行对照').waitFor();
  const tableText = await page.locator('body').innerText();
  expect(tableText).toContain('internationalization');

  const errs = (page as unknown as { __errs: string[] }).__errs;
  expect(errs.filter((e) => !e.includes('favicon'))).toEqual([]);
});

test('切换到数字页与图注页，示意图点以蓝色渲染', async () => {
  await gotoApp();
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByRole('button', { name: '下一页' }).click();
  await page.waitForTimeout(400);

  const hasBlueDots = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < img.length; i += 4) {
      // 示意图蓝 #1a3d7c = (26,61,124)
      if (Math.abs(img[i] - 26) < 12 && Math.abs(img[i + 1] - 61) < 12 && Math.abs(img[i + 2] - 124) < 20) return true;
    }
    return false;
  });
  expect(hasBlueDots).toBe(true);
});

test('编辑标题后自动保存到 IndexedDB 且可刷新恢复', async () => {
  await gotoApp();
  const input = page.locator('aside input').first();
  await input.fill('E2E 工程名 ' + Date.now());
  await page.getByText(/已本地保存/).waitFor({ timeout: 5000 });

  const count = await page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open('tactile-publishing-studio');
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('projects', 'readonly');
        const r = t.objectStore('projects').count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  expect(count).toBeGreaterThanOrEqual(1);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText(/liblouis 3\.33\.0/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('aside input').first()).toHaveValue(/^E2E 工程名/);
});

test('导出 PDF 触发真实下载且为合法 PDF（%PDF 头 + 3 页 MediaBox）', async () => {
  await gotoApp();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /导出 PDF/ }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  // 页数树 /Count 位于压缩对象流内：逐个 inflate 后统计 "/Count 3"
  const inflatedTexts: string[] = [];
  // 用 ">>\nstream\n" 锚点 + zlib 魔数，逻辑与 tests/pdfParse.ts 相同
  let from = 0;
  for (;;) {
    const idx = buf.indexOf('>>\nstream\n', from);
    if (idx < 0) break;
    const start = idx + '>>\nstream\n'.length;
    from = start;
    if (buf[start] !== 0x78) continue;
    const lenMatch = /\/Length\s+(\d+)/.exec(buf.subarray(Math.max(0, idx - 400), idx).toString('latin1'));
    if (!lenMatch) continue;
    try {
      inflatedTexts.push(zlib.inflateSync(buf.subarray(start, start + Number(lenMatch[1]))).toString('latin1'));
    } catch {
      /* 忽略 */
    }
  }
  expect(inflatedTexts.some((t) => /\/Count\s+3/.test(t))).toBe(true);
  // 触读质量提示出现
  await expect(page.getByText(/最终凸点高度/)).toBeVisible();
});
