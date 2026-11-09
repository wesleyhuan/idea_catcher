import { generateDigest, type DigestCapture } from '@/lib/ai/digest';
import type { CachedDigest, DigestRepo, DigestSource } from '@/lib/server/digestRepo';
import type { Period } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('digest');

export const EMPTY_DIGEST = 'Nothing captured in this period yet. 這段時間還沒有新的紀錄。';

export type DigestRange = { period: Period; period_start: string; from: string; to: string };

/** Fresh only if no capture was added, removed, edited or re-statused since it was built. */
export function isFresh(cached: CachedDigest | null, source: DigestSource): cached is CachedDigest {
  if (!cached || cached.capture_count !== source.count) return false;
  if (cached.source_updated_at === null || source.latestUpdatedAt === null) return false;
  // Compare instants, not strings, so timestamp formatting can't cause a false miss.
  return Date.parse(cached.source_updated_at) === Date.parse(source.latestUpdatedAt);
}

export async function getOrCreateDigest(
  repo: DigestRepo,
  range: DigestRange,
  ai: (c: DigestCapture[], p: Period) => Promise<string> = generateDigest,
): Promise<{ content_md: string; cached: boolean }> {
  const source = await repo.sourceOf(range.from, range.to);
  if (source.count === 0) return { content_md: EMPTY_DIGEST, cached: false };

  const cached = await repo.getCached(range.period, range.period_start);
  if (isFresh(cached, source)) {
    log.debug('cache hit', { ...range, ...source });
    return { content_md: cached.content_md, cached: true };
  }

  const captures = await repo.listProcessed(range.from, range.to);
  const content_md = await ai(captures, range.period);
  await repo.save(range.period, range.period_start, content_md, source);
  log.info('generated', { ...range, ...source });
  return { content_md, cached: false };
}
