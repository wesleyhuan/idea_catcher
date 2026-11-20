import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { enforceRateLimit } from '@/lib/server/route';

// The counting itself is SQL (migration 0006); these check what the app sends and how it reacts.
const db = (result: { data?: unknown; error?: unknown }) => {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
};

describe('checkRateLimit', () => {
  it('asks Postgres to count one hit in the bucket with its per-minute limit', async () => {
    const { rpc, client } = db({ data: true });
    expect(await checkRateLimit(client, 'spec')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('check_rate_limit', {
      p_bucket: 'spec', p_limit: RATE_LIMITS.spec, p_window_seconds: 60,
    });
  });

  it('returns false over the limit', async () => {
    expect(await checkRateLimit(db({ data: false }).client, 'process')).toBe(false);
  });

  it('throws when the count fails instead of treating it as allowed', async () => {
    const error = { message: 'connection refused' };
    await expect(checkRateLimit(db({ error }).client, 'digest')).rejects.toBe(error);
  });
});

describe('enforceRateLimit', () => {
  it('lets the request through within the limit', async () => {
    expect(await enforceRateLimit(db({ data: true }).client, 'spec')).toBeNull();
  });

  it('answers 429 rate_limited over the limit', async () => {
    const res = await enforceRateLimit(db({ data: false }).client, 'spec');
    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({ error: 'rate_limited' });
  });

  it('fails closed with 500 internal_error when the count fails, without leaking the error', async () => {
    const res = await enforceRateLimit(db({ error: { message: 'db-internal-host:5432' } }).client, 'spec');
    expect(res?.status).toBe(500);
    expect(await res?.text()).toBe(JSON.stringify({ error: 'internal_error' }));
  });
});
