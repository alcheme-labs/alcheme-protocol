'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@apollo/client/react';
import { motion } from 'framer-motion';
import { ArrowLeft, Users, Gem, BookOpen, Copy, ExternalLink, ShieldCheck, RefreshCw, Download } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

import {
    GET_KNOWLEDGE,
    GET_KNOWLEDGE_BY_ONCHAIN_ADDRESS,
    GET_KNOWLEDGE_RELATIONSHIP_LABELS,
} from '@/lib/apollo/queries';
import type {
    GQLCrystalReceipt,
    GQLKnowledgeContributor,
    GQLKnowledgeRelationshipLabel,
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
import KnowledgeRelationshipLabelSheet from '@/components/knowledge/KnowledgeRelationshipLabelSheet/KnowledgeRelationshipLabelSheet';
import CrystalReferenceText from '@/components/circle/CrystalReferenceText/CrystalReferenceText';
import { clampHeatScore, resolveHeatState } from '@/lib/heat/semantics';
import {
    buildCrystalOutputViewModelFromRecord,
    buildDraftReferenceLinkPreview,
    type CrystallizationOutputRecordInput,
    type DraftReferenceLink,
} from '@/features/crystal-output/adapter';
import { fetchCrystallizationOutputRecordByKnowledgeId } from '@/lib/api/crystalOutput';
import CrystalOutputEvidencePanel from '@/features/crystal-output/CrystalOutputEvidencePanel';
import { fetchDraftReferenceLinks } from '@/lib/api/circleSummary';
import {
    downloadKnowledgeDurabilityExport,
    fetchKnowledgeDurability,
    repairKnowledgeDurability,
    verifyKnowledgeDurability,
    type KnowledgeDurabilityReadback,
} from '@/lib/api/knowledgeDurability';
import SummaryReadinessPanel from '@/features/circle-summary/SummaryReadinessPanel';
import ContributionCredentialClaimCard from '@/features/contribution-credential/ContributionCredentialClaimCard';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import {
    formatInternalRecordVersionLabel,
    formatRelationshipLabel,
} from '@/lib/knowledge/relationshipLabels';
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
type AssetAddressKind = 'master' | 'receipt';

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

function formatAssetStandardLabel(
    value: string | null | undefined,
    t: ReturnType<typeof useI18n>,
): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'mock_chain_master') return t('asset.standardLabels.demoAsset');
    if (normalized === 'mock_chain_receipt') return t('asset.standardLabels.demoReceipt');
    if (normalized === 'token2022_master_nft') return t('asset.standardLabels.token2022MasterNft');
    if (normalized === 'token2022_non_transferable_receipt') return t('asset.standardLabels.token2022Receipt');
    if (!normalized || normalized === 'pending') return t('asset.master.pendingStandard');
    return value || t('asset.master.pendingStandard');
}

function resolveSolanaExplorerCluster(): 'devnet' | 'testnet' | 'mainnet-beta' | null {
    const configuredCluster = String(process.env.NEXT_PUBLIC_SOLANA_CLUSTER || '').trim().toLowerCase();
    const rpcUrl = String(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '').trim().toLowerCase();
    const source = `${configuredCluster} ${rpcUrl}`;

    if (source.includes('localhost') || source.includes('127.0.0.1')) return null;
    if (source.includes('devnet')) return 'devnet';
    if (source.includes('testnet')) return 'testnet';
    if (source.includes('mainnet')) return 'mainnet-beta';
    if (!configuredCluster && !rpcUrl) return 'devnet';
    return null;
}

function buildSolanaExplorerUrl(address: string | null | undefined, isMock: boolean): string | null {
    const normalized = String(address || '').trim();
    if (!normalized || isMock) return null;

    const cluster = resolveSolanaExplorerCluster();
    if (!cluster) return null;

    const clusterQuery = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
    return `https://solscan.io/token/${encodeURIComponent(normalized)}${clusterQuery}`;
}

function formatContributionWeight(weightBps: number): string {
    if (!Number.isFinite(weightBps)) return '0%';
    return `${Math.round(weightBps / 100)}%`;
}

type PublicPublicationSource = {
    id: number;
    name: string;
    canonicalUrl: string | null;
    contentDigest: string;
    chunks: Array<{ chunkIndex: number; text: string; textDigest: string }>;
};

function readPublicPublicationSources(snapshot: Record<string, unknown> | null | undefined): PublicPublicationSource[] {
    if (!snapshot || !Array.isArray(snapshot.sourceMaterials)) return [];
    return snapshot.sourceMaterials.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const source = value as Record<string, unknown>;
        const id = Number(source.id);
        const name = String(source.name || '').trim();
        const contentDigest = String(source.contentDigest || '').trim();
        if (!Number.isInteger(id) || id <= 0 || !name || !/^[a-f0-9]{64}$/.test(contentDigest)) return [];
        const chunks = Array.isArray(source.chunks)
            ? source.chunks.flatMap((chunkValue) => {
                if (!chunkValue || typeof chunkValue !== 'object' || Array.isArray(chunkValue)) return [];
                const chunk = chunkValue as Record<string, unknown>;
                const chunkIndex = Number(chunk.chunkIndex);
                const text = String(chunk.text || '');
                const textDigest = String(chunk.textDigest || '').trim();
                return Number.isInteger(chunkIndex) && chunkIndex >= 0 && /^[a-f0-9]{64}$/.test(textDigest)
                    ? [{ chunkIndex, text, textDigest }]
                    : [];
            })
            : [];
        return [{
            id,
            name,
            canonicalUrl: typeof source.canonicalUrl === 'string' && source.canonicalUrl.trim()
                ? source.canonicalUrl.trim()
                : null,
            contentDigest,
            chunks,
        }];
    });
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
    const [copiedAssetKey, setCopiedAssetKey] = useState<string | null>(null);
    const [relationshipLabelSheetOpen, setRelationshipLabelSheetOpen] = useState(false);
    const [durability, setDurability] = useState<KnowledgeDurabilityReadback | null>(null);
    const [durabilityLoading, setDurabilityLoading] = useState(false);
    const [durabilityError, setDurabilityError] = useState<string | null>(null);
    const [durabilityAction, setDurabilityAction] = useState<'verify' | 'repair' | 'export' | null>(null);

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
    const publicPublicationSources = useMemo(
        () => readPublicPublicationSources(knowledge?.publicationVersions[0]?.sourceSnapshotJson),
        [knowledge?.publicationVersions],
    );
    const loading = knowledgeLoading || (shouldLookupByOnChainAddress && onChainAddressLoading);
    const {
        data: relationshipLabelData,
        loading: relationshipLabelsLoading,
        error: relationshipLabelsError,
    } = useQuery<{ knowledgeRelationshipLabels: GQLKnowledgeRelationshipLabel[] }>(
        GET_KNOWLEDGE_RELATIONSHIP_LABELS,
        {
            variables: { status: 'active' },
            skip: !knowledge,
        },
    );
    const relationshipLabels = relationshipLabelData?.knowledgeRelationshipLabels ?? [];

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

    const formatReceiptOwnerName = (receipt: GQLCrystalReceipt): string => {
        const displayName = String(
            receipt.ownerEffectiveDisplayName
            || receipt.ownerCircleAlias
            || '',
        ).trim() || t('asset.receipts.ownerFallback');
        return receipt.ownerNeedsDisplayDisambiguation
            ? `${displayName} (${t('asset.receipts.sameNameMember')})`
            : displayName;
    };

    const formatTimelineTime = (value: string): string => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
    };

    const copyAssetAddress = async (assetKey: string, address: string | null | undefined) => {
        const normalized = String(address || '').trim();
        if (!normalized || typeof navigator === 'undefined' || !navigator.clipboard) return;

        try {
            await navigator.clipboard.writeText(normalized);
        } catch {
            return;
        }
        setCopiedAssetKey(assetKey);
        window.setTimeout(() => {
            setCopiedAssetKey((current) => (current === assetKey ? null : current));
        }, 1600);
    };

    const renderAssetAddress = (input: {
        assetKey: string;
        address: string | null | undefined;
        isMock: boolean;
        kind: AssetAddressKind;
    }) => {
        const normalizedAddress = String(input.address || '').trim();
        const pendingLabel = input.kind === 'receipt'
            ? t('asset.receipts.pendingAddress')
            : t('asset.master.pendingAddress');
        if (!normalizedAddress) {
            return <span className={styles.assetAddress}>{pendingLabel}</span>;
        }

        const explorerUrl = buildSolanaExplorerUrl(normalizedAddress, input.isMock);
        const copied = copiedAssetKey === input.assetKey;

        return (
            <div className={styles.assetAddressGroup}>
                <span className={styles.assetAddress} title={normalizedAddress}>
                    {shortenPubkey(normalizedAddress)}
                </span>
                <div className={styles.assetActions}>
                    <button
                        type="button"
                        className={styles.assetActionButton}
                        onClick={() => void copyAssetAddress(input.assetKey, normalizedAddress)}
                        aria-label={t('asset.actions.copyAddress')}
                    >
                        <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
                        <span>{copied ? t('asset.actions.copied') : t('asset.actions.copyAddress')}</span>
                    </button>
                    {explorerUrl && (
                        <a
                            className={styles.assetExplorerLink}
                            href={explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
                            <span>{t('asset.actions.viewOnExplorer')}</span>
                        </a>
                    )}
                    {input.isMock && (
                        <span className={styles.assetDemoOnly}>
                            {t('asset.actions.demoOnly')}
                        </span>
                    )}
                </div>
            </div>
        );
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
    const hasLegacyAssetRecords = Boolean(crystalAsset)
        || receiptStats.totalCount > 0
        || crystalReceipts.length > 0;

    const versionTimeline = useMemo(() => {
        if (!knowledge) return [] as Array<{ id: string; version: number; versionLabel: string; title: string; at: string; detail: string }>;
        if (Array.isArray(knowledge.versionTimeline) && knowledge.versionTimeline.length > 0) {
            return knowledge.versionTimeline.map((event) => {
                const actor = event.actorHandle
                    ? `@${event.actorHandle}`
                    : t('fallbacks.unknownMember');
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
                    versionLabel: formatInternalRecordVersionLabel(event.version, locale) ?? String(event.version),
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
                versionLabel: formatInternalRecordVersionLabel(1, locale) ?? '1',
                title: t('timeline.fallback.initialTitle'),
                at: formatTimelineTime(createdAt),
                detail: t('timeline.detail.initialPublish'),
            },
        ];
        if (knowledge.version > 1 || hasDistinctCurrentPoint) {
            rows.push({
                id: 'current',
                version: knowledge.version,
                versionLabel: formatInternalRecordVersionLabel(knowledge.version, locale) ?? String(knowledge.version),
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
    const relationshipLabel = formatRelationshipLabel(knowledge?.relationshipAssignment);
    const snapshotContributor = useMemo(
        () => knowledge?.contributors?.find((item) => item.sourceType === 'SNAPSHOT') || null,
        [knowledge?.contributors],
    );
    const settlementOnly = useMemo(
        () => !snapshotContributor && Boolean(knowledge?.contributors?.some((item) => item.sourceType === 'SETTLEMENT')),
        [knowledge?.contributors, snapshotContributor],
    );
    const hasHistoricalFallbackContributor = useMemo(
        () => Boolean(knowledge?.contributors?.some((item) => item.assessmentKind === 'HISTORICAL_FALLBACK')),
        [knowledge?.contributors],
    );
    const hasMockContributor = useMemo(
        () => Boolean(knowledge?.contributors?.some((item) => item.assessmentKind === 'MOCK')),
        [knowledge?.contributors],
    );
    const formatContributorWeight = (contributor: GQLKnowledgeContributor): string => {
        if (contributor.assessmentKind === 'HISTORICAL_FALLBACK') return t('contributors.weights.historicalFallback');
        if (contributor.assessmentKind === 'MOCK') return t('contributors.weights.mock');
        if (!contributor.assessmentKind || contributor.assessmentKind === 'UNKNOWN') return t('contributors.weights.unverified');
        return `${(contributor.weight * 100).toFixed(0)}%`;
    };
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
                relationshipAssignment: knowledge.relationshipAssignment,
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

    useEffect(() => {
        if (!knowledge?.knowledgeId) {
            setDurability(null);
            setDurabilityLoading(false);
            setDurabilityError(null);
            return;
        }
        let cancelled = false;
        setDurabilityLoading(true);
        setDurabilityError(null);
        void fetchKnowledgeDurability(knowledge.knowledgeId)
            .then((readback) => {
                if (!cancelled) setDurability(readback);
            })
            .catch((error) => {
                if (cancelled) return;
                setDurability(null);
                setDurabilityError(error instanceof Error ? error.message : t('durability.unavailable'));
            })
            .finally(() => {
                if (!cancelled) setDurabilityLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [knowledge?.knowledgeId]);

    const runDurabilityAction = async (action: 'verify' | 'repair' | 'export') => {
        if (!knowledge?.knowledgeId || durabilityAction) return;
        setDurabilityAction(action);
        setDurabilityError(null);
        try {
            if (action === 'export') {
                await downloadKnowledgeDurabilityExport(knowledge.knowledgeId);
                return;
            }
            const next = action === 'verify'
                ? await verifyKnowledgeDurability(knowledge.knowledgeId)
                : await repairKnowledgeDurability(knowledge.knowledgeId);
            setDurability(next);
        } catch (error) {
            setDurabilityError(error instanceof Error ? error.message : t('durability.unavailable'));
        } finally {
            setDurabilityAction(null);
        }
    };

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
                    <button
                        type="button"
                        className={styles.relationshipLabelButton}
                        onClick={() => setRelationshipLabelSheetOpen(true)}
                    >
                        {relationshipLabel}
                    </button>
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
                        <p key={i}>
                            <CrystalReferenceText text={paragraph} />
                        </p>
                    ))}
                </div>
            )}

            {/* ── Crystal NFT ── */}
            <div className={styles.sectionHeader}>
                <Gem size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                <h2 className={styles.sectionTitle}>{t('asset.sectionTitle')}</h2>
            </div>
            <div className={styles.assetCard} data-status={crystalAssetDisplayStatus}>
                {!hasLegacyAssetRecords ? (
                    <p className={styles.assetEmpty}>{t('asset.noAssetRequired')}</p>
                ) : (
                    <>
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
                <p className={styles.assetLead} data-testid="legacy-asset-cutover-boundary">
                    {t('asset.cutover.boundary')}
                </p>
                <div className={styles.assetRows}>
                    <div className={styles.assetRow} data-testid="legacy-master-disposition">
                        <span className={styles.assetLabel}>{t('asset.cutover.label')}</span>
                        <span className={styles.assetValue}>
                            {t(`asset.cutover.dispositions.${crystalAsset?.legacyDisposition ?? 'legacy_unsettled'}`)}
                        </span>
                    </div>
                    <div className={styles.assetRow}>
                        <span className={styles.assetLabel}>{t('asset.master.standard')}</span>
                        <span className={styles.assetValue}>{formatAssetStandardLabel(crystalAsset?.assetStandard, t)}</span>
                    </div>
                    <div className={styles.assetRow}>
                        <span className={styles.assetLabel}>
                            {isMockCrystalAsset ? t('asset.master.demoAddress') : t('asset.master.mintAddress')}
                        </span>
                        {renderAssetAddress({
                            assetKey: 'master',
                            address: crystalAsset?.masterAssetAddress,
                            isMock: isMockCrystalAsset,
                            kind: 'master',
                        })}
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

                <div className={styles.receiptPanel} data-testid="legacy-receipt-panel">
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
                                            <span>{formatReceiptOwnerName(receipt)}</span>
                                            <small>
                                                {receipt.contributionRole} · {formatContributionWeight(receipt.contributionWeightBps)}
                                            </small>
                                        </div>
                                        <span className={styles.assetStatus} data-status={receiptDisplayStatus}>
                                            {t(`asset.status.${receiptDisplayStatus}`)}
                                        </span>
                                        <div className={styles.receiptAssetDetails}>
                                            <span className={styles.receiptAssetLabel}>
                                                {t('asset.receipts.receiptMint')}
                                            </span>
                                            {renderAssetAddress({
                                                assetKey: `receipt:${receipt.id}`,
                                                address: receipt.receiptAssetAddress,
                                                isMock: receiptDisplayStatus === 'mock',
                                                kind: 'receipt',
                                            })}
                                            <span className={styles.receiptAssetStandard}>
                                                {formatAssetStandardLabel(receipt.assetStandard, t)}
                                            </span>
                                            <span className={styles.receiptAssetStandard} data-testid="legacy-receipt-disposition">
                                                {t(`asset.cutover.dispositions.${receipt.legacyDisposition}`)}
                                            </span>
                                        </div>
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
                    </>
                )}
            </div>
            <ContributionCredentialClaimCard knowledgeId={knowledge.knowledgeId} />
            <div className={styles.divider} />

            {/* ── Internal Record Timeline ── */}
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
                                    ? hasHistoricalFallbackContributor
                                        ? t('lineage.sourceTypes.historicalFallbackSnapshot')
                                        : hasMockContributor
                                            ? t('lineage.sourceTypes.mockSnapshot')
                                            : t('lineage.sourceTypes.snapshot')
                                    : settlementOnly
                                        ? t('lineage.sourceTypes.settlementFallback')
                                        : t('lineage.sourceTypes.unlabeled')}
                            </span>
                        </div>
                        {(hasHistoricalFallbackContributor || hasMockContributor) && (
                            <p className={styles.lineageWarning}>
                                {hasHistoricalFallbackContributor
                                    ? t('lineage.historicalFallbackWarning')
                                    : t('lineage.mockWarning')}
                            </p>
                        )}
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
                        <Link
                            href={`/knowledge/${encodeURIComponent(knowledge.knowledgeId)}/contribution-trace`}
                            className={styles.contributionTraceAction}
                        >
                            {t('lineage.traceAction')}
                        </Link>
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
                                        {formatContributorWeight(c)}
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

            {knowledge.publicationOrigin && (
                <div
                    className={styles.circleLink}
                    data-testid="knowledge-publication-origin"
                >
                    <BookOpen size={20} strokeWidth={1.5} style={{ color: 'var(--color-accent-gold)' }} />
                    <div>
                        <div className={styles.circleName}>{t('publicationOrigin.title')}</div>
                        <div className={styles.circleLabel}>
                            {knowledge.publicationOrigin.kind === 'governance_case_outcome'
                                ? t('publicationOrigin.governed')
                                : t('publicationOrigin.ordinary')}
                        </div>
                        <div className={styles.circleLabel} data-testid="knowledge-governance-home">
                            {t('publicationOrigin.governanceHome', {
                                circleId: knowledge.publicationOrigin.governanceHomeRef,
                            })}
                        </div>
                        <div className={styles.circleLabel} data-testid="knowledge-submit-authority">
                            {t('publicationOrigin.submitAuthority', {
                                member: knowledge.author?.handle
                                    ? `@${knowledge.author.handle}`
                                    : knowledge.publicationOrigin.submittedByPubkey,
                            })}
                        </div>
                        <div className={styles.circleLabel} data-testid="knowledge-verified-attribution">
                            {t('publicationOrigin.verifiedAttribution', {
                                count: knowledge.contributorsCount,
                            })}
                        </div>
                        {knowledge.publicationOrigin.committeeCircleId && (
                            <div className={styles.circleLabel} data-testid="knowledge-participating-committee">
                                {t('publicationOrigin.participatingCommittee', {
                                    circleId: knowledge.publicationOrigin.committeeCircleId,
                                })}
                            </div>
                        )}
                        {knowledge.publicationOrigin.kind === 'governance_case_outcome'
                            && knowledge.publicationOrigin.caseId && (
                                <Link
                                    href={`/governance/cases/${encodeURIComponent(knowledge.publicationOrigin.caseId)}`}
                                    className={styles.contributionTraceAction}
                                >
                                    {t('publicationOrigin.openCase')}
                                </Link>
                            )}
                    </div>
                </div>
            )}

            <div className={styles.circleLink} data-testid="knowledge-publication-license">
                <BookOpen size={20} strokeWidth={1.5} style={{ color: 'var(--color-accent-gold)' }} />
                <div>
                    <div className={styles.circleName}>{t('publicationLicense.title')}</div>
                    <div className={styles.circleLabel}>
                        {knowledge.publicationState === 'published'
                            ? t('publicationLicense.published')
                            : t('publicationLicense.restricted')}
                    </div>
                    <div className={styles.circleLabel}>
                        {knowledge.publicationLicenseRef && knowledge.publicationLicenseVersion
                            ? `${knowledge.publicationLicenseRef} · ${knowledge.publicationLicenseVersion}`
                            : t('publicationLicense.notActivated')}
                    </div>
                    {knowledge.publicationState === 'published' ? (
                        <div className={styles.circleLabel}>
                            {t('publicationLicense.safeDefault')}
                        </div>
                    ) : null}
                    <div className={styles.circleLabel}>
                        {t('publicationLicense.targetCircle', {
                            circle: knowledge.circle?.name || knowledge.circle?.id || '—',
                        })}
                    </div>
                    {knowledge.stablePublicPath ? (
                        <div className={styles.circleLabel}>{t('publicationLicense.stablePath', { path: knowledge.stablePublicPath })}</div>
                    ) : null}
                    {knowledge.publicationVersions[0] ? (
                        <div className={styles.circleLabel}>
                            {t('publicationLicense.snapshot', {
                                digest: knowledge.publicationVersions[0].sourceSnapshotDigest.slice(0, 12),
                                count: knowledge.publicationVersions[0].authorizedContributors.length,
                            })}
                        </div>
                    ) : null}
                    {publicPublicationSources.map((source) => (
                        <div key={source.id} className={styles.circleLabel} data-testid="knowledge-publication-source">
                            <div>
                                {t('publicationLicense.sourceSummary', {
                                    name: source.name,
                                    chunks: source.chunks.length,
                                    digest: source.contentDigest.slice(0, 12),
                                })}
                                {source.canonicalUrl ? (
                                    <>{' · '}<a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.canonicalUrl}</a></>
                                ) : null}
                            </div>
                            {source.chunks.map((chunk) => (
                                <div key={chunk.chunkIndex}>
                                    {t('publicationLicense.chunk', {
                                        index: chunk.chunkIndex,
                                        digest: chunk.textDigest.slice(0, 12),
                                        text: chunk.text,
                                    })}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            <div className={styles.durabilityPanel} data-testid="knowledge-durability">
                <ShieldCheck size={20} strokeWidth={1.5} className={styles.durabilityIcon} />
                <div className={styles.durabilityBody}>
                    <div className={styles.circleName}>{t('durability.title')}</div>
                    {durabilityLoading ? (
                        <div className={styles.circleLabel}>{t('durability.loading')}</div>
                    ) : durability ? (
                        <>
                            <div className={styles.circleLabel} data-status={durability.status}>
                                {t(`durability.status.${durability.status}`)} · {t(`durability.tier.${durability.tier}`)}
                            </div>
                            <div className={styles.circleLabel}>
                                {t('durability.slo', {
                                    interval: Math.round(durability.policy.verificationIntervalSeconds / 3600),
                                    rpo: Math.round(durability.policy.rpoSeconds / 3600),
                                    rto: Math.round(durability.policy.rtoSeconds / 3600),
                                })}
                            </div>
                            <div className={styles.circleLabel}>
                                {t('durability.replica', {
                                    provider: durability.replicaProvider,
                                    digest: durability.replicaDigest.slice(0, 12),
                                    bytes: durability.replicaByteSize,
                                })}
                            </div>
                            <div className={styles.circleLabel}>
                                {durability.verificationOverdue
                                    ? t('durability.overdue')
                                    : t('durability.verified', { at: new Date(durability.lastVerifiedAt).toLocaleString(locale) })}
                            </div>
                            <div className={styles.circleLabel}>{t('durability.productionPending')}</div>
                            <div className={styles.durabilityActions}>
                                <button
                                    type="button"
                                    className={styles.durabilityAction}
                                    disabled={durabilityAction !== null}
                                    onClick={() => void runDurabilityAction('verify')}
                                >
                                    <RefreshCw size={14} />
                                    {t('durability.verify')}
                                </button>
                                {durability.status !== 'healthy' ? (
                                    <button
                                        type="button"
                                        className={styles.durabilityAction}
                                        disabled={durabilityAction !== null}
                                        onClick={() => void runDurabilityAction('repair')}
                                    >
                                        <RefreshCw size={14} />
                                        {t('durability.repair')}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className={styles.durabilityAction}
                                    disabled={durabilityAction !== null}
                                    onClick={() => void runDurabilityAction('export')}
                                >
                                    <Download size={14} />
                                    {t('durability.export')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className={styles.circleLabel}>{t('durability.unavailable')}</div>
                    )}
                    {durabilityError ? <div className={styles.durabilityError}>{durabilityError}</div> : null}
                </div>
            </div>

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
            <KnowledgeRelationshipLabelSheet
                open={relationshipLabelSheetOpen}
                labels={relationshipLabels}
                loading={relationshipLabelsLoading}
                failed={Boolean(relationshipLabelsError)}
                activeLabelKey={knowledge.relationshipAssignment?.labelKey ?? null}
                onClose={() => setRelationshipLabelSheetOpen(false)}
            />
        </motion.div>
    );
}
