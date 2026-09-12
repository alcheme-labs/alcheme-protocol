'use client';

import { useMemo } from 'react';

import {
    buildDraftReferenceLinkConsumptionNeeds,
    createCircleSummaryCopy,
    formatCircleSummaryGeneratedByLabel,
    formatCircleSummaryProviderModeLabel,
    formatDraftReferenceLinkConsumptionFieldLabel,
    formatSummaryDegradationLabel,
    type CircleSummarySnapshotDiagnostics,
} from './adapter';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './SummaryReadinessPanel.module.css';

interface SummaryReadinessPanelProps {
    sourceDraftPostId: number | null;
    missingTeam03Inputs?: string[];
    snapshotDiagnostics?: CircleSummarySnapshotDiagnostics | null;
    summarySource?: 'snapshot' | 'pending_snapshot';
}

export function SummaryReadinessPanel({
    sourceDraftPostId,
    missingTeam03Inputs = [],
    snapshotDiagnostics = null,
    summarySource = 'pending_snapshot',
}: SummaryReadinessPanelProps) {
    const t = useI18n('CircleSummaryReadinessPanel');
    const adapterT = useI18n('CircleSummaryAdapter');
    const locale = useCurrentLocale();
    const summaryCopy = useMemo(() => createCircleSummaryCopy(adapterT, locale), [adapterT, locale]);
    const referenceNeeds = useMemo(() => buildDraftReferenceLinkConsumptionNeeds(), []);

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <div>
                    <div className={styles.eyebrow}>{t('eyebrow')}</div>
                    <h3 className={styles.title}>{t('title')}</h3>
                </div>
                <span className={styles.statusBadge}>
                    {snapshotDiagnostics ? t('status.snapshotVersion', {version: snapshotDiagnostics.version}) : t('status.waiting')}
                </span>
            </div>

            <div className={styles.grid}>
                <div className={styles.card}>
                    <h4 className={styles.cardTitle}>{t('cards.truthSource.title')}</h4>
                    <p className={styles.note}>
                        {snapshotDiagnostics
                            ? t('cards.truthSource.snapshotNote', {
                                version: snapshotDiagnostics.version,
                                generatedBy: formatCircleSummaryGeneratedByLabel(snapshotDiagnostics.generatedBy, summaryCopy),
                            })
                            : summarySource === 'pending_snapshot'
                                ? t('cards.truthSource.pendingSnapshotOnly')
                                : t('cards.truthSource.snapshotTruthLive')}
                    </p>
                    {snapshotDiagnostics && (
                        <div className={styles.inlineChips}>
                            <span className={styles.inlineChip}>{t('chips.version', {version: snapshotDiagnostics.version})}</span>
                            <span className={styles.inlineChip}>{formatCircleSummaryGeneratedByLabel(snapshotDiagnostics.generatedBy, summaryCopy)}</span>
                            <span className={styles.inlineChip}>{snapshotDiagnostics.generatedAt}</span>
                        </div>
                    )}
                    {snapshotDiagnostics?.generationMetadata && (
                        <div className={styles.inlineChips}>
                            <span className={styles.inlineChip}>
                                {t('chips.model', {model: snapshotDiagnostics.generationMetadata.model})}
                            </span>
                            <span className={styles.inlineChip}>
                                {t('chips.providerMode', {
                                    providerMode: formatCircleSummaryProviderModeLabel(snapshotDiagnostics.generationMetadata.providerMode, summaryCopy),
                                })}
                            </span>
                            <span className={styles.inlineChip}>
                                {t('chips.promptVersion', {
                                    promptAsset: snapshotDiagnostics.generationMetadata.promptAsset,
                                    promptVersion: snapshotDiagnostics.generationMetadata.promptVersion,
                                })}
                            </span>
                            <span className={styles.inlineChip}>
                                {t('chips.contextFingerprint', {
                                    digest: snapshotDiagnostics.generationMetadata.sourceDigest.slice(0, 12),
                                })}
                            </span>
                        </div>
                    )}
                </div>

                <div className={styles.card}>
                    <h4 className={styles.cardTitle}>{t('cards.knowledgePath.title')}</h4>
                    <ul className={styles.list}>
                        <li>{t('cards.knowledgePath.items.identityAndVersion')}</li>
                        <li>{t('cards.knowledgePath.items.snapshotLineage')}</li>
                        <li>{t('cards.knowledgePath.items.citations')}</li>
                        <li>{t('cards.knowledgePath.items.versionHeat')}</li>
                    </ul>
                </div>

                <div className={styles.card}>
                    <h4 className={styles.cardTitle}>{t('cards.draftBaseline.title')}</h4>
                    <ul className={styles.list}>
                        <li>{t('cards.draftBaseline.items.draftIdentity')}</li>
                        <li>{t('cards.draftBaseline.items.stableVersion')}</li>
                        <li>{t('cards.draftBaseline.items.workingCopy')}</li>
                    </ul>
                    <p className={styles.note}>
                        {sourceDraftPostId !== null
                            ? t('cards.draftBaseline.noteWithDraft', {draftPostId: sourceDraftPostId})
                            : t('cards.draftBaseline.noteWithoutDraft')}
                    </p>
                    {missingTeam03Inputs.length > 0 && (
                        <>
                            <p className={styles.note}>{t('cards.draftBaseline.degradationLead')}</p>
                            <div className={styles.inlineChips}>
                                {missingTeam03Inputs.map((item) => (
                                    <span key={item} className={styles.inlineChip}>
                                        {t('degradation.prefix', {label: formatSummaryDegradationLabel(item, summaryCopy)})}
                                    </span>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className={styles.referenceCard}>
                <h4 className={styles.cardTitle}>{t('cards.references.title')}</h4>
                <p className={styles.note}>{t('cards.references.note')}</p>
                <div className={styles.chips}>
                    {referenceNeeds.fields.map((field) => (
                        <span key={field.field} className={styles.chip}>
                            {formatDraftReferenceLinkConsumptionFieldLabel(field.field, summaryCopy)}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default SummaryReadinessPanel;
