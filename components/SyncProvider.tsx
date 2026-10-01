'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { addToOutbox, listOutbox, removeFromOutbox, type OutboxItem } from '@/lib/outbox';
import { retryUnprocessed, syncOutbox } from '@/lib/sync';
import { createClient } from '@/lib/supabase/browser';
import { postJson } from '@/lib/api';
import { logger } from '@/lib/logger';

const log = logger('sync-provider');
const MAX_AUTO_ATTEMPTS = 3;

type SyncState = {
  pendingItems: OutboxItem[];
  lastSyncAt: number;
  save: (text: string) => Promise<boolean>;
  syncNow: () => Promise<void>;
};

const SyncContext = createContext<SyncState | null>(null);

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}

const triggerProcessing = (id: string) => postJson('/api/process', { id }).then(() => undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [pendingItems, setPendingItems] = useState<OutboxItem[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState(0);

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
      upsert: async (userId, items) => {
        const { data, error } = await supabase
          .from('captures')
          .upsert(items.map((i) => ({ ...i, user_id: userId })), { onConflict: 'user_id,client_id' })
          .select('id');
        if (error) throw error;
        return data.map((r) => r.id as string);
      },
      process: triggerProcessing,
    }).catch((err) => log.error('sync failed', { err }));

    const items = await listOutbox().catch((err) => {
      log.error('listOutbox failed', { err });
      return null;
    });
    if (items) setPendingItems(items);
    setLastSyncAt(Date.now());
  }, []);

  const save = useCallback(async (text: string) => {
    const item = await addToOutbox(text);
    if (!item) return false;
    setPendingItems(await listOutbox());
    void syncNow();
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
      listUnprocessed: async () => {
        const { data, error } = await supabase
          .from('captures')
          .select('id')
          .in('processing', ['pending', 'failed'])
          .lt('processing_attempts', MAX_AUTO_ATTEMPTS);
        if (error) {
          log.error('listUnprocessed failed', { message: error.message });
          return [];
        }
        return data.map((r) => r.id as string);
      },
      process: triggerProcessing,
    }).then(syncNow).catch((err) => log.error('startup retry failed', { err }));

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void syncNow();
    });
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      authListener.subscription.unsubscribe();
    };
  }, [syncNow]);

  return (
    <SyncContext.Provider value={{ pendingItems, lastSyncAt, save, syncNow }}>
      {children}
    </SyncContext.Provider>
  );
}
