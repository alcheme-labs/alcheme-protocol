'use client';

import { useMemo, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import type { KnowledgeReferenceOption } from '@/lib/circle/knowledgeReferenceOptions';
import type { DraftReferenceLink } from '@/lib/api/draftReferenceLinks';
import type { DraftReferenceSurfaceViewModel } from '@/lib/circle/draftReferenceSurface';
import type { SeededFileTreeNode, SeededReferenceSelection } from '@/lib/api/circlesSeeded';
import SeededFileTree from '@/components/circle/SeededFileTree/SeededFileTree';
import KnowledgeReferencePicker from '@/components/circle/KnowledgeReferencePicker/KnowledgeReferencePicker';
import styles from './ReferencesPanel.module.css';

interface ReferencesPanelProps {
    surface: DraftReferenceSurfaceViewModel;
    referenceLinks: DraftReferenceLink[];
    knowledgeReferenceOptions: KnowledgeReferenceOption[];
    canInsertKnowledgeReference?: boolean;
    onInsertReference: (option: KnowledgeReferenceOption) => void;
    referencesLoading?: boolean;
    referencesError?: string | null;
    seededFileTree: SeededFileTreeNode[];
    seededFileTreeLoading?: boolean;
    seededFileTreeError?: string | null;
    selectedSeededReference?: SeededReferenceSelection | null;
    onSelectSeededReference?: (reference: SeededReferenceSelection) => void;
}

export default function ReferencesPanel({
    surface,
    referenceLinks,
    knowledgeReferenceOptions,
    canInsertKnowledgeReference = false,
    onInsertReference,
    referencesLoading = false,
    referencesError = null,
    seededFileTree,
    seededFileTreeLoading = false,
    seededFileTreeError = null,
    selectedSeededReference = null,
    onSelectSeededReference,
}: ReferencesPanelProps) {
    const t = useI18n('ReferencesPanel');
    const [pickerOpen, setPickerOpen] = useState(false);
    const sourceBlockCount = useMemo(
        () => new Set(referenceLinks.map((item) => item.sourceBlockId)).size,
        [referenceLinks],
    );

    if (!surface.showPanel) return null;

    return (
        <section className={styles.panel} aria-label={t('aria.section')}>
            <div className={styles.heading}>
                <p className={styles.eyebrow}>{t('eyebrow')}</p>
                <h3 className={styles.title}>{t('title')}</h3>
                <p className={styles.hint}>{t('hint')}</p>
            </div>

            {surface.showFormalReferenceSummary && (
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <h4 className={styles.sectionTitle}>{t('formal.title')}</h4>
                            <p className={styles.sectionHint}>{t('formal.hint')}</p>
                        </div>
                        {canInsertKnowledgeReference && knowledgeReferenceOptions.length > 0 && (
                            <button
                                type="button"
                                className={styles.inlineAction}
                                onClick={() => setPickerOpen((current) => !current)}
                            >
                                {t('formal.insertAction')}
                            </button>
                        )}
                    </div>
                    {pickerOpen && canInsertKnowledgeReference && knowledgeReferenceOptions.length > 0 && (
                        <KnowledgeReferencePicker
                            options={knowledgeReferenceOptions}
                            onSelect={(option) => {
                                onInsertReference(option);
                                setPickerOpen(false);
                            }}
                            onClose={() => setPickerOpen(false)}
                        />
                    )}
                    {referencesLoading && (
                        <p className={styles.status}>{t('formal.loading')}</p>
                    )}
                    {!referencesLoading && referencesError && (
                        <p className={styles.error}>{referencesError}</p>
                    )}
                    {!referencesLoading && !referencesError && surface.formalReferenceCount === 0 && (
                        <p className={styles.status}>{t('formal.empty')}</p>
                    )}
                    {!referencesLoading && !referencesError && surface.formalReferenceCount > 0 && (
                        <>
                            <p className={styles.summary}>
                                {t('formal.summary', {
                                    count: surface.formalReferenceCount,
                                    sourceBlockCount,
                                })}
                            </p>
                            <div className={styles.nameList}>
                                {surface.formalReferenceNames.map((name) => (
                                    <span key={name} className={styles.namePill}>{name}</span>
                                ))}
                            </div>
                            <p className={styles.sectionHint}>{t('formal.note')}</p>
                        </>
                    )}
                </div>
            )}

            {surface.showSeededEvidence && (
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <h4 className={styles.sectionTitle}>{t('seeded.title')}</h4>
                        <p className={styles.sectionHint}>{t('seeded.hint')}</p>
                    </div>
                    <SeededFileTree
                        embedded
                        tree={seededFileTree}
                        loading={seededFileTreeLoading}
                        error={seededFileTreeError}
                        selectedReference={selectedSeededReference}
                        onSelectReference={onSelectSeededReference}
                    />
                </div>
            )}
        </section>
    );
}
