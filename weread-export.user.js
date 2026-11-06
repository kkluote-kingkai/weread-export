// ==UserScript==
// @name         微信读书数据导出 WeRead Exporter
// @namespace    https://github.com/kkluote-kingkai/weread-export
// @version      0.4.0
// @description  一键导出微信读书全部数据:书架、划线、想法、笔记、阅读时长。输出 Markdown + JSON,支持增量/全量。
// @author       kkluote-kingkai
// @match        https://weread.qq.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  // src/config.js
  var CONFIG = {
    // 并发抓取的书本数
    concurrency: 4,
    // 全局请求最小间隔(ms)。原实现是每个 worker 睡 300ms、4 并发 ≈ 13 req/s;
    // 统一限速器后 80ms ≈ 12.5 req/s,速率相当但更平滑。
    minRequestIntervalMs: 80,
    // 分页循环安全上限
    maxPages: 500,
    // bookmarklist 偶发静默返回空(限速/临时失败),需要重试+退避
    bookmarkRetry: { tries: 4, backoffMs: [1500, 4e3, 1e4, 2e4] },
    // 自动续跑导出存放在 sessionStorage 的 key
    pendingKey: "wr_export_pending",
    readerPathPrefix: "/web/reader/"
  };
  var ENDPOINTS = {
    notebooks: "/api/user/notebook",
    bookmarkList: "/web/book/bookmarklist",
    reviewList: "/api/review/list",
    chapterInfos: "/web/book/chapterInfos",
    readInfo: "/web/book/readinfo",
    bookInfo: "/web/book/info",
    shelfSync: "/web/shelf/sync",
    loginInfo: "/web/login/getinfo"
  };

  // src/ui.js
  var ui = null;
  function ensureUI(onExport) {
    if (ui) return ui;
    const root = document.createElement("div");
    root.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:-apple-system,"PingFang SC",sans-serif;';
    const btn = document.createElement("button");
    btn.textContent = "\u{1F4E5} \u5BFC\u51FA\u5FAE\u4FE1\u8BFB\u4E66\u6570\u636E";
    btn.style.cssText = "background:#07c160;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);";
    btn.onclick = () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    };
    root.appendChild(btn);
    const panel = document.createElement("div");
    panel.style.cssText = "display:none;position:absolute;right:0;bottom:48px;width:340px;max-height:70vh;overflow:auto;background:#fff;color:#222;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.3);padding:14px;font-size:13px;line-height:1.6;";
    panel.innerHTML = '<div style="font-weight:600;font-size:15px;margin-bottom:8px;">\u5FAE\u4FE1\u8BFB\u4E66\u6570\u636E\u5BFC\u51FA</div><label style="display:block;margin:6px 0;">  <input type="checkbox" id="wr_opt_all" checked> \u5168\u91CF\u5BFC\u51FA(\u542B\u65E0\u5212\u7EBF\u7684\u4E66)</label><div style="display:flex;gap:8px;margin:10px 0;">  <button id="wr_go" style="flex:1;background:#07c160;color:#fff;border:none;border-radius:6px;padding:8px;cursor:pointer;">\u5F00\u59CB\u5BFC\u51FA</button>  <button id="wr_close" style="background:#eee;color:#333;border:none;border-radius:6px;padding:8px;cursor:pointer;">\u5173\u95ED</button></div><div id="wr_log" style="background:#f7f7f7;border-radius:6px;padding:8px;max-height:260px;overflow:auto;white-space:pre-wrap;font-size:12px;color:#444;"></div>';
    root.appendChild(panel);
    const logEl = panel.querySelector("#wr_log");
    const log = (msg) => {
      logEl.textContent += msg + "\n";
      logEl.scrollTop = logEl.scrollHeight;
      console.log("[WeRead Export]", msg);
    };
    panel.querySelector("#wr_close").onclick = () => {
      panel.style.display = "none";
    };
    panel.querySelector("#wr_go").onclick = async () => {
      const goBtn = panel.querySelector("#wr_go");
      goBtn.disabled = true;
      logEl.textContent = "";
      const all = panel.querySelector("#wr_opt_all").checked;
      try {
        await onExport({ all, log });
        log("\u2705 \u5BFC\u51FA\u5B8C\u6210!\u5DF2\u4E0B\u8F7D .md \u548C .json \u6587\u4EF6(\u6D4F\u89C8\u5668\u53EF\u80FD\u62E6\u622A\u7B2C\u4E8C\u4E2A\u4E0B\u8F7D,\u8BF7\u5728\u4E0B\u8F7D\u680F\u5141\u8BB8)");
      } catch (e) {
        log("\u274C \u5BFC\u51FA\u5931\u8D25: " + e.message + "\n\u8BF7\u786E\u8BA4\u5DF2\u5728\u5FAE\u4FE1\u8BFB\u4E66\u7F51\u9875\u7248\u767B\u5F55(\u6253\u5F00 weread.qq.com)");
      } finally {
        goBtn.disabled = false;
      }
    };
    document.body.appendChild(root);
    ui = { log };
    return ui;
  }

  // src/utils.js
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function fmtDuration(sec) {
    if (!sec) return "0 \u5206\u949F";
    sec = Number(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.round(sec % 3600 / 60);
    if (h <= 0) return m + " \u5206\u949F";
    return h + " \u5C0F\u65F6 " + m + " \u5206\u949F";
  }
  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1e3);
    if (isNaN(d)) return String(ts);
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function nowStamp() {
    const d = /* @__PURE__ */ new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
  }
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2e3);
  }

  // src/api.js
  function createRateLimiter(intervalMs) {
    let chain = Promise.resolve();
    let last = 0;
    return function schedule(fn) {
      const run = chain.then(async () => {
        const wait = intervalMs - (Date.now() - last);
        if (wait > 0) await sleep(wait);
        last = Date.now();
        return fn();
      });
      chain = run.then(() => void 0, () => void 0);
      return run;
    };
  }
  var throttle = createRateLimiter(CONFIG.minRequestIntervalMs);
  async function rawRequest(url, options) {
    const resp = await fetch(url, { credentials: "include", ...options });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    if (data && data.errCode !== void 0 && Number(data.errCode) !== 0) {
      throw new Error("API " + data.errCode + " " + (data.errMsg || ""));
    }
    return data;
  }
  var apiGet = (url) => throttle(() => rawRequest(url));
  var apiPost = (url, body) => throttle(
    () => rawRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  async function withRetry(fn, { tries = 3, backoffMs = [1e3, 3e3, 8e3], isResultOk, onRetry } = {}) {
    let lastErr = null;
    let lastResult;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const result = await fn(attempt);
        if (!isResultOk || isResultOk(result)) return result;
        lastResult = result;
        lastErr = null;
      } catch (e) {
        lastErr = e;
      }
      if (attempt === tries - 1) break;
      if (onRetry) onRetry(lastErr, attempt, lastResult);
      await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
    }
    if (lastErr) throw lastErr;
    return lastResult;
  }

  // src/paginate.js
  async function collectPages(fetchPage, { maxPages = CONFIG.maxPages, onPage } = {}) {
    const items = [];
    let cursor;
    for (let guard = 0; guard < maxPages; guard++) {
      const page = await fetchPage(cursor);
      const pageItems = page.items || [];
      items.push(...pageItems);
      if (onPage) onPage(page, items);
      const next = page.nextCursor;
      const more = page.hasMore !== void 0 ? !!page.hasMore : pageItems.length > 0;
      if (!more || pageItems.length === 0 || next === void 0 || next === cursor) break;
      cursor = next;
    }
    return items;
  }

  // src/model.js
  var mapBookmark = (b) => ({
    chapterUid: b.chapterUid,
    markText: b.markText,
    color: b.color,
    createTime: b.createTime
  });
  var mapReview = (r) => ({
    type: r.type,
    content: r.content,
    chapterUid: r.chapterUid,
    createTime: r.createTime,
    reviewId: r.reviewId
  });
  var mapShelfEntry = (s) => {
    const b = s.book ? { ...s.book, readUpdateTime: s.readUpdateTime } : s;
    return {
      bookId: b.bookId,
      title: b.title || "",
      author: b.author || "",
      cover: b.cover || "",
      format: b.format || "",
      readUpdateTime: b.readUpdateTime || 0
    };
  };
  function createBookRecord(entry) {
    const base = entry.book || {};
    return {
      bookId: entry.bookId,
      title: base.title || entry.title || "",
      author: base.author || "",
      cover: base.cover || "",
      readingProgress: entry.readingProgress !== void 0 ? entry.readingProgress : null,
      markedStatus: entry.markedStatus !== void 0 ? entry.markedStatus : null,
      noteCount: entry.noteCount || 0,
      reviewCount: entry.reviewCount || 0,
      bookmarkCount: entry.bookmarkCount || 0,
      highlights: [],
      thoughts: [],
      readingTimeSec: 0,
      finishedDate: null,
      chapters: {},
      meta: {},
      errors: []
    };
  }
  function mapBookInfo(data) {
    return {
      title: data.title || "",
      author: data.author || "",
      isbn: data.isbn || "",
      category: data.category && data.category.title || data.category || "",
      intro: data.intro || "",
      totalWords: data.totalWords || 0,
      newRating: data.newRating !== void 0 ? data.newRating : null
    };
  }
  function extractUserVid(booksData) {
    for (const b of booksData || []) {
      for (const t of b.thoughts || []) {
        if (t.reviewId && String(t.reviewId).includes("_")) {
          return String(t.reviewId).split("_")[0];
        }
      }
    }
    return "";
  }

  // src/fetchers.js
  async function fetchNotebooks(log) {
    let total = "?";
    return collectPages(
      async (lastSort) => {
        const q = "count=100" + (lastSort ? "&lastSort=" + encodeURIComponent(lastSort) : "");
        const data = await apiGet(ENDPOINTS.notebooks + "?" + q);
        const list = data.books || [];
        if (data.totalBookCount !== void 0) total = data.totalBookCount;
        return {
          items: list,
          nextCursor: list.length ? list[list.length - 1].sort : void 0,
          hasMore: Number(data.hasMore) === 1
        };
      },
      { onPage: (_page, items) => log("\u4E66\u67B6\u626B\u63CF: " + items.length + " / " + total) }
    );
  }
  async function fetchBookHighlights(bookId, expectedCount, log) {
    const { tries, backoffMs } = CONFIG.bookmarkRetry;
    const arr = await withRetry(
      async () => {
        const data = await apiGet(ENDPOINTS.bookmarkList + "?bookId=" + bookId);
        return (data.updated || []).filter((b) => b && b.markText);
      },
      {
        tries,
        backoffMs,
        // 空结果但预期有划线 → 重试;拿到任何结果或本来就没预期 → 结束
        isResultOk: (list) => list.length > 0 || !expectedCount,
        onRetry: (err, attempt) => {
          if (!log) return;
          const waitSec = backoffMs[Math.min(attempt, backoffMs.length - 1)] / 1e3;
          log(
            err ? `  \u26A0\uFE0F bookmarklist \u8BF7\u6C42\u5931\u8D25: ${err.message},\u91CD\u8BD5...` : `  \u26A0\uFE0F bookmarklist \u7A7A(\u671F\u671B${expectedCount}\u6761),${waitSec}s\u540E\u91CD\u8BD5(${attempt + 2}/${tries})`
          );
        }
      }
    );
    return (arr || []).map(mapBookmark);
  }
  async function fetchBookReviews(bookId) {
    const items = await collectPages(
      async (syncKey) => {
        const data = await apiGet(
          ENDPOINTS.reviewList + "?bookId=" + bookId + "&listType=11&mine=1&syncKey=" + (syncKey || 0) + "&count=100"
        );
        const next = data.syncKey !== void 0 ? data.syncKey : data.synckey;
        return { items: data.reviews || [], nextCursor: next };
      },
      { maxPages: 100 }
    );
    const out = [];
    for (const r of items) {
      if (r && r.review) out.push(mapReview(r.review));
    }
    return out;
  }
  async function fetchChapterTitles(bookId) {
    const data = await apiPost(ENDPOINTS.chapterInfos, {
      bookIds: [bookId],
      synckeys: [0],
      teenmode: 0
    });
    const map = {};
    const upd = data.data && data.data[0] && data.data[0].updated || [];
    for (const c of upd) if (c && c.chapterUid) map[c.chapterUid] = c.title || "";
    return map;
  }
  async function fetchReadInfo(bookId) {
    const data = await apiGet(
      ENDPOINTS.readInfo + "?bookId=" + bookId + "&readingDetail=1&readingBookIndex=1&finishedDate=1"
    );
    return {
      readingTime: data.readingTime || 0,
      readingProgress: data.readingProgress !== void 0 ? data.readingProgress : null,
      markedStatus: data.markedStatus !== void 0 ? data.markedStatus : null,
      finishedDate: data.finishedDate || null
    };
  }
  async function fetchBookInfo(bookId) {
    try {
      return mapBookInfo(await apiGet(ENDPOINTS.bookInfo + "?bookId=" + bookId));
    } catch (e) {
      return { title: "", author: "", isbn: "", category: "", intro: "", totalWords: 0, newRating: null };
    }
  }
  async function resolveUserVid(booksData) {
    const m = document.cookie.match(/(?:^|; )wr_vid=([^;]+)/);
    if (m) return m[1];
    try {
      const g = await apiGet(ENDPOINTS.loginInfo);
      if (g.userVid || g.vid || g.suid) return g.userVid || g.vid || g.suid;
    } catch (e) {
    }
    return extractUserVid(booksData);
  }
  async function fetchShelf(log, booksData) {
    const vid = await resolveUserVid(booksData);
    if (!vid) return { ok: false, reason: "\u65E0\u6CD5\u83B7\u53D6 userVid(cookie wr_vid \u7F3A\u5931),\u4E66\u67B6\u8DF3\u8FC7" };
    try {
      const data = await apiGet(
        ENDPOINTS.shelfSync + "?userVid=" + encodeURIComponent(vid) + "&synckey=0&lectureSynckey=0"
      );
      const shelf = data.shelf && data.shelf.booksAndArchives || data.books || [];
      const books = shelf.filter((s) => s && (s.book || s.bookId)).map(mapShelfEntry);
      return { ok: true, books, userVid: vid };
    } catch (e) {
      return { ok: false, reason: "\u4E66\u67B6\u6293\u53D6\u5931\u8D25: " + e.message };
    }
  }
  async function mapLimit(items, limit, worker, log) {
    const results = new Array(items.length);
    let idx = 0;
    let done = 0;
    const runners = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      runners.push(
        (async () => {
          while (idx < items.length) {
            const cur = idx++;
            results[cur] = await worker(items[cur]);
            done++;
            log("\u8FDB\u5EA6: " + done + " / " + items.length + " " + (results[cur].title || items[cur].bookId));
          }
        })()
      );
    }
    await Promise.all(runners);
    return results;
  }
  async function fetchBookComplete(entry, log) {
    const bookId = entry.bookId;
    const out = createBookRecord(entry);
    const collect = async (label, fn, apply) => {
      try {
        const v = await fn();
        if (apply) apply(v);
      } catch (e) {
        out.errors.push(label + ": " + e.message);
      }
    };
    await collect("\u5212\u7EBF", () => fetchBookHighlights(bookId, out.noteCount, log), (v) => out.highlights = v);
    await collect("\u60F3\u6CD5", () => fetchBookReviews(bookId), (v) => out.thoughts = v);
    try {
      out.chapters = await fetchChapterTitles(bookId);
    } catch (e) {
    }
    await collect("\u9605\u8BFB\u4FE1\u606F", () => fetchReadInfo(bookId), (ri) => {
      out.readingTimeSec = ri.readingTime;
      if (ri.readingProgress !== null) out.readingProgress = ri.readingProgress;
      out.markedStatus = ri.markedStatus;
      out.finishedDate = ri.finishedDate;
    });
    const meta = await fetchBookInfo(bookId);
    out.meta = meta;
    if (meta.title) out.title = meta.title;
    if (meta.author) out.author = meta.author;
    return out;
  }

  // src/markdown.js
  var mdQuote = (text) => String(text == null ? "" : text).split("\n").map((l) => "> " + l).join("\n");
  function renderSummary(L, result) {
    L.push("# \u5FAE\u4FE1\u8BFB\u4E66\u6570\u636E\u5BFC\u51FA");
    L.push("");
    L.push("- \u5BFC\u51FA\u65F6\u95F4: " + (/* @__PURE__ */ new Date()).toLocaleString());
    L.push("- \u7B14\u8BB0\u4E66\u6570: " + result.books.length);
    L.push("- \u5212\u7EBF\u603B\u6570: " + result.books.reduce((a, b) => a + b.highlights.length, 0));
    L.push("- \u60F3\u6CD5\u603B\u6570: " + result.books.reduce((a, b) => a + b.thoughts.length, 0));
    if (result.shelf && result.shelf.ok) {
      L.push("- \u4E66\u67B6\u603B\u6570: " + result.shelf.books.length);
    }
    L.push("");
    L.push("---");
    L.push("");
  }
  function renderBookMeta(L, b) {
    L.push("## \u300A" + b.title + "\u300B" + (b.author ? "  " + b.author : ""));
    L.push("");
    L.push("- \u9605\u8BFB\u8FDB\u5EA6: " + (b.readingProgress !== null ? Math.round(b.readingProgress) + "%" : "\u672A\u77E5"));
    L.push("- \u9605\u8BFB\u65F6\u957F: " + fmtDuration(b.readingTimeSec));
    if (b.finishedDate) L.push("- \u8BFB\u5B8C\u65E5\u671F: " + fmtDate(b.finishedDate));
    if (b.meta.isbn) L.push("- ISBN: " + b.meta.isbn);
    if (b.meta.category) L.push("- \u5206\u7C7B: " + b.meta.category);
    if (b.meta.totalWords) L.push("- \u5B57\u6570: " + b.meta.totalWords);
    L.push("- \u5212\u7EBF " + b.highlights.length + " \u6761,\u60F3\u6CD5 " + b.thoughts.length + " \u6761");
    if (b.errors.length) L.push("- \u26A0\uFE0F \u90E8\u5206\u6570\u636E\u6293\u53D6\u5931\u8D25: " + b.errors.join("; "));
    L.push("");
  }
  function renderHighlights(L, b) {
    const groups = {};
    for (const h of b.highlights) {
      (groups[h.chapterUid] = groups[h.chapterUid] || []).push(h);
    }
    const keys = Object.keys(groups);
    if (!keys.length) return false;
    L.push("### \u5212\u7EBF");
    L.push("");
    for (const k of keys) {
      L.push("**" + (b.chapters[k] || "\u672A\u547D\u540D\u7AE0\u8282") + "**");
      L.push("");
      for (const h of groups[k]) {
        L.push(mdQuote(h.markText));
        L.push("");
      }
    }
    return true;
  }
  function renderThoughts(L, b) {
    const thoughts = b.thoughts.filter((t) => t.type === 1);
    const reviews = b.thoughts.filter((t) => t.type === 4);
    if (thoughts.length) {
      L.push("### \u5212\u7EBF\u60F3\u6CD5");
      L.push("");
      for (const t of thoughts) {
        L.push("- " + t.content + (t.createTime ? "  (" + fmtDate(t.createTime) + ")" : ""));
      }
      L.push("");
    }
    if (reviews.length) {
      L.push("### \u4E66\u8BC4/\u60F3\u6CD5");
      L.push("");
      for (const t of reviews) {
        L.push("**" + fmtDate(t.createTime) + "**");
        L.push("");
        L.push(t.content);
        L.push("");
      }
    }
    return thoughts.length + reviews.length;
  }
  function buildMarkdown(result) {
    const L = [];
    renderSummary(L, result);
    for (const b of result.books) {
      renderBookMeta(L, b);
      const hasHighlights = renderHighlights(L, b);
      const thoughtCount = renderThoughts(L, b);
      if (!hasHighlights && !thoughtCount) {
        L.push("*(\u672C\u4E66\u6682\u65E0\u5212\u7EBF\u6216\u60F3\u6CD5)*");
        L.push("");
      }
      L.push("---");
      L.push("");
    }
    return L.join("\n");
  }

  // src/export.js
  function savePendingExport(all) {
    sessionStorage.setItem(CONFIG.pendingKey, JSON.stringify({ all, ts: Date.now() }));
  }
  function takePendingExport() {
    const raw = sessionStorage.getItem(CONFIG.pendingKey);
    if (!raw) return null;
    sessionStorage.removeItem(CONFIG.pendingKey);
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  var onReaderPage = () => location.pathname.startsWith(CONFIG.readerPathPrefix);
  async function runExport(opts) {
    const { all, log } = opts;
    log("\u5F00\u59CB\u5BFC\u51FA...");
    if (!onReaderPage()) {
      log("\u5F53\u524D\u4E0D\u5728\u9605\u8BFB\u9875,bookmarklist \u9700\u8981\u9605\u8BFB\u4F1A\u8BDD\u3002\u81EA\u52A8\u8DF3\u8F6C\u5230\u4E00\u672C\u4E66,\u5230\u8FBE\u540E\u4F1A\u81EA\u52A8\u7EE7\u7EED...");
      try {
        const probe = await fetchNotebooks(log);
        if (probe.length === 0) throw new Error("\u6CA1\u6709\u627E\u5230\u4EFB\u4F55\u6709\u7B14\u8BB0\u7684\u4E66");
        savePendingExport(all);
        location.href = "https://weread.qq.com/web/reader/" + encodeURIComponent(probe[0].bookId);
        return;
      } catch (e) {
        throw new Error("\u8DF3\u8F6C\u9605\u8BFB\u9875\u5931\u8D25: " + e.message);
      }
    }
    let books;
    try {
      log("\u8BFB\u53D6\u7B14\u8BB0\u672C\u5217\u8868...");
      books = await fetchNotebooks(log);
    } catch (e) {
      if (e.message.indexOf("HTTP 401") >= 0 || e.message.indexOf("AUTH") >= 0 || e.message.indexOf("\u767B\u5F55") >= 0) {
        throw new Error("\u767B\u5F55\u5DF2\u5931\u6548,\u8BF7\u5148\u5728 weread.qq.com \u5B8C\u6210\u767B\u5F55\u540E\u91CD\u8BD5");
      }
      throw e;
    }
    if (books.length === 0) {
      throw new Error("\u6CA1\u6709\u627E\u5230\u4EFB\u4F55\u6709\u7B14\u8BB0\u7684\u4E66\u3002\u82E5\u786E\u5B9E\u6709,\u8BF7\u5148\u6253\u5F00 weread.qq.com \u5B8C\u6210\u767B\u5F55,\u518D\u70B9\u5BFC\u51FA\u3002");
    }
    log("\u5171 " + books.length + " \u672C\u4E66\u542B\u7B14\u8BB0,\u5F00\u59CB\u6293\u53D6\u7EC6\u8282...");
    let targets = books;
    if (!all) {
      targets = books.filter(
        (b) => (b.noteCount || 0) > 0 || (b.reviewCount || 0) > 0 || (b.bookmarkCount || 0) > 0
      );
      log("\u589E\u91CF\u6A21\u5F0F: " + targets.length + " \u672C\u6709\u5212\u7EBF\u7684\u4E66");
    }
    const details = await mapLimit(targets, CONFIG.concurrency, (entry) => fetchBookComplete(entry, log), log);
    let shelf = null;
    try {
      shelf = await fetchShelf(log, details);
      if (shelf.ok) log("\u4E66\u67B6: " + shelf.books.length + " \u672C");
      else log(shelf.reason);
    } catch (e) {
      log("\u4E66\u67B6\u8DF3\u8FC7: " + e.message);
    }
    const result = {
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      userVid: shelf && shelf.userVid || "",
      summary: {
        noteBooks: books.length,
        exportedBooks: details.length,
        highlights: details.reduce((a, b) => a + b.highlights.length, 0),
        thoughts: details.reduce((a, b) => a + b.thoughts.length, 0),
        readingSeconds: details.reduce((a, b) => a + b.readingTimeSec, 0)
      },
      shelf: shelf ? { ok: shelf.ok, books: shelf.ok ? shelf.books : [], reason: shelf.reason } : null,
      books: details
    };
    const stamp = nowStamp();
    download("weread_export_" + stamp + ".md", buildMarkdown(result));
    await sleep(1500);
    download("weread_export_" + stamp + ".json", JSON.stringify(result, null, 2), "application/json");
  }

  // src/index.js
  setTimeout(() => {
    try {
      const ui2 = ensureUI(runExport);
      const pending = location.pathname.startsWith(CONFIG.readerPathPrefix) ? takePendingExport() : null;
      if (pending) {
        ui2.log("\u68C0\u6D4B\u5230\u5F85\u7EED\u8DD1\u5BFC\u51FA,\u81EA\u52A8\u5F00\u59CB(\u9605\u8BFB\u4F1A\u8BDD\u5DF2\u5C31\u7EEA)...");
        runExport({ all: !!pending.all, log: ui2.log }).then(() => ui2.log("\u2705 \u5BFC\u51FA\u5B8C\u6210!\u5DF2\u4E0B\u8F7D .md \u548C .json \u6587\u4EF6(\u6D4F\u89C8\u5668\u53EF\u80FD\u62E6\u622A\u7B2C\u4E8C\u4E2A\u4E0B\u8F7D,\u8BF7\u5728\u4E0B\u8F7D\u680F\u5141\u8BB8)")).catch((e) => ui2.log("\u274C \u5BFC\u51FA\u5931\u8D25: " + e.message));
      }
    } catch (e) {
      console.error("[WeRead Export]", e);
    }
  }, 1500);
})();
