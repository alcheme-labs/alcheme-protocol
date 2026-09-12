import { Prisma, type PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    publishInteractionResultNotice,
} from '../systemNoticeProducer';
import {
    resolveAnchoredInteractionResult,
    type ResolvedAnchoredInteractionResult,
} from './resolver';
import {
    toDiscussionAnchoredInteractionDto,
    type DiscussionAnchoredInteractionDto,
    type DiscussionAnchoredInteractionRow,
} from './types';

export interface ResolveAnchoredInteractionResultNoticeInput {
    prisma: PrismaClient;
    redis?: Pick<Redis, 'publish'> | null;
    interaction: DiscussionAnchoredInteractionDto;
    explicitClose: boolean;
    now: Date;
    policy?: Record<string, unknown>;
}

export interface ResolveAnchoredInteractionResultNoticeOutput {
    interaction: DiscussionAnchoredInteractionDto;
    result: ResolvedAnchoredInteractionResult;
    resultNoticeEnvelopeId: string | null;
    projectionChanged: boolean;
}

export async function resolveAnchoredInteractionResultNotice(
    input: ResolveAnchoredInteractionResultNoticeInput,
): Promise<ResolveAnchoredInteractionResultNoticeOutput> {
    const result = resolveAnchoredInteractionResult({
        interaction: input.interaction,
        now: input.now,
        policy: normalizeResultPolicy(input.policy),
    });
    if (!shouldPublishResultNotice(result.status, input.explicitClose)) {
        return {
            interaction: input.interaction,
            result,
            resultNoticeEnvelopeId: null,
            projectionChanged: false,
        };
    }

    if (
        input.interaction.resultNoticeEnvelopeId
        && input.interaction.resultStatus === result.status
        && await hasExistingResultNoticeForDigest(input.prisma, {
            circleId: input.interaction.circleId,
            envelopeId: input.interaction.resultNoticeEnvelopeId,
            resultStatus: result.status,
            resultDigest: result.resultDigest,
        })
    ) {
        return {
            interaction: input.interaction,
            result,
            resultNoticeEnvelopeId: input.interaction.resultNoticeEnvelopeId,
            projectionChanged: false,
        };
    }

    const resultNoticeEnvelopeId = await publishInteractionResultNotice(input.prisma, {
        circleId: input.interaction.circleId,
        interactionId: input.interaction.interactionId,
        interactionType: input.interaction.interactionType,
        anchorType: input.interaction.anchor.type,
        anchorEnvelopeId: input.interaction.anchor.ref,
        resultVersion: input.interaction.projectionVersion,
        resultStatus: result.status,
        resultDigest: result.resultDigest,
        humanSummary: result.humanSummary,
        reasonCode: result.reasonCode,
        sourceEventIds: result.sourceEventIds,
        sourceMessageIds: input.interaction.anchor.type === 'discussion_message'
            ? [input.interaction.anchor.ref]
            : [],
        projectionVersion: input.interaction.projectionVersion,
        projectionCursor: input.interaction.projectionCursor,
        resultPayload: result.resultPayload,
    }, input.redis);
    if (!resultNoticeEnvelopeId) {
        throw new Error('failed_to_publish_interaction_result_notice');
    }

    const interaction = await markAnchoredInteractionResult(input.prisma, {
        interactionId: input.interaction.interactionId,
        resultStatus: result.status,
        resultNoticeEnvelopeId,
    });

    return {
        interaction,
        result,
        resultNoticeEnvelopeId,
        projectionChanged: true,
    };
}

async function hasExistingResultNoticeForDigest(
    prisma: PrismaClient,
    input: {
        circleId: number;
        envelopeId: string;
        resultStatus: 'ignored' | 'resolved';
        resultDigest: string;
    },
): Promise<boolean> {
    if (typeof prisma.$queryRaw !== 'function') {
        return true;
    }
    const rows = await prisma.$queryRaw<Array<{
        resultStatus: string | null;
        resultDigest: string | null;
    }>>(Prisma.sql`
        SELECT
            metadata->>'resultStatus' AS "resultStatus",
            metadata->>'resultDigest' AS "resultDigest"
        FROM circle_discussion_messages
        WHERE circle_id = ${input.circleId}
          AND envelope_id = ${input.envelopeId}
          AND message_kind = 'interaction_result_notice'
        LIMIT 1
    `);
    const row = rows[0];
    return row?.resultStatus === input.resultStatus
        && row?.resultDigest === input.resultDigest;
}

function normalizeResultPolicy(
    value: Record<string, unknown> | undefined,
): { minParticipants?: number; dominantRatio?: number } {
    return {
        ...(typeof value?.minParticipants === 'number' ? { minParticipants: value.minParticipants } : {}),
        ...(typeof value?.dominantRatio === 'number' ? { dominantRatio: value.dominantRatio } : {}),
    };
}

function shouldPublishResultNotice(
    status: ResolvedAnchoredInteractionResult['status'],
    explicitClose: boolean,
): status is 'ignored' | 'resolved' {
    if (status === 'resolved') return true;
    if (status === 'ignored' && explicitClose) return true;
    return false;
}

async function markAnchoredInteractionResult(
    prisma: PrismaClient,
    input: {
        interactionId: string;
        resultStatus: 'ignored' | 'resolved';
        resultNoticeEnvelopeId: string;
    },
): Promise<DiscussionAnchoredInteractionDto> {
    const status = input.resultStatus === 'resolved' ? 'resolved' : 'closed';
    if (typeof prisma.$queryRaw === 'function') {
        const rows = await prisma.$queryRaw<DiscussionAnchoredInteractionRow[]>(Prisma.sql`
            UPDATE discussion_anchored_interactions
            SET
                status = ${status},
                result_status = ${input.resultStatus},
                result_notice_envelope_id = ${input.resultNoticeEnvelopeId},
                projection_version = projection_version + 1,
                projection_cursor = nextval('discussion_anchored_interaction_projection_cursor_seq'::regclass),
                updated_at = CURRENT_TIMESTAMP
            WHERE interaction_id = ${input.interactionId}
            RETURNING
                interaction_id AS "interactionId",
                circle_id AS "circleId",
                anchor_type AS "anchorType",
                anchor_ref AS "anchorRef",
                interaction_type AS "interactionType",
                interaction_class AS "interactionClass",
                status,
                projection_version AS "projectionVersion",
                projection_cursor AS "projectionCursor",
                result_status AS "resultStatus",
                result_notice_envelope_id AS "resultNoticeEnvelopeId",
                state,
                summary,
                policy_version AS "policyVersion",
                created_by_pubkey AS "createdByPubkey",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);
        if (rows[0]) return toDiscussionAnchoredInteractionDto(rows[0]);
    }

    const row = await prisma.discussionAnchoredInteraction.update({
        where: { interactionId: input.interactionId },
        data: {
            status,
            resultStatus: input.resultStatus,
            resultNoticeEnvelopeId: input.resultNoticeEnvelopeId,
            projectionVersion: { increment: 1 },
            updatedAt: new Date(),
        },
    });
    return hasDtoAnchor(row) ? row : toDiscussionAnchoredInteractionDto(row);
}

function hasDtoAnchor(value: unknown): value is DiscussionAnchoredInteractionDto {
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as { anchor?: unknown }).anchor
    );
}
