import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeBrowserCaptureRepo } from '@/lib/client/captureRepo';

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
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
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
  it('lists one status, newest first, capped', async () => {
    const { repo, calls } = fakeDb({ data: [{ id: 'c1' }] });
    expect(await repo.listByStatus('inbox')).toEqual([{ id: 'c1' }]);
    expect(calls).toEqual([
      ['from', 'captures'],
      ['select', '*'],
      ['eq', 'status', 'inbox'],
      ['order', 'captured_at', { ascending: false }],
      ['limit', 200],
    ]);
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

  it('updates one capture by id', async () => {
    const { repo, calls } = fakeDb();
    await repo.update('c1', { status: 'done' });
    expect(calls).toEqual([['from', 'captures'], ['update', { status: 'done' }], ['eq', 'id', 'c1']]);
  });

  it('throws the Supabase error instead of returning it', async () => {
    const error = new Error('JWT expired');
    await expect(fakeDb({ error }).repo.update('c1', { status: 'done' })).rejects.toBe(error);
    await expect(fakeDb({ error }).repo.listByStatus('inbox')).rejects.toBe(error);
  });

  it('wraps a plain Supabase error object in an Error that keeps its message', async () => {
    // What postgrest-js actually returns: the parsed JSON body, not an Error.
    const error = { message: 'new row violates row-level security policy', code: '42501' };
    const calls = [
      (r: ReturnType<typeof fakeDb>['repo']) => r.update('c1', { status: 'done' }),
      (r: ReturnType<typeof fakeDb>['repo']) => r.listByStatus('inbox'),
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
    expect(channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'captures' }), onChange);

    unsubscribe();
    expect(db.removeChannel).toHaveBeenCalledWith(channel);
  });
});
