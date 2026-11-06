import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const banner = `// ==UserScript==
// @name         微信读书数据导出 WeRead Exporter
// @namespace    https://github.com/kkluote-kingkai/weread-export
// @version      ${pkg.version}
// @description  一键导出微信读书全部数据:书架、划线、想法、笔记、阅读时长。输出 Markdown + JSON,支持增量/全量。
// @author       kkluote-kingkai
// @match        https://weread.qq.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==
`;

await build({
  entryPoints: [join(root, 'src/index.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  banner: { js: banner },
  outfile: join(root, 'weread-export.user.js'),
  logLevel: 'info',
});
