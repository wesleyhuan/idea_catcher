import { describe, expect, it, vi } from 'vitest';
import { generateDigest, type DigestCapture } from '@/lib/ai/digest';
import { EMPTY_DIGEST, getOrCreateDigest } from '@/lib/server/digest';
import type { DigestRepo } from '@/lib/server/digestRepo';

const range = { period: 'day' as const, period_start: '2026-09-24', from: 'F', to: 'T' };
const item: DigestCapture = {
  type: 'todo', title: '修腳踏車', summary: '週末前修好', context: 'phone', status: 'inbox', captured_at: '2026-09-24T01:00:00Z',
};

function fakeRepo(count: number, cached: { content_md: string; capture_count: number } | null) {
  return {
    countProcessed: vi.fn().mockResolvedValue(count),
    listProcessed: vi.fn().mockResolvedValue([item]),
    getCached: vi.fn().mockResolvedValue(cached),
    save: vi.fn().mockResolvedValue(undefined),
  } satisfies DigestRepo;
}

describe('getOrCreateDigest', () => {
  it('returns the empty message without calling the AI', async () => {
    const ai = vi.fn();
    expect(await getOrCreateDigest(fakeRepo(0, null), range, ai)).toEqual({ content_md: EMPTY_DIGEST, cached: false });
    expect(ai).not.toHaveBeenCalled();
  });

  it('returns the cached digest when the count is unchanged', async () => {
    const ai = vi.fn();
    const r = await getOrCreateDigest(fakeRepo(3, { content_md: 'old', capture_count: 3 }), range, ai);
    expect(r).toEqual({ content_md: 'old', cached: true });
    expect(ai).not.toHaveBeenCalled();
  });

  it('regenerates and saves when new captures arrived', async () => {
    const repo = fakeRepo(4, { content_md: 'old', capture_count: 3 });
    const ai = vi.fn().mockResolvedValue('new');
    expect(await getOrCreateDigest(repo, range, ai)).toEqual({ content_md: 'new', cached: false });
    expect(ai).toHaveBeenCalledWith([item], 'day');
    expect(repo.save).toHaveBeenCalledWith('day', '2026-09-24', 'new', 4);
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
