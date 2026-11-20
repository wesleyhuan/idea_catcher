import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';
import type { Capture } from '@/lib/types';
import type { OutboxItem } from '@/lib/outbox';
import type { Filters } from '@/lib/filters';
import type { CaptureChange, InboxList, PageCursor } from '@/lib/inbox';

/** Fields the Inbox may change on a capture. */
export type CapturePatch = Partial<Pick<Capture,
  'title' | 'summary' | 'type' | 'context' | 'effort' | 'next_steps' | 'status' | 'user_edited' | 'processing'>>;

export type RecentCapture = Pick<Capture, 'id' | 'raw_text' | 'title' | 'type' | 'captured_at'>;

/**
 * Every browser-side read and write of `captures`. RLS limits all of them to
 * the signed-in user, so none filter by user_id.
 */
export type BrowserCaptureRepo = {
  /** One page of the Inbox order (see compareCaptures), starting after `after` when given. */
  listPage(filters: Filters, opts: { limit: number; after?: PageCursor }): Promise<InboxList>;
  get(id: string): Promise<Capture | null>;
  listRecent(limit: number): Promise<RecentCapture[]>;
  /** Ids still worth auto-processing: pending or failed, under `maxAttempts`. */
  listUnprocessed(maxAttempts: number): Promise<string[]>;
  /** Returns the row as saved. */
  update(id: string, patch: CapturePatch): Promise<Capture>;
  /** Idempotent on (user_id, client_id); returns the row ids. */
  upsertOutbox(userId: string, items: OutboxItem[]): Promise<string[]>;
  /**
   * Calls `onChange` with each insert/update/delete; returns an unsubscribe
   * function. `onResync` runs after a reconnect, when events may have been missed.
   */
  subscribe(onChange: (change: CaptureChange) => void, onResync?: () => void): () => void;
};

/**
 * Supabase returns errors as plain `{ message, code, ... }` objects, not Error
 * instances, so callers doing `err instanceof Error ? err.message : …` would
 * show "[object Object]". Wrap them, keeping the original as `cause`.
 */
function toError(error: { message?: string }): Error {
  return error instanceof Error ? error : new Error(error.message ?? 'Unknown Supabase error', { cause: error });
}

/**
 * PostgREST filter for "sorts after `c`" in the Inbox order (captured_at desc,
 * id desc). Values are double-quoted because timestamps contain `:` and `+`.
 */
export function afterCursor(c: PageCursor): string {
  const at = `"${c.captured_at}"`;
  return `captured_at.lt.${at},and(captured_at.eq.${at},id.lt.${c.id})`;
}

function toChange(payload: RealtimePostgresChangesPayload<Capture>): CaptureChange | null {
  if (payload.eventType === 'DELETE') {
    // With RLS on, a delete carries only the primary key.
    return payload.old.id ? { kind: 'delete', id: payload.old.id } : null;
  }
  return { kind: 'upsert', row: payload.new };
}

export function makeBrowserCaptureRepo(db: SupabaseClient): BrowserCaptureRepo {
  const captures = () => db.from('captures');

  return {
    async listPage({ status, type, context }, { limit, after }) {
      let query = captures().select('*').eq('status', status);
      if (type !== 'all') query = query.eq('type', type);
      if (context !== 'all') query = query.eq('context', context);
      if (after) query = query.or(afterCursor(after));
      // One extra row tells us whether another page exists without a count query.
      const { data, error } = await query
        .order('captured_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (error) throw toError(error);
      const rows = data as Capture[];
      return { items: rows.slice(0, limit), hasMore: rows.length > limit };
    },
    async get(id) {
      const { data, error } = await captures().select('*').eq('id', id).maybeSingle();
      if (error) throw toError(error);
      return data as Capture | null;
    },
    async listRecent(limit) {
      const { data, error } = await captures().select('id, raw_text, title, type, captured_at')
        .order('captured_at', { ascending: false })
        .limit(limit);
      if (error) throw toError(error);
      return data as RecentCapture[];
    },
    async listUnprocessed(maxAttempts) {
      const { data, error } = await captures().select('id')
        .in('processing', ['pending', 'failed'])
        .lt('processing_attempts', maxAttempts);
      if (error) throw toError(error);
      return data.map((r) => r.id as string);
    },
    async update(id, patch) {
      const { data, error } = await captures().update(patch).eq('id', id).select('*').single();
      if (error) throw toError(error);
      return data as Capture;
    },
    async upsertOutbox(userId, items) {
      const { data, error } = await captures()
        .upsert(
          items.map(({ client_id, raw_text, captured_at }) => ({ client_id, raw_text, captured_at, user_id: userId })),
          { onConflict: 'user_id,client_id' },
        )
        .select('id');
      if (error) throw toError(error);
      return data.map((r) => r.id as string);
    },
    subscribe(onChange, onResync) {
      // A unique topic per call avoids reusing an already-subscribed channel:
      // removeChannel() below isn't awaited, so on a fast remount (status filter
      // change, or React 19 StrictMode) db.channel('captures-inbox') could still
      // return the old, already-joined channel — and .on() throws after subscribe().
      let joined = false;
      const channel = db
        .channel(`captures-inbox-${crypto.randomUUID()}`)
        .on<Capture>('postgres_changes', { event: '*', schema: 'public', table: 'captures' }, (payload) => {
          const change = toChange(payload);
          if (change) onChange(change);
        })
        .subscribe((status) => {
          // The first SUBSCRIBED is the initial join; any later one is a reconnect.
          if (status !== 'SUBSCRIBED') return;
          if (joined) onResync?.();
          joined = true;
        });
      return () => {
        void db.removeChannel(channel);
      };
    },
  };
}
