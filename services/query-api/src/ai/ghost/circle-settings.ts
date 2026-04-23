import { PrismaClient } from '@prisma/client';
import {
    GhostConfig,
} from './config';

export type GhostDraftTriggerMode = 'notify_only' | 'auto_draft';

interface CircleGhostSettingsRow {
    summaryUseLLM: boolean | null;
    draftTriggerMode: string | null;
    triggerSummaryUseLLM: boolean | null;
    triggerGenerateComment: boolean | null;
}

export interface CircleGhostSettings {
    summaryUseLLM: boolean;
    draftTriggerMode: GhostDraftTriggerMode;
    triggerSummaryUseLLM: boolean;
    triggerGenerateComment: boolean;
}

export interface CircleGhostSettingsPatch {
    summaryUseLLM?: boolean;
    draftTriggerMode?: GhostDraftTriggerMode;
    triggerSummaryUseLLM?: boolean;
    triggerGenerateComment?: boolean;
}

function rowToPatch(row: CircleGhostSettingsRow): CircleGhostSettingsPatch {
    return {
        summaryUseLLM: normalizeOptionalBool(row.summaryUseLLM) ?? undefined,
        draftTriggerMode: normalizeTriggerMode(row.draftTriggerMode) ?? undefined,
        triggerSummaryUseLLM: normalizeOptionalBool(row.triggerSummaryUseLLM) ?? undefined,
        triggerGenerateComment: normalizeOptionalBool(row.triggerGenerateComment) ?? undefined,
    };
}

function normalizeTriggerMode(raw: string | null | undefined): GhostDraftTriggerMode | null {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized) return null;
    if (
        normalized === 'auto'
        || normalized === 'auto_draft'
        || normalized === 'ai'
        || normalized === 'ai_auto'
    ) {
        return 'auto_draft';
    }
    return 'notify_only';
}

function normalizeOptionalBool(raw: unknown): boolean | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return null;
}

export function resolveCircleGhostSettings(
    globalConfig: GhostConfig,
    patch?: CircleGhostSettingsPatch | null,
): CircleGhostSettings {
    const draftTriggerMode = patch?.draftTriggerMode ?? globalConfig.trigger.mode;
    return {
        summaryUseLLM: patch?.summaryUseLLM ?? globalConfig.summary.useLLM,
        draftTriggerMode,
        triggerSummaryUseLLM: patch?.triggerSummaryUseLLM ?? globalConfig.trigger.summaryUseLLM,
        // Keep this derived to avoid per-circle behavior drift:
        // auto_draft must always include Ghost guidance comment.
        triggerGenerateComment: draftTriggerMode === 'auto_draft',
    };
}

export async function loadCircleGhostSettingsPatch(
    prisma: PrismaClient,
    circleId: number,
): Promise<CircleGhostSettingsPatch | null> {
    const rows = await prisma.$queryRaw<CircleGhostSettingsRow[]>`
        SELECT
            summary_use_llm AS "summaryUseLLM",
            draft_trigger_mode AS "draftTriggerMode",
            trigger_summary_use_llm AS "triggerSummaryUseLLM",
            trigger_generate_comment AS "triggerGenerateComment"
        FROM circle_ghost_settings
        WHERE circle_id = ${circleId}
        LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;

    return rowToPatch(row);
}

export async function loadPendingCircleGhostSettingsPatch(
    prisma: PrismaClient,
    circleId: number,
): Promise<CircleGhostSettingsPatch | null> {
    const rows = await prisma.$queryRaw<CircleGhostSettingsRow[]>`
        SELECT
            summary_use_llm AS "summaryUseLLM",
            draft_trigger_mode AS "draftTriggerMode",
            trigger_summary_use_llm AS "triggerSummaryUseLLM",
            trigger_generate_comment AS "triggerGenerateComment"
        FROM pending_circle_ghost_settings
        WHERE circle_id = ${circleId}
          AND expires_at > NOW()
        LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return rowToPatch(row);
}

export async function upsertCircleGhostSettings(
    prisma: PrismaClient,
    circleId: number,
    input: CircleGhostSettingsPatch,
): Promise<CircleGhostSettingsPatch> {
    const existing = await loadCircleGhostSettingsPatch(prisma, circleId);
    const has = (key: keyof CircleGhostSettingsPatch) => Object.prototype.hasOwnProperty.call(input, key);

    const summaryUseLLM = has('summaryUseLLM')
        ? normalizeOptionalBool((input as any).summaryUseLLM)
        : normalizeOptionalBool(existing?.summaryUseLLM);
    const draftTriggerMode = has('draftTriggerMode')
        ? normalizeTriggerMode((input as any).draftTriggerMode ?? null)
        : normalizeTriggerMode(existing?.draftTriggerMode ?? null);
    const triggerSummaryUseLLM = has('triggerSummaryUseLLM')
        ? normalizeOptionalBool((input as any).triggerSummaryUseLLM)
        : normalizeOptionalBool(existing?.triggerSummaryUseLLM);
    const triggerGenerateComment = draftTriggerMode === 'auto_draft';

    await prisma.$executeRaw`
        INSERT INTO circle_ghost_settings (
            circle_id,
            summary_use_llm,
            draft_trigger_mode,
            trigger_summary_use_llm,
            trigger_generate_comment,
            created_at,
            updated_at
        )
        VALUES (
            ${circleId},
            ${summaryUseLLM},
            ${draftTriggerMode},
            ${triggerSummaryUseLLM},
            ${triggerGenerateComment},
            NOW(),
            NOW()
        )
        ON CONFLICT (circle_id) DO UPDATE
        SET
            summary_use_llm = EXCLUDED.summary_use_llm,
            draft_trigger_mode = EXCLUDED.draft_trigger_mode,
            trigger_summary_use_llm = EXCLUDED.trigger_summary_use_llm,
            trigger_generate_comment = EXCLUDED.trigger_generate_comment,
            updated_at = NOW()
    `;

    return {
        summaryUseLLM: summaryUseLLM ?? undefined,
        draftTriggerMode: draftTriggerMode ?? undefined,
        triggerSummaryUseLLM: triggerSummaryUseLLM ?? undefined,
        triggerGenerateComment: triggerGenerateComment ?? undefined,
    };
}

export async function upsertPendingCircleGhostSettings(
    prisma: PrismaClient,
    circleId: number,
    input: CircleGhostSettingsPatch,
    requestedByPubkey: string,
    pendingTtlSec = Number(process.env.PENDING_GHOST_SETTINGS_TTL_SEC || '21600'),
): Promise<CircleGhostSettingsPatch> {
    const maxPendingPerActor = Math.max(
        1,
        Number(process.env.PENDING_GHOST_SETTINGS_MAX_PER_ACTOR || '20'),
    );
    const existingForCircle = await prisma.pendingCircleGhostSetting.findUnique({
        where: { circleId },
        select: { circleId: true },
    });
    if (!existingForCircle) {
        const actorPendingCount = await prisma.pendingCircleGhostSetting.count({
            where: {
                requestedByPubkey,
                expiresAt: { gt: new Date() },
            },
        });
        if (actorPendingCount >= maxPendingPerActor) {
            throw new Error('pending_ghost_settings_limit_exceeded');
        }
    }

    const existing = await loadPendingCircleGhostSettingsPatch(prisma, circleId);
    const has = (key: keyof CircleGhostSettingsPatch) => Object.prototype.hasOwnProperty.call(input, key);

    const summaryUseLLM = has('summaryUseLLM')
        ? normalizeOptionalBool((input as any).summaryUseLLM)
        : normalizeOptionalBool(existing?.summaryUseLLM);
    const draftTriggerMode = has('draftTriggerMode')
        ? normalizeTriggerMode((input as any).draftTriggerMode ?? null)
        : normalizeTriggerMode(existing?.draftTriggerMode ?? null);
    const triggerSummaryUseLLM = has('triggerSummaryUseLLM')
        ? normalizeOptionalBool((input as any).triggerSummaryUseLLM)
        : normalizeOptionalBool(existing?.triggerSummaryUseLLM);
    const triggerGenerateComment = draftTriggerMode === 'auto_draft';

    await prisma.$executeRaw`
        INSERT INTO pending_circle_ghost_settings (
            circle_id,
            requested_by_pubkey,
            summary_use_llm,
            draft_trigger_mode,
            trigger_summary_use_llm,
            trigger_generate_comment,
            expires_at,
            created_at,
            updated_at
        )
        VALUES (
            ${circleId},
            ${requestedByPubkey},
            ${summaryUseLLM},
            ${draftTriggerMode},
            ${triggerSummaryUseLLM},
            ${triggerGenerateComment},
            NOW() + (${Math.max(60, pendingTtlSec)}::integer * INTERVAL '1 second'),
            NOW(),
            NOW()
        )
        ON CONFLICT (circle_id) DO UPDATE
        SET
            requested_by_pubkey = EXCLUDED.requested_by_pubkey,
            summary_use_llm = EXCLUDED.summary_use_llm,
            draft_trigger_mode = EXCLUDED.draft_trigger_mode,
            trigger_summary_use_llm = EXCLUDED.trigger_summary_use_llm,
            trigger_generate_comment = EXCLUDED.trigger_generate_comment,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW()
    `;

    return {
        summaryUseLLM: summaryUseLLM ?? undefined,
        draftTriggerMode: draftTriggerMode ?? undefined,
        triggerSummaryUseLLM: triggerSummaryUseLLM ?? undefined,
        triggerGenerateComment: triggerGenerateComment ?? undefined,
    };
}
