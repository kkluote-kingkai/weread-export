let ui = null;

export function ensureUI(onExport) {
  if (ui) return ui;
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:-apple-system,"PingFang SC",sans-serif;';
  const btn = document.createElement('button');
  btn.textContent = '📥 导出微信读书数据';
  btn.style.cssText =
    'background:#07c160;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);';
  btn.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };
  root.appendChild(btn);

  const panel = document.createElement('div');
  panel.style.cssText =
    'display:none;position:absolute;right:0;bottom:48px;width:340px;max-height:70vh;overflow:auto;background:#fff;color:#222;' +
    'border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.3);padding:14px;font-size:13px;line-height:1.6;';
  panel.innerHTML =
    '<div style="font-weight:600;font-size:15px;margin-bottom:8px;">微信读书数据导出</div>' +
    '<label style="display:block;margin:6px 0;">' +
    '  <input type="checkbox" id="wr_opt_all" checked> 全量导出(含无划线的书)' +
    '</label>' +
    '<div style="display:flex;gap:8px;margin:10px 0;">' +
    '  <button id="wr_go" style="flex:1;background:#07c160;color:#fff;border:none;border-radius:6px;padding:8px;cursor:pointer;">开始导出</button>' +
    '  <button id="wr_close" style="background:#eee;color:#333;border:none;border-radius:6px;padding:8px;cursor:pointer;">关闭</button>' +
    '</div>' +
    '<div id="wr_log" style="background:#f7f7f7;border-radius:6px;padding:8px;max-height:260px;overflow:auto;white-space:pre-wrap;font-size:12px;color:#444;"></div>';
  root.appendChild(panel);

  const logEl = panel.querySelector('#wr_log');
  const log = (msg) => {
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[WeRead Export]', msg);
  };

  panel.querySelector('#wr_close').onclick = () => { panel.style.display = 'none'; };
  panel.querySelector('#wr_go').onclick = async () => {
    const goBtn = panel.querySelector('#wr_go');
    goBtn.disabled = true;
    logEl.textContent = '';
    const all = panel.querySelector('#wr_opt_all').checked;
    try {
      await onExport({ all, log });
      log('✅ 导出完成!已下载 .md 和 .json 文件(浏览器可能拦截第二个下载,请在下载栏允许)');
    } catch (e) {
      log('❌ 导出失败: ' + e.message + '\n请确认已在微信读书网页版登录(打开 weread.qq.com)');
    } finally {
      goBtn.disabled = false;
    }
  };

  document.body.appendChild(root);
  ui = { log };
  return ui;
}
