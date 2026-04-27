'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@apollo/client/react';
import { motion } from 'framer-motion';
import { ArrowLeft, Users, Gem, BookOpen } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

import { GET_KNOWLEDGE, GET_KNOWLEDGE_BY_ONCHAIN_ADDRESS } from '@/lib/apollo/queries';
import type {
    GQLCrystalReceipt,
    KnowledgeByOnChainAddressResponse,
    KnowledgeResponse,
} from '@/lib/apollo/types';
import {
    computeCrystalVisualParams,
    knowledgeToCrystalInput,
    type FrozenCrystalParams,
} from '@/lib/crystal/visualParams';
import { Skeleton } from '@/components/ui/Skeleton';
import KnowledgeDiscussionPanel from '@/components/knowledge/KnowledgeDiscussionPanel/KnowledgeDiscussionPanel';
import KnowledgeCitationPanel from '@/components/knowledge/KnowledgeCitationPanel/KnowledgeCitationPanel';
import KnowledgeVersionDiffPanel from '@/components/knowledge/KnowledgeVersionDiffPanel/KnowledgeVersionDiffPanel';
import { clampHeatScore, resolveHeatState } from '@/lib/heat/semantics';
import {
    buildCrystalOutputViewModelFromRecord,
    buildDraftReferenceLinkPreview,
    type CrystallizationOutputRecordInput,
    type DraftReferenceLink,
} from '@/features/crystal-output/adapter';
import { fetchCrystallizationOutputRecordByKnowledgeId } from '@/features/crystal-output/api';
import CrystalOutputEvidencePanel from '@/features/crystal-output/CrystalOutputEvidencePanel';
import { fetchDraftReferenceLinks } from '@/features/circle-summary/api';
import SummaryReadinessPanel from '@/features/circle-summary/SummaryReadinessPanel';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

/* Dynamic imports for 3D crystal (no SSR) */
const Crystal3D = dynamic(
    () => import('@/components/crystal/Crystal3D'),
    { ssr: false },
);
const CrystalDisplay = dynamic(
    () => import('@/components/crystal/CrystalDisplay'),
    { ssr: false },
);

/* ══════════════════════════════════════
   Knowledge Detail Page
   ══════════════════════════════════════ */

type MintStatusKey = 'minted' | 'pending' | 'failed' | 'unknown';
type DisplayMintStatusKey = MintStatusKey | 'mock';

function normalizeMintStatus(value: string | null | undefined): MintStatusKey {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'minted' || normalized === 'pending' || normalized === 'failed') {
        return normalized;
    }
    return 'unknown';
}

function isMockAssetReference(...values: Array<string | null | undefined>): boolean {
    return values.some((value) => {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized.startsWith('mock_chain') || normalized.startsWith('mock_');
    });
}

function formatContributionWeight(weightBps: number): string {
    if (!Number.isFinite(weightBps)) return '0%';
    return `${Math.round(weightBps / 100)}%`;
}

export default function KnowledgeDetailPage() {
    const t = useI18n('KnowledgeDetailPage');
    const locale = useCurrentLocale();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const knowledgeId = params.id as string;
    const actionRequested = searchParams.get('action') === 'cite';
    const [formalOutputRecord, setFormalOutputRecord] = useState<CrystallizationOutputRecordInput | null>(null);
    const [formalOutputLoading, setFormalOutputLoading] = useState(false);
    const [formalOutputError, setFormalOutputError] = useState<string | null>(null);
    const [draftReferenceLinks, setDraftReferenceLinks] = useState<DraftReferenceLink[]>([]);
    const [draftReferenceLinksLoading, setDraftReferenceLinksLoading] = useState(false);
    const [draftReferenceLinksError, setDraftReferenceLinksError] = useState<string | null>(null);

    const {
        data: knowledgeData,
        loading: knowledgeLoading,
        error: knowledgeError,
    } = useQuery<KnowledgeResponse>(GET_KNOWLEDGE, {
        variables: { knowledgeId },
        skip: !knowledgeId,
    });

    const shouldLookupByOnChainAddress = Boolean(knowledgeId)
        && !knowledgeLoading
        && !knowledgeError
        && !knowledgeData?.knowledge;

    const {
        data: onChainAddressData,
        loading: onChainAddressLoading,
    } = useQuery<KnowledgeByOnChainAddressResponse>(GET_KNOWLEDGE_BY_ONCHAIN_ADDRESS, {
        variables: { onChainAddress: knowledgeId },
        skip: !shouldLookupByOnChainAddress,
    });

    const knowledge = knowledgeData?.knowledge ?? onChainAddressData?.knowledgeByOnChainAddress ?? null;
    const loading = knowledgeLoading || (shouldLookupByOnChainAddress && onChainAddressLoading);

    /* Compute crystal visual params using frozen params if available */
    const crystalParams = useMemo(() => {
        if (!knowledge) return null;
        const input = knowledgeToCrystalInput(knowledge);
        const frozen: FrozenCrystalParams | null = knowledge.crystalParams
            ? {
                seed: knowledge.crystalParams.seed,
                hue: knowledge.crystalParams.hue,
                facets: knowledge.crystalParams.facets,
            }
            : null;
        return computeCrystalVisualParams(input, frozen);
    }, [knowledge]);

    const ageDays = knowledge
        ? Math.floor((Date.now() - new Date(knowledge.createdAt).getTime()) / 86400000)
        : 0;
    const roleLabels = useMemo<Record<string, { label: string; emoji: string }>>(
        () => ({
            Author: {label: t('contributors.roles.author'), emoji: '✏️'},
            Discussant: {label: t('contributors.roles.discussant'), emoji: '💬'},
            Reviewer: {label: t('contributors.roles.reviewer'), emoji: '🔍'},
            Cited: {label: t('contributors.roles.cited'), emoji: '📎'},
            Unknown: {label: t('contributors.roles.unknown'), emoji: '🧩'},
        }),
        [t],
    );

    const shortenPubkey = (value: string | null | undefined): string | null => {
        const normalized = String(value || '').trim();
        if (!normalized) return null;
        if (normalized.length <= 12) return normalized;
        return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
    };

    const formatTimelineTime = (value: string): string => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
    };

    const crystalAsset = knowledge?.crystalAsset ?? null;
    const crystalReceipts = useMemo(
        () => knowledge?.crystalReceipts ?? [] as GQLCrystalReceipt[],
        [knowledge?.crystalReceipts],
    );
    const crystalAssetStatus = normalizeMintStatus(crystalAsset?.mintStatus);
    const crystalAssetMintedAt = crystalAsset?.mintedAt
        ? formatTimelineTime(crystalAsset.mintedAt)
        : null;
    const isMockCrystalAsset = isMockAssetReference(
        crystalAsset?.assetStandard,
        crystalAsset?.masterAssetAddress,
    );
    const crystalAssetDisplayStatus: DisplayMintStatusKey = isMockCrystalAsset ? 'mock' : crystalAssetStatus;
    const receiptStats = useMemo(() => {
        if (knowledge?.crystalReceiptStats) {
            return knowledge.crystalReceiptStats;
        }
        return crystalReceipts.reduce(
            (acc, receipt) => {
                const status = normalizeMintStatus(receipt.mintStatus);
                acc.totalCount += 1;
                if (status === 'minted') acc.mintedCount += 1;
                else if (status === 'pending') acc.pendingCount += 1;
                else if (status === 'failed') acc.failedCount += 1;
                else acc.unknownCount += 1;
                return acc;
            },
            {
                totalCount: 0,
                mintedCount: 0,
                pendingCount: 0,
                failedCount: 0,
                unknownCount: 0,
            },
        );
    }, [crystalReceipts, knowledge?.crystalReceiptStats]);

    const versionTimeline = useMemo(() => {
        if (!knowledge) return [] as Array<{ id: string; version: number; versionLabel: string; title: string; at: string; detail: string }>;
        if (Array.isArray(knowledge.versionTimeline) && knowledge.versionTimeline.length > 0) {
            return knowledge.versionTimeline.map((event) => {
                const actor = event.actorHandle
                    ? `@${event.actorHandle}`
                    : shortenPubkey(event.actorPubkey) || t('timeline.systemActor');
                const eventTitle = event.eventType === 'contributors_updated'
                    ? t('timeline.eventTitle.contributorsUpdated', {actor})
                    : t('timeline.eventTitle.initialCrystal', {actor});
                const detail = (
                    event.eventType === 'contributors_updated'
                        ? t('timeline.detail.contributors', {count: event.contributorsCount ?? 0})
                        : t('timeline.detail.initialPublish')
                );
                return {
                    id: `evt:${event.id}`,
                    version: event.version,
                    versionLabel: `v${event.version}`,
                    title: eventTitle,
                    at: formatTimelineTime(event.eventAt || event.createdAt),
                    detail,
                };
            });
        }

        const createdAt = knowledge.createdAt;
        const updatedAt = knowledge.updatedAt || knowledge.createdAt;
        const hasDistinctCurrentPoint = new Date(updatedAt).getTime() !== new Date(createdAt).getTime();
        const rows = [
            {
                id: 'initial',
                version: 1,
                versionLabel: 'v1',
                title: t('timeline.fallback.initialTitle'),
                at: formatTimelineTime(createdAt),
                detail: t('timeline.detail.initialPublish'),
            },
        ];
        if (knowledge.version > 1 || hasDistinctCurrentPoint) {
            rows.push({
                id: 'current',
                version: knowledge.version,
                versionLabel: `v${knowledge.version}`,
                title: t('timeline.fallback.currentTitle'),
                at: formatTimelineTime(updatedAt),
                detail: t('timeline.fallback.currentDetail'),
            });
        }
        return rows;
    }, [knowledge, locale, t]);

    const versionTimelineHint = (
        knowledge?.versionTimeline?.length ?? 0
    ) > 0
        ? t('timeline.hint.recorded')
        : knowledge && knowledge.version > 1
            ? t('timeline.hint.partial')
            : t('timeline.hint.initialOnly');

    const knowledgeHeatScore = clampHeatScore(Number(knowledge?.stats?.heatScore ?? 0));
    const knowledgeHeatState = resolveHeatState(knowledgeHeatScore);
    const knowledgeHeatLabel = t(`heat.${knowledgeHeatState}`);
    const snapshotContributor = useMemo(
        () => knowledge?.contributors?.find((item) => item.sourceType === 'SNAPSHOT') || null,
        [knowledge?.contributors],
    );
    const settlementOnly = useMemo(
        () => !snapshotContributor && Boolean(knowledge?.contributors?.some((item) => item.sourceType === 'SETTLEMENT')),
        [knowledge?.contributors, snapshotContributor],
    );
    const lineageRows = useMemo(() => {
        if (!snapshotContributor) return [] as Array<{ label: string; value: string }>;
        const shortenHash = (value: string | null | undefined): string | null => {
            if (!value || typeof value !== 'string') return null;
            const normalized = value.trim();
            if (!normalized) return null;
            if (normalized.length <= 20) return normalized;
            return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`;
        };

        const rows: Array<{ label: string; value: string }> = [];
        if (snapshotContributor.sourceDraftPostId) {
            rows.push({ label: t('lineage.rows.sourceDraft'), value: `#${snapshotContributor.sourceDraftPostId}` });
        }
        const anchor = shortenHash(snapshotContributor.sourceAnchorId);
        if (anchor) rows.push({ label: t('lineage.rows.discussionAnchor'), value: anchor });
        const summaryHash = shortenHash(snapshotContributor.sourceSummaryHash);
        if (summaryHash) rows.push({ label: t('lineage.rows.summaryHash'), value: summaryHash });
        const messagesDigest = shortenHash(snapshotContributor.sourceMessagesDigest);
        if (messagesDigest) rows.push({ label: t('lineage.rows.messageDigest'), value: messagesDigest });
        return rows;
    }, [snapshotContributor, t]);
    const outputView = useMemo(() => {
        if (!knowledge) return null;
        return buildCrystalOutputViewModelFromRecord({
            knowledge: {
                knowledgeId: knowledge.knowledgeId,
                title: knowledge.title,
                version: knowledge.version,
                contributorsCount: knowledge.contributorsCount,
                createdAt: knowledge.createdAt,
                stats: {
                    citationCount: knowledge.stats.citationCount,
                },
                contributors: knowledge.contributors,
                references: knowledge.references,
                citedBy: knowledge.citedBy,
            },
            record: formalOutputRecord,
        });
    }, [formalOutputRecord, knowledge]);
    const draftReferencePreview = useMemo(
        () => buildDraftReferenceLinkPreview({
            draftPostId: outputView?.sourceDraftPostId ?? null,
            referenceLinks: draftReferenceLinks,
        }),
        [draftReferenceLinks, outputView?.sourceDraftPostId],
    );

    useEffect(() => {
        if (!outputView?.sourceDraftPostId) {
            setDraftReferenceLinks([]);
            setDraftReferenceLinksLoading(false);
            setDraftReferenceLinksError(null);
            return;
        }

        let cancelled = false;
        setDraftReferenceLinksLoading(true);
        setDraftReferenceLinksError(null);
        void fetchDraftReferenceLinks({
            draftPostId: outputView.sourceDraftPostId,
        })
            .then((nextLinks) => {
                if (cancelled) return;
                setDraftReferenceLinks(nextLinks);
            })
            .catch((error) => {
                if (cancelled) return;
                setDraftReferenceLinks([]);
                setDraftReferenceLinksError(error instanceof Error ? error.message : t('errors.fetchDraftReferenceLinks'));
            })
            .finally(() => {
                if (cancelled) return;
                setDraftReferenceLinksLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [outputView?.sourceDraftPostId]);
    useEffect(() => {
        if (!knowledge?.knowledgeId) {
            setFormalOutputRecord(null);
            setFormalOutputLoading(false);
            setFormalOutputError(null);
            return;
        }

        let cancelled = false;
        setFormalOutputLoading(true);
        setFormalOutputError(null);
        void fetchCrystallizationOutputRecordByKnowledgeId({
            knowledgeId: knowledge.knowledgeId,
        })
            .then((record) => {
                if (cancelled) return;
                setFormalOutputRecord(record);
            })
            .catch((error) => {
                if (cancelled) return;
                setFormalOutputRecord(null);
                setFormalOutputError(error instanceof Error ? error.message : t('errors.fetchFormalOutput'));
            })
            .finally(() => {
                if (cancelled) return;
                setFormalOutputLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [knowledge?.knowledgeId]);

    /* ── Loading ── */
    if (loading) {
        return (
            <div className={styles.page}>
                <div className={styles.loading}>
                    <Skeleton width={120} height={120} borderRadius="50%" />
                    <Skeleton width={200} height={24} />
                    <Skeleton width={160} height={16} />
                </div>
            </div>
        );
    }

    /* ── Not Found ── */
    if (!knowledge) {
        return (
            <div className={styles.page}>
                <div className={styles.header}>
                    <button className={styles.backButton} onClick={() => router.back()}>
                        <ArrowLeft size={20} />
                    </button>
                </div>
                <div className={styles.notFound}>
                    <Gem size={48} strokeWidth={1} style={{ color: 'var(--color-text-tertiary)' }} />
                    <h2 className={styles.notFoundTitle}>{t('states.notFound.title')}</h2>
                    <p className={styles.notFoundDesc}>{t('states.notFound.description')}</p>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            className={styles.page}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
        >
            {/* ── Header ── */}
            <div className={styles.header}>
                <button className={styles.backButton} onClick={() => router.back()}>
                    <ArrowLeft size={20} />
                </button>
                <span className={styles.headerTitle}>{t('header.title')}</span>
            </div>

            {/* ── Crystal 3D Hero ── */}
            {crystalParams && (
                <motion.div
                    className={styles.crystalHero}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <CrystalDisplay params={crystalParams} size={280} particles={false}>
                        <Crystal3D params={crystalParams} size={280} />
                    </CrystalDisplay>
                </motion.div>
            )}

            {/* ── Meta ── */}
            <div className={styles.meta}>
                <h1 className={styles.title}>{knowledge.title}</h1>
                <div className={styles.metaInfo}>
                    <span>@{knowledge.author?.handle ?? t('fallbacks.unknownMember')}</span>
                    <span>·</span>
                    <span>v{knowledge.version}</span>
                    <span>·</span>
                    <span className={styles.metaGold}>{t('meta.citationCount', {count: knowledge.stats.citationCount})}</span>
                    <span>·</span>
                    <span className={styles.metaHeat} data-state={knowledgeHeatState}>
                        {t('meta.heat', {label: knowledgeHeatLabel, score: Math.round(knowledgeHeatScore)})}
                    </span>
                    <span>·</span>
                    <span>{t('meta.crystallizedDaysAgo', {count: ageDays})}</span>
                </div>
            </div>

            <div className={styles.divider} />

            {/* ── Content Body ── */}
            {knowledge.description && (
                <div className={styles.body}>
                    {knowledge.description.split('\n\n').map((paragraph, i) => (
                        <p key={i}>{paragraph}</p>
                    ))}
                </div>
            )}

            {/* ── Crystal NFT ── */}
            <div className={styles.sectionHeader}>
                <Gem size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                <h2 className={styles.sectionTitle}>{t('asset.sectionTitle')}</h2>
            </div>
            <div className={styles.assetCard} data-status={crystalAssetDisplayStatus}>
                <div className={styles.assetHeader}>
                    <div>
                        <span className={styles.assetKicker}>{t('asset.master.kicker')}</span>
                        <h3 className={styles.assetTitle}>{t('asset.master.title')}</h3>
                    </div>
                    <span className={styles.assetStatus} data-status={crystalAssetDisplayStatus}>
                        {t(`asset.status.${crystalAssetDisplayStatus}`)}
                    </span>
                </div>
                <p className={styles.assetLead}>{t('asset.master.description')}</p>
                <div className={styles.assetRows}>
                    <div className={styles.assetRow}>
                        <span className={styles.assetLabel}>{t('asset.master.standard')}</span>
                        <span className={styles.assetValue}>{crystalAsset?.assetStandard || t('asset.master.pendingStandard')}</span>
                    </div>
                    <div className={styles.assetRow}>
                        <span className={styles.assetLabel}>
                            {isMockCrystalAsset ? t('asset.master.demoAddress') : t('asset.master.address')}
                        </span>
                        <span className={styles.assetAddress} title={crystalAsset?.masterAssetAddress ?? undefined}>
                            {crystalAsset?.masterAssetAddress
                                ? shortenPubkey(crystalAsset.masterAssetAddress)
                                : t('asset.master.pendingAddress')}
                        </span>
                    </div>
                    {crystalAssetMintedAt && (
                        <div className={styles.assetRow}>
                            <span className={styles.assetLabel}>{t('asset.master.mintedAt')}</span>
                            <span className={styles.assetValue}>{crystalAssetMintedAt}</span>
                        </div>
                    )}
                    {crystalAsset?.lastError && (
                        <div className={styles.assetRow}>
                            <span className={styles.assetLabel}>{t('asset.master.lastError')}</span>
                            <span className={styles.assetError}>{crystalAsset.lastError}</span>
                        </div>
                    )}
                </div>

                <div className={styles.receiptPanel}>
                    <div className={styles.receiptHeader}>
                        <div>
                            <span className={styles.assetKicker}>{t('asset.receipts.kicker')}</span>
                            <h3 className={styles.receiptTitle}>{t('asset.receipts.title')}</h3>
                        </div>
                        <span className={styles.receiptCount}>{t('asset.receipts.count', {count: receiptStats.totalCount})}</span>
                    </div>
                    <div className={styles.receiptSummary}>
                        <span>{t('asset.receipts.minted', {count: receiptStats.mintedCount})}</span>
                        <span>{t('asset.receipts.pending', {count: receiptStats.pendingCount})}</span>
                        <span>{t('asset.receipts.failed', {count: receiptStats.failedCount})}</span>
                    </div>
                    {crystalReceipts.length === 0 ? (
                        <p className={styles.assetEmpty}>{t('asset.receipts.empty')}</p>
                    ) : (
                        <div className={styles.receiptList}>
                            {crystalReceipts.slice(0, 4).map((receipt) => {
                                const receiptStatus = normalizeMintStatus(receipt.mintStatus);
                                const receiptDisplayStatus: DisplayMintStatusKey = isMockAssetReference(
                                    receipt.assetStandard,
                                    receipt.receiptAssetAddress,
                                ) ? 'mock' : receiptStatus;
                                return (
                                    <div key={receipt.id} className={styles.receiptRow}>
                                        <div className={styles.receiptOwner}>
                                            <span>{shortenPubkey(receipt.ownerPubkey)}</span>
                                            <small>
                                                {receipt.contributionRole} · {formatContributionWeight(receipt.contributionWeightBps)}
                                            </small>
                                        </div>
                                        <span className={styles.assetStatus} data-status={receiptDisplayStatus}>
                                            {t(`asset.status.${receiptDisplayStatus}`)}
                                        </span>
                                        <span className={styles.assetAddress} title={receipt.receiptAssetAddress ?? undefined}>
                                            {receipt.receiptAssetAddress
                                                ? shortenPubkey(receipt.receiptAssetAddress)
                                                : t('asset.receipts.pendingAddress')}
                                        </span>
                                    </div>
                                );
                            })}
                            {receiptStats.totalCount > Math.min(crystalReceipts.length, 4) && (
                                <p className={styles.assetEmpty}>
                                    {t('asset.receipts.showingSubset', {
                                        shown: Math.min(crystalReceipts.length, 4),
                                        count: receiptStats.totalCount,
                                    })}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div className={styles.divider} />

            {/* ── Version Timeline ── */}
            <div className={styles.sectionHeader}>
                <BookOpen size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                <h2 className={styles.sectionTitle}>{t('sections.timeline')}</h2>
            </div>
            <div className={styles.versionTimeline}>
                {versionTimeline.map((item, index) => (
                    <div key={item.id} className={styles.versionItem}>
                        <span className={styles.versionDot} />
                        <div className={styles.versionContent}>
                            <div className={styles.versionTitleRow}>
                                    <span className={styles.versionLabel}>{item.versionLabel}</span>
                                    <span className={styles.versionTitle}>{item.title}</span>
                                    {index === versionTimeline.length - 1 && (
                                        <span className={styles.versionCurrent}>{t('timeline.currentBadge')}</span>
                                    )}
                                </div>
                            {'detail' in item && typeof item.detail === 'string' && (
                                <span className={styles.versionDetail}>{item.detail}</span>
                            )}
                            <span className={styles.versionAt}>{item.at}</span>
                        </div>
                    </div>
                ))}
            </div>
            <p className={styles.versionHint}>{versionTimelineHint}</p>
            <KnowledgeVersionDiffPanel
                knowledgeId={knowledge.knowledgeId}
                currentVersion={knowledge.version}
                versionTimeline={knowledge.versionTimeline}
            />

            <div className={styles.divider} />

            {outputView && (
                <>
                    <CrystalOutputEvidencePanel output={outputView} />
                    <div className={styles.divider} />
                </>
            )}
            {!outputView && (
                <>
                    <div className={styles.lineageCard}>
                        <div className={styles.lineageHead}>
                            <span className={styles.lineageLabel}>{t('formalOutput.label')}</span>
                            <span className={styles.lineageValue}>
                                {formalOutputLoading
                                    ? t('formalOutput.status.loading')
                                    : formalOutputError
                                        ? t('formalOutput.status.error')
                                        : t('formalOutput.status.unavailable')}
                            </span>
                        </div>
                        <p className={styles.versionHint}>
                            {formalOutputLoading
                                ? t('formalOutput.loadingMessage')
                                : formalOutputError
                                    ? formalOutputError
                                    : t('formalOutput.emptyMessage')}
                        </p>
                    </div>
                    <div className={styles.divider} />
                </>
            )}

            {/* ── Contributors ── */}
            {knowledge.contributors && knowledge.contributors.length > 0 && (
                <>
                    <div className={styles.sectionHeader}>
                        <Users size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                        <h2 className={styles.sectionTitle}>{t('contributors.title', {count: knowledge.contributorsCount})}</h2>
                    </div>
                    <div className={styles.lineageCard}>
                        <div className={styles.lineageHead}>
                            <span className={styles.lineageLabel}>{t('lineage.sourceTypeLabel')}</span>
                            <span className={styles.lineageValue}>
                                {snapshotContributor
                                    ? t('lineage.sourceTypes.snapshot')
                                    : settlementOnly
                                        ? t('lineage.sourceTypes.settlementFallback')
                                        : t('lineage.sourceTypes.unlabeled')}
                            </span>
                        </div>
                        {lineageRows.length > 0 && (
                            <div className={styles.lineageRows}>
                                {lineageRows.map((row) => (
                                    <div key={`${row.label}:${row.value}`} className={styles.lineageRow}>
                                        <span className={styles.lineageLabel}>{row.label}</span>
                                        <span className={styles.lineageValue}>{row.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className={styles.contributorList}>
                        {knowledge.contributors.map((c, i) => {
                            const roleInfo = roleLabels[c.role] ?? roleLabels.Unknown;
                            return (
                                <motion.div
                                    key={`${c.handle}-${i}`}
                                    className={styles.contributorRow}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.2, delay: i * 0.05 }}
                                >
                                    <span>{roleInfo.emoji}</span>
                                    <span className={styles.contributorHandle}>@{c.handle}</span>
                                    <span className={styles.contributorRole}>{roleInfo.label}</span>
                                    <span className={styles.contributorWeight}>
                                        {(c.weight * 100).toFixed(0)}%
                                    </span>
                                </motion.div>
                            );
                        })}
                    </div>
                </>
            )}

            {outputView && (
                <>
                    <SummaryReadinessPanel
                        sourceDraftPostId={outputView.sourceDraftPostId}
                        missingTeam03Inputs={outputView.missingTeam03Inputs}
                    />
                    {knowledge.circle && (
                        <Link
                            href={`/circles/${knowledge.circle.id}/summary${outputView.sourceDraftPostId !== null ? `?draft=${outputView.sourceDraftPostId}` : ''}`}
                            className={styles.circleLink}
                        >
                            <BookOpen size={20} strokeWidth={1.5} style={{ color: 'var(--color-accent-gold)' }} />
                            <div>
                                <div className={styles.circleName}>{t('summaryLink.title')}</div>
                                <div className={styles.circleLabel}>
                                    {outputView.sourceDraftPostId !== null
                                        ? t('summaryLink.withDraft', {draftPostId: outputView.sourceDraftPostId})
                                        : t('summaryLink.default')}
                                </div>
                                <div className={styles.circleLabel}>
                                    {draftReferenceLinksLoading
                                        ? t('summaryLink.referencesLoading')
                                        : draftReferenceLinksError
                                            ? draftReferenceLinksError
                                            : draftReferencePreview.totalCount > 0
                                                ? t('summaryLink.referencesReady', {
                                                    totalCount: draftReferencePreview.totalCount,
                                                    sourceBlockCount: draftReferencePreview.sourceBlockCount,
                                                })
                                                : t('summaryLink.referencesEmpty')}
                                </div>
                            </div>
                        </Link>
                    )}
                    <div className={styles.divider} />
                </>
            )}

            {/* ── Source Circle ── */}
            {knowledge.circle && (
                <>
                    <div className={styles.sectionHeader}>
                        <BookOpen size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                        <h2 className={styles.sectionTitle}>{t('sections.sourceCircle')}</h2>
                    </div>
                    <Link
                        href={`/circles/${knowledge.circle.id}`}
                        className={styles.circleLink}
                    >
                        <Gem size={20} strokeWidth={1.5} style={{ color: 'var(--color-accent-gold)' }} />
                        <div>
                            <div className={styles.circleName}>{knowledge.circle.name}</div>
                            <div className={styles.circleLabel}>{t('sourceCircle.open')}</div>
                        </div>
                    </Link>
                </>
            )}

            {(knowledge.references.length > 0 || knowledge.citedBy.length > 0) && (
                <>
                    <div className={styles.sectionHeader}>
                        <BookOpen size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                        <h2 className={styles.sectionTitle}>{t('sections.citationLineage')}</h2>
                    </div>
                    <div className={styles.lineageNavGrid}>
                        <div className={styles.lineageNavColumn}>
                            <h3 className={styles.lineageNavTitle}>{t('citations.referencesTitle')}</h3>
                            {knowledge.references.length === 0 ? (
                                <p className={styles.lineageNavEmpty}>{t('citations.referencesEmpty')}</p>
                            ) : (
                                knowledge.references.map((item) => {
                                    const itemHeatScore = clampHeatScore(Number(item.heatScore ?? 0));
                                    const itemHeatLabel = t(`heat.${resolveHeatState(itemHeatScore)}`);
                                    return (
                                        <Link key={`ref:${item.knowledgeId}`} href={`/knowledge/${item.knowledgeId}`} className={styles.lineageNavLink}>
                                            <span className={styles.lineageNavLinkTitle}>{item.title}</span>
                                            <span className={styles.lineageNavMeta}>
                                                {t('citations.entryMeta', {
                                                    circleName: item.circleName,
                                                    heatLabel: itemHeatLabel,
                                                    heatScore: Math.round(itemHeatScore),
                                                    citationCount: item.citationCount,
                                                })}
                                            </span>
                                        </Link>
                                    );
                                })
                            )}
                        </div>
                        <div className={styles.lineageNavColumn}>
                            <h3 className={styles.lineageNavTitle}>{t('citations.citedByTitle')}</h3>
                            {knowledge.citedBy.length === 0 ? (
                                <p className={styles.lineageNavEmpty}>{t('citations.citedByEmpty')}</p>
                            ) : (
                                knowledge.citedBy.map((item) => {
                                    const itemHeatScore = clampHeatScore(Number(item.heatScore ?? 0));
                                    const itemHeatLabel = t(`heat.${resolveHeatState(itemHeatScore)}`);
                                    return (
                                        <Link key={`by:${item.knowledgeId}`} href={`/knowledge/${item.knowledgeId}`} className={styles.lineageNavLink}>
                                            <span className={styles.lineageNavLinkTitle}>{item.title}</span>
                                            <span className={styles.lineageNavMeta}>
                                                {t('citations.entryMeta', {
                                                    circleName: item.circleName,
                                                    heatLabel: itemHeatLabel,
                                                    heatScore: Math.round(itemHeatScore),
                                                    citationCount: item.citationCount,
                                                })}
                                            </span>
                                        </Link>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </>
            )}

            {knowledge.circle && (
                <KnowledgeCitationPanel
                    targetKnowledgeId={knowledge.knowledgeId}
                    targetOnChainAddress={knowledge.onChainAddress}
                    targetTitle={knowledge.title}
                    actionRequested={actionRequested}
                />
            )}

            {knowledge.circle && (
                <KnowledgeDiscussionPanel
                    knowledgeId={knowledge.knowledgeId}
                    circleId={knowledge.circle.id}
                    knowledgeTitle={knowledge.title}
                    description={knowledge.description}
                />
            )}
        </motion.div>
    );
}
