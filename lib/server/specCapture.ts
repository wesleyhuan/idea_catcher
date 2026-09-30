import { generateSpec } from '@/lib/ai/spec';
import type { CaptureRepo } from '@/lib/server/captureRepo';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('specCapture');

export async function specForCapture(
  repo: CaptureRepo,
  id: string,
  ai: (c: Capture) => Promise<string> = generateSpec,
): Promise<string | null> {
  const capture = await repo.get(id);
  if (!capture) {
    log.warn('capture not found', { id });
    return null;
  }
  const markdown = await ai(capture);
  await repo.saveSpec(id, markdown);
  log.info('spec saved', { id, chars: markdown.length });
  return markdown;
}
