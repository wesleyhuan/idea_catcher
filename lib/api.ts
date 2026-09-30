import { logger } from '@/lib/logger';

const log = logger('api');

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    log.error('request failed', { url, status: res.status, data });
    throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}
