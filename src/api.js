import { CONFIG } from './config.js';
import { sleep } from './utils.js';

// 串行的最小间隔限速器:所有请求排队,保证相邻请求间隔 >= intervalMs
export function createRateLimiter(intervalMs) {
  let chain = Promise.resolve();
  let last = 0;
  return function schedule(fn) {
    const run = chain.then(async () => {
      const wait = intervalMs - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}

const throttle = createRateLimiter(CONFIG.minRequestIntervalMs);

async function rawRequest(url, options) {
  const resp = await fetch(url, { credentials: 'include', ...options });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  if (data && data.errCode !== undefined && Number(data.errCode) !== 0) {
    throw new Error('API ' + data.errCode + ' ' + (data.errMsg || ''));
  }
  return data;
}

export const apiGet = (url) => throttle(() => rawRequest(url));

export const apiPost = (url, body) =>
  throttle(() =>
    rawRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

// 通用重试:异常重试,isResultOk 可让"拿到结果但内容不达预期"也重试。
// 重试耗尽时:有异常抛最后一个异常,否则返回最后一次(不达预期的)结果。
export async function withRetry(fn, { tries = 3, backoffMs = [1000, 3000, 8000], isResultOk, onRetry } = {}) {
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
