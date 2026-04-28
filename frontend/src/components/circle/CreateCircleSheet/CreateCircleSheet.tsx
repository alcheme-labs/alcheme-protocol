'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, ArrowLeft, Globe, Lock, Users, GitBranch,
    MessageSquare, BookOpen, FileEdit, Rss,
} from 'lucide-react';
import type { CircleGhostSettings } from '@/lib/circles/ghostSettings';
import { Select } from '@/components/ui/Select';
import type { SeededSourceInput } from '@/lib/circles/seeded';
import { CIRCLE_NAME_MAX_BYTES, clampUtf8Bytes } from '@/lib/circles/nameLimit';
import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
} from '@/lib/circles/policyProfile';
import { resolveCreateCircleStepAdvance } from '@/lib/circle/createCircleStepAdvance';
import type {
    CircleDraftWorkflowPolicy,
    CircleDraftLifecycleTemplate,
    DraftReviewEntryMode,
} from '@/lib/circles/policyProfile';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './CreateCircleSheet.module.css';

/* ═══ Types ═══ */

type CircleMode = 'social' | 'knowledge';
type AccessType = 'free' | 'crystal' | 'invite';
export type CreationScope = 'auxiliary' | 'next-level';
type CircleGenesisMode = 'BLANK' | 'SEEDED';

interface CreateCircleData {
    creationScope: CreationScope;
    name: string;
    description: string;
    mode: CircleMode;
    accessType: AccessType;
    minCrystals: number;
    genesisMode: CircleGenesisMode;
    seededSources: SeededSourceInput[];
    ghostSettings: CircleGhostSettings;
    draftLifecycleTemplate: {
        reviewEntryMode: DraftReviewEntryMode;
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    };
    draftWorkflowPolicy: CircleDraftWorkflowPolicy;
}

interface CreateCircleSheetProps {
    open: boolean;
    /** Optional header title override */
    title?: string;
    /** Whether to show scope selector (auxiliary / next-level). */
    showCreationScope?: boolean;
    /** Whether Fork should appear as the third canonical create entry. */
    allowFork?: boolean;
    /** Whether selecting "创建下一级圈层" is allowed */
    allowNextLevel?: boolean;
    /** Why next-level creation is disabled (shown in UI) */
    nextLevelDisabledReason?: string | null;
    /** Name of the parent (main) circle — optional, omit for main circle creation */
    parentCircleName?: string;
    initialGhostSettings?: Partial<CircleGhostSettings>;
    initialDraftLifecycleTemplate?: Partial<CircleDraftLifecycleTemplate>;
    initialDraftWorkflowPolicy?: Partial<CircleDraftWorkflowPolicy>;
    onSelectFork?: () => void;
    onClose: () => void;
    onCreate: (data: CreateCircleData) => Promise<boolean | void> | boolean | void;
    submitting?: boolean;
    submitError?: string | null;
    submitNotice?: string | null;
}

/* ═══ Constants ═══ */

const STEP_KEYS = ['basicInfo', 'circleMode', 'accessSettings', 'confirmCreate'] as const;

const TAB_CONFIG: Record<CircleMode, { id: string; icon: React.ReactNode }[]> = {
    social: [
        { id: 'plaza', icon: <MessageSquare size={12} /> },
        { id: 'feed', icon: <Rss size={12} /> },
    ],
    knowledge: [
        { id: 'plaza', icon: <MessageSquare size={12} /> },
        { id: 'crucible', icon: <FileEdit size={12} /> },
        { id: 'sanctuary', icon: <BookOpen size={12} /> },
    ],
};

const WORKFLOW_ROLE_VALUES: CircleDraftWorkflowPolicy['createIssueMinRole'][] = [
    'Initiate',
    'Member',
    'Elder',
    'Moderator',
    'Admin',
    'Owner',
];

type WorkflowPolicyRoleField =
    | 'createIssueMinRole'
    | 'followupIssueMinRole'
    | 'reviewIssueMinRole'
    | 'retagIssueMinRole'
    | 'applyIssueMinRole'
    | 'manualEndDraftingMinRole'
    | 'advanceFromReviewMinRole'
    | 'enterCrystallizationMinRole';

async function readSeededSources(files: File[]): Promise<SeededSourceInput[]> {
    return Promise.all(files.map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        content: await file.text(),
        mimeType: file.type || null,
    })));
}

/* ═══ Component ═══ */

export default function CreateCircleSheet({
    open,
    title,
    showCreationScope = true,
    allowFork = false,
    allowNextLevel = true,
    nextLevelDisabledReason = null,
    parentCircleName,
    initialGhostSettings,
    initialDraftLifecycleTemplate,
    initialDraftWorkflowPolicy,
    onSelectFork,
    onClose,
    onCreate,
    submitting = false,
    submitError = null,
    submitNotice = null,
}: CreateCircleSheetProps) {
    const t = useI18n('CreateCircleSheet');
    const locale = useCurrentLocale();
    const defaultGhostSettings = useMemo<CircleGhostSettings>(() => ({
        summaryUseLLM: initialGhostSettings?.summaryUseLLM ?? true,
        draftTriggerMode: initialGhostSettings?.draftTriggerMode ?? 'auto_draft',
        triggerSummaryUseLLM: initialGhostSettings?.triggerSummaryUseLLM ?? true,
        triggerGenerateComment: true,
    }), [initialGhostSettings]);
    const defaultDraftLifecycleTemplate = useMemo<{
        reviewEntryMode: DraftReviewEntryMode;
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    }>(() => ({
        reviewEntryMode: initialDraftLifecycleTemplate?.reviewEntryMode === 'auto_only'
            ? 'auto_only'
            : initialDraftLifecycleTemplate?.reviewEntryMode === 'manual_only'
                ? 'manual_only'
                : 'auto_or_manual',
        draftingWindowMinutes: Math.max(1, Number(initialDraftLifecycleTemplate?.draftingWindowMinutes || 30)),
        reviewWindowMinutes: Math.max(1, Number(initialDraftLifecycleTemplate?.reviewWindowMinutes || 240)),
        maxRevisionRounds: Math.max(1, Number(initialDraftLifecycleTemplate?.maxRevisionRounds || 1)),
    }), [initialDraftLifecycleTemplate]);
    const defaultDraftWorkflowPolicy = useMemo<CircleDraftWorkflowPolicy>(() => ({
        createIssueMinRole: initialDraftWorkflowPolicy?.createIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.createIssueMinRole,
        followupIssueMinRole: initialDraftWorkflowPolicy?.followupIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.followupIssueMinRole,
        reviewIssueMinRole: initialDraftWorkflowPolicy?.reviewIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.reviewIssueMinRole,
        retagIssueMinRole: initialDraftWorkflowPolicy?.retagIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.retagIssueMinRole,
        applyIssueMinRole: initialDraftWorkflowPolicy?.applyIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.applyIssueMinRole,
        manualEndDraftingMinRole: initialDraftWorkflowPolicy?.manualEndDraftingMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.manualEndDraftingMinRole,
        advanceFromReviewMinRole: initialDraftWorkflowPolicy?.advanceFromReviewMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.advanceFromReviewMinRole,
        enterCrystallizationMinRole: initialDraftWorkflowPolicy?.enterCrystallizationMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.enterCrystallizationMinRole,
        allowAuthorWithdrawBeforeReview: initialDraftWorkflowPolicy?.allowAuthorWithdrawBeforeReview ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowAuthorWithdrawBeforeReview,
        allowModeratorRetagIssue: initialDraftWorkflowPolicy?.allowModeratorRetagIssue ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowModeratorRetagIssue,
    }), [initialDraftWorkflowPolicy]);
    const [step, setStep] = useState(0);
    const [creationScope, setCreationScope] = useState<CreationScope>('auxiliary');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [mode, setMode] = useState<CircleMode>('social');
    const [genesisMode, setGenesisMode] = useState<CircleGenesisMode>('BLANK');
    const [selectedSeedFiles, setSelectedSeedFiles] = useState<File[]>([]);
    const [accessType, setAccessType] = useState<AccessType>('free');
    const [minCrystals, setMinCrystals] = useState(1);
    const [summaryUseLLM, setSummaryUseLLM] = useState<boolean>(defaultGhostSettings.summaryUseLLM);
    const [draftTriggerMode, setDraftTriggerMode] = useState<CircleGhostSettings['draftTriggerMode']>(defaultGhostSettings.draftTriggerMode);
    const [triggerSummaryUseLLM, setTriggerSummaryUseLLM] = useState<boolean>(defaultGhostSettings.triggerSummaryUseLLM);
    const [reviewEntryMode, setReviewEntryMode] = useState<DraftReviewEntryMode>(defaultDraftLifecycleTemplate.reviewEntryMode);
    const [draftingWindowMinutes, setDraftingWindowMinutes] = useState<number>(defaultDraftLifecycleTemplate.draftingWindowMinutes);
    const [reviewWindowMinutes, setReviewWindowMinutes] = useState<number>(defaultDraftLifecycleTemplate.reviewWindowMinutes);
    const [maxRevisionRounds, setMaxRevisionRounds] = useState<number>(defaultDraftLifecycleTemplate.maxRevisionRounds);
    const [draftWorkflowPolicy, setDraftWorkflowPolicy] = useState<CircleDraftWorkflowPolicy>(defaultDraftWorkflowPolicy);
    const [localSubmitting, setLocalSubmitting] = useState(false);
    const [localValidationError, setLocalValidationError] = useState<string | null>(null);
    const isSubmitting = submitting || localSubmitting;
    const usesAutoReviewTimer = reviewEntryMode !== 'manual_only';
    const steps = useMemo(
        () => STEP_KEYS.map((key) => t(`steps.${key}`)),
        [t],
    );
    const tabs = useMemo(
        () => TAB_CONFIG[mode].map((item) => ({
            ...item,
            label: t(`tabs.${item.id}`),
        })),
        [mode, t],
    );
    const workflowRoleOptions = useMemo(
        () => WORKFLOW_ROLE_VALUES.map((value) => ({
            value,
            label: t(`roles.${value}`),
        })),
        [t],
    );
    const reviewEntryModeHelp = useMemo<Record<DraftReviewEntryMode, string>>(
        () => ({
            auto_only: t('reviewEntryModeHelp.auto_only'),
            manual_only: t('reviewEntryModeHelp.manual_only'),
            auto_or_manual: t('reviewEntryModeHelp.auto_or_manual'),
        }),
        [t],
    );
    const seededFileListFormatter = useMemo(
        () => new Intl.ListFormat(locale, {
            style: 'short',
            type: 'conjunction',
        }),
        [locale],
    );

    useEffect(() => {
        if (!open) return;
        setSummaryUseLLM(defaultGhostSettings.summaryUseLLM);
        setDraftTriggerMode(defaultGhostSettings.draftTriggerMode);
        setTriggerSummaryUseLLM(defaultGhostSettings.triggerSummaryUseLLM);
        setReviewEntryMode(defaultDraftLifecycleTemplate.reviewEntryMode);
        setDraftingWindowMinutes(defaultDraftLifecycleTemplate.draftingWindowMinutes);
        setReviewWindowMinutes(defaultDraftLifecycleTemplate.reviewWindowMinutes);
        setMaxRevisionRounds(defaultDraftLifecycleTemplate.maxRevisionRounds);
        setDraftWorkflowPolicy(defaultDraftWorkflowPolicy);
    }, [open, defaultGhostSettings, defaultDraftLifecycleTemplate, defaultDraftWorkflowPolicy]);

    useEffect(() => {
        if (!open) return;
        if (!showCreationScope && creationScope !== 'auxiliary') {
            setCreationScope('auxiliary');
            return;
        }
        if (!allowNextLevel && creationScope === 'next-level') {
            setCreationScope('auxiliary');
        }
    }, [open, showCreationScope, allowNextLevel, creationScope]);

    const canNext = useMemo(() => {
        if (step === 0) return name.trim().length >= 2;
        if (step === 1) return true;
        if (step === 2) return true;
        return true;
    }, [step, name]);

    const handleNext = async () => {
        setLocalValidationError(null);

        const advanceDecision = resolveCreateCircleStepAdvance({
            step,
            totalSteps: steps.length,
            genesisMode,
            selectedSeedFileCount: selectedSeedFiles.length,
        });

        if (advanceDecision.type === 'error') {
            setLocalValidationError(t(advanceDecision.errorKey));
            return;
        }

        if (advanceDecision.type === 'advance') {
            setStep(advanceDecision.nextStep);
            return;
        }

        if (isSubmitting) return;

        setLocalSubmitting(true);
        try {
            const seededSources = genesisMode === 'SEEDED'
                ? await readSeededSources(selectedSeedFiles)
                : [];
            const created = await onCreate({
                creationScope,
                name: name.trim(),
                description: description.trim(),
                mode,
                accessType,
                minCrystals,
                genesisMode,
                seededSources,
                ghostSettings: {
                    summaryUseLLM,
                    draftTriggerMode,
                    triggerSummaryUseLLM,
                    triggerGenerateComment: true,
                },
                draftLifecycleTemplate: {
                    reviewEntryMode,
                    draftingWindowMinutes,
                    reviewWindowMinutes,
                    maxRevisionRounds,
                },
                draftWorkflowPolicy,
            });
            if (created !== false) {
                handleReset();
            }
        } finally {
            setLocalSubmitting(false);
        }
    };

    const handleBack = () => {
        if (isSubmitting) return;
        if (step > 0) setStep((s) => s - 1);
        else onClose();
    };

    const handleReset = () => {
        setStep(0);
        setCreationScope('auxiliary');
        setName('');
        setDescription('');
        setMode('social');
        setGenesisMode('BLANK');
        setSelectedSeedFiles([]);
        setAccessType('free');
        setMinCrystals(1);
        setSummaryUseLLM(defaultGhostSettings.summaryUseLLM);
        setDraftTriggerMode(defaultGhostSettings.draftTriggerMode);
        setTriggerSummaryUseLLM(defaultGhostSettings.triggerSummaryUseLLM);
        setReviewEntryMode(defaultDraftLifecycleTemplate.reviewEntryMode);
        setDraftingWindowMinutes(defaultDraftLifecycleTemplate.draftingWindowMinutes);
        setReviewWindowMinutes(defaultDraftLifecycleTemplate.reviewWindowMinutes);
        setMaxRevisionRounds(defaultDraftLifecycleTemplate.maxRevisionRounds);
        setDraftWorkflowPolicy(defaultDraftWorkflowPolicy);
        setLocalValidationError(null);
        onClose();
    };

    const updateDraftWorkflowPolicy = <K extends keyof CircleDraftWorkflowPolicy>(
        key: K,
        value: CircleDraftWorkflowPolicy[K],
    ) => {
        setDraftWorkflowPolicy((prev) => ({ ...prev, [key]: value }));
    };
    const renderWorkflowRoleSelect = (key: WorkflowPolicyRoleField, ariaLabel: string) => (
        <Select
            ariaLabel={ariaLabel}
            value={draftWorkflowPolicy[key]}
            options={workflowRoleOptions}
            onChange={(value) => updateDraftWorkflowPolicy(key, value)}
            disabled={isSubmitting}
        />
    );

    const handleNameChange = (value: string) => {
        setName(clampUtf8Bytes(value));
    };

    const creationScopeSummary = creationScope === 'auxiliary'
        ? t('confirm.creationScope.auxiliary')
        : t('confirm.creationScope.nextLevel');
    const modeSummary = mode === 'social'
        ? t('confirm.mode.social')
        : t('confirm.mode.knowledge');
    const genesisSummary = genesisMode === 'SEEDED'
        ? t('confirm.genesis.seeded')
        : t('confirm.genesis.blank');
    const reviewEntrySummary = reviewEntryMode === 'auto_only'
        ? t('confirm.reviewEntry.autoOnly')
        : reviewEntryMode === 'manual_only'
            ? t('confirm.reviewEntry.manualOnly')
            : t('confirm.reviewEntry.autoOrManual');
    const reviewSummary = usesAutoReviewTimer
        ? t('confirm.reviewSummary.withAuto', {
            draftingWindowMinutes,
            reviewWindowMinutes,
            maxRevisionRounds,
        })
        : t('confirm.reviewSummary.manualOnly', {
            reviewWindowMinutes,
            maxRevisionRounds,
        });
    const accessSummary = accessType === 'free'
        ? t('confirm.access.free')
        : accessType === 'crystal'
            ? t('confirm.access.crystal', { minCrystals })
            : t('confirm.access.invite');

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.createCircleOverlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={() => {
                        if (!isSubmitting) onClose();
                    }}
                >
                    <motion.div
                        className={styles.createCircleSheet}
                        initial={{ y: 400, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 400, opacity: 0 }}
                        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={styles.sheetHandle} />

                        {/* Header */}
                        <div className={styles.sheetHeader}>
                            <button className={styles.sheetBackBtn} onClick={handleBack} disabled={isSubmitting}>
                                {step === 0 ? <X size={18} /> : <ArrowLeft size={18} />}
                            </button>
                            <span className={styles.sheetTitle}>
                                {title ?? (parentCircleName
                                    ? t('header.createAuxiliaryWithParent', { parentCircleName })
                                    : t('header.defaultTitle'))}
                            </span>
                        </div>

                        {/* Progress */}
                        <div className={styles.progressBar}>
                            {steps.map((_, i) => (
                                <div
                                    key={i}
                                    className={`${styles.progressDot} ${i === step ? styles.progressDotActive : ''} ${i < step ? styles.progressDotDone : ''}`}
                                />
                            ))}
                        </div>

                        {/* Body */}
                        <div className={styles.sheetBody}>
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={step}
                                    initial={{ opacity: 0, x: 30 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -30 }}
                                    transition={{ duration: 0.22 }}
                                >
                                    {step === 0 && (
                                        <>
                                            <span className={styles.stepLabel}>{t('stepIndicator', { current: 1, total: steps.length })}</span>
                                            <h3 className={styles.stepTitle}>{t('steps.basicInfo')}</h3>

                                            {showCreationScope && (
                                                <>
                                                    <label className={styles.stepLabel}>{t('fields.creationScope')}</label>
                                                    <div
                                                        className={`${styles.modeGrid} ${allowFork ? styles.modeGridThree : ''}`}
                                                        style={{ marginBottom: 12 }}
                                                    >
                                                        <button
                                                            className={`${styles.modeCard} ${creationScope === 'auxiliary' ? styles.modeCardSelected : ''}`}
                                                            onClick={() => setCreationScope('auxiliary')}
                                                            disabled={isSubmitting}
                                                        >
                                                            <div className={`${styles.modeCardIcon} ${creationScope === 'auxiliary' ? styles.modeCardSelectedIcon : ''}`}>
                                                                <Users size={20} />
                                                            </div>
                                                            <span className={styles.modeCardName}>{t('creationScope.auxiliary.name')}</span>
                                                            <span className={styles.modeCardDesc}>
                                                                {t('creationScope.auxiliary.line1')}
                                                                <br />
                                                                {t('creationScope.auxiliary.line2')}
                                                            </span>
                                                        </button>

                                                        <button
                                                            className={`${styles.modeCard} ${creationScope === 'next-level' ? styles.modeCardSelected : ''} ${!allowNextLevel ? styles.modeCardDisabled : ''}`}
                                                            onClick={() => {
                                                                if (allowNextLevel) setCreationScope('next-level');
                                                            }}
                                                            disabled={!allowNextLevel || isSubmitting}
                                                            title={!allowNextLevel ? (nextLevelDisabledReason || t('creationScope.nextLevelDisabledReason')) : undefined}
                                                        >
                                                            <div className={`${styles.modeCardIcon} ${creationScope === 'next-level' ? styles.modeCardSelectedIcon : ''}`}>
                                                                <BookOpen size={20} />
                                                            </div>
                                                            <span className={styles.modeCardName}>{t('creationScope.nextLevel.name')}</span>
                                                            <span className={styles.modeCardDesc}>
                                                                {t('creationScope.nextLevel.line1')}
                                                                <br />
                                                                {t('creationScope.nextLevel.line2')}
                                                            </span>
                                                        </button>

                                                        {allowFork && (
                                                            <button
                                                                className={styles.modeCard}
                                                                onClick={() => {
                                                                    if (isSubmitting) return;
                                                                    handleReset();
                                                                    onSelectFork?.();
                                                                }}
                                                                disabled={isSubmitting}
                                                            >
                                                                <div className={styles.modeCardIcon}>
                                                                    <GitBranch size={20} />
                                                                </div>
                                                                <span className={styles.modeCardName}>{t('creationScope.fork.name')}</span>
                                                                <span className={styles.modeCardDesc}>
                                                                    {t('creationScope.fork.line1')}
                                                                    <br />
                                                                    {t('creationScope.fork.line2')}
                                                                </span>
                                                            </button>
                                                        )}
                                                    </div>
                                                    {!allowNextLevel && (
                                                        <div className={styles.creationHint}>
                                                            {nextLevelDisabledReason || t('creationScope.nextLevelUnavailable')}
                                                        </div>
                                                    )}
                                                </>
                                            )}

                                            <label className={styles.stepLabel}>{t('fields.name')}</label>
                                            <input
                                                className={styles.inputField}
                                                placeholder={t('fields.namePlaceholder')}
                                                value={name}
                                                onChange={(e) => handleNameChange(e.target.value)}
                                                maxLength={CIRCLE_NAME_MAX_BYTES}
                                                autoFocus
                                                disabled={isSubmitting}
                                            />

                                            <div style={{ height: 16 }} />

                                            <label className={styles.stepLabel}>{t('fields.description')}</label>
                                            <textarea
                                                className={styles.textareaField}
                                                placeholder={t('fields.descriptionPlaceholder')}
                                                value={description}
                                                onChange={(e) => setDescription(e.target.value)}
                                                maxLength={200}
                                                disabled={isSubmitting}
                                            />
                                        </>
                                    )}

                                    {step === 1 && (
                                        <>
                                            <span className={styles.stepLabel}>{t('stepIndicator', { current: 2, total: steps.length })}</span>
                                            <h3 className={styles.stepTitle}>{t('steps.circleMode')}</h3>

                                            <div className={styles.modeGrid}>
                                                <button
                                                    className={`${styles.modeCard} ${mode === 'social' ? styles.modeCardSelected : ''}`}
                                                    onClick={() => setMode('social')}
                                                >
                                                    <div className={`${styles.modeCardIcon} ${mode === 'social' ? styles.modeCardSelectedIcon : ''}`}>
                                                        <Users size={20} />
                                                    </div>
                                                    <span className={styles.modeCardName}>{t('mode.social.name')}</span>
                                                    <span className={styles.modeCardDesc}>
                                                        {t('mode.social.line1')}
                                                        <br />
                                                        {t('mode.social.line2')}
                                                    </span>
                                                </button>

                                                <button
                                                    className={`${styles.modeCard} ${mode === 'knowledge' ? styles.modeCardSelected : ''}`}
                                                    onClick={() => setMode('knowledge')}
                                                >
                                                    <div className={`${styles.modeCardIcon} ${mode === 'knowledge' ? styles.modeCardSelectedIcon : ''}`}>
                                                        <BookOpen size={20} />
                                                    </div>
                                                    <span className={styles.modeCardName}>{t('mode.knowledge.name')}</span>
                                                    <span className={styles.modeCardDesc}>
                                                        {t('mode.knowledge.line1')}
                                                        <br />
                                                        {t('mode.knowledge.line2')}
                                                    </span>
                                                </button>
                                            </div>

                                            <div style={{ height: 16 }} />
                                            <label className={styles.stepLabel}>{t('fields.genesis')}</label>
                                            <div className={styles.modeGrid}>
                                                <button
                                                    type="button"
                                                    className={`${styles.modeCard} ${genesisMode === 'BLANK' ? styles.modeCardSelected : ''}`}
                                                    onClick={() => setGenesisMode('BLANK')}
                                                    disabled={isSubmitting}
                                                >
                                                    <div className={`${styles.modeCardIcon} ${genesisMode === 'BLANK' ? styles.modeCardSelectedIcon : ''}`}>
                                                        <FileEdit size={20} />
                                                    </div>
                                                    <span className={styles.modeCardName}>BLANK</span>
                                                    <span className={styles.modeCardDesc}>
                                                        {t('genesis.blank.line1')}
                                                        <br />
                                                        {t('genesis.blank.line2')}
                                                    </span>
                                                </button>

                                                <button
                                                    type="button"
                                                    className={`${styles.modeCard} ${genesisMode === 'SEEDED' ? styles.modeCardSelected : ''}`}
                                                    onClick={() => setGenesisMode('SEEDED')}
                                                    disabled={isSubmitting}
                                                >
                                                    <div className={`${styles.modeCardIcon} ${genesisMode === 'SEEDED' ? styles.modeCardSelectedIcon : ''}`}>
                                                        <BookOpen size={20} />
                                                    </div>
                                                    <span className={styles.modeCardName}>SEEDED</span>
                                                    <span className={styles.modeCardDesc}>
                                                        {t('genesis.seeded.line1')}
                                                        <br />
                                                        {t('genesis.seeded.line2')}
                                                    </span>
                                                </button>
                                            </div>
                                            <div className={styles.creationHint}>
                                                {t('genesis.seededHint')}
                                            </div>

                                            {genesisMode === 'SEEDED' && (
                                                <>
                                                    <div style={{ height: 12 }} />
                                                    <label className={styles.stepLabel}>{t('fields.seededFiles')}</label>
                                                    <input
                                                        type="file"
                                                        multiple
                                                        className={styles.inputField}
                                                        onChange={(event) => {
                                                            setSelectedSeedFiles(Array.from(event.target.files || []));
                                                            setLocalValidationError(null);
                                                        }}
                                                        disabled={isSubmitting}
                                                    />
                                                    <div className={styles.creationHint}>
                                                        {t('fields.seededFilesHint')}
                                                    </div>
                                                    {selectedSeedFiles.length > 0 && (
                                                        <div className={styles.creationHint}>
                                                            {t('fields.seededFilesSelected', { count: selectedSeedFiles.length })}
                                                            {' '}
                                                            {seededFileListFormatter.format(selectedSeedFiles.map((file) => file.name))}
                                                        </div>
                                                    )}
                                                </>
                                            )}

                                            <div style={{ height: 16 }} />
                                            <label className={styles.stepLabel}>{t('fields.aiCollaboration')}</label>
                                                <div className={styles.aiSettingsBlock}>
                                                    <div className={styles.workflowToggleRow}>
                                                        <div className={styles.workflowPolicyCopy}>
                                                            <div className={styles.aiSettingTitle}>{t('ai.summaryUseLlm.title')}</div>
                                                            <div className={styles.aiSettingHint}>{t('ai.summaryUseLlm.hint')}</div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className={`${styles.workflowSwitch} ${summaryUseLLM ? styles.workflowSwitchOn : ''}`}
                                                            onClick={() => setSummaryUseLLM((prev) => !prev)}
                                                            disabled={isSubmitting}
                                                            aria-pressed={summaryUseLLM}
                                                        >
                                                            <span className={`${styles.workflowKnob} ${summaryUseLLM ? styles.workflowKnobOn : ''}`} />
                                                        </button>
                                                    </div>
                                                    {!summaryUseLLM && (
                                                        <div className={styles.aiSettingWarning}>{t('ai.summaryUseLlm.warning')}</div>
                                                    )}

                                                    <div className={styles.workflowPolicyField}>
                                                        <div className={styles.workflowPolicyCopy}>
                                                            <div className={styles.aiSettingTitle}>{t('ai.draftTriggerMode.title')}</div>
                                                            <div className={styles.aiSettingHint}>{t('ai.draftTriggerMode.hint')}</div>
                                                        </div>
                                                        <div className={styles.aiChoiceGroup}>
                                                            <button
                                                                type="button"
                                                                className={`${styles.aiChoiceBtn} ${draftTriggerMode === 'notify_only' ? styles.aiChoiceBtnActive : ''}`}
                                                                onClick={() => setDraftTriggerMode('notify_only')}
                                                                disabled={isSubmitting}
                                                            >
                                                                {t('ai.draftTriggerMode.notifyOnly')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={`${styles.aiChoiceBtn} ${draftTriggerMode === 'auto_draft' ? styles.aiChoiceBtnActive : ''}`}
                                                                onClick={() => setDraftTriggerMode('auto_draft')}
                                                                disabled={isSubmitting}
                                                            >
                                                                {t('ai.draftTriggerMode.autoDraft')}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className={styles.workflowToggleRow}>
                                                        <div className={styles.workflowPolicyCopy}>
                                                            <div className={styles.aiSettingTitle}>{t('ai.triggerSummaryUseLlm.title')}</div>
                                                            <div className={styles.aiSettingHint}>{t('ai.triggerSummaryUseLlm.hint')}</div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className={`${styles.workflowSwitch} ${triggerSummaryUseLLM ? styles.workflowSwitchOn : ''}`}
                                                            onClick={() => setTriggerSummaryUseLLM((prev) => !prev)}
                                                            disabled={isSubmitting}
                                                            aria-pressed={triggerSummaryUseLLM}
                                                        >
                                                            <span className={`${styles.workflowKnob} ${triggerSummaryUseLLM ? styles.workflowKnobOn : ''}`} />
                                                        </button>
                                                    </div>
                                                    {!triggerSummaryUseLLM && (
                                                        <div className={styles.aiSettingWarning}>{t('ai.triggerSummaryUseLlm.warning')}</div>
                                                    )}
                                                </div>

                                            {mode === 'knowledge' && (
                                                <>
                                                    <div style={{ height: 16 }} />
                                                    <label className={styles.stepLabel}>{t('fields.draftAndReview')}</label>
                                                    <div className={styles.aiSettingsBlock}>
                                                        <div className={styles.workflowModeField}>
                                                            <div className={styles.workflowModeHeader}>
                                                                <div className={styles.aiSettingTitle}>{t('review.entryMode.title')}</div>
                                                                <p className={styles.workflowModeHelp}>
                                                                    {reviewEntryModeHelp[reviewEntryMode]}
                                                                </p>
                                                            </div>
                                                            <div className={styles.aiChoiceGroup}>
                                                                <button
                                                                    type="button"
                                                                    className={`${styles.aiChoiceBtn} ${reviewEntryMode === 'auto_only' ? styles.aiChoiceBtnActive : ''}`}
                                                                    onClick={() => setReviewEntryMode('auto_only')}
                                                                    disabled={isSubmitting}
                                                                >
                                                                    {t('review.entryMode.autoOnly')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={`${styles.aiChoiceBtn} ${reviewEntryMode === 'manual_only' ? styles.aiChoiceBtnActive : ''}`}
                                                                    onClick={() => setReviewEntryMode('manual_only')}
                                                                    disabled={isSubmitting}
                                                                >
                                                                    {t('review.entryMode.manualOnly')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={`${styles.aiChoiceBtn} ${reviewEntryMode === 'auto_or_manual' ? styles.aiChoiceBtnActive : ''}`}
                                                                    onClick={() => setReviewEntryMode('auto_or_manual')}
                                                                    disabled={isSubmitting}
                                                                >
                                                                    {t('review.entryMode.autoOrManual')}
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {usesAutoReviewTimer && (
                                                            <div className={styles.aiSettingItem}>
                                                                <div className={styles.aiSettingCopy}>
                                                                    <div className={styles.aiSettingTitle}>{t('review.autoEntryWindow.title')}</div>
                                                                    <div className={styles.aiSettingHint}>{t('review.autoEntryWindow.hint')}</div>
                                                                </div>
                                                                <div className={styles.numberWithUnit}>
                                                                    <input
                                                                        className={styles.crystalInput}
                                                                        type="number"
                                                                        min={1}
                                                                        max={1440}
                                                                        value={draftingWindowMinutes}
                                                                        onChange={(e) => setDraftingWindowMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                                        disabled={isSubmitting}
                                                                    />
                                                                    <span className={styles.numberUnit}>{t('common.minutes')}</span>
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div className={styles.aiSettingItem}>
                                                            <div className={styles.aiSettingCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('review.reviewWindow.title')}</div>
                                                                <div className={styles.aiSettingHint}>{t('review.reviewWindow.hint')}</div>
                                                            </div>
                                                            <div className={styles.numberWithUnit}>
                                                                <input
                                                                    className={styles.crystalInput}
                                                                    type="number"
                                                                    min={1}
                                                                    max={4320}
                                                                    value={reviewWindowMinutes}
                                                                    onChange={(e) => setReviewWindowMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                                    disabled={isSubmitting}
                                                                />
                                                                <span className={styles.numberUnit}>{t('common.minutes')}</span>
                                                            </div>
                                                        </div>

                                                        <div className={styles.aiSettingItem}>
                                                            <div className={styles.aiSettingCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('review.maxRevisionRounds.title')}</div>
                                                            </div>
                                                            <input
                                                                className={styles.crystalInput}
                                                                type="number"
                                                                min={1}
                                                                max={12}
                                                                value={maxRevisionRounds}
                                                                onChange={(e) => setMaxRevisionRounds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                                disabled={isSubmitting}
                                                            />
                                                        </div>
                                                    </div>

                                                    <div style={{ height: 16 }} />
                                                    <label className={styles.stepLabel}>{t('fields.workflowPermissions')}</label>
                                                    <div className={styles.aiSettingsBlock}>
                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.createIssueMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('createIssueMinRole', t('workflow.createIssueMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.followupIssueMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('followupIssueMinRole', t('workflow.followupIssueMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.reviewIssueMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('reviewIssueMinRole', t('workflow.reviewIssueMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.retagIssueMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('retagIssueMinRole', t('workflow.retagIssueMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.applyIssueMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('applyIssueMinRole', t('workflow.applyIssueMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.manualEndDraftingMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('manualEndDraftingMinRole', t('workflow.manualEndDraftingMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.advanceFromReviewMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('advanceFromReviewMinRole', t('workflow.advanceFromReviewMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowPolicyField}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.enterCrystallizationMinRole')}</div>
                                                            </div>
                                                            {renderWorkflowRoleSelect('enterCrystallizationMinRole', t('workflow.enterCrystallizationMinRole'))}
                                                        </div>

                                                        <div className={styles.workflowToggleRow}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.allowAuthorWithdrawBeforeReview')}</div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className={`${styles.workflowSwitch} ${draftWorkflowPolicy.allowAuthorWithdrawBeforeReview ? styles.workflowSwitchOn : ''}`}
                                                                onClick={() => updateDraftWorkflowPolicy('allowAuthorWithdrawBeforeReview', !draftWorkflowPolicy.allowAuthorWithdrawBeforeReview)}
                                                                disabled={isSubmitting}
                                                                aria-pressed={draftWorkflowPolicy.allowAuthorWithdrawBeforeReview}
                                                            >
                                                                <span className={`${styles.workflowKnob} ${draftWorkflowPolicy.allowAuthorWithdrawBeforeReview ? styles.workflowKnobOn : ''}`} />
                                                            </button>
                                                        </div>

                                                        <div className={styles.workflowToggleRow}>
                                                            <div className={styles.workflowPolicyCopy}>
                                                                <div className={styles.aiSettingTitle}>{t('workflow.allowModeratorRetagIssue')}</div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className={`${styles.workflowSwitch} ${draftWorkflowPolicy.allowModeratorRetagIssue ? styles.workflowSwitchOn : ''}`}
                                                                onClick={() => updateDraftWorkflowPolicy('allowModeratorRetagIssue', !draftWorkflowPolicy.allowModeratorRetagIssue)}
                                                                disabled={isSubmitting}
                                                                aria-pressed={draftWorkflowPolicy.allowModeratorRetagIssue}
                                                            >
                                                                <span className={`${styles.workflowKnob} ${draftWorkflowPolicy.allowModeratorRetagIssue ? styles.workflowKnobOn : ''}`} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </>
                                    )}

                                    {step === 2 && (
                                        <>
                                            <span className={styles.stepLabel}>{t('stepIndicator', { current: 3, total: steps.length })}</span>
                                            <h3 className={styles.stepTitle}>{t('steps.accessSettings')}</h3>

                                            <div className={styles.accessOptions}>
                                                <button
                                                    className={`${styles.accessOption} ${accessType === 'free' ? styles.accessOptionSelected : ''}`}
                                                    onClick={() => setAccessType('free')}
                                                >
                                                    <div className={`${styles.accessRadio} ${accessType === 'free' ? styles.accessRadioSelected : ''}`} />
                                                    <div className={styles.accessLabel}>
                                                        <div className={styles.accessName}>
                                                            <Globe size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                                                            {t('access.free.name')}
                                                        </div>
                                                        <div className={styles.accessDesc}>{t('access.free.description')}</div>
                                                    </div>
                                                </button>

                                                <button
                                                    className={`${styles.accessOption} ${accessType === 'crystal' ? styles.accessOptionSelected : ''}`}
                                                    onClick={() => setAccessType('crystal')}
                                                >
                                                    <div className={`${styles.accessRadio} ${accessType === 'crystal' ? styles.accessRadioSelected : ''}`} />
                                                    <div className={styles.accessLabel}>
                                                        <div className={styles.accessName}>
                                                            {t('access.crystal.name')}
                                                        </div>
                                                        <div className={styles.accessDesc}>{t('access.crystal.description')}</div>
                                                    </div>
                                                    {accessType === 'crystal' && (
                                                        <input
                                                            className={styles.crystalInput}
                                                            type="number"
                                                            min={1}
                                                            max={99}
                                                            value={minCrystals}
                                                            onChange={(e) => setMinCrystals(Math.max(1, parseInt(e.target.value) || 1))}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    )}
                                                </button>

                                                <button
                                                    className={`${styles.accessOption} ${accessType === 'invite' ? styles.accessOptionSelected : ''}`}
                                                    onClick={() => setAccessType('invite')}
                                                >
                                                    <div className={`${styles.accessRadio} ${accessType === 'invite' ? styles.accessRadioSelected : ''}`} />
                                                    <div className={styles.accessLabel}>
                                                        <div className={styles.accessName}>
                                                            <Lock size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                                                            {t('access.invite.name')}
                                                        </div>
                                                        <div className={styles.accessDesc}>{t('access.invite.description')}</div>
                                                    </div>
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    {step === 3 && (
                                        <>
                                            <span className={styles.stepLabel}>{t('stepIndicator', { current: 4, total: steps.length })}</span>
                                            <h3 className={styles.stepTitle}>{t('steps.confirmCreate')}</h3>

                                            <div className={styles.confirmSection}>
                                                {showCreationScope && (
                                                    <>
                                                        <div className={styles.confirmLabel}>{t('confirm.labels.creationScope')}</div>
                                                        <div className={styles.confirmValue}>
                                                            {creationScopeSummary}
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            <div className={styles.confirmSection}>
                                                <div className={styles.confirmLabel}>{t('confirm.labels.name')}</div>
                                                <div className={styles.confirmValue}>{name}</div>
                                            </div>

                                            {description && (
                                                <div className={styles.confirmSection}>
                                                    <div className={styles.confirmLabel}>{t('confirm.labels.description')}</div>
                                                    <div className={styles.confirmValue}>{description}</div>
                                                </div>
                                            )}

                                            <div className={styles.confirmSection}>
                                                <div className={styles.confirmLabel}>{t('confirm.labels.mode')}</div>
                                                <div className={styles.confirmValue}>
                                                    {modeSummary}
                                                </div>
                                            </div>

                                            <div className={styles.confirmSection}>
                                                <div className={styles.confirmLabel}>{t('confirm.labels.genesis')}</div>
                                                <div className={styles.confirmValue}>
                                                    {genesisSummary}
                                                </div>
                                                {genesisMode === 'SEEDED' && selectedSeedFiles.length > 0 && (
                                                    <div className={styles.confirmValue}>
                                                        {t('confirm.seededFilesAttached', { count: selectedSeedFiles.length })}
                                                    </div>
                                                )}
                                            </div>

                                            <div className={styles.confirmSection}>
                                                <div className={styles.confirmLabel}>Tabs</div>
                                                <div className={styles.confirmTabs}>
                                                    {tabs.map((t) => (
                                                        <span key={t.id} className={styles.confirmTabPill}>
                                                            {t.label}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {mode === 'knowledge' && (
                                                <div className={styles.confirmSection}>
                                                    <div className={styles.confirmLabel}>{t('confirm.labels.review')}</div>
                                                    <div className={styles.confirmValue}>
                                                        {reviewEntrySummary}
                                                        {reviewSummary}
                                                    </div>
                                                </div>
                                            )}

                                            <div className={styles.confirmSection}>
                                                <div className={styles.confirmLabel}>{t('confirm.labels.access')}</div>
                                                <div className={styles.confirmValue}>
                                                    {accessSummary}
                                                </div>
                                            </div>

                                            <div className={styles.confirmSection}>
                                                <div className={styles.confirmLabel}>{t('confirm.labels.ai')}</div>
                                                <div className={styles.confirmValue}>
                                                    {t('confirm.ai.summary', {
                                                        mode: summaryUseLLM ? t('confirm.ai.llm') : t('confirm.ai.rule'),
                                                    })}
                                                </div>
                                                <div className={styles.confirmValue}>
                                                    {t('confirm.ai.draftTrigger', {
                                                        mode: draftTriggerMode === 'auto_draft'
                                                            ? t('confirm.ai.autoDraft')
                                                            : t('confirm.ai.notifyOnly'),
                                                    })}
                                                </div>
                                                <div className={styles.confirmValue}>
                                                    {t('confirm.ai.triggerSummary', {
                                                        mode: triggerSummaryUseLLM ? t('confirm.ai.llm') : t('confirm.ai.rule'),
                                                    })}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        {(localValidationError || submitError) && (
                            <div className={styles.submitError} role="alert">
                                {localValidationError || submitError}
                            </div>
                        )}
                        {!localValidationError && !submitError && submitNotice && (
                            <div className={styles.submitNotice} role="status">
                                {submitNotice}
                            </div>
                        )}

                        {/* Footer */}
                        <div className={styles.sheetFooter}>
                            <button className={styles.footerBtnSecondary} onClick={handleBack} disabled={isSubmitting}>
                                {step === 0 ? t('actions.cancel') : t('actions.back')}
                            </button>
                            <button
                                className={styles.footerBtnPrimary}
                                onClick={handleNext}
                                disabled={!canNext || isSubmitting}
                            >
                                {isSubmitting ? t('actions.creating') : (step === steps.length - 1 ? t('actions.create') : t('actions.next'))}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
