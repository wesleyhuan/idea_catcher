import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capture, CaptureStatus } from '@/lib/types';
import type { OutboxItem } from '@/lib/outbox';

/** Fields the Inbox may change on a capture. */
export type CapturePatch = Partial<Pick<Capture,
  'title' | 'summary' | 'type' | 'context' | 'effort' | 'next_steps' | 'status' | 'user_edited' | 'processing'>>;

export type RecentCapture = Pick<Capture, 'id' | 'raw_text' | 'title' | 'type' | 'captured_at'>;

/**
 * Every browser-side read and write of `captures`. RLS limits all of them to
 * the signed-in user, so none filter by user_id.
 */
export type BrowserCaptureRepo = {
  listByStatus(status: CaptureStatus, limit?: number): Promise<Capture[]>;
  listRecent(limit: number): Promise<RecentCapture[]>;
  /** Ids still worth auto-processing: pending or failed, under `maxAttempts`. */
  listUnprocessed(maxAttempts: number): Promise<string[]>;
  update(id: string, patch: CapturePatch): Promise<void>;
  /** Idempotent on (user_id, client_id); returns the row ids. */
  upsertOutbox(userId: string, items: OutboxItem[]): Promise<string[]>;
  /** Calls `onChange` on any insert/update/delete; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
};

export function makeBrowserCaptureRepo(db: SupabaseClient): BrowserCaptureRepo {
  const captures = () => db.from('captures');
  const check = ({ error }: { error: unknown }) => {
    if (error) throw error;
  };

  return {
    async listByStatus(status, limit = 200) {
      const { data, error } = await captures().select('*')
        .eq('status', status)
        .order('captured_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as Capture[];
    },
    async listRecent(limit) {
      const { data, error } = await captures().select('id, raw_text, title, type, captured_at')
        .order('captured_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as RecentCapture[];
    },
    async listUnprocessed(maxAttempts) {
      const { data, error } = await captures().select('id')
        .in('processing', ['pending', 'failed'])
        .lt('processing_attempts', maxAttempts);
      if (error) throw error;
      return data.map((r) => r.id as string);
    },
    async update(id, patch) {
      check(await captures().update(patch).eq('id', id));
    },
    async upsertOutbox(userId, items) {
      const { data, error } = await captures()
        .upsert(
          items.map(({ client_id, raw_text, captured_at }) => ({ client_id, raw_text, captured_at, user_id: userId })),
          { onConflict: 'user_id,client_id' },
        )
        .select('id');
      if (error) throw error;
      return data.map((r) => r.id as string);
    },
    subscribe(onChange) {
      // A unique topic per call avoids reusing an already-subscribed channel:
      // removeChannel() below isn't awaited, so on a fast remount (status filter
      // change, or React 19 StrictMode) db.channel('captures-inbox') could still
      // return the old, already-joined channel — and .on() throws after subscribe().
      const channel = db
        .channel(`captures-inbox-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'captures' }, onChange)
        .subscribe();
      return () => {
        void db.removeChannel(channel);
      };
    },
  };
}
