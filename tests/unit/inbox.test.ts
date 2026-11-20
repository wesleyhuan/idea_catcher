import { describe, expect, it } from 'vitest';
import { appendPage, applyChange, compareCaptures, toTime, type InboxList } from '@/lib/inbox';
import { DEFAULT_FILTERS } from '@/lib/filters';
import type { Capture } from '@/lib/types';

/** A capture at minute `min` of a fixed hour; higher minutes are newer. */
const cap = (id: string, min: number, over: Partial<Capture> = {}) => ({
  id, status: 'inbox', type: 'idea', context: 'laptop',
  captured_at: `2026-11-20T10:${String(min).padStart(2, '0')}:00+00:00`, ...over,
} as Capture);
const ids = (l: InboxList) => l.items.map((c) => c.id);
const upsert = (row: Capture) => ({ kind: 'upsert' as const, row });

describe('toTime', () => {
  it('reads PostgREST and Realtime timestamp forms as the same instant', () => {
    expect(toTime('2026-11-20 10:00:00.123+00')).toBe(toTime('2026-11-20T10:00:00.123+00:00'));
    expect(toTime('2026-11-20 18:00:00+08')).toBe(toTime('2026-11-20T10:00:00Z'));
  });
});

describe('compareCaptures', () => {
  it('puts newer first and breaks a captured_at tie by id, descending', () => {
    expect(compareCaptures(cap('a', 2), cap('b', 1))).toBeLessThan(0);
    expect(compareCaptures(cap('a', 1), cap('b', 1))).toBeGreaterThan(0);
    expect(compareCaptures(cap('b', 1), cap('a', 1))).toBeLessThan(0);
  });
});

describe('applyChange', () => {
  const list: InboxList = { items: [cap('c', 30), cap('b', 20), cap('a', 10)], hasMore: false };

  it('inserts a new row in order', () => {
    expect(ids(applyChange(list, upsert(cap('n', 25)), DEFAULT_FILTERS))).toEqual(['c', 'n', 'b', 'a']);
    expect(ids(applyChange(list, upsert(cap('n', 40)), DEFAULT_FILTERS))).toEqual(['n', 'c', 'b', 'a']);
    expect(ids(applyChange(list, upsert(cap('n', 5)), DEFAULT_FILTERS))).toEqual(['c', 'b', 'a', 'n']);
  });

  it('replaces an updated row in place', () => {
    const next = applyChange(list, upsert(cap('b', 20, { title: 'new' })), DEFAULT_FILTERS);
    expect(ids(next)).toEqual(['c', 'b', 'a']);
    expect(next.items[1].title).toBe('new');
  });

  it('removes a row that no longer matches the filters (e.g. marked done)', () => {
    expect(ids(applyChange(list, upsert(cap('b', 20, { status: 'done' })), DEFAULT_FILTERS))).toEqual(['c', 'a']);
  });

  it('ignores a new row that does not match the filters', () => {
    expect(ids(applyChange(list, upsert(cap('n', 25, { type: 'todo' })), { ...DEFAULT_FILTERS, type: 'idea' })))
      .toEqual(['c', 'b', 'a']);
  });

  it('removes a deleted row and ignores unknown ids', () => {
    expect(ids(applyChange(list, { kind: 'delete', id: 'b' }, DEFAULT_FILTERS))).toEqual(['c', 'a']);
    expect(ids(applyChange(list, { kind: 'delete', id: 'zzz' }, DEFAULT_FILTERS))).toEqual(['c', 'b', 'a']);
  });

  it('leaves a row older than the loaded pages to "Load more" when more pages exist', () => {
    const partial = { ...list, hasMore: true };
    expect(ids(applyChange(partial, upsert(cap('old', 5)), DEFAULT_FILTERS))).toEqual(['c', 'b', 'a']);
    // ...but a row inside the loaded range is still merged.
    expect(ids(applyChange(partial, upsert(cap('n', 15)), DEFAULT_FILTERS))).toEqual(['c', 'b', 'n', 'a']);
  });

  it('does not mutate the list it was given', () => {
    const before = ids(list);
    applyChange(list, upsert(cap('n', 25)), DEFAULT_FILTERS);
    expect(ids(list)).toEqual(before);
  });
});

describe('appendPage', () => {
  it('appends the next page, skipping rows already shown, and takes its hasMore', () => {
    const shown: InboxList = { items: [cap('c', 30), cap('b', 20)], hasMore: true };
    const page: InboxList = { items: [cap('b', 20), cap('a', 10)], hasMore: false };
    expect(appendPage(shown, page)).toEqual({ items: [cap('c', 30), cap('b', 20), cap('a', 10)], hasMore: false });
  });
});
