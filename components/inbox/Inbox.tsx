'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { applyFilters, DEFAULT_FILTERS, type Filters } from '@/lib/filters';
import { postJson } from '@/lib/api';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';
import { FilterBar } from './FilterBar';
import { CaptureCard } from './CaptureCard';
import { CaptureDetail, type CapturePatch } from './CaptureDetail';
import { SpecPanel } from './SpecPanel';

const log = logger('inbox');

export function Inbox() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Callers (the realtime callback, update(), retry()) invoke this fire-and-forget,
    // so a rejection here must be caught locally rather than becoming an unhandled
    // promise rejection at every call site.
    try {
      const { data, error } = await createClient()
        .from('captures')
        .select('*')
        .eq('status', filters.status)
        .order('captured_at', { ascending: false })
        .limit(200);
      if (error) {
        log.error('load failed', { status: filters.status, message: error.message });
        setError(error.message);
        return;
      }
      log.debug('loaded', { count: data.length, status: filters.status });
      setCaptures(data as Capture[]);
    } catch (err) {
      log.error('load rejected', { status: filters.status, err });
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filters.status]);

  useEffect(() => {
    void load();
    const supabase = createClient();
    // A unique topic per effect run avoids reusing an already-subscribed channel:
    // removeChannel() in cleanup isn't awaited, so on a fast remount (status filter
    // change, or React 19 StrictMode) supabase.channel('captures-inbox') could still
    // return the old, already-joined channel — and .on() throws after subscribe().
    const channel = supabase
      .channel(`captures-inbox-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'captures' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function update(id: string, patch: CapturePatch) {
    setError(null);
    const { error } = await createClient().from('captures').update(patch).eq('id', id);
    if (error) {
      log.error('update failed', { id, patch, message: error.message });
      setError(error.message);
      return;
    }
    if (patch.status) setSelectedId(null);
    await load();
  }

  async function retry(id: string) {
    setError(null);
    try {
      await postJson('/api/process', { id });
    } catch (err) {
      log.error('retry failed', { id, err });
      setError(err instanceof Error ? err.message : String(err));
    }
    await load();
  }

  const visible = applyFilters(captures, filters);
  const selected = captures.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <FilterBar value={filters} onChange={setFilters} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2">
          {visible.length === 0 && <li className="text-neutral-500">Nothing here 🎉</li>}
          {visible.map((c) => (
            <CaptureCard key={c.id} capture={c} selected={c.id === selectedId}
              onSelect={() => setSelectedId(c.id)} onRetry={() => retry(c.id)} />
          ))}
        </ul>
        {selected && (
          <div className="md:sticky md:top-4 md:self-start">
            <CaptureDetail key={selected.id} capture={selected} onUpdate={(p) => update(selected.id, p)}
              specSlot={<SpecPanel capture={selected} onGenerated={() => void load()} />} />
          </div>
        )}
      </div>
    </div>
  );
}
