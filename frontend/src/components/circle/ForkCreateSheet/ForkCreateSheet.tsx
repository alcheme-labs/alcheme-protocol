'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GitBranch, ShieldCheck, X } from 'lucide-react';
import type { CircleGhostSettings } from '@/lib/api/circlesGhostSettings';
import { FieldAssistInline } from '@/components/alcheme';
import { Select } from '@/components/ui/Select';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import ForkReadinessPanel from '@/features/fork-lineage/ForkReadinessPanel';
import type { ForkReadinessViewModel } from '@/features/fork-lineage/adapter';
import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
    DEFAULT_CIRCLE_FORK_POLICY,
    type CircleDraftLifecycleTemplate,
    type CircleDraftWorkflowPolicy,
    type CircleForkPolicy,
    type DraftReviewEntryMode,
} from '@/lib/api/circlesPolicyProfile';
import { resolveCreateCircleWalletImpact } from '@/lib/circles/createCircleWalletImpact';
import {
    pollConfigurationCopilotProposal,
    recordConfigurationCopilotEvent,
    requestConfigurationCopilot,
    type ConfigurationFieldChange,
    type ConfigurationProposalView,
} from '@/lib/api/configurationCopilot';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import styles from './ForkCreateSheet.module.css';

type AccessType = 'free' | 'crystal' | 'invite' | 'approval';
type InlineConfigurationField = 'name' | 'description';
type InlineConfigurationAssistState =
    | { status: 'idle' }
    | { status: 'loading'; requestKey: string }
    | { status: 'ready'; requestKey: string; proposal: ConfigurationProposalView; change: ConfigurationFieldChange }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };

const FORK_CIRCLE_NAME_MAX_CHARS = 40;
const FORK_CIRCLE_DESCRIPTION_MAX_CHARS = 200;

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
    postCreateSettingsChanged: {
        description: boolean;
        ghostSettings: boolean;
        draftLifecycle: boolean;
        draftWorkflow: boolean;
    };
}

const DRAFT_WORKFLOW_POLICY_KEYS: (keyof CircleDraftWorkflowPolicy)[] = [
    'createIssueMinRole',
    'followupIssueMinRole',
    'reviewIssueMinRole',
    'retagIssueMinRole',
    'applyIssueMinRole',
    'manualEndDraftingMinRole',
    'advanceFromReviewMinRole',
    'enterCrystallizationMinRole',
    'allowAuthorWithdrawBeforeReview',
    'allowModeratorRetagIssue',
];

function hasGhostSettingsChanged(current: CircleGhostSettings, defaults: CircleGhostSettings): boolean {
    return current.summaryUseLLM !== defaults.summaryUseLLM
        || current.draftTriggerMode !== defaults.draftTriggerMode
        || current.triggerSummaryUseLLM !== defaults.triggerSummaryUseLLM
        || current.triggerGenerateComment !== defaults.triggerGenerateComment;
}

function shouldPersistVisibleGhostSettings(
    current: CircleGhostSettings,
    defaults: CircleGhostSettings,
    hasExplicitInitialSettings: boolean,
): boolean {
    // Visible defaults are part of the user's submitted circle configuration.
    // Persist them when they enable behavior that differs from server fallback.
    if (hasGhostSettingsChanged(current, defaults)) return true;
    if (hasExplicitInitialSettings) return true;
    return current.summaryUseLLM
        || current.draftTriggerMode === 'auto_draft'
        || current.triggerSummaryUseLLM;
}

function hasDraftLifecycleChanged(
    current: ForkCreateData['draftLifecycleTemplate'],
    defaults: ForkCreateData['draftLifecycleTemplate'],
): boolean {
    return current.reviewEntryMode !== defaults.reviewEntryMode
        || current.draftingWindowMinutes !== defaults.draftingWindowMinutes
        || current.reviewWindowMinutes !== defaults.reviewWindowMinutes
        || current.maxRevisionRounds !== defaults.maxRevisionRounds;
}

function hasDraftWorkflowChanged(
    current: CircleDraftWorkflowPolicy,
    defaults: CircleDraftWorkflowPolicy,
): boolean {
    return DRAFT_WORKFLOW_POLICY_KEYS.some((key) => current[key] !== defaults[key]);
}

function getWalletImpactMessageKey(labelKey: string): string {
    return labelKey.startsWith('CreateCircleSheet.')
        ? labelKey.slice('CreateCircleSheet.'.length)
        : labelKey;
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
    declarationFrozen?: boolean;
    resumePendingFinalization?: boolean;
    pendingTargetCircleId?: number | null;
    onClose: () => void;
    onCreate: (data: ForkCreateData) => Promise<boolean | void> | boolean | void;
    submitting?: boolean;
    submitError?: string | null;
}

export default function ForkCreateSheet(props: ForkCreateSheetProps) {
    const t = useI18n('ForkCreateSheet');
    const walletT = useI18n('CreateCircleSheet');
    const locale = useCurrentLocale();
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
    const [inlineConfigurationAssist, setInlineConfigurationAssist] = useState<Record<InlineConfigurationField, InlineConfigurationAssistState>>({
        name: { status: 'idle' },
        description: { status: 'idle' },
    });
    const [localSubmitting, setLocalSubmitting] = useState(false);
    const inlineConfigurationAbortRef = useRef<Partial<Record<InlineConfigurationField, AbortController>>>({});
    const forkSessionId = useRef(`fork_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

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
        clearInlineConfigurationAssist();
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

    useEffect(() => () => {
        Object.values(inlineConfigurationAbortRef.current).forEach((controller) => controller?.abort());
    }, []);

    const submitLabel = props.resumePendingFinalization
        ? (canSubmitFork ? t('actions.resumeSubmit') : t('actions.disabled'))
        : (canSubmitFork ? t('actions.create') : t('actions.disabled'));
    const postCreateSettingsChanged = useMemo<ForkCreateData['postCreateSettingsChanged']>(() => ({
        description: description.trim().length > 0,
        ghostSettings: shouldPersistVisibleGhostSettings(ghostSettings, defaultGhostSettings, Boolean(props.initialGhostSettings)),
        draftLifecycle: hasDraftLifecycleChanged(draftLifecycleTemplate, defaultDraftLifecycleTemplate),
        draftWorkflow: hasDraftWorkflowChanged(draftWorkflowPolicy, defaultDraftWorkflowPolicy),
    }), [
        description,
        ghostSettings,
        defaultGhostSettings,
        props.initialGhostSettings,
        draftLifecycleTemplate,
        defaultDraftLifecycleTemplate,
        draftWorkflowPolicy,
        defaultDraftWorkflowPolicy,
    ]);
    const walletImpact = useMemo(() => resolveCreateCircleWalletImpact({
        kind: 'main',
        mode: props.sourceCircle.mode,
        accessType,
        minCrystals: accessType === 'crystal' ? minCrystals : 0,
        genesisMode: 'BLANK',
        descriptionChanged: postCreateSettingsChanged.description,
        ghostSettingsChanged: postCreateSettingsChanged.ghostSettings,
        draftLifecycleChanged: postCreateSettingsChanged.draftLifecycle,
        draftWorkflowChanged: postCreateSettingsChanged.draftWorkflow,
        forkAnchor: true,
    }), [
        props.sourceCircle.mode,
        accessType,
        minCrystals,
        postCreateSettingsChanged,
    ]);
    const walletImpactHasPostCreateSettings = walletImpact.items.some(
        (item) => item.id === 'post_create_settings_signature',
    );

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
                postCreateSettingsChanged,
            });
            if (created !== false) {
                props.onClose();
            }
        } finally {
            setLocalSubmitting(false);
        }
    };

    const buildForkConfigurationSnapshot = () => ({
        name,
        description,
        accessType,
        minCrystals,
        draftLifecycleTemplate,
        draftWorkflowPolicy,
    });

    const getForkConfigurationFieldValue = (field: string): unknown => {
        const snapshot = buildForkConfigurationSnapshot() as Record<string, any>;
        return field.split('.').reduce<unknown>((current, key) => (
            current && typeof current === 'object' && !Array.isArray(current)
                ? (current as Record<string, unknown>)[key]
                : undefined
        ), snapshot);
    };

    const setForkConfigurationFieldValue = (field: string, value: unknown) => {
        if (field === 'name') setName(String(value ?? '').slice(0, FORK_CIRCLE_NAME_MAX_CHARS));
        else if (field === 'description') setDescription(String(value ?? '').slice(0, FORK_CIRCLE_DESCRIPTION_MAX_CHARS));
    };

    const clearInlineConfigurationAssist = (field?: InlineConfigurationField) => {
        if (field) {
            inlineConfigurationAbortRef.current[field]?.abort();
            delete inlineConfigurationAbortRef.current[field];
            setInlineConfigurationAssist((prev) => ({
                ...prev,
                [field]: { status: 'idle' },
            }));
            return;
        }
        Object.values(inlineConfigurationAbortRef.current).forEach((controller) => controller?.abort());
        inlineConfigurationAbortRef.current = {};
        setInlineConfigurationAssist({
            name: { status: 'idle' },
            description: { status: 'idle' },
        });
    };

    const buildInlineConfigurationRequestKey = (field: InlineConfigurationField) => JSON.stringify({
        field,
        value: getForkConfigurationFieldValue(field),
        accessType,
        locale,
    });

    const handleGenerateInlineConfigurationSuggestion = async (field: InlineConfigurationField) => {
        if (isSubmitting || inlineConfigurationAssist[field].status === 'loading') return;
        const requestKey = buildInlineConfigurationRequestKey(field);
        inlineConfigurationAbortRef.current[field]?.abort();
        const controller = new AbortController();
        inlineConfigurationAbortRef.current[field] = controller;
        setInlineConfigurationAssist((prev) => ({
            ...prev,
            [field]: { status: 'loading', requestKey },
        }));
        try {
            const response = await requestConfigurationCopilot({
                entrypoint: 'fork_create',
                forkSessionId: forkSessionId.current,
                locale,
                userIntent: t(`fieldAssist.intent.${field}`),
                currentSnapshot: buildForkConfigurationSnapshot(),
                targetFields: [field],
                interactionMode: 'field_inline',
            });
            if (response.status === 'disabled') {
                setInlineConfigurationAssist((prev) => ({
                    ...prev,
                    [field]: { status: 'disabled', message: t('fieldAssist.disabled') },
                }));
                return;
            }
            if (!response.jobId) {
                setInlineConfigurationAssist((prev) => ({
                    ...prev,
                    [field]: { status: 'error', message: t('fieldAssist.didNotStart') },
                }));
                return;
            }
            const proposal = await pollConfigurationCopilotProposal(response.jobId, {
                signal: controller.signal,
            });
            if (buildInlineConfigurationRequestKey(field) !== requestKey) return;
            const change = proposal?.proposedDiff.configDiff?.find((item) => item.field === field) ?? null;
            if (!proposal || !change) {
                setInlineConfigurationAssist((prev) => ({
                    ...prev,
                    [field]: { status: 'error', message: t('fieldAssist.empty') },
                }));
                return;
            }
            setInlineConfigurationAssist((prev) => ({
                ...prev,
                [field]: { status: 'ready', requestKey, proposal, change },
            }));
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            setInlineConfigurationAssist((prev) => ({
                ...prev,
                [field]: {
                    status: 'error',
                    message: formatNodeRoutingError(error, t('fieldAssist.failed')),
                },
            }));
        } finally {
            if (inlineConfigurationAbortRef.current[field] === controller) {
                delete inlineConfigurationAbortRef.current[field];
            }
        }
    };

    const handleAcceptInlineConfigurationSuggestion = (field: InlineConfigurationField) => {
        const state = inlineConfigurationAssist[field];
        if (state.status !== 'ready') return;
        setForkConfigurationFieldValue(field, state.change.proposedValue);
        void recordConfigurationCopilotEvent({
            proposalId: state.proposal.id,
            eventType: 'field_accepted',
            field,
        }).catch(() => undefined);
        clearInlineConfigurationAssist(field);
    };

    const handleIgnoreInlineConfigurationSuggestion = (field: InlineConfigurationField) => {
        const state = inlineConfigurationAssist[field];
        if (state.status === 'ready') {
            void recordConfigurationCopilotEvent({
                proposalId: state.proposal.id,
                eventType: 'ignored',
                field,
            }).catch(() => undefined);
        }
        clearInlineConfigurationAssist(field);
    };

    const renderInlineConfigurationAssist = (field: InlineConfigurationField) => {
        const state = inlineConfigurationAssist[field];
        const change = state.status === 'ready' ? state.change : null;
        return (
            <FieldAssistInline
                status={state.status}
                requestLabel={t('fieldAssist.requestLabel')}
                loadingLabel={t('fieldAssist.loadingLabel')}
                acceptLabel={t('fieldAssist.acceptLabel')}
                ignoreLabel={t('fieldAssist.ignoreLabel')}
                suggestion={change ? String(change.proposedValue ?? '') : null}
                reason={change?.reason ?? null}
                errorMessage={state.status === 'error' ? state.message : null}
                disabledReason={state.status === 'disabled' ? state.message : null}
                disabled={isSubmitting}
                onRequest={() => { void handleGenerateInlineConfigurationSuggestion(field); }}
                onAccept={() => handleAcceptInlineConfigurationSuggestion(field)}
                onIgnore={() => handleIgnoreInlineConfigurationSuggestion(field)}
            />
        );
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

                                <label className={styles.label} htmlFor="fork-declaration-text">{t('fields.declaration')}</label>
                                <textarea
                                    id="fork-declaration-text"
                                    className={styles.textarea}
                                    value={declarationText}
                                    onChange={(event) => setDeclarationText(event.target.value)}
                                    placeholder={props.hint?.declarationPlaceholder || t('fields.declarationPlaceholder')}
                                    maxLength={500}
                                    disabled={isSubmitting || props.declarationFrozen}
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
                                        <label className={styles.label} htmlFor="fork-circle-name">{t('fields.name')}</label>
                                        <input
                                            id="fork-circle-name"
                                            className={styles.input}
                                            value={name}
                                            onChange={(event) => setName(event.target.value)}
                                            maxLength={FORK_CIRCLE_NAME_MAX_CHARS}
                                            disabled={isSubmitting}
                                        />
                                        {renderInlineConfigurationAssist('name')}
                                    </div>
                                    <div className={styles.field}>
                                        <label className={styles.label} htmlFor="fork-circle-description">{t('fields.description')}</label>
                                        <textarea
                                            id="fork-circle-description"
                                            className={styles.textarea}
                                            value={description}
                                            onChange={(event) => setDescription(event.target.value)}
                                            maxLength={FORK_CIRCLE_DESCRIPTION_MAX_CHARS}
                                            disabled={isSubmitting}
                                        />
                                        {renderInlineConfigurationAssist('description')}
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

                        <section className={styles.walletImpactCard}>
                            <div className={styles.walletImpactHeader}>
                                <div className={styles.walletImpactTitle}>{walletT('walletImpact.title')}</div>
                                <div className={styles.walletImpactCount}>
                                    {walletT('walletImpact.total', { count: walletImpact.totalPromptCount })}
                                </div>
                            </div>
                            {walletImpact.totalPromptCount > 1 && (
                                <p className={styles.walletImpactHint}>{walletT('walletImpact.multiPromptHint')}</p>
                            )}
                            <ul className={styles.walletImpactList}>
                                {walletImpact.items.map((item) => (
                                    <li key={item.id} className={styles.walletImpactItem}>
                                        {walletT(getWalletImpactMessageKey(item.labelKey))}
                                    </li>
                                ))}
                            </ul>
                            {walletImpactHasPostCreateSettings && (
                                <p className={styles.walletImpactHint}>
                                    {walletT('walletImpact.settingsRecoveryHint')}
                                </p>
                            )}
                        </section>

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
