import { openDB } from 'idb';
import { logger } from '@/lib/logger';

export type OutboxItem = {
  client_id: string;
  raw_text: string;
  captured_at: string;
  /**
   * Who saved it, so another account signing in on this device can't upload it.
   * Null when no session was known at save time; missing on items saved before
   * this field existed. Either way it goes to the next user who syncs.
   */
  user_id?: string | null;
};

/** The items `userId` may sync: their own, plus ones with no owner. */
export function itemsFor(items: OutboxItem[], userId: string | null): OutboxItem[] {
  return items.filter((i) => i.user_id == null || i.user_id === userId);
}

const log = logger('outbox');
const STORE = 'outbox';
const db = () =>
  openDB('idea-catcher', 1, {
    upgrade: (d) => d.createObjectStore(STORE, { keyPath: 'client_id' }),
  });

export async function addToOutbox(
  rawText: string,
  userId: string | null,
  now = new Date(),
): Promise<OutboxItem | null> {
  const text = rawText.trim();
  if (!text) return null;
  const item = { client_id: crypto.randomUUID(), raw_text: text, captured_at: now.toISOString(), user_id: userId };
  await (await db()).put(STORE, item);
  log.info('added', { client_id: item.client_id, chars: text.length });
  return item;
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const items: OutboxItem[] = await (await db()).getAll(STORE);
  log.debug('list', { count: items.length });
  return items.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
}

export async function removeFromOutbox(clientIds: string[]): Promise<void> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  await Promise.all([...clientIds.map((id) => tx.store.delete(id)), tx.done]);
  log.info('removed', { count: clientIds.length });
}

/** Gives items with no owner to `userId`. */
export async function claimUnowned(userId: string): Promise<void> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const unowned = (await tx.store.getAll() as OutboxItem[]).filter((i) => i.user_id == null);
  await Promise.all([...unowned.map((i) => tx.store.put({ ...i, user_id: userId })), tx.done]);
  if (unowned.length) log.info('claimed unowned', { count: unowned.length });
}
