'use client';

import { useCallback, useEffect, useState } from 'react';
import { postJson } from '@/lib/api';
import { periodRange } from '@/lib/period';
import { Markdown } from '@/components/Markdown';
import type { Period } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('digest-panel');

export function DigestPanel() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('day');
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ content_md: string }>('/api/digest', periodRange(period));
      setContent(r.content_md);
    } catch (err) {
      log.error('digest failed', { period, err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [period]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const tab = (p: Period, label: string) => (
    <button onClick={() => setPeriod(p)}
      className={`rounded-lg px-3 py-1 ${period === p ? 'bg-amber-500 text-white' : 'border'}`}>{label}</button>
  );

  return (
    <details className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-medium">Digest</summary>
      <div className="mt-3 space-y-3">
        <div className="flex gap-2">{tab('day', 'Today')}{tab('week', 'This week')}</div>
        {busy && <p className="text-sm text-neutral-500">Summarizing…</p>}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error} <button className="underline" onClick={load}>Retry</button>
          </p>
        )}
        {!busy && content && <Markdown>{content}</Markdown>}
      </div>
    </details>
  );
}
