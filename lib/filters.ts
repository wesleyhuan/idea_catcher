import type { Capture, CaptureContext, CaptureStatus, CaptureType } from '@/lib/types';

export type Filters = {
  type: CaptureType | 'all';
  context: CaptureContext | 'all';
  status: CaptureStatus; // applied in the database query
};

export const DEFAULT_FILTERS: Filters = { type: 'all', context: 'all', status: 'inbox' };

export function applyFilters(captures: Capture[], { type, context }: Filters): Capture[] {
  return captures.filter((c) =>
    (type === 'all' || c.type === type) && (context === 'all' || c.context === context));
}
