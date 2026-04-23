'use client';

import { useI18n } from '@/i18n/useI18n';
import { type ForkReadinessViewModel } from './adapter';
import styles from './ForkReadinessPanel.module.css';

interface ForkReadinessPanelProps {
    hint: ForkReadinessViewModel;
}

export function ForkReadinessPanel({ hint }: ForkReadinessPanelProps) {
    const t = useI18n('ForkReadinessPanel');

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <div>
                    <div className={styles.eyebrow}>{t('eyebrow')}</div>
                    <h3 className={styles.title}>{hint.hintTitle}</h3>
                </div>
                <span className={styles.statusBadge}>{hint.statusBadgeLabel}</span>
            </div>

            <p className={styles.body}>{hint.hintBody}</p>

            <div className={styles.rows}>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.sourceCircle')}</span>
                    <span className={styles.value}>{hint.sourceCircleName}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.currentQualification')}</span>
                    <span className={styles.value}>{hint.currentQualificationLabel}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.contributionThreshold')}</span>
                    <span className={styles.value}>{hint.contributionProgressLabel}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.identityFloor')}</span>
                    <span className={styles.value}>{hint.identityFloorLabel}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.level')}</span>
                    <span className={styles.value}>{hint.sourceLevelLabel}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.entryThreshold')}</span>
                    <span className={styles.value}>{hint.thresholdLabel}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.inheritance')}</span>
                    <span className={styles.value}>{hint.inheritanceLabel}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.knowledgeLineage')}</span>
                    <span className={styles.value}>{hint.knowledgeLineageLabel}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.originMarker')}</span>
                    <span className={styles.value}>{t('values.originMarker')}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.retentionRhythm')}</span>
                    <span className={styles.value}>{t('values.retentionRhythm')}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{t('labels.prefill')}</span>
                    <span className={styles.value}>{hint.prefillSourceLabel}</span>
                </div>
            </div>
        </section>
    );
}

export default ForkReadinessPanel;
