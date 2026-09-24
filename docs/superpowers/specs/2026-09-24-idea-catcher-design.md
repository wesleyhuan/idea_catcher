# Idea Catcher — Design Spec

Date: 2026-09-24
Status: Draft, awaiting review

## 1. Purpose

Capture ideas and chores in a few seconds on the phone. Let AI organize them. Act on them later on the laptop.

- **User:** the author first; built with real accounts so others can join later.
- **Success criteria:**
  - Capturing a thought takes a few seconds with zero decisions.
  - No capture is ever lost, including when offline.
  - Every capture is turned into a readable, classified, actionable item.
  - An idea can be turned into a spec / Claude Code prompt with one click.

### Constraints

- Primary phone: **iPhone** (PWA installed via "Add to Home Screen").
- Capture language: **mixed Chinese (繁體) and English**. AI output follows the note's dominant language (繁體中文 for Chinese); technical terms stay in English.
- Author is comfortable with TypeScript + React.

## 2. Scope

### In v1

- Text capture; voice via **iOS keyboard dictation** (no in-app recording).
- Automatic AI processing per capture: type, title, summary, next steps, context, effort.
- On-demand AI spec / Claude Code prompt per capture, with copy-to-clipboard.
- Inbox with filters, editing, done/archive.
- On-demand daily/weekly digest (cached).
- Offline capture via a local outbox.
- Email one-time-code login; per-user data isolation.

### Out of v1 (candidates for later)

- In-app voice recording + server transcription.
- Share-sheet input (not supported for PWAs on iOS) and photo/screenshot input.
- Tags / project grouping / related-capture linking.
- Reminders with due dates or notifications (`reminder` is only a type label in v1).
- Integrations (GitHub Issues, Google Calendar, Notion).
- Scheduled digests.

## 3. Architecture

**Stack:** Next.js (App Router, TypeScript) on Vercel · Supabase (Postgres, Auth, Realtime) · Anthropic Claude API · Tailwind CSS · zod · Vitest · Playwright.

```
iPhone / Laptop (PWA)
  ├─ Capture page ──► IndexedDB outbox ──sync──► Supabase `captures`
  │                                        └──► POST /api/process ──► Claude Haiku
  └─ Inbox page ◄── Supabase query + realtime
                 ├─► POST /api/spec   ──► Claude Sonnet
                 └─► POST /api/digest ──► Claude Sonnet
```

All Claude calls happen in Next.js server routes. The browser never sees the API key.

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/outbox` | Store and read pending captures in IndexedDB | IndexedDB |
| `lib/sync` | Push outbox to Supabase, trigger processing, retry pending/failed | outbox, Supabase client, `/api/process` |
| `lib/ai/process` | Build prompt, call Claude, validate result with zod | Claude client |
| `lib/ai/spec` | Generate spec / prompt Markdown for one capture | Claude client |
| `lib/ai/digest` | Summarize captures for a period; cache check | Claude client |
| `lib/claude` | Thin Claude API wrapper: timeout, one retry, usage logging | Anthropic SDK |
| `lib/logger` | Module-prefixed console logging | — |
| `app/api/*` | Auth check, ownership check, rate limit, call `lib/ai/*`, persist | Supabase server client, `lib/ai` |
| `app/(pages)` | Capture and Inbox UI | `lib/sync`, Supabase client |

The AI units take plain input and return validated data. They do not touch the database, so they can be tested without Supabase.

## 4. Data model

### `captures`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | default `gen_random_uuid()` |
| `user_id` | uuid | FK → `auth.users`, not null |
| `client_id` | uuid | Generated on device; `unique (user_id, client_id)` for idempotent sync |
| `raw_text` | text | not null; never modified after insert |
| `captured_at` | timestamptz | Device time at capture |
| `created_at` | timestamptz | Server insert time |
| `status` | enum `capture_status` | `inbox` (default) / `done` / `archived` |
| `processing` | enum `processing_state` | `pending` (default) / `done` / `failed` |
| `processing_error` | text | nullable |
| `processing_attempts` | int | default 0 |
| `type` | enum `capture_type` | `idea` / `todo` / `reminder` / `reference` / `question`; nullable until processed |
| `title` | text | nullable |
| `summary` | text | nullable |
| `next_steps` | jsonb | array of strings, default `[]` |
| `context` | enum `capture_context` | `laptop` / `phone` / `anywhere`; nullable |
| `effort` | enum `capture_effort` | `quick` (<15m) / `medium` (<1h) / `long`; nullable |
| `user_edited` | bool | default false; when true, reprocessing never overwrites AI fields |
| `spec_md` | text | nullable; set by `/api/spec` |
| `updated_at` | timestamptz | |

Indexes: `(user_id, status, captured_at desc)`, `(user_id, processing)`.

### `digests`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | FK → `auth.users` |
| `period` | enum | `day` / `week` |
| `period_start` | date | In the user's local timezone (sent by client) |
| `content_md` | text | |
| `capture_count` | int | Number of captures the digest was built from |
| `created_at` | timestamptz | |

`unique (user_id, period, period_start)`. A digest is regenerated only if the current capture count for the period differs from `capture_count`.

### Security

Row-level security on both tables: select/insert/update/delete only where `user_id = auth.uid()`.

## 5. Flows

### 5.1 Capture (phone)

1. `/` opens with a large auto-focused textarea. The user dictates via the iOS keyboard mic or types.
2. Save (button, or ⌘/Ctrl+Enter) writes `{ client_id, raw_text, captured_at }` to the IndexedDB outbox, clears the box, and shows "Saved ✓". Saving never waits on the network. Empty or whitespace-only text is not saved.
3. The page shows a "N waiting to sync" badge when the outbox is non-empty, and the last few captures.

### 5.2 Sync

Runs on app load, on the browser `online` event, and after each save. Only one sync runs at a time.

1. For each outbox item: upsert to `captures` on `(user_id, client_id)`. On success, remove it from the outbox. On failure, keep it and log.
2. For each newly synced row: call `POST /api/process { id }` (fire-and-forget from the UI's perspective).
3. On app load, also call `/api/process` for rows with `processing in (pending, failed)` and `processing_attempts < 3`.

### 5.3 `/api/process`

1. Require a Supabase session; load the row and confirm `user_id` matches. Otherwise return 401/404.
2. If `user_edited` is true or `processing = done`, return without calling Claude.
3. Increment `processing_attempts`. Call **Claude Haiku** with the raw text. The prompt asks for strict JSON: `{ type, title, summary, next_steps, context, effort }`, in the note's dominant language.
4. Validate with zod. On success, write the fields and set `processing = done`.
5. On failure (API error, timeout, invalid JSON), set `processing = failed` and `processing_error`, log the error and raw model output. The raw text is untouched.

### 5.4 `/api/spec`

1. Auth and ownership check as above.
2. Call **Claude Sonnet** with raw text, title, summary and next steps. Output Markdown with sections: Goal, Context, Requirements, Open questions, Suggested first steps, plus a ready-to-paste Claude Code prompt block.
3. Save to `spec_md` and return it. Calling again regenerates it (overwrites).

### 5.5 `/api/digest`

1. Input: `{ period, period_start, tz }`. Auth check.
2. Count the user's captures in the period. If a cached digest exists with the same count, return it.
3. Otherwise call **Claude Sonnet** with the period's processed captures (title, type, summary, context, status). Output: short overview, grouped highlights, suggested priorities for the laptop session. Upsert into `digests` and return it.
4. Zero captures: return a fixed "Nothing captured" message without calling Claude.

## 6. Screens

### Login

Supabase email one-time code (6 digits, typed into the app). Not a magic link: an iOS home-screen PWA has storage separate from Safari, so a link opened from Mail would sign in Safari, not the app. Session persists on the iPhone PWA.

### `/` Capture

As in 5.1. Works offline once the app shell is cached.

### `/inbox` Inbox

- **Digest panel** at top: tabs Today / This week, collapsed by default, generates on expand.
- **Filter bar:** type, context, status (default `inbox`).
- **List:** cards with type icon, title, summary, effort badge, relative time. Unprocessed/failed cards show raw text and a Retry button. Live updates via Supabase realtime.
- **Detail panel:** editable title, summary, type, context, effort, next steps (editing sets `user_edited = true`); read-only raw text; buttons Done, Archive, Generate spec. Spec renders as Markdown with a Copy button.

### Navigation and PWA

- Phone: bottom tab bar (Capture | Inbox). Laptop: header or sidebar.
- Web app manifest and icons; opens standalone from the iPhone home screen.
- Service worker caches the app shell only. Data lives in the outbox and Supabase.
- Tailwind, minimal style, dark mode follows the system.

## 7. Error handling

- Raw text is saved locally first and never overwritten; AI failure cannot lose a note.
- API routes return `{ error, detail }` JSON with correct status codes; the UI shows a toast and stays usable.
- Claude calls: request timeout (30s for Haiku, 90s for Sonnet) and one automatic retry on network/5xx errors.
- Invalid model JSON is a failure, never partially saved.
- Spec and digest UI shows loading, and on failure the error plus a retry button.
- Rate limit per user: `/api/process` 60/min, `/api/spec` and `/api/digest` 10/min. Exceeding returns 429. In v1 this is a best-effort in-memory limiter per server instance (enough for a single user); move it to a shared store (e.g. Upstash Redis) before opening to other users.

## 8. Logging

`lib/logger` prefixes each line with its module, e.g. `[sync]`, `[outbox]`, `[api/process]`. Logged points:

- Outbox read/write: item count, `client_id`.
- Supabase upsert results and errors.
- Each Claude call: model, capture id, latency, token usage.
- zod validation failures, with the raw model output.
- Every caught error, with the actual error object.

## 9. Testing

- **Unit (Vitest):** outbox, sync and retry rules, prompt output → zod validation using recorded model responses, digest cache check, rate limiter.
- **API routes:** Claude client mocked; cases: success, invalid JSON, timeout, wrong user, `user_edited` skip.
- **E2E (Playwright):** capture → appears in inbox → processed → mark done; offline capture with network blocked, then sync on reconnect.
- **Manual on iPhone** after first deploy: install to home screen, mixed 中/English dictation, airplane-mode capture then sync, email-code login inside the installed app.

## 10. Configuration

Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` (server only). API routes use the caller's Supabase session, so RLS applies everywhere and no service-role key is needed. Model ids live in one config file (`lib/ai/models.ts`): Haiku for processing, Sonnet for spec and digest.

## 11. Expected cost

Around 20 captures a day plus a few specs and digests a week: Haiku processing costs cents per month; Sonnet spec/digest stays under a few dollars per month. Supabase and Vercel free tiers are sufficient.
