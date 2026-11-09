'use client';

import { useEffect, useState } from 'react';
import { useSync } from '@/components/SyncProvider';
import { createClient } from '@/lib/supabase/browser';
import { makeBrowserCaptureRepo, type RecentCapture } from '@/lib/client/captureRepo';
import { TYPE_ICONS, timeAgo } from '@/lib/labels';
import { logger } from '@/lib/logger';

const log = logger('recent');

export function RecentCaptures() {
  const { pendingItems, lastSyncAt } = useSync();
  const [rows, setRows] = useState<RecentCapture[]>([]);

  useEffect(() => {
    makeBrowserCaptureRepo(createClient()).listRecent(5)
      .then(setRows)
      .catch((err) => log.error('load failed', { err }));
  }, [lastSyncAt]);

  return (
    <ul className="mt-8 space-y-2 text-sm">
      {pendingItems.map((i) => (
        <li key={i.client_id} className="truncate text-neutral-400">⏳ {i.raw_text}</li>
      ))}
      {rows.map((r) => (
        <li key={r.id} className="flex gap-2">
          <span>{r.type ? TYPE_ICONS[r.type] : '…'}</span>
          <span className="flex-1 truncate">{r.title ?? r.raw_text}</span>
          <span className="text-neutral-400">{timeAgo(r.captured_at)}</span>
        </li>
      ))}
    </ul>
  );
}
