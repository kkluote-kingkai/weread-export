import { CONFIG } from './config.js';

// 统一游标分页:fetchPage(cursor) 返回 { items, nextCursor, hasMore }。
// 停止条件:hasMore === false、本页为空、nextCursor 缺失或与上页相同(防死循环)。
// hasMore 缺省时以"本页非空"作为继续条件(适配没有 hasMore 字段的接口)。
export async function collectPages(fetchPage, { maxPages = CONFIG.maxPages, onPage } = {}) {
  const items = [];
  let cursor;
  for (let guard = 0; guard < maxPages; guard++) {
    const page = await fetchPage(cursor);
    const pageItems = page.items || [];
    items.push(...pageItems);
    if (onPage) onPage(page, items);
    const next = page.nextCursor;
    const more = page.hasMore !== undefined ? !!page.hasMore : pageItems.length > 0;
    if (!more || pageItems.length === 0 || next === undefined || next === cursor) break;
    cursor = next;
  }
  return items;
}
