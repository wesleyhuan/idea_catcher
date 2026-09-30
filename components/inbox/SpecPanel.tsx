'use client';

import { useState } from 'react';
import { postJson } from '@/lib/api';
import { Markdown } from '@/components/Markdown';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('spec-panel');

export function SpecPanel({ capture, onGenerated }: { capture: Capture; onGenerated: () => void }) {
  const [spec, setSpec] = useState(capture.spec_md);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { spec_md } = await postJson<{ spec_md: string }>('/api/spec', { id: capture.id });
      setSpec(spec_md);
      onGenerated();
    } catch (err) {
      log.error('spec generation failed', { id: capture.id, err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(spec ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      log.error('clipboard write failed', { err });
      setError('Could not copy — select the text manually.');
    }
  }

  return (
    <section className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex gap-2">
        <button disabled={busy} onClick={generate} className="rounded-lg bg-amber-500 px-3 py-1 text-white disabled:opacity-50">
          {busy ? 'Generating…' : spec ? 'Regenerate spec' : 'Generate spec'}
        </button>
        {spec && <button onClick={copy} className="rounded-lg border px-3 py-1">{copied ? 'Copied ✓' : 'Copy'}</button>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error} <button className="underline" onClick={generate}>Retry</button>
        </p>
      )}
      {spec && <Markdown>{spec}</Markdown>}
    </section>
  );
}
