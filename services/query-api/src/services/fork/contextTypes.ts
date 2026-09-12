export type ForkReferenceType =
    | 'lineage'
    | 'source_material'
    | 'circle_summary'
    | 'knowledge'
    | 'sealed_metadata';

export type ForkReferenceVisibilityState =
    | 'public_source'
    | 'source_gated'
    | 'sealed_source'
    | 'released_summary';

export type ForkRestrictionState =
    | 'none'
    | 'source_gate_required'
    | 'sealed'
    | 'released_safe_summary'
    | 'revoked';

export interface ForkSourcePathEntry {
    circleId: number;
    parentCircleId: number | null;
    name: string;
    level: number;
    circleType: string;
    joinRequirement: string;
    minCrystals: number;
    capturedAt: string;
}

export interface ForkSourceGateSnapshot {
    sourceCircleId: number;
    gateSubjectCircleId: number;
    requiredAssetScope: {
        kind: 'none' | 'circle_hierarchy' | 'specific_circle' | 'external_proof';
        circleId: number | null;
    };
    requiredCrystalCount: number | null;
    entitlementType:
        | 'none'
        | 'membership'
        | 'crystal_balance'
        | 'invite'
        | 'manager_approval'
        | 'governance_approval'
        | 'external_proof';
    joinRequirement: string;
    circleType: string;
    sourcePolicyVersion: {
        kind: 'settings_envelope' | 'circle_row';
        digest: string | null;
        capturedAt: string;
    };
}

export interface ForkGateEvaluationPolicy {
    version: 1;
    strategy: 'snapshot_and_current_most_restrictive';
    allowSourceSideReleaseOverride: boolean;
}

export interface ForkContextCapsuleInput {
    capsuleId: string;
    declarationId: string;
    lineageId: string;
    sourceCircleId: number;
    targetCircleId: number;
    actorUserId: number;
    sourcePathSnapshot: ForkSourcePathEntry[];
    originSnapshot: {
        sourceCircleId: number;
        targetCircleId: number;
        declarationText: string;
        originAnchorRef: string | null;
        qualificationSnapshot: Record<string, unknown>;
        createdAtCutoff: string;
        sourceGateSnapshot: ForkSourceGateSnapshot;
        restrictionState: ForkRestrictionState;
        forkPolicy: Record<string, unknown>;
        policyConfigVersion: number | null;
    };
    gateEvaluationPolicy: ForkGateEvaluationPolicy;
    capsuleDigest: string;
}

export interface ForkContextCapsuleRecord extends ForkContextCapsuleInput {
    status: 'active' | 'context_pending' | 'revoked';
    createdAt: Date;
    updatedAt: Date;
}

export interface ForkUpstreamReferenceRecord {
    referenceId: string;
    capsuleId: string;
    sourceCircleId: number;
    targetCircleId: number;
    sourceMaterialId: number | null;
    circleSummarySnapshotId: number | null;
    referenceType: ForkReferenceType;
    visibilityState: ForkReferenceVisibilityState;
    sourceGateSnapshot: ForkSourceGateSnapshot;
    restrictionState: ForkRestrictionState;
    releaseId: string | null;
    sourceDigest: string | null;
    summaryDigest: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ForkContextReleaseSourceRef {
    referenceId: string;
    sourceMaterialId?: number | null;
    sourceDigest?: string | null;
    summaryDigest?: string | null;
    [key: string]: unknown;
}

export interface ForkContextReleaseRecord {
    releaseId: string;
    sourceCircleId: number;
    targetCircleId: number | null;
    releaseAudience: string;
    approvedByUserId: number | null;
    approvalMethod: string;
    governanceRequestId: string | null;
    decisionDigest: string | null;
    sourceRefs: ForkContextReleaseSourceRef[];
    summaryText: string | null;
    summaryDigest: string;
    status: string;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface BuildForkContextCapsuleInputArgs {
    declaration: {
        declarationId: string;
        sourceCircleId: number;
        targetCircleId: number | null;
        actorUserId: number;
        declarationText: string;
        originAnchorRef: string | null;
        qualificationSnapshot: Record<string, unknown>;
        createdAt: Date;
    };
    lineage: {
        lineageId: string;
        sourceCircleId: number;
        targetCircleId: number;
        declarationId: string;
        createdBy: number;
        originAnchorRef: string | null;
        createdAt: Date;
    };
}
