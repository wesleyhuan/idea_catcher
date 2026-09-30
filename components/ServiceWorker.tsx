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
