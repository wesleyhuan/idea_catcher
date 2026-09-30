import { generateDigest, type DigestCapture } from '@/lib/ai/digest';
import type { DigestRepo } from '@/lib/server/digestRepo';
import type { Period } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('digest');

export const EMPTY_DIGEST = 'Nothing captured in this period yet. 這段時間還沒有新的紀錄。';

export type DigestRange = { period: Period; period_start: string; from: string; to: string };

export async function getOrCreateDigest(
  repo: DigestRepo,
  range: DigestRange,
  ai: (c: DigestCapture[], p: Period) => Promise<string> = generateDigest,
): Promise<{ content_md: string; cached: boolean }> {
  const count = await repo.countProcessed(range.from, range.to);
  if (count === 0) return { content_md: EMPTY_DIGEST, cached: false };

  const cached = await repo.getCached(range.period, range.period_start);
  if (cached?.capture_count === count) {
    log.debug('cache hit', { ...range, count });
    return { content_md: cached.content_md, cached: true };
  }

  const captures = await repo.listProcessed(range.from, range.to);
  const content_md = await ai(captures, range.period);
  await repo.save(range.period, range.period_start, content_md, count);
  log.info('generated', { ...range, count });
  return { content_md, cached: false };
}
