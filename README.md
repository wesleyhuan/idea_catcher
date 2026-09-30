# Idea Catcher

Capture ideas and chores in seconds on your phone; Claude organizes them; act on them from your laptop.

## Setup

1. Create a Supabase project. Copy Project URL and publishable key.
2. Supabase → SQL Editor: run `supabase/migrations/0001_init.sql`.
3. Supabase → Authentication → Email Templates → **Magic Link** and **Confirm signup**: make the body show `{{ .Token }}` (the app signs in with a 6-digit code, because an iPhone home-screen app cannot receive a magic link).
4. Supabase → Authentication → Users → Add user (auto-confirm) for your email, then turn **off** "Allow new users to sign up" in the Email provider settings. New users are added the same way.
5. `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ANTHROPIC_API_KEY=...
   ```
6. `npm install && npm run dev`

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
