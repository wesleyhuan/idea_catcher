import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, matchesFilters } from '@/lib/filters';
import type { Capture } from '@/lib/types';

const c = (type: Capture['type'], context: Capture['context'], status: Capture['status'] = 'inbox') =>
  ({ id: 'x', type, context, status } as Capture);

describe('matchesFilters', () => {
  it('matches everything in the status by default, including unprocessed', () => {
    expect(matchesFilters(c('idea', 'laptop'), DEFAULT_FILTERS)).toBe(true);
    expect(matchesFilters(c(null, null), DEFAULT_FILTERS)).toBe(true);
  });
  it('rejects another status', () => {
    expect(matchesFilters(c('idea', 'laptop', 'done'), DEFAULT_FILTERS)).toBe(false);
  });
  it('filters by type and hides unprocessed', () => {
    const f = { ...DEFAULT_FILTERS, type: 'idea' as const };
    expect(matchesFilters(c('idea', 'laptop'), f)).toBe(true);
    expect(matchesFilters(c('todo', 'laptop'), f)).toBe(false);
    expect(matchesFilters(c(null, null), f)).toBe(false);
  });
  it('filters by context', () => {
    const f = { ...DEFAULT_FILTERS, context: 'phone' as const };
    expect(matchesFilters(c('todo', 'phone'), f)).toBe(true);
    expect(matchesFilters(c('todo', 'laptop'), f)).toBe(false);
  });
});
