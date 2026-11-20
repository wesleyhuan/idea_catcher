import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** An in-memory CacheStorage: each cache keeps keys in insertion order, like the real one. */
function fakeCaches(initial: Record<string, string[]> = {}) {
  const store = new Map<string, Map<string, unknown>>(
    Object.entries(initial).map(([name, urls]) => [name, new Map(urls.map((u) => [u, {}]))]),
  );
  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name)!;
    return {
      put: async (req: { url: string }, res: unknown) => void entries.set(req.url, res),
      keys: async () => [...entries.keys()].map((url) => ({ url })),
      delete: async (req: { url: string }) => entries.delete(req.url),
    };
  };
  return {
    store,
    api: {
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
      open: async (name: string) => cacheFor(name),
      match: async () => undefined,
    },
  };
}

/** Runs public/sw.js against fake globals and returns its event listeners. */
function loadServiceWorker(caches: ReturnType<typeof fakeCaches>['api'], fetch: (r: unknown) => Promise<unknown>) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, caches, fetch, URL, Response, console });
  return listeners;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('service worker caches', () => {
  it('deletes caches from earlier versions on activate and keeps the current ones', async () => {
    const caches = fakeCaches({
      'idea-catcher-v1': ['https://app.test/'],
      'idea-catcher-pages-v2': ['https://app.test/inbox'],
      'idea-catcher-assets-v2': [],
    });
    const on = loadServiceWorker(caches.api, async () => ({}));
    let done: Promise<unknown> = Promise.resolve();
    on.activate({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect([...caches.store.keys()].sort()).toEqual(['idea-catcher-assets-v2', 'idea-catcher-pages-v2']);
  });

  it('caps the asset cache at 150 entries, evicting the oldest', async () => {
    const caches = fakeCaches();
    const res = { ok: true, redirected: false, clone: () => ({}) };
    const on = loadServiceWorker(caches.api, async () => res);
    for (let i = 0; i < 160; i++) {
      const request = { method: 'GET', mode: 'no-cors', url: `https://app.test/_next/static/chunk-${i}.js` };
      on.fetch({ request, respondWith: async (p: Promise<unknown>) => p });
      await flush();
    }
    await flush();
    const assets = [...caches.store.get('idea-catcher-assets-v2')!.keys()];
    expect(assets).toHaveLength(150);
    expect(assets[0]).toBe('https://app.test/_next/static/chunk-10.js');
    expect(assets.at(-1)).toBe('https://app.test/_next/static/chunk-159.js');
  });

  it('never trims the page cache, so offline pages survive', async () => {
    const pages = Array.from({ length: 200 }, (_, i) => `https://app.test/page-${i}`);
    const caches = fakeCaches({ 'idea-catcher-pages-v2': pages });
    const res = { ok: true, redirected: false, clone: () => ({}) };
    const on = loadServiceWorker(caches.api, async () => res);
    on.fetch({
      request: { method: 'GET', mode: 'navigate', url: 'https://app.test/' },
      respondWith: async (p: Promise<unknown>) => p,
    });
    await flush();
    await flush();
    expect(caches.store.get('idea-catcher-pages-v2')!.size).toBe(201);
  });
});
