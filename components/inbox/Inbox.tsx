'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { makeBrowserCaptureRepo, type CapturePatch } from '@/lib/client/captureRepo';
import { DEFAULT_FILTERS, type Filters } from '@/lib/filters';
import { appendPage, applyChange, PAGE_SIZE, type CaptureChange, type InboxList } from '@/lib/inbox';
import { postJson } from '@/lib/api';
import { logger } from '@/lib/logger';
import { FilterBar } from './FilterBar';
import { CaptureCard } from './CaptureCard';
import { CaptureDetail } from './CaptureDetail';
import { SpecPanel } from './SpecPanel';
import { DigestPanel } from './DigestPanel';

const log = logger('inbox');
const repo = () => makeBrowserCaptureRepo(createClient());
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const EMPTY: InboxList = { items: [], hasMore: false };

export function Inbox() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [list, setList] = useState<InboxList>(EMPTY);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every first-page load; a page that resolves after the filters
  // changed (or a newer reload started) is dropped instead of overwriting.
  const seq = useRef(0);

  const merge = useCallback(
    (change: CaptureChange) => setList((l) => applyChange(l, change, filters)),
    [filters],
  );

  const reload = useCallback(async () => {
    // Callers (the effect, a realtime resync) invoke this fire-and-forget, so a
    // rejection must be caught here rather than become an unhandled rejection.
    const id = ++seq.current;
    try {
      const page = await repo().listPage(filters, { limit: PAGE_SIZE });
      if (id !== seq.current) return;
      log.debug('loaded', { count: page.items.length, hasMore: page.hasMore, filters });
      setList(page);
    } catch (err) {
      log.error('load failed', { filters, err });
      if (id === seq.current) setError(errorMessage(err));
    }
  }, [filters]);

  useEffect(() => {
    // False positive: reload() only calls setState after its first await (when the
    // query resolves), which is the "subscribe, then set state in a callback"
    // pattern the rule allows. The rule can't see through the async function.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return repo().subscribe(merge, () => void reload());
  }, [reload, merge]);

  async function loadMore() {
    const last = list.items.at(-1);
    if (!last) return;
    const id = seq.current;
    setLoadingMore(true);
    try {
      const page = await repo().listPage(filters, { limit: PAGE_SIZE, after: last });
      if (id === seq.current) setList((l) => appendPage(l, page));
    } catch (err) {
      log.error('load more failed', { filters, err });
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  /** Re-reads one row after a server-side change (AI processing, spec) instead of the whole list. */
  async function refresh(id: string) {
    try {
      const row = await repo().get(id);
      merge(row ? { kind: 'upsert', row } : { kind: 'delete', id });
    } catch (err) {
      log.error('refresh failed', { id, err });
    }
  }

  async function update(id: string, patch: CapturePatch) {
    setError(null);
    try {
      merge({ kind: 'upsert', row: await repo().update(id, patch) });
    } catch (err) {
      log.error('update failed', { id, patch, err });
      setError(errorMessage(err));
      return;
    }
    if (patch.status) setSelectedId(null);
  }

  async function retry(id: string) {
    setError(null);
    try {
      await postJson('/api/process', { id });
    } catch (err) {
      log.error('retry failed', { id, err });
      setError(errorMessage(err));
    }
    await refresh(id);
  }

  const selected = list.items.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <DigestPanel />
      <FilterBar value={filters} onChange={setFilters} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2">
          {list.items.length === 0 && <li className="text-neutral-500">Nothing here 🎉</li>}
          {list.items.map((c) => (
            <CaptureCard key={c.id} capture={c} selected={c.id === selectedId}
              onSelect={() => setSelectedId(c.id)} onRetry={() => retry(c.id)} />
          ))}
          {list.hasMore && (
            <li>
              <button onClick={loadMore} disabled={loadingMore}
                className="w-full rounded-lg border px-3 py-2 text-sm text-neutral-500 disabled:opacity-50">
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </li>
          )}
        </ul>
        {selected && (
          <div className="md:sticky md:top-4 md:self-start">
            <CaptureDetail key={`${selected.id}:${selected.processing}`} capture={selected} onUpdate={(p) => update(selected.id, p)}
              specSlot={<SpecPanel capture={selected} onGenerated={() => void refresh(selected.id)} />} />
          </div>
        )}
      </div>
    </div>
  );
}
