// ==UserScript==
// @name         微信读书数据导出 WeRead Exporter
// @namespace    https://github.com/kkluote-kingkai/weread-export
// @version      0.1.0
// @description  一键导出微信读书全部数据:书架、划线、想法、笔记、阅读时长。输出 Markdown + JSON,支持增量/全量。
// @author       kkluote-kingkai
// @match        https://weread.qq.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const SLEEP_MS = 300;      // 请求间隔,礼貌限速
  const CONCURRENCY = 4;     // 并发抓取书本数

  // ---------- 基础工具 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function apiGet(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data && data.errCode !== undefined && data.errCode !== 0 && data.errCode !== '0') {
      throw new Error('API ' + data.errCode + ' ' + (data.errMsg || ''));
    }
    return data;
  }

  async function apiPost(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data && data.errCode !== undefined && data.errCode !== 0 && data.errCode !== '0') {
      throw new Error('API ' + data.errCode + ' ' + (data.errMsg || ''));
    }
    return data;
  }

  function fmtDuration(sec) {
    if (!sec) return '0 分钟';
    sec = Number(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h <= 0) return m + ' 分钟';
    return h + ' 小时 ' + m + ' 分钟';
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    if (isNaN(d)) return String(ts);
    return d.toISOString().slice(0, 10);
  }

  function esc(t) {
    return String(t == null ? '' : t);
  }

  function nowStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ---------- 数据抓取 ----------
  async function fetchNotebooks(log) {
    // 分页:count + lastSort 游标,hasMore 为 0 停止
    const books = [];
    let lastSort = '';
    let hasMore = true;
    let total = '?';
    let guard = 0;
    while (hasMore && guard++ < 500) {
      const q = 'count=100' + (lastSort ? '&lastSort=' + encodeURIComponent(lastSort) : '');
      const data = await apiGet('/api/user/notebook?' + q);
      const list = data.books || [];
      if (data.totalBookCount !== undefined) total = data.totalBookCount;
      for (const b of list) books.push(b);
      hasMore = Number(data.hasMore) === 1;
      if (list.length === 0) break;
      lastSort = list[list.length - 1].sort;
      log('书架扫描: ' + books.length + ' / ' + total);
      await sleep(SLEEP_MS);
    }
    return books;
  }

  async function fetchBookHighlights(bookId) {
    const data = await apiGet('/web/book/bookmarklist?bookId=' + bookId);
    const arr = (data.updated || []).filter((b) => b && b.markText);
    return arr.map((b) => ({
      chapterUid: b.chapterUid,
      markText: b.markText,
      color: b.color,
      createTime: b.createTime,
    }));
  }

  async function fetchBookReviews(bookId) {
    // 想法/书评:type=1 划线想法, type=4 章节/全书书评
    const out = [];
    let syncKey = 0;
    let guard = 0;
    while (guard++ < 100) {
      const data = await apiGet(
        '/api/review/list?bookId=' + bookId + '&listType=11&mine=1&syncKey=' + syncKey + '&count=100'
      );
      const list = data.reviews || [];
      for (const r of list) {
        if (!r || !r.review) continue;
        out.push({
          type: r.review.type,
          content: r.review.content,
          chapterUid: r.review.chapterUid,
          createTime: r.review.createTime,
          reviewId: r.review.reviewId,
        });
      }
      const next = data.syncKey !== undefined ? data.syncKey : data.synckey;
      if (list.length === 0 || next === undefined || Number(next) === Number(syncKey)) break;
      syncKey = next;
      await sleep(SLEEP_MS);
    }
    return out;
  }

  async function fetchChapterTitles(bookId) {
    const data = await apiPost('/web/book/chapterInfos', {
      bookIds: [bookId],
      synckeys: [0],
      teenmode: 0,
    });
    const map = {};
    const upd = (data.data && data.data[0] && data.data[0].updated) || [];
    for (const c of upd) if (c && c.chapterUid) map[c.chapterUid] = c.title || '';
    return map;
  }

  async function fetchReadInfo(bookId) {
    const data = await apiGet(
      '/web/book/readinfo?bookId=' + bookId + '&readingDetail=1&readingBookIndex=1&finishedDate=1'
    );
    return {
      readingTime: data.readingTime || 0,
      readingProgress: data.readingProgress !== undefined ? data.readingProgress : null,
      markedStatus: data.markedStatus !== undefined ? data.markedStatus : null,
      finishedDate: data.finishedDate || null,
    };
  }

  async function fetchBookInfo(bookId) {
    try {
      const data = await apiGet('/web/book/info?bookId=' + bookId);
      return {
        title: data.title || '',
        author: data.author || '',
        isbn: data.isbn || '',
        category: (data.category && data.category.title) || data.category || '',
        intro: data.intro || '',
        totalWords: data.totalWords || 0,
        newRating: data.newRating !== undefined ? data.newRating : null,
      };
    } catch (e) {
      return { title: '', author: '', isbn: '', category: '', intro: '', totalWords: 0, newRating: null };
    }
  }

  async function fetchShelf(log) {
    // 书架:需要 userVid,优先取 cookie,其次 login/getinfo
    let vid = '';
    const m = document.cookie.match(/(?:^|; )wr_vid=([^;]+)/);
    if (m) vid = m[1];
    if (!vid) {
      try {
        const g = await apiGet('/web/login/getinfo');
        vid = g.userVid || g.vid || g.suid || '';
      } catch (e) { /* ignore */ }
    }
    if (!vid) return { ok: false, reason: '无法获取 userVid(cookie wr_vid 缺失),书架跳过' };
    try {
      const data = await apiGet('/web/shelf/sync?userVid=' + encodeURIComponent(vid) + '&synckey=0&lectureSynckey=0');
      const shelf = (data.shelf && data.shelf.booksAndArchives) || [];
      const books = shelf
        .filter((s) => s && s.book)
        .map((s) => ({
          bookId: s.book.bookId,
          title: s.book.title || '',
          author: s.book.author || '',
          cover: s.book.cover || '',
          format: s.book.format || '',
          readUpdateTime: s.readUpdateTime || 0,
        }));
      return { ok: true, books, userVid: vid };
    } catch (e) {
      return { ok: false, reason: '书架抓取失败: ' + e.message };
    }
  }

  // ---------- 单本全量抓取(带限流) ----------
  async function fetchBookComplete(entry, log) {
    const bookId = entry.bookId;
    const base = entry.book || {};
    const out = {
      bookId,
      title: base.title || entry.title || '',
      author: base.author || '',
      cover: base.cover || '',
      readingProgress: entry.readingProgress !== undefined ? entry.readingProgress : null,
      markedStatus: entry.markedStatus !== undefined ? entry.markedStatus : null,
      noteCount: entry.noteCount || 0,
      reviewCount: entry.reviewCount || 0,
      bookmarkCount: entry.bookmarkCount || 0,
      highlights: [],
      thoughts: [],
      readingTimeSec: 0,
      finishedDate: null,
      chapters: {},
      meta: {},
      errors: [],
    };

    await sleep(SLEEP_MS);
    try { out.highlights = await fetchBookHighlights(bookId); }
    catch (e) { out.errors.push('划线: ' + e.message); }

    await sleep(SLEEP_MS);
    try { out.thoughts = await fetchBookReviews(bookId); }
    catch (e) { out.errors.push('想法: ' + e.message); }

    try {
      out.chapters = await fetchChapterTitles(bookId);
    } catch (e) { /* 章节映射失败不致命 */ }

    await sleep(SLEEP_MS);
    try {
      const ri = await fetchReadInfo(bookId);
      out.readingTimeSec = ri.readingTime;
      if (ri.readingProgress !== null) out.readingProgress = ri.readingProgress;
      out.markedStatus = ri.markedStatus;
      out.finishedDate = ri.finishedDate;
    } catch (e) { out.errors.push('阅读信息: ' + e.message); }

    try {
      out.meta = await fetchBookInfo(bookId);
      if (out.meta.title) out.title = out.meta.title;
      if (out.meta.author) out.author = out.meta.author;
    } catch (e) { /* 书籍详情可选 */ }

    return out;
  }

  async function mapLimit(items, limit, worker, log) {
    const results = new Array(items.length);
    let idx = 0;
    const runners = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      runners.push((async () => {
        while (idx < items.length) {
          const cur = idx++;
          results[cur] = await worker(items[cur]);
          log('进度: ' + (cur + 1) + ' / ' + items.length + ' ' + (results[cur].title || items[cur].bookId));
        }
      })());
    }
    await Promise.all(runners);
    return results;
  }

  // ---------- 导出生成 ----------
  function buildMarkdown(result) {
    const L = [];
    L.push('# 微信读书数据导出');
    L.push('');
    L.push('- 导出时间: ' + new Date().toLocaleString());
    L.push('- 笔记书数: ' + result.books.length);
    L.push('- 划线总数: ' + result.books.reduce((a, b) => a + b.highlights.length, 0));
    L.push('- 想法总数: ' + result.books.reduce((a, b) => a + b.thoughts.length, 0));
    if (result.shelf && result.shelf.ok) {
      L.push('- 书架总数: ' + result.shelf.books.length);
    }
    L.push('');
    L.push('---');
    L.push('');

    for (const b of result.books) {
      L.push('## 《' + b.title + '》' + (b.author ? '  ' + b.author : ''));
      L.push('');
      L.push('- 阅读进度: ' + (b.readingProgress !== null ? Math.round(b.readingProgress * 100) + '%' : '未知'));
      L.push('- 阅读时长: ' + fmtDuration(b.readingTimeSec));
      if (b.finishedDate) L.push('- 读完日期: ' + fmtDate(b.finishedDate));
      if (b.meta.isbn) L.push('- ISBN: ' + b.meta.isbn);
      if (b.meta.category) L.push('- 分类: ' + b.meta.category);
      if (b.meta.totalWords) L.push('- 字数: ' + b.meta.totalWords);
      L.push('- 划线 ' + b.highlights.length + ' 条,想法 ' + b.thoughts.length + ' 条');
      if (b.errors.length) L.push('- ⚠️ 部分数据抓取失败: ' + b.errors.join('; '));
      L.push('');

      const groups = {};
      for (const h of b.highlights) {
        const key = h.chapterUid;
        if (!groups[key]) groups[key] = [];
        groups[key].push(h);
      }
      const chapterNames = b.chapters;

      // 按章节序排列(有章节名的优先)
      const keys = Object.keys(groups);
      if (keys.length) {
        L.push('### 划线');
        L.push('');
        for (const k of keys) {
          const cname = chapterNames[k] || '未命名章节';
          L.push('**' + cname + '**');
          L.push('');
          for (const h of groups[k]) {
            L.push('> ' + h.markText);
            L.push('');
          }
        }
      }

      const thoughts = b.thoughts.filter((t) => t.type === 1);
      const reviews = b.thoughts.filter((t) => t.type === 4);
      if (thoughts.length) {
        L.push('### 划线想法');
        L.push('');
        for (const t of thoughts) {
          L.push('- ' + t.content + (t.createTime ? '  (' + fmtDate(t.createTime) + ')' : ''));
        }
        L.push('');
      }
      if (reviews.length) {
        L.push('### 书评/想法');
        L.push('');
        for (const t of reviews) {
          L.push('**' + fmtDate(t.createTime) + '**');
          L.push('');
          L.push(t.content);
          L.push('');
        }
      }
      if (!keys.length && !thoughts.length && !reviews.length) {
        L.push('*(本书暂无划线或想法)*');
        L.push('');
      }
      L.push('---');
      L.push('');
    }
    return L.join('\n');
  }

  // ---------- UI ----------
  let ui = null;

  function ensureUI() {
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
        await runExport({ all, log });
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

  async function runExport(opts) {
    const { all, log } = opts;
    log('开始导出...');

    // 1. 验证登录态
    let books;
    try {
      log('读取笔记本列表...');
      books = await fetchNotebooks(log);
    } catch (e) {
      if (e.message.indexOf('HTTP 401') >= 0 || e.message.indexOf('AUTH') >= 0 || e.message.indexOf('登录') >= 0) {
        throw new Error('登录已失效,请先在 weread.qq.com 完成登录后重试');
      }
      throw e;
    }
    if (books.length === 0) {
      throw new Error('没有找到任何有笔记的书。若确实有,请先打开 weread.qq.com 完成登录,再点导出。');
    }
    log('共 ' + books.length + ' 本书含笔记,开始抓取细节...');

    // 2. 书架(尽力而为)
    let shelf = null;
    try {
      shelf = await fetchShelf(log);
      if (shelf.ok) log('书架: ' + shelf.books.length + ' 本');
      else log(shelf.reason);
    } catch (e) {
      log('书架跳过: ' + e.message);
    }

    // 3. 全量/增量过滤
    let targets = books;
    if (!all) {
      targets = books.filter(
        (b) => (b.noteCount || 0) > 0 || (b.reviewCount || 0) > 0 || (b.bookmarkCount || 0) > 0
      );
      log('增量模式: ' + targets.length + ' 本有划线的书');
    }

    // 4. 并发抓取每本书
    const details = await mapLimit(targets, CONCURRENCY, (entry) => fetchBookComplete(entry, log), log);

    // 5. 汇总
    const result = {
      exportedAt: new Date().toISOString(),
      userVid: (shelf && shelf.userVid) || '',
      summary: {
        noteBooks: books.length,
        exportedBooks: details.length,
        highlights: details.reduce((a, b) => a + b.highlights.length, 0),
        thoughts: details.reduce((a, b) => a + b.thoughts.length, 0),
        readingSeconds: details.reduce((a, b) => a + b.readingTimeSec, 0),
      },
      shelf: shelf ? { ok: shelf.ok, books: shelf.ok ? shelf.books : [], reason: shelf.reason } : null,
      books: details,
    };

    // 6. 输出
    const stamp = nowStamp();
    download('weread_export_' + stamp + '.md', buildMarkdown(result));
    await sleep(1500);
    download('weread_export_' + stamp + '.json', JSON.stringify(result, null, 2), 'application/json');
  }

  // 注入 UI(延迟等页面稳定)
  setTimeout(() => {
    try { ensureUI(); } catch (e) { console.error('[WeRead Export]', e); }
  }, 1500);
})();
