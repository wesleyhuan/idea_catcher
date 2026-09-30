'use client';

import { useEffect, useRef, useState } from 'react';
import { useSync } from '@/components/SyncProvider';
import { logger } from '@/lib/logger';

const log = logger('capture');

export function CaptureBox() {
  const { save, pendingItems } = useSync();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // Laptop: focuses immediately. iOS only opens the keyboard after a tap.
  useEffect(() => box.current?.focus(), []);

  async function submit() {
    if (saving) return; // prevents a double tap creating two captures
    setSaving(true);
    try {
      const ok = await save(text);
      if (!ok) return;
      setText('');
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      box.current?.focus();
    } catch (err) {
      // Keep the typed text so nothing is lost (e.g. IndexedDB unavailable
      // in iOS Safari private mode, or quota exceeded).
      log.error('save failed', { err });
      setError("Couldn't save on this device — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <textarea ref={box} aria-label="Capture" rows={6} value={text}
        placeholder="What's on your mind? 想到什麼就說…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
        className="w-full resize-none rounded-xl border border-neutral-300 bg-transparent p-4 text-lg dark:border-neutral-700" />
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={saving || !text.trim()}
          className="rounded-xl bg-amber-500 px-6 py-3 font-medium text-white disabled:opacity-40">
          Save
        </button>
        {saved && <span className="text-green-600">Saved ✓</span>}
        {error && <span className="text-red-600">{error}</span>}
        {pendingItems.length > 0 && (
          <span className="ml-auto text-sm text-neutral-500">{pendingItems.length} waiting to sync</span>
        )}
      </div>
    </div>
  );
}
