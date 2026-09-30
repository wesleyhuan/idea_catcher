import { describe, expect, it } from 'vitest';
import { applyFilters, DEFAULT_FILTERS } from '@/lib/filters';
import type { Capture } from '@/lib/types';

const c = (id: string, type: Capture['type'], context: Capture['context']) =>
  ({ id, type, context } as Capture);
const list = [c('1', 'idea', 'laptop'), c('2', 'todo', 'phone'), c('3', null, null)];

describe('applyFilters', () => {
  it('returns everything by default, including unprocessed', () => {
    expect(applyFilters(list, DEFAULT_FILTERS).map((x) => x.id)).toEqual(['1', '2', '3']);
  });
  it('filters by type and hides unprocessed', () => {
    expect(applyFilters(list, { ...DEFAULT_FILTERS, type: 'idea' }).map((x) => x.id)).toEqual(['1']);
  });
  it('filters by context', () => {
    expect(applyFilters(list, { ...DEFAULT_FILTERS, context: 'phone' }).map((x) => x.id)).toEqual(['2']);
  });
});
