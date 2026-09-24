# Idea Catcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PWA where you capture ideas/chores in seconds on an iPhone, Claude organizes them, and you act on them from a laptop inbox.

**Architecture:** One Next.js (App Router, TypeScript) app on Vercel. Captures go to an IndexedDB outbox first, sync to Supabase Postgres, then a server route asks Claude Haiku to classify/summarize. The inbox reads Supabase with realtime updates; spec and digest are on-demand Claude Sonnet calls. AI logic lives in pure functions with injected dependencies so it is unit-testable without network or database.

**Tech Stack:** Next.js 16, React, TypeScript, Tailwind CSS v4 (+ typography plugin), Supabase (`@supabase/supabase-js`, `@supabase/ssr`), `@anthropic-ai/sdk`, zod, `idb`, `react-markdown`, Vitest (+ `fake-indexeddb`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-idea-catcher-design.md`

## Global Constraints

- Raw capture text is saved locally before any network call and is never modified after insert.
- AI output language: the note's dominant language; Chinese → 繁體中文 (never Simplified); technical terms stay English.
- Models (in `lib/ai/models.ts` only): processing `claude-haiku-4-5-20251001`; spec and digest `claude-sonnet-5`.
- Timeouts: Haiku 30s, Sonnet 90s; one automatic SDK retry (`maxRetries: 1`).
- Auto-processing retries stop at `processing_attempts >= 3`; manual Retry is always allowed.
- Rate limits per user: `/api/process` 60/min, `/api/spec` 10/min, `/api/digest` 10/min → HTTP 429. In-memory, best effort.
- `ANTHROPIC_API_KEY` is server-only. No Supabase service-role key; API routes use the caller's session so RLS applies.
- API errors are JSON `{ error, detail }` with a correct status code.
- Logging: `lib/logger` with module prefix `[module]`; log outbox reads/writes, Supabase results, every Claude call (model, id, latency, usage), zod failures with raw model output, every caught error with the actual error object. Never swallow errors silently.
- Login: Supabase **email one-time code** typed into the app (not a magic link).
- Text inputs use `text-base` (16px) or larger so iOS Safari does not zoom.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).

## Review Focus

1. **Model wraps JSON in ```json fences or adds prose** → the capture must still be processed, not marked failed. (Task 4 test)
2. **A new capture is saved while a sync is already running** → it must still sync in that cycle, not wait for the next app open. (Task 7 test)
3. **User edits a capture while its AI processing is in flight** → the late AI result must not overwrite the edit. (Task 6 test)
4. **Capture made at 00:30 Taipei time** → it belongs to *that* local day's and week's digest, not the UTC day. (Task 11 test)
5. **Session expired or network error during sync** (iPhone left for days, or on flaky 4G) → outbox items stay in the outbox; nothing is deleted. (Task 7 test)

Also pinned: very long dictation (>8000 chars) is truncated in the prompt, not rejected (Task 5 test).

---

## File Structure

```
app/
  layout.tsx                 root layout: SyncProvider, Nav, ServiceWorker
  globals.css                Tailwind + typography plugin
  page.tsx                   Capture page
  inbox/page.tsx             Inbox page
  login/page.tsx             Email-code login
  manifest.ts                PWA manifest
  apple-icon.tsx             iOS home-screen icon (generated PNG)
  icons/[size]/route.tsx     manifest icons (generated PNG)
  api/process/route.ts       POST: AI-process one capture
  api/spec/route.ts          POST: generate spec for one capture
  api/digest/route.ts        POST: get/create digest for a period
components/
  Nav.tsx, ServiceWorker.tsx, IconArt.tsx, Markdown.tsx
  SyncProvider.tsx           outbox + sync wiring, React context
  capture/CaptureBox.tsx, capture/RecentCaptures.tsx
  inbox/Inbox.tsx, FilterBar.tsx, CaptureCard.tsx, CaptureDetail.tsx, DigestPanel.tsx
lib/
  logger.ts                  module-prefixed console logging
  types.ts                   shared enums + Capture type
  api.ts                     browser postJson helper
  filters.ts                 inbox filter logic
  labels.ts                  display labels/icons, timeAgo
  period.ts                  day/week local-time ranges for digests
  outbox.ts                  IndexedDB outbox
  sync.ts                    sync + retry logic (injected deps)
  rateLimit.ts               in-memory per-key limiter
  claude.ts                  Anthropic SDK wrapper (CompleteFn)
  supabase/browser.ts, supabase/server.ts, supabase/proxy.ts
  ai/models.ts, ai/types.ts, ai/json.ts, ai/process.ts, ai/spec.ts, ai/digest.ts
  server/route.ts            requireUser, jsonError
  server/captureRepo.ts      Supabase data access for captures
  server/processCapture.ts   processing orchestration
  server/specCapture.ts      spec orchestration
  server/digestRepo.ts, server/digest.ts
proxy.ts                     session refresh + login redirect
supabase/migrations/0001_init.sql
tests/unit/*.test.ts, tests/e2e/*.spec.ts
vitest.config.ts, playwright.config.ts, README.md
```

---

### Task 1: Scaffold project, test runner and logger

**Files:**
- Create: Next.js scaffold (via `create-next-app`), `vitest.config.ts`, `lib/logger.ts`
- Modify: `package.json` (scripts), `.gitignore`
- Test: `tests/unit/logger.test.ts`

**Interfaces:**
- Produces: `logger(module: string): { debug, info, warn, error }`, each `(msg: string, ctx?: Record<string, unknown>) => void`, printing `[module] msg` then `ctx` if given.

- [ ] **Step 1: Scaffold Next.js into the existing folder**

```bash
cd C:/Users/wesle/Desktop/claude_code/idea_catcher
npx create-next-app@16 . --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --turbopack --yes
```

Expected: project files created; `docs/` untouched. If it refuses because the folder is not empty, scaffold into `../idea_catcher_tmp` with the same flags, then move everything except `.git` into this folder and delete the temp folder.

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk zod idb react-markdown
npm install -D vitest fake-indexeddb @playwright/test @tailwindcss/typography
```

- [ ] **Step 3: Add Vitest config and scripts**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
```

In `package.json` `"scripts"` add:

```json
"test": "vitest run",
"test:e2e": "playwright test"
```

Append to `.gitignore`:

```
/test-results
/playwright-report
```

- [ ] **Step 4: Write the failing logger test**

`tests/unit/logger.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';

afterEach(() => vi.restoreAllMocks());

describe('logger', () => {
  it('prefixes the module and passes context', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger('sync').info('hello', { n: 1 });
    expect(spy).toHaveBeenCalledWith('[sync] hello', { n: 1 });
  });

  it('omits context when not given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger('api/process').error('boom');
    expect(spy).toHaveBeenCalledWith('[api/process] boom');
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run tests/unit/logger.test.ts`
Expected: FAIL — cannot resolve `@/lib/logger`.

- [ ] **Step 6: Implement the logger**

`lib/logger.ts`:

```ts
type Level = 'debug' | 'info' | 'warn' | 'error';
type Context = Record<string, unknown>;

export function logger(module: string) {
  const at = (level: Level) => (msg: string, ctx?: Context) =>
    console[level](`[${module}] ${msg}`, ...(ctx ? [ctx] : []));
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
```

- [ ] **Step 7: Run tests and the dev build**

Run: `npm test` → PASS (2 tests). Run: `npm run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and logger" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database schema and shared types

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `lib/types.ts`
- Test: `tests/unit/types.test.ts`

**Interfaces:**
- Produces (in `lib/types.ts`): const arrays `CAPTURE_TYPES`, `CONTEXTS`, `EFFORTS`, `STATUSES`, `PERIODS`; types `CaptureType`, `CaptureContext`, `CaptureEffort`, `CaptureStatus`, `ProcessingState`, `Period`, `Capture`.

- [ ] **Step 1: USER ACTION — create the Supabase project**

Ask the user to: create a project at supabase.com, then copy **Project URL** and **publishable (anon) key** from Project Settings → API into `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
ANTHROPIC_API_KEY=sk-ant-...
```

Confirm `.env*` is in `.gitignore` (create-next-app adds it).

- [ ] **Step 2: Write the migration**

`supabase/migrations/0001_init.sql`:

```sql
create type capture_status   as enum ('inbox', 'done', 'archived');
create type processing_state as enum ('pending', 'done', 'failed');
create type capture_type     as enum ('idea', 'todo', 'reminder', 'reference', 'question');
create type capture_context  as enum ('laptop', 'phone', 'anywhere');
create type capture_effort   as enum ('quick', 'medium', 'long');
create type digest_period    as enum ('day', 'week');

create table captures (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  client_id           uuid not null,
  raw_text            text not null check (length(trim(raw_text)) > 0),
  captured_at         timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  status              capture_status not null default 'inbox',
  processing          processing_state not null default 'pending',
  processing_error    text,
  processing_attempts int not null default 0,
  type                capture_type,
  title               text,
  summary             text,
  next_steps          jsonb not null default '[]'::jsonb,
  context             capture_context,
  effort              capture_effort,
  user_edited         boolean not null default false,
  spec_md             text,
  unique (user_id, client_id)
);

create index captures_inbox_idx on captures (user_id, status, captured_at desc);
create index captures_processing_idx on captures (user_id, processing);

-- raw_text is immutable after insert
create function captures_before_update() returns trigger language plpgsql as $$
begin
  new.raw_text := old.raw_text;
  new.updated_at := now();
  return new;
end $$;
create trigger captures_before_update before update on captures
  for each row execute function captures_before_update();

create table digests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  period        digest_period not null,
  period_start  date not null,
  content_md    text not null,
  capture_count int not null,
  created_at    timestamptz not null default now(),
  unique (user_id, period, period_start)
);

alter table captures enable row level security;
alter table digests  enable row level security;

create policy "own captures" on captures for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own digests" on digests for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table captures;
```

- [ ] **Step 3: USER ACTION — apply the migration and set the email template**

Ask the user to: open Supabase → SQL Editor, paste the file, run it. Then Authentication → Email Templates → **Magic Link**: replace the body with:

```html
<h2>Idea Catcher sign-in code</h2>
<p>Your code: <strong>{{ .Token }}</strong></p>
```

Then Authentication → Users → **Add user** (email + password, auto-confirm) for the E2E test account; note the credentials for Task 13.

- [ ] **Step 4: Write the failing types test**

`tests/unit/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CAPTURE_TYPES, CONTEXTS, EFFORTS, STATUSES, PERIODS } from '@/lib/types';

describe('shared enums match the SQL enums', () => {
  it('has the same values as 0001_init.sql', () => {
    expect(CAPTURE_TYPES).toEqual(['idea', 'todo', 'reminder', 'reference', 'question']);
    expect(CONTEXTS).toEqual(['laptop', 'phone', 'anywhere']);
    expect(EFFORTS).toEqual(['quick', 'medium', 'long']);
    expect(STATUSES).toEqual(['inbox', 'done', 'archived']);
    expect(PERIODS).toEqual(['day', 'week']);
  });
});
```

Run: `npx vitest run tests/unit/types.test.ts` → FAIL (module missing).

- [ ] **Step 5: Implement the types**

`lib/types.ts`:

```ts
export const CAPTURE_TYPES = ['idea', 'todo', 'reminder', 'reference', 'question'] as const;
export const CONTEXTS = ['laptop', 'phone', 'anywhere'] as const;
export const EFFORTS = ['quick', 'medium', 'long'] as const;
export const STATUSES = ['inbox', 'done', 'archived'] as const;
export const PERIODS = ['day', 'week'] as const;

export type CaptureType = (typeof CAPTURE_TYPES)[number];
export type CaptureContext = (typeof CONTEXTS)[number];
export type CaptureEffort = (typeof EFFORTS)[number];
export type CaptureStatus = (typeof STATUSES)[number];
export type Period = (typeof PERIODS)[number];
export type ProcessingState = 'pending' | 'done' | 'failed';

export type Capture = {
  id: string;
  user_id: string;
  client_id: string;
  raw_text: string;
  captured_at: string;
  status: CaptureStatus;
  processing: ProcessingState;
  processing_error: string | null;
  processing_attempts: number;
  type: CaptureType | null;
  title: string | null;
  summary: string | null;
  next_steps: string[];
  context: CaptureContext | null;
  effort: CaptureEffort | null;
  user_edited: boolean;
  spec_md: string | null;
};
```

- [ ] **Step 6: Run tests** — `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase lib/types.ts tests/unit/types.test.ts
git commit -m "feat: add database schema with RLS and shared types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Supabase clients, auth proxy and email-code login

**Files:**
- Create: `lib/supabase/browser.ts`, `lib/supabase/server.ts`, `lib/supabase/proxy.ts`, `proxy.ts`, `lib/server/route.ts`, `app/login/page.tsx`

**Interfaces:**
- Produces: `createClient()` (browser, singleton) from `@/lib/supabase/browser`; `async createClient()` (server) from `@/lib/supabase/server`; `requireUser(): Promise<{ db: SupabaseClient; user: User } | null>` and `jsonError(status: number, error: string, detail?: string): NextResponse` from `@/lib/server/route`.

- [ ] **Step 1: Browser client**

`lib/supabase/browser.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}
```

- [ ] **Step 2: Server client**

`lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Components cannot set cookies; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Session proxy (Next 16 `proxy.ts`; on Next 15 name it `middleware.ts` and export `middleware`)**

`lib/supabase/proxy.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PREFIXES = ['/login', '/api'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const isPublic = PUBLIC_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}
```

`proxy.ts`:

```ts
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|apple-icon|manifest.webmanifest|sw.js).*)'],
};
```

- [ ] **Step 4: Route helpers**

`lib/server/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

const log = logger('route');

export async function requireUser() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error) log.warn('getUser failed', { message: error.message });
  return user ? { db, user } : null;
}

export function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json({ error, detail }, { status });
}
```

- [ ] **Step 5: Login page**

`app/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { logger } from '@/lib/logger';

const log = logger('login');
const passwordLogin = process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN === 'true';
const input = 'w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base dark:border-neutral-700';
const button = 'w-full rounded-lg bg-amber-500 px-3 py-2 font-medium text-white disabled:opacity-50';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error: { message: string } | null }>, onOk: () => void) {
    setBusy(true);
    setError(null);
    const { error } = await action();
    setBusy(false);
    if (error) {
      log.error('auth step failed', { email, message: error.message });
      setError(error.message);
      return;
    }
    onOk();
  }

  const supabase = createClient();
  const sendCode = () => run(() => supabase.auth.signInWithOtp({ email }), () => setCodeSent(true));
  const verify = () =>
    run(
      () => (passwordLogin
        ? supabase.auth.signInWithPassword({ email, password: secret })
        : supabase.auth.verifyOtp({ email, token: secret.trim(), type: 'email' })),
      () => router.replace('/'),
    );

  const showSecret = codeSent || passwordLogin;

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Idea Catcher</h1>
      <input className={input} type="email" autoComplete="email" placeholder="you@example.com"
        aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {showSecret && (
        <input className={input} aria-label={passwordLogin ? 'Password' : 'Code'}
          type={passwordLogin ? 'password' : 'text'} inputMode={passwordLogin ? undefined : 'numeric'}
          autoComplete={passwordLogin ? 'current-password' : 'one-time-code'}
          placeholder={passwordLogin ? 'Password' : '6-digit code from your email'}
          value={secret} onChange={(e) => setSecret(e.target.value)} />
      )}
      {showSecret ? (
        <button className={button} disabled={busy || !email || !secret} onClick={verify}>Sign in</button>
      ) : (
        <button className={button} disabled={busy || !email} onClick={sendCode}>Email me a code</button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Verify manually**

Run `npm run dev`, open http://localhost:3000 → redirected to `/login`. Enter your email → code arrives → enter it → redirected to `/`. Run `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Supabase clients, auth proxy and email-code login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Claude wrapper, model config and JSON extraction

**Files:**
- Create: `lib/ai/models.ts`, `lib/ai/types.ts`, `lib/ai/json.ts`, `lib/claude.ts`
- Test: `tests/unit/json.test.ts`

**Interfaces:**
- Produces: `MODELS = { process, spec, digest }`; `type CompleteRequest = { model; system; prompt; maxTokens; timeoutMs; tag }`; `type CompleteFn = (req: CompleteRequest) => Promise<string>`; `extractJson(text: string): unknown` (throws on no/invalid JSON); `claudeComplete: CompleteFn`.

- [ ] **Step 1: Write the failing test (Review Focus #1)**

`tests/unit/json.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractJson } from '@/lib/ai/json';

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses an object inside ```json fences', () => {
    expect(extractJson('```json\n{"type":"idea"}\n```')).toEqual({ type: 'idea' });
  });

  it('parses an object surrounded by prose', () => {
    expect(extractJson('Here you go:\n{"title":"買牛奶 milk"}\nHope this helps!')).toEqual({ title: '買牛奶 milk' });
  });

  it('throws when there is no object', () => {
    expect(() => extractJson('sorry, I cannot')).toThrow('No JSON object');
  });

  it('throws on broken JSON', () => {
    expect(() => extractJson('{"a":')).toThrow();
  });
});
```

Run: `npx vitest run tests/unit/json.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement config, types and extraction**

`lib/ai/models.ts`:

```ts
export const MODELS = {
  process: 'claude-haiku-4-5-20251001',
  spec: 'claude-sonnet-5',
  digest: 'claude-sonnet-5',
} as const;

export const TIMEOUTS = { haiku: 30_000, sonnet: 90_000 } as const;
```

`lib/ai/types.ts`:

```ts
export type CompleteRequest = {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  tag: string; // shows up in logs, e.g. "process:<id>"
};

export type CompleteFn = (req: CompleteRequest) => Promise<string>;
```

`lib/ai/json.ts`:

```ts
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}
```

- [ ] **Step 3: Run test** — `npx vitest run tests/unit/json.test.ts` → PASS (5 tests).

- [ ] **Step 4: Implement the Claude wrapper**

`lib/claude.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { CompleteFn } from '@/lib/ai/types';
import { logger } from '@/lib/logger';

const log = logger('claude');
let client: Anthropic | null = null;

export const claudeComplete: CompleteFn = async ({ model, system, prompt, maxTokens, timeoutMs, tag }) => {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const started = Date.now();
  try {
    const msg = await client.messages.create(
      { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] },
      { timeout: timeoutMs, maxRetries: 1 },
    );
    log.info('ok', { tag, model, ms: Date.now() - started, usage: msg.usage, stop: msg.stop_reason });
    if (msg.stop_reason === 'max_tokens') log.warn('output truncated', { tag, maxTokens });
    return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  } catch (err) {
    log.error('request failed', { tag, model, ms: Date.now() - started, err });
    throw err;
  }
};
```

- [ ] **Step 5: Type-check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ai lib/claude.ts tests/unit/json.test.ts
git commit -m "feat: add Claude wrapper, model config and JSON extraction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Capture processing prompt and validation

**Files:**
- Create: `lib/ai/process.ts`
- Test: `tests/unit/process.test.ts`

**Interfaces:**
- Consumes: `CompleteFn`, `MODELS`, `TIMEOUTS`, `extractJson`, `claudeComplete`, enums from `lib/types`.
- Produces: `ProcessResultSchema` (zod), `type ProcessResult = { type; title; summary; next_steps: string[]; context; effort }`, `MAX_PROMPT_CHARS = 8000`, `buildProcessPrompt(rawText): string`, `parseProcessResult(text): ProcessResult` (throws), `processText(rawText, complete?): Promise<ProcessResult>`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/process.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildProcessPrompt, MAX_PROMPT_CHARS, parseProcessResult, processText } from '@/lib/ai/process';

const recorded = {
  zhTodo: '{"type":"todo","title":"修理腳踏車","summary":"週末前把腳踏車的煞車修好。","next_steps":["查附近車行營業時間","週六早上送修"],"context":"phone","effort":"medium"}',
  enIdeaFenced: '```json\n{"type":"idea","title":"Idea capture PWA","summary":"An app to capture ideas fast.","next_steps":["Write a spec"],"context":"laptop","effort":"long"}\n```',
};

describe('parseProcessResult', () => {
  it('accepts a recorded Chinese todo response', () => {
    const r = parseProcessResult(recorded.zhTodo);
    expect(r.type).toBe('todo');
    expect(r.next_steps).toHaveLength(2);
  });

  it('accepts a fenced response', () => {
    expect(parseProcessResult(recorded.enIdeaFenced).context).toBe('laptop');
  });

  it('rejects an unknown type', () => {
    expect(() => parseProcessResult(recorded.zhTodo.replace('"todo"', '"chore"'))).toThrow('Invalid AI result');
  });

  it('rejects a missing field', () => {
    expect(() => parseProcessResult('{"type":"idea","title":"x"}')).toThrow('Invalid AI result');
  });
});

describe('buildProcessPrompt', () => {
  it('wraps the raw text', () => {
    expect(buildProcessPrompt('buy milk 買牛奶')).toContain('<capture>\nbuy milk 買牛奶\n</capture>');
  });

  it('truncates very long dictation instead of rejecting it', () => {
    const prompt = buildProcessPrompt('a'.repeat(MAX_PROMPT_CHARS + 500));
    expect(prompt).toContain('a'.repeat(MAX_PROMPT_CHARS));
    expect(prompt).not.toContain('a'.repeat(MAX_PROMPT_CHARS + 1));
    expect(prompt).toContain('[truncated]');
  });
});

describe('processText', () => {
  it('calls the Haiku model and returns the parsed result', async () => {
    const complete = vi.fn().mockResolvedValue(recorded.zhTodo);
    const r = await processText('腳踏車煞車壞了 週末前要修', complete);
    expect(r.title).toBe('修理腳踏車');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5-20251001', timeoutMs: 30_000 }));
  });
});
```

Run: `npx vitest run tests/unit/process.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

`lib/ai/process.ts`:

```ts
import { z } from 'zod';
import { CAPTURE_TYPES, CONTEXTS, EFFORTS } from '@/lib/types';
import type { CompleteFn } from '@/lib/ai/types';
import { MODELS, TIMEOUTS } from '@/lib/ai/models';
import { extractJson } from '@/lib/ai/json';
import { claudeComplete } from '@/lib/claude';
import { logger } from '@/lib/logger';

const log = logger('ai/process');

export const MAX_PROMPT_CHARS = 8000;

export const ProcessResultSchema = z.object({
  type: z.enum(CAPTURE_TYPES),
  title: z.string().min(1).max(120),
  summary: z.string().max(1000),
  next_steps: z.array(z.string().min(1).max(300)).max(5),
  context: z.enum(CONTEXTS),
  effort: z.enum(EFFORTS),
});
export type ProcessResult = z.infer<typeof ProcessResultSchema>;

export const LANGUAGE_RULE =
  "Write in the note's dominant language. If it is Chinese, use Traditional Chinese (繁體中文), never Simplified. Keep technical terms in English.";

const SYSTEM = `You organize quick personal captures (ideas, chores) that were typed or dictated on a phone, often in mixed Chinese and English.
Reply with ONLY a JSON object, no prose, with exactly these keys:
- "type": one of "idea", "todo", "reminder", "reference", "question"
- "title": a short clean title, at most 60 characters
- "summary": 1-2 sentences
- "next_steps": 1-3 concrete actions (array of strings)
- "context": where the next step is best done: "laptop", "phone" or "anywhere"
- "effort": "quick" (under 15 min), "medium" (under 1 hour) or "long"
${LANGUAGE_RULE} Fix obvious dictation mistakes.`;

export function buildProcessPrompt(rawText: string): string {
  const text = rawText.length > MAX_PROMPT_CHARS
    ? `${rawText.slice(0, MAX_PROMPT_CHARS)}\n[truncated]`
    : rawText;
  return `<capture>\n${text}\n</capture>`;
}

export function parseProcessResult(text: string): ProcessResult {
  const result = ProcessResultSchema.safeParse(extractJson(text));
  if (!result.success) {
    log.error('model output failed validation', { text, issues: result.error.issues });
    throw new Error(`Invalid AI result: ${result.error.message}`);
  }
  return result.data;
}

export async function processText(rawText: string, complete: CompleteFn = claudeComplete): Promise<ProcessResult> {
  const text = await complete({
    model: MODELS.process,
    system: SYSTEM,
    prompt: buildProcessPrompt(rawText),
    maxTokens: 800,
    timeoutMs: TIMEOUTS.haiku,
    tag: 'process',
  });
  return parseProcessResult(text);
}
```

- [ ] **Step 3: Run tests** — `npx vitest run tests/unit/process.test.ts` → PASS (7 tests).

- [ ] **Step 4: Commit**

```bash
git add lib/ai/process.ts tests/unit/process.test.ts
git commit -m "feat: add capture processing prompt and validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rate limiter, processing orchestration and `/api/process`

**Files:**
- Create: `lib/rateLimit.ts`, `lib/server/captureRepo.ts`, `lib/server/processCapture.ts`, `app/api/process/route.ts`
- Test: `tests/unit/rateLimit.test.ts`, `tests/unit/processCapture.test.ts`

**Interfaces:**
- Consumes: `processText`, `ProcessResult`, `Capture`, `requireUser`, `jsonError`.
- Produces:
  - `checkRateLimit(key: string, limit: number, windowMs?: number, now?: number): boolean`
  - `type CaptureRepo = { get(id): Promise<Capture | null>; markAttempt(id, attempts): Promise<void>; saveResult(id, r: ProcessResult): Promise<boolean>; markFailed(id, message): Promise<void>; saveSpec(id, md): Promise<void> }`
  - `makeCaptureRepo(db: SupabaseClient): CaptureRepo`
  - `type ProcessOutcome = { outcome: 'done' | 'skipped' | 'failed' | 'not_found'; error?: string }`
  - `processCapture(repo, id, ai?): Promise<ProcessOutcome>`
  - HTTP `POST /api/process { id }` → 200 `{ outcome }` | 400 | 401 | 404 | 429 | 502 `{ error: 'ai_failed', detail }`

- [ ] **Step 1: Write the failing rate-limit test**

`tests/unit/rateLimit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '@/lib/rateLimit';

describe('checkRateLimit', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const key = `t1-${Math.random()}`;
    expect(checkRateLimit(key, 2, 60_000, 0)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000, 10)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000, 20)).toBe(false);
  });

  it('allows again after the window passes', () => {
    const key = `t2-${Math.random()}`;
    checkRateLimit(key, 1, 1000, 0);
    expect(checkRateLimit(key, 1, 1000, 500)).toBe(false);
    expect(checkRateLimit(key, 1, 1000, 1001)).toBe(true);
  });

  it('keeps keys independent', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    checkRateLimit(a, 1, 1000, 0);
    expect(checkRateLimit(b, 1, 1000, 0)).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/rateLimit.test.ts` → FAIL.

- [ ] **Step 2: Implement the limiter**

`lib/rateLimit.ts`:

```ts
// Best-effort, per server instance. Move to a shared store before opening to other users.
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  hits.set(key, recent);
  return allowed;
}
```

Run: `npx vitest run tests/unit/rateLimit.test.ts` → PASS.

- [ ] **Step 3: Write the failing orchestration tests (includes Review Focus #3)**

`tests/unit/processCapture.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { processCapture } from '@/lib/server/processCapture';
import type { CaptureRepo } from '@/lib/server/captureRepo';
import type { Capture } from '@/lib/types';
import type { ProcessResult } from '@/lib/ai/process';

const result: ProcessResult = {
  type: 'todo', title: '買牛奶', summary: '回家路上買牛奶。', next_steps: ['去超市'], context: 'phone', effort: 'quick',
};

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'c1', user_id: 'u1', client_id: 'k1', raw_text: '買牛奶', captured_at: '2026-09-24T00:00:00Z',
    status: 'inbox', processing: 'pending', processing_error: null, processing_attempts: 0,
    type: null, title: null, summary: null, next_steps: [], context: null, effort: null,
    user_edited: false, spec_md: null, ...overrides,
  };
}

function fakeRepo(row: Capture | null, saveResultReturns = true) {
  return {
    get: vi.fn().mockResolvedValue(row),
    markAttempt: vi.fn().mockResolvedValue(undefined),
    saveResult: vi.fn().mockResolvedValue(saveResultReturns),
    markFailed: vi.fn().mockResolvedValue(undefined),
    saveSpec: vi.fn().mockResolvedValue(undefined),
  } satisfies CaptureRepo;
}

describe('processCapture', () => {
  it('returns not_found when the row is missing or belongs to someone else (RLS hides it)', async () => {
    const repo = fakeRepo(null);
    const ai = vi.fn();
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'not_found' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('skips user-edited captures without calling the AI', async () => {
    const ai = vi.fn();
    expect(await processCapture(fakeRepo(capture({ user_edited: true })), 'c1', ai)).toEqual({ outcome: 'skipped' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('skips already processed captures', async () => {
    const ai = vi.fn();
    expect(await processCapture(fakeRepo(capture({ processing: 'done' })), 'c1', ai)).toEqual({ outcome: 'skipped' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('saves the result and counts the attempt', async () => {
    const repo = fakeRepo(capture({ processing: 'failed', processing_attempts: 1 }));
    const ai = vi.fn().mockResolvedValue(result);
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'done' });
    expect(repo.markAttempt).toHaveBeenCalledWith('c1', 2);
    expect(repo.saveResult).toHaveBeenCalledWith('c1', result);
  });

  it('marks failed with the error message when the AI throws', async () => {
    const repo = fakeRepo(capture());
    const ai = vi.fn().mockRejectedValue(new Error('Invalid AI result: bad type'));
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'failed', error: 'Invalid AI result: bad type' });
    expect(repo.markFailed).toHaveBeenCalledWith('c1', 'Invalid AI result: bad type');
    expect(repo.saveResult).not.toHaveBeenCalled();
  });

  it('does not overwrite an edit made while the AI was running', async () => {
    const repo = fakeRepo(capture(), false); // saveResult's user_edited=false guard matched no row
    const ai = vi.fn().mockResolvedValue(result);
    expect(await processCapture(repo, 'c1', ai)).toEqual({ outcome: 'skipped' });
  });
});
```

Run: `npx vitest run tests/unit/processCapture.test.ts` → FAIL.

- [ ] **Step 4: Implement the repo**

`lib/server/captureRepo.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capture } from '@/lib/types';
import type { ProcessResult } from '@/lib/ai/process';

export type CaptureRepo = {
  get(id: string): Promise<Capture | null>;
  markAttempt(id: string, attempts: number): Promise<void>;
  /** Returns false when the user edited the capture meanwhile (nothing written). */
  saveResult(id: string, result: ProcessResult): Promise<boolean>;
  markFailed(id: string, message: string): Promise<void>;
  saveSpec(id: string, markdown: string): Promise<void>;
};

export function makeCaptureRepo(db: SupabaseClient): CaptureRepo {
  const captures = () => db.from('captures');
  const check = ({ error }: { error: unknown }) => {
    if (error) throw error;
  };

  return {
    async get(id) {
      const { data, error } = await captures().select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data as Capture | null;
    },
    async markAttempt(id, attempts) {
      check(await captures().update({ processing_attempts: attempts }).eq('id', id));
    },
    async saveResult(id, result) {
      const { data, error } = await captures()
        .update({ ...result, processing: 'done', processing_error: null })
        .eq('id', id)
        .eq('user_edited', false)
        .select('id');
      if (error) throw error;
      return data.length > 0;
    },
    async markFailed(id, message) {
      check(await captures().update({ processing: 'failed', processing_error: message }).eq('id', id));
    },
    async saveSpec(id, markdown) {
      check(await captures().update({ spec_md: markdown }).eq('id', id));
    },
  };
}
```

- [ ] **Step 5: Implement the orchestration**

`lib/server/processCapture.ts`:

```ts
import { processText, type ProcessResult } from '@/lib/ai/process';
import type { CaptureRepo } from '@/lib/server/captureRepo';
import { logger } from '@/lib/logger';

const log = logger('processCapture');

export type ProcessOutcome = { outcome: 'done' | 'skipped' | 'failed' | 'not_found'; error?: string };

export async function processCapture(
  repo: CaptureRepo,
  id: string,
  ai: (rawText: string) => Promise<ProcessResult> = processText,
): Promise<ProcessOutcome> {
  const capture = await repo.get(id);
  if (!capture) {
    log.warn('capture not found', { id });
    return { outcome: 'not_found' };
  }
  if (capture.user_edited || capture.processing === 'done') {
    log.debug('skip', { id, userEdited: capture.user_edited, processing: capture.processing });
    return { outcome: 'skipped' };
  }

  await repo.markAttempt(id, capture.processing_attempts + 1);
  try {
    const saved = await repo.saveResult(id, await ai(capture.raw_text));
    if (!saved) log.info('user edited during processing; result dropped', { id });
    return { outcome: saved ? 'done' : 'skipped' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('processing failed', { id, attempt: capture.processing_attempts + 1, err });
    await repo.markFailed(id, message);
    return { outcome: 'failed', error: message };
  }
}
```

Run: `npx vitest run tests/unit/processCapture.test.ts` → PASS (6 tests).

- [ ] **Step 6: Implement the route**

`app/api/process/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireUser } from '@/lib/server/route';
import { checkRateLimit } from '@/lib/rateLimit';
import { makeCaptureRepo } from '@/lib/server/captureRepo';
import { processCapture } from '@/lib/server/processCapture';
import { logger } from '@/lib/logger';

export const maxDuration = 60;
const log = logger('api/process');
const Body = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return jsonError(401, 'unauthorized');
  if (!checkRateLimit(`process:${auth.user.id}`, 60)) return jsonError(429, 'rate_limited');

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'bad_request', body.error.message);

  try {
    const result = await processCapture(makeCaptureRepo(auth.db), body.data.id);
    log.info('done', { id: body.data.id, outcome: result.outcome });
    if (result.outcome === 'not_found') return jsonError(404, 'not_found');
    if (result.outcome === 'failed') return jsonError(502, 'ai_failed', result.error);
    return NextResponse.json(result);
  } catch (err) {
    log.error('unexpected error', { id: body.data.id, err });
    return jsonError(500, 'internal_error', err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 7: Verify** — `npm test` → all PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add lib/rateLimit.ts lib/server app/api/process tests/unit
git commit -m "feat: add capture processing API with rate limit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Offline outbox, sync logic and SyncProvider

**Files:**
- Create: `lib/outbox.ts`, `lib/sync.ts`, `lib/api.ts`, `components/SyncProvider.tsx`
- Test: `tests/unit/outbox.test.ts`, `tests/unit/sync.test.ts`

**Interfaces:**
- Consumes: browser `createClient`, `logger`.
- Produces:
  - `type OutboxItem = { client_id: string; raw_text: string; captured_at: string }`
  - `addToOutbox(rawText: string, now?: Date): Promise<OutboxItem | null>` (null for blank), `listOutbox(): Promise<OutboxItem[]>` (oldest first), `removeFromOutbox(clientIds: string[]): Promise<void>`
  - `type SyncDeps = { list; remove; getUserId: () => Promise<string | null>; upsert: (userId, items) => Promise<string[]>; process: (id) => Promise<void> }`
  - `syncOutbox(deps): Promise<{ synced: number; remaining: number }>` — single-flight; re-runs once if called during a run
  - `retryUnprocessed(deps: { listUnprocessed: () => Promise<string[]>; process }): Promise<number>`
  - `postJson<T>(url, body): Promise<T>` (throws `Error(error field or HTTP status)`)
  - `<SyncProvider>` + `useSync(): { pendingItems: OutboxItem[]; save(text): Promise<boolean>; syncNow(): Promise<void>; lastSyncAt: number }`

- [ ] **Step 1: Write the failing outbox test**

`tests/unit/outbox.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addToOutbox, listOutbox, removeFromOutbox } from '@/lib/outbox';

beforeEach(async () => {
  await removeFromOutbox((await listOutbox()).map((i) => i.client_id));
});

describe('outbox', () => {
  it('stores trimmed text with a client id and capture time', async () => {
    const item = await addToOutbox('  buy milk 買牛奶  ', new Date('2026-09-24T01:00:00Z'));
    expect(item).toMatchObject({ raw_text: 'buy milk 買牛奶', captured_at: '2026-09-24T01:00:00.000Z' });
    expect(item!.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await listOutbox()).toEqual([item]);
  });

  it('ignores blank text', async () => {
    expect(await addToOutbox('   \n ')).toBeNull();
    expect(await listOutbox()).toEqual([]);
  });

  it('lists oldest first and removes by client id', async () => {
    const a = await addToOutbox('a', new Date('2026-09-24T02:00:00Z'));
    const b = await addToOutbox('b', new Date('2026-09-24T01:00:00Z'));
    expect((await listOutbox()).map((i) => i.raw_text)).toEqual(['b', 'a']);
    await removeFromOutbox([b!.client_id]);
    expect(await listOutbox()).toEqual([a]);
  });
});
```

Run: `npx vitest run tests/unit/outbox.test.ts` → FAIL.

- [ ] **Step 2: Implement the outbox**

`lib/outbox.ts`:

```ts
import { openDB } from 'idb';
import { logger } from '@/lib/logger';

export type OutboxItem = { client_id: string; raw_text: string; captured_at: string };

const log = logger('outbox');
const STORE = 'outbox';
const db = () =>
  openDB('idea-catcher', 1, {
    upgrade: (d) => d.createObjectStore(STORE, { keyPath: 'client_id' }),
  });

export async function addToOutbox(rawText: string, now = new Date()): Promise<OutboxItem | null> {
  const text = rawText.trim();
  if (!text) return null;
  const item = { client_id: crypto.randomUUID(), raw_text: text, captured_at: now.toISOString() };
  await (await db()).put(STORE, item);
  log.info('added', { client_id: item.client_id, chars: text.length });
  return item;
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const items: OutboxItem[] = await (await db()).getAll(STORE);
  log.debug('list', { count: items.length });
  return items.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
}

export async function removeFromOutbox(clientIds: string[]): Promise<void> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  await Promise.all([...clientIds.map((id) => tx.store.delete(id)), tx.done]);
  log.info('removed', { count: clientIds.length });
}
```

Run: `npx vitest run tests/unit/outbox.test.ts` → PASS.

- [ ] **Step 3: Write the failing sync tests (Review Focus #2 and #5)**

`tests/unit/sync.test.ts`:

```ts
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
    ...overrides,
  };
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
});

describe('retryUnprocessed', () => {
  it('processes every unprocessed id and returns the count', async () => {
    const process = vi.fn(async () => {});
    expect(await retryUnprocessed({ listUnprocessed: async () => ['x', 'y'], process })).toBe(2);
    expect(process).toHaveBeenCalledTimes(2);
  });
});
```

Run: `npx vitest run tests/unit/sync.test.ts` → FAIL.

- [ ] **Step 4: Implement sync**

`lib/sync.ts`:

```ts
import type { OutboxItem } from '@/lib/outbox';
import { logger } from '@/lib/logger';

const log = logger('sync');

export type SyncDeps = {
  list: () => Promise<OutboxItem[]>;
  remove: (clientIds: string[]) => Promise<void>;
  getUserId: () => Promise<string | null>;
  /** Upserts on (user_id, client_id); returns the row ids. */
  upsert: (userId: string, items: OutboxItem[]) => Promise<string[]>;
  process: (id: string) => Promise<void>;
};
export type SyncResult = { synced: number; remaining: number };

let running: Promise<SyncResult> | null = null;
let rerunRequested = false;

/** Single-flight: a call during a run schedules exactly one more run and shares its promise. */
export function syncOutbox(deps: SyncDeps): Promise<SyncResult> {
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    let result: SyncResult;
    do {
      rerunRequested = false;
      result = await syncOnce(deps);
      total += result.synced;
    } while (rerunRequested);
    return { synced: total, remaining: result.remaining };
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const items = await deps.list();
  if (items.length === 0) return { synced: 0, remaining: 0 };

  const userId = await deps.getUserId();
  if (!userId) {
    log.warn('no session; keeping items', { count: items.length });
    return { synced: 0, remaining: items.length };
  }

  let ids: string[];
  try {
    ids = await deps.upsert(userId, items);
  } catch (err) {
    log.error('upsert failed; keeping items', { count: items.length, err });
    return { synced: 0, remaining: items.length };
  }

  await deps.remove(items.map((i) => i.client_id));
  log.info('synced', { count: items.length });
  ids.forEach((id) => deps.process(id).catch((err) => log.error('process trigger failed', { id, err })));
  return { synced: items.length, remaining: 0 };
}

export async function retryUnprocessed(deps: {
  listUnprocessed: () => Promise<string[]>;
  process: (id: string) => Promise<void>;
}): Promise<number> {
  const ids = await deps.listUnprocessed();
  log.info('retrying unprocessed', { count: ids.length });
  await Promise.allSettled(ids.map((id) =>
    deps.process(id).catch((err) => {
      log.error('retry failed', { id, err });
      throw err;
    })));
  return ids.length;
}
```

Note: the "remaining" of a rerun loop reflects the last pass, which is what the UI badge needs.

Run: `npx vitest run tests/unit/sync.test.ts` → PASS (7 tests).

- [ ] **Step 5: Browser fetch helper**

`lib/api.ts`:

```ts
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
```

- [ ] **Step 6: SyncProvider**

`components/SyncProvider.tsx`:

```tsx
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
    });
    setPendingItems(await listOutbox());
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

    void syncNow().then(() =>
      retryUnprocessed({
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
      }));

    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncNow]);

  return (
    <SyncContext.Provider value={{ pendingItems, lastSyncAt, save, syncNow }}>
      {children}
    </SyncContext.Provider>
  );
}
```

- [ ] **Step 7: Verify** — `npm test` → all PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add lib/outbox.ts lib/sync.ts lib/api.ts components/SyncProvider.tsx tests/unit
git commit -m "feat: add offline outbox and sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: App shell and Capture page

**Files:**
- Create: `components/Nav.tsx`, `components/capture/CaptureBox.tsx`, `components/capture/RecentCaptures.tsx`, `lib/labels.ts`
- Modify: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Test: `tests/unit/labels.test.ts`

**Interfaces:**
- Consumes: `useSync`, `SyncProvider`, browser `createClient`, `Capture`.
- Produces: `TYPE_ICONS: Record<CaptureType, string>`, `EFFORT_LABELS`, `CONTEXT_LABELS`, `timeAgo(iso: string, now?: Date): string` in `lib/labels.ts`.

- [ ] **Step 1: Write the failing labels test**

`tests/unit/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { timeAgo } from '@/lib/labels';

const now = new Date('2026-09-24T12:00:00Z');

describe('timeAgo', () => {
  it('says "just now" under a minute', () => {
    expect(timeAgo('2026-09-24T11:59:30Z', now)).toBe('just now');
  });
  it('uses minutes, hours and days', () => {
    expect(timeAgo('2026-09-24T11:55:00Z', now)).toBe('5m ago');
    expect(timeAgo('2026-09-24T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-09-21T12:00:00Z', now)).toBe('3d ago');
  });
});
```

Run: `npx vitest run tests/unit/labels.test.ts` → FAIL.

- [ ] **Step 2: Implement labels**

`lib/labels.ts`:

```ts
import type { CaptureContext, CaptureEffort, CaptureType } from '@/lib/types';

export const TYPE_ICONS: Record<CaptureType, string> = {
  idea: '💡', todo: '✅', reminder: '⏰', reference: '📎', question: '❓',
};
export const CONTEXT_LABELS: Record<CaptureContext, string> = {
  laptop: '💻 Laptop', phone: '📱 Phone', anywhere: '🌐 Anywhere',
};
export const EFFORT_LABELS: Record<CaptureEffort, string> = {
  quick: '< 15m', medium: '< 1h', long: '1h+',
};

export function timeAgo(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

Run: `npx vitest run tests/unit/labels.test.ts` → PASS.

- [ ] **Step 3: Global styles**

Replace `app/globals.css` with:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

html {
  -webkit-text-size-adjust: 100%;
}
```

- [ ] **Step 4: Nav**

`components/Nav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSync } from '@/components/SyncProvider';

const LINKS = [
  { href: '/', label: 'Capture' },
  { href: '/inbox', label: 'Inbox' },
];

export function Nav() {
  const pathname = usePathname();
  const { pendingItems } = useSync();
  if (pathname.startsWith('/login')) return null;

  const link = (href: string, label: string) => (
    <Link key={href} href={href}
      className={`flex-1 py-3 text-center md:flex-none md:px-3 md:py-2 ${pathname === href ? 'font-semibold text-amber-600' : 'text-neutral-500'}`}>
      {label}
      {href === '/' && pendingItems.length > 0 && <span className="ml-1 text-xs">({pendingItems.length})</span>}
    </Link>
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-950 md:static md:border-b md:border-t-0 md:px-4">
      <span className="hidden py-2 pr-4 font-semibold md:block">Idea Catcher</span>
      {LINKS.map(({ href, label }) => link(href, label))}
    </nav>
  );
}
```

- [ ] **Step 5: CaptureBox**

`components/capture/CaptureBox.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useSync } from '@/components/SyncProvider';

export function CaptureBox() {
  const { save, pendingItems } = useSync();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  // Laptop: focuses immediately. iOS only opens the keyboard after a tap.
  useEffect(() => box.current?.focus(), []);

  async function submit() {
    if (saving) return; // prevents a double tap creating two captures
    setSaving(true);
    const ok = await save(text);
    setSaving(false);
    if (!ok) return;
    setText('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    box.current?.focus();
  }

  return (
    <div className="space-y-3">
      <textarea ref={box} aria-label="Capture" rows={6} value={text}
        placeholder="What's on your mind? 想到什麼就說…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
        className="w-full resize-none rounded-xl border border-neutral-300 bg-transparent p-4 text-lg dark:border-neutral-700" />
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={saving || !text.trim()}
          className="rounded-xl bg-amber-500 px-6 py-3 font-medium text-white disabled:opacity-40">
          Save
        </button>
        {saved && <span className="text-green-600">Saved ✓</span>}
        {pendingItems.length > 0 && (
          <span className="ml-auto text-sm text-neutral-500">{pendingItems.length} waiting to sync</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: RecentCaptures**

`components/capture/RecentCaptures.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSync } from '@/components/SyncProvider';
import { createClient } from '@/lib/supabase/browser';
import { TYPE_ICONS, timeAgo } from '@/lib/labels';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('recent');
type Row = Pick<Capture, 'id' | 'raw_text' | 'title' | 'type' | 'captured_at'>;

export function RecentCaptures() {
  const { pendingItems, lastSyncAt } = useSync();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    createClient()
      .from('captures')
      .select('id, raw_text, title, type, captured_at')
      .order('captured_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (error) log.error('load failed', { message: error.message });
        else setRows(data as Row[]);
      });
  }, [lastSyncAt]);

  return (
    <ul className="mt-8 space-y-2 text-sm">
      {pendingItems.map((i) => (
        <li key={i.client_id} className="truncate text-neutral-400">⏳ {i.raw_text}</li>
      ))}
      {rows.map((r) => (
        <li key={r.id} className="flex gap-2">
          <span>{r.type ? TYPE_ICONS[r.type] : '…'}</span>
          <span className="flex-1 truncate">{r.title ?? r.raw_text}</span>
          <span className="text-neutral-400">{timeAgo(r.captured_at)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: Layout and page**

Replace `app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SyncProvider } from '@/components/SyncProvider';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Idea Catcher',
  description: 'Capture ideas fast, act on them later.',
  appleWebApp: { capable: true, title: 'Idea Catcher', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-dvh bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <SyncProvider>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 pb-24 pt-4 md:pb-8">{children}</main>
        </SyncProvider>
      </body>
    </html>
  );
}
```

Replace `app/page.tsx`:

```tsx
import { CaptureBox } from '@/components/capture/CaptureBox';
import { RecentCaptures } from '@/components/capture/RecentCaptures';

export default function CapturePage() {
  return (
    <div className="mx-auto max-w-xl">
      <CaptureBox />
      <RecentCaptures />
    </div>
  );
}
```

- [ ] **Step 8: Verify manually**

`npm run dev`, sign in, type "明天要打電話給房東 about the leak", press Save → "Saved ✓", box clears. Within a few seconds the recent list shows it with an icon and AI title. In Supabase Table Editor the row has `processing = done`. In DevTools → Network → Offline, save another → "1 waiting to sync"; go back online → badge disappears. `npm test` and `npm run build` pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add app shell and capture page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Inbox — filters, list, realtime, detail editing

**Files:**
- Create: `lib/filters.ts`, `components/Markdown.tsx`, `components/inbox/Inbox.tsx`, `components/inbox/FilterBar.tsx`, `components/inbox/CaptureCard.tsx`, `components/inbox/CaptureDetail.tsx`, `app/inbox/page.tsx`
- Test: `tests/unit/filters.test.ts`

**Interfaces:**
- Consumes: `Capture`, enums, labels, `postJson`, browser `createClient`.
- Produces: `type Filters = { type: CaptureType | 'all'; context: CaptureContext | 'all'; status: CaptureStatus }`, `DEFAULT_FILTERS`, `applyFilters(captures, filters): Capture[]`; `<Markdown>{md}</Markdown>`; `CaptureDetail` accepts an optional `specSlot?: ReactNode` (filled in Task 10).

- [ ] **Step 1: Write the failing filter test**

`tests/unit/filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyFilters, DEFAULT_FILTERS } from '@/lib/filters';
import type { Capture } from '@/lib/types';

const c = (id: string, type: Capture['type'], context: Capture['context']) =>
  ({ id, type, context } as Capture);
const list = [c('1', 'idea', 'laptop'), c('2', 'todo', 'phone'), c('3', null, null)];

describe('applyFilters', () => {
  it('returns everything by default, including unprocessed', () => {
    expect(applyFilters(list, DEFAULT_FILTERS).map((x) => x.id)).toEqual(['1', '2', '3']);
  });
  it('filters by type and hides unprocessed', () => {
    expect(applyFilters(list, { ...DEFAULT_FILTERS, type: 'idea' }).map((x) => x.id)).toEqual(['1']);
  });
  it('filters by context', () => {
    expect(applyFilters(list, { ...DEFAULT_FILTERS, context: 'phone' }).map((x) => x.id)).toEqual(['2']);
  });
});
```

Run: `npx vitest run tests/unit/filters.test.ts` → FAIL.

- [ ] **Step 2: Implement filters**

`lib/filters.ts`:

```ts
import type { Capture, CaptureContext, CaptureStatus, CaptureType } from '@/lib/types';

export type Filters = {
  type: CaptureType | 'all';
  context: CaptureContext | 'all';
  status: CaptureStatus; // applied in the database query
};

export const DEFAULT_FILTERS: Filters = { type: 'all', context: 'all', status: 'inbox' };

export function applyFilters(captures: Capture[], { type, context }: Filters): Capture[] {
  return captures.filter((c) =>
    (type === 'all' || c.type === type) && (context === 'all' || c.context === context));
}
```

Run: `npx vitest run tests/unit/filters.test.ts` → PASS.

- [ ] **Step 3: Markdown renderer**

`components/Markdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: FilterBar**

`components/inbox/FilterBar.tsx`:

```tsx
'use client';

import { CAPTURE_TYPES, CONTEXTS, STATUSES } from '@/lib/types';
import type { Filters } from '@/lib/filters';

const select = 'rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-base dark:border-neutral-700';

export function FilterBar({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <select aria-label="Type" className={select} value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value as Filters['type'] })}>
        <option value="all">All types</option>
        {CAPTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select aria-label="Context" className={select} value={value.context}
        onChange={(e) => onChange({ ...value, context: e.target.value as Filters['context'] })}>
        <option value="all">Anywhere</option>
        {CONTEXTS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="Status" className={select} value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as Filters['status'] })}>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 5: CaptureCard**

`components/inbox/CaptureCard.tsx`:

```tsx
'use client';

import type { Capture } from '@/lib/types';
import { EFFORT_LABELS, TYPE_ICONS, timeAgo } from '@/lib/labels';

type Props = { capture: Capture; selected: boolean; onSelect: () => void; onRetry: () => void };

export function CaptureCard({ capture: c, selected, onSelect, onRetry }: Props) {
  const processed = c.processing === 'done';
  return (
    <li data-testid="capture-card" data-processing={c.processing}
      className={`cursor-pointer rounded-xl border p-3 ${selected ? 'border-amber-500' : 'border-neutral-200 dark:border-neutral-800'}`}
      onClick={onSelect}>
      <div className="flex items-start gap-2">
        <span>{c.type ? TYPE_ICONS[c.type] : '⏳'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{processed ? c.title : c.raw_text}</p>
          {processed && <p className="line-clamp-2 text-sm text-neutral-500">{c.summary}</p>}
          {c.processing === 'failed' && (
            <button className="mt-1 text-sm text-red-600 underline"
              onClick={(e) => { e.stopPropagation(); onRetry(); }}>
              Processing failed — Retry
            </button>
          )}
        </div>
        <div className="shrink-0 text-right text-xs text-neutral-400">
          {c.effort && <div>{EFFORT_LABELS[c.effort]}</div>}
          <div>{timeAgo(c.captured_at)}</div>
        </div>
      </div>
    </li>
  );
}
```

- [ ] **Step 6: CaptureDetail**

`components/inbox/CaptureDetail.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { CAPTURE_TYPES, CONTEXTS, EFFORTS, type Capture, type CaptureStatus } from '@/lib/types';
import { CONTEXT_LABELS, EFFORT_LABELS } from '@/lib/labels';

export type CapturePatch = Partial<Pick<Capture,
  'title' | 'summary' | 'type' | 'context' | 'effort' | 'next_steps' | 'status' | 'user_edited'>>;

type Props = {
  capture: Capture;
  onUpdate: (patch: CapturePatch) => Promise<void>;
  specSlot?: ReactNode;
};

const field = 'w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-base dark:border-neutral-700';

export function CaptureDetail({ capture: c, onUpdate, specSlot }: Props) {
  const [draft, setDraft] = useState({
    title: c.title ?? '',
    summary: c.summary ?? '',
    type: c.type ?? 'idea',
    context: c.context ?? 'anywhere',
    effort: c.effort ?? 'quick',
    next_steps: c.next_steps.join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof draft) =>
    (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });

  async function run(patch: CapturePatch) {
    setBusy(true);
    try {
      await onUpdate(patch);
    } finally {
      setBusy(false);
    }
  }

  const saveEdits = () => run({
    ...draft,
    next_steps: draft.next_steps.split('\n').map((s) => s.trim()).filter(Boolean),
    user_edited: true,
  });
  const setStatus = (status: CaptureStatus) => run({ status });

  return (
    <div className="space-y-3">
      <input aria-label="Title" className={`${field} font-semibold`} value={draft.title} onChange={set('title')} />
      <textarea aria-label="Summary" rows={3} className={field} value={draft.summary} onChange={set('summary')} />
      <div className="grid grid-cols-3 gap-2">
        <select aria-label="Edit type" className={field} value={draft.type} onChange={set('type')}>
          {CAPTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Edit context" className={field} value={draft.context} onChange={set('context')}>
          {CONTEXTS.map((x) => <option key={x} value={x}>{CONTEXT_LABELS[x]}</option>)}
        </select>
        <select aria-label="Edit effort" className={field} value={draft.effort} onChange={set('effort')}>
          {EFFORTS.map((x) => <option key={x} value={x}>{EFFORT_LABELS[x]}</option>)}
        </select>
      </div>
      <label className="block text-sm text-neutral-500">
        Next steps (one per line)
        <textarea aria-label="Next steps" rows={3} className={field} value={draft.next_steps} onChange={set('next_steps')} />
      </label>
      <details className="text-sm text-neutral-500">
        <summary>Original capture</summary>
        <p className="mt-1 whitespace-pre-wrap">{c.raw_text}</p>
      </details>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={saveEdits} className="rounded-lg border px-3 py-1">Save edits</button>
        <button disabled={busy} onClick={() => setStatus('done')} className="rounded-lg bg-green-600 px-3 py-1 text-white">Done</button>
        <button disabled={busy} onClick={() => setStatus('archived')} className="rounded-lg border px-3 py-1">Archive</button>
        {c.status !== 'inbox' && (
          <button disabled={busy} onClick={() => setStatus('inbox')} className="rounded-lg border px-3 py-1">Back to inbox</button>
        )}
      </div>
      {specSlot}
    </div>
  );
}
```

- [ ] **Step 7: Inbox container and page**

`components/inbox/Inbox.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { applyFilters, DEFAULT_FILTERS, type Filters } from '@/lib/filters';
import { postJson } from '@/lib/api';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';
import { FilterBar } from './FilterBar';
import { CaptureCard } from './CaptureCard';
import { CaptureDetail, type CapturePatch } from './CaptureDetail';

const log = logger('inbox');

export function Inbox() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from('captures')
      .select('*')
      .eq('status', filters.status)
      .order('captured_at', { ascending: false })
      .limit(200);
    if (error) {
      log.error('load failed', { status: filters.status, message: error.message });
      setError(error.message);
      return;
    }
    log.debug('loaded', { count: data.length, status: filters.status });
    setCaptures(data as Capture[]);
  }, [filters.status]);

  useEffect(() => {
    void load();
    const supabase = createClient();
    const channel = supabase
      .channel('captures-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'captures' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function update(id: string, patch: CapturePatch) {
    setError(null);
    const { error } = await createClient().from('captures').update(patch).eq('id', id);
    if (error) {
      log.error('update failed', { id, patch, message: error.message });
      setError(error.message);
      return;
    }
    if (patch.status) setSelectedId(null);
    await load();
  }

  async function retry(id: string) {
    setError(null);
    try {
      await postJson('/api/process', { id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await load();
  }

  const visible = applyFilters(captures, filters);
  const selected = captures.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <FilterBar value={filters} onChange={setFilters} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2">
          {visible.length === 0 && <li className="text-neutral-500">Nothing here 🎉</li>}
          {visible.map((c) => (
            <CaptureCard key={c.id} capture={c} selected={c.id === selectedId}
              onSelect={() => setSelectedId(c.id)} onRetry={() => retry(c.id)} />
          ))}
        </ul>
        {selected && (
          <div className="md:sticky md:top-4 md:self-start">
            <CaptureDetail key={selected.id} capture={selected} onUpdate={(p) => update(selected.id, p)} />
          </div>
        )}
      </div>
    </div>
  );
}
```

`app/inbox/page.tsx`:

```tsx
import { Inbox } from '@/components/inbox/Inbox';

export default function InboxPage() {
  return <Inbox />;
}
```

- [ ] **Step 8: Verify manually**

`npm run dev` → `/inbox` lists your captures. Change filters → list updates. Click a card → detail opens; edit title → Save edits → card shows new title. Done → card leaves the inbox; Status filter "done" shows it. Capture something on `/` in another tab → it appears in the inbox without a reload (realtime). `npm test` and `npm run build` pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add inbox with filters, realtime and editing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Spec generation (AI, API route, UI)

**Files:**
- Create: `lib/ai/spec.ts`, `lib/server/specCapture.ts`, `app/api/spec/route.ts`, `components/inbox/SpecPanel.tsx`
- Modify: `components/inbox/Inbox.tsx` (pass `specSlot`)
- Test: `tests/unit/spec.test.ts`

**Interfaces:**
- Consumes: `CaptureRepo.get/saveSpec`, `CompleteFn`, `MODELS.spec`, `TIMEOUTS.sonnet`, `LANGUAGE_RULE`, `checkRateLimit`, `postJson`, `Markdown`.
- Produces: `buildSpecPrompt(capture): string`, `generateSpec(capture, complete?): Promise<string>`, `specForCapture(repo, id, ai?): Promise<string | null>` (null = not found); HTTP `POST /api/spec { id }` → 200 `{ spec_md }` | 400 | 401 | 404 | 429 | 502; `<SpecPanel capture onGenerated />`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/spec.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildSpecPrompt, generateSpec } from '@/lib/ai/spec';
import { specForCapture } from '@/lib/server/specCapture';
import type { Capture } from '@/lib/types';

const capture = {
  id: 'c1', raw_text: '做一個 app 收集 ideas', title: 'Idea app', summary: '收集點子的 app',
  next_steps: ['寫 spec'], type: 'idea',
} as Capture;

describe('buildSpecPrompt', () => {
  it('includes the raw text, title and next steps', () => {
    const p = buildSpecPrompt(capture);
    expect(p).toContain('做一個 app 收集 ideas');
    expect(p).toContain('Idea app');
    expect(p).toContain('- 寫 spec');
  });
});

describe('generateSpec', () => {
  it('uses the Sonnet model and returns trimmed markdown', async () => {
    const complete = vi.fn().mockResolvedValue('\n## Goal\n收集點子\n');
    expect(await generateSpec(capture, complete)).toBe('## Goal\n收集點子');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5', timeoutMs: 90_000 }));
  });

  it('rejects an empty response', async () => {
    await expect(generateSpec(capture, vi.fn().mockResolvedValue('  '))).rejects.toThrow('Empty spec');
  });
});

describe('specForCapture', () => {
  const repo = (row: Capture | null) => ({
    get: vi.fn().mockResolvedValue(row),
    saveSpec: vi.fn().mockResolvedValue(undefined),
    markAttempt: vi.fn(), saveResult: vi.fn(), markFailed: vi.fn(),
  });

  it('returns null when the capture is missing', async () => {
    expect(await specForCapture(repo(null), 'c1', vi.fn())).toBeNull();
  });

  it('saves and returns the generated spec', async () => {
    const r = repo(capture);
    expect(await specForCapture(r, 'c1', vi.fn().mockResolvedValue('## Goal'))).toBe('## Goal');
    expect(r.saveSpec).toHaveBeenCalledWith('c1', '## Goal');
  });
});
```

Run: `npx vitest run tests/unit/spec.test.ts` → FAIL.

- [ ] **Step 2: Implement the AI function**

`lib/ai/spec.ts`:

```ts
import type { Capture } from '@/lib/types';
import type { CompleteFn } from '@/lib/ai/types';
import { MODELS, TIMEOUTS } from '@/lib/ai/models';
import { LANGUAGE_RULE, MAX_PROMPT_CHARS } from '@/lib/ai/process';
import { claudeComplete } from '@/lib/claude';

const SYSTEM = `You turn a captured idea or task into a concise, practical spec the user can act on at their laptop.
Reply in Markdown with exactly these sections:
## Goal
## Context
## Requirements
## Open questions
## Suggested first steps
## Claude Code prompt
The last section is one fenced code block containing a ready-to-paste prompt that asks Claude Code to start building or doing this.
Be concrete and brief; do not invent requirements the note does not imply — list them as open questions instead.
${LANGUAGE_RULE}`;

export function buildSpecPrompt(c: Capture): string {
  return [
    `<capture>\n${c.raw_text.slice(0, MAX_PROMPT_CHARS)}\n</capture>`,
    `Title: ${c.title ?? ''}`,
    `Summary: ${c.summary ?? ''}`,
    `Type: ${c.type ?? 'unknown'}`,
    `Next steps:\n${c.next_steps.map((s) => `- ${s}`).join('\n')}`,
  ].join('\n\n');
}

export async function generateSpec(c: Capture, complete: CompleteFn = claudeComplete): Promise<string> {
  const text = await complete({
    model: MODELS.spec,
    system: SYSTEM,
    prompt: buildSpecPrompt(c),
    maxTokens: 3000,
    timeoutMs: TIMEOUTS.sonnet,
    tag: `spec:${c.id}`,
  });
  const markdown = text.trim();
  if (!markdown) throw new Error('Empty spec from model');
  return markdown;
}
```

- [ ] **Step 3: Implement the orchestration**

`lib/server/specCapture.ts`:

```ts
import { generateSpec } from '@/lib/ai/spec';
import type { CaptureRepo } from '@/lib/server/captureRepo';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('specCapture');

export async function specForCapture(
  repo: CaptureRepo,
  id: string,
  ai: (c: Capture) => Promise<string> = generateSpec,
): Promise<string | null> {
  const capture = await repo.get(id);
  if (!capture) {
    log.warn('capture not found', { id });
    return null;
  }
  const markdown = await ai(capture);
  await repo.saveSpec(id, markdown);
  log.info('spec saved', { id, chars: markdown.length });
  return markdown;
}
```

Run: `npx vitest run tests/unit/spec.test.ts` → PASS (5 tests).

- [ ] **Step 4: Route**

`app/api/spec/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireUser } from '@/lib/server/route';
import { checkRateLimit } from '@/lib/rateLimit';
import { makeCaptureRepo } from '@/lib/server/captureRepo';
import { specForCapture } from '@/lib/server/specCapture';
import { logger } from '@/lib/logger';

export const maxDuration = 120;
const log = logger('api/spec');
const Body = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return jsonError(401, 'unauthorized');
  if (!checkRateLimit(`spec:${auth.user.id}`, 10)) return jsonError(429, 'rate_limited');

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'bad_request', body.error.message);

  try {
    const spec_md = await specForCapture(makeCaptureRepo(auth.db), body.data.id);
    if (spec_md === null) return jsonError(404, 'not_found');
    return NextResponse.json({ spec_md });
  } catch (err) {
    log.error('spec generation failed', { id: body.data.id, err });
    return jsonError(502, 'ai_failed', err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 5: SpecPanel and wiring**

`components/inbox/SpecPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { postJson } from '@/lib/api';
import { Markdown } from '@/components/Markdown';
import type { Capture } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('spec-panel');

export function SpecPanel({ capture, onGenerated }: { capture: Capture; onGenerated: () => void }) {
  const [spec, setSpec] = useState(capture.spec_md);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { spec_md } = await postJson<{ spec_md: string }>('/api/spec', { id: capture.id });
      setSpec(spec_md);
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(spec ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      log.error('clipboard write failed', { err });
      setError('Could not copy — select the text manually.');
    }
  }

  return (
    <section className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex gap-2">
        <button disabled={busy} onClick={generate} className="rounded-lg bg-amber-500 px-3 py-1 text-white disabled:opacity-50">
          {busy ? 'Generating…' : spec ? 'Regenerate spec' : 'Generate spec'}
        </button>
        {spec && <button onClick={copy} className="rounded-lg border px-3 py-1">{copied ? 'Copied ✓' : 'Copy'}</button>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error} <button className="underline" onClick={generate}>Retry</button>
        </p>
      )}
      {spec && <Markdown>{spec}</Markdown>}
    </section>
  );
}
```

In `components/inbox/Inbox.tsx` add the import and pass the slot:

```tsx
import { SpecPanel } from './SpecPanel';
```

```tsx
<CaptureDetail key={selected.id} capture={selected} onUpdate={(p) => update(selected.id, p)}
  specSlot={<SpecPanel capture={selected} onGenerated={() => void load()} />} />
```

- [ ] **Step 6: Verify manually**

Open an idea in the inbox → Generate spec → loading, then Markdown with the six sections and a code block. Copy → paste into a text editor matches. Reload → spec still shown. `npm test`, `npm run build` pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add on-demand spec generation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Daily/weekly digest

**Files:**
- Create: `lib/period.ts`, `lib/ai/digest.ts`, `lib/server/digestRepo.ts`, `lib/server/digest.ts`, `app/api/digest/route.ts`, `components/inbox/DigestPanel.tsx`
- Modify: `components/inbox/Inbox.tsx` (render `<DigestPanel />` above the filter bar)
- Test: `tests/unit/period.test.ts`, `tests/unit/digest.test.ts`

**Interfaces:**
- Consumes: `Period`, `CompleteFn`, `MODELS.digest`, `TIMEOUTS.sonnet`, `checkRateLimit`, `postJson`, `Markdown`.
- Produces:
  - `periodRange(period: Period, now?: Date): { period: Period; period_start: string; from: string; to: string }` (local time; weeks start Monday)
  - `type DigestCapture = Pick<Capture, 'type' | 'title' | 'summary' | 'context' | 'status' | 'captured_at'>`
  - `generateDigest(captures: DigestCapture[], period: Period, complete?): Promise<string>`
  - `type DigestRepo = { countProcessed(from, to): Promise<number>; listProcessed(from, to): Promise<DigestCapture[]>; getCached(period, periodStart): Promise<{ content_md: string; capture_count: number } | null>; save(period, periodStart, content_md, count): Promise<void> }`, `makeDigestRepo(db)`
  - `EMPTY_DIGEST`, `getOrCreateDigest(repo, range, ai?): Promise<{ content_md: string; cached: boolean }>`
  - HTTP `POST /api/digest { period, period_start, from, to }` → 200 `{ content_md, cached }` | 400 | 401 | 429 | 502

- [ ] **Step 1: Write the failing period test (Review Focus #4)**

`tests/unit/period.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { periodRange } from '@/lib/period';

beforeAll(() => {
  process.env.TZ = 'Asia/Taipei'; // UTC+8, no DST
});

describe('periodRange', () => {
  it('puts 00:30 Taipei on the new local day, not the UTC day', () => {
    const now = new Date('2026-09-24T16:30:00Z'); // 2026-09-25 00:30 in Taipei
    expect(periodRange('day', now)).toEqual({
      period: 'day',
      period_start: '2026-09-25',
      from: '2026-09-24T16:00:00.000Z',
      to: '2026-09-25T16:00:00.000Z',
    });
  });

  it('starts weeks on Monday (Friday case)', () => {
    const now = new Date('2026-09-24T16:30:00Z'); // Fri 2026-09-25 in Taipei
    expect(periodRange('week', now)).toEqual({
      period: 'week',
      period_start: '2026-09-21',
      from: '2026-09-20T16:00:00.000Z',
      to: '2026-09-27T16:00:00.000Z',
    });
  });

  it('treats Sunday as the end of the week, not the start', () => {
    const now = new Date('2026-09-27T02:00:00Z'); // Sun 2026-09-27 10:00 Taipei
    expect(periodRange('week', now).period_start).toBe('2026-09-21');
  });
});
```

Run: `npx vitest run tests/unit/period.test.ts` → FAIL.

- [ ] **Step 2: Implement period**

`lib/period.ts`:

```ts
import type { Period } from '@/lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local-time range of the day or Monday-based week containing `now`. */
export function periodRange(period: Period, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + (period === 'week' ? 7 : 1));
  return { period, period_start: localDate(start), from: start.toISOString(), to: end.toISOString() };
}
```

Run: `npx vitest run tests/unit/period.test.ts` → PASS.

- [ ] **Step 3: Write the failing digest tests**

`tests/unit/digest.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { generateDigest, type DigestCapture } from '@/lib/ai/digest';
import { EMPTY_DIGEST, getOrCreateDigest } from '@/lib/server/digest';
import type { DigestRepo } from '@/lib/server/digestRepo';

const range = { period: 'day' as const, period_start: '2026-09-24', from: 'F', to: 'T' };
const item: DigestCapture = {
  type: 'todo', title: '修腳踏車', summary: '週末前修好', context: 'phone', status: 'inbox', captured_at: '2026-09-24T01:00:00Z',
};

function fakeRepo(count: number, cached: { content_md: string; capture_count: number } | null) {
  return {
    countProcessed: vi.fn().mockResolvedValue(count),
    listProcessed: vi.fn().mockResolvedValue([item]),
    getCached: vi.fn().mockResolvedValue(cached),
    save: vi.fn().mockResolvedValue(undefined),
  } satisfies DigestRepo;
}

describe('getOrCreateDigest', () => {
  it('returns the empty message without calling the AI', async () => {
    const ai = vi.fn();
    expect(await getOrCreateDigest(fakeRepo(0, null), range, ai)).toEqual({ content_md: EMPTY_DIGEST, cached: false });
    expect(ai).not.toHaveBeenCalled();
  });

  it('returns the cached digest when the count is unchanged', async () => {
    const ai = vi.fn();
    const r = await getOrCreateDigest(fakeRepo(3, { content_md: 'old', capture_count: 3 }), range, ai);
    expect(r).toEqual({ content_md: 'old', cached: true });
    expect(ai).not.toHaveBeenCalled();
  });

  it('regenerates and saves when new captures arrived', async () => {
    const repo = fakeRepo(4, { content_md: 'old', capture_count: 3 });
    const ai = vi.fn().mockResolvedValue('new');
    expect(await getOrCreateDigest(repo, range, ai)).toEqual({ content_md: 'new', cached: false });
    expect(ai).toHaveBeenCalledWith([item], 'day');
    expect(repo.save).toHaveBeenCalledWith('day', '2026-09-24', 'new', 4);
  });
});

describe('generateDigest', () => {
  it('sends captures as JSON lines to the Sonnet model', async () => {
    const complete = vi.fn().mockResolvedValue(' ## Overview ');
    expect(await generateDigest([item], 'week', complete)).toBe('## Overview');
    const req = complete.mock.calls[0][0];
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.prompt).toContain('"title":"修腳踏車"');
    expect(req.prompt).toContain('this week');
  });
});
```

Run: `npx vitest run tests/unit/digest.test.ts` → FAIL.

- [ ] **Step 4: Implement the digest AI function**

`lib/ai/digest.ts`:

```ts
import type { Capture, Period } from '@/lib/types';
import type { CompleteFn } from '@/lib/ai/types';
import { MODELS, TIMEOUTS } from '@/lib/ai/models';
import { claudeComplete } from '@/lib/claude';

export type DigestCapture = Pick<Capture, 'type' | 'title' | 'summary' | 'context' | 'status' | 'captured_at'>;

// The language rule is adapted from LANGUAGE_RULE (per-note) because a digest spans many notes.
const SYSTEM = `You write a short digest of a person's captured ideas and tasks so they can plan a laptop work session.
Reply in Markdown with exactly these sections:
## Overview (2-3 sentences)
## Highlights (grouped by type; one bullet per notable item)
## Suggested priorities (at most 5; favor status "inbox" and context "laptop")
Be brief. Use the dominant language of the captures. If it is Chinese, use Traditional Chinese (繁體中文), never Simplified. Keep technical terms in English.`;

export async function generateDigest(
  captures: DigestCapture[],
  period: Period,
  complete: CompleteFn = claudeComplete,
): Promise<string> {
  const label = period === 'day' ? 'today' : 'this week';
  const text = await complete({
    model: MODELS.digest,
    system: SYSTEM,
    prompt: `Captures from ${label}, one JSON object per line:\n${captures.map((c) => JSON.stringify(c)).join('\n')}`,
    maxTokens: 2000,
    timeoutMs: TIMEOUTS.sonnet,
    tag: `digest:${period}`,
  });
  const markdown = text.trim();
  if (!markdown) throw new Error('Empty digest from model');
  return markdown;
}
```

- [ ] **Step 5: Implement repo and orchestration**

`lib/server/digestRepo.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Period } from '@/lib/types';
import type { DigestCapture } from '@/lib/ai/digest';

export type DigestRepo = {
  countProcessed(from: string, to: string): Promise<number>;
  listProcessed(from: string, to: string): Promise<DigestCapture[]>;
  getCached(period: Period, periodStart: string): Promise<{ content_md: string; capture_count: number } | null>;
  save(period: Period, periodStart: string, content_md: string, captureCount: number): Promise<void>;
};

export function makeDigestRepo(db: SupabaseClient): DigestRepo {
  const processedIn = (columns: string, from: string, to: string, head = false) =>
    db.from('captures')
      .select(columns, head ? { count: 'exact', head: true } : undefined)
      .eq('processing', 'done')
      .gte('captured_at', from)
      .lt('captured_at', to);

  return {
    async countProcessed(from, to) {
      const { count, error } = await processedIn('id', from, to, true);
      if (error) throw error;
      return count ?? 0;
    },
    async listProcessed(from, to) {
      const { data, error } = await processedIn('type, title, summary, context, status, captured_at', from, to)
        .order('captured_at');
      if (error) throw error;
      return data as unknown as DigestCapture[];
    },
    async getCached(period, periodStart) {
      const { data, error } = await db.from('digests').select('content_md, capture_count')
        .eq('period', period).eq('period_start', periodStart).maybeSingle();
      if (error) throw error;
      return data;
    },
    async save(period, periodStart, content_md, captureCount) {
      const { error } = await db.from('digests').upsert(
        { period, period_start: periodStart, content_md, capture_count: captureCount },
        { onConflict: 'user_id,period,period_start' },
      );
      if (error) throw error;
    },
  };
}
```

`lib/server/digest.ts`:

```ts
import { generateDigest, type DigestCapture } from '@/lib/ai/digest';
import type { DigestRepo } from '@/lib/server/digestRepo';
import type { Period } from '@/lib/types';
import { logger } from '@/lib/logger';

const log = logger('digest');

export const EMPTY_DIGEST = 'Nothing captured in this period yet. 這段時間還沒有新的紀錄。';

export type DigestRange = { period: Period; period_start: string; from: string; to: string };

export async function getOrCreateDigest(
  repo: DigestRepo,
  range: DigestRange,
  ai: (c: DigestCapture[], p: Period) => Promise<string> = generateDigest,
): Promise<{ content_md: string; cached: boolean }> {
  const count = await repo.countProcessed(range.from, range.to);
  if (count === 0) return { content_md: EMPTY_DIGEST, cached: false };

  const cached = await repo.getCached(range.period, range.period_start);
  if (cached?.capture_count === count) {
    log.debug('cache hit', { ...range, count });
    return { content_md: cached.content_md, cached: true };
  }

  const captures = await repo.listProcessed(range.from, range.to);
  const content_md = await ai(captures, range.period);
  await repo.save(range.period, range.period_start, content_md, count);
  log.info('generated', { ...range, count });
  return { content_md, cached: false };
}
```

Run: `npx vitest run tests/unit/digest.test.ts` → PASS (4 tests).

- [ ] **Step 6: Route**

`app/api/digest/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireUser } from '@/lib/server/route';
import { checkRateLimit } from '@/lib/rateLimit';
import { makeDigestRepo } from '@/lib/server/digestRepo';
import { getOrCreateDigest } from '@/lib/server/digest';
import { PERIODS } from '@/lib/types';
import { logger } from '@/lib/logger';

export const maxDuration = 120;
const log = logger('api/digest');
const Body = z.object({
  period: z.enum(PERIODS),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return jsonError(401, 'unauthorized');
  if (!checkRateLimit(`digest:${auth.user.id}`, 10)) return jsonError(429, 'rate_limited');

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'bad_request', body.error.message);

  try {
    return NextResponse.json(await getOrCreateDigest(makeDigestRepo(auth.db), body.data));
  } catch (err) {
    log.error('digest failed', { ...body.data, err });
    return jsonError(502, 'ai_failed', err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 7: DigestPanel and wiring**

`components/inbox/DigestPanel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { postJson } from '@/lib/api';
import { periodRange } from '@/lib/period';
import { Markdown } from '@/components/Markdown';
import type { Period } from '@/lib/types';

export function DigestPanel() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('day');
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ content_md: string }>('/api/digest', periodRange(period));
      setContent(r.content_md);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [period]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const tab = (p: Period, label: string) => (
    <button onClick={() => setPeriod(p)}
      className={`rounded-lg px-3 py-1 ${period === p ? 'bg-amber-500 text-white' : 'border'}`}>{label}</button>
  );

  return (
    <details className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-medium">Digest</summary>
      <div className="mt-3 space-y-3">
        <div className="flex gap-2">{tab('day', 'Today')}{tab('week', 'This week')}</div>
        {busy && <p className="text-sm text-neutral-500">Summarizing…</p>}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error} <button className="underline" onClick={load}>Retry</button>
          </p>
        )}
        {!busy && content && <Markdown>{content}</Markdown>}
      </div>
    </details>
  );
}
```

In `components/inbox/Inbox.tsx` add `import { DigestPanel } from './DigestPanel';` and render `<DigestPanel />` as the first child of the outer `<div className="space-y-4">`.

- [ ] **Step 8: Verify manually**

Inbox → expand Digest → "Summarizing…" then Markdown. Expand again without new captures → instant (check server log `cache hit`). Capture something, wait for processing, reopen → regenerated. `npm test`, `npm run build` pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add cached daily/weekly digest" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: PWA — manifest, icons, service worker

**Files:**
- Create: `app/manifest.ts`, `components/IconArt.tsx`, `app/icons/[size]/route.tsx`, `app/apple-icon.tsx`, `public/sw.js`, `components/ServiceWorker.tsx`
- Modify: `app/layout.tsx` (render `<ServiceWorker />`)

**Interfaces:**
- Produces: `/manifest.webmanifest`, `/icons/192`, `/icons/512`, `/apple-icon` (PNG), `/sw.js`.

- [ ] **Step 1: Icon art and routes**

`components/IconArt.tsx`:

```tsx
export function IconArt({ size }: { size: number }) {
  return (
    <div style={{
      width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f59e0b', color: 'white', fontSize: size * 0.45, fontWeight: 700,
    }}>
      IC
    </div>
  );
}
```

`app/icons/[size]/route.tsx`:

```tsx
import { ImageResponse } from 'next/og';
import { IconArt } from '@/components/IconArt';

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === '512' ? 512 : 192;
  return new ImageResponse(<IconArt size={size} />, { width: size, height: size });
}
```

`app/apple-icon.tsx`:

```tsx
import { ImageResponse } from 'next/og';
import { IconArt } from '@/components/IconArt';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<IconArt size={180} />, size);
}
```

`app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Idea Catcher',
    short_name: 'Ideas',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#f59e0b',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
```

- [ ] **Step 2: Service worker (app shell only)**

`public/sw.js`:

```js
const CACHE = 'idea-catcher-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function putInCache(request, response) {
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: network first, cached copy when offline. Redirects are never cached (Safari rejects them).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !res.redirected) putInCache(request, res);
          return res;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match('/')) ?? Response.error()),
    );
    return;
  }

  // Build assets are content-hashed: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
        if (res.ok) putInCache(request, res);
        return res;
      })),
    );
  }
});
```

`components/ServiceWorker.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

const log = logger('sw');

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => log.info('registered', { scope: reg.scope }))
      .catch((err) => log.error('register failed', { err }));
  }, []);
  return null;
}
```

In `app/layout.tsx` import it and render `<ServiceWorker />` right after `</SyncProvider>` inside `<body>`.

- [ ] **Step 3: Verify**

`npm run build && npm start`, open http://localhost:3000 in Chrome → DevTools → Application: Manifest shows name and both icons, no errors; Service Workers shows `sw.js` activated. Visit `/`, then set Network → Offline and reload → the Capture page still renders; saving shows "1 waiting to sync". Back online → badge clears.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add PWA manifest, icons and offline app shell" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end tests, README and deploy

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/capture.spec.ts`, `README.md`

**Interfaces:**
- Consumes: login page password mode (`NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN=true`), labels `Email`, `Password`, `Capture`, button `Save`, text `waiting to sync`, `data-testid="capture-card"`, `data-processing`, buttons `Done`, status select `Status`.
- Requires env: `E2E_EMAIL`, `E2E_PASSWORD` (the test user from Task 2 Step 3), plus `.env.local`.

- [ ] **Step 1: Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 15'], browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN: 'true' },
  },
});
```

Run `npx playwright install chromium` once.

- [ ] **Step 2: Write the E2E tests**

`tests/e2e/capture.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Capture')).toBeVisible();
}

test('capture → processed in inbox → done', async ({ page }) => {
  const token = `e2e-${Date.now()}`;
  await login(page);

  await page.getByLabel('Capture').fill(`記得買牛奶 buy milk ${token}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved ✓')).toBeVisible();

  await page.getByRole('link', { name: 'Inbox' }).click();
  const card = page.getByTestId('capture-card').first();
  await expect(card).toHaveAttribute('data-processing', 'done', { timeout: 45_000 });
  await card.click();
  await expect(page.getByText(token)).toBeAttached(); // raw text inside "Original capture"

  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Status').selectOption('done');
  await page.getByTestId('capture-card').first().click();
  await expect(page.getByText(token)).toBeAttached();
});

test('offline capture waits in the outbox and syncs on reconnect', async ({ page, context }) => {
  const token = `offline-${Date.now()}`;
  await login(page);

  await context.setOffline(true);
  await page.getByLabel('Capture').fill(`offline note ${token}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('1 waiting to sync')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('waiting to sync')).toHaveCount(0, { timeout: 20_000 });
});
```

- [ ] **Step 3: Run the E2E tests**

Run (bash): `E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e`
Expected: 2 passed. If the processing assertion times out, check the dev-server log for `[claude]` / `[processCapture]` errors before changing the test.

- [ ] **Step 4: README**

`README.md`:

````markdown
# Idea Catcher

Capture ideas and chores in seconds on your phone; Claude organizes them; act on them from your laptop.

## Setup

1. Create a Supabase project. Copy Project URL and publishable key.
2. Supabase → SQL Editor: run `supabase/migrations/0001_init.sql`.
3. Supabase → Authentication → Email Templates → Magic Link: make the body show `{{ .Token }}` (the app signs in with a 6-digit code, because an iPhone home-screen app cannot receive a magic link).
4. `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ANTHROPIC_API_KEY=...
   ```
5. `npm install && npm run dev`

## Tests

- Unit: `npm test`
- E2E: create a password user in Supabase, then `E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e`

## Deploy (Vercel)

1. Push to GitHub, import the repo in Vercel.
2. Add the three env vars above (do **not** set `NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN` in production).
3. Supabase → Authentication → URL Configuration: set Site URL to the Vercel URL.

## iPhone checklist (after each deploy)

- [ ] Safari → Share → Add to Home Screen; opens full-screen with the IC icon
- [ ] Sign in inside the installed app with the emailed code
- [ ] Tap the box, use the keyboard 🎤 to dictate mixed 中文/English → Save → AI title appears in 繁體中文
- [ ] Airplane mode → capture → "1 waiting to sync" → airplane mode off → reopen → synced and processed
- [ ] Laptop inbox shows the capture; Generate spec → Copy works; Digest loads
````

- [ ] **Step 5: Run everything once more**

`npm test` → all unit tests PASS. `npm run build` → succeeds. `npm run test:e2e` → 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add E2E tests; docs: add README with setup, deploy and iPhone checklist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: USER ACTION — deploy and run the iPhone checklist**

Ask the user to deploy per the README and walk through the iPhone checklist; fix anything that fails before calling v1 done.
