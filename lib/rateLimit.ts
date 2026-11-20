import type { SupabaseClient } from '@supabase/supabase-js';

export type RateBucket = 'process' | 'spec' | 'digest';

/** Requests per user per minute. Buckets must match check_rate_limit (migration 0006). */
export const RATE_LIMITS: Record<RateBucket, number> = { process: 60, spec: 10, digest: 10 };
const WINDOW_SECONDS = 60;

/** Thrown where a limit is checked deep inside a call (digest generation) instead of up front. */
export class RateLimitedError extends Error {
  constructor(bucket: RateBucket) {
    super(`rate limited: ${bucket}`);
    this.name = 'RateLimitedError';
  }
}

/**
 * Counts one request for the signed-in user and returns whether it is within
 * the limit. Counted in Postgres, so every server instance shares the count.
 */
export async function checkRateLimit(db: SupabaseClient, bucket: RateBucket): Promise<boolean> {
  const { data, error } = await db.rpc('check_rate_limit', {
    p_bucket: bucket,
    p_limit: RATE_LIMITS[bucket],
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error) throw error;
  return data === true;
}
