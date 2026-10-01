'use client';

import { useState, type ReactNode } from 'react';
import { CAPTURE_TYPES, CONTEXTS, EFFORTS, type Capture, type CaptureStatus } from '@/lib/types';
import { CONTEXT_LABELS, EFFORT_LABELS } from '@/lib/labels';
import { logger } from '@/lib/logger';

const log = logger('capture-detail');

export type CapturePatch = Partial<Pick<Capture,
  'title' | 'summary' | 'type' | 'context' | 'effort' | 'next_steps' | 'status' | 'user_edited' | 'processing'>>;

type Props = {
  capture: Capture;
  onUpdate: (patch: CapturePatch) => Promise<void>;
  specSlot?: ReactNode;
};

const field = 'w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-base dark:border-neutral-700';

export function CaptureDetail({ capture: c, onUpdate, specSlot }: Props) {
  const [draft, setDraft] = useState({
    title: c.title ?? '',
    summary: c.summary ?? '',
    type: c.type ?? 'idea',
    context: c.context ?? 'anywhere',
    effort: c.effort ?? 'quick',
    next_steps: c.next_steps.join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof draft) =>
    (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });

  async function run(patch: CapturePatch) {
    setBusy(true);
    try {
      await onUpdate(patch);
    } catch (err) {
      log.error('onUpdate failed', { id: c.id, patch, err });
    } finally {
      setBusy(false);
    }
  }

  const saveEdits = () => run({
    ...draft,
    next_steps: draft.next_steps.split('\n').map((s) => s.trim()).filter(Boolean),
    user_edited: true,
    processing: 'done',
  });
  const setStatus = (status: CaptureStatus) => run({ status });

  return (
    <div className="space-y-3">
      <input aria-label="Title" className={`${field} font-semibold`} value={draft.title} onChange={set('title')} />
      <textarea aria-label="Summary" rows={3} className={field} value={draft.summary} onChange={set('summary')} />
      <div className="grid grid-cols-3 gap-2">
        <select aria-label="Edit type" className={field} value={draft.type} onChange={set('type')}>
          {CAPTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Edit context" className={field} value={draft.context} onChange={set('context')}>
          {CONTEXTS.map((x) => <option key={x} value={x}>{CONTEXT_LABELS[x]}</option>)}
        </select>
        <select aria-label="Edit effort" className={field} value={draft.effort} onChange={set('effort')}>
          {EFFORTS.map((x) => <option key={x} value={x}>{EFFORT_LABELS[x]}</option>)}
        </select>
      </div>
      <label className="block text-sm text-neutral-500">
        Next steps (one per line)
        <textarea aria-label="Next steps" rows={3} className={field} value={draft.next_steps} onChange={set('next_steps')} />
      </label>
      <details className="text-sm text-neutral-500">
        <summary>Original capture</summary>
        <p className="mt-1 whitespace-pre-wrap">{c.raw_text}</p>
      </details>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={saveEdits} className="rounded-lg border px-3 py-1">Save edits</button>
        <button disabled={busy} onClick={() => setStatus('done')} className="rounded-lg bg-green-600 px-3 py-1 text-white">Done</button>
        <button disabled={busy} onClick={() => setStatus('archived')} className="rounded-lg border px-3 py-1">Archive</button>
        {c.status !== 'inbox' && (
          <button disabled={busy} onClick={() => setStatus('inbox')} className="rounded-lg border px-3 py-1">Back to inbox</button>
        )}
      </div>
      {specSlot}
    </div>
  );
}
