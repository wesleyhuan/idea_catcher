import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, type RateBucket } from '@/lib/rateLimit';
import { logger } from '@/lib/logger';
import type { ApiErrorCode } from '@/lib/api';

const log = logger('route');

export async function requireUser() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error) log.warn('getUser failed', { message: error.message });
  return user ? { db, user } : null;
}

// Error responses carry only a fixed code (see API_ERROR_MESSAGES in lib/api.ts).
// There is deliberately no free-text field: exception messages can contain
// internal details (SDK errors, database errors, stack info), so they go to the
// server log and never to the client.
export function jsonError(status: number, error: ApiErrorCode) {
  return NextResponse.json({ error }, { status });
}

/**
 * Counts this request against the user's limit. Returns the response to send
 * when it must stop here (429 over the limit, 500 if the count itself failed),
 * or null to carry on. Fails closed: without a working count, an AI route
 * could be called without limit.
 */
export async function enforceRateLimit(db: SupabaseClient, bucket: RateBucket): Promise<NextResponse | null> {
  try {
    return (await checkRateLimit(db, bucket)) ? null : jsonError(429, 'rate_limited');
  } catch (err) {
    log.error('rate limit check failed', { bucket, err });
    return jsonError(500, 'internal_error');
  }
}
