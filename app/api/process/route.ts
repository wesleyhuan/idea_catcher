import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, jsonError, requireUser } from '@/lib/server/route';
import { makeCaptureRepo } from '@/lib/server/captureRepo';
import { processCapture } from '@/lib/server/processCapture';
import { logger } from '@/lib/logger';

// ≥ 2 × per-attempt timeout + backoff (SDK retries timeouts once)
export const maxDuration = 75;
const log = logger('api/process');
const Body = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return jsonError(401, 'unauthorized');
  const limited = await enforceRateLimit(auth.db, 'process');
  if (limited) return limited;

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    log.warn('bad request', { issues: body.error.issues });
    return jsonError(400, 'bad_request');
  }

  try {
    const result = await processCapture(makeCaptureRepo(auth.db), body.data.id);
    log.info('done', { id: body.data.id, outcome: result.outcome });
    if (result.outcome === 'not_found') return jsonError(404, 'not_found');
    if (result.outcome === 'failed') return jsonError(502, 'ai_failed');
    return NextResponse.json(result);
  } catch (err) {
    log.error('unexpected error', { id: body.data.id, err });
    return jsonError(500, 'internal_error');
  }
}
