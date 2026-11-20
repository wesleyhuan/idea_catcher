import type { Capture } from '@/lib/types';
import { matchesFilters, type Filters } from '@/lib/filters';

export const PAGE_SIZE = 50;

/** The loaded part of the Inbox, newest first; `hasMore` when older rows are still in the database. */
export type InboxList = { items: Capture[]; hasMore: boolean };

/** One database change, as the Inbox needs it (no Supabase types). */
export type CaptureChange = { kind: 'upsert'; row: Capture } | { kind: 'delete'; id: string };

/** Where the next page starts: everything that sorts after this row. */
export type PageCursor = Pick<Capture, 'captured_at' | 'id'>;

/**
 * PostgREST returns ISO timestamps ("2026-11-20T10:00:00.123+00:00"), but
 * Realtime can send Postgres's own text form ("2026-11-20 10:00:00.123+00").
 * Normalize so both parse.
 */
export function toTime(ts: string): number {
  return Date.parse(ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
}

/**
 * The Inbox order: newest captured_at first, then id descending, so no two
 * rows tie and a page cursor is never ambiguous. Negative when `a` comes first.
 * (Lowercase hex uuids compare as strings the same way Postgres compares uuids.)
 */
export function compareCaptures(a: PageCursor, b: PageCursor): number {
  const byTime = toTime(b.captured_at) - toTime(a.captured_at);
  if (byTime !== 0) return byTime;
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

/** Merges one realtime change (or a row we just wrote/re-read) into the loaded list. */
export function applyChange(list: InboxList, change: CaptureChange, filters: Filters): InboxList {
  const id = change.kind === 'delete' ? change.id : change.row.id;
  const items = list.items.filter((c) => c.id !== id);
  if (change.kind === 'delete' || !matchesFilters(change.row, filters)) return { ...list, items };

  // A row older than everything loaded belongs to a page we haven't fetched;
  // "Load more" will bring it, so adding it here would leave a gap before it.
  const last = items.at(-1);
  if (list.hasMore && last && compareCaptures(change.row, last) > 0) return { ...list, items };

  const at = items.findIndex((c) => compareCaptures(change.row, c) < 0);
  items.splice(at === -1 ? items.length : at, 0, change.row);
  return { ...list, items };
}

/** Appends the next page, skipping rows a realtime change already added. */
export function appendPage(list: InboxList, page: InboxList): InboxList {
  const seen = new Set(list.items.map((c) => c.id));
  return { items: [...list.items, ...page.items.filter((c) => !seen.has(c.id))], hasMore: page.hasMore };
}
