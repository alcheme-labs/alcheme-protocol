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
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [sort, setSort] = useState<'latest' | 'featured' | 'trending'>('latest');

    useEffect(() => {
        let mounted = true;
        setStatus('loading');
        listExternalAppDiscovery({ q: query, category, sort })
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
    }, [query, category, sort]);

    return (
        <main className={styles.page} aria-busy={status === 'loading'}>
            <header className={styles.header}>
                <div>
                    <h1>Apps</h1>
                    <p>
                        External apps are operated by their owners. Alcheme shows registry,
                        review, and projection records without endorsement.
                    </p>
                </div>
            </header>
            <section className={styles.controls} aria-label="App discovery filters">
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search apps"
                    aria-label="Search apps"
                />
                <input
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    placeholder="Category"
                    aria-label="Category"
                />
                <div className={styles.segmented} role="group" aria-label="Sort apps">
                    {(['latest', 'featured', 'trending'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            className={sort === option ? styles.activeSegment : undefined}
                            onClick={() => setSort(option)}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            </section>
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
                            {app.stabilityProjection?.projectionStatus ? (
                                <span>{projectionLabel(app.stabilityProjection.projectionStatus)}</span>
                            ) : null}
                        </div>
                        {app.stabilityProjection ? (
                            <div className={styles.projection}>
                                <div className={styles.scoreRow}>
                                    <span>Trust {formatScore(app.stabilityProjection.trustScore)}</span>
                                    <span>Risk {formatScore(app.stabilityProjection.riskScore)}</span>
                                </div>
                                <div className={styles.labelRow}>
                                    {app.stabilityProjection.publicLabels.map((label) => (
                                        <span key={label}>{label}</span>
                                    ))}
                                    {app.storeProjection?.continuityLabels?.map((label) => (
                                        <span key={label}>{label}</span>
                                    ))}
                                    {app.stabilityProjection.bondDispositionState ? (
                                        <span>
                                            {formatBondDispositionState(
                                                app.stabilityProjection.bondDispositionState.state,
                                            )}
                                        </span>
                                    ) : null}
                                    {app.stabilityProjection.governanceState?.labels
                                        ?.filter(
                                            (label) =>
                                                !app.stabilityProjection?.publicLabels.includes(label),
                                        )
                                        .map((label) => (
                                            <span key={`governance-${label}`}>{label}</span>
                                        ))}
                                </div>
                                <p>
                                    Rollout{' '}
                                    {formatBasisPoints(
                                        app.stabilityProjection.rollout?.exposureBasisPoints,
                                    )}
                                </p>
                                {app.storeProjection?.listingState ? (
                                    <p>{app.storeProjection.listingState}</p>
                                ) : null}
                                {app.stabilityProjection.bondDispositionState ? (
                                    <p>
                                        Rule-based bond record ·{' '}
                                        {formatBondAmount(
                                            app.stabilityProjection.bondDispositionState
                                                .activeLockedAmountRaw,
                                        )}{' '}
                                        locked
                                    </p>
                                ) : null}
                                {app.stabilityProjection.governanceState?.highImpactActionsPaused ? (
                                    <p>Review-sensitive actions are paused pending governance records.</p>
                                ) : null}
                            </div>
                        ) : (
                            <p className={styles.provenance}>Projection pending.</p>
                        )}
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

function projectionLabel(status: string): string {
    switch (status) {
        case 'status_sync_pending':
            return 'Sync pending';
        case 'projection_disputed':
            return 'Under Challenge';
        case 'manual_freeze':
            return 'Manual Review';
        default:
            return 'Normal';
    }
}

function formatScore(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    return Math.round(value).toString();
}

function formatBasisPoints(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'fallback';
    return `${Math.round(value / 100)}%`;
}

function formatBondDispositionState(value: string | undefined): string {
    switch (value) {
        case 'locked_for_case':
            return 'Bond locked';
        case 'forfeited':
            return 'Bond ruled';
        case 'routed_by_policy':
            return 'Bond routed';
        case 'released':
            return 'Bond released';
        case 'paused':
            return 'Bond paused';
        default:
            return 'Bond clear';
    }
}

function formatBondAmount(value: string | undefined): string {
    if (!value || !/^[0-9]+$/.test(value)) return '0';
    return value;
}
