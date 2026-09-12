'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/useI18n';

import { BottomSheet } from '@/components/alcheme';
import type {
    DraftDiscussionIssueType,
    DraftDiscussionTargetType,
    DraftDiscussionThreadRecord,
} from '@/lib/api/discussion';
import {
    formatSeededReferenceLabel,
} from '@/lib/circle/draftPresentation';
import type { SeededReferenceSelection } from '@/lib/api/circlesSeeded';
import DraftDiscussionSelect, {
    type DraftDiscussionSelectOption,
} from './DraftDiscussionSelect';
import styles from './DraftDiscussionPanel.module.css';

export interface DraftDiscussionCreateInput {
    targetType: DraftDiscussionTargetType;
    targetRef: string;
    targetVersion?: number;
    issueType: DraftDiscussionIssueType;
    content: string;
}

interface DraftDiscussionCreateSheetProps {
    open: boolean;
    busy: boolean;
    canCreate: boolean;
    createDisabledReason: string | null;
    currentDraftVersion: number | null;
    paragraphOptions: Array<{
        index: number;
        preview: string;
    }>;
    selectedParagraphIndex?: number | null;
    selectedSeededReference?: SeededReferenceSelection | null;
    onSelectParagraph?: (paragraphIndex: number | null) => void;
    onCreate: (input: DraftDiscussionCreateInput) => Promise<DraftDiscussionThreadRecord>;
    onCreated: (thread: DraftDiscussionThreadRecord) => void;
    onClose: () => void;
}

const DEFAULT_ISSUE_TYPE: DraftDiscussionIssueType = 'question_and_supplement';
const ISSUE_TYPE_OPTIONS: DraftDiscussionIssueType[] = [
    'fact_correction',
    'expression_improvement',
    'knowledge_supplement',
    'question_and_supplement',
];

function parseParagraphRef(value: string): number | null {
    const matched = String(value || '').trim().match(/^paragraph:(\d+)$/i);
    if (!matched) return null;
    const index = Number.parseInt(matched[1], 10);
    if (!Number.isFinite(index) || index < 0) return null;
    return index;
}

function buildStructureTargetRef(indices: number[]): string {
    return indices
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right)
        .map((value) => `paragraph:${value}`)
        .join(',');
}

function appendSeededReferenceToContent(
    content: string,
    reference: SeededReferenceSelection | null | undefined,
): string {
    if (!reference) return content;
    const normalized = String(content || '').trimEnd();
    return normalized ? `${normalized}\n${reference.raw}` : reference.raw;
}

export default function DraftDiscussionCreateSheet({
    open,
    busy,
    canCreate,
    createDisabledReason,
    currentDraftVersion,
    paragraphOptions,
    selectedParagraphIndex: rawSelectedParagraphIndex,
    selectedSeededReference,
    onSelectParagraph,
    onCreate,
    onCreated,
    onClose,
}: DraftDiscussionCreateSheetProps) {
    const t = useI18n('DraftDiscussionPanel');
    const [targetType, setTargetType] = useState<DraftDiscussionTargetType>('paragraph');
    const [targetRef, setTargetRef] = useState('');
    const [targetIssueType, setTargetIssueType] = useState<DraftDiscussionIssueType>(DEFAULT_ISSUE_TYPE);
    const [structureTargetIndices, setStructureTargetIndices] = useState<number[]>([]);
    const [createContent, setCreateContent] = useState('');
    const [inlineError, setInlineError] = useState<string | null>(null);

    const selectedParagraphIndex = Number.isFinite(rawSelectedParagraphIndex as number)
        ? Number(rawSelectedParagraphIndex)
        : null;
    const selectedParagraphPreview = selectedParagraphIndex !== null
        ? paragraphOptions.find((option) => option.index === selectedParagraphIndex)?.preview || ''
        : '';
    const selectedStructureOptions = paragraphOptions.filter((option) => structureTargetIndices.includes(option.index));
    const createDisabled = !canCreate || currentDraftVersion === null || busy;
    const resolvedCreateDisabledReason = currentDraftVersion === null
        ? t('workbench.empty.currentUnavailable')
        : createDisabledReason;

    useEffect(() => {
        if (!open) return;
        setInlineError(null);
        if (targetType === 'paragraph') {
            setTargetRef(selectedParagraphIndex !== null ? `paragraph:${selectedParagraphIndex}` : '');
        }
        if (targetType === 'structure' && selectedParagraphIndex !== null && structureTargetIndices.length === 0) {
            setStructureTargetIndices([selectedParagraphIndex]);
        }
    }, [open, selectedParagraphIndex, structureTargetIndices.length, targetType]);

    const formatIssueType = (type: DraftDiscussionIssueType | null | undefined) => {
        if (type === 'fact_correction') return t('issueTypes.fact_correction');
        if (type === 'expression_improvement') return t('issueTypes.expression_improvement');
        if (type === 'knowledge_supplement') return t('issueTypes.knowledge_supplement');
        if (type === 'question_and_supplement') return t('issueTypes.question_and_supplement');
        return t('issueTypes.fallback');
    };
    const formatTargetType = (type: DraftDiscussionTargetType) => {
        if (type === 'paragraph') return t('targetTypes.paragraph');
        if (type === 'structure') return t('targetTypes.structure');
        return t('targetTypes.document');
    };

    const targetTypeOptions: DraftDiscussionSelectOption[] = [
        { value: 'paragraph', label: formatTargetType('paragraph') },
        { value: 'structure', label: formatTargetType('structure') },
        { value: 'document', label: formatTargetType('document') },
    ];
    const issueTypeOptions: DraftDiscussionSelectOption[] = ISSUE_TYPE_OPTIONS.map((issueType) => ({
        value: issueType,
        label: formatIssueType(issueType),
    }));
    const paragraphSelectOptions: DraftDiscussionSelectOption[] = [
        { value: '', label: t('create.selectParagraph') },
        ...paragraphOptions.map((option) => ({
            value: String(option.index),
            label: t('create.paragraphOption', {index: option.index + 1, preview: option.preview}),
        })),
    ];

    const handleTargetTypeChange = (nextType: DraftDiscussionTargetType) => {
        setTargetType(nextType);
        setInlineError(null);

        if (nextType === 'paragraph') {
            setTargetRef(selectedParagraphIndex !== null ? `paragraph:${selectedParagraphIndex}` : '');
            return;
        }

        if (nextType === 'structure') {
            setTargetRef('');
            setStructureTargetIndices(
                selectedParagraphIndex !== null ? [selectedParagraphIndex] : [],
            );
            return;
        }

        setTargetRef('document');
        setStructureTargetIndices([]);
    };

    const toggleStructureTarget = (index: number) => {
        setStructureTargetIndices((prev) => (
            prev.includes(index)
                ? prev.filter((value) => value !== index)
                : [...prev, index].sort((left, right) => left - right)
        ));
    };

    const resetCreateForm = () => {
        setTargetType('paragraph');
        setTargetRef(selectedParagraphIndex !== null ? `paragraph:${selectedParagraphIndex}` : '');
        setTargetIssueType(DEFAULT_ISSUE_TYPE);
        setStructureTargetIndices([]);
        setCreateContent('');
        setInlineError(null);
    };

    const handleCreate = async () => {
        setInlineError(null);
        if (currentDraftVersion === null) {
            setInlineError(t('errors.currentVersionRequired'));
            return;
        }
        let normalizedTargetRef = targetRef.trim();
        const normalizedContent = createContent.trim();

        if (targetType === 'paragraph') {
            const paragraphIndex = selectedParagraphIndex ?? parseParagraphRef(normalizedTargetRef);
            if (paragraphIndex === null) {
                setInlineError(t('errors.selectParagraph'));
                return;
            }
            normalizedTargetRef = `paragraph:${paragraphIndex}`;
        } else if (targetType === 'structure') {
            if (structureTargetIndices.length === 0) {
                setInlineError(t('errors.selectStructureRange'));
                return;
            }
            normalizedTargetRef = buildStructureTargetRef(structureTargetIndices);
        } else {
            normalizedTargetRef = 'document';
        }

        if (!normalizedContent) {
            setInlineError(t('errors.createDescriptionRequired'));
            return;
        }

        try {
            const createdThread = await onCreate({
                targetType,
                targetRef: normalizedTargetRef,
                targetVersion: currentDraftVersion,
                issueType: targetIssueType,
                content: normalizedContent,
            });
            resetCreateForm();
            onCreated(createdThread);
            onClose();
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : t('errors.createThread'));
        }
    };

    const footer = (
        <>
            <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
                disabled={busy}
            >
                {t('create.cancel')}
            </button>
            <button
                type="button"
                className={styles.primaryButton}
                onClick={handleCreate}
                disabled={createDisabled}
            >
                {t('create.submit')}
            </button>
        </>
    );

    return (
        <BottomSheet
            open={open}
            title={t('create.title')}
            closeLabel={t('create.cancel')}
            footer={footer}
            onClose={onClose}
        >
            <div className={styles.createSheetBody}>
                {inlineError && (
                    <div className={styles.errorBox} role="alert">
                        {inlineError}
                    </div>
                )}
                <p className={styles.bindingHint}>
                    {currentDraftVersion === null
                        ? t('workbench.empty.currentUnavailable')
                        : t('create.bindingHint', {version: currentDraftVersion})}
                </p>
                <div className={styles.formRow}>
                <label className={styles.fieldLabel} htmlFor="draft-discussion-target-type">{t('create.targetTypeLabel')}</label>
                <DraftDiscussionSelect
                    id="draft-discussion-target-type"
                    value={targetType}
                    options={targetTypeOptions}
                    onChange={(nextValue) => handleTargetTypeChange(nextValue as DraftDiscussionTargetType)}
                    disabled={createDisabled}
                />
            </div>
            <div className={styles.formRow}>
                <label className={styles.fieldLabel} htmlFor="draft-discussion-issue-type">{t('create.issueTypeLabel')}</label>
                <DraftDiscussionSelect
                    id="draft-discussion-issue-type"
                    value={targetIssueType}
                    options={issueTypeOptions}
                    onChange={(nextValue) => setTargetIssueType(nextValue as DraftDiscussionIssueType)}
                    disabled={createDisabled}
                />
            </div>
            <div className={styles.formRow}>
                {targetType === 'paragraph' ? (
                    <>
                        <label className={styles.fieldLabel} htmlFor="draft-discussion-target-paragraph">{t('create.paragraphTargetLabel')}</label>
                        <DraftDiscussionSelect
                            id="draft-discussion-target-paragraph"
                            value={selectedParagraphIndex !== null ? String(selectedParagraphIndex) : ''}
                            options={paragraphSelectOptions}
                            onChange={(nextValue) => {
                                if (!nextValue) {
                                    onSelectParagraph?.(null);
                                    setTargetRef('');
                                    return;
                                }
                                const parsed = Number.parseInt(nextValue, 10);
                                if (!Number.isFinite(parsed) || parsed < 0) {
                                    onSelectParagraph?.(null);
                                    setTargetRef('');
                                    return;
                                }
                                onSelectParagraph?.(parsed);
                                setTargetRef(`paragraph:${parsed}`);
                            }}
                            disabled={createDisabled || paragraphOptions.length === 0}
                        />
                        <p className={styles.paragraphHint}>
                            {selectedParagraphIndex !== null
                                ? t('create.paragraphSelectedHint', {index: selectedParagraphIndex + 1})
                                : t('create.paragraphSelectHint')}
                        </p>
                        {selectedParagraphPreview && (
                            <p className={styles.paragraphPreview}>
                                {selectedParagraphPreview}
                            </p>
                        )}
                    </>
                ) : targetType === 'structure' ? (
                    <>
                        <label className={styles.fieldLabel}>{t('create.structureLabel')}</label>
                        <p className={styles.paragraphHint}>
                            {t('create.structureHint')}
                        </p>
                        <div className={styles.structureOptions}>
                            {paragraphOptions.map((option) => {
                                const checked = structureTargetIndices.includes(option.index);
                                return (
                                    <label
                                        key={option.index}
                                        className={`${styles.structureOption}${checked ? ` ${styles.structureOptionSelected}` : ''}`}
                                    >
                                        <input
                                            type="checkbox"
                                            className={styles.structureOptionCheckbox}
                                            checked={checked}
                                            onChange={() => toggleStructureTarget(option.index)}
                                            disabled={createDisabled}
                                        />
                                        <span className={styles.structureOptionBody}>
                                            <span className={styles.structureOptionLabel}>
                                                {t('create.paragraphShort', {index: option.index + 1})}
                                            </span>
                                            <span className={styles.structureOptionPreview}>
                                                {option.preview}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                        {selectedStructureOptions.length > 0 && (
                            <p className={styles.paragraphPreview}>
                                {t('create.selectedStructure', {
                                    values: selectedStructureOptions.map((option) => t('create.paragraphShort', {index: option.index + 1})).join(', '),
                                })}
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        <label className={styles.fieldLabel}>{t('create.documentLabel')}</label>
                        <p className={styles.paragraphHint}>
                            {t('create.documentHint')}
                        </p>
                    </>
                )}
            </div>
            <div className={styles.formRow}>
                <label className={styles.fieldLabel}>{t('create.boundVersionLabel')}</label>
                <p className={styles.paragraphHint}>
                    {currentDraftVersion === null
                        ? t('workbench.empty.currentUnavailable')
                        : t('create.boundVersionHint', {version: currentDraftVersion})}
                </p>
            </div>
            <div className={styles.formRow}>
                <label className={styles.fieldLabel} htmlFor="draft-discussion-content">{t('create.descriptionLabel')}</label>
                <textarea
                    id="draft-discussion-content"
                    className={styles.textarea}
                    value={createContent}
                    onChange={(event) => setCreateContent(event.target.value)}
                    placeholder={t('create.descriptionPlaceholder')}
                    disabled={createDisabled}
                />
                <div className={styles.inlineActionRow}>
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => setCreateContent((current) => appendSeededReferenceToContent(
                            current,
                            selectedSeededReference,
                        ))}
                        disabled={createDisabled || !selectedSeededReference}
                    >
                        {t('create.insertCurrentReference')}
                    </button>
                    {selectedSeededReference && (
                        <span className={styles.referenceHint}>
                            {formatSeededReferenceLabel(selectedSeededReference)}
                        </span>
                    )}
                </div>
            </div>
                {resolvedCreateDisabledReason && (
                    <p className={styles.policyHint}>{resolvedCreateDisabledReason}</p>
                )}
            </div>
        </BottomSheet>
    );
}
