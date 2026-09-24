import { describe, expect, it } from 'vitest';
import { CAPTURE_TYPES, CONTEXTS, EFFORTS, STATUSES, PERIODS } from '@/lib/types';

describe('shared enums match the SQL enums', () => {
  it('has the same values as 0001_init.sql', () => {
    expect(CAPTURE_TYPES).toEqual(['idea', 'todo', 'reminder', 'reference', 'question']);
    expect(CONTEXTS).toEqual(['laptop', 'phone', 'anywhere']);
    expect(EFFORTS).toEqual(['quick', 'medium', 'long']);
    expect(STATUSES).toEqual(['inbox', 'done', 'archived']);
    expect(PERIODS).toEqual(['day', 'week']);
  });
});
