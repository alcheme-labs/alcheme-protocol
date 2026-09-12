import type { CircleGhostSettings } from '../api/circlesGhostSettings.ts';
import type {
    CircleDraftLifecycleTemplatePatch,
    CircleDraftWorkflowPolicy,
} from '../api/circlesPolicyProfile.ts';
import type {
    CirclePostCreateSettingsPatch,
    CirclePostCreateSettingsResponse,
} from '../api/circlesPostCreateSettings.ts';
import type { SeededSourceInput } from '../api/circlesSeeded.ts';
import {
    resolveCreateCircleWalletImpact,
    type WalletImpactSummary,
} from '../circles/createCircleWalletImpact.ts';
import type { PendingPostCreateSettingsRecord } from '../circles/postCreateSettingsRecovery.ts';

export type CreateCircleKind = 'main' | 'auxiliary';
export type CreateCircleMode = 'knowledge' | 'social';
export type CreateCircleAccessType = 'free' | 'crystal' | 'invite' | 'approval';
export type CreateCircleGenesisMode = 'BLANK' | 'SEEDED';

export type CreateCircleFlowStage =
    | 'preflight'
    | 'post_create_settings'
    | 'seeded_sources'
    | 'post_create_sync';

export type CreateCircleFlowStatus =
    | 'completed'
    | 'pending'
    | 'recoverable_error'
    | 'requires_governance'
    | 'side_effect_failed_after_chain_success';

export type CreateCirclePostCreateSettingsStatus =
    | 'not_needed'
    | 'applied'
    | 'pending_read_model'
    | 'requires_governance'
    | 'failed';

type CreateCircleErrorKey =
    | 'errors.walletNotConnected'
    | 'errors.identityRequired'
    | 'errors.identitySessionMismatch'
    | 'errors.browserMockCreateCircleUnsupported';

type CreateCircleNoticeKey =
    | 'errors.postCreateSettingsPending'
    | 'errors.postCreateSettingsRequiresGovernance'
    | 'errors.postCreateSettingsSyncFailed'
    | 'errors.seededSourcesSyncFailed'
    | 'errors.postCreateSyncPending'
    | 'errors.postCreateSyncFailed';

export interface CreateCircleOrchestratorOptions {
    description?: string;
    kind?: CreateCircleKind;
    mode?: CreateCircleMode;
    minCrystals?: number;
    accessType?: CreateCircleAccessType;
    genesisMode?: CreateCircleGenesisMode;
    seededSources?: SeededSourceInput[];
    ghostSettings?: Partial<CircleGhostSettings>;
    draftLifecycleTemplate?: CircleDraftLifecycleTemplatePatch;
    draftWorkflowPolicy?: CircleDraftWorkflowPolicy;
    postCreateSettingsChanged?: {
        description?: boolean;
        ghostSettings?: boolean;
        draftLifecycle?: boolean;
        draftWorkflow?: boolean;
    };
    forkAnchor?: unknown;
}

export type CreateCirclePreflightDecision =
    | {
        stage: 'preflight';
        status: 'completed';
    }
    | {
        stage: 'preflight';
        status: 'recoverable_error';
        errorKey?: CreateCircleErrorKey;
        errorMessage?: string;
    };

export interface CreateCirclePostCreatePlan {
    targetKind: CreateCircleKind;
    targetMode: CreateCircleMode;
    targetMinCrystals: number;
    effectiveAccessType: CreateCircleAccessType;
    postCreateSettingsChanged: {
        description: boolean;
        ghostSettings: boolean;
        draftLifecycle: boolean;
        draftWorkflow: boolean;
    };
    walletImpact: WalletImpactSummary;
    expectedPostCreatePromptCount: number;
    postCreatePatch: CirclePostCreateSettingsPatch;
    hasPostCreatePatch: boolean;
    initialPostCreateSettingsStatus: CreateCirclePostCreateSettingsStatus;
    needFlagUpdate: boolean;
    hasForkAnchor: boolean;
    hasSeededSources: boolean;
    hasPostCreateSyncWork: boolean;
}

export interface CreateCircleStageDecision {
    stage: CreateCircleFlowStage;
    status: CreateCircleFlowStatus;
    noticeKey?: CreateCircleNoticeKey;
    pendingReason?: PendingPostCreateSettingsRecord['reason'];
    postCreateSettingsStatus?: CreateCirclePostCreateSettingsStatus;
    shouldPersistPendingPostCreateSettings?: boolean;
    shouldClearPendingPostCreateSettings?: boolean;
}

export function resolveCreateCirclePreflight(input: {
    walletPubkey: string | null;
    identityState: string | null;
    sessionUserPubkey: string | null;
    isE2EMockMode: boolean;
    hasSdk: boolean;
    signerUnavailableError: string | null;
}): CreateCirclePreflightDecision {
    if (!input.walletPubkey) {
        return {
            stage: 'preflight',
            status: 'recoverable_error',
            errorKey: 'errors.walletNotConnected',
        };
    }
    if (input.identityState !== 'registered' || !input.sessionUserPubkey) {
        return {
            stage: 'preflight',
            status: 'recoverable_error',
            errorKey: 'errors.identityRequired',
        };
    }
    if (input.walletPubkey !== input.sessionUserPubkey) {
        return {
            stage: 'preflight',
            status: 'recoverable_error',
            errorKey: 'errors.identitySessionMismatch',
        };
    }
    if (input.isE2EMockMode) {
        return {
            stage: 'preflight',
            status: 'recoverable_error',
            errorKey: 'errors.browserMockCreateCircleUnsupported',
        };
    }
    if (!input.hasSdk) {
        return {
            stage: 'preflight',
            status: 'recoverable_error',
            errorKey: 'errors.walletNotConnected',
        };
    }
    if (input.signerUnavailableError) {
        return {
            stage: 'preflight',
            status: 'recoverable_error',
            errorMessage: input.signerUnavailableError,
        };
    }
    return {
        stage: 'preflight',
        status: 'completed',
    };
}

export function buildCirclePostCreateSettingsPatch(input: {
    options: CreateCircleOrchestratorOptions;
    effectiveAccessType: CreateCircleAccessType;
    targetMinCrystals: number;
    postCreateSettingsChanged: CreateCirclePostCreatePlan['postCreateSettingsChanged'];
}): CirclePostCreateSettingsPatch {
    const patch: CirclePostCreateSettingsPatch = {};
    if (
        input.postCreateSettingsChanged.description
        && typeof input.options.description === 'string'
        && input.options.description.trim().length > 0
    ) {
        patch.description = input.options.description;
    }
    if (input.postCreateSettingsChanged.ghostSettings && input.options.ghostSettings) {
        patch.ghostSettings = input.options.ghostSettings;
    }
    if (input.options.genesisMode === 'SEEDED') {
        patch.genesisMode = input.options.genesisMode;
    }
    if (input.effectiveAccessType !== 'free') {
        patch.joinPolicy = {
            accessType: input.effectiveAccessType,
            minCrystals: input.effectiveAccessType === 'crystal' ? input.targetMinCrystals : 0,
        };
    }
    if (input.postCreateSettingsChanged.draftLifecycle && input.options.draftLifecycleTemplate) {
        patch.draftLifecycleTemplate = input.options.draftLifecycleTemplate;
    }
    if (input.postCreateSettingsChanged.draftWorkflow && input.options.draftWorkflowPolicy) {
        patch.draftWorkflowPolicy = input.options.draftWorkflowPolicy;
    }
    return patch;
}

export function resolveCreateCirclePostCreatePlan(
    options: CreateCircleOrchestratorOptions,
): CreateCirclePostCreatePlan {
    const targetKind = options.kind ?? 'main';
    const targetMode = options.mode ?? 'knowledge';
    const targetMinCrystals = options.minCrystals ?? 0;
    const effectiveAccessType =
        options.accessType
        || (targetMinCrystals > 0 ? 'crystal' : 'free');
    const postCreateSettingsChanged = {
        description:
            options.postCreateSettingsChanged?.description
            ?? (typeof options.description === 'string' && options.description.trim().length > 0),
        ghostSettings: options.postCreateSettingsChanged?.ghostSettings ?? false,
        draftLifecycle: options.postCreateSettingsChanged?.draftLifecycle ?? false,
        draftWorkflow: options.postCreateSettingsChanged?.draftWorkflow ?? false,
    };
    const walletImpact = resolveCreateCircleWalletImpact({
        kind: targetKind,
        mode: targetMode,
        accessType: effectiveAccessType,
        minCrystals: effectiveAccessType === 'crystal' ? targetMinCrystals : 0,
        genesisMode: options.genesisMode ?? 'BLANK',
        descriptionChanged: postCreateSettingsChanged.description,
        ghostSettingsChanged: postCreateSettingsChanged.ghostSettings,
        draftLifecycleChanged: postCreateSettingsChanged.draftLifecycle,
        draftWorkflowChanged: postCreateSettingsChanged.draftWorkflow,
        forkAnchor: Boolean(options.forkAnchor),
    });
    const postCreatePatch = buildCirclePostCreateSettingsPatch({
        options,
        effectiveAccessType,
        targetMinCrystals,
        postCreateSettingsChanged,
    });
    const hasPostCreatePatch = Object.keys(postCreatePatch).length > 0;
    const needFlagUpdate =
        targetKind !== 'main' ||
        targetMode !== 'knowledge' ||
        targetMinCrystals > 0;
    const hasForkAnchor = Boolean(options.forkAnchor);
    const hasSeededSources =
        options.genesisMode === 'SEEDED'
        && Array.isArray(options.seededSources)
        && options.seededSources.length > 0;

    return {
        targetKind,
        targetMode,
        targetMinCrystals,
        effectiveAccessType,
        postCreateSettingsChanged,
        walletImpact,
        expectedPostCreatePromptCount: Math.max(0, walletImpact.totalPromptCount - 1),
        postCreatePatch,
        hasPostCreatePatch,
        initialPostCreateSettingsStatus: hasPostCreatePatch ? 'failed' : 'not_needed',
        needFlagUpdate,
        hasForkAnchor,
        hasSeededSources,
        hasPostCreateSyncWork:
            needFlagUpdate
            || hasForkAnchor
            || hasPostCreatePatch
            || hasSeededSources,
    };
}

export function resolvePostCreateSettingsReadModelGate(input: {
    circleVisible: boolean;
    hasPostCreatePatch: boolean;
}): CreateCircleStageDecision {
    if (!input.hasPostCreatePatch || input.circleVisible) {
        return {
            stage: 'post_create_settings',
            status: 'completed',
        };
    }
    return {
        stage: 'post_create_settings',
        status: 'pending',
        noticeKey: 'errors.postCreateSettingsPending',
        pendingReason: 'read_model_pending',
        postCreateSettingsStatus: 'pending_read_model',
        shouldPersistPendingPostCreateSettings: true,
    };
}

export function resolvePostCreateSettingsApplication(
    result: CirclePostCreateSettingsResponse,
): CreateCircleStageDecision {
    if (result.status === 'requires_governance') {
        return {
            stage: 'post_create_settings',
            status: 'requires_governance',
            noticeKey: 'errors.postCreateSettingsRequiresGovernance',
            pendingReason: 'requires_governance',
            postCreateSettingsStatus: 'requires_governance',
            shouldPersistPendingPostCreateSettings: true,
        };
    }
    return {
        stage: 'post_create_settings',
        status: 'completed',
        postCreateSettingsStatus: 'applied',
        shouldClearPendingPostCreateSettings: true,
    };
}

export function resolvePostCreateSettingsFailure(): CreateCircleStageDecision {
    return {
        stage: 'post_create_settings',
        status: 'side_effect_failed_after_chain_success',
        noticeKey: 'errors.postCreateSettingsSyncFailed',
        pendingReason: 'sync_failed',
        postCreateSettingsStatus: 'failed',
        shouldPersistPendingPostCreateSettings: true,
    };
}

export function resolveSeededSourcesImportFailure(): CreateCircleStageDecision {
    return {
        stage: 'seeded_sources',
        status: 'recoverable_error',
        noticeKey: 'errors.seededSourcesSyncFailed',
    };
}

export function resolvePostCreateSyncSettlement(input: {
    resultStatus: 'completed' | 'failed' | 'timeout';
    hasPostCreatePatch: boolean;
    hasPendingPostCreateSettings: boolean;
}): CreateCircleStageDecision {
    if (input.resultStatus === 'timeout') {
        return {
            stage: 'post_create_sync',
            status: 'pending',
            noticeKey: 'errors.postCreateSyncPending',
            pendingReason: 'sync_failed',
            postCreateSettingsStatus: input.hasPostCreatePatch ? 'failed' : undefined,
            shouldPersistPendingPostCreateSettings: input.hasPostCreatePatch,
        };
    }
    if (input.resultStatus === 'failed') {
        return {
            stage: 'post_create_sync',
            status: 'side_effect_failed_after_chain_success',
            noticeKey: 'errors.postCreateSyncFailed',
            pendingReason: 'sync_failed',
            shouldPersistPendingPostCreateSettings:
                input.hasPostCreatePatch && !input.hasPendingPostCreateSettings,
        };
    }
    return {
        stage: 'post_create_sync',
        status: 'completed',
    };
}
