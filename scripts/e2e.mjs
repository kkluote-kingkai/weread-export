// E2E test: launch persistent Chromium, inject the built userscript,
// run a real export on weread.qq.com, verify .md + .json artifacts.
//
// Usage:
//   node scripts/e2e.mjs            # 增量模式(默认)
//   node scripts/e2e.mjs --all      # 全量导出
//   node scripts/e2e.mjs --headless # 无头(要求已登录过,cookie 在 .pw-profile)
//
// 首次运行需扫码登录一次,登录态保存在 .pw-profile/,之后全自动。

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROFILE = path.join(ROOT, '.pw-profile');
const OUT_DIR = path.join(ROOT, 'e2e-output');
const USERSCRIPT = path.join(ROOT, 'weread-export.user.js');
const args = process.argv.slice(2);
const OPT_ALL = args.includes('--all');
const HEADLESS = args.includes('--headless');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const EXPORT_TIMEOUT_MS = 20 * 60 * 1000;

const ts = () => new Date().toISOString().slice(11, 19);
const info = (m) => console.log(`[${ts()}] ${m}`);

fs.mkdirSync(OUT_DIR, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: HEADLESS,
  acceptDownloads: true,
  viewport: { width: 1440, height: 900 },
  args: [
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=9222',
  ],
});

try {
  // 捕获导出内容:在 userscript 之前 patch createObjectURL,把 Blob 存到 window
  await context.addInitScript(() => {
    window.__wrBlobs = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__wrBlobs.push(blob);
      return orig(blob);
    };
  });
  // 每次导航都注入 userscript(@grant none,等价 Tampermonkey 注入)
  await context.addInitScript({ path: USERSCRIPT });

  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (m) => {
    if (m.text().includes('[WeRead Export]')) info('page: ' + m.text());
  });
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) info('nav → ' + f.url());
  });

  // 浏览器自身仍会触发下载(落到 ~/Downloads),此处不拦截;
  // 产物统一从 window.__wrBlobs 读取,避免持久上下文里 saveAs 丢产物

  info('打开 weread.qq.com ...');
  await page.goto('https://weread.qq.com/', { waitUntil: 'domcontentloaded' });

  // ---- 等待登录(wr_skey cookie) ----
  const hasSession = async () =>
    (await context.cookies('https://weread.qq.com')).some(
      (c) => c.name === 'wr_skey' && c.value
    );
  const t0 = Date.now();
  if (!(await hasSession())) {
    info('未登录 —— 请用手机微信扫描浏览器窗口中的二维码(5 分钟内)');
    await page.screenshot({ path: path.join(OUT_DIR, 'login-qr.png') });
    while (!(await hasSession())) {
      if (Date.now() - t0 > LOGIN_TIMEOUT_MS) throw new Error('扫码超时');
      await page.waitForTimeout(2000);
    }
    // 登录后等页面跳转稳定
    await page.waitForTimeout(3000);
  }
  const cookies = await context.cookies('https://weread.qq.com');
  info('已登录, wr_vid=' + (cookies.find((c) => c.name === 'wr_vid')?.value ?? '?'));

  // ---- 打开导出面板 ----
  const fab = page.locator('button', { hasText: '导出微信读书数据' });
  await fab.waitFor({ state: 'visible', timeout: 15000 });
  await fab.click();
  if (!OPT_ALL) await page.locator('#wr_opt_all').uncheck();
  await page.locator('#wr_go').click();
  info(`已点击"开始导出"(${OPT_ALL ? '全量' : '增量'})。非阅读页会自动跳转续跑。`);

  // ---- 等导出结束(轮询面板日志;跳页后面板重建,日志也在 #wr_log) ----
  const logSel = '#wr_log';
  let done = false;
  let fail = null;
  const t1 = Date.now();
  while (Date.now() - t1 < EXPORT_TIMEOUT_MS) {
    const txt = await page
      .locator(logSel)
      .textContent()
      .catch(() => '');
    if (txt && txt.includes('✅ 导出完成')) {
      done = true;
      break;
    }
    if (txt && txt.includes('❌ 导出失败')) {
      fail = txt.trim().split('\n').pop();
      break;
    }
    await page.waitForTimeout(2000);
  }
  if (fail) throw new Error('导出面报失败: ' + fail);
  if (!done) throw new Error('导出超时(20 分钟未完成)');

  // ---- 校验产物 ----
  await page.waitForTimeout(3000); // 等第二个 blob 生成
  const blobs = await page.evaluate(async () => {
    const out = [];
    for (const b of window.__wrBlobs ?? []) {
      out.push({ type: b.type, text: await b.text() });
    }
    return out;
  });
  if (blobs.length < 2) throw new Error('捕获 blob 数不足: ' + blobs.length);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const md = path.join(OUT_DIR, `weread_export_${stamp}.md`);
  const js = path.join(OUT_DIR, `weread_export_${stamp}.json`);
  fs.writeFileSync(md, blobs[0].text);
  fs.writeFileSync(js, blobs[1].text);
  info('已保存: ' + path.basename(md) + ', ' + path.basename(js));

  const data = JSON.parse(fs.readFileSync(js, 'utf8'));
  const s = data.summary;
  info('---- 结果 ----');
  info(`笔记本 ${s.noteBooks} / 导出 ${s.exportedBooks} 本`);
  info(`划线 ${s.highlights} 条,想法 ${s.thoughts} 条`);
  info(`阅读时长 ${(s.readingSeconds / 3600).toFixed(1)} 小时`);
  info(`md: ${md} (${(fs.statSync(md).size / 1024).toFixed(0)} KB)`);
  info(`json: ${js} (${(fs.statSync(js).size / 1024).toFixed(0)} KB)`);

  if (s.exportedBooks === 0) throw new Error('导出 0 本书');
  if (!fs.readFileSync(md, 'utf8').includes('## ')) throw new Error('md 内容异常');
  info('✅ E2E 通过');
} finally {
  await context.close();
}
