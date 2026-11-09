import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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
