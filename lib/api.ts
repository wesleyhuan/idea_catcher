import { logger } from '@/lib/logger';

const log = logger('api');

// The only error codes the API routes send. The server never sends free text,
// so the client turns each code into a readable message here.
export const API_ERROR_MESSAGES = {
  unauthorized: 'Your session has expired. Please sign in again.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  bad_request: 'The request was invalid.',
  not_found: 'That capture no longer exists.',
  ai_failed: 'The AI service failed. Try again in a moment.',
  internal_error: 'Something went wrong on the server. Try again.',
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_MESSAGES;

export function apiErrorMessage(code: unknown, status: number): string {
  return typeof code === 'string' && Object.hasOwn(API_ERROR_MESSAGES, code)
    ? API_ERROR_MESSAGES[code as ApiErrorCode]
    : `Request failed (HTTP ${status}).`;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    log.error('request failed', { url, status: res.status, data });
    throw new Error(apiErrorMessage(data.error, res.status));
  }
  return data as T;
}
