'use client';

import { useEffect, useState } from 'react';
import { useSync } from '@/components/SyncProvider';
import { createClient } from '@/lib/supabase/browser';
import { TYPE_ICONS, timeAgo } from '@/lib/labels';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('recent');
type Row = Pick<Capture, 'id' | 'raw_text' | 'title' | 'type' | 'captured_at'>;

export function RecentCaptures() {
  const { pendingItems, lastSyncAt } = useSync();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    createClient()
      .from('captures')
      .select('id, raw_text, title, type, captured_at')
      .order('captured_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (error) log.error('load failed', { message: error.message });
        else setRows(data as Row[]);
      });
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
