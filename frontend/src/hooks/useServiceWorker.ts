'use client';

import { useEffect } from 'react';

/**
 * Register the service worker for PWA support.
 * Only runs in production to avoid caching dev assets.
 */
export function useServiceWorker() {
    useEffect(() => {
        if (
            typeof window !== 'undefined' &&
            'serviceWorker' in navigator &&
            process.env.NODE_ENV === 'production'
        ) {
            navigator.serviceWorker
                .register('/sw.js')
                .then((reg) => {
                    console.log('[SW] Registered:', reg.scope);
                })
                .catch((err) => {
                    console.warn('[SW] Registration failed:', err);
                });
        }
    }, []);
}
