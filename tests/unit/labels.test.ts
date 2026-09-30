import { describe, expect, it } from 'vitest';
import { timeAgo } from '@/lib/labels';

const now = new Date('2026-09-24T12:00:00Z');

describe('timeAgo', () => {
  it('says "just now" under a minute', () => {
    expect(timeAgo('2026-09-24T11:59:30Z', now)).toBe('just now');
  });
  it('uses minutes, hours and days', () => {
    expect(timeAgo('2026-09-24T11:55:00Z', now)).toBe('5m ago');
    expect(timeAgo('2026-09-24T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-09-21T12:00:00Z', now)).toBe('3d ago');
  });
});
