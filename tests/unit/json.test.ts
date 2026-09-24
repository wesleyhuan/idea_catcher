import { describe, expect, it } from 'vitest';
import { extractJson } from '@/lib/ai/json';

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses an object inside ```json fences', () => {
    expect(extractJson('```json\n{"type":"idea"}\n```')).toEqual({ type: 'idea' });
  });

  it('parses an object surrounded by prose', () => {
    expect(extractJson('Here you go:\n{"title":"買牛奶 milk"}\nHope this helps!')).toEqual({ title: '買牛奶 milk' });
  });

  it('throws when there is no object', () => {
    expect(() => extractJson('sorry, I cannot')).toThrow('No JSON object');
  });

  it('throws on broken JSON', () => {
    expect(() => extractJson('{"a":')).toThrow();
  });
});
