import { beforeAll, describe, expect, it } from 'vitest';
import { periodRange } from '@/lib/period';

beforeAll(() => {
  process.env.TZ = 'Asia/Taipei'; // UTC+8, no DST
});

describe('periodRange', () => {
  it('puts 00:30 Taipei on the new local day, not the UTC day', () => {
    const now = new Date('2026-09-24T16:30:00Z'); // 2026-09-25 00:30 in Taipei
    expect(periodRange('day', now)).toEqual({
      period: 'day',
      period_start: '2026-09-25',
      from: '2026-09-24T16:00:00.000Z',
      to: '2026-09-25T16:00:00.000Z',
    });
  });

  it('starts weeks on Monday (Friday case)', () => {
    const now = new Date('2026-09-24T16:30:00Z'); // Fri 2026-09-25 in Taipei
    expect(periodRange('week', now)).toEqual({
      period: 'week',
      period_start: '2026-09-21',
      from: '2026-09-20T16:00:00.000Z',
      to: '2026-09-27T16:00:00.000Z',
    });
  });

  it('treats Sunday as the end of the week, not the start', () => {
    const now = new Date('2026-09-27T02:00:00Z'); // Sun 2026-09-27 10:00 Taipei
    expect(periodRange('week', now).period_start).toBe('2026-09-21');
  });
});
