import { openDB } from 'idb';
import { logger } from '@/lib/logger';

export type OutboxItem = { client_id: string; raw_text: string; captured_at: string };

const log = logger('outbox');
const STORE = 'outbox';
const db = () =>
  openDB('idea-catcher', 1, {
    upgrade: (d) => d.createObjectStore(STORE, { keyPath: 'client_id' }),
  });

export async function addToOutbox(rawText: string, now = new Date()): Promise<OutboxItem | null> {
  const text = rawText.trim();
  if (!text) return null;
  const item = { client_id: crypto.randomUUID(), raw_text: text, captured_at: now.toISOString() };
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
