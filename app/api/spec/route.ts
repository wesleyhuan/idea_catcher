import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, jsonError, requireUser } from '@/lib/server/route';
import { makeCaptureRepo } from '@/lib/server/captureRepo';
import { specForCapture } from '@/lib/server/specCapture';
import { logger } from '@/lib/logger';

// ≥ 2 × per-attempt timeout + backoff (SDK retries timeouts once)
export const maxDuration = 200;
const log = logger('api/spec');
const Body = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return jsonError(401, 'unauthorized');
  const limited = await enforceRateLimit(auth.db, 'spec');
  if (limited) return limited;

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    log.warn('bad request', { issues: body.error.issues });
    return jsonError(400, 'bad_request');
  }

  try {
    const spec_md = await specForCapture(makeCaptureRepo(auth.db), body.data.id);
    if (spec_md === null) return jsonError(404, 'not_found');
    return NextResponse.json({ spec_md });
  } catch (err) {
    log.error('spec generation failed', { id: body.data.id, err });
    return jsonError(502, 'ai_failed');
  }
}
