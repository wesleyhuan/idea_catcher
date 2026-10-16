'use client';

import { useCallback, useEffect, useState } from 'react';
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
      const data = await repo().listByStatus(filters.status);
      log.debug('loaded', { count: data.length, status: filters.status });
      setCaptures(data);
    } catch (err) {
      log.error('load failed', { status: filters.status, err });
      setError(errorMessage(err));
    }
  }, [filters.status]);

  useEffect(() => {
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
          {visible.length === 0 && <li className="text-neutral-500">Nothing here 🎉</li>}
          {visible.map((c) => (
            <CaptureCard key={c.id} capture={c} selected={c.id === selectedId}
              onSelect={() => setSelectedId(c.id)} onRetry={() => retry(c.id)} />
          ))}
        </ul>
        {selected && (
          <div className="md:sticky md:top-4 md:self-start">
            <CaptureDetail key={`${selected.id}:${selected.processing}`} capture={selected} onUpdate={(p) => update(selected.id, p)}
              specSlot={<SpecPanel capture={selected} onGenerated={() => void load()} />} />
          </div>
        )}
      </div>
    </div>
  );
}
