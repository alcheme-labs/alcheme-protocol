import type { PrismaLike, AiJobRecord, AiJobStatus, AiJobView, AiJobScopeType } from './types';

function toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    return new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    return toDate(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

export function toAiJobRecord(row: any): AiJobRecord {
    return {
        id: Number(row.id),
        jobType: String(row.jobType || row.job_type) as AiJobRecord['jobType'],
        dedupeKey: row.dedupeKey ?? row.dedupe_key ?? null,
        scopeType: String(row.scopeType || row.scope_type) as AiJobScopeType,
        scopeDraftPostId:
            row.scopeDraftPostId === null || row.scopeDraftPostId === undefined
                ? (row.scope_draft_post_id === null || row.scope_draft_post_id === undefined
                    ? null
                    : Number(row.scope_draft_post_id))
                : Number(row.scopeDraftPostId),
        scopeCircleId:
            row.scopeCircleId === null || row.scopeCircleId === undefined
                ? (row.scope_circle_id === null || row.scope_circle_id === undefined
                    ? null
                    : Number(row.scope_circle_id))
                : Number(row.scopeCircleId),
        requestedByUserId:
            row.requestedByUserId === null || row.requestedByUserId === undefined
                ? (row.requested_by_user_id === null || row.requested_by_user_id === undefined
                    ? null
                    : Number(row.requested_by_user_id))
                : Number(row.requestedByUserId),
        status: String(row.status) as AiJobStatus,
        attempts: Number(row.attempts || 0),
        maxAttempts: Number(row.maxAttempts ?? row.max_attempts ?? 3),
        availableAt: toDate(row.availableAt ?? row.available_at),
        claimedAt: toDateOrNull(row.claimedAt ?? row.claimed_at),
        completedAt: toDateOrNull(row.completedAt ?? row.completed_at),
        workerId: row.workerId ?? row.worker_id ?? null,
        claimToken: row.claimToken ?? row.claim_token ?? null,
        payload: toRecord(row.payload ?? row.payloadJson ?? row.payload_json),
        result: toRecord(row.result ?? row.resultJson ?? row.result_json),
        lastErrorCode: row.lastErrorCode ?? row.last_error_code ?? null,
        lastErrorMessage: row.lastErrorMessage ?? row.last_error_message ?? null,
        createdAt: toDate(row.createdAt ?? row.created_at),
        updatedAt: toDate(row.updatedAt ?? row.updated_at),
    };
}

export function toAiJobView(job: AiJobRecord): AiJobView {
    const { claimToken: _claimToken, ...view } = job;
    return view;
}

export async function loadAiJobById(prisma: PrismaLike, jobId: number): Promise<AiJobRecord | null> {
    const prismaAny = prisma as any;
    const row = await prismaAny.aiJob.findUnique({
        where: { id: jobId },
    });
    return row ? toAiJobRecord(row) : null;
}

export async function listAiJobs(
    prisma: PrismaLike,
    input: {
        requestedByUserId?: number;
        scopeType?: AiJobScopeType;
        scopeDraftPostId?: number;
        scopeCircleId?: number;
        statuses?: AiJobStatus[];
        limit?: number;
        offset?: number;
    },
): Promise<AiJobRecord[]> {
    const prismaAny = prisma as any;
    const rows = await prismaAny.aiJob.findMany({
        where: {
            requestedByUserId: input.requestedByUserId,
            scopeType: input.scopeType,
            scopeDraftPostId: input.scopeDraftPostId,
            scopeCircleId: input.scopeCircleId,
            status: input.statuses?.length ? { in: input.statuses } : undefined,
        },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        skip: Math.max(0, Number(input.offset ?? 0)),
        take: input.limit ?? 20,
    });
    return Array.isArray(rows) ? rows.map(toAiJobRecord) : [];
}
