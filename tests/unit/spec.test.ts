import { describe, expect, it, vi } from 'vitest';
import { buildSpecPrompt, generateSpec } from '@/lib/ai/spec';
import { specForCapture } from '@/lib/server/specCapture';
import type { Capture } from '@/lib/types';

const capture = {
  id: 'c1', raw_text: '做一個 app 收集 ideas', title: 'Idea app', summary: '收集點子的 app',
  next_steps: ['寫 spec'], type: 'idea',
} as Capture;

describe('buildSpecPrompt', () => {
  it('includes the raw text, title and next steps', () => {
    const p = buildSpecPrompt(capture);
    expect(p).toContain('做一個 app 收集 ideas');
    expect(p).toContain('Idea app');
    expect(p).toContain('- 寫 spec');
  });
});

describe('generateSpec', () => {
  it('uses the Sonnet model and returns trimmed markdown', async () => {
    const complete = vi.fn().mockResolvedValue('\n## Goal\n收集點子\n');
    expect(await generateSpec(capture, complete)).toBe('## Goal\n收集點子');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5', timeoutMs: 90_000 }));
  });

  it('rejects an empty response', async () => {
    await expect(generateSpec(capture, vi.fn().mockResolvedValue('  '))).rejects.toThrow('Empty spec');
  });
});

describe('specForCapture', () => {
  const repo = (row: Capture | null) => ({
    get: vi.fn().mockResolvedValue(row),
    saveSpec: vi.fn().mockResolvedValue(undefined),
    markAttempt: vi.fn(), saveResult: vi.fn(), markFailed: vi.fn(),
  });

  it('returns null when the capture is missing', async () => {
    expect(await specForCapture(repo(null), 'c1', vi.fn())).toBeNull();
  });

  it('saves and returns the generated spec', async () => {
    const r = repo(capture);
    expect(await specForCapture(r, 'c1', vi.fn().mockResolvedValue('## Goal'))).toBe('## Goal');
    expect(r.saveSpec).toHaveBeenCalledWith('c1', '## Goal');
  });
});
