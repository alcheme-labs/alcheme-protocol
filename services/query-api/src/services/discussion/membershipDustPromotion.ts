import { MemberStatus, Prisma, type PrismaClient } from '@prisma/client';

type SqlClient = PrismaClient | Prisma.TransactionClient;

export interface MembershipDustPromotionResult {
    count: number;
    messages: Array<{
        envelopeId: string;
        lamport: number | null;
    }>;
    latestLamport: number | null;
}

function normalizeLamport(value: unknown): number | null {
    if (typeof value === 'bigint') {
        const asNumber = Number(value);
        return Number.isSafeInteger(asNumber) ? asNumber : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export async function promoteMemberDustMessagesAfterJoinProjection(
    prisma: SqlClient,
    input: {
        circleId: number;
        senderPubkey: string;
        visitorDustTtlSec: number;
    },
): Promise<MembershipDustPromotionResult> {
    const circleId = Math.trunc(Number(input.circleId));
    const senderPubkey = String(input.senderPubkey || '').trim();
    const visitorDustTtlSec = Math.trunc(Number(input.visitorDustTtlSec || 0));

    if (
        !Number.isFinite(circleId)
        || circleId <= 0
        || !senderPubkey
        || !Number.isFinite(visitorDustTtlSec)
        || visitorDustTtlSec <= 0
    ) {
        return { count: 0, messages: [], latestLamport: null };
    }

    const rows = await prisma.$queryRaw<Array<{ envelopeId: string; lamport: bigint | number | string | null }>>(Prisma.sql`
        WITH promoted AS (
            UPDATE circle_discussion_messages m
            SET
                is_ephemeral = FALSE,
                expires_at = NULL,
                updated_at = NOW()
            FROM users u, circle_members cm
            WHERE m.circle_id = ${circleId}
              AND m.sender_pubkey = ${senderPubkey}
              AND u.pubkey = m.sender_pubkey
              AND cm.user_id = u.id
              AND cm.circle_id = m.circle_id
              AND cm.status = ${MemberStatus.Active}::"MemberStatus"
              AND m.is_ephemeral = TRUE
              AND m.deleted = FALSE
              AND cm.joined_at <= COALESCE(
                  m.expires_at - (${visitorDustTtlSec} * INTERVAL '1 second'),
                  m.created_at
              )
            RETURNING m.envelope_id AS "envelopeId", m.lamport AS "lamport"
        )
        SELECT "envelopeId", "lamport"
        FROM promoted
    `);

    const messages = rows
        .map((row) => ({
            envelopeId: String(row.envelopeId || '').trim(),
            lamport: normalizeLamport(row.lamport),
        }))
        .filter((row) => row.envelopeId.length > 0);
    const latestLamport = messages.reduce<number | null>((latest, row) => {
        if (row.lamport === null) return latest;
        return latest === null ? row.lamport : Math.max(latest, row.lamport);
    }, null);

    return {
        count: messages.length,
        messages,
        latestLamport,
    };
}
