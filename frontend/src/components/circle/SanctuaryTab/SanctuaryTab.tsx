'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';

import { Card } from '@/components/ui/Card';
import { usePatina } from '@/hooks/usePatina';
import { computeCrystalVisualParams, type CrystalDataInput } from '@/lib/crystal/visualParams';
import type { CrystalDetail } from '@/components/circle/CrystalDetailSheet';
import KnowledgeRelationshipLabelSheet from '@/components/knowledge/KnowledgeRelationshipLabelSheet/KnowledgeRelationshipLabelSheet';
import { GET_KNOWLEDGE_RELATIONSHIP_LABELS } from '@/lib/apollo/queries';
import type { GQLKnowledgeRelationshipLabel } from '@/lib/apollo/types';
import { useI18n } from '@/i18n/useI18n';
import styles from '@/app/(main)/circles/[id]/page.module.css';

/* Dynamic imports for 3D crystal (no SSR) */
const Crystal3D = dynamic(
    () => import('@/components/crystal/Crystal3D'),
    { ssr: false },
);
const CrystalDisplay = dynamic(
    () => import('@/components/crystal/CrystalDisplay'),
    { ssr: false },
);

/* ═══ Sanctuary (圣殿) ═══ */

export interface SanctuaryTabProps {
    crystals: CrystalDetail[];
    onCrystalClick: (crystal: CrystalDetail & { patinaLevel: string }) => void;
}

export default function SanctuaryTab({ crystals, onCrystalClick }: SanctuaryTabProps) {
    const [labelSheetOpen, setLabelSheetOpen] = useState(false);
    const [activeLabelKey, setActiveLabelKey] = useState<string | null>(null);
    const {
        data: labelData,
        loading: labelsLoading,
        error: labelsError,
    } = useQuery<{ knowledgeRelationshipLabels: GQLKnowledgeRelationshipLabel[] }>(
        GET_KNOWLEDGE_RELATIONSHIP_LABELS,
        { variables: { status: 'active' } },
    );
    const labels = labelData?.knowledgeRelationshipLabels ?? [];

    return (
        <>
            <div className={styles.crystalList}>
                {crystals.map((crystal, i) => (
                    <SanctuaryCrystalItem
                        key={crystal.id}
                        crystal={crystal}
                        index={i}
                        onCrystalClick={onCrystalClick}
                        onOpenLabelSheet={(labelKey) => {
                            setActiveLabelKey(labelKey);
                            setLabelSheetOpen(true);
                        }}
                    />
                ))}
            </div>
            <KnowledgeRelationshipLabelSheet
                open={labelSheetOpen}
                labels={labels}
                loading={labelsLoading}
                failed={Boolean(labelsError)}
                activeLabelKey={activeLabelKey}
                onClose={() => setLabelSheetOpen(false)}
            />
        </>
    );
}

/* Inner item to satisfy hook rules (no hooks inside .map) */
function SanctuaryCrystalItem({
    crystal,
    index,
    onCrystalClick,
    onOpenLabelSheet,
}: {
    crystal: CrystalDetail;
    index: number;
    onCrystalClick: (crystal: CrystalDetail & { patinaLevel: string }) => void;
    onOpenLabelSheet: (labelKey: string) => void;
}) {
    const t = useI18n('SanctuaryTab');
    const { style: patinaStyle, level } = usePatina({
        referenceCount: crystal.citedBy,
        ageDays: crystal.ageDays,
        discussionFrequency: crystal.citedBy / Math.max(1, crystal.ageDays),
    });

    /* Compute crystal visual params for 3D thumbnail */
    const crystalParams = useMemo(() => {
        if (!crystal.knowledgeId) return null;
        const input: CrystalDataInput = {
            knowledgeId: crystal.knowledgeId,
            circleName: crystal.circleName || '',
            qualityScore: crystal.qualityScore ?? 50,
            contributorsCount: crystal.contributorsCount ?? 1,
            version: crystal.internalRecordVersion || parseInt(crystal.version.replace('v', '')) || 1,
            citationCount: crystal.citedBy,
            createdAt: crystal.createdAt ?? new Date(Date.now() - crystal.ageDays * 86400000).toISOString(),
            heatScore: crystal.heatScore ?? 0,
        };
        return computeCrystalVisualParams(input, crystal.crystalParams ?? null);
    }, [crystal.knowledgeId, crystal.circleName, crystal.qualityScore, crystal.contributorsCount, crystal.internalRecordVersion, crystal.version, crystal.citedBy, crystal.createdAt, crystal.ageDays, crystal.heatScore, crystal.crystalParams]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.06 }}
            style={{ ...patinaStyle as React.CSSProperties, cursor: 'pointer' }}
            onClick={() => onCrystalClick({ ...crystal, patinaLevel: level })}
        >
            <Card state="crystal">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {/* Crystal 3D thumbnail */}
                    {crystalParams && (
                        <div style={{ flexShrink: 0 }}>
                            <CrystalDisplay params={crystalParams} size={80} particles={false}>
                                <Crystal3D params={crystalParams} size={80} animate={false} />
                            </CrystalDisplay>
                        </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 className={styles.crystalTitle}>{crystal.title}</h3>
                        <div className={styles.crystalMeta}>
                            <span>@{crystal.author}</span>
                            <span>·</span>
                            <button
                                type="button"
                                className={styles.crystalRelationshipLabel}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenLabelSheet(crystal.relationshipLabelKey);
                                }}
                            >
                                {crystal.relationshipLabel}
                            </button>
                            {crystal.sourceDraftVersionLabel && (
                                <>
                                    <span>·</span>
                                    <span>{crystal.sourceDraftVersionLabel}</span>
                                </>
                            )}
                            <span>·</span>
                            <span className={styles.citedCount}>{t('meta.citedCount', {count: crystal.citedBy})}</span>
                        </div>
                        {level !== 'fresh' && (
                            <span className={styles.patinaLabel}>
                                {level === 'ancient' ? t('patina.ancient') : t('patina.weathering')}
                            </span>
                        )}
                    </div>
                </div>
            </Card>
        </motion.div>
    );
}
