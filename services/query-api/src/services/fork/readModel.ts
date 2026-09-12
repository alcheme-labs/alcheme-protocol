import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveCirclePolicyProfile } from '../policy/profile';
import { hashCanonicalGovernanceValue } from '../governance/canonicalCodec';

const FORK_INHERITED_PREFLIGHT = [
    'source_qualification',
    'source_governance_consent',
    'source_lifecycle',
    'target_identity',
    'migration_dispositions',
    'resource_non_transfer',
] as const;

interface ForkLineageViewRow {
    lineageId: string | number;
    sourceCircleId: number;
    targetCircleId: number;
    declarationId: string | number;
    sourceCircleName: string;
    targetCircleName: string;
    declarationText: string;
    status: string;
    originAnchorRef: string | null;
    executionAnchorDigest: string | null;
    inheritanceSnapshot: unknown;
    createdAt: Date;
    currentCheckpointDay: number | null;
    nextCheckAt: Date | null;
    inactiveStreak: number | null;
    markerVisible: boolean | null;
    permanentAt: Date | null;
    hiddenAt: Date | null;
    lastEvaluatedAt: Date | null;
}

export interface ForkLineageViewItem {
    lineageId: string;
    sourceCircleId: number;
    targetCircleId: number;
    declarationId: string;
    sourceCircleName: string;
    targetCircleName: string;
    declarationText: string;
    status: string;
    originAnchorRef: string | null;
    executionAnchorDigest: string | null;
    migrationManifest: Record<string, unknown> | null;
    createdAt: string;
    currentCheckpointDay: number | null;
    nextCheckAt: string | null;
    inactiveStreak: number | null;
    markerVisible: boolean | null;
    permanentAt: string | null;
    hiddenAt: string | null;
    lastEvaluatedAt: string | null;
}

export interface ForkLineageView {
    circleId: number;
    asSource: ForkLineageViewItem[];
    asTarget: ForkLineageViewItem[];
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function assertIndependentForkTargetHome(input: {
    targetCircleId: number;
    targetCircleAccountRef: string;
    targetHome: any;
}): {
    governanceHomeIdentityBindingId: string;
    governanceHomeIdentityVersion: number;
    governanceHomeBindingDigest: string;
    governanceHomeStatus: 'inactive' | 'active';
    governanceBootstrapState: 'bootstrap_pending' | 'preparing' | 'active';
    governanceBootstrapBypassStatus: 'disabled';
} {
    const expectedIdentityId = `governance-home-circle-${input.targetCircleId}-v1`;
    const identity = input.targetHome;
    const activation = identity?.activationState;
    const validState = activation?.state === 'bootstrap_pending'
        || activation?.state === 'preparing'
        || activation?.state === 'active';
    const validIdentityStatus = activation?.state === 'active'
        ? identity?.status === 'active'
        : identity?.status === 'inactive';
    if (
        !identity
        || identity.id !== expectedIdentityId
        || identity.homeType !== 'circle'
        || identity.homeRef !== String(input.targetCircleId)
        || identity.identityVersion !== 1
        || identity.chainAccountRef !== input.targetCircleAccountRef
        || identity.sourceType !== 'circle_program'
        || identity.sourceRef !== input.targetCircleAccountRef
        || identity.sourceVersion !== 'circle-manager-0.3.0'
        || typeof identity.bindingDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(identity.bindingDigest)
        || !activation
        || activation.homeIdentityBindingId !== identity.id
        || !validState
        || !validIdentityStatus
        || activation.bootstrapBypassStatus !== 'disabled'
    ) {
        throw new Error('fork_target_governance_home_not_ready');
    }
    return {
        governanceHomeIdentityBindingId: identity.id,
        governanceHomeIdentityVersion: identity.identityVersion,
        governanceHomeBindingDigest: identity.bindingDigest,
        governanceHomeStatus: identity.status,
        governanceBootstrapState: activation.state,
        governanceBootstrapBypassStatus: activation.bootstrapBypassStatus,
    };
}

function publicMigrationManifest(
    value: unknown,
    sourceCircleId: number,
    targetCircleId: number,
): Record<string, unknown> | null {
    const manifest = asRecord(value);
    const source = asRecord(manifest?.source);
    const target = asRecord(manifest?.target);
    const consent = asRecord(manifest?.consent);
    const dispositions = asRecord(manifest?.dispositions);
    const topology = asRecord(manifest?.topology);
    const inheritedPreflight = Array.isArray(manifest?.inheritedPreflight)
        ? manifest.inheritedPreflight
        : null;
    const { manifestDigest: _manifestDigest, ...manifestBody } = manifest ?? {};
    let digestMatches = false;
    try {
        digestMatches = manifest?.manifestDigest === hashCanonicalGovernanceValue(
            'fork.migration_manifest',
            manifestBody,
        );
    } catch {
        digestMatches = false;
    }
    if (
        manifest?.manifestVersion !== 'fork-migration-manifest-v1'
        || manifest.operation !== 'fork'
        || manifest.changeLevel !== 'organization_restructuring'
        || !inheritedPreflight
        || inheritedPreflight.length !== FORK_INHERITED_PREFLIGHT.length
        || !FORK_INHERITED_PREFLIGHT.every((item, index) => inheritedPreflight[index] === item)
        || typeof manifest.manifestDigest !== 'string'
        || !digestMatches
        || Number(source?.circleId) !== sourceCircleId
        || source?.lifecycleDisposition !== 'remain_active'
        || source?.canonicalOwnership !== 'retained_by_source'
        || Number(target?.circleId) !== targetCircleId
        || target?.lifecycleDisposition !== 'independent_active_circle'
        || target?.governanceHomeIdentityBindingId !== `governance-home-circle-${targetCircleId}-v1`
        || target?.governanceHomeIdentityVersion !== 1
        || typeof target?.governanceHomeBindingDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(target.governanceHomeBindingDigest)
        || (target?.governanceHomeStatus !== 'inactive' && target?.governanceHomeStatus !== 'active')
        || (
            target?.governanceBootstrapState !== 'bootstrap_pending'
            && target?.governanceBootstrapState !== 'preparing'
            && target?.governanceBootstrapState !== 'active'
        )
        || (target?.governanceBootstrapState === 'active'
            ? target?.governanceHomeStatus !== 'active'
            : target?.governanceHomeStatus !== 'inactive')
        || target?.governanceBootstrapBypassStatus !== 'disabled'
        || (consent?.mode !== 'accepted_governance_request' && consent?.mode !== 'qualified_actor_declaration')
        || dispositions?.members !== 'not_migrated_reconsent_required'
        || dispositions?.operator !== 'not_inherited_reauthorization_required'
        || dispositions?.electorate !== 'not_inherited_reauthorization_required'
        || dispositions?.privateContent !== 'not_copied_source_gate_retained'
        || dispositions?.knowledge !== 'source_owned_reference_only'
        || dispositions?.mandates !== 'not_inherited'
        || dispositions?.grants !== 'not_inherited'
        || dispositions?.votingPower !== 'not_inherited'
        || dispositions?.visibility !== 'not_inherited'
        || dispositions?.externalAuthority !== 'not_inherited_reauthorization_required'
        || dispositions?.vaultProgramAuthority !== 'not_transferred'
        || topology?.nameOrParentChangeTransfersAssets !== false
    ) {
        return null;
    }
    return {
        manifestVersion: manifest.manifestVersion,
        operation: manifest.operation,
        changeLevel: manifest.changeLevel,
        inheritedPreflight,
        manifestDigest: manifest.manifestDigest,
        source,
        target,
        consent: { mode: consent.mode },
        dispositions,
        topology,
        unsupportedOperations: Array.isArray(manifest.unsupportedOperations)
            ? manifest.unsupportedOperations.filter((item) => item === 'split' || item === 'merge')
            : [],
    };
}

function mapLineageViewRow(row: ForkLineageViewRow): ForkLineageViewItem {
    return {
        lineageId: String(row.lineageId),
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId,
        declarationId: String(row.declarationId),
        sourceCircleName: row.sourceCircleName,
        targetCircleName: row.targetCircleName,
        declarationText: row.declarationText,
        status: String(row.status || 'completed'),
        originAnchorRef: row.originAnchorRef ?? null,
        executionAnchorDigest: row.executionAnchorDigest ?? null,
        migrationManifest: publicMigrationManifest(
            asRecord(row.inheritanceSnapshot)?.migrationManifest,
            row.sourceCircleId,
            row.targetCircleId,
        ),
        createdAt: row.createdAt.toISOString(),
        currentCheckpointDay: typeof row.currentCheckpointDay === 'number' ? row.currentCheckpointDay : null,
        nextCheckAt: row.nextCheckAt instanceof Date ? row.nextCheckAt.toISOString() : null,
        inactiveStreak: typeof row.inactiveStreak === 'number' ? row.inactiveStreak : null,
        markerVisible: typeof row.markerVisible === 'boolean' ? row.markerVisible : null,
        permanentAt: row.permanentAt instanceof Date ? row.permanentAt.toISOString() : null,
        hiddenAt: row.hiddenAt instanceof Date ? row.hiddenAt.toISOString() : null,
        lastEvaluatedAt: row.lastEvaluatedAt instanceof Date ? row.lastEvaluatedAt.toISOString() : null,
    };
}

export async function loadForkLineageView(
    prisma: PrismaClient,
    circleId: number,
): Promise<ForkLineageView> {
    const normalizedCircleId = asPositiveInteger(circleId);
    if (!normalizedCircleId) {
        throw new Error('invalid_circle_id');
    }

    const rows = await prisma.$queryRaw<ForkLineageViewRow[]>(Prisma.sql`
        SELECT
            lineage.lineage_id AS "lineageId",
            lineage.source_circle_id AS "sourceCircleId",
            lineage.target_circle_id AS "targetCircleId",
            lineage.declaration_id AS "declarationId",
            source_circle.name AS "sourceCircleName",
            target_circle.name AS "targetCircleName",
            declaration.declaration_text AS "declarationText",
            declaration.status AS "status",
            COALESCE(lineage.origin_anchor_ref, declaration.origin_anchor_ref) AS "originAnchorRef",
            COALESCE(lineage.execution_anchor_digest, declaration.execution_anchor_digest) AS "executionAnchorDigest",
            lineage.inheritance_snapshot AS "inheritanceSnapshot",
            lineage.created_at AS "createdAt",
            retention.current_checkpoint_day AS "currentCheckpointDay",
            retention.next_check_at AS "nextCheckAt",
            retention.inactive_streak AS "inactiveStreak",
            retention.marker_visible AS "markerVisible",
            retention.permanent_at AS "permanentAt",
            retention.hidden_at AS "hiddenAt",
            retention.last_evaluated_at AS "lastEvaluatedAt"
        FROM circle_fork_lineage lineage
        INNER JOIN fork_declarations declaration
            ON declaration.declaration_id = lineage.declaration_id
        INNER JOIN circles source_circle
            ON source_circle.id = lineage.source_circle_id
        INNER JOIN circles target_circle
            ON target_circle.id = lineage.target_circle_id
        LEFT JOIN circle_fork_retention_state retention
            ON retention.target_circle_id = lineage.target_circle_id
        WHERE lineage.source_circle_id = ${normalizedCircleId}
           OR lineage.target_circle_id = ${normalizedCircleId}
        ORDER BY lineage.created_at DESC
    `);

    const items = rows.map(mapLineageViewRow);
    return {
        circleId: normalizedCircleId,
        asSource: items.filter((item) => item.sourceCircleId === normalizedCircleId),
        asTarget: items.filter((item) => item.targetCircleId === normalizedCircleId),
    };
}

export async function buildForkInheritanceSnapshot(
    prisma: PrismaClient,
    sourceCircleId: number,
    input?: {
        targetCircleId: number;
        declarationId: string;
        actorUserId: number;
        governanceRequestId?: string | null;
        governanceReceiptId?: string | null;
    },
): Promise<Record<string, unknown>> {
    const normalizedCircleId = asPositiveInteger(sourceCircleId);
    if (!normalizedCircleId) {
        throw new Error('invalid_source_circle_id');
    }

    const [circle, policyProfile, targetCircle, targetHome] = await Promise.all([
        prisma.circle.findUnique({
            where: { id: normalizedCircleId },
            select: {
                id: true,
                name: true,
                description: true,
                mode: true,
                joinRequirement: true,
                minCrystals: true,
                lifecycleStatus: true,
                parentCircleId: true,
            },
        }),
        resolveCirclePolicyProfile(prisma, normalizedCircleId),
        input
            ? prisma.circle.findUnique({
                where: { id: input.targetCircleId },
                select: {
                    id: true,
                    name: true,
                    creatorId: true,
                    parentCircleId: true,
                    lifecycleStatus: true,
                    onChainAddress: true,
                },
            })
            : Promise.resolve(null),
        input
            ? prisma.governanceHomeIdentityBinding.findUnique({
                where: { id: `governance-home-circle-${input.targetCircleId}-v1` },
                include: { activationState: true },
            })
            : Promise.resolve(null),
    ]);

    if (!circle) {
        throw new Error('source_circle_not_found');
    }
    if (input && !targetCircle) {
        throw new Error('fork_target_circle_not_found');
    }
    if (input && input.targetCircleId === normalizedCircleId) {
        throw new Error('fork_target_must_be_distinct');
    }
    if (input && targetCircle && targetCircle.creatorId !== input.actorUserId) {
        throw new Error('fork_target_creator_mismatch');
    }
    if (input && String(circle.lifecycleStatus) !== 'Active') {
        throw new Error('fork_source_circle_not_active');
    }
    if (input && targetCircle && String(targetCircle.lifecycleStatus) !== 'Active') {
        throw new Error('fork_target_circle_not_active');
    }
    const targetHomeFacts = input && targetCircle
        ? assertIndependentForkTargetHome({
            targetCircleId: targetCircle.id,
            targetCircleAccountRef: String(targetCircle.onChainAddress || ''),
            targetHome,
        })
        : null;

    const migrationManifestBody = input && targetCircle ? {
        manifestVersion: 'fork-migration-manifest-v1',
        operation: 'fork',
        changeLevel: 'organization_restructuring',
        inheritedPreflight: [...FORK_INHERITED_PREFLIGHT],
        source: {
            circleId: circle.id,
            lifecycleDisposition: 'remain_active',
            canonicalOwnership: 'retained_by_source',
        },
        target: {
            circleId: targetCircle.id,
            lifecycleDisposition: 'independent_active_circle',
            ...targetHomeFacts,
        },
        consent: {
            mode: input.governanceRequestId
                ? 'accepted_governance_request'
                : 'qualified_actor_declaration',
            declarationId: input.declarationId,
            actorUserId: input.actorUserId,
            governanceRequestId: input.governanceRequestId ?? null,
            governanceReceiptId: input.governanceReceiptId ?? null,
        },
        dispositions: {
            members: 'not_migrated_reconsent_required',
            operator: 'not_inherited_reauthorization_required',
            electorate: 'not_inherited_reauthorization_required',
            privateContent: 'not_copied_source_gate_retained',
            knowledge: 'source_owned_reference_only',
            mandates: 'not_inherited',
            grants: 'not_inherited',
            votingPower: 'not_inherited',
            visibility: 'not_inherited',
            externalAuthority: 'not_inherited_reauthorization_required',
            vaultProgramAuthority: 'not_transferred',
        },
        topology: {
            sourceParentCircleId: circle.parentCircleId ?? null,
            targetParentCircleId: targetCircle.parentCircleId ?? null,
            nameOrParentChangeTransfersAssets: false,
        },
        unsupportedOperations: ['split', 'merge'],
    } : null;
    const snapshot: Record<string, unknown> = {
        sourceType: policyProfile.sourceType,
        inheritanceMode: policyProfile.inheritanceMode,
        localEditability: policyProfile.localEditability,
        inheritsFromProfileId: policyProfile.inheritsFromProfileId,
        inheritsFromCircleId: policyProfile.inheritsFromCircleId,
        configVersion: policyProfile.configVersion,
        baseCircle: {
            circleId: circle.id,
            name: circle.name,
            description: circle.description ?? null,
            mode: circle.mode,
            joinRequirement: circle.joinRequirement,
            minCrystals: circle.minCrystals,
        },
        draftLifecycleTemplate: policyProfile.draftLifecycleTemplate,
        draftWorkflowPolicy: policyProfile.draftWorkflowPolicy,
        ghostPolicy: policyProfile.ghostPolicy,
        forkPolicy: policyProfile.forkPolicy,
    };
    if (migrationManifestBody) {
        snapshot.migrationManifest = {
            ...migrationManifestBody,
            manifestDigest: hashCanonicalGovernanceValue('fork.migration_manifest', migrationManifestBody),
        };
    }
    return snapshot;
}
