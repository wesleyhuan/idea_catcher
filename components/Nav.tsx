'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSync } from '@/components/SyncProvider';

const LINKS = [
  { href: '/', label: 'Capture' },
  { href: '/inbox', label: 'Inbox' },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { pendingItems, signOut } = useSync();
  const [signingOut, setSigningOut] = useState(false);
  if (pathname.startsWith('/login')) return null;

  async function onSignOut() {
    setSigningOut(true);
    try {
      if (await signOut()) router.replace('/login');
    } finally {
      setSigningOut(false);
    }
  }

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
      <button onClick={onSignOut} disabled={signingOut}
        className="px-4 py-3 text-sm text-neutral-400 disabled:opacity-50 md:ml-auto md:py-2">
        Sign out
      </button>
    </nav>
  );
}
