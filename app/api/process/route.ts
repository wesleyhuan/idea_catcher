import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireUser } from '@/lib/server/route';
import { checkRateLimit } from '@/lib/rateLimit';
import { makeCaptureRepo } from '@/lib/server/captureRepo';
import { processCapture } from '@/lib/server/processCapture';
import { logger } from '@/lib/logger';

export const maxDuration = 60;
const log = logger('api/process');
const Body = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return jsonError(401, 'unauthorized');
  if (!checkRateLimit(`process:${auth.user.id}`, 60)) return jsonError(429, 'rate_limited');

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'bad_request', body.error.message);

  try {
    const result = await processCapture(makeCaptureRepo(auth.db), body.data.id);
    log.info('done', { id: body.data.id, outcome: result.outcome });
    if (result.outcome === 'not_found') return jsonError(404, 'not_found');
    if (result.outcome === 'failed') return jsonError(502, 'ai_failed', result.error);
    return NextResponse.json(result);
  } catch (err) {
    log.error('unexpected error', { id: body.data.id, err });
    return jsonError(500, 'internal_error', err instanceof Error ? err.message : String(err));
  }
}
