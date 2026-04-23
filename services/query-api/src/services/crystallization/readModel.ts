import { Prisma, type PrismaClient } from '@prisma/client';
import {
    buildCrystallizationOutputRecord,
    type CrystallizationOutputRecord,
    type CrystallizationOutputRow,
} from './contracts';

function buildBaseCrystallizationOutputQuery(
    whereClause: Prisma.Sql,
): Prisma.Sql {
    return Prisma.sql`
        SELECT
            k.knowledge_id AS "knowledgeId",
            contribution.source_draft_post_id AS "sourceDraftPostId",
            COALESCE(snapshot.draft_version, workflow.current_snapshot_version, 1) AS "sourceDraftVersion",
            COALESCE(k.content_hash, contribution.source_payload_hash) AS "contentHash",
            COALESCE(binding.contributors_root, k.contributors_root) AS "contributorsRoot",
            k.created_at AS "createdAt",
            binding.source_anchor_id AS "sourceAnchorId",
            contribution.source_summary_hash AS "sourceSummaryHash",
            contribution.source_messages_digest AS "sourceMessagesDigest",
            binding.proof_package_hash AS "proofPackageHash",
            binding.contributors_count AS "contributorsCount",
            binding.binding_version AS "bindingVersion",
            binding.bound_at AS "bindingCreatedAt",
            workflow.crystallization_policy_profile_digest AS "policyProfileDigest"
        FROM knowledge k
        LEFT JOIN knowledge_binding binding
            ON binding.knowledge_id = k.knowledge_id
        LEFT JOIN LATERAL (
            SELECT
                kc.source_draft_post_id,
                kc.source_payload_hash,
                kc.source_summary_hash,
                kc.source_messages_digest
            FROM knowledge_contributions kc
            WHERE kc.knowledge_id = k.id
              AND kc.source_draft_post_id IS NOT NULL
            ORDER BY kc.updated_at DESC, kc.id DESC
            LIMIT 1
        ) contribution ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                dvs.draft_version
            FROM draft_version_snapshots dvs
            WHERE contribution.source_draft_post_id IS NOT NULL
              AND dvs.draft_post_id = contribution.source_draft_post_id
              AND (
                (
                    contribution.source_summary_hash IS NOT NULL
                    AND contribution.source_messages_digest IS NOT NULL
                    AND dvs.source_summary_hash = contribution.source_summary_hash
                    AND dvs.source_messages_digest = contribution.source_messages_digest
                )
                OR (
                    contribution.source_payload_hash IS NOT NULL
                    AND dvs.content_hash = contribution.source_payload_hash
                )
              )
            ORDER BY dvs.draft_version DESC
            LIMIT 1
        ) snapshot ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                dws.current_snapshot_version,
                dws.crystallization_policy_profile_digest
            FROM draft_workflow_state dws
            WHERE contribution.source_draft_post_id IS NOT NULL
              AND dws.draft_post_id = contribution.source_draft_post_id
            LIMIT 1
        ) workflow ON TRUE
        ${whereClause}
        LIMIT 1
    `;
}

export async function loadCrystallizationOutputRecordByKnowledgeId(
    prisma: PrismaClient,
    knowledgeId: string,
): Promise<CrystallizationOutputRecord | null> {
    const rows = await prisma.$queryRaw<CrystallizationOutputRow[]>(
        buildBaseCrystallizationOutputQuery(
            Prisma.sql`WHERE k.knowledge_id = ${knowledgeId}`,
        ),
    );
    return buildCrystallizationOutputRecord(rows[0] ?? null);
}

export async function loadCrystallizationOutputRecordByDraftPostId(
    prisma: PrismaClient,
    draftPostId: number,
): Promise<CrystallizationOutputRecord | null> {
    const rows = await prisma.$queryRaw<CrystallizationOutputRow[]>(
        buildBaseCrystallizationOutputQuery(
            Prisma.sql`
                WHERE contribution.source_draft_post_id = ${draftPostId}
                ORDER BY k.created_at DESC
            `,
        ),
    );
    return buildCrystallizationOutputRecord(rows[0] ?? null);
}
