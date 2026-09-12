import { Prisma, type PrismaClient } from '@prisma/client';

import {
    readContributionAssessmentArtifactSnapshots,
} from './artifact';
import {
    buildCanonicalAllocationFromSuggestion,
} from './canonicalizer';
import {
    isContributionAssessmentUnavailable,
    prepareDraftContributionAssessment,
    type ContributionAssessmentDecisionPublicRecord,
    type ContributionAssessmentGate,
    type ContributionAssessmentPublicRecord,
} from './decision';
import type {
    CanonicalContributionAllocation,
    ContributionAssessmentDecisionRecord,
    ContributionAssessmentSuggestion,
    ContributionEvidencePackage,
} from './types';
import type { ContributionPolicyProfile } from './policy';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type ContributionTraceStatus =
    | 'provisional'
    | 'needs_review'
    | 'unavailable'
    | 'fallback_applied'
    | 'finalized'
    | 'legacy';

export interface ContributionTraceContributorDto {
    pubkey: string;
    proofRole: string;
    weightBps: number;
    weightPercent: number;
    sourceStages: string[];
    sourceTypes: string[];
    contributionFunctions: string[];
    actorRoles: string[];
    evidenceRefs: string[];
    traceReasons: string[];
}

export interface ContributionTraceEventDto {
    eventType: string;
    reasonCode: string;
    message: string;
    evidenceRefs: string[];
    beforeWeightBps: number | null;
    afterWeightBps: number | null;
}

export interface ContributionTraceEvidenceRefDto {
    refId: string;
    refType: string;
    contributorPubkey: string | null;
    hash: string | null;
    stage: string | null;
    retention: string;
    excerpt: string | null;
}

export interface ContributionTraceDecisionDto {
    id: string;
    decisionType: string;
    candidateId: string | null;
    actorPubkey: string | null;
    reason: string | null;
    reasonCode: string | null;
    affectedRefs: string[];
    createdAt: string;
}

export interface ContributionTraceRoleFactDto {
    factId: string;
    actorPubkey: string | null;
    actorRole: string;
    contributionFunction: string | null;
    proofContribution: boolean;
    weightTreatment: string;
    reasonCode: string;
    evidenceRefs: string[];
    targetCircleId: number;
    institutionRole: 'target' | 'committee';
    institutionCircleId: number;
    governanceCaseId: string | null;
    governanceRequestId: string | null;
}

export interface ContributionTraceDto {
    ok: true;
    scope: 'draft' | 'crystal';
    status: ContributionTraceStatus;
    redacted: boolean;
    draftPostId: number | null;
    circleId: number | null;
    knowledgeId: string | null;
    assessment: ContributionAssessmentPublicRecord | null;
    gate: ContributionAssessmentGate | null;
    policy: {
        snapshot: ContributionPolicyProfile;
        digest: string;
    } | null;
    provider: {
        algorithmVersion: string | null;
        framePolicyVersion: string | null;
        inputHash: string | null;
        outputHash: string | null;
        canonicalAllocationHash: string | null;
    };
    proof: {
        proofPackageHash: string | null;
        contributorsRoot: string | null;
        contributorsCount: number | null;
        sourceAnchorId: string | null;
    };
    contributors: ContributionTraceContributorDto[];
    traceEvents: ContributionTraceEventDto[];
    evidenceRefs: ContributionTraceEvidenceRefDto[];
    roleFacts: ContributionTraceRoleFactDto[];
    decisions: ContributionTraceDecisionDto[];
    warnings: Array<{ code: string; message: string }>;
}

interface ContributionAssessmentTraceRow {
    id: bigint;
    draftPostId: number;
    proofPackageId: bigint | null;
    proofPackageHash: string | null;
    algorithmVersion: string;
    framePolicyVersion: string;
    inputHash: string;
    outputHash: string;
    canonicalAllocationHash: string;
    canonicalContributorsRoot: string | null;
    canonicalContributorsCount: number | null;
    status: string;
    highPenetrationState: string;
    signedArtifact: unknown;
    signerKeyId: string;
    signature: string;
    createdAt: Date;
    updatedAt: Date;
}

interface KnowledgeTraceRow {
    id: number;
    knowledgeId: string;
    circleId: number;
    contributorsRoot: string | null;
    contributorsCount: number;
    binding: {
        proofPackageHash: string;
        sourceAnchorId: string;
        contributorsRoot: string;
        contributorsCount: number;
    } | null;
    contributions: Array<{
        contributorPubkey: string;
        contributionRole: string;
        contributionWeightBps: number;
        sourceDraftPostId: number | null;
        sourceAnchorId: string | null;
        contributorsRoot: string | null;
        contributorsCount: number | null;
    }>;
}

function dateToIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

function mapAssessmentRow(row: ContributionAssessmentTraceRow): ContributionAssessmentPublicRecord {
    return {
        id: row.id.toString(),
        draftPostId: row.draftPostId,
        proofPackageId: row.proofPackageId ? row.proofPackageId.toString() : null,
        proofPackageHash: row.proofPackageHash,
        algorithmVersion: row.algorithmVersion,
        framePolicyVersion: row.framePolicyVersion,
        inputHash: row.inputHash,
        outputHash: row.outputHash,
        canonicalAllocationHash: row.canonicalAllocationHash,
        canonicalContributorsRoot: row.canonicalContributorsRoot,
        canonicalContributorsCount: row.canonicalContributorsCount,
        status: row.status,
        highPenetrationState: row.highPenetrationState,
        signerKeyId: row.signerKeyId,
        signature: row.signature,
        createdAt: dateToIso(row.createdAt),
        updatedAt: dateToIso(row.updatedAt),
    };
}

function resolveTraceStatus(input: {
    scope: 'draft' | 'crystal';
    assessment: ContributionAssessmentPublicRecord | null;
    gate: ContributionAssessmentGate | null;
    allocation: CanonicalContributionAllocation | null;
}): ContributionTraceStatus {
    if (!input.assessment || !input.allocation) return 'legacy';
    if (
        !isProofLinkedAssessment(input.assessment)
        && (
            input.gate?.state === 'assessment_unavailable'
            || isContributionAssessmentUnavailable(input.assessment)
            || isFallbackOrUnavailableAlgorithmVersion(input.assessment.algorithmVersion)
            || isFallbackOrUnavailableAlgorithmVersion(input.allocation.algorithmVersion)
        )
    ) {
        return 'unavailable';
    }
    if (
        input.gate?.state === 'high_penetration_confirmed'
        && input.allocation.highPenetrationState !== 'fallback_applied'
        && input.allocation.highPenetrationState !== 'needs_review'
    ) {
        return 'provisional';
    }
    if (
        input.gate?.state === 'high_penetration_rejected'
        && input.allocation.highPenetrationState !== 'fallback_applied'
        && input.allocation.highPenetrationState !== 'needs_review'
    ) {
        return 'provisional';
    }
    if (
        !isProofLinkedAssessment(input.assessment)
        && (
            input.allocation.highPenetrationState === 'needs_review'
            || input.assessment.status === 'needs_review'
            || isFallbackOrUnavailableAlgorithmVersion(input.assessment.algorithmVersion)
            || isFallbackOrUnavailableAlgorithmVersion(input.allocation.algorithmVersion)
        )
    ) {
        return 'needs_review';
    }
    if (isProofLinkedHistoricalFallback({ assessment: input.assessment, allocation: input.allocation })) {
        return 'fallback_applied';
    }
    if (input.scope === 'crystal' || input.assessment.status === 'bound') return 'finalized';
    if (input.gate?.state === 'fallback_selected' && isProofLinkedAssessment(input.assessment)) {
        return 'fallback_applied';
    }
    if (
        input.gate?.state === 'high_penetration_rejected'
        && input.allocation.highPenetrationState === 'fallback_applied'
    ) {
        return 'fallback_applied';
    }
    if (input.gate?.state === 'high_penetration_rejected') {
        return 'provisional';
    }
    if (input.assessment.status === 'needs_review') return 'needs_review';
    if (
        input.gate?.state === 'high_penetration_needs_review'
        || input.assessment.status === 'needs_review'
    ) {
        return 'needs_review';
    }
    if (
        input.assessment.status === 'fallback_applied'
        || input.assessment.highPenetrationState === 'fallback_applied'
    ) {
        return 'fallback_applied';
    }
    return 'provisional';
}

function mapContributor(contributor: CanonicalContributionAllocation['contributors'][number]): ContributionTraceContributorDto {
    return {
        pubkey: contributor.pubkey,
        proofRole: contributor.proofRole,
        weightBps: contributor.weightBps,
        weightPercent: contributor.weightBps / 100,
        sourceStages: contributor.sourceStages,
        sourceTypes: contributor.sourceTypes,
        contributionFunctions: contributor.contributionFunctions,
        actorRoles: contributor.actorRoles,
        evidenceRefs: contributor.evidenceRefs,
        traceReasons: contributor.traceReasons,
    };
}

function mapTraceEvent(event: CanonicalContributionAllocation['traceEvents'][number]): ContributionTraceEventDto {
    return {
        eventType: event.eventType,
        reasonCode: event.reasonCode,
        message: event.message,
        evidenceRefs: event.evidenceRefs,
        beforeWeightBps: event.beforeWeightBps ?? null,
        afterWeightBps: event.afterWeightBps ?? null,
    };
}

function mapEvidenceRefs(
    evidence: ContributionEvidencePackage | null,
    redacted: boolean,
): ContributionTraceEvidenceRefDto[] {
    if (!evidence) return [];
    return evidence.evidenceRefs.map((ref) => {
        const privateBallotRef = redacted && ref.refType === 'governance_vote';
        return {
            refId: ref.refId,
            refType: ref.refType,
            contributorPubkey: privateBallotRef ? null : ref.contributorPubkey,
            hash: privateBallotRef ? null : ref.hash,
            stage: ref.stage,
            retention: ref.retention,
            excerpt: redacted ? null : ref.excerpt,
        };
    });
}

function mapRoleFacts(
    evidence: ContributionEvidencePackage | null,
    redacted: boolean,
): ContributionTraceRoleFactDto[] {
    if (!evidence) return [];
    return evidence.roleFacts.map((fact) => ({
        ...fact,
        actorPubkey: redacted && fact.actorRole === 'voter' ? null : fact.actorPubkey,
    }));
}

function mapDecision(
    decision: ContributionAssessmentDecisionPublicRecord,
    redacted = false,
): ContributionTraceDecisionDto {
    return {
        id: decision.id,
        decisionType: decision.decisionType,
        candidateId: decision.candidateId,
        actorPubkey: decision.actorPubkey,
        reason: redacted ? null : decision.reason,
        reasonCode: decision.reason ? 'operator_note' : null,
        affectedRefs: decision.affectedRefs,
        createdAt: decision.createdAt,
    };
}

function mapProviderWarnings(
    suggestion: ContributionAssessmentSuggestion | null,
): ContributionTraceDto['warnings'] {
    return (suggestion?.warnings ?? [])
        .filter((warning) => typeof warning.code === 'string' && warning.code.trim())
        .map((warning) => ({
            code: warning.code.trim(),
            message: warning.message,
        }));
}

function mapDecisionsForCanonicalizer(
    decisions: ContributionAssessmentDecisionPublicRecord[],
): ContributionAssessmentDecisionRecord[] {
    return decisions
        .filter((decision) =>
            decision.decisionType === 'confirm_high_penetration'
            || decision.decisionType === 'reject_high_penetration'
            || decision.decisionType === 'continue_with_fallback',
        )
        .map((decision) => ({
            decisionType: decision.decisionType,
            candidateId: decision.candidateId,
            actorUserId: decision.actorUserId,
            actorPubkey: decision.actorPubkey,
            reason: decision.reason,
            affectedRefs: decision.affectedRefs,
        }));
}

function resolveTraceAllocation(input: {
    evidence: ContributionEvidencePackage;
    suggestion: ContributionAssessmentSuggestion;
    canonicalAllocation: CanonicalContributionAllocation;
    assessment: ContributionAssessmentPublicRecord;
    gate: ContributionAssessmentGate | null;
    decisions: ContributionAssessmentDecisionPublicRecord[];
}): CanonicalContributionAllocation {
    if (isProofLinkedAssessment(input.assessment)) return input.canonicalAllocation;
    const canonicalDecisions = mapDecisionsForCanonicalizer(input.decisions);
    if (canonicalDecisions.length === 0) {
        if (
            input.gate?.state === 'high_penetration_needs_review'
            && isReviewRequiredAlgorithmVersion(input.assessment.algorithmVersion)
        ) {
            return buildCanonicalAllocationFromSuggestion({
                evidence: input.evidence,
                suggestion: input.suggestion,
                decisions: [{
                    decisionType: 'confirm_high_penetration',
                    candidateId: null,
                    actorUserId: null,
                    actorPubkey: null,
                    reason: 'trace_preview_only',
                    affectedRefs: [],
                }],
                fallbackOnUnconfirmedHighPenetration: false,
            });
        }
        return input.canonicalAllocation;
    }
    return buildCanonicalAllocationFromSuggestion({
        evidence: input.evidence,
        suggestion: input.suggestion,
        decisions: canonicalDecisions,
        fallbackOnUnconfirmedHighPenetration: false,
    });
}

function isFallbackAlgorithmVersion(value: string | null | undefined): boolean {
    return String(value || '').toLowerCase().includes('fallback');
}

function isUnavailableAlgorithmVersion(value: string | null | undefined): boolean {
    const normalized = String(value || '').toLowerCase();
    return normalized.endsWith(':assessment-unavailable:v1')
        || normalized.endsWith(':fallback-decision-unavailable:v1')
        || normalized.endsWith(':empty-unavailable:v1');
}

function isReviewRequiredAlgorithmVersion(value: string | null | undefined): boolean {
    return String(value || '').toLowerCase().endsWith(':assessment-review-required:v1');
}

function isFallbackOrUnavailableAlgorithmVersion(value: string | null | undefined): boolean {
    return isFallbackAlgorithmVersion(value) || isUnavailableAlgorithmVersion(value);
}

function isProofLinkedAssessment(assessment: ContributionAssessmentPublicRecord): boolean {
    return Boolean(assessment.proofPackageHash)
        && Boolean(assessment.canonicalContributorsRoot)
        && Number(assessment.canonicalContributorsCount ?? 0) > 0;
}

function isProofLinkedTraceRow(row: ContributionAssessmentTraceRow): boolean {
    return Boolean(row.proofPackageHash)
        && Boolean(row.canonicalContributorsRoot)
        && Number(row.canonicalContributorsCount ?? 0) > 0;
}

function hasFallbackProviderWarning(warnings: ContributionTraceDto['warnings']): boolean {
    return warnings.some((warning) =>
        isFallbackProviderWarningCode(warning.code),
    );
}

function isFallbackProviderWarningCode(code: string): boolean {
    return code === 'provider_disabled_fallback'
        || code === 'provider_output_fallback'
        || code === 'high_penetration_review_required'
        || code === 'assessment_unavailable'
        || code === 'unreviewed_fallback_trace';
}

function isProofLinkedHistoricalFallback(input: {
    assessment: ContributionAssessmentPublicRecord;
    allocation: CanonicalContributionAllocation | null;
}): boolean {
    if (!input.allocation) return false;
    return isProofLinkedAssessment(input.assessment)
        && (
            isFallbackAlgorithmVersion(input.assessment.algorithmVersion)
            || isFallbackAlgorithmVersion(input.allocation.algorithmVersion)
            || input.allocation.highPenetrationState === 'fallback_applied'
        );
}

function shouldSuppressUnreviewedFallbackDetails(input: {
    scope: 'draft' | 'crystal';
    assessment: ContributionAssessmentPublicRecord;
    gate: ContributionAssessmentGate | null;
    allocation: CanonicalContributionAllocation | null;
    providerWarnings: ContributionTraceDto['warnings'];
}): boolean {
    if (!input.allocation) return false;
    if (isProofLinkedAssessment(input.assessment)) return false;
    if (input.gate?.state === 'assessment_unavailable') return true;
    if (
        input.gate?.state === 'high_penetration_needs_review'
        && isReviewRequiredAlgorithmVersion(input.assessment.algorithmVersion)
        && input.allocation.contributors.length > 0
    ) {
        return false;
    }
    const hasUnreviewedFallbackOrUnavailableDetails =
        isFallbackOrUnavailableAlgorithmVersion(input.assessment.algorithmVersion)
        || isFallbackOrUnavailableAlgorithmVersion(input.allocation.algorithmVersion)
        || isReviewRequiredAlgorithmVersion(input.assessment.algorithmVersion)
        || isReviewRequiredAlgorithmVersion(input.allocation.algorithmVersion)
        || input.allocation.highPenetrationState === 'needs_review'
        || input.allocation.highPenetrationState === 'fallback_applied'
        || hasFallbackProviderWarning(input.providerWarnings);
    if (!hasUnreviewedFallbackOrUnavailableDetails) return false;
    if (input.scope === 'crystal') return true;
    if (
        input.gate?.state === 'high_penetration_confirmed'
        && input.allocation.highPenetrationState !== 'fallback_applied'
        && input.allocation.highPenetrationState !== 'needs_review'
    ) {
        return false;
    }
    if (
        input.gate?.state === 'high_penetration_rejected'
        && input.allocation.highPenetrationState !== 'fallback_applied'
        && input.allocation.highPenetrationState !== 'needs_review'
    ) {
        return false;
    }
    if (
        input.gate?.state !== 'high_penetration_needs_review'
        && input.assessment.status !== 'needs_review'
    ) {
        return false;
    }
    return true;
}

function uniqueWarnings(warnings: ContributionTraceDto['warnings']): ContributionTraceDto['warnings'] {
    const seen = new Set<string>();
    const result: ContributionTraceDto['warnings'] = [];
    for (const warning of warnings) {
        const code = warning.code.trim();
        if (!code || seen.has(code)) continue;
        seen.add(code);
        result.push({ code, message: warning.message });
    }
    return result;
}

function buildTraceFromAssessment(input: {
    scope: 'draft' | 'crystal';
    draftPostId: number | null;
    circleId: number | null;
    knowledgeId: string | null;
    row: ContributionAssessmentTraceRow;
    decisions: ContributionAssessmentDecisionPublicRecord[];
    gate: ContributionAssessmentGate | null;
    redacted: boolean;
}): ContributionTraceDto {
    const assessment = mapAssessmentRow(input.row);
    const snapshots = readContributionAssessmentArtifactSnapshots({
        signedArtifact: input.row.signedArtifact,
        inputHash: input.row.inputHash,
        outputHash: input.row.outputHash,
        canonicalAllocationHash: input.row.canonicalAllocationHash,
        signerKeyId: input.row.signerKeyId,
        signature: input.row.signature,
    });
    const evidence = snapshots?.evidence ?? null;
    const allocation = snapshots
        ? resolveTraceAllocation({
            evidence: snapshots.evidence,
            suggestion: snapshots.suggestion,
            canonicalAllocation: snapshots.canonicalAllocation,
            assessment,
            gate: input.gate,
            decisions: input.decisions,
        })
        : null;
    const rawProviderWarnings = mapProviderWarnings(snapshots?.suggestion ?? null);
    const providerWarnings = isProofLinkedHistoricalFallback({ assessment, allocation })
        ? rawProviderWarnings.filter((warning) => !isFallbackProviderWarningCode(warning.code))
        : rawProviderWarnings;
    const suppressFallbackDetails = shouldSuppressUnreviewedFallbackDetails({
        scope: input.scope,
        assessment,
        gate: input.gate,
        allocation,
        providerWarnings,
    });
    const warnings = uniqueWarnings([
        ...providerWarnings,
        ...(!allocation
            ? [{ code: 'assessment_artifact_unreadable', message: 'Contribution assessment artifact could not be read.' }]
            : []),
        ...(suppressFallbackDetails && !hasFallbackProviderWarning(providerWarnings)
            ? [{
                code: 'unreviewed_fallback_trace',
                message: 'Unavailable contribution assessment is not exposed as trace detail.',
            }]
            : []),
    ]);
    return {
        ok: true,
        scope: input.scope,
        status: resolveTraceStatus({
            scope: input.scope,
            assessment,
            gate: input.gate,
            allocation,
        }),
        redacted: input.redacted,
        draftPostId: input.draftPostId ?? input.row.draftPostId,
        circleId: input.circleId ?? evidence?.circleId ?? null,
        knowledgeId: input.knowledgeId,
        assessment,
        gate: input.gate,
        policy: snapshots ? {
            snapshot: snapshots.policy,
            digest: snapshots.policyDigest,
        } : null,
        provider: {
            algorithmVersion: input.row.algorithmVersion,
            framePolicyVersion: input.row.framePolicyVersion,
            inputHash: input.row.inputHash,
            outputHash: input.row.outputHash,
            canonicalAllocationHash: input.row.canonicalAllocationHash,
        },
        proof: {
            proofPackageHash: input.row.proofPackageHash,
            contributorsRoot: input.row.canonicalContributorsRoot,
            contributorsCount: input.row.canonicalContributorsCount,
            sourceAnchorId: evidence?.sourceAnchor?.anchorId ?? null,
        },
        contributors: suppressFallbackDetails ? [] : allocation?.contributors.map(mapContributor) ?? [],
        traceEvents: suppressFallbackDetails ? [] : allocation?.traceEvents.map(mapTraceEvent) ?? [],
        evidenceRefs: suppressFallbackDetails ? [] : mapEvidenceRefs(evidence, input.redacted),
        roleFacts: suppressFallbackDetails ? [] : mapRoleFacts(evidence, input.redacted),
        decisions: input.decisions.map((decision) => mapDecision(decision, input.redacted)),
        warnings,
    };
}

function buildLegacyTraceFromKnowledge(knowledge: KnowledgeTraceRow): ContributionTraceDto {
    const proof = knowledge.binding ?? {
        proofPackageHash: null,
        sourceAnchorId: null,
        contributorsRoot: knowledge.contributorsRoot,
        contributorsCount: knowledge.contributorsCount,
    };
    const draftPostIds = Array.from(new Set(
        knowledge.contributions
            .map((contribution) => contribution.sourceDraftPostId)
            .filter((value): value is number => Number.isInteger(value)),
    ));
    return {
        ok: true,
        scope: 'crystal',
        status: 'legacy',
        redacted: true,
        draftPostId: draftPostIds.length === 1 ? draftPostIds[0] : null,
        circleId: knowledge.circleId,
        knowledgeId: knowledge.knowledgeId,
        assessment: null,
        gate: null,
        policy: null,
        provider: {
            algorithmVersion: null,
            framePolicyVersion: null,
            inputHash: null,
            outputHash: null,
            canonicalAllocationHash: null,
        },
        proof: {
            proofPackageHash: proof.proofPackageHash,
            contributorsRoot: proof.contributorsRoot,
            contributorsCount: proof.contributorsCount,
            sourceAnchorId: proof.sourceAnchorId,
        },
        contributors: knowledge.contributions.map((contribution) => ({
            pubkey: contribution.contributorPubkey,
            proofRole: contribution.contributionRole,
            weightBps: contribution.contributionWeightBps,
            weightPercent: contribution.contributionWeightBps / 100,
            sourceStages: [],
            sourceTypes: [],
            contributionFunctions: [],
            actorRoles: [],
            evidenceRefs: [],
            traceReasons: ['legacy_knowledge_contribution_snapshot'],
        })),
        traceEvents: [{
            eventType: 'proof_adapter_built',
            reasonCode: 'legacy_snapshot',
            message: 'Contribution trace is reconstructed from finalized knowledge contribution snapshot.',
            evidenceRefs: [],
            beforeWeightBps: null,
            afterWeightBps: null,
        }],
        evidenceRefs: [],
        roleFacts: [],
        decisions: [],
        warnings: [{
            code: 'legacy_trace',
            message: 'No signed contribution assessment artifact is linked to this knowledge item.',
        }],
    };
}

async function loadAssessmentTraceRowForDraft(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<ContributionAssessmentTraceRow | null> {
    const rows = await prisma.$queryRaw<ContributionAssessmentTraceRow[]>(Prisma.sql`
        SELECT
            id,
            draft_post_id AS "draftPostId",
            proof_package_id AS "proofPackageId",
            proof_package_hash AS "proofPackageHash",
            algorithm_version AS "algorithmVersion",
            frame_policy_version AS "framePolicyVersion",
            input_hash AS "inputHash",
            output_hash AS "outputHash",
            canonical_allocation_hash AS "canonicalAllocationHash",
            canonical_contributors_root AS "canonicalContributorsRoot",
            canonical_contributors_count AS "canonicalContributorsCount",
            status,
            high_penetration_state AS "highPenetrationState",
            signed_artifact AS "signedArtifact",
            signer_key_id AS "signerKeyId",
            signature,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM contribution_assessments
        WHERE draft_post_id = ${draftPostId}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `);
    return rows[0] ?? null;
}

async function loadAssessmentTraceRowForKnowledge(
    prisma: PrismaLike,
    input: { draftPostId: number | null; proofPackageHash: string | null },
): Promise<ContributionAssessmentTraceRow | null> {
    const rows = input.proofPackageHash
        ? await prisma.$queryRaw<ContributionAssessmentTraceRow[]>(Prisma.sql`
            SELECT
                id,
                draft_post_id AS "draftPostId",
                proof_package_id AS "proofPackageId",
                proof_package_hash AS "proofPackageHash",
                algorithm_version AS "algorithmVersion",
                frame_policy_version AS "framePolicyVersion",
                input_hash AS "inputHash",
                output_hash AS "outputHash",
                canonical_allocation_hash AS "canonicalAllocationHash",
                canonical_contributors_root AS "canonicalContributorsRoot",
                canonical_contributors_count AS "canonicalContributorsCount",
                status,
                high_penetration_state AS "highPenetrationState",
                signed_artifact AS "signedArtifact",
                signer_key_id AS "signerKeyId",
                signature,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM contribution_assessments
            WHERE proof_package_hash = ${input.proofPackageHash}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        `)
        : [];
    if (rows[0] && isProofLinkedTraceRow(rows[0])) return rows[0];
    return null;
}

async function loadDecisionRows(
    prisma: PrismaLike,
    assessmentId: bigint,
): Promise<ContributionAssessmentDecisionPublicRecord[]> {
    const rows = await prisma.$queryRaw<Array<{
        id: bigint;
        assessmentId: bigint;
        decisionType: string;
        candidateId: string | null;
        actorUserId: number | null;
        actorPubkey: string | null;
        reason: string | null;
        affectedRefs: unknown;
        createdAt: Date;
    }>>(Prisma.sql`
        SELECT
            id,
            assessment_id AS "assessmentId",
            decision_type AS "decisionType",
            candidate_id AS "candidateId",
            actor_user_id AS "actorUserId",
            actor_pubkey AS "actorPubkey",
            reason,
            affected_refs AS "affectedRefs",
            created_at AS "createdAt"
        FROM contribution_assessment_decisions
        WHERE assessment_id = ${assessmentId}
        ORDER BY created_at ASC, id ASC
    `);
    return rows.map((row) => ({
        id: row.id.toString(),
        assessmentId: row.assessmentId.toString(),
        decisionType: row.decisionType as ContributionAssessmentDecisionPublicRecord['decisionType'],
        candidateId: row.candidateId,
        actorUserId: row.actorUserId,
        actorPubkey: row.actorPubkey,
        reason: row.reason,
        affectedRefs: Array.isArray(row.affectedRefs) ? row.affectedRefs.map(String).filter(Boolean) : [],
        createdAt: row.createdAt.toISOString(),
    }));
}

export async function loadDraftContributionTrace(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
    },
): Promise<ContributionTraceDto> {
    const prepared = await prepareDraftContributionAssessment(prisma, {
        draftPostId: input.draftPostId,
    });
    const row = await loadAssessmentTraceRowForDraft(prisma, input.draftPostId);
    if (!row) {
        return {
            ok: true,
            scope: 'draft',
            status: 'legacy',
            redacted: false,
            draftPostId: input.draftPostId,
            circleId: null,
            knowledgeId: null,
            assessment: null,
            gate: prepared.gate,
            policy: null,
            provider: {
                algorithmVersion: null,
                framePolicyVersion: null,
                inputHash: null,
                outputHash: null,
                canonicalAllocationHash: null,
            },
            proof: {
                proofPackageHash: null,
                contributorsRoot: null,
                contributorsCount: null,
                sourceAnchorId: null,
            },
            contributors: [],
            traceEvents: [],
            evidenceRefs: [],
            roleFacts: [],
            decisions: prepared.decisions.map((decision) => mapDecision(decision, false)),
            warnings: [{ code: 'assessment_not_prepared', message: 'Contribution assessment has not been prepared yet.' }],
        };
    }
    const decisions = await loadDecisionRows(prisma, row.id);
    return buildTraceFromAssessment({
        scope: 'draft',
        draftPostId: input.draftPostId,
        circleId: null,
        knowledgeId: null,
        row,
        decisions,
        gate: prepared.gate,
        redacted: false,
    });
}

export async function loadCrystalContributionTrace(
    prisma: PrismaClient,
    input: {
        knowledgeId: string;
        includePrivateDraftEvidence?: boolean;
    },
): Promise<ContributionTraceDto | null> {
    const knowledge = await prisma.knowledge.findUnique({
        where: {
            knowledgeId: input.knowledgeId,
        },
        select: {
            id: true,
            knowledgeId: true,
            circleId: true,
            contributorsRoot: true,
            contributorsCount: true,
            binding: {
                select: {
                    proofPackageHash: true,
                    sourceAnchorId: true,
                    contributorsRoot: true,
                    contributorsCount: true,
                },
            },
            contributions: {
                orderBy: [
                    { contributionWeight: 'desc' },
                    { contributorPubkey: 'asc' },
                ],
                select: {
                    contributorPubkey: true,
                    contributionRole: true,
                    contributionWeightBps: true,
                    sourceDraftPostId: true,
                    sourceAnchorId: true,
                    contributorsRoot: true,
                    contributorsCount: true,
                },
            },
        },
    });
    if (!knowledge) return null;

    const draftPostIds = Array.from(new Set(
        knowledge.contributions
            .map((contribution) => contribution.sourceDraftPostId)
            .filter((value): value is number => Number.isInteger(value)),
    ));
    const row = await loadAssessmentTraceRowForKnowledge(prisma, {
        draftPostId: draftPostIds.length === 1 ? draftPostIds[0] : null,
        proofPackageHash: knowledge.binding?.proofPackageHash ?? null,
    });
    if (!row) {
        return buildLegacyTraceFromKnowledge(knowledge);
    }

    const decisions = await loadDecisionRows(prisma, row.id);
    return buildTraceFromAssessment({
        scope: 'crystal',
        draftPostId: draftPostIds.length === 1 ? draftPostIds[0] : row.draftPostId,
        circleId: knowledge.circleId,
        knowledgeId: knowledge.knowledgeId,
        row,
        decisions,
        gate: null,
        redacted: !input.includePrivateDraftEvidence,
    });
}
