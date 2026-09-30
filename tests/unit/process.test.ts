import { describe, expect, it, vi } from 'vitest';
import { buildProcessPrompt, MAX_PROMPT_CHARS, parseProcessResult, processText } from '@/lib/ai/process';

const recorded = {
  zhTodo: '{"type":"todo","title":"修理腳踏車","summary":"週末前把腳踏車的煞車修好。","next_steps":["查附近車行營業時間","週六早上送修"],"context":"phone","effort":"medium"}',
  enIdeaFenced: '```json\n{"type":"idea","title":"Idea capture PWA","summary":"An app to capture ideas fast.","next_steps":["Write a spec"],"context":"laptop","effort":"long"}\n```',
};

describe('parseProcessResult', () => {
  it('accepts a recorded Chinese todo response', () => {
    const r = parseProcessResult(recorded.zhTodo);
    expect(r.type).toBe('todo');
    expect(r.next_steps).toHaveLength(2);
  });

  it('accepts a fenced response', () => {
    expect(parseProcessResult(recorded.enIdeaFenced).context).toBe('laptop');
  });

  it('rejects an unknown type', () => {
    expect(() => parseProcessResult(recorded.zhTodo.replace('"todo"', '"chore"'))).toThrow('Invalid AI result');
  });

  it('rejects a missing field', () => {
    expect(() => parseProcessResult('{"type":"idea","title":"x"}')).toThrow('Invalid AI result');
  });
});

describe('buildProcessPrompt', () => {
  it('wraps the raw text', () => {
    expect(buildProcessPrompt('buy milk 買牛奶')).toContain('<capture>\nbuy milk 買牛奶\n</capture>');
  });

  it('truncates very long dictation instead of rejecting it', () => {
    const prompt = buildProcessPrompt('a'.repeat(MAX_PROMPT_CHARS + 500));
    expect(prompt).toContain('a'.repeat(MAX_PROMPT_CHARS));
    expect(prompt).not.toContain('a'.repeat(MAX_PROMPT_CHARS + 1));
    expect(prompt).toContain('[truncated]');
  });
});

describe('processText', () => {
  it('calls the Haiku model and returns the parsed result', async () => {
    const complete = vi.fn().mockResolvedValue(recorded.zhTodo);
    const r = await processText('腳踏車煞車壞了 週末前要修', complete);
    expect(r.title).toBe('修理腳踏車');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5-20251001', timeoutMs: 30_000 }));
  });
});
