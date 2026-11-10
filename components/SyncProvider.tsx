'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addToOutbox, claimUnowned, itemsFor, listOutbox, removeFromOutbox, type OutboxItem } from '@/lib/outbox';
import { retryUnprocessed, syncOutbox } from '@/lib/sync';
import { createClient } from '@/lib/supabase/browser';
import { makeBrowserCaptureRepo } from '@/lib/client/captureRepo';
import { postJson } from '@/lib/api';
import { logger } from '@/lib/logger';

const log = logger('sync-provider');
const MAX_AUTO_ATTEMPTS = 3;

type SyncState = {
  /** The signed-in user's unsynced items (other accounts' items on this device are hidden). */
  pendingItems: OutboxItem[];
  lastSyncAt: number;
  save: (text: string) => Promise<boolean>;
  syncNow: () => Promise<void>;
  /** Resolves false when the user cancels because some items haven't synced yet. */
  signOut: () => Promise<boolean>;
};

const SyncContext = createContext<SyncState | null>(null);

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}

const triggerProcessing = (id: string) => postJson('/api/process', { id }).then(() => undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  // Read by save(): set from auth events, so it still holds the user while
  // offline, when a session refresh can't reach Supabase.
  const userIdRef = useRef<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const pendingItems = useMemo(() => itemsFor(outboxItems, userId), [outboxItems, userId]);

  // syncOutbox and listOutbox failures are caught and logged here, not left
  // for the caller: every caller (save, the online listener, the startup
  // retry chain) fires this without awaiting or catching, so a rejection
  // here would otherwise surface as an unhandled promise rejection.
  const syncNow = useCallback(async () => {
    const supabase = createClient();
    await syncOutbox({
      list: listOutbox,
      remove: removeFromOutbox,
      getUserId: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
      upsert: (userId, items) => makeBrowserCaptureRepo(supabase).upsertOutbox(userId, items),
      process: triggerProcessing,
    }).catch((err) => log.error('sync failed', { err }));

    const items = await listOutbox().catch((err) => {
      log.error('listOutbox failed', { err });
      return null;
    });
    if (items) setOutboxItems(items);
    setLastSyncAt(Date.now());
  }, []);

  const save = useCallback(async (text: string) => {
    const item = await addToOutbox(text, userIdRef.current);
    if (!item) return false;
    setOutboxItems(await listOutbox());
    void syncNow();
    return true;
  }, [syncNow]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    const me = userIdRef.current;
    await syncNow(); // last chance to upload while still signed in
    try {
      // Unowned items left over (offline) belong to the person signing out, not the next one.
      if (me) await claimUnowned(me);
      const left = itemsFor(await listOutbox(), me).length;
      if (left > 0 && !window.confirm(
        `${left} capture(s) haven't synced yet. They stay on this device and sync the next time you sign in. Sign out?`,
      )) return false;
    } catch (err) {
      log.error('outbox check before sign-out failed', { err }); // don't block sign-out on it
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      // Offline, the server can't revoke the session; still end it on this device.
      log.warn('sign-out failed; signing out locally', { message: error.message });
      await supabase.auth.signOut({ scope: 'local' });
    }
    return true;
  }, [syncNow]);

  useEffect(() => {
    const supabase = createClient();
    const onOnline = () => void syncNow();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };

    // Retry older rows first: after syncNow, freshly synced rows are also 'pending'
    // and would be processed twice.
    void retryUnprocessed({
      listUnprocessed: () => makeBrowserCaptureRepo(supabase).listUnprocessed(MAX_AUTO_ATTEMPTS)
        .catch((err) => {
          log.error('listUnprocessed failed', { err });
          return [];
        }),
      process: triggerProcessing,
    }).then(syncNow).catch((err) => log.error('startup retry failed', { err }));

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    // Also fires INITIAL_SESSION on subscribe, which sets the starting user.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      userIdRef.current = session?.user.id ?? null;
      setUserId(userIdRef.current);
      if (event === 'SIGNED_IN') void syncNow();
    });
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      authListener.subscription.unsubscribe();
    };
  }, [syncNow]);

  return (
    <SyncContext.Provider value={{ pendingItems, lastSyncAt, save, syncNow, signOut }}>
      {children}
    </SyncContext.Provider>
  );
}
