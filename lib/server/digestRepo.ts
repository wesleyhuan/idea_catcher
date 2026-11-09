import type { SupabaseClient } from '@supabase/supabase-js';
import type { Period } from '@/lib/types';
import type { DigestCapture } from '@/lib/ai/digest';

/** Identifies the set of processed captures a digest was built from. */
export type DigestSource = { count: number; latestUpdatedAt: string | null };
export type CachedDigest = { content_md: string; capture_count: number; source_updated_at: string | null };

export type DigestRepo = {
  sourceOf(from: string, to: string): Promise<DigestSource>;
  listProcessed(from: string, to: string): Promise<DigestCapture[]>;
  getCached(period: Period, periodStart: string): Promise<CachedDigest | null>;
  save(period: Period, periodStart: string, content_md: string, source: DigestSource): Promise<void>;
};

export function makeDigestRepo(db: SupabaseClient): DigestRepo {
  const processedIn = (columns: string, from: string, to: string, count = false) =>
    db.from('captures')
      .select(columns, count ? { count: 'exact' } : undefined)
      .eq('processing', 'done')
      .gte('captured_at', from)
      .lt('captured_at', to);

  return {
    async sourceOf(from, to) {
      // One request: `count` covers every matching row, `data` holds only the newest.
      const { data, count, error } = await processedIn('updated_at', from, to, true)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const rows = data as unknown as { updated_at: string }[];
      return { count: count ?? 0, latestUpdatedAt: rows[0]?.updated_at ?? null };
    },
    async listProcessed(from, to) {
      const { data, error } = await processedIn('type, title, summary, context, status, captured_at', from, to)
        .order('captured_at');
      if (error) throw error;
      return data as unknown as DigestCapture[];
    },
    async getCached(period, periodStart) {
      const { data, error } = await db.from('digests').select('content_md, capture_count, source_updated_at')
        .eq('period', period).eq('period_start', periodStart).maybeSingle();
      if (error) throw error;
      return data;
    },
    async save(period, periodStart, content_md, source) {
      const { error } = await db.from('digests').upsert(
        {
          period, period_start: periodStart, content_md,
          capture_count: source.count, source_updated_at: source.latestUpdatedAt,
        },
        { onConflict: 'user_id,period,period_start' },
      );
      if (error) throw error;
    },
  };
}
