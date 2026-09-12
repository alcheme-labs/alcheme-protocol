import { createHash, randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { readGovernanceRuntimeMetrics } from '../metrics';
import {
    isRouteAProviderAdmissionCredentialEnabled,
    loadNodeRuntimeConfig,
    requirePrivateSidecarSurface,
} from '../config/services';
import {
    buildGovernanceAuditAnchorPackage,
    buildGovernanceAuditDigestSet,
    type GovernanceAuditDigestSet,
    type GovernanceAuditAnchorPackage,
} from '../services/governance/auditAnchor';
import {
    createPrismaGovernanceEngineStore,
    createPrismaGovernanceRequestStore,
    assertGovernanceRequestFrozenFacts,
    cancelGovernanceRequestAtomically,
    computeGovernancePolicyRulesDigest,
    expireGovernanceRequestAtomically,
    recordAndResolveGovernanceSignalAtomically,
    recordExecutionReceipt,
} from '../services/governance/policyEngine';
import {
    buildCommitteePolicyRules,
    buildGovernanceCrossInstitutionDisclosureImpact,
    counterSharedCommitteeGovernanceMandate,
    acceptGovernanceMandateCounterByTarget,
    findActiveOverlappingCircleGovernanceBinding,
    hasGovernanceCommitteeOperator,
    listCircleGovernanceBindings,
    listCommitteeGovernanceBindings,
    listCommitteeEligibleActors,
    normalizeGovernanceMandateEffectPolicy,
    normalizeGovernanceMandateFeePolicy,
    normalizeGovernanceMandateMinimumConstraints,
    normalizeGovernanceMandateOperatorPolicyConstraints,
    resolveActiveCircleGovernanceBinding,
    type GovernanceMandateEffectPolicy,
    type GovernanceMandateFeePolicy,
    type GovernanceMandateOperatorPolicyConstraints,
    type GovernanceCrossInstitutionDisclosureImpact,
} from '../services/governance/circleGovernanceBindings';
import {
    CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE,
    CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
    CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE,
    computeCircleGovernanceBindingControlDigest,
    recordCircleGovernanceBindingRejectedDecision,
} from '../services/governance/circleGovernanceBindingExecution';
import { getGovernanceCaseActionDefinition } from '../services/governance/governanceCaseActionComposition';
import { requiresExactActionAuthorityMaterialization } from '../services/governance/exactActionAuthorityMaterialization';
import { createActiveGovernanceBindingDeactivationCase } from '../services/governance/governanceBindingDeactivationCase';
import {
    openGovernancePolicyConfigurationTransitionCase,
    resolveGovernanceConfigurationTransitionReadback,
} from '../services/governance/governanceConfigurationTransition';
import {
    openGovernanceRecoveryPolicyCase,
    resolveGovernanceRecoveryReadback,
    terminalizeGovernanceAuthorityContinuity,
} from '../services/governance/governanceRecoveryPolicy';
import {
    applyAcceptedGovernanceAuthorityHealth,
    openGovernanceAuthorityHealthCase,
} from '../services/governance/governanceAuthorityHealth';
import {
    projectGovernanceAuthorityHealthReadback,
    projectGovernanceCaseAuthorityHealthReadback,
} from '../services/governance/governanceAuthorityHealthReadback';
import { resolveGovernanceResourceReadiness } from '../services/governance/governanceResourceReadiness';
import { verifyRealmsProviderTrustProfileReadback } from '../services/governance/realmsProviderTrustReadback';
import {
    projectRealmsOpenBaoRuntimeSignerUnavailable,
    verifyRealmsOpenBaoRuntimeSignerReadback,
} from '../services/governance/realmsOpenBaoRuntimeReadback';
import {
    buildGovernanceContinuitySuccessorActorSnapshot,
    governanceContinuitySuccessorActorSnapshotDigest,
    normalizeGovernanceContinuityIncidentResolution,
} from '../services/governance/governanceContinuityIncident';
import { proposeActiveGovernanceMandateSupersede } from '../services/governance/governanceMandateSupersede';
import {
    normalizeCircleGovernanceCommitteeElectorateTemplate,
    resolveCircleGovernanceCommitteeProfile,
    setCircleGovernanceCommitteeAvailability,
} from '../services/governance/circleCommitteeProfiles';
import {
    createGovernedActionRegistry,
    REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
    REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
    REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
    REALMS_PROVIDER_DISABLE_ACTION_TYPE,
    REALMS_PROVIDER_RESTORE_ACTION_TYPE,
    REALMS_VOTING_POWER_CHALLENGE_CONFORMANCE_ACTION_TYPE,
    SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
    SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
    SQUADS_PROVIDER_DISABLE_ACTION_TYPE,
    SQUADS_PROVIDER_RESTORE_ACTION_TYPE,
    GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
} from '../services/governance/actionRegistry';
import { GovernedActionGateway } from '../services/governance/governedActionGateway';
import {
    resolveGovernedActionOperationInboxReadback,
    resolveGovernedActionOperationDetailReadback,
    resolveGovernedActionRoutingReadback,
    type GovernedActionOperationReadScope,
} from '../services/governance/governedActionRoutingReadback';
import { governanceMandateAuthoritySourceVersion } from '../services/governance/governanceMandateEffects';
import { GOVERNANCE_CAPABILITY_LAYERING } from '../services/governance/governanceProfile';
import {
    GovernanceProfileTransitionExecutionError,
    openCircleGovernanceProfileTransitionRequest,
    readCircleGovernanceProfileTransitionState,
} from '../services/governance/governanceProfileTransitionExecution';
import {
    issueRouteAProviderAdmissionCredential,
    readRouteAProviderAdmissionCredential,
} from '../services/governance/routeAProviderAdmissionCredential';
import { isExternalActionCandidatePickerEnabled } from '../services/governance/externalGovernedActionFlags';
import {
    createStorageFabricProviderAdmissionCandidateClientFromRuntime,
    ProviderAdmissionCandidateClientError,
} from '../services/governance/storageFabricProviderAdmissionCandidateClient';
import {
    createDefaultGovernanceExecutionRegistry,
    executeAcceptedGovernanceRequest,
} from '../services/governance/requestExecution';
import {
    buildRealmsProviderBindingPayload,
    buildRealmsProviderBootstrapPayload,
    buildRealmsProviderDelegationConformancePayload,
    buildRealmsProviderDisablePayload,
    buildRealmsProviderRestorePayload,
    buildRealmsProviderRequestIdempotencyKey,
    buildRealmsVotingPowerChallengeConformancePayload,
    reconcileRealmsProviderBindingReadback,
} from '../services/governance/realmsProviderBinding';
import {
    buildSquadsProviderBindingPayload,
    buildSquadsProviderAdoptionPayload,
    buildSquadsProviderBootstrapPayload,
    buildSquadsProviderDisablePayload,
    buildSquadsGrantPayoutPayload,
    buildSquadsGrantPayoutRequestIdempotencyKey,
    buildSquadsProviderRestorePayload,
    buildSquadsProviderRequestIdempotencyKey,
    reconcileSquadsProviderBindingReadback,
} from '../services/governance/squadsProviderBinding';
import { verifySquadsProviderTrustProfileReadback } from '../services/governance/squadsProviderTrustReadback';
import { verifySquadsOpenBaoRuntimeSignerReadback } from '../services/governance/realmsOpenBaoRuntimeReadback';
import {
    projectGovernanceBinding,
    projectGovernanceAutomaticExecutionAvailabilityReadback,
    projectGovernanceCommitteeProfile,
    projectGovernanceDecisionExecutionStatus,
    projectGovernanceMandateHealth,
    projectGovernanceProviderExecutionReadback,
    projectGovernanceProviderExecutionAuthorityPreflightReadback,
    projectGovernanceProviderExecutionPreviewReadback,
    projectGovernanceProviderExecutionProgressReadback,
    projectGovernanceProviderResourceExecutionAdmissionReadback,
    projectGovernanceRequest,
    resolveGovernanceCircleReadProjection,
    resolveGovernanceRequestReadProjection,
} from '../services/governance/readProjection';
import {
    evaluateCommitteeMemberThreshold,
    resolveCommitteeMemberThresholdConfig,
    type CommitteeMemberThresholdConfig,
} from '../services/governance/strategies/committeeMemberThreshold';
import {
    normalizeQuadraticFundingSignalEvidence,
    normalizeQuadraticVoiceSignalEvidence,
    resolveFrozenNativeGovernanceMechanism,
} from '../services/governance/nativeGovernanceMechanism';
import {
    AuthActorError,
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
    resolveAuthenticatedActor,
    type AuthActor,
} from '../services/auth/actor';
import {
    requireCircleManagerForActor,
    requireSourceMaterialAccessForActor,
    requireSourceMaterialReviewActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    isSourceMaterialVisibleToCircleMember,
    normalizeSourceMaterialLifecycleStatus,
    normalizeSourceMaterialPrivacyClass,
} from '../services/sourceMaterials/lifecycle';
import {
    listSourceMaterials,
    selectLatestExternalUrlCaptureVersions,
} from '../services/sourceMaterials/readModel';
import { verifyEd25519SignatureBase64 } from '../services/offchainDiscussion';
import {
    parseCanonicalSolanaPublicKey,
    solanaPublicKeysEqual,
} from '../services/identity/solanaPublicKey';
import {
    prepareGovernanceSignalEnvelopeV2,
    resolveGovernanceSignalEnvelopeConfig,
    resolveGovernanceSignalEnvelopeConfigForRequest,
    verifyGovernanceSignalEnvelopeV2,
    type GovernanceSignalEnvelopeRequestFacts,
    type GovernanceSignedSignal,
} from '../services/governance/signalEnvelopeV2';
import {
    persistPendingGovernanceSignalChallenge,
    readPendingGovernanceSignalChallenge,
} from '../services/governance/governanceSignalChallenge';
import {
    prepareGovernanceMandateAcceptance,
    verifyGovernanceMandateAcceptance,
} from '../services/governance/governanceMandateAcceptance';
import { describeLegacyExecutionCompatibility } from '../services/governance/legacyExecutionCompatibility';
import {
    createGovernanceCaseAudienceExport,
    createGovernanceCaseIntake,
    findGovernanceCaseIntakeSuggestions,
    GovernanceCaseIntakeError,
    projectGovernanceCase,
    type GovernanceCaseIntakeOriginKind,
} from '../services/governance/governanceCase';
import {
    projectGovernanceCaseDetailExperience,
    projectGovernanceCaseInboxTask,
    projectGovernanceManualExecutionControlReadback,
} from '../services/governance/governanceCaseInbox';
import {
    loadGovernanceProviderIndexerObservations,
    providerResourceBindingIdFromRequest,
} from '../services/governance/governanceProviderProjectionContext';
import {
    reviewGovernanceManualExecutionCompletion,
    submitGovernanceManualExecutionCompletion,
} from '../services/governance/governanceManualExecution';
import { createStorageFabricHttpReceiptVerifierFromRuntime } from '../services/governance/storageFabricHttpReceiptVerifier';
import type { StorageFabricReceiptVerifier } from '../services/governance/storageFabricReceiptVerifier';
import {
    parseCircleGovernanceSearch,
    projectCircleGovernanceSearch,
    projectGovernanceCaseSearch,
} from '../services/governance/governanceCaseSearch';
import {
    filterGovernanceOperationalInboxRecords,
    governanceOperationalInboxAgeBucket,
    governanceOperationalInboxDeadlineBucket,
    governanceOperationalInboxFacetRecord,
    parseGovernanceOperationalInboxFilters,
    projectGovernanceOperationalInboxFacets,
} from '../services/governance/governanceOperationalInbox';
import {
    GovernanceCaseAttentionPreferenceError,
    isGovernanceCaseAttentionLevel,
    readGovernanceCaseAttentionPreference,
    setGovernanceCaseAttentionPreference,
} from '../services/governance/governanceCaseAttentionPreference';
import {
    GovernanceCaseReadCursorError,
    governanceCaseActivityCursor,
    isGovernanceCaseResumeFragment,
    projectGovernanceCaseReadState,
    readGovernanceCaseReadState,
    setGovernanceCaseReadCursor,
} from '../services/governance/governanceCaseReadCursor';
import {
    assertUniqueActiveSystemGovernanceRoleBindings,
    EXTERNAL_APP_GOVERNANCE_ROLE_KEYS,
} from '../services/governance/systemRoleBindings';
import {
    GovernanceCaseTemplateError,
    isGovernanceCaseType,
    resolveGovernanceCaseTemplateCatalog,
} from '../services/governance/governanceCaseTemplate';
import {
    bindGovernanceCaseBrief,
    bindGovernanceCaseBriefClaimEvidence,
    changeGovernanceCaseResponsibility,
    GovernanceCaseWorkflowError,
    listGovernanceCaseBriefCandidates,
    listGovernanceCaseResponsibilityCandidates,
    recordGovernanceCaseReviewConclusion,
    recordGovernanceCaseReviewRelationship,
    transitionGovernanceCasePhase,
    type GovernanceCaseReviewConclusion,
    type GovernanceCaseReviewRelationship,
    type GovernanceCaseReviewRelationshipActorRole,
    type GovernanceCaseResponsibilityAction,
    type GovernanceCaseResponsibilityKind,
} from '../services/governance/governanceCaseWorkflow';
import {
    applyGovernanceCaseDecisionResolution,
    openGovernanceCaseApprovalStage,
    recordGovernanceCaseApprovalConflictDisclosure,
    simulateGovernanceCaseApprovalStage,
    type GovernanceCaseConflictReason,
} from '../services/governance/governanceCaseDecisionStage';
import {
    activateGovernanceGrantAgreement,
    discloseGovernanceGrantReviewerConflict,
    GovernanceGrantAgreementError,
    refreshGovernanceGrantSettlementReadiness,
    type GovernanceGrantConflictReason,
} from '../services/governance/governanceGrantAgreement';
import {
    applyAcceptedGovernanceGrantAgreementTermination,
    openGovernanceGrantAgreementAmendmentCase,
    openGovernanceGrantAgreementTerminationCase,
    openGovernanceGrantMilestoneAppeal,
    recordGovernanceGrantOutcome,
    recordGovernanceGrantMilestoneAppealVote,
    recordGovernanceGrantMilestoneReview,
    type GovernanceGrantAppealVote,
    type GovernanceGrantMilestoneReviewOutcome,
    type GovernanceGrantOutcomeStatus,
    type GovernanceGrantTerminationGround,
} from '../services/governance/governanceGrantLifecycle';
import {
    openGovernanceProviderExecutionCompensationPlanCase,
    openGovernanceProviderExecutionTerminalAbandonmentCase,
} from '../services/governance/governanceProviderExecutionTerminalAbandonment';
import {
    assertGovernanceFundingAmendmentManualRetryConfirmation,
    openGovernanceFundingAmendmentCase,
} from '../services/governance/governanceFundingAmendment';
import { listDraftDiscussionTimelineEvents } from '../services/draftDiscussionLifecycle';
import {
    accessGovernanceEvidenceShare,
    decideGovernanceEvidenceShare,
    findGovernanceEvidenceShareRecipientCircle,
    findGovernanceEvidenceShareTargetCircle,
    listGovernanceCaseEvidenceShares,
    requestGovernanceEvidenceShare,
    resolveGovernanceEvidenceShareAuthority,
    revokeGovernanceEvidenceShare,
} from '../services/governance/governanceEvidenceShare';

const governanceExecutionRegistry = createDefaultGovernanceExecutionRegistry();
const AUTOMATIC_ONLY_CIRCLE_BINDING_ACTIONS = new Set([
    'external_app_primary_circle_bind',
    'external_app_primary_circle_change',
    'external_app_attached_circle_bind',
    'external_app_attached_circle_revoke',
]);

function governanceExecutionCompatibility(request: any) {
    const definition = governanceExecutionRegistry.get(String(request?.actionType ?? ''));
    return describeLegacyExecutionCompatibility(request, definition);
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNonNegativeInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function asOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('governance_case_record_field_invalid');
    }
    return value as Record<string, unknown>;
}

function asRequiredString(value: unknown): string | null {
    const normalized = asOptionalString(value);
    return normalized && normalized.length > 0 ? normalized : null;
}

function parseGovernanceContinuityIncidentInput(value: unknown): {
    replacementActorPubkey: string;
    incidentReviewRef: string;
    incidentReviewSummary: string;
} | null {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('governance_continuity_incident_input_invalid');
    }
    const record = value as Record<string, unknown>;
    const replacementActorPubkey = asRequiredString(record.replacementActorPubkey);
    const incidentReviewRef = asRequiredString(record.incidentReviewRef);
    const incidentReviewSummary = asRequiredString(record.incidentReviewSummary);
    if (!replacementActorPubkey || !incidentReviewRef || !incidentReviewSummary) {
        throw new Error('governance_continuity_incident_input_invalid');
    }
    return { replacementActorPubkey, incidentReviewRef, incidentReviewSummary };
}

function asOptionalStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const normalized = value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    return normalized.length > 0 ? normalized : [];
}

function normalizeMandateReference(value: unknown): { type: string; ref: string } {
    const input = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    const type = String(input.type ?? '');
    const ref = String(input.ref ?? '');
    if (!/^[a-z][a-z0-9_]{1,47}$/.test(type) || !ref.trim() || ref.length > 128 || ref !== ref.trim()) {
        throw new Error('governance_mandate_subject_invalid');
    }
    return { type, ref };
}

function normalizeMandatePurposeBindingsInput(value: unknown): Array<{
    purpose: 'collective_decision' | 'operational_execution';
    actionType: string | null;
    actionPrefix: string | null;
}> {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('governance_mandate_purpose_required');
    }
    return value.map((item) => {
        const input = item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : {};
        const purpose = input.purpose === 'collective_decision'
            || input.purpose === 'operational_execution'
            ? input.purpose
            : null;
        const actionType = asOptionalString(input.actionType);
        const actionPrefix = asOptionalString(input.actionPrefix);
        if (!purpose || (actionType === null) === (actionPrefix === null)) {
            throw new Error('governance_mandate_purpose_required');
        }
        return { purpose, actionType, actionPrefix };
    });
}

function sendPrivateSidecarRequired(
    res: Response,
): boolean {
    const gate = requirePrivateSidecarSurface('governance_execution');
    if (gate.ok) return false;
    res.status(gate.statusCode).json({
        error: gate.error,
        route: gate.route,
    });
    return true;
}

function isGovernanceCaseWorkflowError(
    error: unknown,
): error is GovernanceCaseWorkflowError {
    if (error instanceof GovernanceCaseWorkflowError) return true;
    return Boolean(
        error
        && typeof error === 'object'
        && typeof (error as { code?: unknown }).code === 'string'
        && typeof (error as { statusCode?: unknown }).statusCode === 'number',
    );
}

export function governanceActorPublicKeysEqual(left: unknown, right: unknown): boolean {
    return solanaPublicKeysEqual(left, right);
}

type GovernanceSignalValue = 'approve' | 'reject' | 'abstain' | 'quadratic_voice_credits' | 'quadratic_funding';

function normalizeGovernanceSignalValue(value: unknown): GovernanceSignalValue | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'approve') return 'approve';
    if (normalized === 'reject') return 'reject';
    if (normalized === 'abstain') return 'abstain';
    if (normalized === 'quadratic_voice_credits') return 'quadratic_voice_credits';
    if (normalized === 'quadratic_funding') return 'quadratic_funding';
    return null;
}

function assertGovernanceSignalChoiceSupported(
    request: any,
    value: GovernanceSignalValue,
): void {
    if (!['stage_decision_only', 'provider_bound_action'].includes(request.executionMode)) {
        if (value === 'quadratic_voice_credits' || value === 'quadratic_funding') {
            throw new Error('governance_qv_signal_mechanism_required');
        }
        if (value === 'abstain') {
            throw new Error('governance_signal_choice_unsupported');
        }
        return;
    }
    const contract = resolveFrozenNativeGovernanceMechanism(request);
    if (contract.kind === 'quadratic_voice_credits') {
        if (value !== 'quadratic_voice_credits') {
            throw new Error('governance_signal_choice_unsupported');
        }
        return;
    }
    if (contract.kind === 'quadratic_funding') {
        if (value !== 'quadratic_funding') {
            throw new Error('governance_signal_choice_unsupported');
        }
        return;
    }
    if (value === 'quadratic_voice_credits' || value === 'quadratic_funding') {
        throw new Error('governance_qv_signal_mechanism_required');
    }
    if (!contract.inputs.signals.choices.includes(value as never)) {
        throw new Error('governance_signal_choice_unsupported');
    }
}

function normalizeGovernanceSignalSubmission(
    request: any,
    value: GovernanceSignalValue,
    rawEvidence: unknown,
): {
    signalType: 'committee_vote' | 'quadratic_voice_credits' | 'quadratic_funding';
    value: GovernanceSignalValue;
    evidence: Record<string, unknown> | null;
    signedSignal: GovernanceSignedSignal;
} {
    if (['stage_decision_only', 'provider_bound_action'].includes(request.executionMode)) {
        const contract = resolveFrozenNativeGovernanceMechanism(request);
        if (contract.kind === 'quadratic_voice_credits') {
            if (value !== 'quadratic_voice_credits') {
                throw new Error('governance_signal_choice_unsupported');
            }
            const evidence = normalizeQuadraticVoiceSignalEvidence(contract, rawEvidence);
            return {
                signalType: 'quadratic_voice_credits',
                value,
                evidence: evidence as unknown as Record<string, unknown>,
                signedSignal: {
                    kind: 'quadratic_voice_credits',
                    choiceVector: evidence.choiceVector,
                    creditBudget: evidence.creditBudget,
                    cost: evidence.cost,
                    mechanismContractDigest: evidence.mechanismContractDigest,
                },
            };
        }
        if (contract.kind === 'quadratic_funding') {
            if (value !== 'quadratic_funding') {
                throw new Error('governance_signal_choice_unsupported');
            }
            const evidence = normalizeQuadraticFundingSignalEvidence(contract, rawEvidence);
            return {
                signalType: 'quadratic_funding',
                value,
                evidence: evidence as unknown as Record<string, unknown>,
                signedSignal: {
                    kind: 'quadratic_funding',
                    commitments: evidence.commitments,
                    budgetUnit: evidence.budgetUnit,
                    totalCommitment: evidence.totalCommitment,
                    mechanismContractDigest: evidence.mechanismContractDigest,
                },
            };
        }
    }
    if (value === 'quadratic_voice_credits' || value === 'quadratic_funding') {
        throw new Error('governance_qv_signal_mechanism_required');
    }
    return {
        signalType: 'committee_vote',
        value,
        evidence: rawEvidence && typeof rawEvidence === 'object'
            ? rawEvidence as Record<string, unknown>
            : null,
        signedSignal: { kind: 'single_choice', choice: value },
    };
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return {};
        }
    }
    return {};
}

function governanceSignalEnvelopeRequestFacts(
    request: any,
): GovernanceSignalEnvelopeRequestFacts {
    const snapshotDigest = asRequiredString(request.snapshot?.sourceDigest);
    if (!snapshotDigest) {
        throw new Error('governance_signal_snapshot_digest_required');
    }
    return {
        id: String(request.id),
        actionType: String(request.actionType ?? ''),
        targetType: String(request.targetType ?? ''),
        targetRef: String(request.targetRef ?? ''),
        payload: normalizeJsonRecord(request.payload),
        idempotencyKey: String(request.idempotencyKey ?? ''),
        policyId: String(request.policyId ?? ''),
        policyVersionId: String(request.policyVersionId ?? ''),
        policyVersion: Number(request.policyVersion),
        ruleId: String(request.ruleId ?? ''),
        policyRules: request.policyVersionRecord?.rules ?? null,
        snapshotDigest,
        executionMode: request.executionMode ?? null,
        caseRef: asOptionalString(request.caseRef),
        stageRef: asOptionalString(request.stageRef),
        compatibilityBundleVersion: asOptionalString(request.compatibilityBundleVersion),
        executionModeDigest: asOptionalString(request.executionModeDigest),
    };
}

function assertSignalRequestExecutionMode(request: any): void {
    const mode = request.executionMode ?? null;
    const digest = asOptionalString(request.executionModeDigest);
    if (
        !['legacy_action_checkpoint', 'stage_decision_only', 'provider_bound_action'].includes(mode)
        || !digest
        || request.executionAuthorizationStatus !== 'authorized'
    ) {
        throw new Error('governance_signal_execution_mode_quarantined');
    }
    if (mode === 'legacy_action_checkpoint') {
        if (!asOptionalString(request.compatibilityBundleVersion)) {
            throw new Error('governance_signal_execution_mode_quarantined');
        }
        return;
    }
    if (
        !asOptionalString(request.caseRef)
        || !asOptionalString(request.stageRef)
        || asOptionalString(request.compatibilityBundleVersion)
    ) {
        throw new Error('governance_signal_execution_mode_quarantined');
    }
}

function normalizeEligibleActors(value: unknown): Array<{ pubkey: string; role?: string | null; weight: string; source: string; creditBudget?: number | null }> {
    const raw = Array.isArray(value) ? value : [];
    return raw
        .map((actor) => {
            const record = actor && typeof actor === 'object' ? actor as Record<string, unknown> : {};
            return {
                pubkey: String(record.pubkey || '').trim(),
                role: record.role == null ? null : String(record.role),
                weight: String(record.weight || '1'),
                source: String(record.source || 'committee_member'),
                creditBudget: record.creditBudget == null ? null : Number(record.creditBudget),
            };
        })
        .filter((actor) => actor.pubkey);
}

function findGovernanceRuleConfig(
    rules: unknown,
    ruleId: string,
): CommitteeMemberThresholdConfig {
    return resolveCommitteeMemberThresholdConfig(rules, ruleId);
}

function evaluateGovernanceRequestThreshold(input: {
    request: any;
    eligibleActors: Array<{ pubkey: string; role?: string | null; weight: string; source: string }>;
    signals: Array<{
        id?: string | null;
        actorPubkey?: string | null;
        value: string;
        weight?: string | null;
        createdAt?: Date | string | null;
    }>;
}) {
    return evaluateCommitteeMemberThreshold({
        config: findGovernanceRuleConfig(
            input.request.policyVersionRecord?.rules,
            input.request.ruleId,
        ),
        eligibleActors: input.eligibleActors,
        signals: input.signals,
    });
}

async function openGovernanceBindingChangeRequest(
    prisma: any,
    input: {
        bindingType: 'local_auxiliary' | 'shared_committee' | 'self_governed';
        purposeBindings?: Array<{
            purpose: 'collective_decision' | 'operational_execution';
            actionType: string | null;
            actionPrefix: string | null;
        }>;
        targetCircleId: number;
        committeeCircleId: number;
        actionType: string | null;
        actionPrefix: string | null;
        actorPubkey: string;
        effectiveFrom?: Date;
        effectiveUntil?: Date;
        acceptanceExpiresAt?: Date;
        network?: 'solana:localnet' | 'solana:devnet';
        minimumConstraints?: ReturnType<typeof normalizeGovernanceMandateMinimumConstraints>;
        subject?: { type: string; ref: string };
        feePolicy?: GovernanceMandateFeePolicy;
        effectPolicy?: GovernanceMandateEffectPolicy | null;
        operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints | null;
        crossInstitutionDisclosureImpact?: GovernanceCrossInstitutionDisclosureImpact | null;
        continuityIncident?: {
            replacementActorPubkey: string;
            incidentReviewRef: string;
            incidentReviewSummary: string;
        } | null;
    },
    runtime?: { transactionClient: boolean },
) {
    if (!runtime?.transactionClient) {
        const homes = await prisma.governanceHomeIdentityBinding.findMany({
            where: {
                homeType: 'circle',
                homeRef: String(input.targetCircleId),
                supersededAt: null,
            },
            include: { activationState: true },
            orderBy: { identityVersion: 'desc' },
            take: 2,
        });
        if (homes.length === 1 && homes[0]?.activationState?.state === 'active') {
            return prisma.$transaction((tx: any) => openGovernanceBindingChangeRequest(
                tx,
                input,
                { transactionClient: true },
            ));
        }
    }
    const existing = await findActiveOverlappingCircleGovernanceBinding(prisma, {
        targetCircleId: input.targetCircleId,
        actionType: input.actionType,
        actionPrefix: input.actionPrefix,
        allowCanonicalBootstrapParentForExactAction:
            input.bindingType === 'self_governed'
            && Boolean(input.actionType)
            && input.actionPrefix == null,
    });
    if (existing && existing.status !== 'active') {
        throw new Error('circle_governance_binding_replace_authority_unavailable');
    }
    const registry = createGovernedActionRegistry({ includePhase1Defaults: true });
    const gateway = new GovernedActionGateway({
        registry,
        resolveBinding: (resolutionInput) =>
            resolveActiveCircleGovernanceBinding(prisma, resolutionInput),
        listCommitteeEligibleActors: (resolutionInput) =>
            listCommitteeEligibleActors(prisma, resolutionInput),
        requestStore: createPrismaGovernanceRequestStore(prisma),
        runtimePrisma: prisma,
        runtimeTransactionClient: runtime?.transactionClient === true,
    });
    if (input.continuityIncident && !existing) {
        throw new Error('governance_continuity_incident_requires_binding_replacement');
    }
    let continuityIncidentResolution = null;
    let recoveryEligibleActors: Awaited<ReturnType<typeof listCommitteeEligibleActors>> | null = null;
    if (input.continuityIncident && existing) {
        const health = projectGovernanceAuthorityHealthReadback(existing, new Date());
        const successorActors = await listCommitteeEligibleActors(prisma, {
            committeeCircleId: input.committeeCircleId,
        });
        const successorActorSnapshot = buildGovernanceContinuitySuccessorActorSnapshot(
            successorActors,
        );
        if (!hasGovernanceCommitteeOperator(successorActors)) {
            throw new Error('governance_continuity_incident_successor_operator_required');
        }
        continuityIncidentResolution = normalizeGovernanceContinuityIncidentResolution({
            kind: 'compromised_key_binding_replacement',
            previousBindingId: existing.id,
            previousEvidenceDigest: health.evidenceDigest,
            faultEvidenceRef: health.faultAssessment?.evidenceRef,
            affectedActorPubkey: health.faultAssessment?.affectedActorPubkey,
            replacementActorPubkey: input.continuityIncident.replacementActorPubkey,
            incidentReviewRef: input.continuityIncident.incidentReviewRef,
            incidentReviewSummary: input.continuityIncident.incidentReviewSummary,
            successorActorSnapshot,
            successorActorSnapshotDigest: governanceContinuitySuccessorActorSnapshotDigest(
                successorActorSnapshot,
            ),
            internalCapabilityRevoke: 'supersede_previous_binding_atomically',
            ratificationRequirement: 'accepted_binding_replacement_decision',
            resourcePause: 'not_claimed_p06_authority_required',
            externalSignerRevoke: 'p06_provider_readback_required',
        });
        if (
            health.evidenceIntegrity !== 'verified'
            || health.faultAssessment?.faultClass !== 'compromised_key'
            || !continuityIncidentResolution
        ) throw new Error('governance_continuity_incident_recovery_authority_invalid');
        const currentActors = await listCommitteeEligibleActors(prisma, {
            committeeCircleId: existing.committeeCircleId,
        });
        recoveryEligibleActors = currentActors.filter(
            (actor) => actor.pubkey !== continuityIncidentResolution!.affectedActorPubkey,
        );
    }
    const payload = {
        bindingType: input.bindingType,
        purposeBindings: input.bindingType === 'shared_committee' || input.bindingType === 'self_governed'
            ? input.purposeBindings ?? []
            : [],
        targetCircleId: input.targetCircleId,
        committeeCircleId: input.committeeCircleId,
        actionType: input.actionType,
        actionPrefix: input.actionPrefix,
        actorPubkey: input.actorPubkey,
        replacesBindingId: existing?.id ?? null,
        replacesControlDigest: existing
            ? computeCircleGovernanceBindingControlDigest(existing as any)
            : null,
        effectiveFrom: input.effectiveFrom?.toISOString() ?? null,
        effectiveUntil: input.effectiveUntil?.toISOString() ?? null,
        acceptanceExpiresAt: input.acceptanceExpiresAt?.toISOString() ?? null,
        network: input.network ?? null,
        minimumConstraints: input.minimumConstraints ?? null,
        subject: input.subject ?? null,
        feePolicy: input.feePolicy ?? null,
        effectPolicy: input.effectPolicy ?? null,
        operatorPolicyConstraints: input.operatorPolicyConstraints ?? null,
        crossInstitutionDisclosureImpact: input.crossInstitutionDisclosureImpact ?? null,
        continuityIncidentResolution,
    };
    const idempotencyKey = `circle-governance-binding-change:${stableScopeDigest(payload)}`;

    if (!existing) {
        const decision = await gateway.evaluate({
            actionType: CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE,
            targetCircleId: input.targetCircleId,
            actorPubkey: input.actorPubkey,
            directAllowed: false,
        });
        if (decision.status === 'denied') throw new Error(decision.reason);
        if (decision.status !== 'requires_governance') {
            throw new Error('governance_decision_path_required');
        }
        const requestInput = {
            actionType: CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE,
            targetCircleId: input.targetCircleId,
            targetType: 'circle',
            targetRef: String(input.targetCircleId),
            payload,
            idempotencyKey,
            proposerPubkey: input.actorPubkey,
            expiresAt: input.acceptanceExpiresAt,
        } as const;
        if (runtime?.transactionClient) {
            return gateway.openDecisionStageRequest(requestInput);
        }
        return gateway.openRequest({
            ...requestInput,
            appendCircleBindingFacts: false,
        });
    }

    const authority = await resolveActiveCircleGovernanceBinding(prisma, {
        targetCircleId: input.targetCircleId,
        actionType: CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE,
        authorityBindingId: existing.id,
        subjectType: 'circle_governance_binding',
        subjectRef: existing.id,
    });
    if (!authority || authority.binding.id !== existing.id) {
        throw new Error('circle_governance_binding_replace_authority_unavailable');
    }
    const replacementInput = {
        actionType: CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE,
        targetCircleId: input.targetCircleId,
        targetType: 'circle_governance_binding',
        targetRef: existing.id,
        payload,
        idempotencyKey,
        proposerPubkey: input.actorPubkey,
        expiresAt: input.acceptanceExpiresAt,
    } as const;
    if (runtime?.transactionClient) {
        return gateway.openDecisionStageRequest({
            ...replacementInput,
            authorityBindingId: existing.id,
            continuityRecoveryEligibleActors: recoveryEligibleActors ?? undefined,
        });
    }
    const eligibleActors = recoveryEligibleActors ?? await listCommitteeEligibleActors(prisma, {
        committeeCircleId: authority.binding.committeeCircleId,
    });
    return gateway.openResolvedRequest({
        ...replacementInput,
        authority: authority.binding,
        eligibleActors,
        scope: {
            type: 'circle_governance_committee',
            ref: String(authority.binding.committeeCircleId),
        },
        appendCircleBindingFacts: false,
    });
}

function publicBinding(binding: any, input?: { eligibleActorCount?: number | null }) {
    return {
        id: binding.id,
        bindingType: binding.bindingType,
        targetCircleId: binding.targetCircleId,
        actionType: binding.actionType ?? null,
        actionPrefix: binding.actionPrefix ?? null,
        committeeCircleId: binding.committeeCircleId,
        policyId: binding.policyId,
        policyVersionId: binding.policyVersionId,
        policyVersion: binding.policyVersion,
        ruleId: binding.ruleId,
        executionMode: binding.executionMode ?? 'off_chain',
        status: binding.status,
        targetAuthorizationStatus: binding.targetAuthorizationStatus,
        committeeMandateStatus: binding.committeeMandateStatus,
        committeeMandateRequestId: binding.committeeMandateRequestId ?? null,
        mandateId: binding.mandateId ?? null,
        mandate: binding.mandate ? publicMandate(binding.mandate) : null,
        authorityCanonicalState: binding.authorityCanonicalState ?? 'legacy_canonical',
        shadowComparedAt: binding.shadowComparedAt instanceof Date ? binding.shadowComparedAt.toISOString() : binding.shadowComparedAt ?? null,
        mandateCanonicalAt: binding.mandateCanonicalAt instanceof Date ? binding.mandateCanonicalAt.toISOString() : binding.mandateCanonicalAt ?? null,
        activatedAt: binding.activatedAt instanceof Date ? binding.activatedAt.toISOString() : binding.activatedAt ?? null,
        supersededAt: binding.supersededAt instanceof Date ? binding.supersededAt.toISOString() : binding.supersededAt ?? null,
        createdByPubkey: binding.createdByPubkey ?? null,
        sourceRequestId: binding.sourceRequestId ?? null,
        sourceDecisionDigest: binding.sourceDecisionDigest ?? null,
        sourceExecutionReceiptId: binding.sourceExecutionReceiptId ?? null,
        eligibleActorCount: input?.eligibleActorCount ?? null,
        metadata: binding.metadata ?? null,
    };
}

async function latestOperationalReceiptForBinding(
    prisma: PrismaClient,
    bindingId: string,
): Promise<{
    id: string;
    actorPubkey: string;
    executionAdapter: string;
    executionStatus: string;
} | null> {
    const delegate = (prisma as any).operationReceipt;
    if (typeof delegate?.findFirst !== 'function') return null;
    return delegate.findFirst({
        where: {
            invocation: {
                authoritySnapshot: {
                    authoritySourceRef: bindingId,
                    decisionPath: 'operational_execution',
                },
            },
        },
        select: {
            id: true,
            actorPubkey: true,
            executionAdapter: true,
            executionStatus: true,
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    });
}

function publicMandate(mandate: any) {
    const current = Array.isArray(mandate?.versions)
        ? mandate.versions.find((version: any) => version?.version === mandate?.currentVersion) ?? null
        : null;
    return {
        id: mandate?.id,
        delegatorGovernanceHome: mandate ? {
            type: mandate.delegatorGovernanceHomeType,
            ref: mandate.delegatorGovernanceHomeRef,
        } : null,
        delegateAuthority: mandate ? {
            type: mandate.delegateAuthorityType,
            ref: mandate.delegateAuthorityRef,
        } : null,
        subject: current?.terms?.subject ?? null,
        bindingType: mandate?.bindingType,
        status: mandate?.status,
        currentVersion: mandate?.currentVersion,
        currentTermsDigest: mandate?.currentTermsDigest,
        targetAuthorizationStatus: mandate?.targetAuthorizationStatus,
        committeeAcceptanceStatus: mandate?.committeeAcceptanceStatus,
        acceptanceExpiresAt: mandate?.acceptanceExpiresAt instanceof Date ? mandate.acceptanceExpiresAt.toISOString() : mandate?.acceptanceExpiresAt ?? null,
        activatedAt: mandate?.activatedAt instanceof Date ? mandate.activatedAt.toISOString() : mandate?.activatedAt ?? null,
        expiredAt: mandate?.expiredAt instanceof Date ? mandate.expiredAt.toISOString() : mandate?.expiredAt ?? null,
        terms: current?.terms ?? null,
        minimumConstraints: current?.terms?.minimumConstraints ?? null,
        effectiveFrom: current?.effectiveFrom instanceof Date ? current.effectiveFrom.toISOString() : current?.effectiveFrom ?? null,
        effectiveUntil: current?.effectiveUntil instanceof Date ? current.effectiveUntil.toISOString() : current?.effectiveUntil ?? null,
        targetAcceptedTermsDigest: current?.targetAcceptedTermsDigest ?? null,
        committeeAcceptedTermsDigest: current?.committeeAcceptedTermsDigest ?? null,
    };
}

function governedOperationReadScopes(
    memberships: Array<{ circleId: number; role: string }>,
    delegatedBindings: any[],
    now: Date,
): GovernedActionOperationReadScope[] {
    const managerRoles = new Set(['owner', 'admin', 'moderator']);
    const managerScopes: GovernedActionOperationReadScope[] = memberships
        .filter((membership) => managerRoles.has(String(membership.role || '').toLowerCase()))
        .map((membership) => ({
            role: 'governance_home_manager',
            targetCircleId: membership.circleId,
            committeeCircleId: null,
            domainBindingId: null,
            mandateId: null,
            mandateSourceVersion: null,
            policyId: null,
            policyVersionId: null,
            policyVersion: null,
        }));
    const delegatedScopes = delegatedBindings.flatMap((binding: any) => {
        if (!binding.mandate) return [];
        const version = Array.isArray(binding.mandate.versions)
            ? binding.mandate.versions.find(
                (candidate: any) => candidate?.version === binding.mandate.currentVersion,
            ) ?? null
            : null;
        const health = projectGovernanceMandateHealth(binding, version, now);
        if (health.status !== 'active' || !version) return [];
        return [{
            role: 'delegated_authority_participant' as const,
            targetCircleId: Number(binding.targetCircleId),
            committeeCircleId: Number(binding.committeeCircleId),
            domainBindingId: String(binding.id),
            mandateId: String(binding.mandate.id),
            mandateSourceVersion: governanceMandateAuthoritySourceVersion(
                Number(version.version),
                String(version.termsDigest || ''),
            ),
            policyId: String(binding.policyId),
            policyVersionId: String(binding.policyVersionId),
            policyVersion: Number(binding.policyVersion),
        }];
    });
    return [...managerScopes, ...delegatedScopes];
}

function governanceCaseInstitutionalIdentities(
    governanceCase: any,
    scopes: GovernedActionOperationReadScope[],
) {
    const homeCircleId = governanceCase?.homeIdentityBinding?.homeType === 'circle'
        ? Number(governanceCase.homeIdentityBinding.homeRef)
        : Number.NaN;
    if (!Number.isInteger(homeCircleId) || homeCircleId <= 0) return [];
    const committeeCircleId = governanceCase?.primaryRequest?.scopeType
        === 'circle_governance_committee'
        ? Number(governanceCase.primaryRequest.scopeRef)
        : null;
    return scopes.flatMap((scope) => {
        if (scope.targetCircleId !== homeCircleId) return [];
        if (scope.role === 'delegated_authority_participant'
            && scope.committeeCircleId !== committeeCircleId) return [];
        return [{
            role: scope.role,
            targetCircleId: scope.targetCircleId,
            committeeCircleId: scope.committeeCircleId,
            domainBindingId: scope.domainBindingId,
            mandateId: scope.mandateId,
        }];
    });
}

function operationalInboxCanonicalRef(type: unknown, ref: unknown, version?: unknown): string | null {
    const normalizedType = typeof type === 'string' ? type.trim() : '';
    const normalizedRef = typeof ref === 'string' || typeof ref === 'number'
        ? String(ref).trim()
        : '';
    const normalizedVersion = typeof version === 'string' || typeof version === 'number'
        ? String(version).trim()
        : '';
    if (!normalizedType || !normalizedRef) return null;
    return `${normalizedType}:${normalizedRef}${normalizedVersion ? `:${normalizedVersion}` : ''}`;
}

function governanceCaseOperationalInboxFacetRecord(
    governanceCase: any,
    projectedCase: Record<string, any>,
    task: ReturnType<typeof projectGovernanceCaseInboxTask>,
    identities: ReturnType<typeof governanceCaseInstitutionalIdentities>,
    actorPubkey: string,
    now: Date,
) {
    const decisionAuthorityStages = projectedCase.decisionAuthorityStages?.integrity === 'verified'
        && Array.isArray(projectedCase.decisionAuthorityStages.stages)
        ? projectedCase.decisionAuthorityStages.stages
        : [];
    const decisionStages = projectedCase.decisionStages?.integrity === 'verified'
        && Array.isArray(projectedCase.decisionStages.stages)
        ? projectedCase.decisionStages.stages
        : [];
    const assignedToActor = Array.isArray(governanceCase.responsibilities)
        && governanceCase.responsibilities.some((responsibility: any) => (
            responsibility?.assigneePubkey === actorPubkey
            && (responsibility?.status === 'assigned' || responsibility?.status === 'accepted')
        ));
    const templateRisk = projectedCase.template?.actionContract?.riskFloor;
    const templateAdapter = projectedCase.template?.actionContract?.executionAdapter;
    return governanceOperationalInboxFacetRecord({
        id: `case:${projectedCase.id}`,
        source: 'case',
        values: {
            taskKind: task ? [`case:${task.category}`] : [],
            home: [operationalInboxCanonicalRef(
                projectedCase.governanceHome?.type,
                projectedCase.governanceHome?.ref,
            )],
            subject: [operationalInboxCanonicalRef(
                projectedCase.governedSubject?.type,
                projectedCase.governedSubject?.ref,
            )],
            identity: [
                task ? `workflow:${task.role}` : null,
                ...identities.map((identity) => `institutional:${identity.role}`),
            ],
            assignee: assignedToActor ? ['self'] : [],
            stage: [
                operationalInboxCanonicalRef('case_phase', projectedCase.phase),
                ...decisionStages.map((stage: any) => operationalInboxCanonicalRef(
                    `decision_stage.${stage?.purpose}`,
                    stage?.state,
                )),
            ],
            effect: [],
            age: [governanceOperationalInboxAgeBucket(projectedCase.openedAt, now)],
            risk: ['low', 'medium', 'high', 'critical'].includes(templateRisk)
                ? [templateRisk]
                : [],
            institutionalAuthority: decisionAuthorityStages.flatMap((stage: any) => {
                const authority = stage?.decisionAuthority;
                if (authority?.authorityClass !== 'institutional') return [];
                return [operationalInboxCanonicalRef(
                    authority.type,
                    authority.ref,
                    authority.version,
                )];
            }),
            mandate: [
                projectedCase.template?.actionAuthority?.mandateId,
                ...identities.map((identity) => identity.mandateId),
            ],
            provider: [
                task?.providerHealth
                    ? operationalInboxCanonicalRef(
                        'provider_readback',
                        task.providerHealth.provider,
                        task.providerHealth.profileVersion,
                    )
                    : null,
                templateAdapter
                    ? operationalInboxCanonicalRef('execution_adapter', templateAdapter)
                    : null,
                ...decisionStages.map((stage: any) => operationalInboxCanonicalRef(
                    stage?.provider?.type,
                    stage?.provider?.version,
                )),
            ],
            blockingReason: [
                task?.disabledReason,
                task?.providerHealth?.blocker,
                task?.providerHealth && task.providerHealth.status !== 'healthy'
                    ? `provider_${task.providerHealth.status}`
                    : null,
            ],
            deadline: [governanceOperationalInboxDeadlineBucket(task?.deadline, now)],
        },
    });
}

function governanceOperationOperationalInboxFacetRecord(operation: any, now: Date) {
    return governanceOperationalInboxFacetRecord({
        id: `operation:${operation.id}`,
        source: 'operation',
        values: {
            taskKind: [`operation:${operation.task.kind}`],
            home: [operationalInboxCanonicalRef('circle', operation.circleId)],
            subject: [operationalInboxCanonicalRef(operation.subject.type, operation.subject.ref)],
            identity: operation.authority.identities.map(
                (identity: any) => `institutional:${identity.role}`,
            ).concat(operation.identities.map(
                (identity: any) => `operation:${identity.role}`,
            )),
            assignee: operation.identities.some(
                (identity: any) => identity.role === 'operational_assignee',
            ) ? ['self'] : [],
            stage: [operationalInboxCanonicalRef('invocation', operation.invocation.state)],
            effect: [operation.effect.state],
            age: [governanceOperationalInboxAgeBucket(operation.occurredAt, now)],
            risk: [operation.risk],
            institutionalAuthority: [operationalInboxCanonicalRef(
                operation.authority.sourceType,
                operation.authority.sourceRef,
                operation.authority.sourceVersion,
            )],
            mandate: [
                operation.authority.mandateId,
                ...operation.authority.identities.map((identity: any) => identity.mandateId),
            ],
            provider: [operationalInboxCanonicalRef(
                operation.provider.type,
                operation.provider.ref,
            )],
            blockingReason: operation.task.disabledReason
                ? [operation.task.disabledReason]
                : [],
            deadline: [governanceOperationalInboxDeadlineBucket(operation.task.deadline, now)],
        },
    });
}

function governanceDutyOperationalInboxFacetRecord(duty: any, now: Date) {
    const occurredAt = duty.mandate?.health?.effectiveFrom ?? duty.systemRole?.activatedAt ?? null;
    return governanceOperationalInboxFacetRecord({
        id: `institutional_duty:${duty.id}`,
        source: 'institutional_duty',
        values: {
            taskKind: [`duty:${duty.kind}`],
            home: [operationalInboxCanonicalRef('circle', duty.circleId)],
            subject: [duty.mandate
                ? operationalInboxCanonicalRef('circle', duty.mandate.targetCircleId)
                : duty.kind === 'governance_home_settings'
                    ? operationalInboxCanonicalRef('circle', duty.circleId)
                    : null],
            identity: [`institutional:${duty.role}`],
            assignee: [],
            stage: [operationalInboxCanonicalRef('duty', duty.task.status)],
            effect: [],
            age: [governanceOperationalInboxAgeBucket(occurredAt, now)],
            risk: [],
            institutionalAuthority: [
                duty.mandate
                    ? operationalInboxCanonicalRef('governance_mandate', duty.mandate.id)
                    : null,
                duty.systemRole
                    ? operationalInboxCanonicalRef(
                        'system_governance_role_binding',
                        duty.systemRole.bindingId,
                    )
                    : null,
            ],
            mandate: duty.mandate ? [duty.mandate.id] : [],
            provider: [],
            blockingReason: duty.task.disabledReason ? [duty.task.disabledReason] : [],
            deadline: [governanceOperationalInboxDeadlineBucket(duty.task.deadline, now)],
        },
    });
}

async function governedOperationActorFactsForActor(
    prisma: PrismaClient,
    userId: number,
    now: Date,
): Promise<{
    readScopes: GovernedActionOperationReadScope[];
    independentAppealReviewerCircleIds: number[];
}> {
    const memberships = await prisma.circleMember.findMany({
        where: { userId, status: 'Active' },
        select: { circleId: true, role: true },
        orderBy: { circleId: 'asc' },
    });
    const circleIds = memberships.map((membership) => membership.circleId);
    const independentReviewerCandidateIds = memberships
        .filter((membership) => ['owner', 'admin'].includes(
            String(membership.role || '').toLowerCase(),
        ))
        .map((membership) => membership.circleId);
    const [delegatedBindings, independentReviewerCircles] = await Promise.all([
        circleIds.length === 0 ? [] : prisma.circleGovernanceBinding.findMany({
            where: {
                committeeCircleId: { in: circleIds },
                mandateId: { not: null },
            },
            include: {
                mandate: {
                    include: { versions: { orderBy: { version: 'desc' } } },
                },
            },
            orderBy: [
                { committeeCircleId: 'asc' },
                { status: 'asc' },
                { activatedAt: 'desc' },
                { id: 'desc' },
            ],
        }),
        independentReviewerCandidateIds.length === 0 ? [] : prisma.circle.findMany({
            where: {
                id: { in: independentReviewerCandidateIds },
                onChainAddress: { not: '' },
            },
            select: { id: true },
            orderBy: { id: 'asc' },
        }),
    ]);
    return {
        readScopes: governedOperationReadScopes(memberships as any, delegatedBindings, now),
        independentAppealReviewerCircleIds: independentReviewerCircles.map((circle) => circle.id),
    };
}

function publicRequest(request: any) {
    return {
        id: request.id,
        policyId: request.policyId,
        policyVersionId: request.policyVersionId,
        policyVersion: request.policyVersion,
        ruleId: request.ruleId,
        scopeType: request.scopeType,
        scopeRef: request.scopeRef,
        actionType: request.actionType,
        targetType: request.targetType,
        targetRef: request.targetRef,
        payload: request.payload ?? null,
        idempotencyKey: request.idempotencyKey,
        proposerPubkey: request.proposerPubkey,
        state: request.state,
        caseRef: request.caseRef ?? null,
        stageRef: request.stageRef ?? null,
        openedAt: request.openedAt instanceof Date ? request.openedAt.toISOString() : request.openedAt ?? null,
        expiresAt: request.expiresAt instanceof Date ? request.expiresAt.toISOString() : request.expiresAt ?? null,
        resolvedAt: request.resolvedAt instanceof Date ? request.resolvedAt.toISOString() : request.resolvedAt ?? null,
        snapshot: request.snapshot ?? null,
        signals: request.signals ?? undefined,
        decision: request.decision ?? undefined,
        receipts: request.receipts ?? undefined,
    };
}

async function filterSourceMaterialRequestsForViewer(
    prisma: PrismaClient,
    input: {
        circleId: number;
        requests: any[];
        canReview: boolean;
        canViewReviewQueue: boolean;
    },
): Promise<any[]> {
    const sourceMaterialIds = Array.from(new Set(
        input.requests
            .map((request) => asPositiveInteger(request?.targetRef))
            .filter((id): id is number => Boolean(id)),
    ));
    if (sourceMaterialIds.length === 0) return [];

    const materials = await (prisma as any).sourceMaterial.findMany({
        where: {
            id: { in: sourceMaterialIds },
            circleId: input.circleId,
        },
        select: {
            id: true,
            circleId: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
        },
    });
    const visibleIds = new Set<number>(
        (materials ?? [])
            .filter((material: any) => isSourceMaterialVisibleToCircleMember({
                lifecycleStatus: normalizeSourceMaterialLifecycleStatus(
                    material.lifecycleStatus ?? 'accepted_to_plaza',
                ),
                evidencePrivacyClass: normalizeSourceMaterialPrivacyClass(
                    material.evidencePrivacyClass ?? 'public',
                ),
                canReview: input.canReview,
                canViewReviewQueue: input.canViewReviewQueue,
            }))
            .map((material: any) => Number(material.id))
            .filter((id: number) => Number.isInteger(id) && id > 0),
    );

    return input.requests.filter((request) => {
        const sourceMaterialId = asPositiveInteger(request?.targetRef);
        return Boolean(sourceMaterialId && visibleIds.has(sourceMaterialId));
    });
}

function publicCommitteeProfile(profile: any) {
    return {
        circleId: profile.circleId,
        availabilityStatus: profile.availabilityStatus,
        allowedActionPrefixes: profile.allowedActionPrefixes ?? null,
        defaultStrategy: profile.defaultStrategy,
        electorateTemplate: profile.electorateTemplate,
        windowMinutes: profile.windowMinutes ?? null,
        updatedByPubkey: profile.updatedByPubkey ?? null,
        availabilityOpenedAt: profile.availabilityOpenedAt instanceof Date
            ? profile.availabilityOpenedAt.toISOString()
            : profile.availabilityOpenedAt ?? null,
        availabilityExpiresAt: profile.availabilityExpiresAt instanceof Date
            ? profile.availabilityExpiresAt.toISOString()
            : profile.availabilityExpiresAt ?? null,
        lastMandateRequestId: profile.lastMandateRequestId ?? null,
        lastMandateRequestAt: profile.lastMandateRequestAt instanceof Date
            ? profile.lastMandateRequestAt.toISOString()
            : profile.lastMandateRequestAt ?? null,
        activatedAt: profile.activatedAt instanceof Date
            ? profile.activatedAt.toISOString()
            : profile.activatedAt ?? null,
        deactivatedAt: profile.deactivatedAt instanceof Date
            ? profile.deactivatedAt.toISOString()
            : profile.deactivatedAt ?? null,
    };
}

function stableJsonStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`,
    ).join(',')}}`;
}

function stableScopeDigest(value: unknown): string {
    return createHash('sha256')
        .update(stableJsonStringify(value))
        .digest('hex');
}

async function findTerminalExecutionReceipt(
    prisma: PrismaClient,
    input: {
        requestId: string;
        actionType: string;
        executorModule: string;
    },
) {
    const delegate = (prisma as any).governanceExecutionReceipt;
    if (typeof delegate?.findFirst !== 'function') return null;
    return delegate.findFirst({
        where: {
            requestId: input.requestId,
            actionType: input.actionType,
            executorModule: input.executorModule,
            executionStatus: { in: ['executed', 'skipped'] },
        },
        orderBy: { executedAt: 'desc' },
    });
}

export function governanceRouter(
    prisma: PrismaClient,
    redis: Redis,
    dependencies: { storageFabricReceiptVerifier?: StorageFabricReceiptVerifier } = {},
): Router {
    const router = Router();
    const runtime = loadNodeRuntimeConfig();
    const storageFabricReceiptVerifier = dependencies.storageFabricReceiptVerifier
        ?? createStorageFabricHttpReceiptVerifierFromRuntime({
            runtimeRole: runtime.runtimeRole,
        });

    async function requireGovernanceActor(req: any) {
        return requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
    }

    async function requireGovernanceManager(req: any, circleId: number, actorPubkey: string): Promise<AuthActor> {
        const actor = await requireGovernanceActor(req);
        if (actor.pubkey !== actorPubkey) {
            throw new AuthActorError(
                403,
                'actor_pubkey_session_mismatch',
                'actorPubkey must match authenticated session actor',
                'actor_pubkey_session_mismatch',
                true,
            );
        }
        await requireCircleManagerForActor(prisma, { actor, circleId });
        return actor;
    }

    async function canReviewSourceMaterialsForActor(actor: AuthActor, circleId: number): Promise<boolean> {
        try {
            await requireSourceMaterialReviewActor(prisma, { actor, circleId });
            return true;
        } catch (error) {
            if (error instanceof AuthActorError && error.code === 'circle_role_required') {
                return false;
            }
            throw error;
        }
    }

    async function resolveCaseCircleId(caseId: string): Promise<number> {
        const governanceCase = await prisma.governanceCase.findUnique({
            where: { id: caseId },
            select: {
                homeIdentityBinding: { select: { homeType: true, homeRef: true } },
            },
        });
        if (!governanceCase) {
            throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
        }
        const circleId = governanceCase.homeIdentityBinding?.homeType === 'circle'
            ? asPositiveInteger(governanceCase.homeIdentityBinding.homeRef)
            : null;
        if (!circleId) {
            throw new GovernanceCaseWorkflowError(409, 'governance_case_circle_home_required');
        }
        return circleId;
    }

    async function canManageCaseResponsibilities(actor: AuthActor, circleId: number): Promise<boolean> {
        try {
            await requireCircleManagerForActor(prisma, { actor, circleId, allowModerator: true });
            return true;
        } catch (error) {
            if (
                error instanceof AuthActorError
                && (error.code === 'circle_role_required' || error.code === 'circle_membership_required')
            ) {
                return false;
            }
            throw error;
        }
    }

    async function openSquadsProviderGovernanceRequest(input: {
        tx: any;
        circleId: number;
        actorPubkey: string;
        actionType: string;
        payload: Record<string, unknown>;
        idempotencyKey: string;
    }) {
        const registry = createGovernedActionRegistry({
            includePhase1Defaults: true,
            includeSquadsProviderBindingActions: true,
        });
        const gateway = new GovernedActionGateway({
            registry,
            resolveBinding: (facts) => resolveActiveCircleGovernanceBinding(input.tx, facts),
            listCommitteeEligibleActors: (facts) => listCommitteeEligibleActors(input.tx, facts),
            requestStore: createPrismaGovernanceRequestStore(input.tx),
            runtimePrisma: input.tx,
            runtimeTransactionClient: true,
        });
        return gateway.openDecisionStageRequest({
            actionType: input.actionType,
            targetCircleId: input.circleId,
            targetType: 'circle',
            targetRef: String(input.circleId),
            payload: input.payload,
            idempotencyKey: input.idempotencyKey,
            proposerPubkey: input.actorPubkey,
        });
    }

    router.get('/circles/:circleId/governance-bindings', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const projection = await resolveGovernanceCircleReadProjection(
                req,
                prisma,
                circleId,
            );
            const now = new Date();
            const bindings = await listCircleGovernanceBindings(prisma as any, {
                targetCircleId: circleId,
            });
            const committeeBindings = await listCommitteeGovernanceBindings(prisma as any, {
                committeeCircleId: circleId,
            });
            const active = bindings.find((binding) =>
                binding.status === 'active'
                && binding.targetAuthorizationStatus === 'accepted'
                && binding.committeeMandateStatus === 'accepted'
            );
            const recovery = await resolveGovernanceRecoveryReadback(prisma as any, {
                circleId,
                bindingId: active?.id ?? null,
            });
            const resourceReadiness = await resolveGovernanceResourceReadiness(prisma as any, {
                circleId,
                now,
            });
            const publicBindings = await Promise.all(bindings.map(async (binding) => {
                const operationReceipt = await latestOperationalReceiptForBinding(
                    prisma,
                    binding.id,
                );
                const shouldCountEligibleActors =
                    binding.status === 'active'
                    || binding.status === 'pending_mandate'
                    || binding.committeeMandateStatus === 'pending';
                if (!shouldCountEligibleActors) {
                    return projectGovernanceBinding(binding, projection, { operationReceipt, now });
                }
                const eligibleActors = await listCommitteeEligibleActors(prisma as any, {
                    committeeCircleId: binding.committeeCircleId,
                });
                return projectGovernanceBinding(binding, projection, {
                    eligibleActorCount: eligibleActors.length,
                    operationReceipt,
                    now,
                });
            }));
            const publicCommitteeBindings = await Promise.all(committeeBindings.map(async (binding) => {
                const operationReceipt = await latestOperationalReceiptForBinding(
                    prisma,
                    binding.id,
                );
                const eligibleActors = await listCommitteeEligibleActors(prisma as any, {
                    committeeCircleId: binding.committeeCircleId,
                });
                return projectGovernanceBinding(binding, projection, {
                    eligibleActorCount: eligibleActors.length,
                    operationReceipt,
                    now,
                });
            }));
            res.json({
                circleId,
                capabilityLayering: GOVERNANCE_CAPABILITY_LAYERING,
                fallback: active
                    ? null
                    : {
                        status: 'action_registry_resolved',
                        reason: 'no_active_governance_binding',
                        authorityTransparency: {
                            schemaVersion: 1,
                            authorityMode: 'action_registry_resolved',
                            scope: 'per_action_and_subject',
                            roleDirect: 'only_when_registered_action_allows_direct',
                            highCriticalWithoutBinding: 'fail_closed',
                            decisionAuthority: 'resolved_by_action_registry',
                            operatorAuthority: 'not_granted_by_absence_of_binding',
                            executionAuthority: 'resolved_at_execution',
                            stageProvider: {
                                authority: 'separate',
                                status: 'not_projected_in_binding',
                            },
                        },
                    },
                projection,
                recovery,
                resourceReadiness,
                bindings: publicBindings,
                committeeBindings: publicCommitteeBindings,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'circle_governance_bindings_lookup_failed',
            });
        }
    });

    router.get('/circles/:circleId/provider-trust/realms/readback', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const reconciliation = await reconcileRealmsProviderBindingReadback(prisma, {
                circleId,
            });
            const readback = await verifyRealmsProviderTrustProfileReadback();
            const runtimeSigner = await verifyRealmsOpenBaoRuntimeSignerReadback(
                prisma,
                { circleId },
            ).catch((error) => projectRealmsOpenBaoRuntimeSignerUnavailable({
                resourceBindingId: reconciliation?.resourceBindingId ?? null,
                blocker: error instanceof Error
                    ? error.message
                    : 'realms_openbao_runtime_readback_unavailable',
            }));
            res.json({ circleId, readback: { ...readback, runtimeSigner, reconciliation } });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(502).json({
                error: error instanceof Error && error.message.startsWith('realms_')
                    ? error.message
                    : 'realms_provider_trust_readback_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/realms/requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const payload = buildRealmsProviderBindingPayload();
            const request = await prisma.$transaction(async (tx) => {
                const registry = createGovernedActionRegistry({
                    includePhase1Defaults: true,
                    includeRealmsProviderBindingActions: true,
                });
                const gateway = new GovernedActionGateway({
                    registry,
                    resolveBinding: (input) =>
                        resolveActiveCircleGovernanceBinding(tx as any, input),
                    listCommitteeEligibleActors: (input) =>
                        listCommitteeEligibleActors(tx as any, input),
                    requestStore: createPrismaGovernanceRequestStore(tx as any),
                    runtimePrisma: tx as any,
                    runtimeTransactionClient: true,
                });
                return gateway.openDecisionStageRequest({
                    actionType: REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
                    targetCircleId: circleId,
                    targetType: 'circle',
                    targetRef: String(circleId),
                    payload,
                    idempotencyKey: buildRealmsProviderRequestIdempotencyKey({
                        phase: 'binding',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.profileDigest,
                        contractVersion: payload.contractVersion,
                    }),
                    proposerPubkey: actor.pubkey,
                });
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
                request: publicRequest(request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'realms_provider_binding_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/realms/bootstrap-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildRealmsProviderBootstrapPayload(tx as any, { circleId });
                const registry = createGovernedActionRegistry({
                    includePhase1Defaults: true,
                    includeRealmsProviderBindingActions: true,
                });
                const gateway = new GovernedActionGateway({
                    registry,
                    resolveBinding: (input) =>
                        resolveActiveCircleGovernanceBinding(tx as any, input),
                    listCommitteeEligibleActors: (input) =>
                        listCommitteeEligibleActors(tx as any, input),
                    requestStore: createPrismaGovernanceRequestStore(tx as any),
                    runtimePrisma: tx as any,
                    runtimeTransactionClient: true,
                });
                const request = await gateway.openDecisionStageRequest({
                    actionType: REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
                    targetCircleId: circleId,
                    targetType: 'circle',
                    targetRef: String(circleId),
                    payload,
                    idempotencyKey: buildRealmsProviderRequestIdempotencyKey({
                        phase: 'bootstrap',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.profileDigest,
                        contractVersion: payload.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                    proposerPubkey: actor.pubkey,
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
                payerAuthorization: opened.payload.payerAuthorization,
                providerIntent: opened.payload.providerIntent,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'realms_provider_bootstrap_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/realms/delegation-conformance-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildRealmsProviderDelegationConformancePayload(
                    tx as any,
                    { circleId },
                );
                const registry = createGovernedActionRegistry({
                    includePhase1Defaults: true,
                    includeRealmsProviderBindingActions: true,
                });
                const gateway = new GovernedActionGateway({
                    registry,
                    resolveBinding: (input) =>
                        resolveActiveCircleGovernanceBinding(tx as any, input),
                    listCommitteeEligibleActors: (input) =>
                        listCommitteeEligibleActors(tx as any, input),
                    requestStore: createPrismaGovernanceRequestStore(tx as any),
                    runtimePrisma: tx as any,
                    runtimeTransactionClient: true,
                });
                const request = await gateway.openDecisionStageRequest({
                    actionType: REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
                    targetCircleId: circleId,
                    targetType: 'circle',
                    targetRef: String(circleId),
                    payload,
                    idempotencyKey: buildRealmsProviderRequestIdempotencyKey({
                        phase: 'delegation',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.profileTransition.targetDigest,
                        contractVersion: payload.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                    proposerPubkey: actor.pubkey,
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
                providerIntent: opened.payload.providerIntent,
                lifecycle: opened.payload.lifecycle,
                payerAuthorization: opened.payload.payerAuthorization,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'realms_provider_delegation_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/realms/voting-power-challenge-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildRealmsVotingPowerChallengeConformancePayload(
                    tx as any,
                    { circleId },
                );
                const registry = createGovernedActionRegistry({
                    includePhase1Defaults: true,
                    includeRealmsProviderBindingActions: true,
                });
                const gateway = new GovernedActionGateway({
                    registry,
                    resolveBinding: (input) =>
                        resolveActiveCircleGovernanceBinding(tx as any, input),
                    listCommitteeEligibleActors: (input) =>
                        listCommitteeEligibleActors(tx as any, input),
                    requestStore: createPrismaGovernanceRequestStore(tx as any),
                    runtimePrisma: tx as any,
                    runtimeTransactionClient: true,
                });
                const request = await gateway.openDecisionStageRequest({
                    actionType: REALMS_VOTING_POWER_CHALLENGE_CONFORMANCE_ACTION_TYPE,
                    targetCircleId: circleId,
                    targetType: 'circle',
                    targetRef: String(circleId),
                    payload,
                    idempotencyKey: buildRealmsProviderRequestIdempotencyKey({
                        phase: 'challenge',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.frozenSnapshot.votingPowerProfileDigest,
                        contractVersion: payload.resourceBinding.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                    proposerPubkey: actor.pubkey,
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: REALMS_VOTING_POWER_CHALLENGE_CONFORMANCE_ACTION_TYPE,
                challengePolicy: opened.payload.challengePolicy,
                frozenSnapshot: opened.payload.frozenSnapshot,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'realms_voting_power_challenge_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/realms/disable-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildRealmsProviderDisablePayload(tx as any, { circleId });
                const registry = createGovernedActionRegistry({
                    includePhase1Defaults: true,
                    includeRealmsProviderBindingActions: true,
                });
                const gateway = new GovernedActionGateway({
                    registry,
                    resolveBinding: (input) =>
                        resolveActiveCircleGovernanceBinding(tx as any, input),
                    listCommitteeEligibleActors: (input) =>
                        listCommitteeEligibleActors(tx as any, input),
                    requestStore: createPrismaGovernanceRequestStore(tx as any),
                    runtimePrisma: tx as any,
                    runtimeTransactionClient: true,
                });
                const request = await gateway.openDecisionStageRequest({
                    actionType: REALMS_PROVIDER_DISABLE_ACTION_TYPE,
                    targetCircleId: circleId,
                    targetType: 'circle',
                    targetRef: String(circleId),
                    payload,
                    idempotencyKey: buildRealmsProviderRequestIdempotencyKey({
                        phase: 'disable',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.activeLifecycle.decisionDigest,
                        contractVersion: payload.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                    proposerPubkey: actor.pubkey,
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: REALMS_PROVIDER_DISABLE_ACTION_TYPE,
                inFlightDisposition: opened.payload.inFlightDisposition,
                rollbackPolicy: opened.payload.rollbackPolicy,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'realms_provider_disable_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/realms/restore-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildRealmsProviderRestorePayload(tx as any, { circleId });
                const existingAcceptedRequest = await (tx as any).governanceRequest.findFirst({
                    where: {
                        actionType: REALMS_PROVIDER_RESTORE_ACTION_TYPE,
                        targetType: 'circle',
                        targetRef: String(circleId),
                        state: 'accepted',
                        AND: [
                            {
                                payload: {
                                    path: ['disabledBy', 'requestId'],
                                    equals: payload.disabledBy.requestId,
                                },
                            },
                            {
                                payload: {
                                    path: ['disabledBy', 'decisionDigest'],
                                    equals: payload.disabledBy.decisionDigest,
                                },
                            },
                        ],
                    },
                    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
                });
                if (existingAcceptedRequest) {
                    return { payload, request: existingAcceptedRequest };
                }
                const registry = createGovernedActionRegistry({
                    includePhase1Defaults: true,
                    includeRealmsProviderBindingActions: true,
                });
                const gateway = new GovernedActionGateway({
                    registry,
                    resolveBinding: (input) =>
                        resolveActiveCircleGovernanceBinding(tx as any, input),
                    listCommitteeEligibleActors: (input) =>
                        listCommitteeEligibleActors(tx as any, input),
                    requestStore: createPrismaGovernanceRequestStore(tx as any),
                    runtimePrisma: tx as any,
                    runtimeTransactionClient: true,
                });
                const request = await gateway.openDecisionStageRequest({
                    actionType: REALMS_PROVIDER_RESTORE_ACTION_TYPE,
                    targetCircleId: circleId,
                    targetType: 'circle',
                    targetRef: String(circleId),
                    payload,
                    idempotencyKey: buildRealmsProviderRequestIdempotencyKey({
                        phase: 'restore',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: String(payload.disabledBy.decisionDigest),
                        contractVersion: payload.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                    proposerPubkey: actor.pubkey,
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: REALMS_PROVIDER_RESTORE_ACTION_TYPE,
                restorePolicy: opened.payload.restorePolicy,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'realms_provider_restore_request_failed',
            });
        }
    });

    router.get('/circles/:circleId/provider-trust/squads/readback', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const reconciliation = await reconcileSquadsProviderBindingReadback(prisma, {
                circleId,
                allowDisabled: true,
            });
            const [profile, runtimeSigner, grantSettlementResource] = await Promise.all([
                verifySquadsProviderTrustProfileReadback(),
                verifySquadsOpenBaoRuntimeSignerReadback(prisma, { circleId }),
                prisma.governedResourceBinding.findFirst({
                    where: {
                        capability: 'grant_settlement',
                        identityBinding: { homeType: 'circle', homeRef: String(circleId) },
                        status: { in: ['active', 'hold'] },
                    },
                    orderBy: { updatedAt: 'desc' },
                }),
            ]);
            const grantVerification = grantSettlementResource?.verification
                && typeof grantSettlementResource.verification === 'object'
                && !Array.isArray(grantSettlementResource.verification)
                ? grantSettlementResource.verification as Record<string, any>
                : null;
            const grantReceipt = grantVerification?.providerReceipt;
            res.json({ circleId, readback: {
                ...profile,
                runtimeSigner,
                reconciliation,
                grantSettlement: grantSettlementResource ? {
                    state: grantSettlementResource.status,
                    resourceBindingId: grantSettlementResource.id,
                    resourceRef: grantSettlementResource.resourceRef,
                    verifiedSlot: grantSettlementResource.verifiedSlot?.toString() ?? null,
                    stateDigest: grantSettlementResource.stateDigest,
                    providerFinality: grantReceipt?.providerFinality ?? null,
                    payoutSignature: grantReceipt?.payoutSignature ?? null,
                    recipient: grantReceipt?.recipient ?? null,
                    amountLamports: grantReceipt?.amountLamports ?? null,
                    vaultBalanceAfterLamports: grantReceipt?.vaultBalanceAfterLamports ?? null,
                } : null,
            } });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(502).json({
                error: error instanceof Error && error.message.startsWith('squads_')
                    ? error.message
                    : 'squads_provider_trust_readback_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/squads/requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            if (
                req.body?.operation !== undefined
                && req.body.operation !== 'adopt_existing_finalized_no_asset_resource'
            ) {
                throw new Error('squads_provider_binding_operation_invalid');
            }
            const adoption = req.body?.operation === 'adopt_existing_finalized_no_asset_resource';
            if (adoption && req.body?.targetCircleId !== circleId) {
                throw new Error('squads_provider_adoption_circle_scope_mismatch');
            }
            const payload = adoption
                ? buildSquadsProviderAdoptionPayload(req.body)
                : buildSquadsProviderBindingPayload();
            const request = await prisma.$transaction((tx) => openSquadsProviderGovernanceRequest({
                tx,
                circleId,
                actorPubkey: actor.pubkey,
                actionType: SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
                payload,
                idempotencyKey: buildSquadsProviderRequestIdempotencyKey({
                    phase: adoption ? 'adoption' : 'binding',
                    circleId,
                    profileRef: payload.profileRef,
                    profileVersion: payload.profileVersion,
                    profileDigest: payload.profileDigest,
                    contractVersion: payload.contractVersion,
                    resourceRef: adoption ? String((payload.resource as any).multisig) : undefined,
                }),
            }));
            res.status(202).json({
                status: 'requires_governance',
                actionType: SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
                operation: payload.operation,
                request: publicRequest(request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'squads_provider_binding_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/squads/bootstrap-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildSquadsProviderBootstrapPayload(tx as any, { circleId });
                const request = await openSquadsProviderGovernanceRequest({
                    tx,
                    circleId,
                    actorPubkey: actor.pubkey,
                    actionType: SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
                    payload,
                    idempotencyKey: buildSquadsProviderRequestIdempotencyKey({
                        phase: 'bootstrap',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.profileDigest,
                        contractVersion: payload.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
                payerAuthorization: opened.payload.payerAuthorization,
                providerIntent: opened.payload.providerIntent,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'squads_provider_bootstrap_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/squads/disable-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildSquadsProviderDisablePayload(tx as any, { circleId });
                const request = await openSquadsProviderGovernanceRequest({
                    tx,
                    circleId,
                    actorPubkey: actor.pubkey,
                    actionType: SQUADS_PROVIDER_DISABLE_ACTION_TYPE,
                    payload,
                    idempotencyKey: buildSquadsProviderRequestIdempotencyKey({
                        phase: 'disable',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.activeLifecycle.decisionDigest,
                        contractVersion: payload.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: SQUADS_PROVIDER_DISABLE_ACTION_TYPE,
                inFlightDisposition: opened.payload.inFlightDisposition,
                rollbackPolicy: opened.payload.rollbackPolicy,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'squads_provider_disable_request_failed',
            });
        }
    });

    router.post('/circles/:circleId/provider-bindings/squads/restore-requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildSquadsProviderRestorePayload(tx as any, { circleId });
                const request = await openSquadsProviderGovernanceRequest({
                    tx,
                    circleId,
                    actorPubkey: actor.pubkey,
                    actionType: SQUADS_PROVIDER_RESTORE_ACTION_TYPE,
                    payload,
                    idempotencyKey: buildSquadsProviderRequestIdempotencyKey({
                        phase: 'restore',
                        circleId,
                        profileRef: payload.profileRef,
                        profileVersion: payload.profileVersion,
                        profileDigest: payload.disabledBy.decisionDigest,
                        contractVersion: payload.contractVersion,
                        resourceBindingId: payload.resourceBinding.id,
                    }),
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: SQUADS_PROVIDER_RESTORE_ACTION_TYPE,
                restorePolicy: opened.payload.restorePolicy,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'squads_provider_restore_request_failed',
            });
        }
    });

    router.get('/circles/:circleId/committee-profile', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const projection = await resolveGovernanceCircleReadProjection(
                req,
                prisma,
                circleId,
            );
            const profile = await resolveCircleGovernanceCommitteeProfile(prisma as any, {
                circleId,
                now: new Date(),
            });
            res.json({
                projection,
                profile: projectGovernanceCommitteeProfile(profile, projection),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'circle_governance_committee_profile_lookup_failed',
            });
        }
    });

    router.post('/circles/:circleId/committee-profile', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            const availabilityStatus = req.body?.availabilityStatus === 'enabled'
                ? 'enabled'
                : req.body?.availabilityStatus === 'disabled'
                    ? 'disabled'
                    : null;
            if (!circleId || !actorPubkey || !availabilityStatus) {
                res.status(400).json({ error: 'invalid_circle_governance_committee_profile_input' });
                return;
            }
            await requireGovernanceManager(req, circleId, actorPubkey);
            const windowMinutes = req.body?.windowMinutes == null
                ? null
                : Number(req.body.windowMinutes);
            if (req.body?.allowedActionPrefixes != null && !Array.isArray(req.body.allowedActionPrefixes)) {
                res.status(400).json({ error: 'invalid_committee_receive_window_scope' });
                return;
            }
            const allowedActionPrefixes = asOptionalStringArray(req.body?.allowedActionPrefixes);
            const electorateTemplate = req.body?.electorateTemplate ?? null;
            const registry = createGovernedActionRegistry({
                includePhase1Defaults: true,
                includeCircleCommitteeProfileActions: true,
            });
            const gateway = new GovernedActionGateway({
                registry,
                resolveBinding: (input) =>
                    resolveActiveCircleGovernanceBinding(prisma as any, input),
                listCommitteeEligibleActors: (input) =>
                    listCommitteeEligibleActors(prisma as any, input),
                requestStore: createPrismaGovernanceRequestStore(prisma as any),
                runtimePrisma: prisma as any,
            });
            const actionType = 'circle.governance_binding.committee_profile.update';
            const decision = await gateway.evaluate({
                actionType,
                targetCircleId: circleId,
                actorPubkey,
                directAllowed: true,
            });
            if (decision.status === 'denied') {
                res.status(403).json({ error: decision.reason });
                return;
            }
            if (decision.status === 'requires_governance') {
                const requestInput = {
                    actionType,
                    targetCircleId: circleId,
                    targetType: 'circle',
                    targetRef: String(circleId),
                    payload: {
                        availabilityStatus,
                        windowMinutes,
                        allowedActionPrefixes,
                        electorateTemplate,
                        actorPubkey,
                    },
                    idempotencyKey: `circle-committee-profile:${circleId}:${availabilityStatus}:${windowMinutes ?? 'default'}:${stableScopeDigest({ allowedActionPrefixes: allowedActionPrefixes ?? null, electorateTemplate })}`,
                    proposerPubkey: actorPubkey,
                } as const;
                const homes = await prisma.governanceHomeIdentityBinding.findMany({
                    where: {
                        homeType: 'circle',
                        homeRef: String(circleId),
                        supersededAt: null,
                    },
                    include: { activationState: true },
                    orderBy: { identityVersion: 'desc' },
                    take: 2,
                });
                const request = homes.length === 1 && homes[0]?.activationState?.state === 'active'
                    ? await prisma.$transaction(async (tx) => {
                        const transactionGateway = new GovernedActionGateway({
                            registry,
                            resolveBinding: (input) =>
                                resolveActiveCircleGovernanceBinding(tx as any, input),
                            listCommitteeEligibleActors: (input) =>
                                listCommitteeEligibleActors(tx as any, input),
                            requestStore: createPrismaGovernanceRequestStore(tx as any),
                            runtimePrisma: tx as any,
                            runtimeTransactionClient: true,
                        });
                        return transactionGateway.openDecisionStageRequest(requestInput);
                    })
                    : await gateway.openRequest(requestInput);
                res.status(202).json({
                    status: 'requires_governance',
                    actionType,
                    request: publicRequest(request),
                });
                return;
            }
            const profile = await setCircleGovernanceCommitteeAvailability(prisma as any, {
                circleId,
                availabilityStatus,
                actorPubkey,
                windowMinutes,
                allowedActionPrefixes,
                electorateTemplate,
                now: new Date(),
            });
            res.json({
                status: 'executed',
                profile: publicCommitteeProfile(profile),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'circle_governance_committee_profile_update_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/local-auxiliary', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const committeeCircleId = asPositiveInteger(req.body?.committeeCircleId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !committeeCircleId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_circle_governance_binding_input' });
                return;
            }
            await requireGovernanceManager(req, circleId, actorPubkey);
            const actionType = asOptionalString(req.body?.actionType);
            const actionPrefix = asOptionalString(req.body?.actionPrefix);
            const continuityIncident = parseGovernanceContinuityIncidentInput(req.body?.continuityIncident);
            const actionScope = actionType ?? actionPrefix;
            if (!actionScope) {
                res.status(400).json({ error: 'circle_governance_binding_scope_required' });
                return;
            }
            const request = await openGovernanceBindingChangeRequest(prisma as any, {
                bindingType: 'local_auxiliary',
                targetCircleId: circleId,
                committeeCircleId,
                actionType,
                actionPrefix,
                actorPubkey,
                continuityIncident,
            });
            res.status(202).json({
                status: 'requires_governance',
                request: publicRequest(request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
                'circle_governance_binding_replace_authority_unavailable',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'circle_governance_binding_create_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/self-governed', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_circle_governance_binding_input' });
                return;
            }
            const allowedFields = new Set([
                'actorPubkey',
                'actionType',
                'subject',
                'network',
            ]);
            if (Object.keys(req.body ?? {}).some((field) => !allowedFields.has(field))) {
                res.status(400).json({ error: 'self_governed_binding_field_forbidden' });
                return;
            }
            await requireGovernanceManager(req, circleId, actorPubkey);

            const actionType = asRequiredString(req.body?.actionType);
            const subject = normalizeMandateReference(req.body?.subject);
            const network = asRequiredString(req.body?.network);
            if (
                !actionType
                || !subject
                || !network
            ) {
                res.status(400).json({ error: 'self_governed_exact_binding_required' });
                return;
            }
            const definition = getGovernanceCaseActionDefinition(actionType);
            if (!definition || !requiresExactActionAuthorityMaterialization(definition)) {
                res.status(400).json({ error: 'self_governed_exact_action_unsupported' });
                return;
            }
            if (definition.targetType !== subject.type) {
                res.status(400).json({ error: 'self_governed_exact_subject_type_mismatch' });
                return;
            }
            const runtimeNetwork = resolveGovernanceSignalEnvelopeConfig().chainId;
            if (network !== runtimeNetwork) {
                res.status(400).json({ error: 'self_governed_exact_network_mismatch' });
                return;
            }
            // Self-governed exact authorization uses one server-owned, visible preset.
            // UTC-day anchoring keeps retries stable while the accepted Decision remains
            // the only writer that can activate the binding.
            const requestedAt = new Date();
            const effectiveFrom = new Date(Date.UTC(
                requestedAt.getUTCFullYear(),
                requestedAt.getUTCMonth(),
                requestedAt.getUTCDate(),
            ));
            const acceptanceExpiresAt = new Date(
                effectiveFrom.getTime() + 7 * 24 * 60 * 60 * 1000,
            );
            const effectiveUntil = new Date(
                effectiveFrom.getTime() + 30 * 24 * 60 * 60 * 1000,
            );
            const minimumConstraints = normalizeGovernanceMandateMinimumConstraints({
                riskFloor: definition.impact,
                minimumApprovalThreshold: 1,
                minimumTimelockSeconds: 0,
            });
            const request = await openGovernanceBindingChangeRequest(prisma as any, {
                bindingType: 'self_governed',
                purposeBindings: [{
                    purpose: 'collective_decision',
                    actionType,
                    actionPrefix: null,
                }],
                targetCircleId: circleId,
                committeeCircleId: circleId,
                actionType,
                actionPrefix: null,
                actorPubkey,
                effectiveFrom,
                effectiveUntil,
                acceptanceExpiresAt,
                network: runtimeNetwork,
                minimumConstraints,
                subject,
            });
            res.status(202).json({
                status: 'requires_governance',
                request: publicRequest(request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
                'circle_governance_binding_replace_authority_unavailable',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'self_governed_binding_create_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/shared-mandate', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const committeeCircleId = asPositiveInteger(req.body?.committeeCircleId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !committeeCircleId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_circle_governance_binding_input' });
                return;
            }
            const allowedTargetMandateFields = new Set([
                'actorPubkey',
                'committeeCircleId',
                'purposeBindings',
                'actionType',
                'actionPrefix',
                'effectiveFrom',
                'effectiveUntil',
                'acceptanceExpiresAt',
                'minimumConstraints',
                'subject',
                'feePolicy',
                'effectPolicy',
                'operatorPolicyConstraints',
                'crossInstitutionDisclosureImpact',
                'continuityIncident',
            ]);
            if (Object.keys(req.body ?? {}).some((field) => !allowedTargetMandateFields.has(field))) {
                res.status(400).json({
                    error: 'shared_committee_target_electorate_override_forbidden',
                });
                return;
            }
            await requireGovernanceManager(req, circleId, actorPubkey);
            const actionType = asOptionalString(req.body?.actionType);
            const actionPrefix = asOptionalString(req.body?.actionPrefix);
            const purposeBindings = Array.isArray(req.body?.purposeBindings)
                ? req.body.purposeBindings.map((value: any) => ({
                    purpose: value?.purpose === 'collective_decision'
                        || value?.purpose === 'operational_execution'
                        ? value.purpose
                        : null,
                    actionType: asOptionalString(value?.actionType),
                    actionPrefix: asOptionalString(value?.actionPrefix),
                }))
                : [];
            if (purposeBindings.length === 0 || purposeBindings.some((binding: any) => (
                !binding.purpose
                || (binding.actionType === null) === (binding.actionPrefix === null)
            ))) {
                res.status(400).json({ error: 'governance_mandate_purpose_required' });
                return;
            }
            const effectiveFromValue = asRequiredString(req.body?.effectiveFrom);
            const effectiveUntilValue = asRequiredString(req.body?.effectiveUntil);
            const acceptanceExpiresAtValue = asRequiredString(req.body?.acceptanceExpiresAt);
            if (!effectiveFromValue || !effectiveUntilValue || !acceptanceExpiresAtValue) {
                res.status(400).json({ error: 'governance_mandate_effective_window_required' });
                return;
            }
            const effectiveFrom = new Date(effectiveFromValue);
            const effectiveUntil = new Date(effectiveUntilValue);
            const acceptanceExpiresAt = new Date(acceptanceExpiresAtValue);
            const minimumConstraints = normalizeGovernanceMandateMinimumConstraints(
                req.body?.minimumConstraints,
            );
            const subject = normalizeMandateReference(req.body?.subject);
            const feePolicy = normalizeGovernanceMandateFeePolicy(req.body?.feePolicy);
            const effectPolicy = normalizeGovernanceMandateEffectPolicy(
                req.body?.effectPolicy,
                purposeBindings.some((binding: any) => binding.purpose === 'operational_execution'),
                { type: 'circle', ref: String(circleId) },
            );
            const hasOperationalPurpose = purposeBindings.some(
                (binding: any) => binding.purpose === 'operational_execution',
            );
            const operatorPolicyConstraints = hasOperationalPurpose
                ? normalizeGovernanceMandateOperatorPolicyConstraints(
                    req.body?.operatorPolicyConstraints,
                )
                : null;
            if (!hasOperationalPurpose && req.body?.operatorPolicyConstraints != null) {
                res.status(400).json({ error: 'collective_governance_mandate_operator_policy_forbidden' });
                return;
            }
            const continuityIncident = parseGovernanceContinuityIncidentInput(req.body?.continuityIncident);
            if (Number.isNaN(effectiveFrom.getTime()) || Number.isNaN(effectiveUntil.getTime()) || Number.isNaN(acceptanceExpiresAt.getTime())) {
                res.status(400).json({ error: 'governance_mandate_effective_window_invalid' });
                return;
            }
            const actionScope = actionType ?? actionPrefix;
            if (!actionScope) {
                res.status(400).json({ error: 'circle_governance_binding_scope_required' });
                return;
            }
            const targetCircle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: { circleType: true },
            });
            if (!targetCircle) {
                res.status(404).json({ error: 'circle_not_found' });
                return;
            }
            const disclosureEligibleActors = await listCommitteeEligibleActors(prisma as any, {
                committeeCircleId,
            });
            const crossInstitutionDisclosureImpact = buildGovernanceCrossInstitutionDisclosureImpact({
                homeCircleType: String(targetCircle.circleType ?? ''),
                committeeCircleId,
                eligibleActors: disclosureEligibleActors,
                purposeBindings,
                declaration: req.body?.crossInstitutionDisclosureImpact,
            });
            const request = await openGovernanceBindingChangeRequest(prisma as any, {
                bindingType: 'shared_committee',
                purposeBindings,
                targetCircleId: circleId,
                committeeCircleId,
                actionType,
                actionPrefix,
                actorPubkey,
                effectiveFrom,
                effectiveUntil,
                acceptanceExpiresAt,
                network: resolveGovernanceSignalEnvelopeConfig().chainId,
                minimumConstraints,
                subject,
                feePolicy,
                effectPolicy,
                operatorPolicyConstraints,
                crossInstitutionDisclosureImpact,
                continuityIncident,
            });
            res.status(202).json({
                status: 'requires_governance',
                request: publicRequest(request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && [
                'governance_decision_path_required',
                'governance_binding_required',
                'circle_governance_binding_replace_authority_unavailable',
            ].includes(error.message)) {
                res.status(403).json({ error: error.message });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'circle_governance_binding_mandate_create_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-mandates/:mandateId/supersede', async (req, res) => {
        try {
            const targetCircleId = asPositiveInteger(req.params.circleId);
            const mandateId = asRequiredString(req.params.mandateId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            const effectiveUntilValue = asRequiredString(req.body?.effectiveUntil);
            const acceptanceExpiresAtValue = asRequiredString(req.body?.acceptanceExpiresAt);
            const idempotencyKey = asRequiredString(req.body?.idempotencyKey);
            if (
                !targetCircleId
                || !mandateId
                || !actorPubkey
                || !effectiveUntilValue
                || !acceptanceExpiresAtValue
                || !idempotencyKey
            ) {
                res.status(400).json({ error: 'invalid_governance_mandate_supersede_input' });
                return;
            }
            const actor = await requireGovernanceManager(req, targetCircleId, actorPubkey);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId: targetCircleId,
                allowModerator: true,
            });
            const effectiveUntil = new Date(effectiveUntilValue);
            const acceptanceExpiresAt = new Date(acceptanceExpiresAtValue);
            if (Number.isNaN(effectiveUntil.getTime()) || Number.isNaN(acceptanceExpiresAt.getTime())) {
                res.status(400).json({ error: 'governance_mandate_supersede_window_invalid' });
                return;
            }
            const result = await proposeActiveGovernanceMandateSupersede(prisma as any, {
                mandateId,
                targetCircleId,
                actorPubkey,
                actorRole: circleActor.membership.role,
                effectiveUntil,
                acceptanceExpiresAt,
                minimumConstraints: normalizeGovernanceMandateMinimumConstraints(
                    req.body?.minimumConstraints,
                ),
                operatorPolicyConstraints: req.body?.operatorPolicyConstraints == null
                    ? undefined
                    : normalizeGovernanceMandateOperatorPolicyConstraints(
                        req.body.operatorPolicyConstraints,
                    ),
                crossInstitutionDisclosureDeclaration:
                    req.body?.crossInstitutionDisclosureImpact,
                idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                mandateVersion: {
                    version: result.mandateVersion.version,
                    termsDigest: result.mandateVersion.termsDigest,
                    terms: result.mandateVersion.terms,
                },
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseIntakeError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_mandate_supersede_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-mandates/:mandateId/counter', async (req, res) => {
        try {
            const committeeCircleId = asPositiveInteger(req.params.circleId);
            const mandateId = asRequiredString(req.params.mandateId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            const effectiveFromValue = asRequiredString(req.body?.effectiveFrom);
            const effectiveUntilValue = asRequiredString(req.body?.effectiveUntil);
            const acceptanceExpiresAtValue = asRequiredString(req.body?.acceptanceExpiresAt);
            const minimumConstraints = normalizeGovernanceMandateMinimumConstraints(
                req.body?.minimumConstraints,
            );
            if (
                !committeeCircleId
                || !mandateId
                || !actorPubkey
                || !effectiveFromValue
                || !effectiveUntilValue
                || !acceptanceExpiresAtValue
            ) {
                res.status(400).json({ error: 'invalid_governance_mandate_counter_input' });
                return;
            }
            await requireGovernanceManager(req, committeeCircleId, actorPubkey);
            const actionType = asOptionalString(req.body?.actionType);
            const actionPrefix = asOptionalString(req.body?.actionPrefix);
            if (!actionType && !actionPrefix) {
                res.status(400).json({ error: 'circle_governance_binding_scope_required' });
                return;
            }
            const purposeBindings = normalizeMandatePurposeBindingsInput(req.body?.purposeBindings);
            const subject = normalizeMandateReference(req.body?.subject);
            const feePolicy = normalizeGovernanceMandateFeePolicy(req.body?.feePolicy);
            const effectPolicy = (req.body?.effectPolicy ?? null) as GovernanceMandateEffectPolicy | null;
            const hasOperationalPurpose = purposeBindings.some(
                (binding: any) => binding.purpose === 'operational_execution',
            );
            const operatorPolicyConstraints = hasOperationalPurpose
                ? normalizeGovernanceMandateOperatorPolicyConstraints(
                    req.body?.operatorPolicyConstraints,
                )
                : undefined;
            if (!hasOperationalPurpose && req.body?.operatorPolicyConstraints != null) {
                res.status(400).json({ error: 'collective_governance_mandate_operator_policy_forbidden' });
                return;
            }
            const effectiveFrom = new Date(effectiveFromValue);
            const effectiveUntil = new Date(effectiveUntilValue);
            const acceptanceExpiresAt = new Date(acceptanceExpiresAtValue);
            if ([effectiveFrom, effectiveUntil, acceptanceExpiresAt].some((value) => Number.isNaN(value.getTime()))) {
                res.status(400).json({ error: 'governance_mandate_effective_window_invalid' });
                return;
            }
            const result = await counterSharedCommitteeGovernanceMandate(prisma as any, {
                mandateId,
                committeeCircleId,
                actorPubkey,
                actionType,
                actionPrefix,
                effectiveFrom,
                effectiveUntil,
                acceptanceExpiresAt,
                network: resolveGovernanceSignalEnvelopeConfig().chainId,
                minimumConstraints,
                subject,
                purposeBindings,
                feePolicy,
                effectPolicy,
                operatorPolicyConstraints,
                crossInstitutionDisclosureDeclaration:
                    req.body?.crossInstitutionDisclosureImpact,
            });
            res.status(202).json({
                binding: publicBinding(result.binding),
                mandate: publicMandate(result.mandate),
                request: publicRequest(result.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_mandate_counter_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-mandates/:mandateId/acceptance/prepare', async (req, res) => {
        try {
            const targetCircleId = asPositiveInteger(req.params.circleId);
            const mandateId = asRequiredString(req.params.mandateId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!targetCircleId || !mandateId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_governance_mandate_acceptance_input' });
                return;
            }
            await requireGovernanceManager(req, targetCircleId, actorPubkey);
            const mandate = await (prisma as any).governanceMandate.findUnique({
                where: { id: mandateId },
                include: { binding: true },
            });
            if (
                !mandate
                || mandate.delegatorGovernanceHomeType !== 'circle'
                || mandate.delegatorGovernanceHomeRef !== String(targetCircleId)
                || mandate.delegateAuthorityType !== 'circle_governance_committee'
                || !mandate.binding
                || mandate.binding.targetCircleId !== targetCircleId
                || mandate.binding.committeeCircleId !== Number(mandate.delegateAuthorityRef)
                || mandate.status !== 'countered'
                || mandate.targetAuthorizationStatus !== 'pending'
            ) {
                res.status(409).json({ error: 'governance_mandate_counter_acceptance_mismatch' });
                return;
            }
            const config = resolveGovernanceSignalEnvelopeConfig();
            const prepared = prepareGovernanceMandateAcceptance({
                chainId: config.chainId,
                mandateId,
                mandateVersion: mandate.currentVersion,
                mandateTermsDigest: mandate.currentTermsDigest,
                delegatorGovernanceHome: {
                    type: mandate.delegatorGovernanceHomeType,
                    ref: mandate.delegatorGovernanceHomeRef,
                },
                delegateAuthority: {
                    type: mandate.delegateAuthorityType,
                    ref: mandate.delegateAuthorityRef,
                },
                actorPubkey,
                nonce: randomUUID(),
                now: new Date(),
            });
            res.json(prepared);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_mandate_acceptance_prepare_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-mandates/:mandateId/acceptance', async (req, res) => {
        try {
            const targetCircleId = asPositiveInteger(req.params.circleId);
            const mandateId = asRequiredString(req.params.mandateId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            const signedMessage = asRequiredString(req.body?.signedMessage);
            const signature = asRequiredString(req.body?.signature);
            const nonce = asRequiredString(req.body?.nonce);
            const expiresAt = asRequiredString(req.body?.expiresAt);
            const mandateVersion = Number(req.body?.mandateVersion);
            const mandateTermsDigest = asRequiredString(req.body?.mandateTermsDigest);
            if (
                !targetCircleId
                || !mandateId
                || !actorPubkey
                || !signedMessage
                || !signature
                || !nonce
                || !expiresAt
                || !Number.isInteger(mandateVersion)
                || !mandateTermsDigest
            ) {
                res.status(400).json({ error: 'invalid_governance_mandate_acceptance_input' });
                return;
            }
            await requireGovernanceManager(req, targetCircleId, actorPubkey);
            const mandate = await (prisma as any).governanceMandate.findUnique({
                where: { id: mandateId },
                include: { binding: true },
            });
            if (
                !mandate
                || mandate.delegatorGovernanceHomeType !== 'circle'
                || mandate.delegatorGovernanceHomeRef !== String(targetCircleId)
                || mandate.delegateAuthorityType !== 'circle_governance_committee'
                || !mandate.binding
                || mandate.binding.targetCircleId !== targetCircleId
                || mandate.binding.committeeCircleId !== Number(mandate.delegateAuthorityRef)
            ) {
                res.status(404).json({ error: 'governance_mandate_not_found' });
                return;
            }
            const now = new Date();
            const config = resolveGovernanceSignalEnvelopeConfig();
            verifyGovernanceMandateAcceptance({
                chainId: config.chainId,
                mandateId,
                mandateVersion,
                mandateTermsDigest,
                delegatorGovernanceHome: {
                    type: mandate.delegatorGovernanceHomeType,
                    ref: mandate.delegatorGovernanceHomeRef,
                },
                delegateAuthority: {
                    type: mandate.delegateAuthorityType,
                    ref: mandate.delegateAuthorityRef,
                },
                actorPubkey,
                nonce,
                expiresAt,
                signedMessage,
                now,
            });
            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                res.status(401).json({ error: 'invalid_governance_mandate_acceptance_signature' });
                return;
            }
            if (typeof (redis as any)?.set !== 'function') {
                throw new Error('governance_mandate_acceptance_nonce_store_required');
            }
            const nonceStored = await (redis as any).set(
                `governance_mandate_acceptance:${mandateId}:${mandateVersion}:${actorPubkey}:${nonce}`,
                '1',
                'EX',
                600,
                'NX',
            );
            if (nonceStored !== 'OK') {
                res.status(409).json({ error: 'governance_mandate_acceptance_nonce_reused' });
                return;
            }
            const accepted = await acceptGovernanceMandateCounterByTarget(prisma as any, {
                mandateId,
                targetCircleId,
                version: mandateVersion,
                termsDigest: mandateTermsDigest,
                actorPubkey,
                signedMessage,
                signature,
                nonce,
                signatureExpiresAt: new Date(expiresAt),
                now,
            });
            res.json({ mandate: publicMandate(accepted) });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_mandate_acceptance_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/:bindingId/deactivate', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const bindingId = asRequiredString(req.params.bindingId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !bindingId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_circle_governance_binding_deactivate_input' });
                return;
            }
            const actor = await requireGovernanceManager(req, circleId, actorPubkey);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const targetBindings = await listCircleGovernanceBindings(prisma as any, {
                targetCircleId: circleId,
            });
            const requestedBinding = targetBindings.find((binding) => binding.id === bindingId);
            if (!requestedBinding) {
                throw new Error('circle_governance_binding_target_mismatch');
            }
            if (requestedBinding.status !== 'active') {
                throw new Error('circle_governance_binding_not_active');
            }
            const result = await createActiveGovernanceBindingDeactivationCase(prisma as any, {
                targetCircleId: circleId,
                bindingId,
                actorPubkey,
                actorRole: circleActor.membership.role,
                reason: asOptionalString(req.body?.reason),
                idempotencyKey: `circle-governance-binding:deactivate:${bindingId}`,
            });
            res.status(result.replayed ? 200 : 201).json({
                status: 'requires_governance',
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'circle_governance_binding_deactivate_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/:bindingId/recovery-policy', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const bindingId = asRequiredString(req.params.bindingId);
            const recoveryCircleId = asPositiveInteger(req.body?.recoveryCircleId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !bindingId || !recoveryCircleId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_governance_recovery_policy_input' });
                return;
            }
            const actor = await requireGovernanceManager(req, circleId, actorPubkey);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await openGovernanceRecoveryPolicyCase(prisma as any, {
                circleId,
                bindingId,
                recoveryCircleId,
                actorPubkey,
                actorRole: circleActor.membership.role,
                idempotencyKey: `governance-recovery-policy:${bindingId}:${recoveryCircleId}`,
            });
            res.status(result.replayed ? 200 : 201).json({
                status: 'requires_governance',
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_recovery_policy_create_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/:bindingId/authority-health/cases', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const bindingId = asRequiredString(req.params.bindingId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !bindingId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_governance_authority_health_input' });
                return;
            }
            const actor = await requireGovernanceManager(req, circleId, actorPubkey);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await openGovernanceAuthorityHealthCase(prisma as any, {
                circleId,
                bindingId,
                actorPubkey,
                actorRole: circleActor.membership.role,
                faultAssessment: req.body?.faultAssessment ?? null,
                idempotencyKey: `governance-authority-health:${bindingId}:${req.body?.faultAssessment?.faultClass ?? 'routine'}:${Math.floor(Date.now() / 300_000)}`,
            });
            res.status(result.replayed ? 200 : 201).json({
                status: 'requires_governance',
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_authority_health_case_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/:bindingId/authority-health/applications', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const bindingId = asRequiredString(req.params.bindingId);
            const requestId = asRequiredString(req.body?.requestId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !bindingId || !requestId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_governance_authority_health_application_input' });
                return;
            }
            const actor = await requireGovernanceManager(req, circleId, actorPubkey);
            await requireCircleManagerForActor(prisma, { actor, circleId, allowModerator: true });
            const authorityHealth = await applyAcceptedGovernanceAuthorityHealth(prisma as any, {
                requestId,
                bindingId,
                actorPubkey,
            });
            res.json({ status: authorityHealth.status, authorityHealth });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_authority_health_application_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/:bindingId/authority-continuity/permanent-block', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const bindingId = asRequiredString(req.params.bindingId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !bindingId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_governance_authority_continuity_input' });
                return;
            }
            const actor = await requireGovernanceManager(req, circleId, actorPubkey);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const authorityContinuity = await terminalizeGovernanceAuthorityContinuity(prisma as any, {
                bindingId,
                targetCircleId: circleId,
                actorPubkey,
                actorRole: circleActor.membership.role,
                now: new Date(),
            });
            res.json({
                status: authorityContinuity.status,
                authorityContinuity,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_authority_continuity_terminalization_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-bindings/:bindingId/policy-version', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            const bindingId = asRequiredString(req.params.bindingId);
            const actorPubkey = asOptionalString(req.body?.actorPubkey);
            if (!circleId || !bindingId || !actorPubkey) {
                res.status(400).json({ error: 'invalid_governance_policy_version_update_input' });
                return;
            }
            const actor = await requireGovernanceManager(req, circleId, actorPubkey);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const rollbackFromCaseId = asOptionalString(req.body?.rollbackFromCaseId);
            const targetCommitteeCircleId = req.body?.targetCommitteeCircleId == null
                ? null
                : asPositiveInteger(req.body.targetCommitteeCircleId);
            if (rollbackFromCaseId && req.body?.electorateTemplate != null) {
                res.status(400).json({ error: 'governance_configuration_rollback_input_ambiguous' });
                return;
            }
            const inputDigest = createHash('sha256')
                .update(stableJsonStringify(rollbackFromCaseId
                    ? { rollbackFromCaseId }
                    : {
                        electorateTemplate: req.body?.electorateTemplate ?? null,
                        targetCommitteeCircleId,
                    }))
                .digest('hex');
            const result = await openGovernancePolicyConfigurationTransitionCase(prisma as any, {
                circleId,
                bindingId,
                actorPubkey,
                actorRole: circleActor.membership.role,
                electorateTemplate: req.body?.electorateTemplate,
                targetCommitteeCircleId,
                rollbackFromCaseId,
                idempotencyKey: `governance-config-transition:${bindingId}:${inputDigest.slice(0, 40)}`,
            });
            if (result.status === 'manual_recovery_pending') {
                res.status(202).json({
                    status: result.status,
                    authorityContinuity: result.authorityContinuity,
                });
                return;
            }
            const governanceCase = projectGovernanceCase(result.governanceCase, null, {
                includePrivateOriginRefs: true,
                workflowAudience: 'operator',
            });
            res.status(result.replayed ? 200 : 201).json({
                status: 'requires_governance',
                case: governanceCase,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_policy_version_update_failed',
            });
        }
    });

    router.get('/circles/:circleId/runtime-metrics', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            res.json({
                circleId,
                metrics: await readGovernanceRuntimeMetrics(),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(503).json({
                error: 'governance_runtime_metrics_unavailable',
            });
        }
    });

    router.get('/circles/:circleId/action-routing', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const routing = await resolveGovernedActionRoutingReadback(prisma, {
                circleId,
            });
            res.json({ routing });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(409).json({
                error: error instanceof Error
                    ? error.message
                    : 'governed_action_routing_readback_failed',
            });
        }
    });

    router.get('/circles/:circleId/operations/:receiptId', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const now = new Date();
            const operationActorFacts = await governedOperationActorFactsForActor(
                prisma,
                actor.userId,
                now,
            );
            let readScopes: GovernedActionOperationReadScope[];
            try {
                await requireCircleManagerForActor(prisma, {
                    actor,
                    circleId,
                    allowModerator: true,
                });
                readScopes = [{
                    role: 'governance_home_manager', targetCircleId: circleId,
                    committeeCircleId: null, domainBindingId: null, mandateId: null,
                    mandateSourceVersion: null, policyId: null,
                    policyVersionId: null, policyVersion: null,
                }];
            } catch (error) {
                if (!(error instanceof AuthActorError)
                    || !['circle_membership_required', 'circle_role_required'].includes(error.code)) {
                    throw error;
                }
                readScopes = operationActorFacts.readScopes;
            }
            const operation = await resolveGovernedActionOperationDetailReadback(prisma, {
                circleId,
                receiptId: String(req.params.receiptId || ''),
                viewerPubkey: actor.pubkey,
                readScopes,
                independentAppealReviewerCircleIds:
                    operationActorFacts.independentAppealReviewerCircleIds,
                now,
            });
            res.json({ operation });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            const code = error instanceof Error
                ? error.message
                : 'governed_action_operation_detail_failed';
            res.status(code === 'governed_action_operation_detail_missing' ? 404 : 409).json({
                error: code,
            });
        }
    });

    router.get('/circles/:circleId/requests', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const projection = await resolveGovernanceCircleReadProjection(
                req,
                prisma,
                circleId,
            );
            const view = String(req.query?.view || 'target').trim() === 'committee'
                ? 'committee'
                : 'target';
            const targetTypeFilter = asOptionalString(req.query?.targetType);
            const actionTypeFilter = asOptionalString(req.query?.actionType);
            const stateFilter = asOptionalString(req.query?.state);
            let canReviewSourceMaterials = false;
            if (view === 'target' && targetTypeFilter === 'source_material') {
                const actor = await requireGovernanceActor(req);
                await requireSourceMaterialAccessForActor(prisma, { actor, circleId });
                canReviewSourceMaterials = await canReviewSourceMaterialsForActor(actor, circleId);
            }
            const requests = await (prisma as any).governanceRequest.findMany({
                where: view === 'committee'
                    ? {
                        scopeType: 'circle_governance_committee',
                        scopeRef: String(circleId),
                    }
                    : targetTypeFilter === 'source_material'
                        ? {
                            targetType: 'source_material',
                            ...(actionTypeFilter ? { actionType: actionTypeFilter } : {}),
                            ...(stateFilter ? { state: stateFilter } : {}),
                            payload: { path: ['targetCircleId'], equals: circleId },
                        }
                    : {
                        OR: [
                            { scopeType: 'circle', scopeRef: String(circleId) },
                            { targetType: 'circle', targetRef: String(circleId) },
                        ],
                        ...(actionTypeFilter ? { actionType: actionTypeFilter } : {}),
                        ...(stateFilter ? { state: stateFilter } : {}),
                    },
                orderBy: [{ openedAt: 'desc' }],
                take: 100,
                include: {
                    decision: {
                        select: {
                            decision: true,
                            reason: true,
                            decisionDigest: true,
                        },
                    },
                    receipts: {
                        select: {
                            executionStatus: true,
                            executedAt: true,
                        },
                        orderBy: { executedAt: 'asc' },
                    },
                },
            });
            const visibleRequests = view === 'target' && targetTypeFilter === 'source_material'
                ? await filterSourceMaterialRequestsForViewer(prisma, {
                    circleId,
                    requests: requests ?? [],
                    canReview: canReviewSourceMaterials,
                    canViewReviewQueue: true,
                })
                : requests ?? [];
            res.json({
                circleId,
                view,
                projection,
                requests: visibleRequests.map((request: any) =>
                    projectGovernanceRequest(request, projection, {
                        executionCompatibility: governanceExecutionCompatibility(request),
                    }).request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_requests_lookup_failed',
            });
        }
    });

    router.get('/circles/:circleId/case-templates', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, { actor, circleId, allowModerator: true });
            if (!isGovernanceCaseType(req.query.caseType)) {
                res.status(400).json({ error: 'governance_case_type_invalid' });
                return;
            }
            const homes = await prisma.governanceHomeIdentityBinding.findMany({
                where: { homeType: 'circle', homeRef: String(circleId), supersededAt: null },
                orderBy: { identityVersion: 'desc' },
                take: 2,
            });
            if (homes.length !== 1) {
                res.status(409).json({
                    error: homes.length === 0
                        ? 'governance_case_home_required'
                        : 'governance_case_home_ambiguous',
                });
                return;
            }
            const catalog = await resolveGovernanceCaseTemplateCatalog(prisma, {
                homeIdentityBindingId: homes[0].id,
                homeType: homes[0].homeType,
                homeRef: homes[0].homeRef,
                caseType: req.query.caseType,
            });
            res.json({ circleId, ...catalog });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_templates_lookup_failed',
            });
        }
    });

    router.post('/circles/:circleId/governance-profile/transitions', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleActor = await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'circle.owner',
                minRole: 'Owner',
            });
            const operation = asOptionalString(req.body?.operation);
            if (operation !== 'upgrade' && operation !== 'rollback') {
                res.status(400).json({ error: 'governance_profile_operation_invalid' });
                return;
            }
            const result = await openCircleGovernanceProfileTransitionRequest(prisma, {
                circleId,
                operation,
                actorPubkey: actor.pubkey,
                actorRole: circleActor.membership.role,
                reasonCode: req.body?.reasonCode,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(202).json({
                circleId,
                caseId: result.caseId,
                requestId: result.request.id,
                requestState: result.request.state,
                transition: result.transition,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceProfileTransitionExecutionError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_profile_transition_request_failed',
            });
        }
    });

    router.get('/circles/:circleId/governance-profile', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'circle.owner',
                minRole: 'Owner',
            });
            res.json(await readCircleGovernanceProfileTransitionState(prisma, { circleId }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceProfileTransitionExecutionError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_profile_readback_failed',
            });
        }
    });

    router.get('/circles/:circleId/provider-admission/candidates', async (req, res) => {
        try {
            if (sendPrivateSidecarRequired(res)) return;
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            if (!isExternalActionCandidatePickerEnabled()) {
                res.status(404).json({ error: 'provider_admission_candidate_picker_disabled' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const client = createStorageFabricProviderAdmissionCandidateClientFromRuntime({
                runtimeRole: loadNodeRuntimeConfig().runtimeRole,
            });
            if (!client) {
                res.status(503).json({ error: 'provider_admission_candidate_unavailable' });
                return;
            }
            const status = asOptionalString(req.query?.status) as
                | 'eligible'
                | 'ineligible'
                | 'retired'
                | 'already_admitted'
                | undefined;
            const page = await client.listCandidates({
                cursor: asOptionalString(req.query?.cursor) ?? undefined,
                limit: asPositiveInteger(req.query?.limit) ?? undefined,
                status,
            });
            res.status(200).json({
                candidatePickerEnabled: true,
                items: page.items,
                nextCursor: page.nextCursor,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof ProviderAdmissionCandidateClientError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(503).json({ error: 'provider_admission_candidate_unavailable' });
        }
    });

    router.get(
        '/circles/:circleId/provider-admission/candidates/:candidateRef/snapshot',
        async (req, res) => {
            try {
                if (sendPrivateSidecarRequired(res)) return;
                const circleId = asPositiveInteger(req.params.circleId);
                if (!circleId) {
                    res.status(400).json({ error: 'invalid_circle_id' });
                    return;
                }
                if (!isExternalActionCandidatePickerEnabled()) {
                    res.status(404).json({ error: 'provider_admission_candidate_picker_disabled' });
                    return;
                }
                const actor = await requireGovernanceActor(req);
                await requireCircleManagerForActor(prisma, {
                    actor,
                    circleId,
                    allowModerator: true,
                });
                const client = createStorageFabricProviderAdmissionCandidateClientFromRuntime({
                    runtimeRole: loadNodeRuntimeConfig().runtimeRole,
                });
                if (!client) {
                    res.status(503).json({ error: 'provider_admission_candidate_unavailable' });
                    return;
                }
                const snapshot = await client.getSnapshot(String(req.params.candidateRef || ''));
                res.status(200).json({
                    candidateRef: snapshot.candidateRef,
                    displayName: snapshot.displayName,
                    statusSummary: snapshot.statusSummary,
                    capacitySummary: snapshot.capacitySummary,
                    policySummary: snapshot.policySummary,
                    snapshotVersion: snapshot.snapshotVersion,
                    snapshotDigest: snapshot.snapshotDigest,
                    expiresAt: snapshot.expiresAt,
                });
            } catch (error) {
                if (sendAuthActorError(res, error)) return;
                if (error instanceof ProviderAdmissionCandidateClientError) {
                    res.status(error.statusCode).json({ error: error.code });
                    return;
                }
                res.status(503).json({ error: 'provider_admission_candidate_unavailable' });
            }
        },
    );

    router.post('/circles/:circleId/cases', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actionTypeForGate = asOptionalString(req.body?.actionType);
            if (
                actionTypeForGate === 'storage_fabric.authorize_provider_admission'
                && isExternalActionCandidatePickerEnabled()
                && sendPrivateSidecarRequired(res)
            ) {
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const originKind = asOptionalString(req.body?.originKind);
            if (!isGovernanceCaseIntakeOriginKind(originKind)) {
                res.status(400).json({ error: 'governance_case_origin_invalid' });
                return;
            }
            if (!isGovernanceCaseType(req.body?.caseType)) {
                res.status(400).json({ error: 'governance_case_type_invalid' });
                return;
            }
            const result = await createGovernanceCaseIntake(prisma, {
                circleId,
                title: req.body?.title,
                requestedDecision: req.body?.requestedDecision,
                requestedActionPayload: asOptionalRecord(req.body?.requestedActionPayload),
                statePrecondition: asOptionalRecord(req.body?.statePrecondition),
                candidateRef: asOptionalString(req.body?.candidateRef),
                expectedSnapshotVersion: asOptionalString(req.body?.expectedSnapshotVersion),
                expectedSnapshotDigest: asOptionalString(req.body?.expectedSnapshotDigest),
                rationale: asOptionalString(req.body?.rationale),
                caseType: req.body.caseType,
                templateId: req.body?.templateId,
                actionType: asOptionalString(req.body?.actionType),
                subjectType: asOptionalString(req.body?.subjectType) as
                    | 'circle'
                    | 'circle_governance_binding'
                    | 'communication_room_member'
                    | 'feed_post'
                    | 'governed_operator_capability'
                    | 'external_provider'
                    | 'external_app_circle_binding'
                    | undefined,
                subjectRef: asOptionalString(req.body?.subjectRef),
                decisionMechanismKind: asOptionalString(req.body?.decisionMechanismKind) as
                    | 'equal_weight_threshold'
                    | 'quadratic_voice_credits'
                    | 'quadratic_funding'
                    | null,
                quadraticVoiceChoices: req.body?.quadraticVoiceChoices,
                quadraticFundingRound: req.body?.quadraticFundingRound,
                selectionRanking: req.body?.selectionRanking,
                originKind,
                sourceMessageIds: Array.isArray(req.body?.sourceMessageIds)
                    ? req.body.sourceMessageIds
                    : [],
                sourceUrl: req.body?.sourceUrl,
                relationshipKind: asOptionalString(req.body?.relationshipKind) as 'related' | 'supersedes' | null,
                relatedCaseId: asOptionalString(req.body?.relatedCaseId),
                relationshipReason: asOptionalString(req.body?.relationshipReason),
                idempotencyKey: req.body?.idempotencyKey,
                openedByPubkey: actor.pubkey,
                actorRole: circleActor.membership.role,
            });
            const projectedCase = projectGovernanceCase(
                result.governanceCase,
                null,
                {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                },
            );
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                case: projectedCase,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseIntakeError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_intake_failed',
            });
        }
    });

    router.post('/circles/:circleId/cases/preflight', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const originKind = asOptionalString(req.body?.originKind);
            if (!isGovernanceCaseIntakeOriginKind(originKind)) {
                res.status(400).json({ error: 'governance_case_origin_invalid' });
                return;
            }
            const suggestions = await findGovernanceCaseIntakeSuggestions(prisma, {
                circleId,
                title: req.body?.title,
                originKind,
                sourceMessageIds: Array.isArray(req.body?.sourceMessageIds)
                    ? req.body.sourceMessageIds
                    : undefined,
                sourceUrl: req.body?.sourceUrl,
            });
            res.json({ circleId, suggestions });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseIntakeError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_preflight_failed',
            });
        }
    });

    router.get('/circles/:circleId/cases', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                res.status(400).json({ error: 'invalid_circle_id' });
                return;
            }
            const projection = await resolveGovernanceCircleReadProjection(
                req,
                prisma,
                circleId,
            );
            const searchInput = parseCircleGovernanceSearch(
                req.query as Record<string, unknown> | undefined,
            );
            const cases = await prisma.governanceCase.findMany({
                where: {
                    homeIdentityBinding: {
                        homeType: 'circle',
                        homeRef: String(circleId),
                    },
                },
                include: {
                    blockers: { orderBy: [{ openedAt: 'asc' }, { id: 'asc' }] },
                    homeIdentityBinding: {
                        select: {
                            homeType: true,
                            homeRef: true,
                            activationState: { select: { state: true } },
                        },
                    },
                    primaryRequest: {
                        include: {
                            decision: true,
                            receipts: { orderBy: { executedAt: 'asc' } },
                        },
                    },
                },
                orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
                take: 100,
            });
            const caseProjections = cases.map((governanceCase) => {
                const projected = governanceCase.primaryRequest
                    ? projectGovernanceRequest(
                        governanceCase.primaryRequest,
                        projection,
                        {
                            executionCompatibility: governanceExecutionCompatibility(
                                governanceCase.primaryRequest,
                            ),
                        },
                    )
                    : null;
                return projectGovernanceCase(
                    governanceCase,
                    projected?.request ?? null,
                    {
                        includePrivateOriginRefs: projection.audience !== 'public',
                        workflowAudience: projection.audience,
                    },
                );
            });
            const searchResult = projectCircleGovernanceSearch(caseProjections, searchInput);
            res.json({
                circleId,
                projection,
                cases: searchResult.cases,
                search: searchResult.search,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_cases_lookup_failed',
            });
        }
    });

    router.get('/cases/inbox', async (req, res) => {
        try {
            const actor = await requireGovernanceActor(req);
            const now = new Date();
            const filters = parseGovernanceOperationalInboxFilters(
                req.query as Record<string, unknown> | undefined,
            );
            const memberships = await prisma.circleMember.findMany({
                where: {
                    userId: actor.userId,
                    status: 'Active',
                },
                select: { circleId: true, role: true },
                orderBy: { circleId: 'asc' },
            });
            const homeRefs = memberships.map((item) => String(item.circleId));
            const circleIds = memberships.map((item) => item.circleId);
            const independentReviewerCandidateIds = memberships
                .filter((membership) => ['owner', 'admin'].includes(
                    String(membership.role || '').toLowerCase(),
                ))
                .map((membership) => membership.circleId);
            const [cases, delegatedBindings, systemRoleBindings] = await Promise.all([
                prisma.governanceCase.findMany({
                    where: {
                        OR: [
                            { openedByPubkey: actor.pubkey },
                            {
                                homeIdentityBinding: {
                                    homeType: 'circle',
                                    homeRef: { in: homeRefs },
                                },
                            },
                            {
                                primaryRequest: {
                                    scopeType: {
                                        in: [
                                            'circle_governance_committee',
                                            'external_app_review_circle',
                                        ],
                                    },
                                    scopeRef: { in: homeRefs },
                                },
                            },
                            {
                                requestedActionPayload: {
                                    path: ['targetPubkey'],
                                    equals: actor.pubkey,
                                },
                            },
                            {
                                responsibilities: {
                                    some: {
                                        assigneePubkey: actor.pubkey,
                                        status: { in: ['assigned', 'accepted'] },
                                    },
                                },
                            },
                        ],
                    },
                    include: {
                        blockers: { orderBy: [{ openedAt: 'asc' }, { id: 'asc' }] },
                        homeIdentityBinding: {
                            select: { homeType: true, homeRef: true },
                        },
                        primaryRequest: {
                            include: {
                                policyVersionRecord: {
                                    select: { rules: true, configDigest: true },
                                },
                                snapshot: true,
                                signals: { orderBy: { createdAt: 'asc' } },
                                decision: true,
                                receipts: { orderBy: { executedAt: 'asc' } },
                                invocation: {
                                    include: {
                                        contractVersion: true,
                                        profileBinding: { include: { definitionVersion: true } },
                                        authoritySnapshot: { include: { binding: true } },
                                        costPreflights: {
                                            orderBy: { checkedAt: 'desc' },
                                            take: 1,
                                            include: { payerPolicy: true },
                                        },
                                    },
                                },
                            },
                        },
                        responsibilities: { orderBy: { kind: 'asc' } },
                        actionContractVersion: true,
                        manualExecutionCompletion: { include: { receipt: true } },
                        decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
                        timelineEvents: {
                            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                            take: 1,
                        },
                        readCursors: {
                            where: { userId: actor.userId },
                            take: 1,
                        },
                    },
                    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                    take: 200,
                }),
                prisma.circleGovernanceBinding.findMany({
                    where: {
                        committeeCircleId: { in: circleIds },
                        mandateId: { not: null },
                    },
                    include: {
                        mandate: {
                            include: {
                                versions: { orderBy: { version: 'desc' } },
                            },
                        },
                    },
                    orderBy: [
                        { committeeCircleId: 'asc' },
                        { status: 'asc' },
                        { activatedAt: 'desc' },
                        { id: 'desc' },
                    ],
                }),
                prisma.systemGovernanceRoleBinding.findMany({
                    where: {
                        domain: 'external_app',
                        roleKey: { in: [...EXTERNAL_APP_GOVERNANCE_ROLE_KEYS] },
                        environment: { in: ['sandbox', 'production'] },
                        status: 'active',
                        circleId: { in: circleIds },
                    },
                    select: {
                        id: true,
                        domain: true,
                        roleKey: true,
                        environment: true,
                        circleId: true,
                        policyId: true,
                        policyVersionId: true,
                        policyVersion: true,
                        activatedAt: true,
                        sourceRequestId: true,
                        sourceDecisionDigest: true,
                        sourceExecutionReceiptId: true,
                    },
                    orderBy: [
                        { environment: 'asc' },
                        { roleKey: 'asc' },
                        { activatedAt: 'desc' },
                    ],
                }),
            ]);
            const evidenceReviewCaseIds = cases
                .filter((governanceCase) => governanceCase.casePhase === 'evidence_review')
                .map((governanceCase) => governanceCase.id);
            const reviewWorkflowEvents = evidenceReviewCaseIds.length > 0
                ? await prisma.governanceCaseTimelineEvent.findMany({
                    where: {
                        caseId: { in: evidenceReviewCaseIds },
                        eventType: {
                            in: ['review_conclusion_recorded', 'review_relationship_declared'],
                        },
                    },
                    select: {
                        caseId: true,
                        eventType: true,
                        actorPubkey: true,
                        fromState: true,
                        toState: true,
                        caseVersion: true,
                        responsibilityVersion: true,
                        briefDraftPostId: true,
                        briefDraftVersion: true,
                        briefSnapshotDigest: true,
                    },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                })
                : [];
            const reviewWorkflowByCaseId = new Map<string, any[]>();
            for (const event of reviewWorkflowEvents) {
                const current = reviewWorkflowByCaseId.get(event.caseId) ?? [];
                current.push(event);
                reviewWorkflowByCaseId.set(event.caseId, current);
            }
            const independentAppealReviewerCircleIds = independentReviewerCandidateIds.length === 0
                ? []
                : (await prisma.circle.findMany({
                    where: {
                        id: { in: independentReviewerCandidateIds },
                        onChainAddress: { not: '' },
                    },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                })).map((circle) => circle.id);
            const primaryRequests = cases.flatMap((governanceCase) => (
                governanceCase.primaryRequest ? [governanceCase.primaryRequest] : []
            ));
            const primaryRequestIds = primaryRequests.map((request) => request.id);
            const explicitProviderResourceBindingIds = primaryRequests.flatMap((request) => {
                const bindingId = providerResourceBindingIdFromRequest(request);
                return bindingId ? [bindingId] : [];
            });
            const providerResourceBindings = await prisma.governedResourceBinding.findMany({
                where: {
                    OR: [
                        { sourceRequestId: { in: primaryRequestIds } },
                        { id: { in: explicitProviderResourceBindingIds } },
                    ],
                },
                include: {
                    authorityBindings: { orderBy: { authorityRole: 'asc' } },
                },
                orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            });
            const providerResourceBindingBySourceRequestId = new Map(
                providerResourceBindings.map((binding) => [binding.sourceRequestId, binding]),
            );
            const providerResourceBindingById = new Map(
                providerResourceBindings.map((binding) => [binding.id, binding]),
            );
            const providerResourceBindingForRequest = (request: any) => {
                const explicitId = providerResourceBindingIdFromRequest(request);
                return providerResourceBindingBySourceRequestId.get(request.id)
                    ?? (explicitId ? providerResourceBindingById.get(explicitId) : null)
                    ?? null;
            };
            const providerExecutionByRequestId = new Map(
                cases.flatMap((governanceCase) => {
                    if (!governanceCase.primaryRequest) return [];
                    return [[
                        governanceCase.primaryRequest.id,
                        projectGovernanceProviderExecutionReadback({
                            ...governanceCase.primaryRequest,
                            decisionOutputArtifacts: governanceCase.decisionOutputArtifacts,
                            providerResourceBinding: providerResourceBindingForRequest(
                                governanceCase.primaryRequest,
                            ),
                        }),
                    ] as const];
                }),
            );
            const providerProgramIds = [...new Set(
                [...providerExecutionByRequestId.values()].flatMap((execution: any) => {
                    const programId = String(execution?.provider?.trustProfile?.programId ?? '').trim();
                    return programId ? [programId] : [];
                }),
            )];
            const indexerObservationByProgramId =
                await loadGovernanceProviderIndexerObservations(prisma, providerProgramIds);
            assertUniqueActiveSystemGovernanceRoleBindings(systemRoleBindings as any);
            const managerRoles = new Set(['owner', 'admin', 'moderator']);
            const managerDuties = memberships
                .filter((membership) => managerRoles.has(String(membership.role || '').toLowerCase()))
                .map((membership) => ({
                    id: `governance-home-manager:${membership.circleId}`,
                    kind: 'governance_home_settings' as const,
                    role: 'governance_home_manager' as const,
                    circleId: membership.circleId,
                    task: {
                        primaryAction: 'open_institutional_settings' as const,
                        status: 'available' as const,
                        deadline: null,
                        disabledReason: null,
                        canonicalUrl: `/circles/${membership.circleId}?tab=governance&settings=governance`,
                    },
                    mandate: null,
                    systemRole: null,
                }));
            const delegatedDuties = delegatedBindings.flatMap((binding: any) => {
                if (!binding.mandate) return [];
                const mandateVersion = Array.isArray(binding.mandate.versions)
                    ? binding.mandate.versions.find(
                        (version: any) => version?.version === binding.mandate.currentVersion,
                    ) ?? null
                    : null;
                const health = projectGovernanceMandateHealth(binding, mandateVersion, now);
                return [{
                    id: `delegated-authority:${binding.id}`,
                    kind: 'governance_mandate' as const,
                    role: 'delegated_authority_participant' as const,
                    circleId: binding.committeeCircleId,
                    task: {
                        primaryAction: 'view_mandate' as const,
                        status: health.status === 'suspended' || health.status === 'unavailable'
                            ? 'blocked' as const
                            : health.status === 'inactive'
                                ? 'completed' as const
                                : 'available' as const,
                        deadline: health.effectiveUntil,
                        disabledReason: health.status === 'suspended' || health.status === 'unavailable'
                            ? health.reason
                            : null,
                        canonicalUrl: `/circles/${binding.committeeCircleId}?tab=governance#governance-mandates`,
                    },
                    mandate: {
                        id: binding.mandate.id,
                        bindingId: binding.id,
                        direction: 'received' as const,
                        targetCircleId: binding.targetCircleId,
                        committeeCircleId: binding.committeeCircleId,
                        health,
                    },
                    systemRole: null,
                }];
            });
            const systemDuties = systemRoleBindings.map((binding) => {
                const provenanceComplete = Boolean(
                    binding.sourceRequestId
                    && binding.sourceDecisionDigest
                    && binding.sourceExecutionReceiptId,
                );
                return {
                    id: `system-authority:${binding.id}`,
                    kind: 'system_governance_role' as const,
                    role: 'system_authority_participant' as const,
                    circleId: binding.circleId,
                    task: {
                        primaryAction: 'view_system_duty' as const,
                        status: provenanceComplete ? 'available' as const : 'blocked' as const,
                        deadline: null,
                        disabledReason: provenanceComplete ? null : 'governance_provenance_incomplete',
                        canonicalUrl: `/circles/${binding.circleId}?tab=governance`,
                    },
                    mandate: null,
                    systemRole: {
                        bindingId: binding.id,
                        domain: 'external_app' as const,
                        roleKey: binding.roleKey,
                        environment: binding.environment,
                        policy: {
                            id: binding.policyId,
                            versionId: binding.policyVersionId,
                            version: binding.policyVersion,
                        },
                        activatedAt: binding.activatedAt.toISOString(),
                        provenance: {
                            requestId: binding.sourceRequestId,
                            decisionDigest: binding.sourceDecisionDigest,
                            executionReceiptId: binding.sourceExecutionReceiptId,
                            status: provenanceComplete ? 'complete' as const : 'incomplete' as const,
                        },
                    },
                };
            });
            const institutionalDuties = [
                ...managerDuties,
                ...delegatedDuties,
                ...systemDuties,
            ];
            const operationScopes = governedOperationReadScopes(
                memberships as any,
                delegatedBindings,
                now,
            );
            const operations = await resolveGovernedActionOperationInboxReadback(prisma, {
                actorPubkey: actor.pubkey,
                scopes: operationScopes,
                independentAppealReviewerCircleIds,
                now,
            });
            const caseEntries = cases.flatMap((governanceCase) => {
                const primaryRequestWithProviderBinding = governanceCase.primaryRequest
                    ? {
                        ...governanceCase.primaryRequest,
                        decisionOutputArtifacts: governanceCase.decisionOutputArtifacts,
                        providerResourceBinding: providerResourceBindingForRequest(
                            governanceCase.primaryRequest,
                        ),
                    }
                    : null;
                const providerExecution = governanceCase.primaryRequest
                    ? providerExecutionByRequestId.get(governanceCase.primaryRequest.id) ?? null
                    : null;
                const providerProgramId = String(
                    (providerExecution as any)?.provider?.trustProfile?.programId ?? '',
                ).trim();
                const baseTask = projectGovernanceCaseInboxTask(
                    {
                        ...governanceCase,
                        reviewWorkflowEvents: reviewWorkflowByCaseId.get(governanceCase.id) ?? [],
                    },
                    actor.pubkey,
                    providerExecution,
                    providerProgramId
                        ? indexerObservationByProgramId.get(providerProgramId) ?? null
                        : null,
                );
                if (!baseTask) return [];
                const task = {
                    ...baseTask,
                    executionProgress: governanceCase.primaryRequest
                        ? projectGovernanceProviderExecutionProgressReadback(
                            governanceCase.primaryRequest,
                        )
                        : null,
                    automaticExecutionAvailability: primaryRequestWithProviderBinding
                        ? projectGovernanceAutomaticExecutionAvailabilityReadback(
                            primaryRequestWithProviderBinding,
                        )
                        : null,
                    executionPreview: primaryRequestWithProviderBinding
                        ? projectGovernanceProviderExecutionPreviewReadback(
                            primaryRequestWithProviderBinding,
                        )
                        : null,
                    executionAuthorityPreflight: primaryRequestWithProviderBinding
                        ? projectGovernanceProviderExecutionAuthorityPreflightReadback(
                            primaryRequestWithProviderBinding,
                        )
                        : null,
                    resourceExecutionAdmission: primaryRequestWithProviderBinding
                        ? projectGovernanceProviderResourceExecutionAdmissionReadback(
                            primaryRequestWithProviderBinding,
                        )
                        : null,
                    manualExecutionControl: projectGovernanceManualExecutionControlReadback(
                        governanceCase,
                        providerExecution,
                    ),
                    decisionExecutionStatus: governanceCase.primaryRequest
                        ? projectGovernanceDecisionExecutionStatus(
                            governanceCase.primaryRequest,
                        )
                        : null,
                };
                const currentActivityCursor = governanceCaseActivityCursor(governanceCase);
                const readState = projectGovernanceCaseReadState(
                    governanceCase.id,
                    currentActivityCursor,
                    governanceCase.readCursors?.[0] ?? null,
                );
                const projectedCase = projectGovernanceCase(governanceCase, null, {
                    includePrivateOriginRefs: false,
                    workflowAudience: 'member',
                    viewerPubkey: actor.pubkey,
                });
                const institutionalIdentities = governanceCaseInstitutionalIdentities(
                    governanceCase,
                    operationScopes,
                );
                return [{
                    value: {
                        case: projectedCase,
                        task,
                        readState,
                        institutionalIdentities,
                    },
                    facetRecord: governanceCaseOperationalInboxFacetRecord(
                        governanceCase,
                        projectedCase,
                        task,
                        institutionalIdentities,
                        actor.pubkey,
                        now,
                    ),
                }];
            });
            const operationEntries = operations.map((operation) => ({
                value: operation,
                facetRecord: governanceOperationOperationalInboxFacetRecord(operation, now),
            }));
            const dutyEntries = institutionalDuties.map((duty) => ({
                value: duty,
                facetRecord: governanceDutyOperationalInboxFacetRecord(duty, now),
            }));
            const facetRecords = [
                ...caseEntries.map((entry) => entry.facetRecord),
                ...operationEntries.map((entry) => entry.facetRecord),
                ...dutyEntries.map((entry) => entry.facetRecord),
            ];
            const matchedIds = new Set(
                filterGovernanceOperationalInboxRecords(facetRecords, filters)
                    .map((record) => record.id),
            );
            const items = caseEntries
                .filter((entry) => matchedIds.has(entry.facetRecord.id))
                .map((entry) => entry.value);
            const filteredOperations = operationEntries
                .filter((entry) => matchedIds.has(entry.facetRecord.id))
                .map((entry) => entry.value);
            const filteredInstitutionalDuties = dutyEntries
                .filter((entry) => matchedIds.has(entry.facetRecord.id))
                .map((entry) => entry.value);
            const continueItem = caseEntries
                .map((entry) => entry.value)
                .filter((item) => item.readState.lastReadAt)
                .sort((left, right) => (
                    (right.readState.lastReadAt?.getTime() ?? 0)
                    - (left.readState.lastReadAt?.getTime() ?? 0)
                    || String(left.case.id).localeCompare(String(right.case.id))
                ))[0] ?? null;
            res.json({
                queue: {
                    appliedFilters: filters,
                    facets: projectGovernanceOperationalInboxFacets(facetRecords),
                    total: facetRecords.length,
                    matched: matchedIds.size,
                },
                items,
                institutionalDuties: filteredInstitutionalDuties,
                operations: filteredOperations,
                continueWorking: continueItem
                    ? {
                        caseId: continueItem.case.id,
                        title: continueItem.case.title,
                        status: continueItem.readState.status,
                        canonicalUrl: continueItem.readState.resumeUrl,
                        lastReadAt: continueItem.readState.lastReadAt,
                    }
                    : null,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_inbox_lookup_failed',
            });
        }
    });

    router.get('/cases/:caseId', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'invalid_governance_case_id' });
                return;
            }
            const governanceCase = await prisma.governanceCase.findUnique({
                where: { id: caseId },
                include: {
                    blockers: { orderBy: [{ openedAt: 'asc' }, { id: 'asc' }] },
                    homeIdentityBinding: {
                        select: {
                            homeType: true,
                            homeRef: true,
                            activationState: { select: { state: true } },
                        },
                    },
                    primaryRequest: {
                        include: {
                            policyVersionRecord: {
                                select: { rules: true, configDigest: true },
                            },
                            snapshot: true,
                            signals: { orderBy: { createdAt: 'asc' } },
                            decision: true,
                            receipts: { orderBy: { executedAt: 'asc' } },
                            invocation: {
                                include: {
                                    contractVersion: true,
                                    profileBinding: { include: { definitionVersion: true } },
                                    authoritySnapshot: { include: { binding: true } },
                                    costPreflights: {
                                        orderBy: { checkedAt: 'desc' },
                                        take: 1,
                                        include: { payerPolicy: true },
                                    },
                                },
                            },
                        },
                    },
                    responsibilities: { orderBy: { kind: 'asc' } },
                    actionContractVersion: true,
                    manualExecutionCompletion: { include: { receipt: true } },
                    timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
                    decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
                    grantAgreements: { orderBy: [{ activatedAt: 'asc' }, { id: 'asc' }] },
                    relatedCases: {
                        where: { relationshipKind: 'supersedes' },
                        select: {
                            id: true,
                            relationshipKind: true,
                            relationshipReason: true,
                            openedByPubkey: true,
                            openedAt: true,
                        },
                        orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
                    },
                },
            });
            if (!governanceCase) {
                res.status(404).json({ error: 'governance_case_not_found' });
                return;
            }
            const circleHomeId = governanceCase.homeIdentityBinding?.homeType === 'circle'
                ? asPositiveInteger(governanceCase.homeIdentityBinding.homeRef)
                : null;
            const authenticatedViewer = await resolveAuthenticatedActor(req, prisma, {
                requireSessionCookie: true,
            });
            const memberRightsRespondent = authenticatedViewer
                && governanceCase.requestedActionPayload
                && typeof governanceCase.requestedActionPayload === 'object'
                && !Array.isArray(governanceCase.requestedActionPayload)
                && (governanceCase.requestedActionPayload as Record<string, unknown>).kind === 'circle_member_removal'
                && (governanceCase.requestedActionPayload as Record<string, unknown>).targetPubkey === authenticatedViewer.pubkey;
            const responsibilityParticipant = authenticatedViewer
                && Array.isArray(governanceCase.responsibilities)
                && governanceCase.responsibilities.some((responsibility: any) => (
                    responsibility?.assigneePubkey === authenticatedViewer.pubkey
                    && ['assigned', 'accepted'].includes(String(responsibility?.status ?? ''))
                ));
            const responsibilityManagerProjection = responsibilityParticipant
                && authenticatedViewer
                && circleHomeId
                && await canManageCaseResponsibilities(authenticatedViewer, circleHomeId)
                ? await resolveGovernanceCircleReadProjection(req, prisma, circleHomeId)
                : null;
            const projection = memberRightsRespondent
                ? {
                    audience: 'member' as const,
                    reason: 'affected_member_respondent',
                    publiclyReadable: false,
                }
                : responsibilityParticipant
                    ? responsibilityManagerProjection ?? {
                        audience: 'member' as const,
                        reason: 'case_responsibility_participant',
                        publiclyReadable: false,
                    }
                : circleHomeId
                ? await resolveGovernanceCircleReadProjection(req, prisma, circleHomeId)
                : await resolveGovernanceRequestReadProjection(
                    req,
                    prisma,
                    governanceCase.primaryRequest,
                );
            const primaryRequestWithProviderReadback = governanceCase.primaryRequest
                ? await attachProviderResourceReadback(
                    prisma,
                    governanceCase.primaryRequest,
                )
                : null;
            if (primaryRequestWithProviderReadback) {
                primaryRequestWithProviderReadback.decisionOutputArtifacts =
                    governanceCase.decisionOutputArtifacts;
            }
            const projected = primaryRequestWithProviderReadback
                ? projectGovernanceRequest(
                    primaryRequestWithProviderReadback,
                    projection,
                    {
                        executionCompatibility: governanceExecutionCompatibility(
                            primaryRequestWithProviderReadback,
                        ),
                    },
                )
                : null;
            const viewerActor = projection.audience === 'public'
                ? null
                : authenticatedViewer ?? await requireGovernanceActor(req);
            const responsibilityCandidates = circleHomeId && projection.audience !== 'public'
                ? await listGovernanceCaseResponsibilityCandidates(
                    prisma,
                    circleHomeId,
                    governanceCase.primaryRequest,
                )
                : [];
            const briefSnapshot = projection.audience !== 'public'
                && governanceCase.briefDraftPostId
                && governanceCase.briefDraftVersion
                ? await prisma.draftVersionSnapshot.findUnique({
                    where: {
                        draftPostId_draftVersion: {
                            draftPostId: governanceCase.briefDraftPostId,
                            draftVersion: governanceCase.briefDraftVersion,
                        },
                    },
                    select: {
                        draftPostId: true,
                        draftVersion: true,
                        contentSnapshot: true,
                        contentHash: true,
                        createdBy: true,
                        createdAt: true,
                    },
                })
                : null;
            const briefSourceMaterials = projection.audience !== 'public'
                && circleHomeId
                && governanceCase.briefDraftPostId
                && briefSnapshot?.createdAt
                ? selectLatestExternalUrlCaptureVersions((await listSourceMaterials(prisma, {
                    circleId: circleHomeId,
                    draftPostId: governanceCase.briefDraftPostId,
                    createdAtCutoff: briefSnapshot.createdAt,
                    canReview: projection.audience === 'operator',
                })).filter((material) => (
                    material.originType === 'external_url_capture'
                    && Boolean(material.canonicalUrl)
                    && Boolean(material.externalAuthorLabel)
                    && Boolean(material.sourcePublishedAt)
                    && Boolean(material.capturedAt)
                    && Number.isSafeInteger(material.sourceVersion)
                )))
                : [];
            const briefSourceSubmitterFacts = projection.audience !== 'public'
                && briefSourceMaterials.length > 0
                ? await prisma.sourceMaterial.findMany({
                    where: { id: { in: briefSourceMaterials.map((material) => material.id) } },
                    select: { id: true, uploadedByUserId: true, submittedByPubkey: true },
                })
                : [];
            const briefClaimBindingSourceIds = projection.audience !== 'public'
                ? [...new Set(governanceCase.timelineEvents.flatMap((event) => (
                    event.eventType === 'brief_claim_evidence_bound'
                    && event.briefSnapshotDigest === governanceCase.briefSnapshotDigest
                    && Number.isSafeInteger(event.sourceMaterialId)
                        ? [Number(event.sourceMaterialId)]
                        : []
                )))]
                : [];
            const briefClaimBindingChunkIds = projection.audience !== 'public'
                ? [...new Set(governanceCase.timelineEvents.flatMap((event) => (
                    event.eventType === 'brief_claim_evidence_bound'
                    && event.briefSnapshotDigest === governanceCase.briefSnapshotDigest
                    && Number.isSafeInteger(event.sourceMaterialChunkId)
                        ? [Number(event.sourceMaterialChunkId)]
                        : []
                )))]
                : [];
            const briefClaimBindingSourceStates = circleHomeId
                && governanceCase.briefDraftPostId
                && briefClaimBindingSourceIds.length > 0
                ? await prisma.sourceMaterial.findMany({
                    where: {
                        id: { in: briefClaimBindingSourceIds },
                        circleId: circleHomeId,
                        draftPostId: governanceCase.briefDraftPostId,
                    },
                    select: {
                        id: true,
                        contentDigest: true,
                        lifecycleStatus: true,
                        evidencePrivacyClass: true,
                        chunks: {
                            where: { id: { in: briefClaimBindingChunkIds } },
                            select: { id: true, textDigest: true },
                        },
                    },
                })
                : [];
            const briefWorkflowState = projection.audience !== 'public' && governanceCase.briefDraftPostId
                ? await prisma.draftWorkflowState.findUnique({
                    where: { draftPostId: governanceCase.briefDraftPostId },
                    select: { documentStatus: true, currentSnapshotVersion: true },
                })
                : null;
            const briefAiAcceptanceHistory = projection.audience !== 'public'
                && governanceCase.briefDraftPostId
                && briefSnapshot?.createdAt
                ? await prisma.ghostDraftAcceptance.findMany({
                    where: {
                        draftPostId: governanceCase.briefDraftPostId,
                        changed: true,
                        acceptedAt: { lte: briefSnapshot.createdAt },
                    },
                    orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
                    select: {
                        id: true,
                        acceptedByUserId: true,
                        acceptanceMode: true,
                        acceptedSuggestionId: true,
                        resultingWorkingCopyHash: true,
                        changed: true,
                        acceptedAt: true,
                        generation: {
                            select: {
                                id: true,
                                draftPostId: true,
                                providerMode: true,
                                model: true,
                                promptAsset: true,
                                promptVersion: true,
                                sourceDigest: true,
                                ghostRunId: true,
                                draftText: true,
                                createdAt: true,
                            },
                        },
                    },
                })
                : [];
            const reviewTimelineEvents = projection.audience !== 'public'
                && governanceCase.briefDraftPostId
                ? await listDraftDiscussionTimelineEvents(prisma, {
                    draftPostId: governanceCase.briefDraftPostId,
                })
                : [];
            const policySimulation = projection.audience !== 'public'
                && governanceCase.caseType === 'policy'
                && governanceCase.casePhase === 'evidence_review'
                && !governanceCase.primaryRequestId
                && !governanceCase.decisionStagePlanDigest
                ? await simulateGovernanceCaseApprovalStage(
                    prisma,
                    governanceCase,
                    viewerActor?.pubkey ?? null,
                )
                : null;
            const configurationTransitionReadback = await resolveGovernanceConfigurationTransitionReadback(
                prisma,
                governanceCase,
            );
            const attentionPreference = viewerActor
                ? await readGovernanceCaseAttentionPreference(prisma, {
                    caseId: governanceCase.id,
                    userId: viewerActor.userId,
                })
                : null;
            const readState = viewerActor
                ? await readGovernanceCaseReadState(prisma, {
                    caseId: governanceCase.id,
                    userId: viewerActor.userId,
                    currentActivityCursor: governanceCaseActivityCursor(governanceCase),
                })
                : null;
            const grantAgreements = Array.isArray(governanceCase.grantAgreements)
                ? governanceCase.grantAgreements
                : [];
            const payoutRequests = projection.audience !== 'public'
                && grantAgreements.length > 0
                ? await prisma.governanceRequest.findMany({
                    where: {
                        homeIdentityBindingId: governanceCase.homeIdentityBindingId,
                        actionType: GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
                        targetType: 'circle',
                        targetRef: String(circleHomeId),
                    },
                    select: {
                        id: true,
                        actionType: true,
                        state: true,
                        payload: true,
                        caseRef: true,
                        stageRef: true,
                        openedAt: true,
                        resolvedAt: true,
                        decision: {
                            select: {
                                decision: true,
                                decisionDigest: true,
                                decidedAt: true,
                            },
                        },
                        receipts: {
                            select: {
                                id: true,
                                executorModule: true,
                                executionStatus: true,
                                executionRef: true,
                                decisionDigest: true,
                                errorCode: true,
                                executionEvidence: true,
                                executionEvidenceDigest: true,
                                executedAt: true,
                            },
                            orderBy: { executedAt: 'asc' },
                        },
                    },
                    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
                    take: 100,
                })
                : [];
            const payoutRequestsWithProviderReadback = await Promise.all(
                payoutRequests.map((request) => attachProviderResourceReadback(prisma, request)),
            );
            const grantAgreementsWithPayoutRequests = grantAgreements.map(
                (agreement) => ({
                    ...agreement,
                    payoutRequests: payoutRequestsWithProviderReadback.filter((request) => {
                        const payload = request.payload;
                        return payload
                            && typeof payload === 'object'
                            && !Array.isArray(payload)
                            && 'agreement' in payload
                            && payload.agreement
                            && typeof payload.agreement === 'object'
                            && !Array.isArray(payload.agreement)
                            && 'id' in payload.agreement
                            && payload.agreement.id === agreement.id;
                    }),
                }),
            );
            const projectedAuthorityHealth = projectGovernanceCaseAuthorityHealthReadback({
                request: governanceCase.primaryRequest,
                binding: governanceCase.primaryRequest?.invocation?.authoritySnapshot?.binding,
                audience: projection.audience,
            });
            const baseCaseProjection = projectGovernanceCase(
                {
                    ...governanceCase,
                    grantAgreements: grantAgreementsWithPayoutRequests,
                    briefSnapshot,
                    briefSourceMaterials,
                    briefSourceSubmitterFacts,
                    briefClaimBindingSourceStates,
                    briefWorkflowState,
                    briefAiAcceptanceHistory,
                    reviewTimelineEvents,
                    configurationTransitionReadback,
                },
                projected?.request ?? null,
                {
                    includePrivateOriginRefs: projection.audience !== 'public',
                    workflowAudience: projection.audience,
                    viewerPubkey: viewerActor?.pubkey ?? null,
                    responsibilityCandidates,
                    policySimulation,
                },
            );
            const caseProjection = projectedAuthorityHealth
                ? { ...baseCaseProjection, authorityHealthReadback: projectedAuthorityHealth }
                : baseCaseProjection;
            const detailProviderExecution = primaryRequestWithProviderReadback
                ? projectGovernanceProviderExecutionReadback(primaryRequestWithProviderReadback)
                : null;
            const detailProviderProgramId = String(
                (detailProviderExecution as any)?.provider?.trustProfile?.programId ?? '',
            ).trim();
            const detailIndexerObservations = viewerActor && detailProviderProgramId
                ? await loadGovernanceProviderIndexerObservations(
                    prisma,
                    [detailProviderProgramId],
                )
                : new Map();
            const detailExperience = projectGovernanceCaseDetailExperience(
                governanceCase,
                viewerActor?.pubkey ?? null,
                detailProviderExecution,
                detailProviderProgramId
                    ? detailIndexerObservations.get(detailProviderProgramId) ?? null
                    : null,
            );
            const interactiveCaseProjection = { ...caseProjection, ...detailExperience };
            res.json({
                projection,
                case: attentionPreference
                    ? { ...interactiveCaseProjection, attentionPreference, ...(readState ? { readState } : {}) }
                    : readState
                        ? { ...interactiveCaseProjection, readState }
                        : interactiveCaseProjection,
                search: projectGovernanceCaseSearch(caseProjection, req.query?.q),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_lookup_failed',
            });
        }
    });

    router.patch('/cases/:caseId/read-cursor', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedVersion = asNonNegativeInteger(req.body?.expectedVersion);
            const activityCursor = asRequiredString(req.body?.activityCursor);
            const visitId = asRequiredString(req.body?.visitId);
            const resumeFragment = req.body?.resumeFragment == null
                ? null
                : isGovernanceCaseResumeFragment(req.body.resumeFragment)
                    ? req.body.resumeFragment
                    : undefined;
            if (!caseId || expectedVersion == null || !activityCursor || !visitId || resumeFragment === undefined) {
                res.status(400).json({ error: 'governance_case_read_cursor_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const governanceCase = await prisma.governanceCase.findUnique({
                where: { id: caseId },
                include: {
                    primaryRequest: {
                        include: {
                            snapshot: true,
                            signals: { orderBy: { createdAt: 'asc' } },
                            decision: true,
                            receipts: { orderBy: { executedAt: 'asc' } },
                        },
                    },
                    responsibilities: { orderBy: { kind: 'asc' } },
                    timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
                    decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
                },
            });
            if (!governanceCase) {
                res.status(404).json({ error: 'governance_case_not_found' });
                return;
            }
            const result = await setGovernanceCaseReadCursor(prisma, {
                caseId,
                userId: actor.userId,
                activityCursor,
                observedActivityCursor: governanceCaseActivityCursor(governanceCase),
                resumeFragment,
                visitId,
                expectedVersion,
                readAt: new Date(),
            });
            res.json({ caseId, ...result });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseReadCursorError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_read_cursor_failed',
            });
        }
    });

    router.patch('/cases/:caseId/attention-preference', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedVersion = asNonNegativeInteger(req.body?.expectedVersion);
            if (!caseId || expectedVersion == null || !isGovernanceCaseAttentionLevel(req.body?.level)) {
                res.status(400).json({ error: 'governance_case_attention_preference_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await setGovernanceCaseAttentionPreference(prisma, {
                caseId,
                userId: actor.userId,
                level: req.body.level,
                expectedVersion,
            });
            res.json({ caseId, ...result });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseAttentionPreferenceError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_case_attention_preference_failed',
            });
        }
    });

    async function requireRouteAProviderAdmissionCredentialManager(
        req: any,
        caseId: string,
    ): Promise<void> {
        const governanceCase = await (prisma as any).governanceCase.findUnique({
            where: { id: caseId },
            select: {
                id: true,
                homeIdentityBinding: {
                    select: { homeType: true, homeRef: true },
                },
            },
        });
        if (!governanceCase) {
            throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
        }
        const home = governanceCase.homeIdentityBinding;
        const circleId = home?.homeType === 'circle'
            ? Number(home.homeRef)
            : Number.NaN;
        if (!Number.isSafeInteger(circleId) || circleId <= 0) {
            throw new GovernanceCaseWorkflowError(
                409,
                'route_a_provider_admission_circle_home_required',
            );
        }
        const actor = await requireGovernanceActor(req);
        await requireCircleManagerForActor(prisma, { actor, circleId });
    }

    async function handleRouteAProviderAdmissionCredential(
        req: any,
        res: Response,
        operation: 'issue' | 'read',
    ): Promise<void> {
        try {
            if (sendPrivateSidecarRequired(res)) return;
            if (
                operation === 'issue'
                && !isRouteAProviderAdmissionCredentialEnabled()
            ) {
                res.status(503).json({
                    error: 'route_a_provider_admission_credential_disabled',
                });
                return;
            }
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({
                    error: 'route_a_provider_admission_case_id_required',
                });
                return;
            }
            await requireRouteAProviderAdmissionCredentialManager(req, caseId);
            const submission = operation === 'issue'
                ? await issueRouteAProviderAdmissionCredential(prisma, { caseId })
                : await readRouteAProviderAdmissionCredential(prisma, { caseId });
            res.status(200).json(submission);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof Error && error.message === 'circle_role_required') {
                res.status(409).json({ error: 'circle_role_required' });
                return;
            }
            res.status(503).json({ error: 'route_a_provider_admission_credential_unavailable' });
        }
    }

    router.post(
        '/cases/:caseId/external-credentials/provider-admission',
        async (req, res) => handleRouteAProviderAdmissionCredential(req, res, 'issue'),
    );
    router.get(
        '/cases/:caseId/external-credentials/provider-admission',
        async (req, res) => handleRouteAProviderAdmissionCredential(req, res, 'read'),
    );

    router.get('/cases/:caseId/brief-candidates', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'invalid_governance_case_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'circle.read',
            });
            const canManage = await canManageCaseResponsibilities(actor, circleId);
            const candidates = await listGovernanceCaseBriefCandidates(prisma, {
                caseId,
                actorPubkey: actor.pubkey,
                canManage,
            });
            res.json({ caseId, candidates });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_brief_candidates_failed',
            });
        }
    });

    router.post('/cases/:caseId/brief-binding', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const draftPostId = asPositiveInteger(req.body?.draftPostId);
            const expectedDraftVersion = asPositiveInteger(req.body?.expectedDraftVersion);
            const expectedSnapshotDigest = asOptionalString(req.body?.expectedSnapshotDigest);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            const expectedVersionProvided = req.body?.expectedDraftVersion != null;
            const expectedDigestProvided = req.body?.expectedSnapshotDigest != null;
            const exactCandidateValid = Boolean(
                expectedDraftVersion
                && expectedSnapshotDigest
                && /^[a-f0-9]{64}$/.test(expectedSnapshotDigest),
            );
            const exactCandidateRequired = String(
                process.env.GOVERNANCE_CASE_BRIEF_EXACT_BIND_REQUIRED ?? 'true',
            ).trim().toLowerCase() !== 'false';
            if (
                !caseId
                || !draftPostId
                || expectedCaseVersion == null
                || (exactCandidateRequired && !exactCandidateValid)
                || ((expectedVersionProvided || expectedDigestProvided) && !exactCandidateValid)
            ) {
                res.status(400).json({ error: 'governance_case_brief_binding_invalid' });
                return;
            }
            if (!exactCandidateValid) {
                // Temporary rollout compatibility signal. It contains no Case,
                // Draft, actor, or payload identifiers and can be counted in logs.
                console.warn('[governance_case_brief_binding_compat] accepted legacy payload without exact candidate tuple');
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'circle.read',
            });
            const canManage = await canManageCaseResponsibilities(actor, circleId);
            const result = await bindGovernanceCaseBrief(prisma, {
                caseId,
                draftPostId,
                actorPubkey: actor.pubkey,
                canManage,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
                expectedDraftVersion: exactCandidateValid ? expectedDraftVersion : null,
                expectedSnapshotDigest: exactCandidateValid ? expectedSnapshotDigest : null,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                caseVersion: result.governanceCase.caseVersion,
                binding: result.binding,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_brief_binding_failed',
            });
        }
    });

    router.post('/cases/:caseId/brief-evidence-bindings', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const claimId = asRequiredString(req.body?.claimId);
            const sourceMaterialId = asPositiveInteger(req.body?.sourceMaterialId);
            const sourceMaterialChunkId = asPositiveInteger(req.body?.sourceMaterialChunkId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || !claimId || !sourceMaterialId || !sourceMaterialChunkId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_case_brief_evidence_binding_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const canManage = await canManageCaseResponsibilities(actor, circleId);
            const result = await bindGovernanceCaseBriefClaimEvidence(prisma, {
                caseId,
                claimId,
                sourceMaterialId,
                sourceMaterialChunkId,
                actorPubkey: actor.pubkey,
                canManage,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                caseVersion: result.governanceCase.caseVersion,
                binding: result.binding,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_brief_evidence_binding_failed',
            });
        }
    });

    router.post('/cases/:caseId/exports', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const audience = req.body?.audience === 'public'
                ? 'public'
                : req.body?.audience === 'operator' ? 'operator' : null;
            if (!caseId || !audience) {
                res.status(400).json({ error: 'governance_case_export_invalid' });
                return;
            }
            const circleId = await resolveCaseCircleId(caseId);
            const readProjection = await resolveGovernanceCircleReadProjection(
                req,
                prisma,
                circleId,
            );
            if (audience === 'public' && readProjection.publiclyReadable !== true) {
                res.status(403).json({ error: 'governance_case_public_export_unavailable' });
                return;
            }
            const actor = audience === 'operator' ? await requireGovernanceActor(req) : null;
            if (audience === 'operator' && readProjection.audience !== 'operator') {
                res.status(403).json({ error: 'governance_case_operator_export_forbidden' });
                return;
            }
            const result = await createGovernanceCaseAudienceExport(prisma, {
                caseId,
                audience,
                actorPubkey: actor?.pubkey ?? null,
                purpose: req.body?.purpose,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(audience === 'public' || result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_export_failed',
            });
        }
    });

    router.post('/cases/:caseId/evidence-share-requests', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'invalid_governance_case_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const authority = await resolveGovernanceEvidenceShareAuthority(prisma, caseId);
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId: authority.binding.binding.committeeCircleId,
                action: 'circle.read',
            });
            const result = await requestGovernanceEvidenceShare(prisma, {
                authority,
                actorPubkey: actor.pubkey,
                purpose: req.body?.purpose,
                requestNote: req.body?.requestNote,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_evidence_share_request_failed',
            });
        }
    });

    router.get('/cases/:caseId/evidence-shares', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'invalid_governance_case_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const packages = await listGovernanceCaseEvidenceShares(prisma, caseId);
            res.json({ caseId, packages });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_evidence_share_list_failed',
            });
        }
    });

    router.post('/evidence-shares/:packageId/decision', async (req, res) => {
        try {
            const packageId = asRequiredString(req.params.packageId);
            const action = req.body?.action === 'authorize'
                ? 'authorize'
                : req.body?.action === 'deny'
                    ? 'deny'
                    : null;
            const expectedVersion = asPositiveInteger(req.body?.expectedVersion);
            if (!packageId || !action || !expectedVersion) {
                res.status(400).json({ error: 'governance_evidence_share_decision_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const targetCircleId = await findGovernanceEvidenceShareTargetCircle(prisma, packageId);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId: targetCircleId,
                allowModerator: true,
            });
            const expiresAt = req.body?.expiresAt == null ? null : new Date(String(req.body.expiresAt));
            const result = await decideGovernanceEvidenceShare(prisma, {
                packageId,
                action,
                actorPubkey: actor.pubkey,
                expectedVersion,
                idempotencyKey: req.body?.idempotencyKey,
                sourceMaterialIds: req.body?.sourceMaterialIds,
                safeSummary: req.body?.safeSummary,
                expiresAt,
                reason: req.body?.reason,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_evidence_share_decision_failed',
            });
        }
    });

    router.post('/evidence-shares/:packageId/revoke', async (req, res) => {
        try {
            const packageId = asRequiredString(req.params.packageId);
            const expectedVersion = asPositiveInteger(req.body?.expectedVersion);
            if (!packageId || !expectedVersion) {
                res.status(400).json({ error: 'governance_evidence_share_revocation_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const targetCircleId = await findGovernanceEvidenceShareTargetCircle(prisma, packageId);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId: targetCircleId,
                allowModerator: true,
            });
            const result = await revokeGovernanceEvidenceShare(prisma, {
                packageId,
                actorPubkey: actor.pubkey,
                expectedVersion,
                reason: req.body?.reason,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_evidence_share_revocation_failed',
            });
        }
    });

    router.post('/evidence-shares/:packageId/access', async (req, res) => {
        try {
            const packageId = asRequiredString(req.params.packageId);
            const action = req.body?.action === 'export' ? 'export' : req.body?.action === 'read' ? 'read' : null;
            if (!packageId || !action) {
                res.status(400).json({ error: 'governance_evidence_share_access_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const recipientCircleId = await findGovernanceEvidenceShareRecipientCircle(prisma, packageId);
            let recipientAuthorized = false;
            try {
                await requireCircleActorForAuthActor(actor, prisma, {
                    circleId: recipientCircleId,
                    action: 'circle.read',
                });
                recipientAuthorized = true;
            } catch (error) {
                if (!(error instanceof AuthActorError)) throw error;
            }
            const result = await accessGovernanceEvidenceShare(prisma, {
                packageId,
                actorPubkey: actor.pubkey,
                purpose: req.body?.purpose,
                action,
                recipientAuthorized,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.allowed ? 200 : 403).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_evidence_share_access_failed',
            });
        }
    });

    router.post('/cases/:caseId/manual-execution/completions', async (req, res) => {
        try {
            if (sendPrivateSidecarRequired(res)) return;
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            const expectedCompletionVersion = req.body?.expectedCompletionVersion == null
                ? null
                : asPositiveInteger(req.body.expectedCompletionVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_manual_execution_submission_invalid' });
                return;
            }
            if (req.body?.expectedCompletionVersion != null && expectedCompletionVersion == null) {
                res.status(400).json({ error: 'governance_manual_execution_version_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const result = await submitGovernanceManualExecutionCompletion(prisma, {
                caseId,
                actorPubkey: actor.pubkey,
                evidence: req.body?.evidence,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
                expectedCompletionVersion,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (isGovernanceCaseWorkflowError(error)) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_manual_execution_submission_failed',
            });
        }
    });

    router.post('/cases/:caseId/manual-execution/reviews', async (req, res) => {
        try {
            if (sendPrivateSidecarRequired(res)) return;
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            const expectedCompletionVersion = asPositiveInteger(
                req.body?.expectedCompletionVersion,
            );
            const decision = req.body?.decision === 'approve'
                ? 'approve'
                : req.body?.decision === 'reject'
                    ? 'reject'
                    : null;
            if (
                !caseId
                || expectedCaseVersion == null
                || expectedCompletionVersion == null
                || !decision
            ) {
                res.status(400).json({ error: 'governance_manual_execution_review_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const result = await reviewGovernanceManualExecutionCompletion(
                prisma,
                {
                    caseId,
                    actorPubkey: actor.pubkey,
                    decision,
                    reason: req.body?.reason,
                    idempotencyKey: req.body?.idempotencyKey,
                    expectedCaseVersion,
                    expectedCompletionVersion,
                },
                { storageFabricReceiptVerifier },
            );
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (isGovernanceCaseWorkflowError(error)) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_manual_execution_review_failed',
            });
        }
    });

    router.post('/cases/:caseId/responsibilities/:kind/actions', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const kind = asRequiredString(req.params.kind) as GovernanceCaseResponsibilityKind | null;
            const action = asRequiredString(req.body?.action) as GovernanceCaseResponsibilityAction | null;
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            const expectedResponsibilityVersion = asNonNegativeInteger(
                req.body?.expectedResponsibilityVersion,
            );
            if (!caseId || !kind || !action) {
                res.status(400).json({ error: 'governance_case_responsibility_action_invalid' });
                return;
            }
            if (expectedCaseVersion == null || expectedResponsibilityVersion == null) {
                res.status(400).json({ error: 'governance_case_expected_version_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            const selfResponsibilityAction = [
                'accept', 'decline', 'escalate', 'absence',
            ].includes(action);
            let hasCircleRead = true;
            try {
                await requireCircleActorForAuthActor(actor, prisma, {
                    circleId,
                    action: 'circle.read',
                });
            } catch (error) {
                if (!(error instanceof AuthActorError) || !selfResponsibilityAction) throw error;
                hasCircleRead = false;
            }
            const canManage = hasCircleRead
                ? await canManageCaseResponsibilities(actor, circleId)
                : false;
            const result = await changeGovernanceCaseResponsibility(prisma, {
                caseId,
                kind,
                action,
                actorPubkey: actor.pubkey,
                targetPubkey: asOptionalString(req.body?.targetPubkey),
                reason: asOptionalString(req.body?.reason),
                deadlineAt: asOptionalString(req.body?.deadlineAt),
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
                expectedResponsibilityVersion,
                canManage,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                caseVersion: result.governanceCase.caseVersion,
                responsibility: result.responsibility,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_responsibility_action_failed',
            });
        }
    });

    router.post('/cases/:caseId/transitions', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_case_expected_version_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'circle.read',
            });
            const result = await transitionGovernanceCasePhase(prisma, {
                caseId,
                actorPubkey: actor.pubkey,
                toPhase: req.body?.toPhase,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
                actualOutcome: req.body?.actualOutcome,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                phase: result.governanceCase.casePhase,
                caseVersion: result.governanceCase.caseVersion,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_transition_failed',
            });
        }
    });

    router.post('/cases/:caseId/reviews', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_case_expected_version_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await recordGovernanceCaseReviewConclusion(prisma, {
                caseId,
                actorPubkey: actor.pubkey,
                conclusion: req.body?.conclusion as GovernanceCaseReviewConclusion,
                reason: req.body?.reason,
                publicBasis: req.body?.publicBasis,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                caseVersion: result.governanceCase.caseVersion,
                event: result.event,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_review_failed',
            });
        }
    });

    router.post('/cases/:caseId/review-relationships', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_case_expected_version_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await recordGovernanceCaseReviewRelationship(prisma, {
                caseId,
                actorPubkey: actor.pubkey,
                actorRole: req.body?.actorRole as GovernanceCaseReviewRelationshipActorRole,
                relationship: req.body?.relationship as GovernanceCaseReviewRelationship,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                caseVersion: result.governanceCase.caseVersion,
                event: result.event,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_review_relationship_failed',
            });
        }
    });

    router.post('/cases/:caseId/approval-conflicts', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_case_expected_version_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await recordGovernanceCaseApprovalConflictDisclosure(prisma, {
                caseId,
                actorPubkey: actor.pubkey,
                publicReason: req.body?.publicReason as GovernanceCaseConflictReason,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                caseVersion: result.governanceCase.caseVersion,
                event: result.event,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_conflict_disclosure_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-reviewer-conflicts', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_grant_conflict_disclosure_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await discloseGovernanceGrantReviewerConflict(prisma, {
                caseId,
                artifactId: req.body?.artifactId,
                projectRef: req.body?.projectRef,
                actorPubkey: actor.pubkey,
                publicReason: req.body?.publicReason as GovernanceGrantConflictReason,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_conflict_disclosure_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'governance_grant_case_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await activateGovernanceGrantAgreement(prisma, {
                caseId,
                artifactId: req.body?.artifactId,
                projectRef: req.body?.projectRef,
                milestones: req.body?.milestones,
                actorPubkey: actor.pubkey,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_agreement_activation_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/settlement-readiness', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            const expectedEvaluationVersion = Number(req.body?.expectedEvaluationVersion);
            if (
                !caseId
                || !agreementId
                || !Number.isSafeInteger(expectedEvaluationVersion)
                || expectedEvaluationVersion < 0
            ) {
                res.status(400).json({ error: 'governance_grant_settlement_readiness_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await refreshGovernanceGrantSettlementReadiness(prisma, {
                caseId,
                agreementId,
                expectedEvaluationVersion,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_grant_settlement_readiness_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/payout-requests', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            const trancheIntentId = asRequiredString(req.body?.trancheIntentId);
            if (!caseId || !agreementId || !trancheIntentId) {
                res.status(400).json({ error: 'governance_grant_payout_request_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const opened = await prisma.$transaction(async (tx) => {
                const payload = await buildSquadsGrantPayoutPayload(tx as any, {
                    circleId,
                    agreementId,
                    trancheIntentId,
                });
                if (payload.agreement.caseId !== caseId) {
                    throw new GovernanceGrantAgreementError(409, 'governance_grant_agreement_case_mismatch');
                }
                const request = await openSquadsProviderGovernanceRequest({
                    tx,
                    circleId,
                    actorPubkey: actor.pubkey,
                    actionType: GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
                    payload,
                    idempotencyKey: buildSquadsGrantPayoutRequestIdempotencyKey({
                        circleId,
                        agreementId,
                        trancheIntentId,
                        milestoneResultDigest: payload.agreement.milestoneResultDigest,
                        transactionIndex: payload.providerIntent.transactionIndex,
                        recipient: payload.providerIntent.recipient,
                        amountLamports: payload.providerIntent.amountLamports,
                        renewalOfRequestId: payload.settlementAttempt.renewalOfRequestId,
                    }),
                });
                return { payload, request };
            });
            res.status(202).json({
                status: 'requires_governance',
                actionType: GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
                payoutIntent: opened.payload.providerIntent,
                payerAuthorization: opened.payload.payerAuthorization,
                request: publicRequest(opened.request),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_payout_request_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/milestone-reviews', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            if (!caseId || !agreementId) {
                res.status(400).json({ error: 'governance_grant_milestone_review_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await recordGovernanceGrantMilestoneReview(prisma, {
                caseId,
                agreementId,
                milestoneId: req.body?.milestoneId,
                outcome: req.body?.outcome as GovernanceGrantMilestoneReviewOutcome,
                evidenceRefs: req.body?.evidenceRefs,
                summary: req.body?.summary,
                actorPubkey: actor.pubkey,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_milestone_review_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/milestone-appeals', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            if (!caseId || !agreementId) {
                res.status(400).json({ error: 'governance_grant_milestone_appeal_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await openGovernanceGrantMilestoneAppeal(prisma, {
                caseId,
                agreementId,
                milestoneId: req.body?.milestoneId,
                originalResultDigest: req.body?.originalResultDigest,
                reason: req.body?.reason,
                evidenceRefs: req.body?.evidenceRefs,
                actorPubkey: actor.pubkey,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_milestone_appeal_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/milestone-appeal-votes', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            if (!caseId || !agreementId) {
                res.status(400).json({ error: 'governance_grant_appeal_vote_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await recordGovernanceGrantMilestoneAppealVote(prisma, {
                caseId,
                agreementId,
                appealId: req.body?.appealId,
                vote: req.body?.vote as GovernanceGrantAppealVote,
                reason: req.body?.reason,
                actorPubkey: actor.pubkey,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_appeal_vote_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/amendment-cases', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            if (!caseId || !agreementId) {
                res.status(400).json({ error: 'governance_grant_amendment_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await openGovernanceGrantAgreementAmendmentCase(prisma, {
                caseId,
                agreementId,
                proposedTerms: req.body?.proposedTerms,
                reason: req.body?.reason,
                actorPubkey: actor.pubkey,
                actorRole: circleActor.membership.role,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof GovernanceCaseIntakeError || error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_amendment_failed',
            });
        }
    });

    router.post('/cases/:caseId/provider-execution/terminal-abandonment-cases', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'governance_provider_terminal_abandonment_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await openGovernanceProviderExecutionTerminalAbandonmentCase(prisma, {
                caseId,
                reason: req.body?.reason,
                actorPubkey: actor.pubkey,
                actorRole: circleActor.membership.role,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseIntakeError || error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_provider_terminal_abandonment_failed',
            });
        }
    });

    router.post('/cases/:caseId/provider-execution/compensation-plan-cases', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'governance_provider_compensation_plan_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await openGovernanceProviderExecutionCompensationPlanCase(prisma, {
                caseId,
                reason: req.body?.reason,
                actorPubkey: actor.pubkey,
                actorRole: circleActor.membership.role,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseIntakeError || error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_provider_compensation_plan_failed',
            });
        }
    });

    router.post('/cases/:caseId/provider-execution/funding-amendment-cases', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            if (!caseId) {
                res.status(400).json({ error: 'governance_funding_amendment_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await openGovernanceFundingAmendmentCase(prisma, {
                caseId,
                proposedEconomicBearer: req.body?.proposedEconomicBearer,
                proposedSingleLimit: req.body?.proposedSingleLimit,
                proposedPeriodLimit: req.body?.proposedPeriodLimit,
                reason: req.body?.reason,
                actorPubkey: actor.pubkey,
                actorRole: circleActor.membership.role,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseIntakeError || error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_funding_amendment_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/termination-cases', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            if (!caseId || !agreementId) {
                res.status(400).json({ error: 'governance_grant_termination_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            const circleActor = await requireCircleManagerForActor(prisma, {
                actor,
                circleId,
                allowModerator: true,
            });
            const result = await openGovernanceGrantAgreementTerminationCase(prisma, {
                caseId,
                agreementId,
                ground: req.body?.ground as GovernanceGrantTerminationGround,
                reason: req.body?.reason,
                retainedObligations: req.body?.retainedObligations,
                outstandingObligations: req.body?.outstandingObligations,
                actorPubkey: actor.pubkey,
                actorRole: circleActor.membership.role,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                agreement: result.agreement,
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof GovernanceCaseIntakeError || error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_termination_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/termination-applications', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            if (!caseId || !agreementId) {
                res.status(400).json({ error: 'governance_grant_termination_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleManagerForActor(prisma, { actor, circleId, allowModerator: true });
            const result = await applyAcceptedGovernanceGrantAgreementTermination(prisma, {
                caseId,
                agreementId,
                actorPubkey: actor.pubkey,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_termination_apply_failed',
            });
        }
    });

    router.post('/cases/:caseId/grant-agreements/:agreementId/outcomes', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const agreementId = asRequiredString(req.params.agreementId);
            if (!caseId || !agreementId) {
                res.status(400).json({ error: 'governance_grant_outcome_invalid' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await recordGovernanceGrantOutcome(prisma, {
                caseId,
                agreementId,
                status: req.body?.status as GovernanceGrantOutcomeStatus,
                summary: req.body?.summary,
                actualImpact: req.body?.actualImpact,
                outstandingObligations: req.body?.outstandingObligations,
                evidenceRefs: req.body?.evidenceRefs,
                observationStartedAt: req.body?.observationStartedAt,
                observationEndedAt: req.body?.observationEndedAt,
                actorPubkey: actor.pubkey,
                idempotencyKey: req.body?.idempotencyKey,
            });
            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceGrantAgreementError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_grant_outcome_failed',
            });
        }
    });

    router.post('/cases/:caseId/approval-stage', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_case_expected_version_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const result = await openGovernanceCaseApprovalStage(prisma, {
                caseId,
                actorPubkey: actor.pubkey,
                idempotencyKey: req.body?.idempotencyKey,
                expectedCaseVersion,
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                caseVersion: result.governanceCase.caseVersion,
                requestId: result.request.id,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_case_approval_stage_failed',
            });
        }
    });

    router.post('/cases/:caseId/approval-stage/cancel', async (req, res) => {
        try {
            const caseId = asRequiredString(req.params.caseId);
            const expectedCaseVersion = asNonNegativeInteger(req.body?.expectedCaseVersion);
            if (!caseId || expectedCaseVersion == null) {
                res.status(400).json({ error: 'governance_case_expected_version_required' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const circleId = await resolveCaseCircleId(caseId);
            await requireCircleActorForAuthActor(actor, prisma, { circleId, action: 'circle.read' });
            const governanceCase = await prisma.governanceCase.findUnique({
                where: { id: caseId },
                select: { primaryRequestId: true },
            });
            if (!governanceCase?.primaryRequestId) {
                throw new GovernanceCaseWorkflowError(409, 'governance_case_approval_stage_unavailable');
            }
            const result = await cancelGovernanceRequestAtomically(prisma as any, {
                requestId: governanceCase.primaryRequestId,
                reason: 'governance_case_approval_cancelled',
                now: new Date(),
                authorize: async ({ tx, request }) => {
                    const currentCase = request.governanceCase;
                    if (
                        !currentCase
                        || currentCase.id !== caseId
                        || currentCase.primaryRequestId !== request.id
                        || currentCase.casePhase !== 'decision_in_progress'
                    ) {
                        throw new GovernanceCaseWorkflowError(409, 'governance_case_approval_stage_unavailable');
                    }
                    if (currentCase.caseVersion !== expectedCaseVersion) {
                        throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
                    }
                    const coordinator = Array.isArray(currentCase.responsibilities)
                        ? currentCase.responsibilities.find((item: any) => item.kind === 'coordinator')
                        : null;
                    const isAcceptedCoordinator = coordinator?.status === 'accepted'
                        && governanceActorPublicKeysEqual(coordinator.assigneePubkey, actor.pubkey);
                    if (!isAcceptedCoordinator) {
                        try {
                            await requireCircleManagerForActor(tx, {
                                actor,
                                circleId,
                                allowModerator: true,
                            });
                        } catch (error) {
                            if (
                                error instanceof AuthActorError
                                && (
                                    error.code === 'circle_role_required'
                                    || error.code === 'circle_membership_required'
                                )
                            ) {
                                throw new GovernanceCaseWorkflowError(
                                    403,
                                    'governance_case_cancel_authority_required',
                                );
                            }
                            throw error;
                        }
                    }
                },
                evaluate: evaluateGovernanceRequestThreshold,
                onTerminal: ({ tx, request, decision, now }) =>
                    applyGovernanceCaseDecisionResolution(tx, { request, decision, now })
                        .then(() => undefined),
            });
            res.status(result.replayed ? 200 : 201).json({
                replayed: result.replayed,
                requestId: result.request.id,
                decision: result.decision,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseWorkflowError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            const message = error instanceof Error
                ? error.message
                : 'governance_case_approval_cancel_failed';
            res.status(
                message === 'governance_request_not_active'
                || message === 'governance_request_expired'
                    ? 409
                    : 400,
            )
                .json({ error: message });
        }
    });

    router.get('/requests/:requestId', async (req, res) => {
        try {
            const requestId = asRequiredString(req.params.requestId);
            if (!requestId) {
                res.status(400).json({ error: 'invalid_governance_request_id' });
                return;
            }
            const request = await (prisma as any).governanceRequest.findUnique({
                where: { id: requestId },
                include: {
                    snapshot: true,
                    signals: { orderBy: { createdAt: 'asc' } },
                    decision: true,
                    receipts: { orderBy: { executedAt: 'asc' } },
                    invocation: {
                        include: {
                            contractVersion: true,
                            profileBinding: { include: { definitionVersion: true } },
                            authoritySnapshot: { include: { binding: true } },
                            costPreflights: {
                                orderBy: { checkedAt: 'desc' },
                                take: 1,
                                include: { payerPolicy: true },
                            },
                        },
                    },
                },
            });
            if (!request) {
                res.status(404).json({ error: 'governance_request_not_found' });
                return;
            }
            const requestWithProviderReadback = await attachProviderResourceReadback(
                prisma,
                request,
            );
            const projection = await resolveGovernanceRequestReadProjection(
                req,
                prisma,
                requestWithProviderReadback,
            );
            res.json(projectGovernanceRequest(requestWithProviderReadback, projection, {
                executionCompatibility: governanceExecutionCompatibility(requestWithProviderReadback),
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_request_lookup_failed',
            });
        }
    });

    router.post('/requests/:requestId/signals/prepare', async (req, res) => {
        try {
            const requestId = asRequiredString(req.params.requestId);
            const actorPubkey = asRequiredString(req.body?.actorPubkey);
            const value = normalizeGovernanceSignalValue(req.body?.value);
            if (!requestId || !actorPubkey || !value) {
                res.status(400).json({ error: 'invalid_governance_signal_input' });
                return;
            }
            if (!parseCanonicalSolanaPublicKey(actorPubkey)) {
                res.status(400).json({ error: 'invalid_governance_signal_actor_pubkey' });
                return;
            }
            const request = await prisma.governanceRequest.findUnique({
                where: { id: requestId },
                include: {
                    policyVersionRecord: true,
                    snapshot: true,
                    signals: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
                    invocation: {
                        select: {
                            id: true,
                            payloadDigest: true,
                            subjectType: true,
                            subjectRef: true,
                            contractVersion: { select: { actionType: true } },
                        },
                    },
                    governanceCase: {
                        select: {
                            id: true,
                            primaryRequestId: true,
                            invocationId: true,
                            briefSnapshotDigest: true,
                            decisionStagePlan: true,
                            decisionStagePlanDigest: true,
                        },
                    },
                },
            }) as any;
            if (!request) {
                res.status(404).json({ error: 'governance_request_not_found' });
                return;
            }
            if (request.state !== 'active') {
                res.status(409).json({ error: 'governance_request_not_active' });
                return;
            }
            assertSignalRequestExecutionMode(request);
            assertGovernanceRequestFrozenFacts(request);
            assertGovernanceSignalChoiceSupported(request, value);
            const config = resolveGovernanceSignalEnvelopeConfigForRequest(
                governanceSignalEnvelopeRequestFacts(request),
            );
            const submission = normalizeGovernanceSignalSubmission(
                request,
                value,
                req.body?.evidence,
            );
            const now = new Date();
            if (request.expiresAt && new Date(request.expiresAt).getTime() <= now.getTime()) {
                await expireGovernanceRequestAtomically(prisma as any, {
                    requestId,
                    now,
                    evaluate: evaluateGovernanceRequestThreshold,
                    onTerminal: ({ tx, request: expiredRequest, decision, now: terminalAt }) =>
                        applyGovernanceCaseDecisionResolution(tx, {
                            request: expiredRequest,
                            decision,
                            now: terminalAt,
                        }).then(() => undefined),
                });
                res.status(409).json({ error: 'governance_request_expired' });
                return;
            }
            const eligibleActors = normalizeEligibleActors(request.snapshot?.eligibleActors);
            if (!eligibleActors.some((actor) => governanceActorPublicKeysEqual(actor.pubkey, actorPubkey))) {
                res.status(403).json({ error: 'governance_signal_actor_not_eligible' });
                return;
            }
            const ruleConfig = findGovernanceRuleConfig(
                request.policyVersionRecord?.rules,
                request.ruleId,
            );
            const existingSignal = Array.isArray(request.signals)
                ? request.signals.find((signal: any) => (
                    signal.signalType === submission.signalType
                    && governanceActorPublicKeysEqual(signal.actorPubkey, actorPubkey)
                ))
                : null;
            if (existingSignal && ruleConfig.voteReplacement?.mode === 'not_allowed') {
                res.status(409).json({ error: 'governance_signal_replacement_not_allowed' });
                return;
            }
            const prepared = prepareGovernanceSignalEnvelopeV2({
                config,
                request: governanceSignalEnvelopeRequestFacts(request),
                actorPubkey,
                signal: submission.signedSignal,
                nonce: randomUUID(),
                now,
            });
            await persistPendingGovernanceSignalChallenge(redis, {
                schemaVersion: 1,
                authority: 'server_owned_ttl_challenge',
                requestId,
                caseId: prepared.envelope.caseId,
                actorPubkey,
                submission: {
                    value,
                    evidence: submission.evidence,
                },
                challenge: prepared,
                expiresAt: prepared.envelope.expiresAt,
            }, now);
            res.status(200).json(prepared);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'governance_signal_prepare_failed';
            res.status(400).json({ error: message });
        }
    });

    router.get('/requests/:requestId/signals/pending', async (req, res) => {
        try {
            const requestId = asRequiredString(req.params.requestId);
            const actorPubkey = asRequiredString(req.query?.actorPubkey);
            if (!requestId || !actorPubkey || !parseCanonicalSolanaPublicKey(actorPubkey)) {
                res.status(400).json({ error: 'invalid_governance_signal_resume_input' });
                return;
            }
            const actor = await requireAuthenticatedActor(req, prisma, {
                requireSessionCookie: true,
            });
            if (!governanceActorPublicKeysEqual(actor.pubkey, actorPubkey)) {
                res.status(403).json({ error: 'governance_signal_resume_actor_mismatch' });
                return;
            }
            const pending = await readPendingGovernanceSignalChallenge(redis, {
                requestId,
                actorPubkey,
            });
            res.status(200).json({ pending });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error
                    ? error.message
                    : 'governance_signal_resume_failed',
            });
        }
    });

    router.post('/requests/:requestId/signals', async (req, res) => {
        try {
            const requestId = asRequiredString(req.params.requestId);
            const actorPubkey = asRequiredString(req.body?.actorPubkey);
            const value = normalizeGovernanceSignalValue(req.body?.value);
            const signedMessage = asRequiredString(req.body?.signedMessage);
            const signature = asRequiredString(req.body?.signature);
            const nonce = asRequiredString(req.body?.nonce);
            const expiresAt = asRequiredString(req.body?.expiresAt);
            if (!requestId || !actorPubkey || !value) {
                res.status(400).json({ error: 'invalid_governance_signal_input' });
                return;
            }
            if (!parseCanonicalSolanaPublicKey(actorPubkey)) {
                res.status(400).json({ error: 'invalid_governance_signal_actor_pubkey' });
                return;
            }
            if (!signedMessage || !signature || !nonce || !expiresAt) {
                res.status(401).json({ error: 'governance_signal_signature_required' });
                return;
            }
            const envelopeRequest = await prisma.governanceRequest.findUnique({
                where: { id: requestId },
                include: {
                    policyVersionRecord: true,
                    snapshot: true,
                    invocation: {
                        select: {
                            id: true,
                            payloadDigest: true,
                            subjectType: true,
                            subjectRef: true,
                            contractVersion: { select: { actionType: true } },
                        },
                    },
                    governanceCase: {
                        select: {
                            id: true,
                            primaryRequestId: true,
                            invocationId: true,
                            briefSnapshotDigest: true,
                            decisionStagePlan: true,
                            decisionStagePlanDigest: true,
                        },
                    },
                },
            }) as any;
            if (!envelopeRequest) {
                res.status(404).json({ error: 'governance_request_not_found' });
                return;
            }
            assertSignalRequestExecutionMode(envelopeRequest);
            assertGovernanceRequestFrozenFacts(envelopeRequest);
            assertGovernanceSignalChoiceSupported(envelopeRequest, value);
            const config = resolveGovernanceSignalEnvelopeConfigForRequest(
                governanceSignalEnvelopeRequestFacts(envelopeRequest),
            );
            const submission = normalizeGovernanceSignalSubmission(
                envelopeRequest,
                value,
                req.body?.evidence,
            );
            const now = new Date();
            if (
                envelopeRequest.expiresAt
                && new Date(envelopeRequest.expiresAt).getTime() <= now.getTime()
            ) {
                await expireGovernanceRequestAtomically(prisma as any, {
                    requestId,
                    now,
                    evaluate: evaluateGovernanceRequestThreshold,
                    onTerminal: ({ tx, request: expiredRequest, decision, now: terminalAt }) =>
                        applyGovernanceCaseDecisionResolution(tx, {
                            request: expiredRequest,
                            decision,
                            now: terminalAt,
                        }).then(() => undefined),
                });
                res.status(409).json({ error: 'governance_request_expired' });
                return;
            }
            const verifiedEnvelope = verifyGovernanceSignalEnvelopeV2({
                config,
                request: governanceSignalEnvelopeRequestFacts(envelopeRequest),
                actorPubkey,
                signal: submission.signedSignal,
                nonce,
                expiresAt,
                signedMessage,
                now,
            });
            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                res.status(401).json({ error: 'invalid_governance_signal_signature' });
                return;
            }
            const outcome = await recordAndResolveGovernanceSignalAtomically(
                prisma as any,
                {
                    requestId,
                    now: new Date(),
                    signal: {
                        id: asOptionalString(req.body?.id) ?? randomUUID(),
                        requestId,
                        signalType: submission.signalType,
                        actorPubkey,
                        value: submission.value,
                        weight: '1',
                        evidence: submission.evidence,
                        signature,
                        signedMessage,
                        externalClaimNonce: null,
                        envelopeVersion: verifiedEnvelope.envelope.v,
                        envelopeDomain: verifiedEnvelope.envelope.domain,
                        envelopeNetwork: verifiedEnvelope.envelope.network,
                        walletSignalNonce: verifiedEnvelope.envelope.nonce,
                        envelopeExpiresAt: new Date(verifiedEnvelope.envelope.expiresAt),
                        payloadDigest: verifiedEnvelope.envelope.payloadDigest,
                        policyDigest: verifiedEnvelope.envelope.policyDigest,
                        snapshotDigest: verifiedEnvelope.envelope.snapshotDigest,
                        envelopeDigest: verifiedEnvelope.envelopeDigest,
                        createdAt: new Date(),
                    },
                    replacementPolicy: findGovernanceRuleConfig(
                        envelopeRequest.policyVersionRecord?.rules,
                        envelopeRequest.ruleId,
                    ).voteReplacement,
                    evaluate: evaluateGovernanceRequestThreshold,
                    onTerminal: ({ tx, request, decision, now }) =>
                        applyGovernanceCaseDecisionResolution(tx, { request, decision, now })
                            .then(() => undefined),
                },
            );
            const { request, signal, decision } = outcome;
            let execution = null;
            if (
                decision?.decision === 'accepted'
                && request.executionMode !== 'stage_decision_only'
            ) {
                execution = await executeAcceptedGovernanceRequest({
                    prisma: prisma as any,
                    redis: redis as any,
                    registry: createDefaultGovernanceExecutionRegistry(),
                    request: {
                        id: request.id,
                        actionType: request.actionType,
                        targetType: request.targetType,
                        targetRef: String(request.targetRef ?? ''),
                        payload: normalizeJsonRecord(request.payload),
                        proposerPubkey: asOptionalString(request.proposerPubkey) ?? 'governance',
                        homeIdentityBindingId: request.homeIdentityBindingId ?? null,
                        invocationId: request.invocationId ?? null,
                        idempotencyKey: request.idempotencyKey ?? null,
                        state: 'accepted',
                        executionMode: request.executionMode ?? null,
                        executionModeDigest: request.executionModeDigest ?? null,
                        compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
                        executionAuthorizationStatus: request.executionAuthorizationStatus ?? null,
                    },
                    source: 'auto_after_decision',
                    decisionDigest: decision.decisionDigest,
                });
            } else if (
                decision?.decision === 'rejected'
                && request.executionMode === 'legacy_action_checkpoint'
            ) {
                await recordCircleGovernanceBindingRejectedDecision(prisma as any, {
                    id: request.id,
                    actionType: request.actionType,
                    targetType: request.targetType,
                    targetRef: String(request.targetRef ?? ''),
                    payload: normalizeJsonRecord(request.payload),
                }, {
                    decisionDigest: decision.decisionDigest,
                });
            }
            res.status(201).json({ signal, decision, execution });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'governance_signal_record_failed';
            const status = message === 'governance_request_not_found'
                ? 404
                : message === 'governance_request_not_active'
                    || message === 'governance_request_expired'
                    || message === 'governance_request_terminal_transition_conflict'
                    || message === 'governance_request_decision_state_mismatch'
                    ? 409
                    : message === 'governance_signal_actor_not_eligible'
                        ? 403
                        : 400;
            res.status(status).json({ error: message });
        }
    });

    router.post('/requests/:requestId/execute', async (req, res) => {
        try {
            if (sendPrivateSidecarRequired(res)) return;
            const requestId = asRequiredString(req.params.requestId);
            if (!requestId) {
                res.status(400).json({ error: 'invalid_governance_request_id' });
                return;
            }
            const actor = await requireGovernanceActor(req);
            const request = await (prisma as any).governanceRequest.findUnique({
                where: { id: requestId },
                include: {
                    decision: {
                        select: { decisionDigest: true },
                    },
                    governanceCase: {
                        select: {
                            blockers: {
                                where: { code: 'funding_amendment_required' },
                                select: { status: true, closedAt: true },
                            },
                        },
                    },
                },
            });
            if (!request) {
                res.status(404).json({ error: 'governance_request_not_found' });
                return;
            }
            if (request.state !== 'accepted') {
                res.status(409).json({ error: 'governance_request_not_executable' });
                return;
            }
            if (AUTOMATIC_ONLY_CIRCLE_BINDING_ACTIONS.has(String(request.actionType || ''))) {
                res.status(409).json({ error: 'automatic_execution_required' });
                return;
            }
            if (request.targetType === 'circle') {
                const circleId = Number(request.targetRef);
                if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                    res.status(409).json({ error: 'governance_request_circle_target_invalid' });
                    return;
                }
                await requireCircleManagerForActor(prisma, {
                    actor,
                    circleId,
                    allowModerator: false,
                });
            }
            try {
                assertGovernanceFundingAmendmentManualRetryConfirmation({
                    blockers: request.governanceCase?.blockers,
                    confirmation: req.body?.confirmation,
                });
            } catch (error) {
                if (error instanceof Error
                    && error.message === 'governance_funding_amendment_retry_confirmation_required') {
                    res.status(409).json({ error: error.message });
                    return;
                }
                throw error;
            }
            const execution = await executeAcceptedGovernanceRequest({
                prisma: prisma as any,
                redis: redis as any,
                registry: createDefaultGovernanceExecutionRegistry(),
                request: {
                    id: request.id,
                    actionType: request.actionType,
                    targetType: request.targetType,
                    targetRef: String(request.targetRef ?? ''),
                    payload: normalizeJsonRecord(request.payload),
                    proposerPubkey: asOptionalString(request.proposerPubkey) ?? 'governance',
                    homeIdentityBindingId: request.homeIdentityBindingId ?? null,
                    invocationId: request.invocationId ?? null,
                    idempotencyKey: request.idempotencyKey ?? null,
                    state: request.state,
                    executionMode: request.executionMode ?? null,
                    executionModeDigest: request.executionModeDigest ?? null,
                    compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
                    executionAuthorizationStatus: request.executionAuthorizationStatus ?? null,
                },
                source: 'manual_retry',
                decisionDigest: asOptionalString(request.decision?.decisionDigest),
            });
            res.status(200).json({ requestId, execution });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_request_execution_failed',
            });
        }
    });

    router.post('/requests/:requestId/execution-receipts', async (req, res) => {
        try {
            if (sendPrivateSidecarRequired(res)) return;
            const requestId = asRequiredString(req.params.requestId);
            const actionType = asRequiredString(req.body?.actionType);
            const executorModule = asRequiredString(req.body?.executorModule);
            const executionStatus = asRequiredString(req.body?.executionStatus);
            const idempotencyKey = asRequiredString(req.body?.idempotencyKey);
            if (
                !requestId
                || !actionType
                || !executorModule
                || !idempotencyKey
                || !['executed', 'failed', 'skipped'].includes(executionStatus ?? '')
            ) {
                res.status(400).json({ error: 'invalid_governance_execution_receipt_input' });
                return;
            }
            const request = await (prisma as any).governanceRequest.findUnique({
                where: { id: requestId },
                select: {
                    id: true,
                    actionType: true,
                    state: true,
                    executionMode: true,
                    decision: { select: { decisionDigest: true } },
                    governanceCase: { select: { id: true } },
                },
            });
            if (!request) {
                res.status(404).json({ error: 'governance_request_not_found' });
                return;
            }
            if (request.actionType !== actionType) {
                res.status(409).json({ error: 'governance_execution_receipt_action_mismatch' });
                return;
            }
            if (request.state !== 'accepted') {
                res.status(409).json({ error: 'governance_request_not_executable' });
                return;
            }
            if (
                executionStatus === 'executed'
                && request.executionMode === 'stage_decision_only'
            ) {
                res.status(409).json({ error: 'governance_manual_execution_review_required' });
                return;
            }
            const definition = createDefaultGovernanceExecutionRegistry().get(actionType);
            if (!definition) {
                res.status(409).json({ error: 'governance_execution_receipt_action_not_registered' });
                return;
            }
            if (definition.executionAdapter !== executorModule) {
                res.status(409).json({ error: 'governance_execution_receipt_executor_mismatch' });
                return;
            }
            const existingTerminal = await findTerminalExecutionReceipt(prisma, {
                requestId,
                actionType,
                executorModule,
            });
            if (
                existingTerminal
                && (
                    existingTerminal.executionStatus !== executionStatus
                    || existingTerminal.idempotencyKey !== idempotencyKey
                )
            ) {
                res.status(409).json({ error: 'governance_execution_receipt_terminal_state_exists' });
                return;
            }

            const receipt = await recordExecutionReceipt(
                createPrismaGovernanceEngineStore(prisma),
                {
                    id: asOptionalString(req.body?.id) ?? randomUUID(),
                    requestId,
                    actionType,
                    executorModule,
                    executionStatus: executionStatus as 'executed' | 'failed' | 'skipped',
                    executionRef: asOptionalString(req.body?.executionRef),
                    errorCode: asOptionalString(req.body?.errorCode),
                    decisionDigest: asOptionalString(request.decision?.decisionDigest),
                    idempotencyKey,
                    executedAt: new Date(),
                },
            );
            res.status(201).json({ receipt });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_execution_receipt_record_failed',
            });
        }
    });

    router.get('/requests/:requestId/audit', async (req, res) => {
        try {
            const requestId = asRequiredString(req.params.requestId);
            if (!requestId) {
                res.status(400).json({ error: 'invalid_governance_request_id' });
                return;
            }
            const request = await prisma.governanceRequest.findUnique({
                where: { id: requestId },
                include: {
                    policyVersionRecord: {
                        select: {
                            configDigest: true,
                        },
                    },
                    snapshot: true,
                    signals: {
                        orderBy: { createdAt: 'asc' },
                    },
                    decision: true,
                    receipts: {
                        orderBy: { executedAt: 'asc' },
                    },
                },
            }) as unknown as (null | {
                id: string;
                policyId: string;
                policyVersionId: string;
                policyVersion: number;
                ruleId: string;
                scopeType: string;
                scopeRef: string;
                actionType: string;
                targetType: string;
                targetRef: string;
                payload: Record<string, unknown>;
                idempotencyKey: string;
                proposerPubkey: string;
                state: string;
                openedAt: Date;
                expiresAt: Date | null;
                policyVersionRecord?: { configDigest?: string | null } | null;
                snapshot?: { sourceDigest?: string | null } | null;
                signals?: Array<any>;
                decision?: { decisionDigest?: string | null } | null;
                receipts?: Array<any>;
            });
            if (!request) {
                res.status(404).json({ error: 'governance_request_not_found' });
                return;
            }
            const projection = await resolveGovernanceRequestReadProjection(
                req,
                prisma,
                request,
            );

            const digestSet: GovernanceAuditDigestSet = buildGovernanceAuditDigestSet({
                request,
                snapshot: request.snapshot ?? null,
                signals: request.signals ?? [],
                decision: request.decision ?? null,
                receipts: request.receipts ?? [],
            });
            const anchorPackage: GovernanceAuditAnchorPackage = buildGovernanceAuditAnchorPackage({
                request,
                digestSet,
                executionCompatibility: governanceExecutionCompatibility(request),
            });

            res.json({
                projection,
                audit: {
                    requestId,
                    ...projectGovernanceDecisionExecutionStatus(request),
                    digestSet,
                    anchorPayload: anchorPackage.anchorPayload,
                    memoText: anchorPackage.memoText,
                    executionCompatibility: governanceExecutionCompatibility(request),
                    settlement: {
                        adapterId: 'solana-l1',
                        chainFamily: 'svm',
                        submissionStatus: 'not_submitted',
                    },
                },
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_audit_lookup_failed',
            });
        }
    });

    return router;
}

async function attachProviderResourceReadback(
    prisma: PrismaClient,
    request: any,
): Promise<any> {
    const originalCase = typeof (prisma as any).governanceCase?.findUnique === 'function'
        ? await (prisma as any).governanceCase.findUnique({
            where: { primaryRequestId: request.id },
            select: {
                id: true,
                relatedCases: {
                    where: { relationshipKind: 'supersedes' },
                    orderBy: { openedAt: 'desc' },
                    select: {
                        id: true,
                        caseType: true,
                        subjectType: true,
                        subjectRef: true,
                        relationshipKind: true,
                        relatedCaseId: true,
                        requestedActionPayload: true,
                        briefDraftPostId: true,
                        briefDraftVersion: true,
                        briefSnapshotDigest: true,
                        primaryRequest: {
                            select: {
                                id: true,
                                state: true,
                                decision: true,
                            },
                        },
                        decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
                        responsibilities: { orderBy: { kind: 'asc' } },
                    },
                },
            },
        })
        : null;
    const requestWithTerminalAbandonment = {
        ...request,
        governanceCase: originalCase ? { id: originalCase.id } : null,
        providerExecutionTerminalAbandonmentCases: originalCase?.relatedCases ?? [],
    };
    let resourceBindingId = providerResourceBindingIdFromRequest(request);
    const resourceDelegate = (prisma as any).governedResourceBinding;
    if (!resourceBindingId && request?.actionType === 'circle.grant.payout.execute') {
        if (!resourceDelegate?.findFirst) return requestWithTerminalAbandonment;
        const requestOwnedGrantResource = await resourceDelegate.findFirst({
            where: {
                sourceRequestId: request.id,
                capability: 'grant_settlement',
            },
            orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
            select: { id: true },
        });
        resourceBindingId = requestOwnedGrantResource?.id ?? null;
    }
    const decisionOutputArtifacts = typeof (prisma as any).decisionOutputArtifact?.findMany
        === 'function'
        ? await (prisma as any).decisionOutputArtifact.findMany({
            where: { decisionRequestId: request.id },
            orderBy: { ordinal: 'asc' },
        })
        : [];
    if (!resourceBindingId || !resourceDelegate?.findUnique) {
        return { ...requestWithTerminalAbandonment, decisionOutputArtifacts };
    }
    const providerResourceBinding = await resourceDelegate.findUnique({
        where: { id: resourceBindingId },
        select: {
            id: true,
            status: true,
            network: true,
            provider: true,
            capability: true,
            resourceType: true,
            purpose: true,
            profileRef: true,
            profileVersion: true,
            resourceRef: true,
            ownerProgramRef: true,
            verifiedSlot: true,
            stateDigest: true,
            sourceRequestId: true,
            sourceDecisionDigest: true,
            verification: true,
            authorityBindings: {
                orderBy: { authorityRole: 'asc' },
            },
        },
    });
    const requestDecisionDigest = request?.decision?.decisionDigest;
    const terminalLinked = Array.isArray(request?.receipts)
        && request.receipts.some((receipt: any) => (
            ['realms_provider_binding', 'squads_provider_binding'].includes(
                String(receipt?.executorModule),
            )
            && receipt?.executionStatus === 'executed'
            && receipt?.decisionDigest === requestDecisionDigest
            && (
                receipt?.executionEvidence?.resourceBindingId === resourceBindingId
                || receipt?.executionEvidence?.grantResourceBindingId === resourceBindingId
            )
        ));
    const preflight = Array.isArray(request?.invocation?.costPreflights)
        ? request.invocation.costPreflights[0]
        : null;
    const preflightLinked = request?.decision?.decision === 'accepted'
        && preflight?.quoteContext?.resourceBindingId === resourceBindingId
        && preflight?.payerPolicyRef === preflight?.payerPolicy?.id
        && preflight?.payerPolicy?.sourceRequestId === request?.id
        && preflight?.payerPolicy?.sourceDecisionDigest === requestDecisionDigest;
    const directLineage = providerResourceBinding?.sourceRequestId === request?.id
        && providerResourceBinding?.sourceDecisionDigest === requestDecisionDigest;
    if (
        !providerResourceBinding
        || typeof requestDecisionDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(requestDecisionDigest)
        || (!directLineage && !terminalLinked && !preflightLinked)
    ) return { ...requestWithTerminalAbandonment, decisionOutputArtifacts };
    return {
        ...requestWithTerminalAbandonment,
        providerResourceBinding,
        decisionOutputArtifacts,
    };
}

function isGovernanceCaseIntakeOriginKind(
    value: string | null,
): value is GovernanceCaseIntakeOriginKind {
    return value === 'manual_item'
        || value === 'plaza_selection'
        || value === 'public_url'
        || value === 'external_proposal';
}
