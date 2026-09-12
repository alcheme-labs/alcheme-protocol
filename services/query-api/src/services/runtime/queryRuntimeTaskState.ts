import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

type SqlClient = PrismaClient | Prisma.TransactionClient;

const MIN_LEASE_MS = 5_000;
const DEFAULT_LEASE_MS = 30_000;

export interface SingletonTaskEligibilityInput {
    now: Date;
    leaseUntil: Date | null;
    lastCompletedAt: Date | null;
    minIntervalMs: number;
}

export interface SingletonTaskRunOptions {
    taskKey: string;
    ownerId: string;
    leaseMs: number;
    minIntervalMs: number;
    heartbeatMs?: number;
}

interface TaskLeaseRow {
    taskKey: string;
    leaseId: string;
}

export interface SingletonTaskLease {
    taskKey: string;
    ownerId: string;
    leaseId: string;
}

export interface QueryRuntimeTaskStateRow {
    taskKey: string;
    ownerId: string | null;
    leaseId: string | null;
    leaseUntil: Date | null;
    lastStartedAt: Date | null;
    lastHeartbeatAt: Date | null;
    lastCompletedAt: Date | null;
    lastSkippedAt: Date | null;
    lastError: string | null;
}

function normalizeDurationMs(value: number, input: { min: number; fallback: number }): number {
    if (!Number.isFinite(value)) return input.fallback;
    return Math.max(input.min, Math.trunc(value));
}

export function buildQueryRuntimeTaskStateSchemaStatements(): string[] {
    return [
        `
        CREATE TABLE IF NOT EXISTS query_runtime_task_states (
            task_key VARCHAR(96) PRIMARY KEY,
            owner_id VARCHAR(128),
            lease_id VARCHAR(64),
            lease_until TIMESTAMP(3),
            last_started_at TIMESTAMP(3),
            last_heartbeat_at TIMESTAMP(3),
            last_completed_at TIMESTAMP(3),
            last_skipped_at TIMESTAMP(3),
            last_error TEXT,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `
        CREATE INDEX IF NOT EXISTS idx_query_runtime_task_states_lease_until
            ON query_runtime_task_states(lease_until)
        `,
        `
        CREATE INDEX IF NOT EXISTS idx_query_runtime_task_states_last_completed_at
            ON query_runtime_task_states(last_completed_at)
        `,
        `
        ALTER TABLE query_runtime_task_states
            ADD COLUMN IF NOT EXISTS lease_id VARCHAR(64)
        `,
        `
        UPDATE query_runtime_task_states
        SET lease_id = NULL
        WHERE lease_until IS NULL
        `,
    ];
}

export function buildTryClaimSingletonTaskSqlPreview(): string {
    return `
        INSERT INTO query_runtime_task_states (
            task_key,
            owner_id,
            lease_id,
            lease_until,
            last_started_at,
            last_heartbeat_at,
            last_error,
            updated_at
        )
        VALUES (...)
        ON CONFLICT (task_key) DO UPDATE SET
            owner_id = EXCLUDED.owner_id,
            lease_id = EXCLUDED.lease_id,
            lease_until = EXCLUDED.lease_until,
            last_started_at = EXCLUDED.last_started_at,
            last_heartbeat_at = EXCLUDED.last_heartbeat_at,
            last_error = NULL,
            updated_at = NOW()
        WHERE (lease_until IS NULL OR lease_until <= NOW())
          AND (last_completed_at IS NULL OR last_completed_at <= NOW() - ...)
        RETURNING task_key AS "taskKey", lease_id AS "leaseId"
    `;
}

export function buildRenewSingletonTaskLeaseSqlPreview(): string {
    return `
        UPDATE query_runtime_task_states
        SET
            lease_until = ...,
            last_heartbeat_at = ...,
            updated_at = NOW()
        WHERE task_key = ...
          AND owner_id = ...
          AND lease_id = ...
          AND lease_until > NOW()
    `;
}

export function shouldAttemptSingletonTaskRun(input: SingletonTaskEligibilityInput): boolean {
    if (input.leaseUntil && input.leaseUntil.getTime() > input.now.getTime()) {
        return false;
    }
    if (!input.lastCompletedAt) return true;
    return input.now.getTime() - input.lastCompletedAt.getTime() >= Math.max(0, input.minIntervalMs);
}

export async function ensureQueryRuntimeTaskStateSchema(prisma: PrismaClient): Promise<void> {
    for (const stmt of buildQueryRuntimeTaskStateSchemaStatements()) {
        // Static bootstrap DDL only; never interpolate user input into these statements.
        await prisma.$executeRawUnsafe(stmt);
    }
}

export async function listQueryRuntimeTaskStates(
    client: SqlClient,
): Promise<QueryRuntimeTaskStateRow[]> {
    try {
        return await client.$queryRaw<QueryRuntimeTaskStateRow[]>(Prisma.sql`
            SELECT
                task_key AS "taskKey",
                owner_id AS "ownerId",
                lease_id AS "leaseId",
                lease_until AS "leaseUntil",
                last_started_at AS "lastStartedAt",
                last_heartbeat_at AS "lastHeartbeatAt",
                last_completed_at AS "lastCompletedAt",
                last_skipped_at AS "lastSkippedAt",
                last_error AS "lastError"
            FROM query_runtime_task_states
            ORDER BY task_key ASC
        `);
    } catch {
        return [];
    }
}

export async function tryClaimSingletonTask(
    client: SqlClient,
    input: SingletonTaskRunOptions,
): Promise<SingletonTaskLease | null> {
    const safeLeaseMs = normalizeDurationMs(input.leaseMs, {
        min: MIN_LEASE_MS,
        fallback: DEFAULT_LEASE_MS,
    });
    const safeMinIntervalMs = normalizeDurationMs(input.minIntervalMs, {
        min: 0,
        fallback: 0,
    });
    const leaseId = randomUUID();

    const rows = await client.$queryRaw<TaskLeaseRow[]>(Prisma.sql`
        INSERT INTO query_runtime_task_states (
            task_key,
            owner_id,
            lease_id,
            lease_until,
            last_started_at,
            last_heartbeat_at,
            last_error,
            updated_at
        )
        VALUES (
            ${input.taskKey},
            ${input.ownerId},
            ${leaseId},
            NOW() + (${safeLeaseMs} * INTERVAL '1 millisecond'),
            NOW(),
            NOW(),
            NULL,
            NOW()
        )
        ON CONFLICT (task_key) DO UPDATE SET
            owner_id = EXCLUDED.owner_id,
            lease_id = EXCLUDED.lease_id,
            lease_until = EXCLUDED.lease_until,
            last_started_at = EXCLUDED.last_started_at,
            last_heartbeat_at = EXCLUDED.last_heartbeat_at,
            last_error = NULL,
            updated_at = NOW()
        WHERE (
                query_runtime_task_states.lease_until IS NULL
                OR query_runtime_task_states.lease_until <= NOW()
            )
          AND (
                query_runtime_task_states.last_completed_at IS NULL
                OR query_runtime_task_states.last_completed_at <= NOW() - (${safeMinIntervalMs} * INTERVAL '1 millisecond')
            )
        RETURNING task_key AS "taskKey", lease_id AS "leaseId"
    `);

    if (rows.length > 0) {
        return {
            taskKey: rows[0].taskKey,
            ownerId: input.ownerId,
            leaseId: rows[0].leaseId,
        };
    }

    await client.$executeRaw(Prisma.sql`
        UPDATE query_runtime_task_states
        SET
            last_skipped_at = NOW(),
            updated_at = NOW()
        WHERE task_key = ${input.taskKey}
    `);
    return null;
}

export async function completeSingletonTask(
    client: SqlClient,
    input: SingletonTaskLease,
): Promise<boolean> {
    const updated = await client.$executeRaw(Prisma.sql`
        UPDATE query_runtime_task_states
        SET
            lease_id = NULL,
            lease_until = NULL,
            last_heartbeat_at = NOW(),
            last_completed_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE task_key = ${input.taskKey}
          AND owner_id = ${input.ownerId}
          AND lease_id = ${input.leaseId}
          AND lease_until > NOW()
    `);
    return Number(updated) === 1;
}

export async function renewSingletonTaskLease(
    client: SqlClient,
    input: SingletonTaskLease & { leaseMs: number },
): Promise<boolean> {
    const safeLeaseMs = normalizeDurationMs(input.leaseMs, {
        min: MIN_LEASE_MS,
        fallback: DEFAULT_LEASE_MS,
    });
    const updated = await client.$executeRaw(Prisma.sql`
        UPDATE query_runtime_task_states
        SET
            lease_until = NOW() + (${safeLeaseMs} * INTERVAL '1 millisecond'),
            last_heartbeat_at = NOW(),
            updated_at = NOW()
        WHERE task_key = ${input.taskKey}
          AND owner_id = ${input.ownerId}
          AND lease_id = ${input.leaseId}
          AND lease_until > NOW()
    `);
    return Number(updated) === 1;
}

export async function failSingletonTask(
    client: SqlClient,
    input: SingletonTaskLease & { error: string },
): Promise<boolean> {
    const updated = await client.$executeRaw(Prisma.sql`
        UPDATE query_runtime_task_states
        SET
            lease_id = NULL,
            lease_until = NULL,
            last_error = ${input.error.slice(0, 2000)},
            updated_at = NOW()
        WHERE task_key = ${input.taskKey}
          AND owner_id = ${input.ownerId}
          AND lease_id = ${input.leaseId}
          AND lease_until > NOW()
    `);
    return Number(updated) === 1;
}

async function lockSingletonTaskLease(
    client: SqlClient,
    lease: SingletonTaskLease,
): Promise<boolean> {
    const rows = await client.$queryRaw<TaskLeaseRow[]>(Prisma.sql`
        SELECT task_key AS "taskKey", lease_id AS "leaseId"
        FROM query_runtime_task_states
        WHERE task_key = ${lease.taskKey}
          AND owner_id = ${lease.ownerId}
          AND lease_id = ${lease.leaseId}
          AND lease_until > NOW()
        FOR UPDATE
    `);
    return rows.length === 1;
}

export async function runSingletonTaskTransaction(
    client: PrismaClient,
    input: SingletonTaskRunOptions,
    task: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<'ran' | 'skipped'> {
    const lease = await tryClaimSingletonTask(client, input);
    if (!lease) return 'skipped';

    try {
        await client.$transaction(async (tx) => {
            const locked = await lockSingletonTaskLease(tx, lease);
            if (!locked) {
                throw new Error('singleton_task_lease_lost');
            }
            await task(tx);
            const completed = await completeSingletonTask(tx, lease);
            if (!completed) {
                throw new Error('singleton_task_lease_lost');
            }
        });
        return 'ran';
    } catch (error) {
        await failSingletonTask(client, {
            ...lease,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

export async function runSingletonTask(
    client: SqlClient,
    input: SingletonTaskRunOptions,
    task: () => Promise<void>,
): Promise<'ran' | 'skipped'> {
    const lease = await tryClaimSingletonTask(client, input);
    if (!lease) return 'skipped';

    const safeLeaseMs = normalizeDurationMs(input.leaseMs, {
        min: MIN_LEASE_MS,
        fallback: DEFAULT_LEASE_MS,
    });
    let leaseLost = false;
    let renewalError: unknown = null;
    let heartbeatRenewal: Promise<void> | null = null;
    const heartbeatMs = Math.max(
        1_000,
        Math.min(
            Math.floor(safeLeaseMs / 3),
            normalizeDurationMs(input.heartbeatMs ?? 30_000, {
                min: 1_000,
                fallback: 30_000,
            }),
        ),
    );
    const runHeartbeatRenewal = async () => {
        try {
            const renewed = await renewSingletonTaskLease(client, {
                ...lease,
                leaseMs: safeLeaseMs,
            });
            if (!renewed) {
                leaseLost = true;
            }
        } catch (error) {
            leaseLost = true;
            renewalError = error;
        }
    };
    const heartbeat = setInterval(() => {
        if (heartbeatRenewal) return;
        heartbeatRenewal = runHeartbeatRenewal().finally(() => {
            heartbeatRenewal = null;
        });
    }, heartbeatMs);
    let heartbeatStopped = false;
    const stopHeartbeat = async () => {
        if (!heartbeatStopped) {
            clearInterval(heartbeat);
            heartbeatStopped = true;
        }
        const pendingRenewal = heartbeatRenewal;
        if (pendingRenewal) {
            await pendingRenewal;
        }
    };

    try {
        await task();
        await stopHeartbeat();
        if (leaseLost) {
            throw new Error(renewalError instanceof Error
                ? `singleton_task_lease_renewal_failed: ${renewalError.message}`
                : 'singleton_task_lease_lost');
        }
        const completed = await completeSingletonTask(client, {
            ...lease,
        });
        if (!completed) {
            throw new Error('singleton_task_lease_lost');
        }
        return 'ran';
    } catch (error) {
        await stopHeartbeat();
        await failSingletonTask(client, {
            ...lease,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    } finally {
        if (!heartbeatStopped) {
            clearInterval(heartbeat);
        }
    }
}
