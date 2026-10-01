import { describe, expect, it, vi, beforeEach } from 'vitest';
import { claudeComplete } from '@/lib/claude';

const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { create } };
  }),
}));

const req = {
  model: 'claude-haiku-4-5-20251001',
  system: 'system prompt',
  prompt: 'user prompt',
  maxTokens: 100,
  timeoutMs: 30_000,
  tag: 'process:c1',
};

describe('claudeComplete', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('calls messages.create with the request timeout and maxRetries: 1, and returns joined text blocks', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'tool_use', id: 't1', name: 'noop', input: {} }, // non-text blocks must be filtered out, not concatenated
        { type: 'text', text: 'world' },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
      stop_reason: 'end_turn',
    });

    const result = await claudeComplete(req);

    expect(create).toHaveBeenCalledWith(
      { model: req.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.prompt }] },
      { timeout: req.timeoutMs, maxRetries: 1 },
    );
    expect(result).toBe('hello world');
  });

  it('rethrows the original error when the SDK call fails', async () => {
    const err = new Error('timeout');
    create.mockRejectedValue(err);

    await expect(claudeComplete(req)).rejects.toBe(err);
  });
});
