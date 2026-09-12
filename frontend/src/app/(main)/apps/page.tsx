'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    listExternalAppDiscovery,
    type ExternalAppDiscoveryItem,
} from '@/lib/api/externalApps';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

type DirectorySort = 'latest' | 'featured' | 'trending';

export default function ExternalAppsPage() {
    return (
        <Suspense fallback={<DirectoryLoadingShell />}>
            <ExternalAppsDirectory />
        </Suspense>
    );
}

function ExternalAppsDirectory() {
    const t = useI18n('ExternalPrograms');
    const locale = useCurrentLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlQuery = searchParams.get('q')?.trim() ?? '';
    const urlCategory = searchParams.get('category')?.trim() ?? '';
    const urlSort = parseSort(searchParams.get('sort'));
    const [apps, setApps] = useState<ExternalAppDiscoveryItem[]>([]);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [queryInput, setQueryInput] = useState(urlQuery);
    const [categoryInput, setCategoryInput] = useState(urlCategory);

    useEffect(() => {
        setQueryInput(urlQuery);
        setCategoryInput(urlCategory);
    }, [urlCategory, urlQuery]);

    useEffect(() => {
        if (queryInput.trim() === urlQuery && categoryInput.trim() === urlCategory) return;
        const timer = window.setTimeout(() => {
            router.replace(buildDirectoryHref({
                q: queryInput,
                category: categoryInput,
                sort: urlSort,
            }), { scroll: false });
        }, 300);
        return () => window.clearTimeout(timer);
    }, [categoryInput, queryInput, router, urlCategory, urlQuery, urlSort]);

    useEffect(() => {
        const controller = new AbortController();
        setStatus('loading');
        void listExternalAppDiscovery(
            { q: urlQuery, category: urlCategory, sort: urlSort },
            { signal: controller.signal },
        )
            .then((items) => {
                setApps(items);
                setStatus('ready');
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                setApps([]);
                setStatus('error');
            });
        return () => controller.abort();
    }, [urlCategory, urlQuery, urlSort]);

    const updateSort = (sort: DirectorySort) => {
        router.replace(buildDirectoryHref({
            q: queryInput,
            category: categoryInput,
            sort,
        }), { scroll: false });
    };

    return (
        <main className={styles.page} aria-busy={status === 'loading'}>
            <header className={styles.header}>
                <div>
                    <h1>{t('directory.title')}</h1>
                    <p>{t('directory.subtitle')}</p>
                </div>
            </header>
            <section className={styles.controls} aria-label={t('directory.filtersAria')}>
                <label className={styles.field}>
                    <span>{t('directory.search')}</span>
                    <input
                        name="external-program-search"
                        autoComplete="off"
                        value={queryInput}
                        onChange={(event) => setQueryInput(event.target.value)}
                        placeholder={t('directory.searchPlaceholder')}
                    />
                </label>
                <label className={styles.field}>
                    <span>{t('directory.category')}</span>
                    <input
                        name="external-program-category"
                        autoComplete="off"
                        value={categoryInput}
                        onChange={(event) => setCategoryInput(event.target.value)}
                        placeholder={t('directory.categoryPlaceholder')}
                    />
                </label>
                <div className={styles.segmented} role="group" aria-label={t('directory.sortAria')}>
                    {(['latest', 'featured', 'trending'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            className={urlSort === option ? styles.activeSegment : undefined}
                            aria-pressed={urlSort === option}
                            onClick={() => updateSort(option)}
                        >
                            {t(`directory.sort.${option}`)}
                        </button>
                    ))}
                </div>
            </section>
            <section className={styles.grid} aria-label={t('directory.title')} aria-live="polite">
                {apps.map((app) => (
                    <Link key={app.id} href={`/apps/${encodeURIComponent(app.id)}`} className={styles.cardLink}>
                        <article className={styles.card}>
                            <div>
                                <h2>{app.name}</h2>
                                <p translate="no">{app.id}</p>
                            </div>
                            <div className={styles.badges}>
                                <span>{discoveryStatusLabel(t, app.discoveryStatus)}</span>
                                <span>{managedNodeLabel(t, app.managedNodePolicy)}</span>
                                {app.stabilityProjection?.projectionStatus ? (
                                    <span>{projectionLabel(t, app.stabilityProjection.projectionStatus)}</span>
                                ) : null}
                            </div>
                            {app.stabilityProjection ? (
                                <div className={styles.projection}>
                                    <div className={styles.scoreRow}>
                                        <span>{t('facts.trustScore')} {formatScore(t, app.stabilityProjection.trustScore)}</span>
                                        <span>{t('facts.riskScore')} {formatScore(t, app.stabilityProjection.riskScore)}</span>
                                    </div>
                                    <div className={styles.labelRow}>
                                        {app.stabilityProjection.publicLabels.map((label) => (
                                            <span key={label}>{publicLabel(t, label)}</span>
                                        ))}
                                        {app.storeProjection?.continuityLabels?.map((label) => (
                                            <span key={label}>{continuityLabel(t, label)}</span>
                                        ))}
                                        {app.stabilityProjection.bondDispositionState ? (
                                            <span>{formatBondDispositionState(t, app.stabilityProjection.bondDispositionState.state)}</span>
                                        ) : null}
                                        {app.stabilityProjection.governanceState?.labels
                                            ?.filter((label) => !app.stabilityProjection?.publicLabels.includes(label))
                                            .map((label) => (
                                                <span key={`governance-${label}`}>{publicLabel(t, label)}</span>
                                            ))}
                                    </div>
                                    <p>
                                        {t('directory.rollout')}{' '}
                                        {formatBasisPoints(t, locale, app.stabilityProjection.rollout?.exposureBasisPoints)}
                                    </p>
                                    {app.storeProjection?.listingState ? (
                                        <p>{listingStateLabel(t, app.storeProjection.listingState)}</p>
                                    ) : null}
                                    {app.stabilityProjection.bondDispositionState ? (
                                        <p>
                                            {t('directory.bondRecord')} ·{' '}
                                            {app.stabilityProjection.bondDispositionState.hasActiveLockedAmount
                                                ? t('directory.activeLock')
                                                : t('directory.noActiveLock')}
                                        </p>
                                    ) : null}
                                    {app.stabilityProjection.governanceState?.highImpactActionsPaused ? (
                                        <p>{t('directory.governancePaused')}</p>
                                    ) : null}
                                </div>
                            ) : (
                                <p className={styles.provenance}>{t('directory.projectionPending')}</p>
                            )}
                        </article>
                    </Link>
                ))}
                {status === 'loading' ? (
                    <p className={styles.empty} role="status">{t('states.loadingDirectory')}</p>
                ) : null}
                {status === 'error' ? (
                    <p className={styles.empty} role="alert">{t('errors.directoryUnavailable')}</p>
                ) : null}
                {status === 'ready' && apps.length === 0 ? (
                    <p className={styles.empty}>{t('directory.empty')}</p>
                ) : null}
            </section>
        </main>
    );
}

function DirectoryLoadingShell() {
    const t = useI18n('ExternalPrograms');
    return (
        <main className={styles.page} aria-busy="true">
            <p className={styles.empty} role="status">{t('states.loadingDirectory')}</p>
        </main>
    );
}

type TranslationFunction = ReturnType<typeof useI18n>;

function parseSort(value: string | null): DirectorySort {
    return value === 'featured' || value === 'trending' ? value : 'latest';
}

function buildDirectoryHref(input: { q: string; category: string; sort: DirectorySort }): string {
    const params = new URLSearchParams();
    const query = input.q.trim();
    const category = input.category.trim();
    if (query) params.set('q', query);
    if (category) params.set('category', category);
    if (input.sort !== 'latest') params.set('sort', input.sort);
    const search = params.toString();
    return search ? `/apps?${search}` : '/apps';
}

function projectionLabel(t: TranslationFunction, status: string): string {
    switch (status) {
        case 'status_sync_pending': return t('directory.projection.syncPending');
        case 'projection_disputed': return t('directory.projection.challenged');
        case 'manual_freeze': return t('directory.projection.manualReview');
        default: return t('directory.projection.normal');
    }
}

function discoveryStatusLabel(t: TranslationFunction, value: string): string {
    const known = ['unlisted', 'listed', 'limited', 'hidden', 'delisted'];
    return known.includes(value) ? t(`statuses.discovery.${value}`) : t('statuses.unknown');
}

function managedNodeLabel(t: TranslationFunction, value: string): string {
    const known = ['normal', 'throttled', 'restricted', 'emergency_hold', 'denied'];
    return known.includes(value) ? t(`directory.managedNode.${value}`) : t('statuses.unknown');
}

function publicLabel(t: TranslationFunction, value: string): string {
    const key = PUBLIC_LABEL_KEYS[value];
    return key ? t(`directory.publicLabels.${key}`) : t('directory.publicLabels.other');
}

const PUBLIC_LABEL_KEYS: Record<string, string> = {
    'Owner Bonded': 'ownerBonded',
    'Risk Notice': 'riskNotice',
    'Under Review': 'underReview',
    'Under Challenge': 'underChallenge',
    'Limited Rollout': 'limitedRollout',
    'Capture Review': 'captureReview',
    'Projection Disputed': 'projectionDisputed',
    'Scoped Emergency Hold': 'emergencyHold',
};

function continuityLabel(t: TranslationFunction, value: string): string {
    return value === 'App-Operated Node Declared'
        ? t('directory.continuity.appNodeDeclared')
        : t('directory.continuity.other');
}

function listingStateLabel(t: TranslationFunction, value: string): string {
    const known = ['unlisted', 'listed_limited', 'listed_sampled', 'listed_full'];
    return known.includes(value) ? t(`directory.listing.${value}`) : t('directory.listing.other');
}

function formatScore(t: TranslationFunction, value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return t('directory.notAvailable');
    return Math.round(value).toString();
}

function formatBasisPoints(t: TranslationFunction, locale: string, value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return t('directory.notAvailable');
    return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 2,
    }).format(value / 10_000);
}

function formatBondDispositionState(t: TranslationFunction, value: string | undefined): string {
    switch (value) {
        case 'locked_for_case': return t('directory.bond.locked');
        case 'forfeited': return t('directory.bond.ruled');
        case 'routed_by_policy': return t('directory.bond.routed');
        case 'released': return t('directory.bond.released');
        case 'paused': return t('directory.bond.paused');
        default: return t('directory.bond.clear');
    }
}
