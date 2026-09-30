import { describe, expect, it, vi } from 'vitest';
import { retryUnprocessed, syncOutbox, type SyncDeps } from '@/lib/sync';
import type { OutboxItem } from '@/lib/outbox';

const item = (id: string): OutboxItem => ({ client_id: id, raw_text: `text ${id}`, captured_at: '2026-09-24T00:00:00Z' });

function memoryDeps(initial: OutboxItem[], overrides: Partial<SyncDeps> = {}) {
  const store = [...initial];
  const deps = {
    list: vi.fn(async () => [...store]),
    remove: vi.fn(async (ids: string[]) => {
      ids.forEach((id) => store.splice(store.findIndex((i) => i.client_id === id), 1));
    }),
    getUserId: vi.fn(async () => 'u1'),
    upsert: vi.fn(async (_u: string, items: OutboxItem[]) => items.map((i) => `row-${i.client_id}`)),
    process: vi.fn(async () => {}),
  };
  // Object.assign (not spread) so `deps`'s static type keeps the concrete vi.fn()
  // Mock types instead of widening to `SyncDeps[prop] | undefined` from the
  // Partial<SyncDeps> override type — the mock-specific methods used below
  // (e.g. getMockImplementation) need that concrete type to type-check.
  Object.assign(deps, overrides);
  return { deps, store };
}

describe('syncOutbox', () => {
  it('uploads, removes from outbox and triggers processing', async () => {
    const { deps, store } = memoryDeps([item('a'), item('b')]);
    expect(await syncOutbox(deps)).toEqual({ synced: 2, remaining: 0 });
    expect(deps.upsert).toHaveBeenCalledWith('u1', [item('a'), item('b')]);
    expect(store).toEqual([]);
    expect(deps.process).toHaveBeenCalledWith('row-a');
    expect(deps.process).toHaveBeenCalledWith('row-b');
  });

  it('does nothing when the outbox is empty', async () => {
    const { deps } = memoryDeps([]);
    expect(await syncOutbox(deps)).toEqual({ synced: 0, remaining: 0 });
    expect(deps.upsert).not.toHaveBeenCalled();
  });

  it('keeps items when there is no session', async () => {
    const { deps, store } = memoryDeps([item('a')], { getUserId: vi.fn(async () => null) });
    expect(await syncOutbox(deps)).toEqual({ synced: 0, remaining: 1 });
    expect(store).toHaveLength(1);
  });

  it('keeps items when the upload fails (expired session, network error)', async () => {
    const { deps, store } = memoryDeps([item('a')], {
      upsert: vi.fn(async () => { throw new Error('JWT expired'); }),
    });
    expect(await syncOutbox(deps)).toEqual({ synced: 0, remaining: 1 });
    expect(deps.remove).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
  });

  it('still syncs an item saved while a sync is running', async () => {
    let releaseFirst!: () => void;
    const { deps, store } = memoryDeps([item('a')]);
    const realUpsert = deps.upsert.getMockImplementation()!;
    deps.upsert.mockImplementationOnce(async (u, items) => {
      await new Promise<void>((r) => (releaseFirst = r));
      return realUpsert(u, items);
    });

    const first = syncOutbox(deps);
    await vi.waitFor(() => expect(deps.upsert).toHaveBeenCalledTimes(1));
    store.push(item('b'));           // saved mid-sync
    const second = syncOutbox(deps); // joins the running sync
    releaseFirst();

    await Promise.all([first, second]);
    expect(store).toEqual([]);
    expect(deps.upsert).toHaveBeenLastCalledWith('u1', [item('b')]);
  });

  it('does not fail the sync when triggering processing fails', async () => {
    const { deps } = memoryDeps([item('a')], { process: vi.fn(async () => { throw new Error('502'); }) });
    expect(await syncOutbox(deps)).toEqual({ synced: 1, remaining: 0 });
  });

  it('clears the single-flight lock when a run rejects, so the next call is not blocked', async () => {
    const failing = memoryDeps([item('a')], {
      list: vi.fn(async () => { throw new Error('IDB blocked'); }),
    });
    await expect(syncOutbox(failing.deps)).rejects.toThrow('IDB blocked');

    const { deps, store } = memoryDeps([item('a')]);
    expect(await syncOutbox(deps)).toEqual({ synced: 1, remaining: 0 });
    expect(store).toEqual([]);
  });

  it('syncs an item saved in the microtask gap right after the last rerun check', async () => {
    // `deps.process` fires (fire-and-forget) after the do-while loop's last
    // `rerunRequested` check has already passed and the loop is exiting.
    // Two nested queueMicrotask calls land the store.push + second
    // syncOutbox call in that same window: with the old outer `.finally()`,
    // `running` was still non-null there, so the second call only set an
    // orphaned `rerunRequested` and item 'b' was never synced.
    const { deps, store } = memoryDeps([item('a')]);
    let late: Promise<unknown> | undefined;
    deps.process.mockImplementationOnce(async () => {
      queueMicrotask(() => queueMicrotask(() => { store.push(item('b')); late = syncOutbox(deps); }));
    });
    await syncOutbox(deps);
    await late;
    expect(store).toEqual([]);
  });
});

describe('retryUnprocessed', () => {
  it('processes every unprocessed id and returns the count', async () => {
    const process = vi.fn(async () => {});
    expect(await retryUnprocessed({ listUnprocessed: async () => ['x', 'y'], process })).toBe(2);
    expect(process).toHaveBeenCalledTimes(2);
  });
});
