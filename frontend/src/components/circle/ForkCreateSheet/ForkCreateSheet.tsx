'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GitBranch, ShieldCheck, X } from 'lucide-react';
import type { CircleGhostSettings } from '@/lib/circles/ghostSettings';
import { Select } from '@/components/ui/Select';
import { useI18n } from '@/i18n/useI18n';
import ForkReadinessPanel from '@/features/fork-lineage/ForkReadinessPanel';
import type { ForkReadinessViewModel } from '@/features/fork-lineage/adapter';
import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
    DEFAULT_CIRCLE_FORK_POLICY,
    type CircleDraftLifecycleTemplate,
    type CircleDraftWorkflowPolicy,
    type CircleForkPolicy,
    type DraftReviewEntryMode,
} from '@/lib/circles/policyProfile';
import styles from './ForkCreateSheet.module.css';

type AccessType = 'free' | 'crystal' | 'invite' | 'approval';

export interface ForkCreateData {
    name: string;
    description: string;
    mode: 'knowledge' | 'social';
    accessType: AccessType;
    minCrystals: number;
    declarationText: string;
    ghostSettings: CircleGhostSettings;
    draftLifecycleTemplate: {
        reviewEntryMode: DraftReviewEntryMode;
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    };
    draftWorkflowPolicy: CircleDraftWorkflowPolicy;
    forkPolicy: CircleForkPolicy;
}

interface ForkCreateSheetProps {
    open: boolean;
    sourceCircle: {
        id: number;
        name: string;
        level: number;
        mode: 'knowledge' | 'social';
        accessType: AccessType;
        minCrystals: number;
    };
    hint: ForkReadinessViewModel | null;
    initialGhostSettings?: Partial<CircleGhostSettings>;
    initialDraftLifecycleTemplate?: Partial<CircleDraftLifecycleTemplate>;
    initialDraftWorkflowPolicy?: Partial<CircleDraftWorkflowPolicy>;
    initialForkPolicy?: Partial<CircleForkPolicy>;
    initialDeclarationText?: string;
    resumePendingFinalization?: boolean;
    pendingTargetCircleId?: number | null;
    onClose: () => void;
    onCreate: (data: ForkCreateData) => Promise<boolean | void> | boolean | void;
    submitting?: boolean;
    submitError?: string | null;
}

export default function ForkCreateSheet(props: ForkCreateSheetProps) {
    const t = useI18n('ForkCreateSheet');
    const workflowRoleOptions = useMemo<Array<{
        value: CircleDraftWorkflowPolicy['createIssueMinRole'];
        label: string;
    }>>(() => [
        { value: 'Initiate', label: t('roles.Initiate') },
        { value: 'Member', label: t('roles.Member') },
        { value: 'Elder', label: t('roles.Elder') },
        { value: 'Moderator', label: t('roles.Moderator') },
        { value: 'Admin', label: t('roles.Admin') },
        { value: 'Owner', label: t('roles.Owner') },
    ], [t]);
    const reviewEntryModeOptions = useMemo<Array<{
        value: DraftReviewEntryMode;
        label: string;
    }>>(() => [
        { value: 'auto_or_manual', label: t('reviewEntryMode.auto_or_manual') },
        { value: 'auto_only', label: t('reviewEntryMode.auto_only') },
        { value: 'manual_only', label: t('reviewEntryMode.manual_only') },
    ], [t]);
    const defaultGhostSettings = useMemo<CircleGhostSettings>(() => ({
        summaryUseLLM: props.initialGhostSettings?.summaryUseLLM ?? true,
        draftTriggerMode: props.initialGhostSettings?.draftTriggerMode ?? 'auto_draft',
        triggerSummaryUseLLM: props.initialGhostSettings?.triggerSummaryUseLLM ?? true,
        triggerGenerateComment: true,
    }), [props.initialGhostSettings]);
    const defaultDraftLifecycleTemplate = useMemo<{
        reviewEntryMode: DraftReviewEntryMode;
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    }>(() => ({
        reviewEntryMode: props.initialDraftLifecycleTemplate?.reviewEntryMode === 'auto_only'
            ? 'auto_only'
            : props.initialDraftLifecycleTemplate?.reviewEntryMode === 'manual_only'
                ? 'manual_only'
                : 'auto_or_manual',
        draftingWindowMinutes: Math.max(1, Number(props.initialDraftLifecycleTemplate?.draftingWindowMinutes || 30)),
        reviewWindowMinutes: Math.max(1, Number(props.initialDraftLifecycleTemplate?.reviewWindowMinutes || 240)),
        maxRevisionRounds: Math.max(1, Number(props.initialDraftLifecycleTemplate?.maxRevisionRounds || 1)),
    }), [props.initialDraftLifecycleTemplate]);
    const defaultDraftWorkflowPolicy = useMemo<CircleDraftWorkflowPolicy>(() => ({
        createIssueMinRole: props.initialDraftWorkflowPolicy?.createIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.createIssueMinRole,
        followupIssueMinRole: props.initialDraftWorkflowPolicy?.followupIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.followupIssueMinRole,
        reviewIssueMinRole: props.initialDraftWorkflowPolicy?.reviewIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.reviewIssueMinRole,
        retagIssueMinRole: props.initialDraftWorkflowPolicy?.retagIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.retagIssueMinRole,
        applyIssueMinRole: props.initialDraftWorkflowPolicy?.applyIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.applyIssueMinRole,
        manualEndDraftingMinRole: props.initialDraftWorkflowPolicy?.manualEndDraftingMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.manualEndDraftingMinRole,
        advanceFromReviewMinRole: props.initialDraftWorkflowPolicy?.advanceFromReviewMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.advanceFromReviewMinRole,
        enterCrystallizationMinRole: props.initialDraftWorkflowPolicy?.enterCrystallizationMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.enterCrystallizationMinRole,
        allowAuthorWithdrawBeforeReview: props.initialDraftWorkflowPolicy?.allowAuthorWithdrawBeforeReview ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowAuthorWithdrawBeforeReview,
        allowModeratorRetagIssue: props.initialDraftWorkflowPolicy?.allowModeratorRetagIssue ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowModeratorRetagIssue,
    }), [props.initialDraftWorkflowPolicy]);
    const defaultForkPolicy = useMemo<CircleForkPolicy>(() => ({
        ...DEFAULT_CIRCLE_FORK_POLICY,
        ...props.initialForkPolicy,
    }), [props.initialForkPolicy]);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [declarationText, setDeclarationText] = useState('');
    const [accessType, setAccessType] = useState<AccessType>(props.sourceCircle.accessType);
    const [minCrystals, setMinCrystals] = useState(Math.max(0, props.sourceCircle.minCrystals || 0));
    const [ghostSettings, setGhostSettings] = useState<CircleGhostSettings>(defaultGhostSettings);
    const [draftLifecycleTemplate, setDraftLifecycleTemplate] = useState(defaultDraftLifecycleTemplate);
    const [draftWorkflowPolicy, setDraftWorkflowPolicy] = useState<CircleDraftWorkflowPolicy>(defaultDraftWorkflowPolicy);
    const [forkPolicy, setForkPolicy] = useState<CircleForkPolicy>(defaultForkPolicy);
    const [localSubmitting, setLocalSubmitting] = useState(false);

    const isSubmitting = props.submitting || localSubmitting;
    const canSubmitFork = Boolean(props.hint?.canSubmitFork)
        && !isSubmitting
        && (
            props.resumePendingFinalization
            || (
                name.trim().length >= 2
                && declarationText.trim().length >= 8
            )
        );

    useEffect(() => {
        if (!props.open) return;
        setName(t('defaults.name', {sourceCircleName: props.sourceCircle.name}));
        setDescription('');
        setDeclarationText(props.initialDeclarationText || '');
        setAccessType(props.sourceCircle.accessType);
        setMinCrystals(Math.max(0, props.sourceCircle.minCrystals || 0));
        setGhostSettings(defaultGhostSettings);
        setDraftLifecycleTemplate(defaultDraftLifecycleTemplate);
        setDraftWorkflowPolicy(defaultDraftWorkflowPolicy);
        setForkPolicy(defaultForkPolicy);
    }, [
        props.open,
        props.sourceCircle.accessType,
        props.sourceCircle.minCrystals,
        props.sourceCircle.name,
        defaultGhostSettings,
        defaultDraftLifecycleTemplate,
        defaultDraftWorkflowPolicy,
        defaultForkPolicy,
        props.initialDeclarationText,
        t,
    ]);

    const submitLabel = props.resumePendingFinalization
        ? (canSubmitFork ? t('actions.resumeSubmit') : t('actions.disabled'))
        : (canSubmitFork ? t('actions.create') : t('actions.disabled'));

    const handleCreate = async () => {
        if (!canSubmitFork) return;
        setLocalSubmitting(true);
        try {
            const created = await props.onCreate({
                name: name.trim(),
                description: description.trim(),
                mode: props.sourceCircle.mode,
                accessType,
                minCrystals,
                declarationText: declarationText.trim(),
                ghostSettings,
                draftLifecycleTemplate,
                draftWorkflowPolicy,
                forkPolicy,
            });
            if (created !== false) {
                props.onClose();
            }
        } finally {
            setLocalSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            {props.open && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={() => {
                        if (!isSubmitting) props.onClose();
                    }}
                >
                    <motion.div
                        className={styles.sheet}
                        initial={{ y: 400, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 400, opacity: 0 }}
                        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.handle} />

                        <div className={styles.header}>
                            <div>
                                <div className={styles.eyebrow}>{t('header.eyebrow')}</div>
                                <h2 className={styles.title}>{t('header.title', {sourceCircleName: props.sourceCircle.name})}</h2>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={props.onClose}
                                disabled={isSubmitting}
                                aria-label={t('actions.closeAria')}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.body}>
                            <section className={styles.section}>
                                <div className={styles.sectionHeader}>
                                    <div className={styles.sectionIcon}><GitBranch size={16} /></div>
                                    <div>
                                        <h3 className={styles.sectionTitle}>{t('eligibility.title')}</h3>
                                        <p className={styles.sectionHint}>{t('eligibility.hint')}</p>
                                    </div>
                                </div>

                                <blockquote className={styles.slogan}>
                                    {props.hint?.slogan || t('eligibility.fallbackSlogan')}
                                </blockquote>

                                {props.hint ? (
                                    <ForkReadinessPanel hint={props.hint} />
                                ) : (
                                    <div className={styles.loadingCard}>{t('eligibility.loading')}</div>
                                )}

                                {props.resumePendingFinalization && props.pendingTargetCircleId ? (
                                    <div className={styles.loadingCard}>
                                        {t('eligibility.pendingTarget', {targetCircleId: props.pendingTargetCircleId})}
                                    </div>
                                ) : null}

                                <label className={styles.label}>{t('fields.declaration')}</label>
                                <textarea
                                    className={styles.textarea}
                                    value={declarationText}
                                    onChange={(event) => setDeclarationText(event.target.value)}
                                    placeholder={props.hint?.declarationPlaceholder || t('fields.declarationPlaceholder')}
                                    maxLength={500}
                                    disabled={isSubmitting}
                                />
                            </section>

                            <section className={styles.section}>
                                <div className={styles.sectionHeader}>
                                    <div className={styles.sectionIcon}><ShieldCheck size={16} /></div>
                                    <div>
                                        <h3 className={styles.sectionTitle}>{t('setup.title')}</h3>
                                        <p className={styles.sectionHint}>{t('setup.hint')}</p>
                                    </div>
                                </div>

                                <div className={styles.fieldGrid}>
                                    <div className={styles.field}>
                                        <label className={styles.label}>{t('fields.name')}</label>
                                        <input
                                            className={styles.input}
                                            value={name}
                                            onChange={(event) => setName(event.target.value)}
                                            maxLength={40}
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                    <div className={styles.field}>
                                        <label className={styles.label}>{t('fields.description')}</label>
                                        <textarea
                                            className={styles.textarea}
                                            value={description}
                                            onChange={(event) => setDescription(event.target.value)}
                                            maxLength={200}
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                </div>

                                <div className={styles.field}>
                                    <label className={styles.label}>{t('fields.joinRequirement')}</label>
                                    <div className={styles.choiceRow}>
                                        {[
                                            { value: 'free' as const, label: t('access.free') },
                                            { value: 'crystal' as const, label: t('access.crystal') },
                                            { value: 'invite' as const, label: t('access.invite') },
                                            { value: 'approval' as const, label: t('access.approval') },
                                        ].map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                className={`${styles.choiceButton} ${accessType === option.value ? styles.choiceButtonActive : ''}`}
                                                onClick={() => setAccessType(option.value)}
                                                disabled={isSubmitting}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {accessType === 'crystal' && (
                                    <div className={styles.field}>
                                        <label className={styles.label}>{t('fields.minCrystals')}</label>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={minCrystals}
                                            onChange={(event) => setMinCrystals(Math.max(0, Number(event.target.value || 0)))}
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                )}

                                <div className={styles.fieldGrid}>
                                    <div className={styles.field}>
                                        <label className={styles.label}>{t('fields.draftLifecycleTemplate')}</label>
                                        <div className={styles.inlineGrid}>
                                            <Select
                                                value={draftLifecycleTemplate.reviewEntryMode}
                                                options={reviewEntryModeOptions}
                                                onChange={(value) => setDraftLifecycleTemplate((prev) => ({
                                                    ...prev,
                                                    reviewEntryMode: value,
                                                }))}
                                                disabled={isSubmitting}
                                            />
                                            <input
                                                className={styles.input}
                                                type="number"
                                                min={1}
                                                value={draftLifecycleTemplate.draftingWindowMinutes}
                                                onChange={(event) => setDraftLifecycleTemplate((prev) => ({
                                                    ...prev,
                                                    draftingWindowMinutes: Math.max(1, Number(event.target.value || 1)),
                                                }))}
                                                disabled={isSubmitting}
                                            />
                                            <input
                                                className={styles.input}
                                                type="number"
                                                min={1}
                                                value={draftLifecycleTemplate.reviewWindowMinutes}
                                                onChange={(event) => setDraftLifecycleTemplate((prev) => ({
                                                    ...prev,
                                                    reviewWindowMinutes: Math.max(1, Number(event.target.value || 1)),
                                                }))}
                                                disabled={isSubmitting}
                                            />
                                            <input
                                                className={styles.input}
                                                type="number"
                                                min={1}
                                                value={draftLifecycleTemplate.maxRevisionRounds}
                                                onChange={(event) => setDraftLifecycleTemplate((prev) => ({
                                                    ...prev,
                                                    maxRevisionRounds: Math.max(1, Number(event.target.value || 1)),
                                                }))}
                                                disabled={isSubmitting}
                                            />
                                        </div>
                                    </div>

                                    <div className={styles.field}>
                                        <label className={styles.label}>{t('fields.draftWorkflowPolicy')}</label>
                                        <div className={styles.inlineGrid}>
                                            <Select
                                                value={draftWorkflowPolicy.createIssueMinRole}
                                                options={workflowRoleOptions}
                                                onChange={(value) => setDraftWorkflowPolicy((prev) => ({
                                                    ...prev,
                                                    createIssueMinRole: value,
                                                }))}
                                                disabled={isSubmitting}
                                            />
                                            <Select
                                                value={draftWorkflowPolicy.manualEndDraftingMinRole}
                                                options={workflowRoleOptions}
                                                onChange={(value) => setDraftWorkflowPolicy((prev) => ({
                                                    ...prev,
                                                    manualEndDraftingMinRole: value,
                                                }))}
                                                disabled={isSubmitting}
                                            />
                                            <Select
                                                value={draftWorkflowPolicy.enterCrystallizationMinRole}
                                                options={workflowRoleOptions}
                                                onChange={(value) => setDraftWorkflowPolicy((prev) => ({
                                                    ...prev,
                                                    enterCrystallizationMinRole: value,
                                                }))}
                                                disabled={isSubmitting}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.fieldGrid}>
                                    <div className={styles.field}>
                                        <label className={styles.label}>{t('fields.ghostPolicy')}</label>
                                        <div className={styles.choiceRow}>
                                            <button
                                                type="button"
                                                className={`${styles.choiceButton} ${ghostSettings.draftTriggerMode === 'notify_only' ? styles.choiceButtonActive : ''}`}
                                                onClick={() => setGhostSettings((prev) => ({ ...prev, draftTriggerMode: 'notify_only' }))}
                                                disabled={isSubmitting}
                                            >
                                                {t('ghostPolicy.notify_only')}
                                            </button>
                                            <button
                                                type="button"
                                                className={`${styles.choiceButton} ${ghostSettings.draftTriggerMode === 'auto_draft' ? styles.choiceButtonActive : ''}`}
                                                onClick={() => setGhostSettings((prev) => ({ ...prev, draftTriggerMode: 'auto_draft' }))}
                                                disabled={isSubmitting}
                                            >
                                                {t('ghostPolicy.auto_draft')}
                                            </button>
                                        </div>
                                    </div>

                                    <div className={styles.field}>
                                        <label className={styles.label}>{t('fields.forkPolicy')}</label>
                                        <div className={styles.readOnlyCard}>
                                            <div>{t('forkPolicy.minimumContributions', {count: forkPolicy.minimumContributions})}</div>
                                            <div>{t('forkPolicy.minimumRole', {role: t(`roles.${forkPolicy.minimumRole}`)})}</div>
                                            <div>{t('forkPolicy.requiresGovernanceVote', {
                                                value: forkPolicy.requiresGovernanceVote ? t('common.true') : t('common.false'),
                                            })}</div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>

                        {props.submitError && (
                            <div className={styles.errorBanner}>{props.submitError}</div>
                        )}

                        <div className={styles.footer}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={props.onClose}
                                disabled={isSubmitting}
                            >
                                {t('actions.close')}
                            </button>
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={handleCreate}
                                disabled={!canSubmitFork}
                            >
                                {submitLabel}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
