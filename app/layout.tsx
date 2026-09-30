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
