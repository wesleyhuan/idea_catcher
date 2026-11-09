import { describe, expect, it, vi } from 'vitest';
import { generateDigest, type DigestCapture } from '@/lib/ai/digest';
import { EMPTY_DIGEST, getOrCreateDigest, isFresh } from '@/lib/server/digest';
import type { CachedDigest, DigestRepo, DigestSource } from '@/lib/server/digestRepo';

const range = { period: 'day' as const, period_start: '2026-09-24', from: 'F', to: 'T' };
const item: DigestCapture = {
  type: 'todo', title: '修腳踏車', summary: '週末前修好', context: 'phone', status: 'inbox', captured_at: '2026-09-24T01:00:00Z',
};

const T1 = '2026-09-24T02:00:00.123456+00:00';
const T2 = '2026-09-24T03:00:00.654321+00:00';
const src = (count: number, latestUpdatedAt: string | null = T1): DigestSource => ({ count, latestUpdatedAt });
const cache = (capture_count: number, source_updated_at: string | null = T1): CachedDigest =>
  ({ content_md: 'old', capture_count, source_updated_at });

function fakeRepo(source: DigestSource, cached: CachedDigest | null) {
  return {
    sourceOf: vi.fn().mockResolvedValue(source),
    listProcessed: vi.fn().mockResolvedValue([item]),
    getCached: vi.fn().mockResolvedValue(cached),
    save: vi.fn().mockResolvedValue(undefined),
  } satisfies DigestRepo;
}

describe('getOrCreateDigest', () => {
  it('returns the empty message without calling the AI', async () => {
    const ai = vi.fn();
    expect(await getOrCreateDigest(fakeRepo(src(0, null), null), range, ai)).toEqual({ content_md: EMPTY_DIGEST, cached: false });
    expect(ai).not.toHaveBeenCalled();
  });

  it('returns the cached digest when nothing changed', async () => {
    const ai = vi.fn();
    const r = await getOrCreateDigest(fakeRepo(src(3), cache(3)), range, ai);
    expect(r).toEqual({ content_md: 'old', cached: true });
    expect(ai).not.toHaveBeenCalled();
  });

  it('regenerates and saves when new captures arrived', async () => {
    const repo = fakeRepo(src(4, T2), cache(3));
    const ai = vi.fn().mockResolvedValue('new');
    expect(await getOrCreateDigest(repo, range, ai)).toEqual({ content_md: 'new', cached: false });
    expect(ai).toHaveBeenCalledWith([item], 'day');
    expect(repo.save).toHaveBeenCalledWith('day', '2026-09-24', 'new', src(4, T2));
  });

  it('regenerates when a capture was edited or re-statused but the count is unchanged', async () => {
    const repo = fakeRepo(src(3, T2), cache(3, T1));
    const ai = vi.fn().mockResolvedValue('new');
    expect(await getOrCreateDigest(repo, range, ai)).toEqual({ content_md: 'new', cached: false });
    expect(repo.save).toHaveBeenCalledWith('day', '2026-09-24', 'new', src(3, T2));
  });
});

describe('isFresh', () => {
  it('needs both the count and the latest update time to match', () => {
    expect(isFresh(cache(3), src(3))).toBe(true);
    expect(isFresh(cache(3), src(4))).toBe(false);
    expect(isFresh(cache(3, T1), src(3, T2))).toBe(false);
    expect(isFresh(null, src(3))).toBe(false);
  });

  it('treats a digest cached before source_updated_at existed as stale', () => {
    expect(isFresh(cache(3, null), src(3))).toBe(false);
  });

  it('compares instants, not timestamp strings', () => {
    expect(isFresh(cache(3, '2026-09-24T02:00:00.123+00:00'), src(3, '2026-09-24T02:00:00.123Z'))).toBe(true);
  });
});

describe('generateDigest', () => {
  it('sends captures as JSON lines to the Sonnet model', async () => {
    const complete = vi.fn().mockResolvedValue(' ## Overview ');
    expect(await generateDigest([item], 'week', complete)).toBe('## Overview');
    const req = complete.mock.calls[0][0];
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.prompt).toContain('"title":"修腳踏車"');
    expect(req.prompt).toContain('this week');
  });
});
