'use client';

import type { Capture } from '@/lib/types';
import { EFFORT_LABELS, TYPE_ICONS, timeAgo } from '@/lib/labels';

type Props = { capture: Capture; selected: boolean; onSelect: () => void; onRetry: () => void };

export function CaptureCard({ capture: c, selected, onSelect, onRetry }: Props) {
  const processed = c.processing === 'done';
  return (
    <li data-testid="capture-card" data-processing={c.processing}
      className={`cursor-pointer rounded-xl border p-3 ${selected ? 'border-amber-500' : 'border-neutral-200 dark:border-neutral-800'}`}
      onClick={onSelect}>
      <div className="flex items-start gap-2">
        <span>{c.type ? TYPE_ICONS[c.type] : '⏳'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{processed ? c.title : c.raw_text}</p>
          {processed && <p className="line-clamp-2 text-sm text-neutral-500">{c.summary}</p>}
          {c.processing === 'failed' && (
            <button className="mt-1 text-sm text-red-600 underline"
              onClick={(e) => { e.stopPropagation(); onRetry(); }}>
              Processing failed — Retry
            </button>
          )}
        </div>
        <div className="shrink-0 text-right text-xs text-neutral-400">
          {c.effort && <div>{EFFORT_LABELS[c.effort]}</div>}
          <div>{timeAgo(c.captured_at)}</div>
        </div>
      </div>
    </li>
  );
}
