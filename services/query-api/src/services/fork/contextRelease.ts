import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import type { CircleActor } from '../auth/actor';
import { createSourceMaterial } from '../sourceMaterials/ingest';
import { createPrismaForkContextStore } from './contextStore';
import type {
    ForkContextReleaseRecord,
    ForkContextReleaseSourceRef,
} from './contextTypes';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export class ForkContextReleaseError extends Error {
    constructor(
        readonly code: string,
        readonly statusCode = 400,
    ) {
        super(code);
        this.name = 'ForkContextReleaseError';
    }
}

export interface CreateForkContextReleaseInput {
    sourceCircleId: number;
    targetCircleId: number | null;
    releaseAudience?: string;
    approvedByActor?: CircleActor | null;
    approvalMethod?: 'source_manager' | 'governance';
    governanceRequestId?: string | null;
    decisionDigest?: string | null;
    sourceRefs: ForkContextReleaseSourceRef[];
    summaryText: string;
    materializeSummary?: boolean;
    now?: Date;
}

export interface CreateForkContextReleaseResult {
    release: ForkContextReleaseRecord;
    materializedSourceMaterial: null | {
        id: number;
        circleId: number;
        originType: string;
        originRef: string | null;
        lifecycleStatus: string;
        evidencePrivacyClass: string;
    };
}

export interface RevokeForkContextReleaseInput {
    releaseId: string;
    sourceCircleId: number;
    revokedByActor: CircleActor;
    now?: Date;
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function asPositiveInteger(value: unknown, errorCode: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ForkContextReleaseError(errorCode, 400);
    }
    return parsed;
}

function asOptionalPositiveInteger(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asOptionalTargetCircleId(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ForkContextReleaseError('invalid_target_circle_id', 400);
    }
    return parsed;
}

function asNonEmptyString(value: unknown, errorCode: string, maxLength = 10_000): string {
    if (typeof value !== 'string') {
        throw new ForkContextReleaseError(errorCode, 400);
    }
    const normalized = value.trim();
    if (!normalized) {
        throw new ForkContextReleaseError(errorCode, 400);
    }
    return normalized.slice(0, maxLength);
}

function normalizeReleaseAudience(value: unknown): string {
    const normalized = String(value || 'target_circle').trim().toLowerCase();
    if (normalized === 'public') return 'public';
    if (normalized === 'summary_only') return 'summary_only';
    if (normalized === 'full_source') return 'full_source';
    if (normalized === 'external_app') return 'external_app';
    if (normalized === 'external_app_summary') return 'external_app_summary';
    if (normalized === 'target_circle') return 'target_circle';
    throw new ForkContextReleaseError('invalid_fork_context_release_audience', 400);
}

function normalizeSourceRefs(value: ForkContextReleaseSourceRef[]): ForkContextReleaseSourceRef[] {
    const refs = Array.isArray(value)
        ? value
            .map((entry) => {
                const referenceId = typeof entry?.referenceId === 'string'
                    ? entry.referenceId.trim()
                    : '';
                return {
                    referenceId,
                    sourceMaterialId: asOptionalPositiveInteger(entry?.sourceMaterialId),
                    sourceDigest: typeof entry?.sourceDigest === 'string' ? entry.sourceDigest.trim() || null : null,
                    summaryDigest: typeof entry?.summaryDigest === 'string' ? entry.summaryDigest.trim() || null : null,
                };
            })
            .filter((entry) => entry.referenceId.length > 0)
        : [];
    if (refs.length === 0) {
        throw new ForkContextReleaseError('fork_context_release_source_refs_required', 400);
    }
    return refs;
}

function buildReleaseDigest(input: {
    sourceCircleId: number;
    targetCircleId: number | null;
    releaseAudience: string;
    sourceRefs: ForkContextReleaseSourceRef[];
    summaryText: string;
    approvalMethod: string;
    governanceRequestId: string | null;
    decisionDigest: string | null;
}): string {
    return sha256Hex(JSON.stringify({
        sourceCircleId: input.sourceCircleId,
        targetCircleId: input.targetCircleId,
        releaseAudience: input.releaseAudience,
        sourceRefs: input.sourceRefs,
        summaryText: input.summaryText,
        approvalMethod: input.approvalMethod,
        governanceRequestId: input.governanceRequestId,
        decisionDigest: input.decisionDigest,
    }));
}

async function assertReleaseAuthority(
    prisma: PrismaLike,
    input: {
        sourceCircleId: number;
        approvedByActor: CircleActor | null;
        approvalMethod: 'source_manager' | 'governance';
        governanceRequestId: string | null;
        decisionDigest: string | null;
    },
) {
    if (input.approvalMethod === 'governance') {
        if (!input.governanceRequestId) {
            throw new ForkContextReleaseError('fork_context_release_governance_required', 403);
        }
        const request = await (prisma as any).governanceRequest.findUnique({
            where: { id: input.governanceRequestId },
            include: { decision: true },
        });
        if (!request) {
            throw new ForkContextReleaseError('fork_context_release_governance_not_found', 404);
        }
        if (request.actionType !== 'fork_context_release_create') {
            throw new ForkContextReleaseError('fork_context_release_governance_action_mismatch', 409);
        }
        if (request.scopeType !== 'circle' || String(request.scopeRef) !== String(input.sourceCircleId)) {
            throw new ForkContextReleaseError('fork_context_release_governance_scope_mismatch', 409);
        }
        if (request.state !== 'accepted') {
            throw new ForkContextReleaseError('fork_context_release_governance_not_accepted', 409);
        }
        if (
            input.decisionDigest
            && request.decision?.decisionDigest !== input.decisionDigest
        ) {
            throw new ForkContextReleaseError('fork_context_release_decision_digest_mismatch', 409);
        }
        return;
    }

    assertSourceManagerActor({
        actor: input.approvedByActor,
        sourceCircleId: input.sourceCircleId,
    });
}

function assertSourceManagerActor(input: {
    actor: CircleActor | null | undefined;
    sourceCircleId: number;
}): CircleActor {
    if (!input.actor) {
        throw new ForkContextReleaseError('fork_context_release_source_manager_required', 403);
    }
    if (input.actor.circle.id !== input.sourceCircleId) {
        throw new ForkContextReleaseError('fork_context_release_source_manager_required', 403);
    }
    if (!['Owner', 'Admin', 'Moderator'].includes(input.actor.membership.role)) {
        throw new ForkContextReleaseError('fork_context_release_source_manager_required', 403);
    }
    return input.actor;
}

async function assertReferencesBelongToReleaseScope(
    store: ReturnType<typeof createPrismaForkContextStore>,
    input: {
        sourceCircleId: number;
        targetCircleId: number | null;
        sourceRefs: ForkContextReleaseSourceRef[];
    },
) {
    for (const sourceRef of input.sourceRefs) {
        const reference = await store.getReferenceById(sourceRef.referenceId);
        if (!reference) {
            throw new ForkContextReleaseError('fork_context_release_reference_not_found', 404);
        }
        if (reference.sourceCircleId !== input.sourceCircleId) {
            throw new ForkContextReleaseError('fork_context_release_reference_source_mismatch', 409);
        }
        if (
            input.targetCircleId !== null
            && reference.targetCircleId !== input.targetCircleId
        ) {
            throw new ForkContextReleaseError('fork_context_release_reference_target_mismatch', 409);
        }
    }
}

export async function createForkContextRelease(
    prisma: PrismaClient,
    input: CreateForkContextReleaseInput,
): Promise<CreateForkContextReleaseResult> {
    const sourceCircleId = asPositiveInteger(input.sourceCircleId, 'invalid_source_circle_id');
    const targetCircleId = asOptionalTargetCircleId(input.targetCircleId);
    const sourceRefs = normalizeSourceRefs(input.sourceRefs);
    const summaryText = asNonEmptyString(input.summaryText, 'fork_context_release_summary_required');
    const releaseAudience = normalizeReleaseAudience(input.releaseAudience);
    const approvalMethod = input.approvalMethod
        ?? (input.governanceRequestId ? 'governance' : 'source_manager');
    const governanceRequestId = typeof input.governanceRequestId === 'string'
        ? input.governanceRequestId.trim() || null
        : null;
    const decisionDigest = typeof input.decisionDigest === 'string'
        ? input.decisionDigest.trim() || null
        : null;
    const now = input.now ?? new Date();

    await assertReleaseAuthority(prisma, {
        sourceCircleId,
        approvedByActor: input.approvedByActor ?? null,
        approvalMethod,
        governanceRequestId,
        decisionDigest,
    });
    const approvedByUserId = approvalMethod === 'source_manager'
        ? assertSourceManagerActor({
            actor: input.approvedByActor,
            sourceCircleId,
        }).userId
        : null;

    const store = createPrismaForkContextStore(prisma);
    await assertReferencesBelongToReleaseScope(store, {
        sourceCircleId,
        targetCircleId,
        sourceRefs,
    });

    const summaryDigest = buildReleaseDigest({
        sourceCircleId,
        targetCircleId,
        releaseAudience,
        sourceRefs,
        summaryText,
        approvalMethod,
        governanceRequestId,
        decisionDigest,
    });
    const releaseId = `fork-release:${sourceCircleId}:${targetCircleId ?? 'public'}:${summaryDigest.slice(0, 32)}`;

    await prisma.$queryRaw(Prisma.sql`
        INSERT INTO fork_context_releases (
            release_id,
            source_circle_id,
            target_circle_id,
            release_audience,
            approved_by_user_id,
            approval_method,
            governance_request_id,
            decision_digest,
            source_refs,
            summary_text,
            summary_digest,
            status,
            created_at,
            updated_at
        ) VALUES (
            ${releaseId},
            ${sourceCircleId},
            ${targetCircleId},
            ${releaseAudience},
            ${approvedByUserId},
            ${approvalMethod},
            ${governanceRequestId},
            ${decisionDigest},
            ${JSON.stringify(sourceRefs)}::jsonb,
            ${summaryText},
            ${summaryDigest},
            'active',
            ${now},
            ${now}
        )
        ON CONFLICT (release_id) DO UPDATE
        SET
            release_audience = EXCLUDED.release_audience,
            approved_by_user_id = EXCLUDED.approved_by_user_id,
            approval_method = EXCLUDED.approval_method,
            governance_request_id = EXCLUDED.governance_request_id,
            decision_digest = EXCLUDED.decision_digest,
            source_refs = EXCLUDED.source_refs,
            summary_text = EXCLUDED.summary_text,
            summary_digest = EXCLUDED.summary_digest,
            status = 'active',
            revoked_at = NULL,
            updated_at = EXCLUDED.updated_at
    `);

    for (const sourceRef of sourceRefs) {
        await prisma.$executeRaw(Prisma.sql`
            UPDATE fork_upstream_references
            SET
                release_id = ${releaseId},
                visibility_state = 'released_summary',
                restriction_state = 'released_safe_summary',
                summary_digest = ${summaryDigest},
                updated_at = ${now}
            WHERE reference_id = ${sourceRef.referenceId}
              AND source_circle_id = ${sourceCircleId}
              ${targetCircleId === null ? Prisma.empty : Prisma.sql`AND target_circle_id = ${targetCircleId}`}
        `);
    }

    const release = await store.getActiveReleaseById(releaseId);
    if (!release) {
        throw new ForkContextReleaseError('fork_context_release_write_failed', 500);
    }

    let materializedSourceMaterial: CreateForkContextReleaseResult['materializedSourceMaterial'] = null;
    if (input.materializeSummary !== false && targetCircleId !== null) {
        const material = await createSourceMaterial(prisma, {
            circleId: targetCircleId,
            name: `Fork upstream summary: ${sourceCircleId} -> ${targetCircleId}`,
            mimeType: 'text/plain',
            content: summaryText,
            originType: 'fork_upstream_reference',
            originRef: sourceRefs.length === 1 ? sourceRefs[0].referenceId : releaseId,
            lifecycleStatus: 'accepted_to_plaza',
            summaryText,
            evidencePrivacyClass: 'circle_only',
            visibilityScope: 'circle',
            provenance: {
                source: {
                    kind: 'fork_context_release',
                    releaseId,
                    referenceId: sourceRefs.length === 1 ? sourceRefs[0].referenceId : null,
                    sourceCircleId,
                    targetCircleId,
                    sourceRefs,
                    summaryDigest,
                },
                restriction: {
                    state: 'released_safe_summary',
                    audience: releaseAudience,
                },
            },
        });
        materializedSourceMaterial = {
            id: material.id,
            circleId: material.circleId,
            originType: material.originType,
            originRef: material.originRef,
            lifecycleStatus: material.lifecycleStatus,
            evidencePrivacyClass: material.evidencePrivacyClass,
        };
    }

    return {
        release,
        materializedSourceMaterial,
    };
}

export async function revokeForkContextRelease(
    prisma: PrismaClient,
    input: RevokeForkContextReleaseInput,
): Promise<{ releaseId: string; revoked: true }> {
    const releaseId = asNonEmptyString(input.releaseId, 'invalid_release_id', 128);
    const sourceCircleId = asPositiveInteger(input.sourceCircleId, 'invalid_source_circle_id');
    const now = input.now ?? new Date();
    assertSourceManagerActor({
        actor: input.revokedByActor,
        sourceCircleId,
    });

    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE fork_context_releases
        SET
            status = 'revoked',
            revoked_at = ${now},
            updated_at = ${now}
        WHERE release_id = ${releaseId}
          AND source_circle_id = ${sourceCircleId}
          AND status = 'active'
    `);
    if (Number(updated) <= 0) {
        throw new ForkContextReleaseError('fork_context_release_not_found', 404);
    }
    await prisma.$executeRaw(Prisma.sql`
        UPDATE fork_upstream_references
        SET
            release_id = NULL,
            visibility_state = 'source_gated',
            restriction_state = 'source_gate_required',
            updated_at = ${now}
        WHERE release_id = ${releaseId}
          AND source_circle_id = ${sourceCircleId}
    `);
    return {
        releaseId,
        revoked: true,
    };
}
