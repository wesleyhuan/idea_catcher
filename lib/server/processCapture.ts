import { processText, type ProcessResult } from '@/lib/ai/process';
import type { CaptureRepo } from '@/lib/server/captureRepo';
import { logger } from '@/lib/logger';

const log = logger('processCapture');

export type ProcessOutcome = { outcome: 'done' | 'skipped' | 'failed' | 'not_found'; error?: string };

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

  await repo.markAttempt(id, capture.processing_attempts + 1);
  try {
    const saved = await repo.saveResult(id, await ai(capture.raw_text));
    if (!saved) log.info('user edited during processing; result dropped', { id });
    return { outcome: saved ? 'done' : 'skipped' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('processing failed', { id, attempt: capture.processing_attempts + 1, err });
    await repo.markFailed(id, message);
    return { outcome: 'failed', error: message };
  }
}
