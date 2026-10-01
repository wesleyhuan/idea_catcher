import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireUser } from '@/lib/server/route';
import { checkRateLimit } from '@/lib/rateLimit';
import { makeDigestRepo } from '@/lib/server/digestRepo';
import { getOrCreateDigest } from '@/lib/server/digest';
import { PERIODS } from '@/lib/types';
import { logger } from '@/lib/logger';

// ≥ 2 × per-attempt timeout + backoff (SDK retries timeouts once)
export const maxDuration = 200;
const log = logger('api/digest');
const Body = z.object({
  period: z.enum(PERIODS),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return jsonError(401, 'unauthorized');
  if (!checkRateLimit(`digest:${auth.user.id}`, 10)) return jsonError(429, 'rate_limited');

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'bad_request', body.error.message);

  try {
    return NextResponse.json(await getOrCreateDigest(makeDigestRepo(auth.db), body.data));
  } catch (err) {
    log.error('digest failed', { ...body.data, err });
    return jsonError(502, 'ai_failed', err instanceof Error ? err.message : String(err));
  }
}
