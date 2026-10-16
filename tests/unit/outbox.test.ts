import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addToOutbox, claimUnowned, itemsFor, listOutbox, removeFromOutbox, type OutboxItem } from '@/lib/outbox';

beforeEach(async () => {
  await removeFromOutbox((await listOutbox()).map((i) => i.client_id));
});

describe('outbox', () => {
  it('stores trimmed text with a client id, capture time and owner', async () => {
    const item = await addToOutbox('  buy milk 買牛奶  ', 'u1', new Date('2026-09-24T01:00:00Z'));
    expect(item).toMatchObject({ raw_text: 'buy milk 買牛奶', captured_at: '2026-09-24T01:00:00.000Z', user_id: 'u1' });
    expect(item!.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await listOutbox()).toEqual([item]);
  });

  it('ignores blank text', async () => {
    expect(await addToOutbox('   \n ', 'u1')).toBeNull();
    expect(await listOutbox()).toEqual([]);
  });

  it('lists oldest first and removes by client id', async () => {
    const a = await addToOutbox('a', 'u1', new Date('2026-09-24T02:00:00Z'));
    const b = await addToOutbox('b', 'u1', new Date('2026-09-24T01:00:00Z'));
    expect((await listOutbox()).map((i) => i.raw_text)).toEqual(['b', 'a']);
    await removeFromOutbox([b!.client_id]);
    expect(await listOutbox()).toEqual([a]);
  });

  it('gives unowned items to a user without touching owned ones', async () => {
    const mine = await addToOutbox('mine', null);
    const theirs = await addToOutbox('theirs', 'u2');
    await claimUnowned('u1');
    const byText = Object.fromEntries((await listOutbox()).map((i) => [i.raw_text, i.user_id]));
    expect(byText).toEqual({ mine: 'u1', theirs: 'u2' });
    expect(mine!.client_id).not.toBe(theirs!.client_id);
  });
});

describe('itemsFor', () => {
  const item = (user_id: string | null | undefined): OutboxItem =>
    ({ client_id: String(user_id), raw_text: 'x', captured_at: '2026-09-24T00:00:00Z', user_id });

  it("keeps the user's own and unowned items, including ones saved before user_id existed", () => {
    const items = [item('u1'), item('u2'), item(null), item(undefined)];
    expect(itemsFor(items, 'u1').map((i) => i.user_id)).toEqual(['u1', null, undefined]);
  });
});
