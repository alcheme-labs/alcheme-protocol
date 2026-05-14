'use client';

import { useEffect, useState } from 'react';
import {
    listExternalAppDiscovery,
    type ExternalAppDiscoveryItem,
} from '@/lib/api/externalApps';
import styles from './page.module.css';

export default function ExternalAppsPage() {
    const [apps, setApps] = useState<ExternalAppDiscoveryItem[]>([]);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

    useEffect(() => {
        let mounted = true;
        listExternalAppDiscovery()
            .then((items) => {
                if (!mounted) return;
                setApps(items);
                setStatus('ready');
            })
            .catch(() => {
                if (!mounted) return;
                setStatus('error');
            });
        return () => {
            mounted = false;
        };
    }, []);

    return (
        <main className={styles.page} aria-busy={status === 'loading'}>
            <header className={styles.header}>
                <h1>Apps</h1>
            </header>
            <section className={styles.grid} aria-label="External apps">
                {apps.map((app) => (
                    <article key={app.id} className={styles.card}>
                        <div>
                            <h2>{app.name}</h2>
                            <p>{app.id}</p>
                        </div>
                        <div className={styles.badges}>
                            <span>{app.discoveryStatus}</span>
                            <span>{app.managedNodePolicy}</span>
                        </div>
                    </article>
                ))}
                {status === 'loading' ? (
                    <p className={styles.empty}>Loading apps...</p>
                ) : null}
                {status === 'error' ? (
                    <p className={styles.empty}>Apps are unavailable.</p>
                ) : null}
                {status === 'ready' && apps.length === 0 ? (
                    <p className={styles.empty}>No reviewed apps are listed yet.</p>
                ) : null}
            </section>
        </main>
    );
}
