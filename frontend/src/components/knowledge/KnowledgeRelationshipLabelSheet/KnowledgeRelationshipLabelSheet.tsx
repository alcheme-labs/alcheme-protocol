'use client';

import { BottomSheet } from '@/components/alcheme';
import { useI18n } from '@/i18n/useI18n';
import type { GQLKnowledgeRelationshipLabel } from '@/lib/apollo/types';
import styles from './KnowledgeRelationshipLabelSheet.module.css';

interface KnowledgeRelationshipLabelSheetProps {
    open: boolean;
    labels: GQLKnowledgeRelationshipLabel[];
    loading?: boolean;
    failed?: boolean;
    activeLabelKey?: string | null;
    onClose: () => void;
}

export default function KnowledgeRelationshipLabelSheet({
    open,
    labels,
    loading = false,
    failed = false,
    activeLabelKey = null,
    onClose,
}: KnowledgeRelationshipLabelSheetProps) {
    const t = useI18n('KnowledgeRelationshipLabelSheet');

    return (
        <BottomSheet
            open={open}
            title={t('title')}
            closeLabel={t('close')}
            layer="nested"
            contentClassName={styles.content}
            onClose={onClose}
        >
            <p className={styles.description}>{t('description')}</p>

            {loading ? (
                <div className={styles.empty}>{t('loading')}</div>
            ) : failed ? (
                <div className={styles.empty}>{t('error')}</div>
            ) : labels.length === 0 ? (
                <div className={styles.empty}>{t('empty')}</div>
            ) : (
                <div className={styles.labelList}>
                    {labels.map((label) => (
                        <article
                            key={label.key}
                            className={`${styles.labelCard} ${label.key === activeLabelKey ? styles.labelCardActive : ''}`}
                        >
                            <div className={styles.labelHeader}>
                                <h3 className={styles.labelName}>{label.displayName}</h3>
                            </div>
                            <p className={styles.labelDescription}>{label.description}</p>
                            {label.useCases.length > 0 && (
                                <div className={styles.labelLine}>
                                    <span className={styles.labelBlockTitle}>{t('useCases')}</span>
                                    <span className={styles.labelLineText}>{label.useCases.join('；')}</span>
                                </div>
                            )}
                            {label.example && (
                                <div className={styles.labelLine}>
                                    <span className={styles.labelBlockTitle}>{t('example')}</span>
                                    <span className={styles.labelLineText}>{label.example}</span>
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </BottomSheet>
    );
}
