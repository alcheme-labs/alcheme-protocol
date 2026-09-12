import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type DraftCandidateGenerationClaimResult =
    | {
        status: 'claimed';
        attemptId: number;
        claimToken: string;
        claimedUntil: Date;
        attemptCount: number;
    }
    | {
        status: 'pending';
        attemptId: number;
        claimedUntil: Date;
        attemptCount: number;
    }
    | {
        status: 'succeeded';
        attemptId: number;
        draftPostId: number;
    };

interface AttemptRow {
    id: number;
    status: string;
    draftPostId: number | null;
    claimToken: string | null;
    claimedUntil: Date | null;
    attemptCount: number;
}

export function computeDraftCandidateSourceDigest(sourceMessageIds: string[]): string {
    const normalized = sourceMessageIds
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
    return crypto
        .createHash('sha256')
        .update(normalized.join('|'))
        .digest('hex');
}

export async function claimDraftCandidateGenerationAttempt(
    prisma: PrismaLike,
    input: {
        circleId: number;
        candidateId: string;
        sourceMessagesDigest: string;
        sourceMessageIds: string[];
        sourceSemanticFacets: string[];
        sourceAuthorAnnotations: string[];
        lastProposalId?: string | null;
        summaryMethod?: string | null;
        attemptedByUserId: number;
        leaseMs?: number;
    },
): Promise<DraftCandidateGenerationClaimResult> {
    const claimToken = crypto.randomBytes(18).toString('hex');
    const leaseMs = Number.isFinite(input.leaseMs) && input.leaseMs ? Math.max(1000, input.leaseMs) : 120000;
    const claimedUntil = new Date(Date.now() + leaseMs);
    const sourceMessageIdsJson = JSON.stringify(input.sourceMessageIds);
    const sourceSemanticFacetsJson = JSON.stringify(input.sourceSemanticFacets);
    const sourceAuthorAnnotationsJson = JSON.stringify(input.sourceAuthorAnnotations);

    const rows = await prisma.$queryRaw<AttemptRow[]>(Prisma.sql`
        WITH upsert AS (
            INSERT INTO draft_candidate_generation_attempts (
                circle_id,
                candidate_id,
                source_messages_digest,
                status,
                attempted_by_user_id,
                claim_token,
                claimed_until,
                attempt_count,
                source_message_ids,
                source_semantic_facets,
                source_author_annotations,
                last_proposal_id,
                summary_method,
                created_at,
                updated_at
            )
            VALUES (
                ${input.circleId},
                ${input.candidateId},
                ${input.sourceMessagesDigest},
                'pending',
                ${input.attemptedByUserId},
                ${claimToken},
                ${claimedUntil},
                1,
                ${sourceMessageIdsJson}::jsonb,
                ${sourceSemanticFacetsJson}::jsonb,
                ${sourceAuthorAnnotationsJson}::jsonb,
                ${input.lastProposalId ?? null},
                ${input.summaryMethod ?? null},
                NOW(),
                NOW()
            )
            ON CONFLICT (circle_id, candidate_id, source_messages_digest)
            DO UPDATE SET
                status = 'pending',
                attempted_by_user_id = EXCLUDED.attempted_by_user_id,
                claim_token = EXCLUDED.claim_token,
                claimed_until = EXCLUDED.claimed_until,
                attempt_count = draft_candidate_generation_attempts.attempt_count + 1,
                source_message_ids = EXCLUDED.source_message_ids,
                source_semantic_facets = EXCLUDED.source_semantic_facets,
                source_author_annotations = EXCLUDED.source_author_annotations,
                last_proposal_id = EXCLUDED.last_proposal_id,
                summary_method = EXCLUDED.summary_method,
                draft_generation_error = NULL,
                draft_generation_diagnostics = NULL,
                updated_at = NOW()
            WHERE draft_candidate_generation_attempts.status = 'generation_failed'
               OR (
                    draft_candidate_generation_attempts.status = 'pending'
                    AND draft_candidate_generation_attempts.claimed_until < NOW()
               )
            RETURNING
                id,
                status,
                draft_post_id AS "draftPostId",
                claim_token AS "claimToken",
                claimed_until AS "claimedUntil",
                attempt_count AS "attemptCount"
        )
        SELECT * FROM upsert
        UNION ALL
        SELECT
            id,
            status,
            draft_post_id AS "draftPostId",
            claim_token AS "claimToken",
            claimed_until AS "claimedUntil",
            attempt_count AS "attemptCount"
        FROM draft_candidate_generation_attempts
        WHERE circle_id = ${input.circleId}
          AND candidate_id = ${input.candidateId}
          AND source_messages_digest = ${input.sourceMessagesDigest}
          AND NOT EXISTS (SELECT 1 FROM upsert)
        LIMIT 1
    `);

    const row = rows[0];
    if (!row) {
        throw new Error('draft_candidate_generation_attempt_claim_failed');
    }

    if (row.status === 'succeeded' && row.draftPostId) {
        return {
            status: 'succeeded',
            attemptId: row.id,
            draftPostId: row.draftPostId,
        };
    }

    if (row.status === 'pending' && row.claimToken === claimToken && row.claimedUntil) {
        return {
            status: 'claimed',
            attemptId: row.id,
            claimToken,
            claimedUntil: row.claimedUntil,
            attemptCount: row.attemptCount,
        };
    }

    return {
        status: 'pending',
        attemptId: row.id,
        claimedUntil: row.claimedUntil ?? claimedUntil,
        attemptCount: row.attemptCount,
    };
}

export async function markDraftCandidateGenerationSucceeded(
    prisma: PrismaLike,
    input: {
        attemptId: number;
        claimToken: string;
        draftPostId: number;
        draftGenerationMethod: string;
        draftGenerationDiagnostics: Record<string, unknown>;
    },
): Promise<boolean> {
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_candidate_generation_attempts
        SET status = 'succeeded',
            draft_post_id = ${input.draftPostId},
            draft_generation_method = ${input.draftGenerationMethod},
            draft_generation_error = NULL,
            draft_generation_diagnostics = ${JSON.stringify(input.draftGenerationDiagnostics)}::jsonb,
            claimed_until = NULL,
            updated_at = NOW()
        WHERE id = ${input.attemptId}
          AND claim_token = ${input.claimToken}
          AND status = 'pending'
    `);
    return updated === 1;
}

export async function markDraftCandidateGenerationFailed(
    prisma: PrismaLike,
    input: {
        attemptId: number;
        claimToken: string;
        draftGenerationError: string;
        draftGenerationDiagnostics: Record<string, unknown>;
    },
): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_candidate_generation_attempts
        SET status = 'generation_failed',
            draft_generation_error = ${input.draftGenerationError},
            draft_generation_diagnostics = ${JSON.stringify(input.draftGenerationDiagnostics)}::jsonb,
            claimed_until = NULL,
            updated_at = NOW()
        WHERE id = ${input.attemptId}
          AND claim_token = ${input.claimToken}
          AND status = 'pending'
    `);
}
