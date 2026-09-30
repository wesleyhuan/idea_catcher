import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addToOutbox, listOutbox, removeFromOutbox } from '@/lib/outbox';

beforeEach(async () => {
  await removeFromOutbox((await listOutbox()).map((i) => i.client_id));
});

describe('outbox', () => {
  it('stores trimmed text with a client id and capture time', async () => {
    const item = await addToOutbox('  buy milk 買牛奶  ', new Date('2026-09-24T01:00:00Z'));
    expect(item).toMatchObject({ raw_text: 'buy milk 買牛奶', captured_at: '2026-09-24T01:00:00.000Z' });
    expect(item!.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await listOutbox()).toEqual([item]);
  });

  it('ignores blank text', async () => {
    expect(await addToOutbox('   \n ')).toBeNull();
    expect(await listOutbox()).toEqual([]);
  });

  it('lists oldest first and removes by client id', async () => {
    const a = await addToOutbox('a', new Date('2026-09-24T02:00:00Z'));
    const b = await addToOutbox('b', new Date('2026-09-24T01:00:00Z'));
    expect((await listOutbox()).map((i) => i.raw_text)).toEqual(['b', 'a']);
    await removeFromOutbox([b!.client_id]);
    expect(await listOutbox()).toEqual([a]);
  });
});
