// 通过 CDP 附着到 e2e.mjs 启动的浏览器(:9222),截图当前页面
// Usage: node scripts/peek.mjs [out.png]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] ?? path.join(ROOT, 'e2e-output', 'peek.png');

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().at(-1);
console.log('url:', page.url());
await page.screenshot({ path: out, fullPage: false });
console.log('saved:', out);
await browser.close();
