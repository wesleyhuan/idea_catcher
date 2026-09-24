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
  // Accounts are created by the owner in the Supabase dashboard; never auto-create here.
  const sendCode = () => run(
    () => supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }),
    () => setCodeSent(true),
  );
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
