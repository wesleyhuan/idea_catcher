import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '@/lib/rateLimit';

describe('checkRateLimit', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const key = `t1-${Math.random()}`;
    expect(checkRateLimit(key, 2, 60_000, 0)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000, 10)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000, 20)).toBe(false);
  });

  it('allows again after the window passes', () => {
    const key = `t2-${Math.random()}`;
    checkRateLimit(key, 1, 1000, 0);
    expect(checkRateLimit(key, 1, 1000, 500)).toBe(false);
    expect(checkRateLimit(key, 1, 1000, 1001)).toBe(true);
  });

  it('keeps keys independent', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    checkRateLimit(a, 1, 1000, 0);
    expect(checkRateLimit(b, 1, 1000, 0)).toBe(true);
  });
});
