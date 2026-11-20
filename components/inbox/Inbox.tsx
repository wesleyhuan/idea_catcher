'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { makeBrowserCaptureRepo, type CapturePatch } from '@/lib/client/captureRepo';
import { applyFilters, DEFAULT_FILTERS, type Filters } from '@/lib/filters';
import { postJson } from '@/lib/api';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';
import { FilterBar } from './FilterBar';
import { CaptureCard } from './CaptureCard';
import { CaptureDetail } from './CaptureDetail';
import { SpecPanel } from './SpecPanel';
import { DigestPanel } from './DigestPanel';

const log = logger('inbox');
const repo = () => makeBrowserCaptureRepo(createClient());
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const SEARCH_DELAY_MS = 250;

/** Returns `value` once it has stopped changing for `ms`, so typing doesn't send a query per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function Inbox() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useDebounced(filters.query.trim(), SEARCH_DELAY_MS);
  // Bumped on every load() call; a response that arrives after a newer load
  // started (e.g. the search text changed meanwhile) is discarded, so an older
  // search can't overwrite the results of the current one.
  const seq = useRef(0);

  const load = useCallback(async () => {
    // Callers (the realtime callback, update(), retry()) invoke this fire-and-forget,
    // so a rejection here must be caught locally rather than becoming an unhandled
    // promise rejection at every call site.
    const id = ++seq.current;
    try {
      const data = await repo().listByStatus(filters.status, { query });
      if (id !== seq.current) return;
      log.debug('loaded', { count: data.length, status: filters.status, searching: query !== '' });
      setCaptures(data);
    } catch (err) {
      log.error('load failed', { status: filters.status, err });
      if (id === seq.current) setError(errorMessage(err));
    }
  }, [filters.status, query]);

  useEffect(() => {
    // False positive: load() only calls setState after its first await (when the
    // query resolves), which is the "subscribe, then set state in a callback"
    // pattern the rule allows. The rule can't see through the async function.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return repo().subscribe(() => void load());
  }, [load]);

  async function update(id: string, patch: CapturePatch) {
    setError(null);
    try {
      await repo().update(id, patch);
    } catch (err) {
      log.error('update failed', { id, patch, err });
      setError(errorMessage(err));
      return;
    }
    if (patch.status) setSelectedId(null);
    await load();
  }

  async function remove(id: string) {
    setError(null);
    try {
      await repo().remove(id);
    } catch (err) {
      log.error('delete failed', { id, err });
      setError(errorMessage(err));
      return;
    }
    setSelectedId(null);
    await load();
  }

  async function retry(id: string) {
    setError(null);
    try {
      await postJson('/api/process', { id });
    } catch (err) {
      log.error('retry failed', { id, err });
      setError(errorMessage(err));
    }
    await load();
  }

  const visible = applyFilters(captures, filters);
  const selected = captures.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <DigestPanel />
      <FilterBar value={filters} onChange={setFilters} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2">
          {visible.length === 0 && (
            <li className="text-neutral-500">{query ? `No matches for "${query}"` : 'Nothing here 🎉'}</li>
          )}
          {visible.map((c) => (
            <CaptureCard key={c.id} capture={c} selected={c.id === selectedId}
              onSelect={() => setSelectedId(c.id)} onRetry={() => retry(c.id)} />
          ))}
        </ul>
        {selected && (
          <div className="md:sticky md:top-4 md:self-start">
            <CaptureDetail key={`${selected.id}:${selected.processing}`} capture={selected} onUpdate={(p) => update(selected.id, p)}
              onDelete={() => remove(selected.id)}
              specSlot={<SpecPanel capture={selected} onGenerated={() => void load()} />} />
          </div>
        )}
      </div>
    </div>
  );
}
