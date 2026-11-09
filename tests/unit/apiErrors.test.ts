import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiErrorMessage, API_ERROR_MESSAGES } from '@/lib/api';

// The routes must never put an exception's text into the response: it can hold
// internal details. These tests make every route path fail with a "secret"
// message and check that only the fixed error code reaches the client.
const SECRET = 'relation "captures" does not exist at db-internal-host:5432';

vi.mock('@/lib/server/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/route')>();
  return { ...actual, requireUser: vi.fn(async () => ({ db: {}, user: { id: 'u1' } })) };
});
vi.mock('@/lib/server/captureRepo', () => ({ makeCaptureRepo: () => ({}) }));
vi.mock('@/lib/server/digestRepo', () => ({ makeDigestRepo: () => ({}) }));
const processCapture = vi.fn();
vi.mock('@/lib/server/processCapture', () => ({ processCapture: (...a: unknown[]) => processCapture(...a) }));
const specForCapture = vi.fn();
vi.mock('@/lib/server/specCapture', () => ({ specForCapture: (...a: unknown[]) => specForCapture(...a) }));
const getOrCreateDigest = vi.fn();
vi.mock('@/lib/server/digest', () => ({ getOrCreateDigest: (...a: unknown[]) => getOrCreateDigest(...a) }));

const ID = '00000000-0000-4000-8000-000000000001';
const post = (body: unknown) =>
  new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });
const digestBody = { period: 'day', period_start: '2026-11-08', from: '2026-11-08T00:00:00Z', to: '2026-11-09T00:00:00Z' };

async function expectOnlyCode(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: code });
  expect(text).not.toContain('captures');
}

beforeEach(() => vi.clearAllMocks());

describe('API routes do not leak error details', () => {
  it('process: thrown error → 500 internal_error', async () => {
    processCapture.mockRejectedValue(new Error(SECRET));
    const { POST } = await import('@/app/api/process/route');
    await expectOnlyCode(await POST(post({ id: ID })), 500, 'internal_error');
  });

  it('process: AI failure outcome → 502 ai_failed without its message', async () => {
    processCapture.mockResolvedValue({ outcome: 'failed', error: SECRET });
    const { POST } = await import('@/app/api/process/route');
    await expectOnlyCode(await POST(post({ id: ID })), 502, 'ai_failed');
  });

  it('spec: thrown error → 502 ai_failed', async () => {
    specForCapture.mockRejectedValue(new Error(SECRET));
    const { POST } = await import('@/app/api/spec/route');
    await expectOnlyCode(await POST(post({ id: ID })), 502, 'ai_failed');
  });

  it('digest: thrown error → 502 ai_failed', async () => {
    getOrCreateDigest.mockRejectedValue(new Error(SECRET));
    const { POST } = await import('@/app/api/digest/route');
    await expectOnlyCode(await POST(post(digestBody)), 502, 'ai_failed');
  });

  it('invalid body → 400 bad_request without the validation text', async () => {
    const { POST } = await import('@/app/api/process/route');
    await expectOnlyCode(await POST(post({ id: 'captures-not-a-uuid' })), 400, 'bad_request');
  });
});

describe('apiErrorMessage', () => {
  it('maps a known code to its message', () => {
    expect(apiErrorMessage('rate_limited', 429)).toBe(API_ERROR_MESSAGES.rate_limited);
  });

  it('falls back to the HTTP status for anything else', () => {
    expect(apiErrorMessage('toString', 500)).toBe('Request failed (HTTP 500).');
    expect(apiErrorMessage(undefined, 503)).toBe('Request failed (HTTP 503).');
  });
});
