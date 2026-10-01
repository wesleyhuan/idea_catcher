import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireUser } from '@/lib/server/route';
import { checkRateLimit } from '@/lib/rateLimit';
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
  if (!checkRateLimit(`spec:${auth.user.id}`, 10)) return jsonError(429, 'rate_limited');

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'bad_request', body.error.message);

  try {
    const spec_md = await specForCapture(makeCaptureRepo(auth.db), body.data.id);
    if (spec_md === null) return jsonError(404, 'not_found');
    return NextResponse.json({ spec_md });
  } catch (err) {
    log.error('spec generation failed', { id: body.data.id, err });
    return jsonError(502, 'ai_failed', err instanceof Error ? err.message : String(err));
  }
}
