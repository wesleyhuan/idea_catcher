import type { OutboxItem } from '@/lib/outbox';
import { logger } from '@/lib/logger';

const log = logger('sync');

export type SyncDeps = {
  list: () => Promise<OutboxItem[]>;
  remove: (clientIds: string[]) => Promise<void>;
  getUserId: () => Promise<string | null>;
  /** Upserts on (user_id, client_id); returns the row ids. */
  upsert: (userId: string, items: OutboxItem[]) => Promise<string[]>;
  process: (id: string) => Promise<void>;
};
export type SyncResult = { synced: number; remaining: number };

let running: Promise<SyncResult> | null = null;
let rerunRequested = false;

/** Single-flight: a call during a run schedules exactly one more run and shares its promise. */
export function syncOutbox(deps: SyncDeps): Promise<SyncResult> {
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    let result: SyncResult;
    do {
      rerunRequested = false;
      result = await syncOnce(deps);
      total += result.synced;
    } while (rerunRequested);
    return { synced: total, remaining: result.remaining };
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const items = await deps.list();
  if (items.length === 0) return { synced: 0, remaining: 0 };

  const userId = await deps.getUserId();
  if (!userId) {
    log.warn('no session; keeping items', { count: items.length });
    return { synced: 0, remaining: items.length };
  }

  let ids: string[];
  try {
    ids = await deps.upsert(userId, items);
  } catch (err) {
    log.error('upsert failed; keeping items', { count: items.length, err });
    return { synced: 0, remaining: items.length };
  }

  await deps.remove(items.map((i) => i.client_id));
  log.info('synced', { count: items.length });
  ids.forEach((id) => deps.process(id).catch((err) => log.error('process trigger failed', { id, err })));
  return { synced: items.length, remaining: 0 };
}

export async function retryUnprocessed(deps: {
  listUnprocessed: () => Promise<string[]>;
  process: (id: string) => Promise<void>;
}): Promise<number> {
  const ids = await deps.listUnprocessed();
  log.info('retrying unprocessed', { count: ids.length });
  await Promise.allSettled(ids.map((id) =>
    deps.process(id).catch((err) => {
      log.error('retry failed', { id, err });
      throw err;
    })));
  return ids.length;
}
