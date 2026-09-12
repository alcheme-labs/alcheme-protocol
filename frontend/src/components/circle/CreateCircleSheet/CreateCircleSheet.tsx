'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, ArrowLeft, Globe, Lock, Users, GitBranch,
    MessageSquare, BookOpen, FileEdit, Rss, Building2,
    Flag, MapPin, Palette, ShieldCheck, MoreHorizontal,
    Shapes, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { CircleGhostSettings } from '@/lib/api/circlesGhostSettings';
import { ConfigurationDiffPanel, FieldAssistInline } from '@/components/alcheme';
import { Select } from '@/components/ui/Select';
import type { SeededSourceInput } from '@/lib/api/circlesSeeded';
import { CIRCLE_NAME_MAX_BYTES, clampUtf8Bytes } from '@/lib/circles/nameLimit';
import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
} from '@/lib/api/circlesPolicyProfile';
import {
    applyDraftWorkflowGovernancePreset,
    DRAFT_WORKFLOW_GOVERNANCE_PRESETS,
    resolveDraftWorkflowGovernancePreset,
    type DraftWorkflowGovernancePresetSelection,
} from '@/lib/circle/draftWorkflowGovernancePresets';
import { resolveCreateCircleStepAdvance } from '@/lib/circle/createCircleStepAdvance';
import { resolveConfigurationRequestKeyTransition } from '@/lib/circle/configurationCopilotState';
import { resolveCreateCircleWalletImpact } from '@/lib/circles/createCircleWalletImpact';
import type {
    CircleDraftWorkflowPolicy,
    CircleDraftLifecycleTemplate,
    DraftReviewEntryMode,
} from '@/lib/api/circlesPolicyProfile';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import {
    pollTrendPlacePrompt,
    requestTrendPlacePrompt,
    type TrendPlacePromptSuggestion,
    type TrendPlacePromptView,
} from '@/lib/api/aiOperatingLayer';
import {
    pollConfigurationCopilotProposal,
    recordConfigurationCopilotEvent,
    requestConfigurationCopilot,
    type ConfigurationFieldChange,
    type ConfigurationProposalView,
} from '@/lib/api/configurationCopilot';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import styles from './CreateCircleSheet.module.css';

/* ═══ Types ═══ */

type CircleMode = 'social' | 'knowledge';
type AccessType = 'free' | 'crystal' | 'invite';
export type CreationScope = 'auxiliary' | 'next-level';
type CircleGenesisMode = 'BLANK' | 'SEEDED';
type CommunityType = 'organization' | 'program' | 'guild' | 'region' | 'topic' | 'creator' | 'event' | 'review' | 'other';
type TrendPromptUiState =
    | { status: 'idle' }
    | { status: 'loading'; requestKey: string }
    | { status: 'queued'; promptId: string; jobId: number | null; requestKey: string }
    | { status: 'ready'; prompt: TrendPlacePromptView; requestKey: string }
    | { status: 'fallback'; prompt: TrendPlacePromptView; requestKey: string }
    | { status: 'error'; message: string };
type ConfigurationCopilotUiState =
    | { status: 'idle' }
    | { status: 'loading'; requestKey: string }
    | { status: 'ready'; proposal: ConfigurationProposalView; requestKey: string }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };

type ConfigurationUndoEntry = {
    field: string;
    previousValue: unknown;
};

type InlineConfigurationField = 'name';
type InlineConfigurationAssistState =
    | { status: 'idle' }
    | { status: 'loading'; requestKey: string }
    | { status: 'ready'; requestKey: string; proposal: ConfigurationProposalView; change: ConfigurationFieldChange }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };

const CREATE_CIRCLE_DESCRIPTION_MAX_CHARS = 200;

interface CreateCircleData {
    creationScope: CreationScope;
    communityType: CommunityType;
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
    postCreateSettingsChanged: {
        description: boolean;
        ghostSettings: boolean;
        draftLifecycle: boolean;
        draftWorkflow: boolean;
    };
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

const FEATURED_COMMUNITY_TYPE_IDS: CommunityType[] = ['organization', 'program', 'topic', 'guild', 'other'];
const MORE_COMMUNITY_TYPE_IDS: CommunityType[] = ['region', 'creator', 'event', 'review'];

type CommunityTypeConfig = {
    id: CommunityType;
    defaultMode: CircleMode;
    icon: React.ReactNode;
};

const COMMUNITY_TYPE_CONFIG: Record<CommunityType, CommunityTypeConfig> = {
    organization: {
        id: 'organization',
        defaultMode: 'social',
        icon: <Building2 size={20} />,
    },
    program: {
        id: 'program',
        defaultMode: 'knowledge',
        icon: <Flag size={20} />,
    },
    guild: {
        id: 'guild',
        defaultMode: 'social',
        icon: <Users size={20} />,
    },
    region: {
        id: 'region',
        defaultMode: 'social',
        icon: <MapPin size={20} />,
    },
    topic: {
        id: 'topic',
        defaultMode: 'knowledge',
        icon: <BookOpen size={20} />,
    },
    creator: {
        id: 'creator',
        defaultMode: 'social',
        icon: <Palette size={20} />,
    },
    event: {
        id: 'event',
        defaultMode: 'social',
        icon: <Rss size={20} />,
    },
    review: {
        id: 'review',
        defaultMode: 'knowledge',
        icon: <ShieldCheck size={20} />,
    },
    other: {
        id: 'other',
        defaultMode: 'social',
        icon: <Shapes size={20} />,
    },
};

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
    current: CreateCircleData['draftLifecycleTemplate'],
    defaults: CreateCircleData['draftLifecycleTemplate'],
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
    const sheetBodyRef = useRef<HTMLDivElement | null>(null);
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
    const [communityType, setCommunityType] = useState<CommunityType>('organization');
    const [showMoreCommunityTypes, setShowMoreCommunityTypes] = useState(false);
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
    const [trendPromptState, setTrendPromptState] = useState<TrendPromptUiState>({ status: 'idle' });
    const [configurationCopilotState, setConfigurationCopilotState] = useState<ConfigurationCopilotUiState>({ status: 'idle' });
    const [inlineConfigurationAssist, setInlineConfigurationAssist] = useState<Record<InlineConfigurationField, InlineConfigurationAssistState>>({
        name: { status: 'idle' },
    });
    const [acceptedConfigurationFields, setAcceptedConfigurationFields] = useState<string[]>([]);
    const [configurationUndoStack, setConfigurationUndoStack] = useState<ConfigurationUndoEntry[]>([]);
    const trendPromptAbortRef = useRef<AbortController | null>(null);
    const trendPromptRequestKeyRef = useRef<string>('');
    const configurationCopilotAbortRef = useRef<AbortController | null>(null);
    const inlineConfigurationAbortRef = useRef<Partial<Record<InlineConfigurationField, AbortController>>>({});
    const configurationCopilotRequestKeyRef = useRef<string>('');
    const configurationLocalApplyCountRef = useRef(0);
    const configurationCreateSessionIdRef = useRef(`create_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    const isSubmitting = submitting || localSubmitting;
    const usesAutoReviewTimer = reviewEntryMode !== 'manual_only';
    const featuredCommunityTypes = useMemo(
        () => FEATURED_COMMUNITY_TYPE_IDS.map((id) => COMMUNITY_TYPE_CONFIG[id]),
        [],
    );
    const moreCommunityTypes = useMemo(
        () => MORE_COMMUNITY_TYPE_IDS.map((id) => COMMUNITY_TYPE_CONFIG[id]),
        [],
    );
    const selectedMoreCommunityType = MORE_COMMUNITY_TYPE_IDS.includes(communityType);
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
    const draftWorkflowPreset = useMemo(
        () => resolveDraftWorkflowGovernancePreset(draftWorkflowPolicy),
        [draftWorkflowPolicy],
    );
    const draftWorkflowPresetOptions = useMemo(
        () => [
            ...Object.keys(DRAFT_WORKFLOW_GOVERNANCE_PRESETS).map((value) => ({
                value: value as DraftWorkflowGovernancePresetSelection,
                label: t(`workflow.presets.${value}`),
            })),
            {
                value: 'custom' as DraftWorkflowGovernancePresetSelection,
                label: t('workflow.presets.custom'),
                disabled: true,
            },
        ],
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

    useEffect(() => {
        if (!open) return;
        sheetBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [open, step]);

    const buildTrendPromptRequestKey = () => [
        name.trim(),
        communityType,
        mode,
        locale,
    ].join('|');

    const clearTrendPromptState = () => {
        trendPromptAbortRef.current?.abort();
        trendPromptAbortRef.current = null;
        trendPromptRequestKeyRef.current = '';
        setTrendPromptState({ status: 'idle' });
    };

    const buildConfigurationRequestKey = () => JSON.stringify({
        name,
        description,
        communityType,
        mode,
        genesisMode,
        accessType,
        minCrystals,
        summaryUseLLM,
        draftTriggerMode,
        triggerSummaryUseLLM,
        reviewEntryMode,
        draftingWindowMinutes,
        reviewWindowMinutes,
        maxRevisionRounds,
        draftWorkflowPolicy,
        locale,
    });

    const clearConfigurationCopilotState = () => {
        configurationCopilotAbortRef.current?.abort();
        configurationCopilotAbortRef.current = null;
        configurationCopilotRequestKeyRef.current = '';
        configurationLocalApplyCountRef.current = 0;
        setConfigurationCopilotState({ status: 'idle' });
        setAcceptedConfigurationFields([]);
        setConfigurationUndoStack([]);
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
        });
    };

    const markConfigurationLocalApply = () => {
        configurationLocalApplyCountRef.current += 1;
    };

    useEffect(() => {
        if (!open) {
            clearTrendPromptState();
            clearConfigurationCopilotState();
            clearInlineConfigurationAssist();
        }
        return () => {
            trendPromptAbortRef.current?.abort();
            configurationCopilotAbortRef.current?.abort();
            Object.values(inlineConfigurationAbortRef.current).forEach((controller) => controller?.abort());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        const nextKey = buildTrendPromptRequestKey();
        if (trendPromptRequestKeyRef.current && trendPromptRequestKeyRef.current !== nextKey) {
            clearTrendPromptState();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, communityType, mode, locale]);

    useEffect(() => {
        const nextKey = buildConfigurationRequestKey();
        const transition = resolveConfigurationRequestKeyTransition({
            currentRequestKey: configurationCopilotRequestKeyRef.current,
            nextRequestKey: nextKey,
            pendingLocalApplyCount: configurationLocalApplyCountRef.current,
        });
        configurationLocalApplyCountRef.current = transition.nextPendingLocalApplyCount;
        configurationCopilotRequestKeyRef.current = transition.nextStoredRequestKey;
        if (transition.shouldClearProposal) {
            clearConfigurationCopilotState();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        name,
        description,
        communityType,
        mode,
        genesisMode,
        accessType,
        minCrystals,
        summaryUseLLM,
        draftTriggerMode,
        triggerSummaryUseLLM,
        reviewEntryMode,
        draftingWindowMinutes,
        reviewWindowMinutes,
        maxRevisionRounds,
        draftWorkflowPolicy,
        locale,
    ]);

    const canNext = useMemo(() => {
        if (step === 0) return name.trim().length >= 2;
        if (step === 1) return true;
        if (step === 2) return true;
        return true;
    }, [step, name]);

    const handleGenerateTrendPrompt = async () => {
        const placeSeed = name.trim();
        if (!placeSeed || isSubmitting) return;
        const requestKey = buildTrendPromptRequestKey();
        trendPromptAbortRef.current?.abort();
        const controller = new AbortController();
        trendPromptAbortRef.current = controller;
        trendPromptRequestKeyRef.current = requestKey;
        setTrendPromptState({ status: 'loading', requestKey });
        try {
            const response = await requestTrendPlacePrompt({
                placeSeed,
                locale,
                communityType,
                mode,
            });
            if (trendPromptRequestKeyRef.current !== requestKey) return;
            if ((response.status === 'queued' || response.status === 'pending') && response.promptId) {
                setTrendPromptState({
                    status: 'queued',
                    promptId: response.promptId,
                    jobId: response.jobId ?? null,
                    requestKey,
                });
                const polled = await pollTrendPlacePrompt(response.promptId, {
                    signal: controller.signal,
                });
                if (trendPromptRequestKeyRef.current !== requestKey) return;
                applyTrendPromptResponse(polled, requestKey);
                return;
            }
            applyTrendPromptResponse(response, requestKey);
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            if (trendPromptRequestKeyRef.current !== requestKey) return;
            setTrendPromptState({
                status: 'error',
                message: t('trendPrompt.states.provider_failed'),
            });
        }
    };

    const applyTrendPromptResponse = (
        response: {
            status: string;
            prompt?: TrendPlacePromptView | null;
        },
        requestKey: string,
    ) => {
        if (!response.prompt) {
            setTrendPromptState({
                status: 'error',
                message: t('trendPrompt.states.provider_failed'),
            });
            return;
        }
        if (response.status === 'ready') {
            setTrendPromptState({ status: 'ready', prompt: response.prompt, requestKey });
            return;
        }
        if (response.status === 'fallback') {
            setTrendPromptState({ status: 'fallback', prompt: response.prompt, requestKey });
            return;
        }
        if (response.status === 'failed') {
            setTrendPromptState({
                status: 'error',
                message: t(`trendPrompt.states.${response.prompt.failureCode || 'provider_failed'}`),
            });
            return;
        }
        if (response.status === 'expired') {
            setTrendPromptState({
                status: 'error',
                message: t('trendPrompt.states.stale_trend_cache'),
            });
            return;
        }
        setTrendPromptState({
            status: 'error',
            message: t('trendPrompt.states.provider_failed'),
        });
    };

    const applyTrendPromptSuggestion = (suggestion: TrendPlacePromptSuggestion) => {
        setDescription(suggestion.descriptionPatch);
    };

    const ignoreTrendPromptSuggestion = (suggestionId: string) => {
        setTrendPromptState((prev) => {
            if (prev.status !== 'ready' && prev.status !== 'fallback') return prev;
            const nextSuggestions = prev.prompt.suggestions.filter((suggestion) => suggestion.id !== suggestionId);
            if (!nextSuggestions.length) return { status: 'idle' };
            return {
                ...prev,
                prompt: {
                    ...prev.prompt,
                    suggestions: nextSuggestions,
                },
            };
        });
    };

    const buildCreateConfigurationSnapshot = () => ({
        name,
        description,
        communityType,
        mode,
        accessType,
        minCrystals,
        genesisMode,
        ghostSettings: {
            summaryUseLLM,
            draftTriggerMode,
            triggerSummaryUseLLM,
        },
        draftLifecycleTemplate: {
            reviewEntryMode,
            draftingWindowMinutes,
            reviewWindowMinutes,
            maxRevisionRounds,
        },
        draftWorkflowPolicy: {
            createIssueMinRole: draftWorkflowPolicy.createIssueMinRole,
            followupIssueMinRole: draftWorkflowPolicy.followupIssueMinRole,
            reviewIssueMinRole: draftWorkflowPolicy.reviewIssueMinRole,
            retagIssueMinRole: draftWorkflowPolicy.retagIssueMinRole,
            applyIssueMinRole: draftWorkflowPolicy.applyIssueMinRole,
            manualEndDraftingMinRole: draftWorkflowPolicy.manualEndDraftingMinRole,
            advanceFromReviewMinRole: draftWorkflowPolicy.advanceFromReviewMinRole,
            enterCrystallizationMinRole: draftWorkflowPolicy.enterCrystallizationMinRole,
            allowAuthorWithdrawBeforeReview: draftWorkflowPolicy.allowAuthorWithdrawBeforeReview,
            allowModeratorRetagIssue: draftWorkflowPolicy.allowModeratorRetagIssue,
        },
    });

    const getCreateConfigurationFieldValue = (field: string): unknown => {
        const snapshot = buildCreateConfigurationSnapshot() as Record<string, any>;
        return field.split('.').reduce<unknown>((current, key) => (
            current && typeof current === 'object' && !Array.isArray(current)
                ? (current as Record<string, unknown>)[key]
                : undefined
        ), snapshot);
    };

    const setCreateConfigurationFieldValue = (field: string, value: unknown) => {
        if (field === 'name') setName(clampUtf8Bytes(String(value ?? '')));
        else if (field === 'description') setDescription(String(value ?? '').slice(0, CREATE_CIRCLE_DESCRIPTION_MAX_CHARS));
        else if (field === 'communityType') setCommunityType(value as CommunityType);
        else if (field === 'mode') setMode(value as CircleMode);
        else if (field === 'accessType') setAccessType(value as AccessType);
        else if (field === 'minCrystals') setMinCrystals(Math.max(0, Number(value) || 0));
        else if (field === 'genesisMode') setGenesisMode(value as CircleGenesisMode);
        else if (field === 'ghostSettings.summaryUseLLM') setSummaryUseLLM(Boolean(value));
        else if (field === 'ghostSettings.draftTriggerMode') setDraftTriggerMode(value as CircleGhostSettings['draftTriggerMode']);
        else if (field === 'ghostSettings.triggerSummaryUseLLM') setTriggerSummaryUseLLM(Boolean(value));
        else if (field === 'draftLifecycleTemplate.reviewEntryMode') setReviewEntryMode(value as DraftReviewEntryMode);
        else if (field === 'draftLifecycleTemplate.draftingWindowMinutes') setDraftingWindowMinutes(Math.max(1, Number(value) || 1));
        else if (field === 'draftLifecycleTemplate.reviewWindowMinutes') setReviewWindowMinutes(Math.max(1, Number(value) || 1));
        else if (field === 'draftLifecycleTemplate.maxRevisionRounds') setMaxRevisionRounds(Math.max(1, Number(value) || 1));
        else if (field.startsWith('draftWorkflowPolicy.')) {
            const key = field.slice('draftWorkflowPolicy.'.length) as keyof CircleDraftWorkflowPolicy;
            setDraftWorkflowPolicy((prev) => ({
                ...prev,
                [key]: value as never,
            }));
        }
    };

    const buildInlineConfigurationRequestKey = (field: InlineConfigurationField) => JSON.stringify({
        field,
        value: getCreateConfigurationFieldValue(field),
        communityType,
        mode,
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
                entrypoint: 'create_circle',
                createSessionId: configurationCreateSessionIdRef.current,
                locale,
                userIntent: t(`fieldAssist.intent.${field}`),
                currentSnapshot: buildCreateConfigurationSnapshot(),
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
        markConfigurationLocalApply();
        setCreateConfigurationFieldValue(field, state.change.proposedValue);
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

    const recordConfigurationEvent = (eventType: Parameters<typeof recordConfigurationCopilotEvent>[0]['eventType'], input: { field?: string; fields?: string[] } = {}) => {
        if (configurationCopilotState.status !== 'ready') return;
        void recordConfigurationCopilotEvent({
            proposalId: configurationCopilotState.proposal.id,
            eventType,
            field: input.field,
            fields: input.fields,
        }).catch(() => undefined);
    };

    const handleGenerateConfigurationProposal = async () => {
        if (isSubmitting || configurationCopilotState.status === 'loading') return;
        const requestKey = buildConfigurationRequestKey();
        configurationCopilotAbortRef.current?.abort();
        const controller = new AbortController();
        configurationCopilotAbortRef.current = controller;
        configurationCopilotRequestKeyRef.current = requestKey;
        setAcceptedConfigurationFields([]);
        setConfigurationUndoStack([]);
        setConfigurationCopilotState({ status: 'loading', requestKey });
        try {
            const response = await requestConfigurationCopilot({
                entrypoint: 'create_circle',
                createSessionId: configurationCreateSessionIdRef.current,
                locale,
                userIntent: [name.trim(), description.trim(), t(`communityType.${communityType}.label`)].filter(Boolean).join(' · '),
                currentSnapshot: buildCreateConfigurationSnapshot(),
            });
            if (configurationCopilotRequestKeyRef.current !== requestKey) return;
            if (response.status === 'disabled') {
                setConfigurationCopilotState({
                    status: 'disabled',
                    message: t('configurationCopilot.disabledFallback'),
                });
                return;
            }
            if (!response.jobId) {
                setConfigurationCopilotState({ status: 'error', message: t('configurationCopilot.didNotStart') });
                return;
            }
            const proposal = await pollConfigurationCopilotProposal(response.jobId, {
                signal: controller.signal,
            });
            if (configurationCopilotRequestKeyRef.current !== requestKey) return;
            if (!proposal) {
                setConfigurationCopilotState({ status: 'error', message: t('configurationCopilot.timedOut') });
                return;
            }
            setConfigurationCopilotState({ status: 'ready', proposal, requestKey });
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            if (configurationCopilotRequestKeyRef.current !== requestKey) return;
            setConfigurationCopilotState({
                status: 'error',
                message: formatNodeRoutingError(error, t('configurationCopilot.failed')),
            });
        }
    };

    const handleAcceptConfigurationField = (change: ConfigurationFieldChange) => {
        const previousValue = getCreateConfigurationFieldValue(change.field);
        markConfigurationLocalApply();
        setCreateConfigurationFieldValue(change.field, change.proposedValue);
        setAcceptedConfigurationFields((prev) => Array.from(new Set([...prev, change.field])));
        setConfigurationUndoStack((prev) => [...prev, { field: change.field, previousValue }]);
        recordConfigurationEvent('field_accepted', { field: change.field });
    };

    const handleAcceptAllConfigurationFields = () => {
        if (configurationCopilotState.status !== 'ready') return;
        const changes = configurationCopilotState.proposal.proposedDiff.configDiff ?? [];
        if (changes.length > 0) markConfigurationLocalApply();
        changes.forEach((change) => {
            const previousValue = getCreateConfigurationFieldValue(change.field);
            setCreateConfigurationFieldValue(change.field, change.proposedValue);
            setConfigurationUndoStack((prev) => [...prev, { field: change.field, previousValue }]);
        });
        const fields = changes.map((change) => change.field);
        setAcceptedConfigurationFields(fields);
        recordConfigurationEvent('all_fields_accepted', { fields });
    };

    const handleUndoConfigurationFields = () => {
        const stack = [...configurationUndoStack].reverse();
        if (stack.length > 0) markConfigurationLocalApply();
        stack.forEach((entry) => setCreateConfigurationFieldValue(entry.field, entry.previousValue));
        recordConfigurationEvent('local_undo', { fields: configurationUndoStack.map((entry) => entry.field) });
        setConfigurationUndoStack([]);
        setAcceptedConfigurationFields([]);
    };

    const handleIgnoreConfigurationProposal = () => {
        recordConfigurationEvent('ignored');
        clearConfigurationCopilotState();
    };

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
                communityType,
                name: name.trim(),
                description: description.trim(),
                mode,
                accessType,
                minCrystals,
                genesisMode,
                seededSources,
                ghostSettings: currentGhostSettings,
                draftLifecycleTemplate: currentDraftLifecycleTemplate,
                draftWorkflowPolicy,
                postCreateSettingsChanged,
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
        else handleClose();
    };

    const handleClose = () => {
        clearTrendPromptState();
        clearConfigurationCopilotState();
        onClose();
    };

    const handleReset = () => {
        clearTrendPromptState();
        clearConfigurationCopilotState();
        setStep(0);
        setCreationScope('auxiliary');
        setCommunityType('organization');
        setShowMoreCommunityTypes(false);
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
    const handleDraftWorkflowPresetChange = (preset: DraftWorkflowGovernancePresetSelection) => {
        if (preset === 'custom') return;
        setDraftWorkflowPolicy((prev) => applyDraftWorkflowGovernancePreset(preset, prev));
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
    const handleSelectCommunityType = (item: CommunityTypeConfig) => {
        setCommunityType(item.id);
        setMode(item.defaultMode);
        if (!MORE_COMMUNITY_TYPE_IDS.includes(item.id)) {
            setShowMoreCommunityTypes(false);
        }
    };

    const creationScopeSummary = creationScope === 'auxiliary'
        ? t('confirm.creationScope.auxiliary')
        : t('confirm.creationScope.nextLevel');
    const communityTypeSummary = t(`communityType.${communityType}.label`);
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
    const currentGhostSettings = useMemo<CircleGhostSettings>(() => ({
        summaryUseLLM,
        draftTriggerMode,
        triggerSummaryUseLLM,
        triggerGenerateComment: true,
    }), [summaryUseLLM, draftTriggerMode, triggerSummaryUseLLM]);
    const currentDraftLifecycleTemplate = useMemo<CreateCircleData['draftLifecycleTemplate']>(() => ({
        reviewEntryMode,
        draftingWindowMinutes,
        reviewWindowMinutes,
        maxRevisionRounds,
    }), [reviewEntryMode, draftingWindowMinutes, reviewWindowMinutes, maxRevisionRounds]);
    const postCreateSettingsChanged = useMemo<CreateCircleData['postCreateSettingsChanged']>(() => ({
        description: description.trim().length > 0,
        ghostSettings: shouldPersistVisibleGhostSettings(currentGhostSettings, defaultGhostSettings, Boolean(initialGhostSettings)),
        draftLifecycle: hasDraftLifecycleChanged(currentDraftLifecycleTemplate, defaultDraftLifecycleTemplate),
        draftWorkflow: hasDraftWorkflowChanged(draftWorkflowPolicy, defaultDraftWorkflowPolicy),
    }), [
        description,
        currentGhostSettings,
        defaultGhostSettings,
        initialGhostSettings,
        currentDraftLifecycleTemplate,
        defaultDraftLifecycleTemplate,
        draftWorkflowPolicy,
        defaultDraftWorkflowPolicy,
    ]);
    const walletImpact = useMemo(() => resolveCreateCircleWalletImpact({
        kind: showCreationScope
            ? (creationScope === 'next-level' ? 'main' : 'auxiliary')
            : 'main',
        mode,
        accessType,
        minCrystals: accessType === 'crystal' ? minCrystals : 0,
        genesisMode,
        descriptionChanged: postCreateSettingsChanged.description,
        ghostSettingsChanged: postCreateSettingsChanged.ghostSettings,
        draftLifecycleChanged: postCreateSettingsChanged.draftLifecycle,
        draftWorkflowChanged: postCreateSettingsChanged.draftWorkflow,
    }), [
        showCreationScope,
        creationScope,
        mode,
        accessType,
        minCrystals,
        genesisMode,
        postCreateSettingsChanged,
    ]);
    const walletImpactHasPostCreateSettings = walletImpact.items.some(
        (item) => item.id === 'post_create_settings_signature',
    );

    const renderTrendPromptPanel = () => {
        const canGenerate = Boolean(name.trim() && !isSubmitting);
        const prompt = trendPromptState.status === 'ready' || trendPromptState.status === 'fallback'
            ? trendPromptState.prompt
            : null;
        const evidenceRefs = prompt?.evidenceRefs?.slice(0, 3) ?? [];
        return (
            <div className={styles.trendPromptPanel}>
                <div className={styles.trendPromptHeader}>
                    <div>
                        <div className={styles.trendPromptTitle}>{t('trendPrompt.title')}</div>
                        <div className={styles.trendPromptMeta}>{t('trendPrompt.trendNotFact')}</div>
                    </div>
                    <button
                        type="button"
                        className={styles.trendPromptGenerateBtn}
                        onClick={handleGenerateTrendPrompt}
                        disabled={!canGenerate || trendPromptState.status === 'loading' || trendPromptState.status === 'queued'}
                    >
                        <Rss size={14} />
                        {trendPromptState.status === 'loading' || trendPromptState.status === 'queued'
                            ? t('trendPrompt.loading')
                            : t('trendPrompt.generate')}
                    </button>
                </div>

                {trendPromptState.status === 'queued' && (
                    <div className={styles.trendPromptState}>{t('trendPrompt.queued')}</div>
                )}
                {trendPromptState.status === 'error' && (
                    <div className={styles.trendPromptState}>{trendPromptState.message}</div>
                )}
                {prompt && (
                    <>
                        <div className={styles.trendPromptSourceMeta}>
                            {prompt.failureCode
                                ? t(`trendPrompt.states.${prompt.failureCode}`)
                                : t('trendPrompt.sourceMeta', { query: prompt.query.display })}
                            {prompt.expiresAt ? ` · ${t('trendPrompt.expiresAt', { value: new Date(prompt.expiresAt).toLocaleString(locale) })}` : ''}
                        </div>
                        {evidenceRefs.length > 0 && (
                            <div className={styles.trendPromptEvidenceList}>
                                {evidenceRefs.map((ref) => {
                                    const sourceKey = String(ref.permissionSnapshot?.sourceKey || ref.sourceId);
                                    const licenseNote = String(ref.permissionSnapshot?.licenseNote || '');
                                    const digest = ref.digest ? ref.digest.slice(0, 10) : '';
                                    return (
                                        <div key={ref.sourceId} className={styles.trendPromptEvidenceItem}>
                                            {t('trendPrompt.evidenceRef', {
                                                source: sourceKey,
                                                license: licenseNote || t('trendPrompt.publicAggregate'),
                                                digest,
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div className={styles.trendPromptSuggestions}>
                            {prompt.suggestions.map((suggestion) => (
                                <div key={suggestion.id} className={styles.trendPromptSuggestion}>
                                    <div className={styles.trendPromptSuggestionText}>
                                        <strong>{suggestion.title}</strong>
                                        <span>{suggestion.descriptionPatch}</span>
                                    </div>
                                    <div className={styles.trendPromptActions}>
                                        <button
                                            type="button"
                                            className={styles.trendPromptActionBtn}
                                            onClick={() => applyTrendPromptSuggestion(suggestion)}
                                            disabled={isSubmitting}
                                        >
                                            {t('trendPrompt.apply')}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.trendPromptGhostBtn}
                                            onClick={() => ignoreTrendPromptSuggestion(suggestion.id)}
                                            disabled={isSubmitting}
                                        >
                                            {t('trendPrompt.ignore')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className={styles.trendPromptMeta}>{t('trendPrompt.editHint')}</div>
                    </>
                )}
            </div>
        );
    };

    const renderConfigurationCopilotPanel = () => {
        const proposal = configurationCopilotState.status === 'ready'
            ? configurationCopilotState.proposal
            : null;
        return (
            <div className={styles.configurationCopilotPanel}>
                <ConfigurationDiffPanel
                    title={t('configurationCopilot.title')}
                    description={t('configurationCopilot.description')}
                    status={configurationCopilotState.status === 'loading'
                        ? 'loading'
                        : configurationCopilotState.status === 'ready'
                            ? 'ready'
                            : configurationCopilotState.status === 'disabled'
                                ? 'disabled'
                                : configurationCopilotState.status === 'error'
                                    ? 'error'
                                    : 'idle'}
                    changes={proposal?.proposedDiff.configDiff ?? []}
                    acceptedFields={acceptedConfigurationFields}
                    validationErrors={proposal?.validationErrors ?? []}
                    errorMessage={configurationCopilotState.status === 'error' ? configurationCopilotState.message : null}
                    disabledReason={configurationCopilotState.status === 'disabled' ? configurationCopilotState.message : null}
                    requestLabel={t('configurationCopilot.requestLabel')}
                    acceptFieldLabel={t('configurationCopilot.acceptFieldLabel')}
                    acceptAllLabel={t('configurationCopilot.acceptAllLabel')}
                    undoLabel={t('configurationCopilot.undoLabel')}
                    ignoreLabel={t('configurationCopilot.ignoreLabel')}
                    emptyLabel={t('configurationCopilot.emptyLabel')}
                    validationFailedLabel={t('configurationCopilot.validationFailedLabel')}
                    loadingLabel={t('configurationCopilot.loadingLabel')}
                    acceptedLabel={t('configurationCopilot.acceptedLabel')}
                    readyAnnouncementLabel={t('configurationCopilot.readyAnnouncement', {
                        count: proposal?.proposedDiff.configDiff?.length ?? 0,
                    })}
                    basisLabel={t('configurationCopilot.basis')}
                    proposalReasonLabel={t('configurationCopilot.proposalReasonLabel')}
                    reviewSummaryLabel={t('configurationCopilot.reviewSummary', {
                        count: proposal?.proposedDiff.configDiff?.length ?? 0,
                    })}
                    proposalReason={proposal?.proposedDiff.reason ?? null}
                    unavailableLabel={t('configurationCopilot.unavailableLabel')}
                    requestFailedLabel={t('configurationCopilot.requestFailedLabel')}
                    valueUnsetLabel={t('configurationCopilot.valueUnsetLabel')}
                    valueBooleanOnLabel={t('configurationCopilot.valueBooleanOnLabel')}
                    valueBooleanOffLabel={t('configurationCopilot.valueBooleanOffLabel')}
                    riskLabels={{
                        low: t('configurationCopilot.risk.low'),
                        medium: t('configurationCopilot.risk.medium'),
                        high: t('configurationCopilot.risk.high'),
                    }}
                    onRequest={handleGenerateConfigurationProposal}
                    onAcceptField={handleAcceptConfigurationField}
                    onAcceptAll={handleAcceptAllConfigurationFields}
                    onUndo={handleUndoConfigurationFields}
                    onIgnore={handleIgnoreConfigurationProposal}
                />
            </div>
        );
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
            {open && (
                <motion.div
                    className={styles.createCircleOverlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={() => {
                        if (!isSubmitting) handleClose();
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
                        <div className={styles.sheetBody} ref={sheetBodyRef}>
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
                                                        className={`${styles.creationScopeGrid} ${allowFork ? styles.creationScopeGridThree : ''}`}
                                                    >
                                                        <button
                                                            className={`${styles.modeCard} ${styles.creationScopeCard} ${creationScope === 'auxiliary' ? styles.modeCardSelected : ''}`}
                                                            onClick={() => setCreationScope('auxiliary')}
                                                            disabled={isSubmitting}
                                                        >
                                                            <div className={`${styles.modeCardIcon} ${styles.creationScopeIcon} ${creationScope === 'auxiliary' ? styles.modeCardSelectedIcon : ''}`}>
                                                                <Users size={20} />
                                                            </div>
                                                            <span className={styles.creationScopeText}>
                                                                <span className={styles.modeCardName}>{t('creationScope.auxiliary.name')}</span>
                                                                <span className={styles.modeCardDesc}>
                                                                    {t('creationScope.auxiliary.line1')}
                                                                    <br />
                                                                    {t('creationScope.auxiliary.line2')}
                                                                </span>
                                                            </span>
                                                        </button>

                                                        <button
                                                            className={`${styles.modeCard} ${styles.creationScopeCard} ${creationScope === 'next-level' ? styles.modeCardSelected : ''} ${!allowNextLevel ? styles.modeCardDisabled : ''}`}
                                                            onClick={() => {
                                                                if (allowNextLevel) setCreationScope('next-level');
                                                            }}
                                                            disabled={!allowNextLevel || isSubmitting}
                                                            title={!allowNextLevel ? (nextLevelDisabledReason || t('creationScope.nextLevelDisabledReason')) : undefined}
                                                        >
                                                            <div className={`${styles.modeCardIcon} ${styles.creationScopeIcon} ${creationScope === 'next-level' ? styles.modeCardSelectedIcon : ''}`}>
                                                                <BookOpen size={20} />
                                                            </div>
                                                            <span className={styles.creationScopeText}>
                                                                <span className={styles.modeCardName}>{t('creationScope.nextLevel.name')}</span>
                                                                <span className={styles.modeCardDesc}>
                                                                    {t('creationScope.nextLevel.line1')}
                                                                    <br />
                                                                    {t('creationScope.nextLevel.line2')}
                                                                </span>
                                                            </span>
                                                        </button>

                                                        {allowFork && (
                                                            <button
                                                                className={`${styles.modeCard} ${styles.creationScopeCard}`}
                                                                onClick={() => {
                                                                    if (isSubmitting) return;
                                                                    handleReset();
                                                                    onSelectFork?.();
                                                                }}
                                                                disabled={isSubmitting}
                                                            >
                                                                <div className={`${styles.modeCardIcon} ${styles.creationScopeIcon}`}>
                                                                    <GitBranch size={20} />
                                                                </div>
                                                                <span className={styles.creationScopeText}>
                                                                    <span className={styles.modeCardName}>{t('creationScope.fork.name')}</span>
                                                                    <span className={styles.modeCardDesc}>
                                                                        {t('creationScope.fork.line1')}
                                                                        <br />
                                                                        {t('creationScope.fork.line2')}
                                                                    </span>
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

                                            <label className={styles.stepLabel}>{t('fields.communityType')}</label>
                                            <div className={`${styles.modeGrid} ${styles.communityTypeGrid}`}>
                                                {featuredCommunityTypes.map((item) => (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        className={`${styles.modeCard} ${communityType === item.id ? styles.modeCardSelected : ''}`}
                                                        onClick={() => handleSelectCommunityType(item)}
                                                        disabled={isSubmitting}
                                                    >
                                                        <div className={`${styles.modeCardIcon} ${communityType === item.id ? styles.modeCardSelectedIcon : ''}`}>
                                                            {item.icon}
                                                        </div>
                                                        <span className={styles.modeCardName}>{t(`communityType.${item.id}.label`)}</span>
                                                        <span className={styles.modeCardDesc}>{t(`communityType.${item.id}.description`)}</span>
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    className={`${styles.modeCard} ${styles.communityTypeMoreToggle} ${selectedMoreCommunityType ? styles.modeCardSelected : ''}`}
                                                    onClick={() => setShowMoreCommunityTypes((value) => !value)}
                                                    aria-expanded={showMoreCommunityTypes}
                                                    aria-controls="create-circle-more-community-types"
                                                    disabled={isSubmitting}
                                                >
                                                    <div className={`${styles.modeCardIcon} ${selectedMoreCommunityType ? styles.modeCardSelectedIcon : ''}`}>
                                                        <MoreHorizontal size={20} />
                                                    </div>
                                                    <span className={styles.modeCardName}>
                                                        {showMoreCommunityTypes ? t('communityTypeControls.less') : t('communityTypeControls.more')}
                                                        {showMoreCommunityTypes ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </span>
                                                    <span className={styles.modeCardDesc}>
                                                        {selectedMoreCommunityType
                                                            ? t('communityTypeControls.selected', { type: communityTypeSummary })
                                                            : t('communityTypeControls.moreDescription')}
                                                    </span>
                                                </button>
                                            </div>
                                            <AnimatePresence initial={false}>
                                                {showMoreCommunityTypes && (
                                                    <motion.div
                                                        id="create-circle-more-community-types"
                                                        className={styles.moreCommunityTypePanel}
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.18 }}
                                                    >
                                                        <div className={styles.moreCommunityTypeGrid}>
                                                            {moreCommunityTypes.map((item) => (
                                                                <button
                                                                    key={item.id}
                                                                    type="button"
                                                                    className={`${styles.modeCard} ${styles.moreCommunityTypeCard} ${communityType === item.id ? styles.modeCardSelected : ''}`}
                                                                    onClick={() => handleSelectCommunityType(item)}
                                                                    disabled={isSubmitting}
                                                                >
                                                                    <div className={`${styles.modeCardIcon} ${communityType === item.id ? styles.modeCardSelectedIcon : ''}`}>
                                                                        {item.icon}
                                                                    </div>
                                                                    <span className={styles.modeCardName}>{t(`communityType.${item.id}.label`)}</span>
                                                                    <span className={styles.modeCardDesc}>{t(`communityType.${item.id}.description`)}</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            <label className={styles.stepLabel}>{t('fields.name')}</label>
                                            <input
                                                className={styles.inputField}
                                                placeholder={t('fields.namePlaceholder')}
                                                value={name}
                                                onChange={(e) => handleNameChange(e.target.value)}
                                                maxLength={CIRCLE_NAME_MAX_BYTES}
                                                disabled={isSubmitting}
                                            />
                                            {renderInlineConfigurationAssist('name')}

                                            <div style={{ height: 16 }} />

                                            <label className={styles.stepLabel}>{t('fields.description')}</label>
                                            <textarea
                                                className={styles.textareaField}
                                                placeholder={t('fields.descriptionPlaceholder')}
                                                value={description}
                                                onChange={(e) => setDescription(e.target.value)}
                                                maxLength={CREATE_CIRCLE_DESCRIPTION_MAX_CHARS}
                                                disabled={isSubmitting}
                                            />

                                            {renderTrendPromptPanel()}
                                            {renderConfigurationCopilotPanel()}
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
                                            {genesisMode === 'SEEDED' && (
                                                <div className={styles.creationHint}>
                                                    {t('genesis.seededHint')}
                                                </div>
                                            )}

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
                                                                <div className={styles.aiSettingTitle}>{t('workflow.preset')}</div>
                                                                <div className={styles.aiSettingHint}>{t('workflow.presetHint')}</div>
                                                            </div>
                                                            <Select
                                                                ariaLabel={t('workflow.preset')}
                                                                value={draftWorkflowPreset}
                                                                options={draftWorkflowPresetOptions}
                                                                onChange={handleDraftWorkflowPresetChange}
                                                                disabled={isSubmitting}
                                                            />
                                                        </div>

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

                                            <div className={styles.confirmSection}>
                                                <div className={styles.confirmLabel}>{t('confirm.labels.communityType')}</div>
                                                <div className={styles.confirmValue}>{communityTypeSummary}</div>
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

                                            <div className={`${styles.confirmSection} ${styles.walletImpactSection}`}>
                                                <div className={styles.walletImpactHeader}>
                                                    <div className={styles.walletImpactTitle}>{t('walletImpact.title')}</div>
                                                    <div className={styles.walletImpactCount}>
                                                        {t('walletImpact.total', { count: walletImpact.totalPromptCount })}
                                                    </div>
                                                </div>
                                                {walletImpact.totalPromptCount > 1 && (
                                                    <p className={styles.walletImpactHint}>{t('walletImpact.multiPromptHint')}</p>
                                                )}
                                                <ul className={styles.walletImpactList}>
                                                    {walletImpact.items.map((item) => (
                                                        <li key={item.id} className={styles.walletImpactItem}>
                                                            {t(getWalletImpactMessageKey(item.labelKey))}
                                                        </li>
                                                    ))}
                                                </ul>
                                                {walletImpactHasPostCreateSettings && (
                                                    <p className={styles.walletImpactHint}>
                                                        {t('walletImpact.settingsRecoveryHint')}
                                                    </p>
                                                )}
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
