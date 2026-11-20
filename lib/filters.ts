import type { Capture, CaptureContext, CaptureStatus, CaptureType } from '@/lib/types';

/** All three are applied in the database query; matchesFilters re-checks rows that arrive by realtime. */
export type Filters = {
  type: CaptureType | 'all';
  context: CaptureContext | 'all';
  status: CaptureStatus;
};

export const DEFAULT_FILTERS: Filters = { type: 'all', context: 'all', status: 'inbox' };

export function matchesFilters(c: Capture, { type, context, status }: Filters): boolean {
  return c.status === status
    && (type === 'all' || c.type === type)
    && (context === 'all' || c.context === context);
}
