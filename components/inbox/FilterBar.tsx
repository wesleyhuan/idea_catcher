'use client';

import { CAPTURE_TYPES, CONTEXTS, STATUSES } from '@/lib/types';
import type { Filters } from '@/lib/filters';

const select = 'rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-base dark:border-neutral-700';

export function FilterBar({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <select aria-label="Type" className={select} value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value as Filters['type'] })}>
        <option value="all">All types</option>
        {CAPTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select aria-label="Context" className={select} value={value.context}
        onChange={(e) => onChange({ ...value, context: e.target.value as Filters['context'] })}>
        <option value="all">All contexts</option>
        {CONTEXTS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="Status" className={select} value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as Filters['status'] })}>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
