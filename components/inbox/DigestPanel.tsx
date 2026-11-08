'use client';

import { useRef, useState } from 'react';
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
  // Bumped on every load() call; a stale in-flight response is discarded if a
  // newer one (tab switch, retry) has since started, so it can't overwrite
  // the current tab's content/error after the fact.
  const seq = useRef(0);

  // Loading is triggered from the event handlers (open toggle, tab click, retry)
  // rather than an effect watching `open`/`period`: the fetch is a response to a
  // user action, so doing it there avoids an extra render pass per change.
  async function load(p: Period) {
    const id = ++seq.current;
    setContent(null);
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ content_md: string }>('/api/digest', periodRange(p));
      if (id === seq.current) setContent(r.content_md);
    } catch (err) {
      log.error('digest failed', { period: p, err });
      if (id === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }

  function selectPeriod(p: Period) {
    if (p === period) return;
    setPeriod(p);
    if (open) void load(p);
  }

  function toggle(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen) void load(period);
  }

  const tab = (p: Period, label: string) => (
    <button onClick={() => selectPeriod(p)}
      className={`rounded-lg px-3 py-1 ${period === p ? 'bg-amber-500 text-white' : 'border'}`}>{label}</button>
  );

  return (
    <details className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
      onToggle={(e) => toggle((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-medium">Digest</summary>
      <div className="mt-3 space-y-3">
        <div className="flex gap-2">{tab('day', 'Today')}{tab('week', 'This week')}</div>
        {busy && <p className="text-sm text-neutral-500">Summarizing…</p>}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error} <button className="underline" onClick={() => void load(period)}>Retry</button>
          </p>
        )}
        {!busy && content && <Markdown>{content}</Markdown>}
      </div>
    </details>
  );
}
