import { processText, type ProcessResult } from '@/lib/ai/process';
import type { CaptureRepo } from '@/lib/server/captureRepo';
import { logger } from '@/lib/logger';

const log = logger('processCapture');

/** claim_capture refuses past this (supabase/migrations/0005); keep the two in sync. */
export const MAX_PROCESS_ATTEMPTS = 5;

export type ProcessOutcome = {
  outcome: 'done' | 'skipped' | 'failed' | 'exhausted' | 'not_found';
  error?: string;
};

export async function processCapture(
  repo: CaptureRepo,
  id: string,
  ai: (rawText: string) => Promise<ProcessResult> = processText,
): Promise<ProcessOutcome> {
  const capture = await repo.get(id);
  if (!capture) {
    log.warn('capture not found', { id });
    return { outcome: 'not_found' };
  }
  if (capture.user_edited || capture.processing === 'done') {
    log.debug('skip', { id, userEdited: capture.user_edited, processing: capture.processing });
    return { outcome: 'skipped' };
  }
  if (capture.processing_attempts >= MAX_PROCESS_ATTEMPTS) {
    log.warn('attempt limit reached', { id, attempts: capture.processing_attempts });
    return { outcome: 'exhausted' };
  }

  // The checks above only avoid a needless claim; the claim re-checks them atomically.
  const claimed = await repo.claim(id);
  if (!claimed) {
    log.info('already being processed or resolved; skip', { id });
    return { outcome: 'skipped' };
  }
  try {
    const saved = await repo.saveResult(id, await ai(claimed.raw_text));
    if (!saved) log.info('user edited during processing; result dropped', { id });
    return { outcome: saved ? 'done' : 'skipped' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('processing failed', { id, attempt: claimed.processing_attempts, err });
    await repo.markFailed(id, message);
    return { outcome: 'failed', error: message };
  }
}
