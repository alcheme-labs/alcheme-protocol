'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { motion } from 'framer-motion';
import { Search, Users, ChevronRight, Plus, Pin, X } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { OptionPickerSheet } from '@/components/alcheme';
import CreateCircleSheet from '@/components/circle/CreateCircleSheet/CreateCircleSheet';
import Link from 'next/link';
import { GET_ALL_CIRCLES, SEARCH_CIRCLES, SEARCH_POSTS } from '@/lib/apollo/queries';
import type { AllCirclesResponse, SearchCirclesResponse, SearchPostsResponse, GQLCircle } from '@/lib/apollo/types';
import { useCreateCircle } from '@/hooks/useCreateCircle';
import { useI18n } from '@/i18n/useI18n';
import { DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY } from '@/lib/api/circlesPolicyProfile';
import {
    buildCircleShortcutHref,
    type CircleShortcutDraft,
} from '@/lib/circle/shortcuts';
import { useCircleShortcuts } from '@/lib/circle/useCircleShortcuts';
import styles from './page.module.css';

function isRootMainCircle(circle: GQLCircle): boolean {
    const kind = typeof circle.kind === 'string' ? circle.kind.toLowerCase() : '';
    return kind === 'main' && circle.parentCircleId == null;
}

function buildRootCircleShortcutDraft(circle: GQLCircle): CircleShortcutDraft {
    return {
        rootCircleId: circle.id,
        circleId: circle.id,
        circleName: circle.name,
        level: circle.level ?? 0,
        kind: 'main',
        mode: circle.mode === 'social' ? 'social' : 'knowledge',
        preferredTab: 'plaza',
    };
}

export default function CirclesPage() {
    const t = useI18n('CirclesPage');
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateSheet, setShowCreateSheet] = useState(false);
    const [shortcutSelectorOpen, setShortcutSelectorOpen] = useState(false);
    const [createCircleStatusNotice, setCreateCircleStatusNotice] = useState<string | null>(null);
    const {
        hydrated: shortcutsHydrated,
        primaryShortcut,
        addShortcut,
        removeShortcut,
    } = useCircleShortcuts();
    const {
        createCircle,
        clearNotice: clearCreateCircleNotice,
        loading: isCreating,
        error: createCircleError,
        notice: createCircleNotice,
    } = useCreateCircle();

    // Fetch all circles by default
    const {
        data: allData,
        loading: allLoading,
        refetch: refetchAllCircles,
    } = useQuery<AllCirclesResponse>(GET_ALL_CIRCLES, {
        variables: { limit: 30 },
        // Circles can be created from other pages; always revalidate on enter.
        fetchPolicy: 'cache-and-network',
        nextFetchPolicy: 'cache-first',
    });

    // Search circles when query is typed
    const { data: searchCircleData, loading: searchLoading } = useQuery<SearchCirclesResponse>(SEARCH_CIRCLES, {
        variables: { query: searchQuery, limit: 20 },
        skip: searchQuery.length < 2,
        errorPolicy: 'all',
    });

    // Also search posts for cross-reference
    const { data: searchPostData } = useQuery<SearchPostsResponse>(SEARCH_POSTS, {
        variables: { query: searchQuery, limit: 10 },
        skip: searchQuery.length < 2,
        errorPolicy: 'all',
    });

    const isSearching = searchQuery.length >= 2;
    const loading = isSearching ? searchLoading : allLoading;
    const displayCircles: GQLCircle[] = Array.from(new Map((
        isSearching ? (searchCircleData?.searchCircles ?? []) : (allData?.allCircles ?? [])
    ).filter((circle) => isRootMainCircle(circle) && circle.lifecycleStatus === 'Active').map((circle) => [circle.id, circle] as const)).values());

    const hasSearchResults = searchPostData?.searchPosts && searchPostData.searchPosts.length > 0;
    const relatedResultsHint = hasSearchResults
        ? t('search.relatedResults', {count: searchPostData.searchPosts.length})
        : null;
    const visibleCreateCircleNotice = createCircleStatusNotice || (!showCreateSheet ? createCircleNotice : null);
    const primaryShortcutHref = useMemo(
        () => primaryShortcut ? buildCircleShortcutHref(primaryShortcut) : null,
        [primaryShortcut],
    );
    const selectedShortcutValue = primaryShortcut?.circleId ?? -1;
    const shortcutPickerOptions = useMemo(() => displayCircles.map((circle) => ({
        value: circle.id,
        label: (
            <span className={styles.shortcutPickerLabel}>
                <span className={styles.shortcutPickerIcon} aria-hidden="true">
                    <Users size={15} strokeWidth={1.7} />
                </span>
                <span className={styles.shortcutPickerName}>{circle.name}</span>
            </span>
        ),
        description: t('circle.meta', {
            members: circle.stats.members,
            posts: circle.stats.posts,
        }),
    })), [displayCircles, t]);
    const formatCircleType = (circleType: GQLCircle['circleType']) => {
        if (circleType === 'Closed') return t('circle.type.closed');
        if (circleType === 'Secret') return t('circle.type.secret');
        return t('circle.type.open');
    };
    const handleSetRootCircleShortcut = (circle: GQLCircle) => {
        addShortcut(buildRootCircleShortcutDraft(circle), {
            isPrimary: true,
            autoEnterEnabled: true,
        });
    };
    const handleSelectRootCircleShortcut = (circleId: number) => {
        const circle = displayCircles.find((candidate) => candidate.id === circleId);
        if (!circle) return;
        handleSetRootCircleShortcut(circle);
    };

    return (
        <div className={styles.page}>


            <div className="content-container">
                <motion.header
                    className={styles.header}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <div>
                        <h1 className={styles.title}>{t('title')}</h1>
                        <p className={styles.subtitle}>{t('subtitle')}</p>
                    </div>
                    <button
                        className={styles.createBtn}
                        onClick={() => {
                            clearCreateCircleNotice();
                            setCreateCircleStatusNotice(null);
                            setShowCreateSheet(true);
                        }}
                        aria-label={t('actions.createAria')}
                    >
                        <Plus size={20} strokeWidth={2} />
                    </button>
                </motion.header>
                {visibleCreateCircleNotice && (
                    <div className={styles.createCircleNotice} role="status">
                        {visibleCreateCircleNotice}
                    </div>
                )}
                {shortcutsHydrated && primaryShortcut && primaryShortcutHref && (
                    <motion.div
                        className={styles.shortcutStrip}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <Link
                            href={primaryShortcutHref}
                            className={styles.shortcutEntry}
                        >
                            <span className={styles.shortcutIcon}>
                                <Pin size={14} strokeWidth={1.8} />
                            </span>
                            <span className={styles.shortcutText}>
                                <span className={styles.shortcutLabel}>{t('shortcuts.primaryLabel')}</span>
                                <strong>{t('shortcuts.openPrimary', { name: primaryShortcut.circleName })}</strong>
                            </span>
                            <ChevronRight size={15} className={styles.shortcutChevron} />
                        </Link>
                        <button
                            type="button"
                            className={styles.shortcutChangeButton}
                            onClick={() => setShortcutSelectorOpen(true)}
                        >
                            {t('shortcuts.changePrimary')}
                        </button>
                        <button
                            type="button"
                            className={styles.shortcutRemoveButton}
                            onClick={() => removeShortcut(primaryShortcut.circleId)}
                            aria-label={t('shortcuts.removePrimaryAria', { name: primaryShortcut.circleName })}
                        >
                            <X size={14} />
                        </button>
                    </motion.div>
                )}
                {shortcutsHydrated && !primaryShortcut && displayCircles.length > 0 && (
                    <motion.button
                        type="button"
                        className={styles.shortcutSelectPrompt}
                        onClick={() => setShortcutSelectorOpen(true)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <span className={styles.shortcutIcon}>
                            <Pin size={14} strokeWidth={1.8} />
                        </span>
                        <span className={styles.shortcutText}>
                            <span className={styles.shortcutLabel}>{t('shortcuts.primaryLabel')}</span>
                            <strong>{t('shortcuts.choosePrimary')}</strong>
                        </span>
                        <ChevronRight size={15} className={styles.shortcutChevron} />
                    </motion.button>
                )}

                {/* Search */}
                <motion.div
                    className={styles.searchBar}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <Search size={16} strokeWidth={1.5} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder={t('search.placeholder')}
                        className={styles.searchInput}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </motion.div>

                {/* Circle List */}
                <div className={styles.list}>
                    {loading ? (
                        <>
                            <Skeleton height={140} />
                            <Skeleton height={140} />
                            <Skeleton height={140} />
                        </>
                    ) : displayCircles.length === 0 ? (
                        <div className={styles.empty}>
                            <p>{t('empty')}</p>
                            {hasSearchResults && (
                                <p className={styles.searchHint}>{relatedResultsHint}</p>
                            )}
                        </div>
                    ) : (
                        displayCircles.map((circle, index) => (
                            <motion.div
                                key={circle.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.15 + index * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                            >
                                <div className={styles.circleCardShell}>
                                    <Link href={`/circles/${circle.id}`} className={styles.circleLink}>
                                        <Card state="ore">
                                            <div className={styles.circleHeader}>
                                                <div className={styles.circleAvatar}>
                                                    <Users size={20} strokeWidth={1.5} />
                                                </div>
                                                <div className={styles.circleInfo}>
                                                    <h3 className={styles.circleName}>{circle.name}</h3>
                                                    <span className={styles.circleType}>
                                                        {formatCircleType(circle.circleType)}
                                                    </span>
                                                </div>
                                                <ChevronRight size={16} className={styles.circleArrow} />
                                            </div>
                                            <p className={styles.circleDesc}>{circle.description || t('circle.noDescription')}</p>

                                            <div className={styles.circleFooter}>
                                                <span className={styles.circleMeta}>
                                                    {t('circle.meta', {
                                                        members: circle.stats.members,
                                                        posts: circle.stats.posts,
                                                    })}
                                                </span>
                                            </div>
                                        </Card>
                                    </Link>
                                    {shortcutsHydrated && (
                                        <button
                                            type="button"
                                            className={`${styles.circleShortcutButton} ${primaryShortcut?.circleId === circle.id ? styles.circleShortcutButtonActive : ''}`}
                                            onClick={() => {
                                                if (primaryShortcut?.circleId === circle.id) {
                                                    removeShortcut(circle.id);
                                                    return;
                                                }
                                                handleSetRootCircleShortcut(circle);
                                            }}
                                            aria-label={primaryShortcut?.circleId === circle.id
                                                ? t('shortcuts.primaryActiveAria', { name: circle.name })
                                                : t('shortcuts.setPrimaryAria', { name: circle.name })}
                                            title={primaryShortcut?.circleId === circle.id
                                                ? t('shortcuts.primaryActiveAria', { name: circle.name })
                                                : t('shortcuts.setPrimaryAria', { name: circle.name })}
                                        >
                                            <Pin
                                                size={15}
                                                strokeWidth={primaryShortcut?.circleId === circle.id ? 2 : 1.6}
                                            />
                                        </button>
                                    )}
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>

                {hasSearchResults && displayCircles.length > 0 && (
                    <p className={styles.searchHint}>
                        {relatedResultsHint}
                    </p>
                )}
            </div>

            {/* Create Circle Sheet */}
            <CreateCircleSheet
                open={showCreateSheet}
                showCreationScope={false}
                initialDraftWorkflowPolicy={DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY}
                onClose={() => setShowCreateSheet(false)}
                onCreate={async (data) => {
                    const result = await createCircle({
                        name: data.name,
                        description: data.description,
                        kind: 'main',
                        level: 0,
                        mode: data.mode,
                        genesisMode: data.genesisMode,
                        seededSources: data.seededSources,
                        accessType: data.accessType,
                        minCrystals: data.accessType === 'crystal' ? data.minCrystals : 0,
                        ghostSettings: data.ghostSettings,
                        draftLifecycleTemplate: data.draftLifecycleTemplate,
                        draftWorkflowPolicy: data.draftWorkflowPolicy,
                        postCreateSettingsChanged: data.postCreateSettingsChanged,
                    });
                    if (result?.txSignature) {
                        if (result.notice) {
                            setCreateCircleStatusNotice(result.notice);
                        }
                        try {
                            await refetchAllCircles();
                        } catch (error) {
                            console.warn('[CirclesPage] refetch after circle creation failed', error);
                        }
                    }
                    return !!result?.txSignature;
                }}
                submitting={isCreating}
                submitError={createCircleError}
                submitNotice={createCircleNotice}
            />
            <OptionPickerSheet<number>
                open={shortcutSelectorOpen}
                title={t('shortcuts.selectorTitle')}
                closeLabel={t('shortcuts.selectorCloseAria')}
                value={selectedShortcutValue}
                options={shortcutPickerOptions}
                onChange={handleSelectRootCircleShortcut}
                onClose={() => setShortcutSelectorOpen(false)}
            />
        </div>
    );
}
