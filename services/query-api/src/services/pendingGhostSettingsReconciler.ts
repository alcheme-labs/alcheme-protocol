import type { PrismaClient } from '@prisma/client';

let reconcileTimer: NodeJS.Timeout | null = null;
let running = false;

interface ReconcileStats {
    expiredCount: number;
    promotedCount: number;
}

function toNumber(value: unknown): number {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return value;
    return Number(value || 0);
}

async function pruneExpiredPendingSettings(prisma: PrismaClient): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        WITH deleted AS (
            DELETE FROM pending_circle_ghost_settings
            WHERE expires_at <= NOW()
            RETURNING circle_id
        )
        SELECT COUNT(*)::bigint AS count FROM deleted
    `;
    return toNumber(rows[0]?.count ?? 0);
}

async function promotePendingSettings(prisma: PrismaClient, batchSize: number): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ circleId: number }>>`
        WITH candidate AS (
            SELECT
                p.circle_id,
                p.requested_by_pubkey,
                p.summary_use_llm,
                p.draft_trigger_mode,
                p.trigger_summary_use_llm,
                p.trigger_generate_comment,
                p.created_at
            FROM pending_circle_ghost_settings p
            JOIN circles c ON c.id = p.circle_id
            JOIN users u ON u.id = c.creator_id
            WHERE p.expires_at > NOW()
              AND p.requested_by_pubkey = u.pubkey
            ORDER BY p.updated_at ASC
            LIMIT ${batchSize}
        ),
        upserted AS (
            INSERT INTO circle_ghost_settings (
                circle_id,
                summary_use_llm,
                draft_trigger_mode,
                trigger_summary_use_llm,
                trigger_generate_comment,
                created_at,
                updated_at
            )
            SELECT
                c.circle_id,
                c.summary_use_llm,
                c.draft_trigger_mode,
                c.trigger_summary_use_llm,
                c.trigger_generate_comment,
                COALESCE(c.created_at, NOW()),
                NOW()
            FROM candidate c
            ON CONFLICT (circle_id) DO UPDATE
            SET
                summary_use_llm = EXCLUDED.summary_use_llm,
                draft_trigger_mode = EXCLUDED.draft_trigger_mode,
                trigger_summary_use_llm = EXCLUDED.trigger_summary_use_llm,
                trigger_generate_comment = EXCLUDED.trigger_generate_comment,
                updated_at = NOW()
            RETURNING circle_id
        ),
        deleted AS (
            DELETE FROM pending_circle_ghost_settings p
            USING upserted u
            WHERE p.circle_id = u.circle_id
            RETURNING p.circle_id
        )
        SELECT circle_id AS "circleId" FROM deleted
    `;
    return rows.length;
}

export async function runPendingGhostSettingsReconcilerPass(
    prisma: PrismaClient,
    batchSize = Number(process.env.PENDING_GHOST_SETTINGS_RECONCILE_BATCH_SIZE || '100'),
): Promise<ReconcileStats> {
    const safeBatchSize = Math.max(1, batchSize);
    const expiredCount = await pruneExpiredPendingSettings(prisma);
    const promotedCount = await promotePendingSettings(prisma, safeBatchSize);
    return { expiredCount, promotedCount };
}

export function startPendingGhostSettingsReconciler(prisma: PrismaClient) {
    const enabled = process.env.PENDING_GHOST_SETTINGS_RECONCILER_ENABLED !== 'false';
    if (!enabled) {
        console.log('Pending ghost settings reconciler disabled');
        return;
    }
    const intervalMs = Math.max(
        1000,
        Number(process.env.PENDING_GHOST_SETTINGS_RECONCILE_INTERVAL_MS || '5000'),
    );
    if (reconcileTimer) return;

    const run = async () => {
        if (running) return;
        running = true;
        try {
            const stats = await runPendingGhostSettingsReconcilerPass(prisma);
            if (stats.promotedCount > 0 || stats.expiredCount > 0) {
                console.log(
                    `pending ghost settings reconciled: promoted=${stats.promotedCount}, expired=${stats.expiredCount}`,
                );
            }
        } catch (error) {
            console.warn('Pending ghost settings reconciler pass failed:', error);
        } finally {
            running = false;
        }
    };

    void run();
    reconcileTimer = setInterval(() => {
        void run();
    }, intervalMs);
    console.log(`Pending ghost settings reconciler started (interval: ${intervalMs}ms)`);
}

export function stopPendingGhostSettingsReconciler() {
    if (!reconcileTimer) return;
    clearInterval(reconcileTimer);
    reconcileTimer = null;
    running = false;
}
