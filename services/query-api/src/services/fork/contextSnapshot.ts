import { createHash } from 'node:crypto';
import { CircleType, JoinRequirement, type PrismaClient } from '@prisma/client';

import { resolveCircleJoinPolicy } from '../membership/engine';
import { resolveCirclePolicyProfile } from '../policy/profile';
import { resolveProjectedCircleSettings } from '../policy/settingsEnvelope';
import type {
    BuildForkContextCapsuleInputArgs,
    ForkContextCapsuleInput,
    ForkRestrictionState,
    ForkSourceGateSnapshot,
    ForkSourcePathEntry,
} from './contextTypes';

interface ForkContextCircleRow {
    id: number;
    parentCircleId: number | null;
    name: string;
    level: number;
    circleType: CircleType;
    joinRequirement: JoinRequirement;
    minCrystals: number;
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function normalizePositiveInteger(value: unknown, errorCode: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(errorCode);
    }
    return parsed;
}

function buildCapturedPathEntry(
    row: ForkContextCircleRow,
    capturedAt: string,
): ForkSourcePathEntry {
    return {
        circleId: row.id,
        parentCircleId: row.parentCircleId ?? null,
        name: row.name,
        level: Math.max(0, Math.floor(Number(row.level || 0))),
        circleType: row.circleType,
        joinRequirement: row.joinRequirement,
        minCrystals: Math.max(0, Math.floor(Number(row.minCrystals || 0))),
        capturedAt,
    };
}

async function loadSourceCirclePath(
    prisma: PrismaClient,
    sourceCircleId: number,
    capturedAt: string,
): Promise<ForkSourcePathEntry[]> {
    const path: ForkContextCircleRow[] = [];
    const seen = new Set<number>();
    let currentId: number | null = sourceCircleId;

    for (let depth = 0; depth < 10 && currentId; depth += 1) {
        if (seen.has(currentId)) {
            throw new Error('fork_source_path_cycle_detected');
        }
        seen.add(currentId);

        const row: ForkContextCircleRow | null = await prisma.circle.findUnique({
            where: { id: currentId },
            select: {
                id: true,
                parentCircleId: true,
                name: true,
                level: true,
                circleType: true,
                joinRequirement: true,
                minCrystals: true,
            },
        });

        if (!row) {
            if (path.length === 0) {
                throw new Error('source_circle_not_found');
            }
            break;
        }

        path.push(row);
        currentId = row.parentCircleId ?? null;
    }

    if (currentId) {
        if (seen.has(currentId)) {
            throw new Error('fork_source_path_cycle_detected');
        }
        throw new Error('fork_source_path_depth_exceeded');
    }

    return path
        .reverse()
        .map((row) => buildCapturedPathEntry(row, capturedAt));
}

function classifySourceGate(input: {
    sourceCircleId: number;
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
    policySource: 'signed_envelope' | 'circle_row';
    capturedAt: string;
}): {
    sourceGateSnapshot: ForkSourceGateSnapshot;
    restrictionState: ForkRestrictionState;
} {
    const policy = resolveCircleJoinPolicy({
        joinRequirement: input.joinRequirement,
        circleType: input.circleType,
        minCrystals: input.minCrystals,
    });
    const requiresCrystalGate = policy.joinRequirement === JoinRequirement.TokenGated
        || policy.minCrystals > 0;
    const requiresInvite = policy.joinRequirement === JoinRequirement.InviteOnly
        || policy.circleType === CircleType.Secret;
    const requiresApproval = policy.joinRequirement === JoinRequirement.ApprovalRequired
        || policy.circleType === CircleType.Closed;

    const sourcePolicyVersion = {
        kind: input.policySource === 'signed_envelope' ? 'settings_envelope' as const : 'circle_row' as const,
        digest: null,
        capturedAt: input.capturedAt,
    };

    if (requiresInvite) {
        return {
            sourceGateSnapshot: {
                sourceCircleId: input.sourceCircleId,
                gateSubjectCircleId: input.sourceCircleId,
                requiredAssetScope: {
                    kind: 'none',
                    circleId: null,
                },
                requiredCrystalCount: null,
                entitlementType: 'invite',
                joinRequirement: policy.joinRequirement,
                circleType: policy.circleType,
                sourcePolicyVersion,
            },
            restrictionState: 'sealed',
        };
    }

    if (requiresCrystalGate) {
        return {
            sourceGateSnapshot: {
                sourceCircleId: input.sourceCircleId,
                gateSubjectCircleId: input.sourceCircleId,
                requiredAssetScope: {
                    kind: 'circle_hierarchy',
                    circleId: input.sourceCircleId,
                },
                requiredCrystalCount: policy.minCrystals,
                entitlementType: 'crystal_balance',
                joinRequirement: policy.joinRequirement,
                circleType: policy.circleType,
                sourcePolicyVersion,
            },
            restrictionState: 'source_gate_required',
        };
    }

    if (requiresApproval) {
        return {
            sourceGateSnapshot: {
                sourceCircleId: input.sourceCircleId,
                gateSubjectCircleId: input.sourceCircleId,
                requiredAssetScope: {
                    kind: 'none',
                    circleId: null,
                },
                requiredCrystalCount: null,
                entitlementType: 'manager_approval',
                joinRequirement: policy.joinRequirement,
                circleType: policy.circleType,
                sourcePolicyVersion,
            },
            restrictionState: 'source_gate_required',
        };
    }

    return {
        sourceGateSnapshot: {
            sourceCircleId: input.sourceCircleId,
            gateSubjectCircleId: input.sourceCircleId,
            requiredAssetScope: {
                kind: 'none',
                circleId: null,
            },
            requiredCrystalCount: null,
            entitlementType: 'none',
            joinRequirement: policy.joinRequirement,
            circleType: policy.circleType,
            sourcePolicyVersion,
        },
        restrictionState: 'none',
    };
}

export async function buildForkContextCapsuleInput(
    prisma: PrismaClient,
    args: BuildForkContextCapsuleInputArgs,
): Promise<ForkContextCapsuleInput> {
    const sourceCircleId = normalizePositiveInteger(args.lineage.sourceCircleId, 'invalid_source_circle_id');
    const targetCircleId = normalizePositiveInteger(args.lineage.targetCircleId, 'invalid_target_circle_id');
    if (args.declaration.declarationId !== args.lineage.declarationId) {
        throw new Error('fork_declaration_lineage_mismatch');
    }
    if (args.declaration.sourceCircleId !== sourceCircleId) {
        throw new Error('fork_source_circle_mismatch');
    }
    if (
        args.declaration.targetCircleId !== null
        && args.declaration.targetCircleId !== targetCircleId
    ) {
        throw new Error('fork_target_circle_mismatch');
    }

    const capturedAt = args.lineage.createdAt.toISOString();
    const sourcePathSnapshot = await loadSourceCirclePath(prisma, sourceCircleId, capturedAt);
    const sourceCircle: Pick<ForkContextCircleRow, 'id' | 'joinRequirement' | 'circleType' | 'minCrystals'> | null = await prisma.circle.findUnique({
        where: { id: sourceCircleId },
        select: {
            id: true,
            joinRequirement: true,
            circleType: true,
            minCrystals: true,
        },
    });
    if (!sourceCircle) {
        throw new Error('source_circle_not_found');
    }

    const [projectedPolicy, policyProfile] = await Promise.all([
        resolveProjectedCircleSettings(prisma, sourceCircle),
        resolveCirclePolicyProfile(prisma, sourceCircleId),
    ]);
    const { sourceGateSnapshot, restrictionState } = classifySourceGate({
        sourceCircleId,
        joinRequirement: projectedPolicy.joinRequirement,
        circleType: projectedPolicy.circleType,
        minCrystals: projectedPolicy.minCrystals,
        policySource: projectedPolicy.source,
        capturedAt,
    });
    const gateEvaluationPolicy = {
        version: 1 as const,
        strategy: 'snapshot_and_current_most_restrictive' as const,
        allowSourceSideReleaseOverride: true,
    };
    const originSnapshot = {
        sourceCircleId,
        targetCircleId,
        declarationText: args.declaration.declarationText,
        originAnchorRef: args.lineage.originAnchorRef ?? args.declaration.originAnchorRef ?? null,
        qualificationSnapshot: asRecord(args.declaration.qualificationSnapshot),
        createdAtCutoff: capturedAt,
        sourceGateSnapshot,
        restrictionState,
        forkPolicy: asRecord(policyProfile.forkPolicy),
        policyConfigVersion: typeof policyProfile.configVersion === 'number'
            ? policyProfile.configVersion
            : null,
    };
    const digestPayload = {
        declarationId: args.declaration.declarationId,
        lineageId: args.lineage.lineageId,
        sourceCircleId,
        targetCircleId,
        sourcePathSnapshot,
        originSnapshot,
        gateEvaluationPolicy,
    };

    return {
        capsuleId: `fork-context:${sourceCircleId}:${targetCircleId}`,
        declarationId: args.declaration.declarationId,
        lineageId: args.lineage.lineageId,
        sourceCircleId,
        targetCircleId,
        actorUserId: args.declaration.actorUserId,
        sourcePathSnapshot,
        originSnapshot,
        gateEvaluationPolicy,
        capsuleDigest: sha256Hex(JSON.stringify(digestPayload)),
    };
}
