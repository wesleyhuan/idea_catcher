import { describe, expect, it, vi } from 'vitest';
import { processCapture } from '@/lib/server/processCapture';
import type { CaptureRepo } from '@/lib/server/captureRepo';
import type { Capture } from '@/lib/types';
import type { ProcessResult } from '@/lib/ai/process';

const result: ProcessResult = {
  type: 'todo', title: '買牛奶', summary: '回家路上買牛奶。', next_steps: ['去超市'], context: 'phone', effort: 'quick',
};

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'c1', user_id: 'u1', client_id: 'k1', raw_text: '買牛奶', captured_at: '2026-09-24T00:00:00Z',
    status: 'inbox', processing: 'pending', processing_error: null, processing_attempts: 0,
    type: null, title: null, summary: null, next_steps: [], context: null, effort: null,
    user_edited: false, spec_md: null, ...overrides,
  };
}

// claimed: what claim() returns. Defaults to the row with one more attempt, as the RPC would.
function fakeRepo(
  row: Capture | null,
  saveResultReturns = true,
  claimed: Capture | null = row && { ...row, processing_attempts: row.processing_attempts + 1 },
) {
  return {
    get: vi.fn().mockResolvedValue(row),
    claim: vi.fn().mockResolvedValue(claimed),
    saveResult: vi.fn().mockResolvedValue(saveResultReturns),
    markFailed: vi.fn().mockResolvedValue(undefined),
    saveSpec: vi.fn().mockResolvedValue(undefined),
  } satisfies CaptureRepo;
}

describe('processCapture', () => {
  it('returns not_found when the row is missing or belongs to someone else (RLS hides it)', async () => {
    const repo = fakeRepo(null);
    const ai = vi.fn();
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'not_found' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('skips user-edited captures without calling the AI', async () => {
    const ai = vi.fn();
    expect(await processCapture(fakeRepo(capture({ user_edited: true })), 'c1', ai)).toEqual({ outcome: 'skipped' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('skips already processed captures', async () => {
    const ai = vi.fn();
    const repo = fakeRepo(capture({ processing: 'done' }));
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'skipped' });
    expect(ai).not.toHaveBeenCalled();
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('skips without calling the AI when another request already holds the claim', async () => {
    const repo = fakeRepo(capture(), true, null);
    const ai = vi.fn();
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'skipped' });
    expect(ai).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('processes the raw text from the claimed row', async () => {
    const repo = fakeRepo(capture(), true, capture({ raw_text: '買牛奶和蛋', processing_attempts: 1 }));
    const ai = vi.fn().mockResolvedValue(result);
    await processCapture(repo, 'c1', ai);
    expect(ai).toHaveBeenCalledWith('買牛奶和蛋');
  });

  it('saves the result and counts the attempt', async () => {
    const repo = fakeRepo(capture({ processing: 'failed', processing_attempts: 1 }));
    const ai = vi.fn().mockResolvedValue(result);
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'done' });
    expect(repo.claim).toHaveBeenCalledWith('c1');
    expect(repo.saveResult).toHaveBeenCalledWith('c1', result);
  });

  it('marks failed with the error message when the AI throws', async () => {
    const repo = fakeRepo(capture());
    const ai = vi.fn().mockRejectedValue(new Error('Invalid AI result: bad type'));
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'failed', error: 'Invalid AI result: bad type' });
    expect(repo.markFailed).toHaveBeenCalledWith('c1', 'Invalid AI result: bad type');
    expect(repo.saveResult).not.toHaveBeenCalled();
  });

  it('does not overwrite an edit made while the AI was running', async () => {
    const repo = fakeRepo(capture(), false); // saveResult's user_edited=false guard matched no row
    const ai = vi.fn().mockResolvedValue(result);
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'skipped' });
  });
});
