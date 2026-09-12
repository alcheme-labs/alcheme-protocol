import { Prisma, type PrismaClient } from '@prisma/client';

import {
    serviceConfig,
    type ContributionAssessmentProviderMode,
    type ContributionAssessmentRolloutMode,
} from '../../config/services';
import {
    type DraftContributorProofRecord,
    getDraftContributorProof,
} from '../contributorProof';
import {
    resolveDraftLifecycleReadModel,
} from '../draftLifecycle/readModel';
import {
    getCollabEditAnchorById,
    verifyCollabEditAnchor,
} from '../collabEditAnchor';
import {
    resolveKnowledgePublicationOrigin,
} from '../crystallizationBinding';
import {
    createContributionEvidencePackage,
    hashContributionEvidencePackage,
} from './evidencePackage';
import {
    buildSourceMessageEvidenceRefsForContributorProof,
} from './sourceMessageEvidence';
import {
    buildCanonicalAllocationFromSuggestion,
    buildUnavailableCanonicalAllocation,
} from './canonicalizer';
import {
    buildDraftContributorProofFromCanonicalAllocation,
} from './proofAdapter';
import {
    createDisabledContributionAssessmentProvider,
} from './provider';
import {
    createMockContributionAssessmentProvider,
} from './mockProvider';
import {
    createAiContributionAssessmentProvider,
} from './aiProvider';
import {
    evaluateContributionAssessmentAiProviderReadiness,
} from './evals';
import {
    DEFAULT_CONTRIBUTION_POLICY_VERSION,
} from './policy';
import {
    logContributionAssessmentEvent,
    normalizeContributionAssessmentFailureForLog,
} from './logging';
import {
    validateContributionAssessmentSuggestion,
    ContributionAssessmentValidationError,
} from './validator';
import {
    persistContributionAssessment,
    readContributionAssessmentArtifactSnapshots,
    signContributionAssessmentArtifact,
    updateContributionAssessmentSignedArtifact,
    type ContributionAssessmentArtifactSnapshots,
    type PersistedContributionAssessmentRecord,
} from './artifact';
import {
    isContributionAssessmentUnavailable,
    prepareDraftContributionAssessment,
    type ContributionAssessmentPublicRecord,
    type ContributionAssessmentGate,
    type ContributionAssessmentDecisionPublicRecord,
    type PreparedContributionAssessment,
} from './decision';
import {
    CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
    type CanonicalContributionAllocation,
    type ContributionAssessmentDecisionType,
    type ContributionAssessmentStatus,
    type ContributionAssessmentSuggestion,
    type ContributionEvidenceContributor,
    type ContributionEvidenceRole,
    type ContributionEvidencePackage,
    type ContributionEvidenceRef,
    type ContributionHighPenetrationState,
    type ContributionProviderMode,
    type ContributionStage,
} from './types';

export interface ContributionAssessmentProofPreparation {
    rolloutMode: ContributionAssessmentRolloutMode;
    providerMode: ContributionAssessmentProviderMode;
    status: 'legacy' | 'not_prepared' | 'prepared' | 'needs_review' | 'fallback_applied' | 'confirmed' | 'failed';
    evidenceHash: string | null;
    assessment: PersistedContributionAssessmentRecord | null;
    gate: ContributionAssessmentGate | null;
    contributorProof: DraftContributorProofRecord | null;
    canonicalAllocation: CanonicalContributionAllocation | null;
    warning?: {
        code: string;
        message: string;
    } | null;
}

function providerForMode(mode: ContributionAssessmentProviderMode) {
    if (mode === 'mock') return createMockContributionAssessmentProvider();
    if (mode === 'ai') {
        const aiProvider = serviceConfig.contributionAssessment.aiProvider;
        if (!aiProvider) throw new Error('contribution_assessment_ai_provider_not_configured');
        const readiness = evaluateContributionAssessmentAiProviderReadiness(aiProvider);
        if (!readiness.ready) throw new Error('contribution_assessment_ai_provider_not_configured');
        return createAiContributionAssessmentProvider(aiProvider);
    }
    return createDisabledContributionAssessmentProvider();
}

function mapLifecycleSourceKind(value: string | null | undefined): 'auto_draft' | 'manual_selection' | null {
    if (value === 'accepted_candidate_v1_seed') return 'auto_draft';
    return null;
}

function mapDraftSourceClaimKind(value: unknown): 'auto_draft' | 'manual_selection' | null {
    if (value === 'auto_draft') return 'auto_draft';
    if (value === 'manual_selection') return 'manual_selection';
    return null;
}

async function resolveContributionAssessmentSourceKind(input: {
    prisma: PrismaClient;
    circleId: number;
    draftPostId: number;
    postContentType: string | null;
    lifecycleSourceKind: string | null | undefined;
    sourceMessagesDigest: string | null;
}): Promise<'auto_draft' | 'manual_selection' | null> {
    const lifecycleSourceKind = mapLifecycleSourceKind(input.lifecycleSourceKind);
    if (input.sourceMessagesDigest) {
        const delegate = (input.prisma as any).discussionDraftSourceClaim;
        if (delegate && typeof delegate.findFirst === 'function') {
            const claim = await delegate.findFirst({
                where: {
                    circleId: input.circleId,
                    draftPostId: input.draftPostId,
                    sourceMessagesDigest: input.sourceMessagesDigest,
                    status: 'succeeded',
                },
                select: {
                    sourceKind: true,
                },
                orderBy: {
                    updatedAt: 'desc',
                },
            }) as { sourceKind?: unknown } | null;
            const claimSourceKind = mapDraftSourceClaimKind(claim?.sourceKind);
            if (claimSourceKind) return claimSourceKind;
        }
    }
    if (lifecycleSourceKind) return lifecycleSourceKind;
    if (String(input.postContentType || '').trim().toLowerCase() === 'ai/discussion-draft') {
        return 'auto_draft';
    }
    return null;
}

function stageForLegacyContributor(input: {
    role: 'Author' | 'Discussant';
    postContentType: string | null;
    sourceKind: 'auto_draft' | 'manual_selection' | null;
}): ContributionStage | null {
    const isAiDraft =
        String(input.postContentType || '').toLowerCase() === 'ai/discussion-draft'
        || input.sourceKind === 'auto_draft'
        || input.sourceKind === 'manual_selection';
    if (input.role === 'Author') {
        return isAiDraft ? null : 'direct_author';
    }
    return 'source_discussion';
}

function isAiSourceBackedDraft(input: {
    postContentType: string | null;
    sourceKind: 'auto_draft' | 'manual_selection' | null;
}): boolean {
    return String(input.postContentType || '').trim().toLowerCase() === 'ai/discussion-draft'
        || input.sourceKind === 'auto_draft'
        || input.sourceKind === 'manual_selection';
}

function evidenceRoleForRef(ref: ContributionEvidenceRef): ContributionEvidenceRole {
    if (ref.stage === 'direct_author') return 'direct_author';
    if (ref.stage === 'source_selection') return 'curator';
    if (ref.stage === 'draft_modification') return 'editor';
    if (ref.stage === 'review_correction') return 'reviewer';
    return 'source_message';
}

function buildEvidenceContributorsFromRefs(
    refs: ContributionEvidenceRef[],
): ContributionEvidenceContributor[] {
    const byPubkey = new Map<string, ContributionEvidenceContributor>();
    for (const ref of refs) {
        if (!ref.contributorPubkey) continue;
        const existing = byPubkey.get(ref.contributorPubkey);
        const roles = Array.from(new Set([
            ...(existing?.evidenceRoles ?? []),
            evidenceRoleForRef(ref),
        ])).sort() as ContributionEvidenceRole[];
        byPubkey.set(ref.contributorPubkey, {
            pubkey: ref.contributorPubkey,
            userId: existing?.userId ?? null,
            handle: existing?.handle ?? null,
            evidenceRoles: roles,
        });
    }
    return [...byPubkey.values()].sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

async function loadUserEvidenceDirectory(
    prisma: PrismaClient,
    userIds: number[],
): Promise<Map<number, { pubkey: string; handle: string | null }>> {
    const ids = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
    if (ids.length === 0) return new Map();
    const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, pubkey: true, handle: true },
    });
    return new Map(users
        .filter((user) => typeof user.pubkey === 'string' && user.pubkey.trim())
        .map((user) => [user.id, { pubkey: user.pubkey, handle: user.handle }]));
}

async function buildCurrentRoleEvidenceRefs(input: {
    prisma: PrismaClient;
    draftPostId: number;
    circleId: number;
    sourceKind: 'auto_draft' | 'manual_selection' | null;
    stableSnapshot: {
        draftVersion: number;
        contentHash: string;
        sourceEditAnchorId: string | null;
        crystallizationRoutingReceipt?: any;
    };
}): Promise<ContributionEvidenceRef[]> {
    const refs: ContributionEvidenceRef[] = [];
    const receipt = input.stableSnapshot.crystallizationRoutingReceipt;
    const candidateAcceptance = input.sourceKind === 'manual_selection'
        ? await input.prisma.draftCandidateAcceptance.findUnique({
            where: { draftPostId: input.draftPostId },
            select: { acceptedByUserId: true, candidateId: true, acceptedAt: true },
        })
        : null;
    const reviewApplications = await input.prisma.draftDiscussionApplication.findMany({
        where: {
            draftPostId: input.draftPostId,
            appliedDraftVersion: input.stableSnapshot.draftVersion,
            appliedSnapshotHash: input.stableSnapshot.contentHash,
        },
        select: {
            id: true,
            threadId: true,
            appliedBy: true,
            appliedEditAnchorId: true,
            appliedSnapshotHash: true,
        },
        orderBy: [{ appliedAt: 'asc' }, { id: 'asc' }],
    });
    const reviewThreadIds = reviewApplications.map((application) => application.threadId);
    const reviewThreads = reviewThreadIds.length > 0
        ? await input.prisma.draftDiscussionThread.findMany({
            where: { id: { in: reviewThreadIds } },
            select: { id: true, createdBy: true, targetRef: true, targetVersion: true, issueType: true },
        })
        : [];
    const collabAnchor = input.stableSnapshot.sourceEditAnchorId
        ? await getCollabEditAnchorById(input.prisma, input.stableSnapshot.sourceEditAnchorId)
        : null;
    const verifiedCollabAnchor = collabAnchor
        && collabAnchor.snapshotHash === input.stableSnapshot.contentHash
        && verifyCollabEditAnchor(collabAnchor).verifiable
        ? collabAnchor
        : null;
    const collabEditorIds = verifiedCollabAnchor?.canonicalPayload?.updates
        .map((update) => update.editorUserId)
        .filter((id): id is number => Number.isInteger(id) && Number(id) > 0) ?? [];
    const routingActorUserId = Number(receipt?.actorUserId || 0);
    const directory = await loadUserEvidenceDirectory(input.prisma, [
        candidateAcceptance?.acceptedByUserId ?? 0,
        ...reviewApplications.map((application) => application.appliedBy),
        ...reviewThreads.map((thread) => thread.createdBy),
        ...collabEditorIds,
        routingActorUserId,
    ]);

    if (candidateAcceptance) {
        const actor = directory.get(candidateAcceptance.acceptedByUserId);
        if (actor) {
            refs.push({
                refId: `source-selection:${candidateAcceptance.candidateId}:${actor.pubkey}`,
                refType: 'source_selection',
                contributorPubkey: actor.pubkey,
                hash: input.stableSnapshot.contentHash,
                excerpt: null,
                stage: 'source_selection',
                retention: 'retained',
                metadata: {
                    actorRole: 'submitter',
                    contributionFunction: 'material',
                    proofContribution: true,
                    retainedSourceSelectionImpact: true,
                    acceptedAt: candidateAcceptance.acceptedAt.toISOString(),
                },
            });
        }
    }

    if (verifiedCollabAnchor?.canonicalPayload) {
        const updateCountByEditor = new Map<number, number>();
        for (const update of verifiedCollabAnchor.canonicalPayload.updates) {
            if (!Number.isInteger(update.editorUserId) || Number(update.editorUserId) <= 0) continue;
            const editorUserId = Number(update.editorUserId);
            updateCountByEditor.set(editorUserId, (updateCountByEditor.get(editorUserId) ?? 0) + 1);
        }
        for (const [editorUserId, updateCount] of updateCountByEditor.entries()) {
            const actor = directory.get(editorUserId);
            if (!actor) continue;
            refs.push({
                refId: `collab-edit:${verifiedCollabAnchor.anchorId}:${actor.pubkey}`,
                refType: 'collab_edit',
                contributorPubkey: actor.pubkey,
                hash: verifiedCollabAnchor.payloadHash,
                excerpt: null,
                stage: 'draft_modification',
                retention: 'retained',
                metadata: {
                    actorRole: 'editor',
                    contributionFunction: 'edit',
                    proofContribution: true,
                    semanticScore: updateCount,
                    updateCount,
                    snapshotHash: verifiedCollabAnchor.snapshotHash,
                },
            });
        }
    }

    const reviewThreadById = new Map(reviewThreads.map((thread) => [thread.id.toString(), thread]));
    for (const application of reviewApplications) {
        const thread = reviewThreadById.get(application.threadId.toString());
        if (thread) {
            const reviewer = directory.get(thread.createdBy);
            if (reviewer) {
                refs.push({
                    refId: `review-issue:${thread.id.toString()}:${reviewer.pubkey}`,
                    refType: 'review_issue',
                    contributorPubkey: reviewer.pubkey,
                    hash: application.appliedSnapshotHash,
                    excerpt: null,
                    stage: 'review_correction',
                    retention: 'retained',
                    metadata: {
                        actorRole: 'reviewer',
                        contributionFunction: 'review',
                        proofContribution: true,
                        targetRef: thread.targetRef,
                        targetVersion: thread.targetVersion,
                        issueType: thread.issueType,
                    },
                });
            }
        }
        const applier = directory.get(application.appliedBy);
        if (applier) {
            refs.push({
                refId: `review-application:${application.id.toString()}:${applier.pubkey}`,
                refType: 'review_application',
                contributorPubkey: applier.pubkey,
                hash: application.appliedSnapshotHash,
                excerpt: null,
                stage: 'review_correction',
                retention: 'retained',
                metadata: {
                    actorRole: 'editor',
                    contributionFunction: 'edit',
                    proofContribution: true,
                    appliedEditAnchorId: application.appliedEditAnchorId,
                },
            });
        }
    }

    const routingActor = directory.get(routingActorUserId);
    if (routingActor && receipt?.receiptDigest) {
        refs.push({
            refId: `crystallization-submitter:${receipt.receiptDigest}:${routingActor.pubkey}`,
            refType: 'draft_snapshot',
            contributorPubkey: routingActor.pubkey,
            hash: receipt.receiptDigest,
            excerpt: null,
            stage: null,
            retention: 'trace_only',
            metadata: {
                actorRole: 'submitter',
                contributionFunction: 'material',
                proofContribution: false,
                weightTreatment: 'excluded',
                reasonCode: 'submission_authority_not_proof_contribution',
            },
        });
    }

    if (receipt?.path === 'governed_case') {
        const publication = await resolveKnowledgePublicationOrigin(input.prisma, input.draftPostId);
        const governanceCaseId = publication.origin.caseId as string;
        const targetCircleId = publication.origin.targetCircleId;
        const committeeCircleId = publication.origin.committeeCircleId;
        if (targetCircleId !== input.circleId || !committeeCircleId) {
            throw new Error('governance_case_institution_facts_unavailable');
        }
        const caseRecord = await input.prisma.governanceCase.findUnique({
            where: { id: governanceCaseId },
            select: {
                id: true,
                primaryRequestId: true,
                openedByPubkey: true,
                actualOutcomeDigest: true,
                outcomeRecordedByPubkey: true,
                responsibilities: {
                    select: { kind: true, assigneePubkey: true, status: true },
                },
                timelineEvents: {
                    where: {
                        eventType: { in: ['brief_claim_evidence_bound', 'review_conclusion_recorded'] },
                    },
                    select: {
                        id: true,
                        eventType: true,
                        actorPubkey: true,
                        briefSnapshotDigest: true,
                        claimDigest: true,
                        sourceMaterialChunkDigest: true,
                    },
                },
            },
        });
        if (!caseRecord) {
            throw new Error('governance_case_role_facts_unavailable');
        }
        const requestId = publication.origin.requestId as string;
        const signals = await input.prisma.governanceSignal.findMany({
            where: { requestId },
            select: { id: true, actorPubkey: true, envelopeDigest: true, payloadDigest: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        if (caseRecord.openedByPubkey) {
            refs.push({
                refId: `governance-proposal:${caseRecord.id}:${caseRecord.openedByPubkey}`,
                refType: 'governance_claim',
                contributorPubkey: caseRecord.openedByPubkey,
                hash: input.stableSnapshot.contentHash,
                excerpt: null,
                stage: null,
                retention: 'trace_only',
                metadata: {
                    actorRole: 'proposal_author',
                    contributionFunction: 'claim',
                    proofContribution: false,
                    weightTreatment: 'excluded',
                    reasonCode: 'proposal_authorship_without_bound_claim_proof',
                    governanceCaseId,
                    governanceRequestId: requestId,
                    institutionRole: 'target',
                    institutionCircleId: targetCircleId,
                },
            });
        }
        for (const event of caseRecord.timelineEvents) {
            if (!event.actorPubkey) continue;
            const isClaim = event.eventType === 'brief_claim_evidence_bound';
            refs.push({
                refId: `governance-${isClaim ? 'claim' : 'review'}:${event.id}`,
                refType: isClaim ? 'governance_claim' : 'review_application',
                contributorPubkey: event.actorPubkey,
                hash: isClaim
                    ? event.sourceMaterialChunkDigest ?? event.claimDigest
                    : event.briefSnapshotDigest,
                excerpt: null,
                stage: isClaim ? null : 'review_correction',
                retention: isClaim ? 'trace_only' : 'retained',
                metadata: {
                    actorRole: isClaim ? 'proposal_author' : 'reviewer',
                    contributionFunction: isClaim ? 'claim' : 'review',
                    proofContribution: true,
                    governanceCaseId,
                    governanceRequestId: requestId,
                    institutionRole: isClaim ? 'target' : 'committee',
                    institutionCircleId: isClaim ? targetCircleId : committeeCircleId,
                },
            });
        }
        const executor = caseRecord.responsibilities.find((responsibility) => (
            responsibility.kind === 'execution' && responsibility.status === 'accepted'
        ));
        if (executor && publication.origin.executionReceiptId) {
            refs.push({
                refId: `governance-execution:${publication.origin.executionReceiptId}:${executor.assigneePubkey}`,
                refType: 'governance_execution',
                contributorPubkey: executor.assigneePubkey,
                hash: publication.origin.decisionDigest,
                excerpt: null,
                stage: null,
                retention: 'trace_only',
                metadata: {
                    actorRole: 'executor',
                    contributionFunction: 'execution',
                    proofContribution: true,
                    governanceCaseId,
                    governanceRequestId: requestId,
                    institutionRole: 'target',
                    institutionCircleId: targetCircleId,
                },
            });
        }
        if (caseRecord.outcomeRecordedByPubkey && caseRecord.actualOutcomeDigest) {
            refs.push({
                refId: `governance-outcome:${governanceCaseId}:${caseRecord.outcomeRecordedByPubkey}`,
                refType: 'governance_outcome',
                contributorPubkey: caseRecord.outcomeRecordedByPubkey,
                hash: caseRecord.actualOutcomeDigest,
                excerpt: null,
                stage: null,
                retention: 'trace_only',
                metadata: {
                    actorRole: 'outcome_reviewer',
                    contributionFunction: 'outcome',
                    proofContribution: true,
                    governanceCaseId,
                    governanceRequestId: requestId,
                    institutionRole: 'committee',
                    institutionCircleId: committeeCircleId,
                },
            });
        }
        for (const signal of signals) {
            if (!signal.actorPubkey) continue;
            refs.push({
                refId: `governance-vote:${signal.id}:${signal.actorPubkey}`,
                refType: 'governance_vote',
                contributorPubkey: signal.actorPubkey,
                hash: signal.envelopeDigest ?? signal.payloadDigest,
                excerpt: null,
                stage: null,
                retention: 'excluded',
                metadata: {
                    actorRole: 'voter',
                    proofContribution: false,
                    weightTreatment: 'excluded',
                    reasonCode: 'vote_only_excluded',
                    governanceCaseId,
                    governanceRequestId: requestId,
                    institutionRole: 'committee',
                    institutionCircleId: committeeCircleId,
                },
            });
        }
        refs.push({
            refId: `automation-trigger:${receipt.receiptDigest}`,
            refType: 'automation_trigger',
            contributorPubkey: null,
            hash: receipt.receiptDigest,
            excerpt: null,
            stage: null,
            retention: 'excluded',
            metadata: {
                actorRole: 'trigger',
                proofContribution: false,
                weightTreatment: 'excluded',
                reasonCode: 'unproved_automation_excluded',
                governanceCaseId,
                governanceRequestId: requestId,
                institutionRole: 'target',
                institutionCircleId: targetCircleId,
            },
        });
    }

    return refs;
}

function buildUnavailableSuggestion(input: {
    evidence: ContributionEvidencePackage;
    allocation: CanonicalContributionAllocation;
    providerMode: ContributionProviderMode;
    warningCode: string;
    warningMessage: string;
}): ContributionAssessmentSuggestion {
    return {
        schemaVersion: CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
        provider: input.providerMode,
        algorithmVersion: input.allocation.algorithmVersion,
        framePolicyVersion: input.allocation.framePolicyVersion || DEFAULT_CONTRIBUTION_POLICY_VERSION,
        inputHash: hashContributionEvidencePackage(input.evidence),
        confidence: 0,
        frames: [],
        highPenetrationCandidates: [],
        warnings: [{
            code: input.warningCode,
            evidenceRefs: [],
            message: input.warningMessage,
        }],
    };
}

function withSuggestionWarning(input: {
    suggestion: ContributionAssessmentSuggestion;
    warningCode: string;
    warningMessage: string;
}): ContributionAssessmentSuggestion {
    return {
        ...input.suggestion,
        warnings: [
            ...input.suggestion.warnings,
            {
                code: input.warningCode,
                evidenceRefs: [],
                message: input.warningMessage,
            },
        ],
    };
}

function mapAllocationToAssessmentStatus(allocation: CanonicalContributionAllocation): {
    status: ContributionAssessmentStatus;
    highPenetrationState: ContributionHighPenetrationState;
} {
    if (allocation.highPenetrationState === 'needs_review') {
        return { status: 'needs_review', highPenetrationState: 'needs_review' };
    }
    if (allocation.highPenetrationState === 'fallback_applied') {
        return { status: 'fallback_applied', highPenetrationState: 'fallback_applied' };
    }
    if (allocation.highPenetrationState === 'confirmed') {
        return { status: 'confirmed', highPenetrationState: 'confirmed' };
    }
    if (allocation.highPenetrationState === 'rejected') {
        return { status: 'confirmed', highPenetrationState: 'rejected' };
    }
    return { status: 'prepared', highPenetrationState: 'none' };
}

function decisionsForCanonicalizer(
    decisions: ContributionAssessmentDecisionPublicRecord[],
) {
    return decisions
        .filter((decision) => isCanonicalAllocationDecisionType(decision.decisionType))
        .map((decision) => ({
            decisionType: decision.decisionType,
            candidateId: decision.candidateId,
            actorUserId: decision.actorUserId,
            actorPubkey: decision.actorPubkey,
            reason: decision.reason,
            affectedRefs: decision.affectedRefs,
        }));
}

function isCanonicalAllocationDecisionType(
    value: ContributionAssessmentDecisionType,
): boolean {
    return value === 'confirm_high_penetration'
        || value === 'reject_high_penetration'
        || value === 'continue_with_fallback';
}

function statusForPreparation(
    status: ReturnType<typeof mapAllocationToAssessmentStatus>['status'],
): ContributionAssessmentProofPreparation['status'] {
    if (status === 'needs_review') return 'needs_review';
    if (status === 'fallback_applied') return 'fallback_applied';
    if (status === 'confirmed') return 'confirmed';
    return 'prepared';
}

function isUnavailableCanonicalAllocation(allocation: CanonicalContributionAllocation): boolean {
    const algorithmVersion = allocation.algorithmVersion.toLowerCase();
    return algorithmVersion.endsWith(':assessment-unavailable:v1')
        || algorithmVersion.endsWith(':fallback-decision-unavailable:v1')
        || algorithmVersion.endsWith(':empty-unavailable:v1')
        || algorithmVersion.includes('deterministic-fallback');
}

function providerModeCanProduceRealAssessment(providerMode: ContributionAssessmentProviderMode): boolean {
    if (providerMode === 'mock') return true;
    if (providerMode === 'disabled') return false;
    const aiProvider = serviceConfig.contributionAssessment.aiProvider;
    if (!aiProvider) return false;
    return evaluateContributionAssessmentAiProviderReadiness(aiProvider).ready;
}

function mapPublicAssessmentToPersisted(
    assessment: ContributionAssessmentPublicRecord,
): PersistedContributionAssessmentRecord {
    return {
        id: BigInt(assessment.id),
        draftPostId: assessment.draftPostId,
        proofPackageId: assessment.proofPackageId ? BigInt(assessment.proofPackageId) : null,
        proofPackageHash: assessment.proofPackageHash,
        algorithmVersion: assessment.algorithmVersion,
        framePolicyVersion: assessment.framePolicyVersion,
        inputHash: assessment.inputHash,
        outputHash: assessment.outputHash,
        canonicalAllocationHash: assessment.canonicalAllocationHash,
        canonicalContributorsRoot: assessment.canonicalContributorsRoot,
        canonicalContributorsCount: assessment.canonicalContributorsCount,
        status: assessment.status,
        highPenetrationState: assessment.highPenetrationState,
        signerKeyId: assessment.signerKeyId,
        signature: assessment.signature,
        createdAt: assessment.createdAt,
        updatedAt: assessment.updatedAt,
    };
}

async function loadAssessmentArtifactSnapshots(input: {
    prisma: PrismaClient;
    draftPostId: number;
    assessmentId: string;
}): Promise<ContributionAssessmentArtifactSnapshots | null> {
    const rows = await input.prisma.$queryRaw<Array<{
        signedArtifact: unknown;
        inputHash: string;
        outputHash: string;
        canonicalAllocationHash: string;
        signerKeyId: string;
        signature: string;
    }>>(Prisma.sql`
        SELECT
            signed_artifact AS "signedArtifact",
            input_hash AS "inputHash",
            output_hash AS "outputHash",
            canonical_allocation_hash AS "canonicalAllocationHash",
            signer_key_id AS "signerKeyId",
            signature
        FROM contribution_assessments
        WHERE draft_post_id = ${input.draftPostId}
          AND id = ${BigInt(input.assessmentId)}
        LIMIT 1
    `);
    const row = rows[0] ?? null;
    if (!row) return null;
    return readContributionAssessmentArtifactSnapshots(row);
}

function resolveAllocationFromArtifactSnapshots(input: {
    snapshots: ContributionAssessmentArtifactSnapshots;
    decisions: ContributionAssessmentDecisionPublicRecord[];
    fallbackOnUnconfirmedHighPenetration: boolean;
    useStoredAllocation?: boolean;
}): CanonicalContributionAllocation {
    const decisions = decisionsForCanonicalizer(input.decisions);
    if (input.useStoredAllocation || decisions.length === 0) {
        return input.snapshots.canonicalAllocation;
    }
    return buildCanonicalAllocationFromSuggestion({
        evidence: input.snapshots.evidence,
        suggestion: input.snapshots.suggestion,
        decisions,
        fallbackOnUnconfirmedHighPenetration: input.fallbackOnUnconfirmedHighPenetration,
    });
}

function isProofLinkedAssessment(assessment: ContributionAssessmentPublicRecord): boolean {
    return Boolean(assessment.proofPackageHash)
        && Boolean(assessment.canonicalContributorsRoot)
        && Number(assessment.canonicalContributorsCount ?? 0) > 0;
}

function buildContributorProofIfAvailable(input: {
    evidence: ContributionEvidencePackage;
    allocation: CanonicalContributionAllocation;
}): {
    status: ReturnType<typeof mapAllocationToAssessmentStatus>;
    contributorProof: DraftContributorProofRecord | null;
} {
    const status = mapAllocationToAssessmentStatus(input.allocation);
    if (status.status === 'needs_review') {
        return {
            status,
            contributorProof: null,
        };
    }
    return {
        status,
        contributorProof: buildDraftContributorProofFromCanonicalAllocation(input),
    };
}

async function buildPreparationFromExistingAssessmentSnapshots(input: {
    prisma: PrismaClient;
    draftPostId: number;
    rolloutMode: ContributionAssessmentRolloutMode;
    providerMode: ContributionAssessmentProviderMode;
    existing: PreparedContributionAssessment;
    fallbackOnUnconfirmedHighPenetration: boolean;
    updateUnboundReviewedArtifact: boolean;
    warning?: ContributionAssessmentProofPreparation['warning'];
}): Promise<ContributionAssessmentProofPreparation | null> {
    if (!input.existing.assessment) return null;
    const snapshots = await loadAssessmentArtifactSnapshots({
        prisma: input.prisma,
        draftPostId: input.draftPostId,
        assessmentId: input.existing.assessment.id,
    });
    if (!snapshots) return null;
    const allocation = resolveAllocationFromArtifactSnapshots({
        snapshots,
        decisions: input.existing.decisions,
        fallbackOnUnconfirmedHighPenetration: input.fallbackOnUnconfirmedHighPenetration,
        useStoredAllocation: isProofLinkedAssessment(input.existing.assessment),
    });
    const { status, contributorProof } = buildContributorProofIfAvailable({
        evidence: snapshots.evidence,
        allocation,
    });
    let assessment = mapPublicAssessmentToPersisted(input.existing.assessment);
    if (
        input.updateUnboundReviewedArtifact
        && contributorProof
        && !isProofLinkedAssessment(input.existing.assessment)
    ) {
        const signed = signContributionAssessmentArtifact({
            evidence: snapshots.evidence,
            suggestion: snapshots.suggestion,
            canonicalAllocation: allocation,
            canonicalContributorsRoot: contributorProof.rootHex,
            canonicalContributorsCount: contributorProof.count,
            status: status.status,
        });
        assessment = await updateContributionAssessmentSignedArtifact(input.prisma, {
            assessmentId: input.existing.assessment.id,
            draftPostId: input.draftPostId,
            algorithmVersion: allocation.algorithmVersion,
            framePolicyVersion: allocation.framePolicyVersion,
            inputHash: signed.inputHash,
            outputHash: signed.outputHash,
            canonicalAllocationHash: signed.canonicalAllocationHash,
            canonicalContributorsRoot: contributorProof.rootHex,
            canonicalContributorsCount: contributorProof.count,
            status: status.status,
            highPenetrationState: status.highPenetrationState,
            signedArtifact: signed.signedArtifact as any,
            signerKeyId: signed.signerKeyId,
            signature: signed.signature,
        });
    }
    return {
        rolloutMode: input.rolloutMode,
        providerMode: input.providerMode,
        status: statusForPreparation(status.status),
        evidenceHash: hashContributionEvidencePackage(snapshots.evidence),
        assessment,
        gate: input.existing.gate,
        contributorProof,
        canonicalAllocation: allocation,
        warning: input.warning ?? null,
    };
}

export async function buildLegacyProofEvidencePackage(input: {
    prisma: PrismaClient;
    draftPostId: number;
    contributorProof?: DraftContributorProofRecord;
}): Promise<{
    evidence: ContributionEvidencePackage;
    contributorProof: DraftContributorProofRecord;
    sourceMessageEvidenceUnavailable: boolean;
}> {
    const contributorProof = input.contributorProof
        ?? await getDraftContributorProof(input.prisma, input.draftPostId);
    const post = await input.prisma.post.findUnique({
        where: { id: input.draftPostId },
        select: {
            id: true,
            circleId: true,
            authorId: true,
            contentType: true,
            text: true,
        },
    });
    if (!post) throw new Error('draft_not_found');
    if (!post.circleId) throw new Error('draft_circle_required_for_contribution_assessment');
    const lifecycle = await resolveDraftLifecycleReadModel(input.prisma, {
        draftPostId: input.draftPostId,
    });
    const sourceKind = await resolveContributionAssessmentSourceKind({
        prisma: input.prisma,
        circleId: post.circleId,
        draftPostId: input.draftPostId,
        postContentType: post.contentType,
        lifecycleSourceKind: lifecycle.stableSnapshot.sourceKind,
        sourceMessagesDigest: contributorProof.messagesDigest,
    });
    const legacyRefs: ContributionEvidenceRef[] = [];
    for (const contributor of contributorProof.contributors) {
        const stage = stageForLegacyContributor({
            role: contributor.role,
            postContentType: post.contentType,
            sourceKind,
        });
        if (!stage) continue;
        legacyRefs.push({
            refId: `legacy-proof:${contributor.role.toLowerCase()}:${contributor.pubkey}`,
            refType: contributor.role === 'Author' ? 'draft_snapshot' : 'source_message',
            contributorPubkey: contributor.pubkey,
            hash: contributor.leafHex,
            excerpt: null,
            stage,
            retention: 'retained',
            metadata: {
                source: 'legacy_contributor_proof',
                legacyWeightBps: contributor.weightBps,
            },
        });
    }
    const sourceMessageRefs = await buildSourceMessageEvidenceRefsForContributorProof({
        prisma: input.prisma,
        contributorProof,
    });
    const sourceMessageEvidenceRequired = isAiSourceBackedDraft({
        postContentType: post.contentType,
        sourceKind,
    });
    const sourceMessageEvidenceUnavailable = sourceMessageEvidenceRequired && sourceMessageRefs.length === 0;
    const directAuthorRefs = legacyRefs.filter((ref) => ref.stage === 'direct_author');
    const baseRefs = sourceMessageEvidenceRequired && sourceMessageRefs.length > 0
        ? [...directAuthorRefs, ...sourceMessageRefs]
        : sourceMessageEvidenceRequired
            ? directAuthorRefs
            : legacyRefs;
    const currentRoleRefs = await buildCurrentRoleEvidenceRefs({
        prisma: input.prisma,
        draftPostId: input.draftPostId,
        circleId: post.circleId,
        sourceKind,
        stableSnapshot: {
            draftVersion: lifecycle.stableSnapshot.draftVersion,
            contentHash: lifecycle.stableSnapshot.contentHash || contributorProof.payloadHash,
            sourceEditAnchorId: lifecycle.stableSnapshot.sourceEditAnchorId,
            crystallizationRoutingReceipt: lifecycle.stableSnapshot.crystallizationRoutingReceipt,
        },
    });
    const refs = [...baseRefs, ...currentRoleRefs];
    const contributors = buildEvidenceContributorsFromRefs(refs);

    const evidence = createContributionEvidencePackage({
        draftPostId: input.draftPostId,
        circleId: post.circleId,
        postContentType: post.contentType,
        postAuthorUserId: post.authorId,
        snapshotCreatedByUserId: null,
        sourceKind,
        sourceAnchor: {
            anchorId: contributorProof.anchorId,
            payloadHash: contributorProof.payloadHash,
            summaryHash: contributorProof.summaryHash,
            sourceMessagesDigest: contributorProof.messagesDigest,
        },
        stableSnapshot: {
            draftVersion: lifecycle.stableSnapshot.draftVersion,
            contentHash: lifecycle.stableSnapshot.contentHash || contributorProof.payloadHash,
            sourceEditAnchorId: lifecycle.stableSnapshot.sourceEditAnchorId,
            sourceSummaryHash: lifecycle.stableSnapshot.sourceSummaryHash,
            sourceMessagesDigest: lifecycle.stableSnapshot.sourceMessagesDigest,
        },
        contributors,
        evidenceRefs: refs,
        finalContent: post.text || '',
    });
    return { evidence, contributorProof, sourceMessageEvidenceUnavailable };
}

export async function readContributionAssessmentProofForDraft(input: {
    prisma: PrismaClient;
    draftPostId: number;
    rolloutMode?: ContributionAssessmentRolloutMode;
    providerMode?: ContributionAssessmentProviderMode;
    fallbackOnUnconfirmedHighPenetration?: boolean;
}): Promise<ContributionAssessmentProofPreparation> {
    const rolloutMode = input.rolloutMode ?? serviceConfig.contributionAssessment.rolloutMode;
    const providerMode = input.providerMode ?? serviceConfig.contributionAssessment.providerMode;
    if (rolloutMode === 'legacy') {
        return {
            rolloutMode,
            providerMode,
            status: 'legacy',
            evidenceHash: null,
            assessment: null,
            gate: null,
            contributorProof: null,
            canonicalAllocation: null,
        };
    }

    const existing = await prepareDraftContributionAssessment(input.prisma, {
        draftPostId: input.draftPostId,
    });
    if (!existing.assessment) {
        return {
            rolloutMode,
            providerMode,
            status: 'not_prepared',
            evidenceHash: null,
            assessment: null,
            gate: existing.gate,
            contributorProof: null,
            canonicalAllocation: null,
            warning: {
                code: 'contribution_assessment_not_prepared',
                message: 'contribution assessment has not been prepared',
            },
        };
    }
    if (existing.gate.required) {
        return {
            rolloutMode,
            providerMode,
            status: 'needs_review',
            evidenceHash: null,
            assessment: mapPublicAssessmentToPersisted(existing.assessment),
            gate: existing.gate,
            contributorProof: null,
            canonicalAllocation: null,
        };
    }

    const preparedFromExisting = await buildPreparationFromExistingAssessmentSnapshots({
        prisma: input.prisma,
        draftPostId: input.draftPostId,
        rolloutMode,
        providerMode,
        existing,
        fallbackOnUnconfirmedHighPenetration: input.fallbackOnUnconfirmedHighPenetration ?? false,
        updateUnboundReviewedArtifact: false,
    });
    if (!preparedFromExisting) {
        return {
            rolloutMode,
            providerMode,
            status: 'failed',
            evidenceHash: null,
            assessment: mapPublicAssessmentToPersisted(existing.assessment),
            gate: existing.gate,
            contributorProof: null,
            canonicalAllocation: null,
            warning: {
                code: 'contribution_assessment_artifact_unavailable',
                message: 'contribution assessment artifact is unavailable',
            },
        };
    }
    return preparedFromExisting;
}

export async function prepareContributionAssessmentProofForDraft(input: {
    prisma: PrismaClient;
    draftPostId: number;
    rolloutMode?: ContributionAssessmentRolloutMode;
    providerMode?: ContributionAssessmentProviderMode;
    contributorProof?: DraftContributorProofRecord;
    fallbackOnUnconfirmedHighPenetration?: boolean;
}): Promise<ContributionAssessmentProofPreparation> {
    const rolloutMode = input.rolloutMode ?? serviceConfig.contributionAssessment.rolloutMode;
    const providerMode = input.providerMode ?? serviceConfig.contributionAssessment.providerMode;
    if (rolloutMode === 'legacy') {
        return {
            rolloutMode,
            providerMode,
            status: 'legacy',
            evidenceHash: null,
            assessment: null,
            gate: null,
            contributorProof: input.contributorProof ?? null,
            canonicalAllocation: null,
        };
    }

    const existing = await prepareDraftContributionAssessment(input.prisma, {
        draftPostId: input.draftPostId,
    });
    if (rolloutMode === 'enforce' && existing.gate.required) {
        return {
            rolloutMode,
            providerMode,
            status: 'needs_review',
            evidenceHash: null,
            assessment: existing.assessment
                ? mapPublicAssessmentToPersisted(existing.assessment)
                : null,
            gate: existing.gate,
            contributorProof: null,
            canonicalAllocation: null,
        };
    }
    const existingAssessmentUnavailable = isContributionAssessmentUnavailable(existing.assessment);
    if (
        existing.assessment
        && !existing.gate.required
        && (
            !existingAssessmentUnavailable
            || !providerModeCanProduceRealAssessment(providerMode)
        )
    ) {
        const preparedFromExisting = await buildPreparationFromExistingAssessmentSnapshots({
            prisma: input.prisma,
            draftPostId: input.draftPostId,
            rolloutMode,
            providerMode,
            existing,
            fallbackOnUnconfirmedHighPenetration: false,
            updateUnboundReviewedArtifact: !existingAssessmentUnavailable,
            warning: existingAssessmentUnavailable
                ? {
                    code: 'contribution_assessment_proof_unavailable',
                    message: 'Existing contribution assessment is unavailable; proof binding is paused.',
                }
                : null,
        });
        if (preparedFromExisting) return preparedFromExisting;
    }

    const { evidence, sourceMessageEvidenceUnavailable } = await buildLegacyProofEvidencePackage({
        prisma: input.prisma,
        draftPostId: input.draftPostId,
        contributorProof: input.contributorProof,
    });
    const provider = providerForMode(providerMode);
    const decisions = decisionsForCanonicalizer(existing.decisions);
    let suggestion: ContributionAssessmentSuggestion | null = null;
    let allocation: CanonicalContributionAllocation;
    let warning: ContributionAssessmentProofPreparation['warning'] = null;
    let forcedStatus: {
        status: ContributionAssessmentStatus;
        highPenetrationState: ContributionHighPenetrationState;
    } | null = null;
    if (sourceMessageEvidenceUnavailable && providerModeCanProduceRealAssessment(providerMode)) {
        const unavailableMessage = 'Source message evidence is unavailable; contribution assessment is unavailable.';
        allocation = buildUnavailableCanonicalAllocation({
            evidence,
            algorithmVersion: `${provider.mode}:source-message-evidence-unavailable:v1`,
        });
        forcedStatus = {
            status: 'needs_review',
            highPenetrationState: 'needs_review',
        };
        suggestion = buildUnavailableSuggestion({
            evidence,
            allocation,
            providerMode,
            warningCode: 'source_message_evidence_unavailable',
            warningMessage: unavailableMessage,
        });
        warning = {
            code: 'source_message_evidence_unavailable',
            message: `${unavailableMessage} Proof binding is paused until the anchored source messages can be resolved.`,
        };
    } else {
        try {
            suggestion = await provider.assessDraftContribution(evidence);
            if (suggestion) {
                validateContributionAssessmentSuggestion({
                    evidence,
                    suggestion,
                    expectedInputHash: hashContributionEvidencePackage(evidence),
                    decisions,
                });
                allocation = buildCanonicalAllocationFromSuggestion({
                    evidence,
                    suggestion,
                    decisions,
                    fallbackOnUnconfirmedHighPenetration:
                        input.fallbackOnUnconfirmedHighPenetration ?? false,
                });
            } else {
                allocation = buildUnavailableCanonicalAllocation({
                    evidence,
                    algorithmVersion: 'disabled:assessment-unavailable:v1',
                });
                forcedStatus = {
                    status: 'needs_review',
                    highPenetrationState: 'needs_review',
                };
                suggestion = buildUnavailableSuggestion({
                    evidence,
                    allocation,
                    providerMode,
                    warningCode: 'provider_disabled_fallback',
                    warningMessage: 'Contribution assessment provider is disabled; assessment is unavailable.',
                });
                warning = {
                    code: 'provider_disabled_fallback',
                    message: 'Contribution assessment provider is disabled; proof binding is paused.',
                };
            }
        } catch (error) {
            const failure = normalizeContributionAssessmentFailureForLog(error);
            logContributionAssessmentEvent('warn', 'validation_failed', {
                draftPostId: input.draftPostId,
                rolloutMode,
                providerMode,
                provider: provider.mode,
                code: error instanceof ContributionAssessmentValidationError
                    ? error.code
                    : 'provider_output_unavailable',
                providerErrorName: failure.errorName,
                providerErrorCode: failure.errorCode,
                providerErrorStatus: failure.errorStatus,
                failureClass: failure.failureClass,
            });
            if (
                error instanceof ContributionAssessmentValidationError
                && error.code === 'high_penetration_decision_required'
            ) {
                allocation = buildUnavailableCanonicalAllocation({
                    evidence,
                    algorithmVersion: `${provider.mode}:assessment-review-required:v1`,
                });
                if (suggestion) {
                    suggestion = withSuggestionWarning({
                        suggestion,
                        warningCode: 'high_penetration_review_required',
                        warningMessage: 'High-penetration attribution requires review before proof binding.',
                    });
                } else {
                    suggestion = buildUnavailableSuggestion({
                        evidence,
                        allocation,
                        providerMode,
                        warningCode: 'high_penetration_review_required',
                        warningMessage: 'High-penetration attribution requires review before proof binding.',
                    });
                }
                forcedStatus = {
                    status: 'needs_review',
                    highPenetrationState: 'needs_review',
                };
                warning = {
                    code: 'high_penetration_review_required',
                    message: 'High-penetration attribution requires review before proof binding.',
                };
            } else {
                const unavailableMessage = 'Contribution assessment provider output was unavailable or invalid; assessment is unavailable.';
                allocation = buildUnavailableCanonicalAllocation({
                    evidence,
                    algorithmVersion: `${provider.mode}:assessment-unavailable:v1`,
                });
                suggestion = buildUnavailableSuggestion({
                    evidence,
                    allocation,
                    providerMode,
                    warningCode: 'provider_output_fallback',
                    warningMessage: unavailableMessage,
                });
                forcedStatus = {
                    status: 'needs_review',
                    highPenetrationState: 'needs_review',
                };
                warning = {
                    code: 'provider_output_fallback',
                    message: `${unavailableMessage} Proof binding is paused until a real assessment is available.`,
                };
            }
        }
    }

    const status = forcedStatus ?? mapAllocationToAssessmentStatus(allocation);
    const contributorProof = status.status === 'needs_review'
        ? null
        : buildDraftContributorProofFromCanonicalAllocation({
            evidence,
            allocation,
        });
    if (!suggestion) {
        throw new Error('contribution_assessment_suggestion_missing');
    }
    if (existingAssessmentUnavailable && isUnavailableCanonicalAllocation(allocation)) {
        const preparedFromExisting = await buildPreparationFromExistingAssessmentSnapshots({
            prisma: input.prisma,
            draftPostId: input.draftPostId,
            rolloutMode,
            providerMode,
            existing,
            fallbackOnUnconfirmedHighPenetration: false,
            updateUnboundReviewedArtifact: false,
            warning,
        });
        if (preparedFromExisting) return preparedFromExisting;
    }
    const signed = signContributionAssessmentArtifact({
        evidence,
        suggestion,
        canonicalAllocation: allocation,
        canonicalContributorsRoot: contributorProof?.rootHex ?? null,
        canonicalContributorsCount: contributorProof?.count ?? null,
        status: status.status,
    });
    const assessment = await persistContributionAssessment(input.prisma, {
        draftPostId: input.draftPostId,
        algorithmVersion: allocation.algorithmVersion,
        framePolicyVersion: allocation.framePolicyVersion,
        inputHash: signed.inputHash,
        outputHash: signed.outputHash,
        canonicalAllocationHash: signed.canonicalAllocationHash,
        canonicalContributorsRoot: contributorProof?.rootHex ?? null,
        canonicalContributorsCount: contributorProof?.count ?? null,
        status: status.status,
        highPenetrationState: status.highPenetrationState,
        signedArtifact: signed.signedArtifact as any,
        signerKeyId: signed.signerKeyId,
        signature: signed.signature,
    });
    const prepared = await prepareDraftContributionAssessment(input.prisma, {
        draftPostId: input.draftPostId,
        assessmentId: assessment.id,
    });
    logContributionAssessmentEvent('info', 'assessment_prepared', {
        draftPostId: input.draftPostId,
        assessmentId: assessment.id,
        rolloutMode,
        providerMode,
        status: status.status,
        highPenetrationState: status.highPenetrationState,
        inputHash: signed.inputHash,
        outputHash: signed.outputHash,
        canonicalAllocationHash: signed.canonicalAllocationHash,
        canonicalContributorsRoot: contributorProof?.rootHex ?? null,
        canonicalContributorsCount: contributorProof?.count ?? null,
        gateRequired: prepared.gate.required,
    });
    if (status.status === 'fallback_applied') {
        logContributionAssessmentEvent('info', 'fallback_applied', {
            draftPostId: input.draftPostId,
            assessmentId: assessment.id,
            rolloutMode,
            providerMode,
            reasonCode: warning?.code ?? 'fallback_applied',
            canonicalAllocationHash: signed.canonicalAllocationHash,
            canonicalContributorsRoot: contributorProof?.rootHex ?? null,
            canonicalContributorsCount: contributorProof?.count ?? null,
        });
    }

    return {
        rolloutMode,
        providerMode,
        status: status.status === 'needs_review'
            ? 'needs_review'
            : status.status === 'fallback_applied'
                ? 'fallback_applied'
                : status.status === 'confirmed'
                    ? 'confirmed'
                    : 'prepared',
        evidenceHash: hashContributionEvidencePackage(evidence),
        assessment,
        gate: prepared.gate,
        contributorProof,
        canonicalAllocation: allocation,
        warning,
    };
}
