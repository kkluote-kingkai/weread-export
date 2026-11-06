import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter, withRetry } from '../src/api.js';

describe('createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('相邻请求间隔不小于 interval', async () => {
    const schedule = createRateLimiter(100);
    const times = [];
    const t0 = Date.now();
    const runs = [0, 1, 2].map(() =>
      schedule(() => { times.push(Date.now() - t0); })
    );
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(runs);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(100);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(100);
  });

  it('某个请求抛错不阻塞后续请求', async () => {
    const schedule = createRateLimiter(10);
    const bad = schedule(() => Promise.reject(new Error('boom')));
    const good = schedule(() => Promise.resolve('ok'));
    await vi.advanceTimersByTimeAsync(100);
    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBe('ok');
  });
});

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function settle(promise) {
    // 先挂 handler 再推进定时器,避免退避期间触发 unhandled rejection
    const tracked = promise.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
    await vi.advanceTimersByTimeAsync(1e6);
    const r = await tracked;
    if (r.ok) return r.v;
    throw r.e;
  }

  it('首次成功直接返回', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(settle(withRetry(fn))).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('异常重试,耗尽后抛最后一个异常', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'));
    await expect(settle(withRetry(fn, { tries: 2, backoffMs: [10] }))).rejects.toThrow('e2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('isResultOk 不满足时重试,耗尽后返回最后结果', async () => {
    const fn = vi.fn().mockResolvedValue([]);
    const r = await settle(
      withRetry(fn, { tries: 3, backoffMs: [10, 10, 10], isResultOk: (v) => v.length > 0 })
    );
    expect(r).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('结果达标立即返回不再重试', async () => {
    const fn = vi.fn().mockResolvedValue([1]);
    await settle(
      withRetry(fn, { tries: 3, backoffMs: [10], isResultOk: (v) => v.length > 0 })
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('onRetry 回调收到异常和结果', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    await settle(withRetry(fn, { tries: 2, backoffMs: [10], onRetry })).catch(() => {});
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0].message).toBe('x');
  });
});
