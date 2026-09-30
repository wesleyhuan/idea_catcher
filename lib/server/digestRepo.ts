import type { SupabaseClient } from '@supabase/supabase-js';
import type { Period } from '@/lib/types';
import type { DigestCapture } from '@/lib/ai/digest';

export type DigestRepo = {
  countProcessed(from: string, to: string): Promise<number>;
  listProcessed(from: string, to: string): Promise<DigestCapture[]>;
  getCached(period: Period, periodStart: string): Promise<{ content_md: string; capture_count: number } | null>;
  save(period: Period, periodStart: string, content_md: string, captureCount: number): Promise<void>;
};

export function makeDigestRepo(db: SupabaseClient): DigestRepo {
  const processedIn = (columns: string, from: string, to: string, head = false) =>
    db.from('captures')
      .select(columns, head ? { count: 'exact', head: true } : undefined)
      .eq('processing', 'done')
      .gte('captured_at', from)
      .lt('captured_at', to);

  return {
    async countProcessed(from, to) {
      const { count, error } = await processedIn('id', from, to, true);
      if (error) throw error;
      return count ?? 0;
    },
    async listProcessed(from, to) {
      const { data, error } = await processedIn('type, title, summary, context, status, captured_at', from, to)
        .order('captured_at');
      if (error) throw error;
      return data as unknown as DigestCapture[];
    },
    async getCached(period, periodStart) {
      const { data, error } = await db.from('digests').select('content_md, capture_count')
        .eq('period', period).eq('period_start', periodStart).maybeSingle();
      if (error) throw error;
      return data;
    },
    async save(period, periodStart, content_md, captureCount) {
      const { error } = await db.from('digests').upsert(
        { period, period_start: periodStart, content_md, capture_count: captureCount },
        { onConflict: 'user_id,period,period_start' },
      );
      if (error) throw error;
    },
  };
}
