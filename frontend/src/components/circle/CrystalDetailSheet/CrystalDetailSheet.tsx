'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, Copy, BookOpen, Users, Bot } from 'lucide-react';
import dynamic from 'next/dynamic';
import { computeCrystalVisualParams, type CrystalDataInput } from '@/lib/crystal/visualParams';
import {
    buildCrystalOutputViewModelFromRecord,
    type CrystallizationOutputRecordInput,
} from '@/features/crystal-output/adapter';
import { fetchCrystallizationOutputRecordByKnowledgeId } from '@/features/crystal-output/api';
import { useI18n } from '@/i18n/useI18n';
import CrystalOutputEvidencePanel from '@/features/crystal-output/CrystalOutputEvidencePanel';
import styles from './CrystalDetailSheet.module.css';

/* Dynamic imports for 3D crystal (no SSR) */
const Crystal3D = dynamic(
    () => import('@/components/crystal/Crystal3D'),
    { ssr: false },
);
const CrystalDisplay = dynamic(
    () => import('@/components/crystal/CrystalDisplay'),
    { ssr: false },
);

/* ═══ Types ═══ */

export interface CrystalSource {
    author: string;
    text: string;
    date?: string;
}

export type ContributionRole = 'author' | 'discussant' | 'reviewer' | 'cited' | 'unknown';
export type AuthorType = 'HUMAN' | 'AGENT';

export interface CrystalContributor {
    handle: string;
    role: ContributionRole;
    /** Contribution weight for this role (0.0 ~ 1.0) */
    weight: number;
    /** Whether this contribution was made by a human or their AI agent */
    authorType: AuthorType;
    sourceType?: 'SNAPSHOT' | 'SETTLEMENT';
    sourceDraftPostId?: number | null;
    sourceAnchorId?: string | null;
    sourcePayloadHash?: string | null;
    sourceSummaryHash?: string | null;
    sourceMessagesDigest?: string | null;
}

export interface CrystalDetail {
    id: number;
    title: string;
    author: string;
    version: string;
    citedBy: number;
    ageDays: number;
    /** Full content body (markdown-like plain text) */
    content: string;
    /** Source discussions that led to this crystal */
    sources: CrystalSource[];
    /** Contributors to this crystal */
    contributors: CrystalContributor[];
    /* ── Optional fields for Crystal3D visual rendering ── */
    /** Knowledge ID (hex string) for seed generation */
    knowledgeId?: string;
    /** Circle name for hue calculation */
    circleName?: string;
    /** Quality score [0-100] for clarity */
    qualityScore?: number;
    /** Contributors count for facets */
    contributorsCount?: number;
}

interface CrystalDetailSheetProps {
    open: boolean;
    crystal: CrystalDetail | null;
    patinaLevel?: 'fresh' | 'settling' | 'ancient';
    onClose: () => void;
    onCopy?: () => void;
    onOpenKnowledge?: () => void;
}

/* ═══ Component ═══ */

export default function CrystalDetailSheet({
    open,
    crystal,
    patinaLevel = 'fresh',
    onClose,
    onCopy,
    onOpenKnowledge,
}: CrystalDetailSheetProps) {
    const t = useI18n('CrystalDetailSheet');
    const [formalOutputRecord, setFormalOutputRecord] = useState<CrystallizationOutputRecordInput | null>(null);
    const [formalOutputLoading, setFormalOutputLoading] = useState(false);
    const [formalOutputError, setFormalOutputError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !crystal?.knowledgeId) {
            setFormalOutputRecord(null);
            setFormalOutputLoading(false);
            setFormalOutputError(null);
            return;
        }

        let cancelled = false;
        setFormalOutputLoading(true);
        setFormalOutputError(null);
        void fetchCrystallizationOutputRecordByKnowledgeId({
            knowledgeId: crystal.knowledgeId,
        })
            .then((record) => {
                if (cancelled) return;
                setFormalOutputRecord(record);
            })
            .catch((error) => {
                if (cancelled) return;
                setFormalOutputRecord(null);
                setFormalOutputError(error instanceof Error ? error.message : t('errors.loadFormalOutput'));
            })
            .finally(() => {
                if (cancelled) return;
                setFormalOutputLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [crystal?.knowledgeId, open, t]);

    const outputView = useMemo(() => {
        if (!crystal || !formalOutputRecord) return null;
        return buildCrystalOutputViewModelFromRecord({
            knowledge: {
                knowledgeId: crystal.knowledgeId || `crystal:${crystal.id}`,
                title: crystal.title,
                version: parseInt(crystal.version.replace('v', ''), 10) || 1,
                contributorsCount: crystal.contributorsCount ?? crystal.contributors.length,
                createdAt: new Date(Date.now() - crystal.ageDays * 86400000).toISOString(),
                stats: {
                    citationCount: crystal.citedBy,
                },
                contributors: crystal.contributors.map((item) => ({
                    sourceType: item.sourceType,
                    sourceDraftPostId: item.sourceDraftPostId,
                    sourceAnchorId: item.sourceAnchorId,
                    sourceSummaryHash: item.sourceSummaryHash,
                    sourceMessagesDigest: item.sourceMessagesDigest,
                })),
                references: [],
                citedBy: [],
            },
            record: formalOutputRecord,
        });
    }, [crystal, formalOutputRecord]);

    if (!crystal) return null;

    const shortenHash = (value: string | null | undefined): string | null => {
        if (!value || typeof value !== 'string') return null;
        const normalized = value.trim();
        if (!normalized) return null;
        if (normalized.length <= 20) return normalized;
        return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`;
    };

    const ROLE_META: Record<ContributionRole, { label: string; emoji: string; maxWeight: number }> = {
        author: { label: t('roles.author'), emoji: '✏️', maxWeight: 0.50 },
        discussant: { label: t('roles.discussant'), emoji: '💬', maxWeight: 0.25 },
        reviewer: { label: t('roles.reviewer'), emoji: '🔍', maxWeight: 0.20 },
        cited: { label: t('roles.cited'), emoji: '📎', maxWeight: 0.05 },
        unknown: { label: t('roles.unknown'), emoji: '🧩', maxWeight: 1.00 },
    };

    /* Group contributors by role for ledger display */
    const roleGroups = (['author', 'discussant', 'reviewer', 'cited', 'unknown'] as ContributionRole[])
        .map(role => ({
            role,
            meta: ROLE_META[role],
            members: crystal.contributors.filter(c => c.role === role),
        }))
        .filter(g => g.members.length > 0);
    const snapshotContributor = crystal.contributors.find((item) => item.sourceType === 'SNAPSHOT');
    const settlementOnly = !snapshotContributor && crystal.contributors.some((item) => item.sourceType === 'SETTLEMENT');
    const lineageRows: Array<{ label: string; value: string }> = [];
    if (snapshotContributor?.sourceDraftPostId) {
        lineageRows.push({
            label: t('lineage.sourceDraft'),
            value: `#${snapshotContributor.sourceDraftPostId}`,
        });
    }
    const sourceAnchorId = shortenHash(snapshotContributor?.sourceAnchorId);
    if (sourceAnchorId) {
        lineageRows.push({ label: t('lineage.discussionAnchor'), value: sourceAnchorId });
    }
    const sourceSummaryHash = shortenHash(snapshotContributor?.sourceSummaryHash);
    if (sourceSummaryHash) {
        lineageRows.push({ label: t('lineage.summaryHash'), value: sourceSummaryHash });
    }
    const sourceMessagesDigest = shortenHash(snapshotContributor?.sourceMessagesDigest);
    if (sourceMessagesDigest) {
        lineageRows.push({ label: t('lineage.messagesDigest'), value: sourceMessagesDigest });
    }

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={styles.sheet}
                        initial={{ y: '100%', opacity: 0.5 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: '100%', opacity: 0.5 }}
                        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={styles.handle} />

                        <div className={styles.scrollArea}>
                            {/* ── Crystal 3D Hero ── */}
                            {crystal.knowledgeId && (() => {
                                const input: CrystalDataInput = {
                                    knowledgeId: crystal.knowledgeId!,
                                    circleName: crystal.circleName || '',
                                    qualityScore: crystal.qualityScore ?? 50,
                                    contributorsCount: crystal.contributorsCount ?? 1,
                                    version: parseInt(crystal.version.replace('v', '')) || 1,
                                    citationCount: crystal.citedBy,
                                    createdAt: new Date(Date.now() - crystal.ageDays * 86400000).toISOString(),
                                };
                                const params = computeCrystalVisualParams(input);
                                return (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
                                        <CrystalDisplay params={params} size={200} particles={false}>
                                            <Crystal3D params={params} size={200} />
                                        </CrystalDisplay>
                                    </div>
                                );
                            })()}

                            {/* ── Header ── */}
                            <div className={styles.header}>
                                <span className={`${styles.statusBadge} ${patinaLevel === 'ancient' ? styles.statusCrystal : styles.statusSettling}`}>
                                    {patinaLevel === 'ancient'
                                        ? t('patina.ancient')
                                        : patinaLevel === 'settling'
                                            ? t('patina.settling')
                                            : t('patina.fresh')}
                                </span>
                                <h2 className={styles.title}>{crystal.title}</h2>
                                <div className={styles.meta}>
                                    <span>@{crystal.author}</span>
                                    <span>·</span>
                                    <span>{crystal.version}</span>
                                    <span>·</span>
                                    <span className={styles.metaGold}>{t('meta.citedBy', { count: crystal.citedBy })}</span>
                                    <span>·</span>
                                    <span>{t('meta.ageDays', { count: crystal.ageDays })}</span>
                                </div>
                            </div>

                            <div className={styles.divider} />

                            {/* ── Content body ── */}
                            <div className={styles.body}>
                                {crystal.content.split('\n\n').map((paragraph, i) => (
                                    <p key={i}>{paragraph}</p>
                                ))}
                            </div>

                            <div className={styles.divider} />

                            {outputView ? (
                                <CrystalOutputEvidencePanel output={outputView} />
                            ) : (
                                <div className={styles.lineageCard}>
                                    <div className={styles.lineageHead}>
                                        <span className={styles.lineageLabel}>{t('formalOutput.label')}</span>
                                        <span className={styles.lineageValue}>
                                            {formalOutputLoading
                                                ? t('formalOutput.loading')
                                                : formalOutputError
                                                    ? t('formalOutput.unavailable')
                                                    : t('formalOutput.pending')}
                                        </span>
                                    </div>
                                    <p className={styles.lineageValue} style={{ display: 'block', marginTop: 8 }}>
                                        {formalOutputLoading
                                            ? t('formalOutput.loadingBody')
                                            : formalOutputError
                                                ? formalOutputError
                                                : t('formalOutput.pendingBody')}
                                    </p>
                                </div>
                            )}

                            <div className={styles.divider} />

                            {/* ── Source provenance ── */}
                            {crystal.sources.length > 0 && (
                                <>
                                    <div className={styles.sectionTitle}>
                                        <Link2 size={12} className={styles.sectionIcon} />
                                        {t('sections.provenance')}
                                    </div>
                                    <div className={styles.sourceList}>
                                        {crystal.sources.map((src, i) => (
                                            <div key={i} className={styles.sourceItem}>
                                                <span className={styles.sourceAuthor}>@{src.author}</span>
                                                <span className={styles.sourceText}>
                                                    {src.text}
                                                    {src.date && <span style={{ opacity: 0.5 }}> · {src.date}</span>}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    <div className={styles.divider} />
                                </>
                            )}

                            {/* ── Contribution Ledger ── */}
                            {crystal.contributors.length > 0 && (
                                <>
                                    <div className={styles.sectionTitle}>
                                        <Users size={12} className={styles.sectionIcon} />
                                        {t('sections.contributionLedger')}
                                    </div>
                                    <div className={styles.lineageCard}>
                                        <div className={styles.lineageHead}>
                                            <span className={styles.lineageLabel}>{t('lineage.sourceType')}</span>
                                            <span className={styles.lineageValue}>
                                                {snapshotContributor
                                                    ? t('lineage.snapshotSource')
                                                    : settlementOnly
                                                        ? t('lineage.settlementFallback')
                                                        : t('lineage.unlabeled')}
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
                                    <div className={styles.ledger}>
                                        {roleGroups.map(({ role, meta, members }) => (
                                            <div key={role} className={styles.ledgerGroup}>
                                                <div className={styles.ledgerRole}>
                                                    <span className={styles.ledgerEmoji}>{meta.emoji}</span>
                                                    <span className={styles.ledgerRoleLabel}>{meta.label}</span>
                                                    <span className={styles.ledgerRoleWeight}>
                                                        {Math.round(meta.maxWeight * 100)}%
                                                    </span>
                                                </div>
                                                <div className={styles.ledgerMembers}>
                                                    {members.map((c, i) => (
                                                        <div key={i} className={styles.ledgerMember}>
                                                            <div className={styles.ledgerMemberInfo}>
                                                                {c.authorType === 'AGENT' && (
                                                                    <span className={styles.agentBadge}>
                                                                        <Bot size={11} className={styles.agentBadgeIcon} />
                                                                        <span className={styles.agentBadgeText}>AI Agent</span>
                                                                    </span>
                                                                )}
                                                                <span className={styles.ledgerHandle}>@{c.handle}</span>
                                                            </div>
                                                            <div className={styles.ledgerWeightBar}>
                                                                <div
                                                                    className={styles.ledgerWeightFill}
                                                                    style={{ width: `${Math.round(c.weight * 100)}%` }}
                                                                />
                                                            </div>
                                                            <span className={styles.ledgerWeightLabel}>
                                                                {Math.round(c.weight * 100)}%
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className={styles.divider} />
                                </>
                            )}

                            {/* ── Actions ── */}
                            <div className={styles.actions}>
                                <button className={styles.actionBtn} onClick={onCopy}>
                                    <Copy size={16} className={styles.actionBtnIcon} />
                                    {t('actions.copy')}
                                </button>
                                <button
                                    className={styles.actionBtn}
                                    onClick={onOpenKnowledge}
                                    disabled={!onOpenKnowledge}
                                    aria-label={!onOpenKnowledge ? t('actions.openKnowledgePending') : undefined}
                                    title={!onOpenKnowledge ? t('actions.openKnowledgePending') : undefined}
                                >
                                    <BookOpen size={16} className={styles.actionBtnIcon} />
                                    {onOpenKnowledge ? t('actions.openKnowledge') : t('actions.openKnowledgePending')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
