import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

const log = logger('route');

export async function requireUser() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error) log.warn('getUser failed', { message: error.message });
  return user ? { db, user } : null;
}

export function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json({ error, detail }, { status });
}
