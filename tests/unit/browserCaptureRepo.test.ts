import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterCursor, makeBrowserCaptureRepo } from '@/lib/client/captureRepo';
import { DEFAULT_FILTERS } from '@/lib/filters';

type Call = [method: string, ...args: unknown[]];

/**
 * Records every query-builder call; awaiting the chain resolves to `result`.
 * Enough of SupabaseClient to check which query each repo method builds.
 */
function fakeDb(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Call[] = [];
  const builder: object = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject);
      }
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args]);
        return builder;
      };
    },
  });
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  const db = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  };
  return { db, calls, channel, repo: makeBrowserCaptureRepo(db as unknown as SupabaseClient) };
}

describe('makeBrowserCaptureRepo', () => {
  it('lists the first page of one status in a total order, asking for one extra row', async () => {
    const { repo, calls } = fakeDb({ data: [{ id: 'c1' }] });
    expect(await repo.listPage(DEFAULT_FILTERS, { limit: 2 })).toEqual({ items: [{ id: 'c1' }], hasMore: false });
    expect(calls).toEqual([
      ['from', 'captures'],
      ['select', '*'],
      ['eq', 'status', 'inbox'],
      ['order', 'captured_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', 3],
    ]);
  });

  it('reports hasMore and drops the extra row when the page is full', async () => {
    const { repo } = fakeDb({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(await repo.listPage(DEFAULT_FILTERS, { limit: 2 })).toEqual({ items: [{ id: 'a' }, { id: 'b' }], hasMore: true });
  });

  it('filters type and context in the query and starts after the cursor', async () => {
    const { repo, calls } = fakeDb({ data: [] });
    const after = { captured_at: '2026-11-20T10:00:00.123+00:00', id: 'c9' };
    await repo.listPage({ status: 'done', type: 'idea', context: 'laptop' }, { limit: 50, after });
    expect(calls).toContainEqual(['eq', 'type', 'idea']);
    expect(calls).toContainEqual(['eq', 'context', 'laptop']);
    expect(calls).toContainEqual(['or', afterCursor(after)]);
  });

  it('builds a cursor filter that breaks captured_at ties by id, with quoted timestamps', () => {
    expect(afterCursor({ captured_at: '2026-11-20T10:00:00+00:00', id: 'c9' })).toBe(
      'captured_at.lt."2026-11-20T10:00:00+00:00",and(captured_at.eq."2026-11-20T10:00:00+00:00",id.lt.c9)',
    );
  });

  it('lists only retryable captures under the attempt limit, as ids', async () => {
    const { repo, calls } = fakeDb({ data: [{ id: 'a' }, { id: 'b' }] });
    expect(await repo.listUnprocessed(3)).toEqual(['a', 'b']);
    expect(calls).toContainEqual(['in', 'processing', ['pending', 'failed']]);
    expect(calls).toContainEqual(['lt', 'processing_attempts', 3]);
  });

  it('upserts outbox items as their columns plus the given user, idempotent on client_id', async () => {
    const { repo, calls } = fakeDb({ data: [{ id: 'row-1' }] });
    const item = { client_id: 'k1', raw_text: 'buy milk', captured_at: '2026-09-24T00:00:00Z', user_id: null };
    expect(await repo.upsertOutbox('u1', [item])).toEqual(['row-1']);
    expect(calls).toContainEqual([
      'upsert',
      [{ client_id: 'k1', raw_text: 'buy milk', captured_at: '2026-09-24T00:00:00Z', user_id: 'u1' }],
      { onConflict: 'user_id,client_id' },
    ]);
  });

  it('updates one capture by id and returns the saved row', async () => {
    const { repo, calls } = fakeDb({ data: { id: 'c1', status: 'done' } });
    expect(await repo.update('c1', { status: 'done' })).toEqual({ id: 'c1', status: 'done' });
    expect(calls).toEqual([
      ['from', 'captures'], ['update', { status: 'done' }], ['eq', 'id', 'c1'], ['select', '*'], ['single'],
    ]);
  });

  it('throws the Supabase error instead of returning it', async () => {
    const error = new Error('JWT expired');
    await expect(fakeDb({ error }).repo.update('c1', { status: 'done' })).rejects.toBe(error);
    await expect(fakeDb({ error }).repo.listPage(DEFAULT_FILTERS, { limit: 50 })).rejects.toBe(error);
  });

  it('wraps a plain Supabase error object in an Error that keeps its message', async () => {
    // What postgrest-js actually returns: the parsed JSON body, not an Error.
    const error = { message: 'new row violates row-level security policy', code: '42501' };
    const calls = [
      (r: ReturnType<typeof fakeDb>['repo']) => r.update('c1', { status: 'done' }),
      (r: ReturnType<typeof fakeDb>['repo']) => r.listPage(DEFAULT_FILTERS, { limit: 50 }),
      (r: ReturnType<typeof fakeDb>['repo']) => r.get('c1'),
      (r: ReturnType<typeof fakeDb>['repo']) => r.listRecent(5),
    ];
    for (const call of calls) {
      const err = await call(fakeDb({ error }).repo).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(error.message);
      expect((err as Error).cause).toBe(error);
    }
  });

  it('subscribes on a fresh channel each time and removes it on unsubscribe', () => {
    const { repo, db, channel } = fakeDb();
    const onChange = vi.fn();
    const unsubscribe = repo.subscribe(onChange);
    repo.subscribe(onChange);

    const [first, second] = db.channel.mock.calls.map((c: unknown[]) => c[0]);
    expect(first).not.toBe(second);
    expect(channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'captures' }), expect.any(Function));

    unsubscribe();
    expect(db.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('passes inserts and updates on as upserts and deletes as ids', () => {
    const { repo, channel } = fakeDb();
    const onChange = vi.fn();
    repo.subscribe(onChange);
    const handler = channel.on.mock.calls[0][2] as (p: unknown) => void;

    handler({ eventType: 'INSERT', new: { id: 'a' }, old: {} });
    handler({ eventType: 'UPDATE', new: { id: 'b' }, old: { id: 'b' } });
    handler({ eventType: 'DELETE', new: {}, old: { id: 'c' } });
    handler({ eventType: 'DELETE', new: {}, old: {} }); // no key: nothing to remove

    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'upsert', row: { id: 'a' } },
      { kind: 'upsert', row: { id: 'b' } },
      { kind: 'delete', id: 'c' },
    ]);
  });

  it('resyncs after a reconnect but not on the first join', () => {
    const { repo, channel } = fakeDb();
    const onResync = vi.fn();
    repo.subscribe(vi.fn(), onResync);
    const onStatus = channel.subscribe.mock.calls[0][0] as (status: string) => void;

    onStatus('SUBSCRIBED');
    expect(onResync).not.toHaveBeenCalled();
    onStatus('CHANNEL_ERROR');
    onStatus('SUBSCRIBED');
    expect(onResync).toHaveBeenCalledTimes(1);
  });
});
