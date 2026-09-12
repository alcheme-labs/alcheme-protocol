export type ContributionTraceStatus =
    | 'provisional'
    | 'needs_review'
    | 'unavailable'
    | 'fallback_applied'
    | 'finalized'
    | 'legacy';

export interface ContributionAssessmentGateAction {
    action: 'review_before_crystallize' | 'confirm_high_penetration' | 'reject_high_penetration';
    decisionType: string;
    authority: string;
}

export interface ContributionAssessmentGateView {
    required: boolean;
    state: string;
    primaryAction: ContributionAssessmentGateAction['action'] | null;
    fallbackAction: ContributionAssessmentGateAction['action'] | null;
    availableActions: ContributionAssessmentGateAction[];
}

export interface ContributionAssessmentView {
    id: string;
    draftPostId: number;
    status: string;
    highPenetrationState: string;
    proofPackageHash: string | null;
    canonicalContributorsRoot: string | null;
    canonicalContributorsCount: number | null;
    algorithmVersion: string;
    framePolicyVersion: string;
    inputHash: string;
    outputHash: string;
    canonicalAllocationHash: string;
    createdAt: string;
    updatedAt: string;
}

export interface ContributionTraceContributor {
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

export interface ContributionTraceRoleFact {
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

export interface ContributionTraceEvent {
    eventType: string;
    reasonCode: string;
    message: string;
    evidenceRefs: string[];
    beforeWeightBps: number | null;
    afterWeightBps: number | null;
}

export interface ContributionTraceEvidenceRef {
    refId: string;
    refType: string;
    contributorPubkey: string | null;
    hash: string | null;
    stage: string | null;
    retention: string;
    excerpt: string | null;
}

export interface ContributionTraceDecision {
    id: string;
    decisionType: string;
    candidateId: string | null;
    actorPubkey: string | null;
    reason: string | null;
    reasonCode: string | null;
    affectedRefs: string[];
    createdAt: string;
}

export interface ContributionTraceResponse {
    ok: true;
    scope: 'draft' | 'crystal';
    status: ContributionTraceStatus;
    redacted: boolean;
    draftPostId: number | null;
    circleId: number | null;
    knowledgeId: string | null;
    assessment: ContributionAssessmentView | null;
    gate: ContributionAssessmentGateView | null;
    reviewAuthorization: {
        allowed: boolean;
        requiredAuthority: 'circle_owner' | 'circle_manager';
        viewerRole: 'Owner' | 'Admin' | 'Moderator' | 'Member' | null;
    } | null;
    policy: {
        snapshot: {
            schemaVersion: 1;
            version: string;
            scope: string;
            hierarchy: string[];
            eventKey: string;
            roleWeightSource: string;
            aggregation: {
                unit: string;
                totalWeightBps: number;
                deduplication: string;
                normalization: string;
            };
            cap: {
                perContributorMaxBps: number;
                stableDimensionRequired: boolean;
            };
            decay: { mode: string };
            identityMerge: { mode: string; automaticMerge: boolean };
            revocation: { effect: string; historicalSnapshotMutation: boolean };
            exclusions: {
                voteWithoutExplicitReward: boolean;
                aiWorkerTriggerWithoutProof: boolean;
                nftOrCrystalBalance: boolean;
            };
        };
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
    contributors: ContributionTraceContributor[];
    traceEvents: ContributionTraceEvent[];
    evidenceRefs: ContributionTraceEvidenceRef[];
    roleFacts: ContributionTraceRoleFact[];
    decisions: ContributionTraceDecision[];
    warnings: Array<{ code: string; message: string }>;
}

export interface ContributionTraceViewModel {
    title: string;
    subtitle: string;
    statusLabel: string;
    contributors: ContributionTraceContributor[];
    traceEvents: ContributionTraceEvent[];
    evidenceRefs: ContributionTraceEvidenceRef[];
    roleFacts: ContributionTraceRoleFact[];
    decisions: ContributionTraceDecision[];
    proofRows: Array<{ label: string; value: string }>;
    policyRows: Array<{ label: string; value: string }>;
    warnings: string[];
    redacted: boolean;
}

export interface ContributionTraceViewCopy {
    titles: Record<ContributionTraceResponse['scope'], string>;
    subtitles: {
        public: string;
        private: string;
    };
    statuses: Record<ContributionTraceStatus, string>;
    proofLabels: {
        proofPackage: string;
        contributorsRoot: string;
        sourceAnchor: string;
        contributors: string;
        allocationHash: string;
    };
    policyLabels: {
        version: string;
        digest: string;
        scope: string;
        eventKey: string;
        aggregation: string;
        decay: string;
        identity: string;
        revocation: string;
        exclusions: string;
    };
    warningLabels: Record<string, string>;
    fallbackLabels: {
        warning: string;
        proofPendingReview: string;
        unavailable: string;
    };
}

export function formatContributionWeight(weightBps: number): string {
    if (!Number.isFinite(weightBps)) return '0%';
    return `${(weightBps / 100).toFixed(weightBps % 100 === 0 ? 0 : 2)}%`;
}

function shortenHash(value: string | null | undefined): string {
    const normalized = String(value || '').trim();
    if (!normalized) return '—';
    if (normalized.length <= 16) return normalized;
    return `${normalized.slice(0, 8)}…${normalized.slice(-6)}`;
}

function isTracePendingReview(trace: ContributionTraceResponse): boolean {
    return trace.status === 'needs_review'
        || trace.gate?.state === 'high_penetration_needs_review';
}

function formatPendingProofValue(
    value: string | null | undefined,
    trace: ContributionTraceResponse,
    copy: ContributionTraceViewCopy,
): string {
    if (value) return shortenHash(value);
    if (isTracePendingReview(trace)) return copy.fallbackLabels.proofPendingReview;
    return copy.fallbackLabels.unavailable;
}

function formatPendingProofCount(
    value: number | null | undefined,
    trace: ContributionTraceResponse,
    copy: ContributionTraceViewCopy,
): string {
    if (typeof value === 'number') return String(value);
    if (isTracePendingReview(trace)) return copy.fallbackLabels.proofPendingReview;
    return copy.fallbackLabels.unavailable;
}

export function buildContributionTraceViewModel(
    trace: ContributionTraceResponse,
    copy: ContributionTraceViewCopy,
): ContributionTraceViewModel {
    return {
        title: copy.titles[trace.scope],
        subtitle: trace.redacted
            ? copy.subtitles.public
            : copy.subtitles.private,
        statusLabel: copy.statuses[trace.status],
        contributors: [...trace.contributors].sort((a, b) => b.weightBps - a.weightBps || a.pubkey.localeCompare(b.pubkey)),
        traceEvents: trace.traceEvents,
        evidenceRefs: trace.evidenceRefs,
        roleFacts: trace.roleFacts,
        decisions: trace.decisions,
        proofRows: [
            { label: copy.proofLabels.proofPackage, value: formatPendingProofValue(trace.proof.proofPackageHash, trace, copy) },
            { label: copy.proofLabels.contributorsRoot, value: formatPendingProofValue(trace.proof.contributorsRoot, trace, copy) },
            { label: copy.proofLabels.sourceAnchor, value: shortenHash(trace.proof.sourceAnchorId) },
            { label: copy.proofLabels.contributors, value: formatPendingProofCount(trace.proof.contributorsCount, trace, copy) },
            { label: copy.proofLabels.allocationHash, value: shortenHash(trace.provider.canonicalAllocationHash) },
        ],
        policyRows: trace.policy ? [
            { label: copy.policyLabels.version, value: trace.policy.snapshot.version },
            { label: copy.policyLabels.digest, value: shortenHash(trace.policy.digest) },
            { label: copy.policyLabels.scope, value: trace.policy.snapshot.scope },
            { label: copy.policyLabels.eventKey, value: trace.policy.snapshot.eventKey },
            {
                label: copy.policyLabels.aggregation,
                value: `${trace.policy.snapshot.aggregation.normalization} · ${trace.policy.snapshot.aggregation.totalWeightBps} bps`,
            },
            { label: copy.policyLabels.decay, value: trace.policy.snapshot.decay.mode },
            { label: copy.policyLabels.identity, value: trace.policy.snapshot.identityMerge.mode },
            { label: copy.policyLabels.revocation, value: trace.policy.snapshot.revocation.effect },
            {
                label: copy.policyLabels.exclusions,
                value: [
                    trace.policy.snapshot.exclusions.voteWithoutExplicitReward ? 'vote' : null,
                    trace.policy.snapshot.exclusions.aiWorkerTriggerWithoutProof ? 'ai/worker/trigger' : null,
                    trace.policy.snapshot.exclusions.nftOrCrystalBalance ? 'NFT/Crystal' : null,
                ].filter(Boolean).join(' · '),
            },
        ] : [],
        warnings: trace.warnings.map((warning) => copy.warningLabels[warning.code] ?? copy.fallbackLabels.warning),
        redacted: trace.redacted,
    };
}
