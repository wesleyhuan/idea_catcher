import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logger } from '@/lib/logger';

const log = logger('supabase-server');

export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        // `headers` (Cache-Control/Expires/Pragma) carries no response object to
        // attach to here — cookies() gives only a mutable store, not a Response.
        // proxy.ts sets those headers on every request it handles (its matcher
        // covers all non-static routes), which is where the refresh actually lands.
        setAll: (list, _headers) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch (err) {
            // Server Components cannot set cookies; proxy.ts refreshes the session instead.
            log.debug('cookie set skipped (read-only context)', { message: (err as Error).message });
          }
        },
      },
    },
  );
}
