import { CONFIG } from './config.js';
import { ensureUI } from './ui.js';
import { runExport, takePendingExport } from './export.js';

// 注入 UI(延迟等页面稳定)
setTimeout(() => {
  try {
    const ui = ensureUI(runExport);
    // 自动续跑:从首页跳转到阅读页后,检测到待办导出则自动开始
    // 注意:仅在阅读页才取出待办,其他页面保留给后续跳转
    const pending = location.pathname.startsWith(CONFIG.readerPathPrefix)
      ? takePendingExport()
      : null;
    if (pending) {
      ui.log('检测到待续跑导出,自动开始(阅读会话已就绪)...');
      runExport({ all: !!pending.all, log: ui.log })
        .then(() => ui.log('✅ 导出完成!已下载 .md 和 .json 文件(浏览器可能拦截第二个下载,请在下载栏允许)'))
        .catch((e) => ui.log('❌ 导出失败: ' + e.message));
    }
  } catch (e) {
    console.error('[WeRead Export]', e);
  }
}, 1500);
