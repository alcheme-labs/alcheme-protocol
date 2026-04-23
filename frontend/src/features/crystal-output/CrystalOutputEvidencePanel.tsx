'use client';

import { useMemo } from 'react';

import { createCircleSummaryCopy, formatSummaryDegradationLabel } from '@/features/circle-summary/adapter';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import { type CrystalOutputViewModel } from './adapter';
import styles from './CrystalOutputEvidencePanel.module.css';

interface CrystalOutputEvidencePanelProps {
    output: CrystalOutputViewModel;
    variant?: 'compact' | 'full';
}

function shortenHash(value: string | null): string | null {
    if (!value) return null;
    if (value.length <= 18) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function bindingLabel(
    kind: CrystalOutputViewModel['sourceBindingKind'],
    t: ReturnType<typeof useI18n>,
): string {
    if (kind === 'snapshot') return t('binding.snapshot');
    if (kind === 'settlement_fallback') return t('binding.settlementFallback');
    return t('binding.unresolved');
}

export function CrystalOutputEvidencePanel({
    output,
    variant = 'full',
}: CrystalOutputEvidencePanelProps) {
    const t = useI18n('CrystalOutputEvidencePanel');
    const adapterT = useI18n('CircleSummaryAdapter');
    const locale = useCurrentLocale();
    const summaryCopy = useMemo(() => createCircleSummaryCopy(adapterT, locale), [adapterT, locale]);

    if (variant === 'compact') {
        return (
            <div className={styles.compactCard}>
                <span className={styles.compactBadge}>{bindingLabel(output.sourceBindingKind, t)}</span>
                <span className={styles.compactMeta}>{t('compact.citations', {count: output.citationCount})}</span>
                {output.sourceDraftPostId !== null && (
                    <span className={styles.compactMeta}>{t('compact.draft', {draftPostId: output.sourceDraftPostId})}</span>
                )}
                {output.missingTeam03Inputs.length > 0 && (
                    <span className={styles.compactMissing}>
                        {t('degradationPrefix', {
                            label: formatSummaryDegradationLabel(output.missingTeam03Inputs[0], summaryCopy),
                        })}
                    </span>
                )}
            </div>
        );
    }

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <div>
                    <div className={styles.eyebrow}>{t('eyebrow')}</div>
                    <h3 className={styles.title}>{t('title')}</h3>
                </div>
                <span className={styles.bindingBadge}>{bindingLabel(output.sourceBindingKind, t)}</span>
            </div>

            <div className={styles.metrics}>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>{t('metrics.version.label')}</span>
                    <span className={styles.metricValue}>{output.versionLabel}</span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>{t('metrics.contributors.label')}</span>
                    <span className={styles.metricValue}>{output.contributorCount}</span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>{t('metrics.citations.label')}</span>
                    <span className={styles.metricValue}>{output.citationCount}</span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>{t('metrics.preview.label')}</span>
                    <span className={styles.metricValue}>
                        {t('metrics.preview.value', {
                            outboundReferenceCount: output.outboundReferenceCount,
                            inboundReferenceCount: output.inboundReferenceCount,
                        })}
                    </span>
                </div>
            </div>

            <div className={styles.rows}>
                <div className={styles.row}>
                    <span className={styles.rowLabel}>{t('rows.sourceDraft.label')}</span>
                    <span className={styles.rowValue}>
                        {output.sourceDraftPostId !== null ? `#${output.sourceDraftPostId}` : t('rows.sourceDraft.empty')}
                    </span>
                </div>
                <div className={styles.row}>
                    <span className={styles.rowLabel}>{t('rows.anchor.label')}</span>
                    <span className={styles.rowValue}>{shortenHash(output.sourceAnchorId) || t('rows.common.missing')}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.rowLabel}>{t('rows.summaryHash.label')}</span>
                    <span className={styles.rowValue}>{shortenHash(output.sourceSummaryHash) || t('rows.common.missing')}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.rowLabel}>{t('rows.messageDigest.label')}</span>
                    <span className={styles.rowValue}>{shortenHash(output.sourceMessagesDigest) || t('rows.common.missing')}</span>
                </div>
            </div>

            {output.missingTeam03Inputs.length > 0 && (
                <div className={styles.missingWrap}>
                    {output.missingTeam03Inputs.map((item) => (
                        <span key={item} className={styles.missingChip}>
                            {t('degradationPrefix', {label: formatSummaryDegradationLabel(item, summaryCopy)})}
                        </span>
                    ))}
                </div>
            )}
        </section>
    );
}

export default CrystalOutputEvidencePanel;
