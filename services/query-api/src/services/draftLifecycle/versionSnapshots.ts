import crypto from 'crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { getCollabEditAnchorsBySnapshotHash } from '../collabEditAnchor';
import { getLatestDraftAnchorByPostId } from '../draftAnchor';
import { hashCanonicalGovernanceValue } from '../governance/canonicalCodec';
import {
    isRevisionDirectionAcceptActionType,
    type RevisionDirectionAcceptActionType,
} from '../governance/actionRegistry';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface DraftVersionSnapshotRow {
    draftPostId: number;
    draftVersion: number;
    contentSnapshot: string;
    contentHash: string;
    createdFromState: string;
    createdBy: number | null;
    sourceEditAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    crystallizationRoutingReceipt: Prisma.JsonValue | null;
    createdAt: Date;
}

export interface SupersededOrdinaryCrystallizationRoutingReceipt {
    receiptDigest: string;
    actorUserId: number;
    evaluatedAt: string;
}

export interface OrdinaryCrystallizationRoutingReceipt {
    schemaVersion: 1 | 2;
    path: 'ordinary_knowledge';
    actionIntent: 'none';
    humanConfirmed: true;
    draftPostId: number;
    draftVersion: number;
    snapshotContentHash: string;
    policyProfileDigest: string;
    actorUserId: number;
    reasonCodes:
        | ['no_structured_action_intent', 'ordinary_collaboration_confirmed']
        | [
            'no_structured_action_intent',
            'ordinary_collaboration_confirmed',
            'failed_retry_submit_authority_superseded',
        ];
    supersededReceipts?: SupersededOrdinaryCrystallizationRoutingReceipt[];
    evaluatedAt: string;
    receiptDigest: string;
}

export interface GovernedCaseCrystallizationRoutingReceipt {
    schemaVersion: 1;
    path: 'governed_case';
    actionIntent: RevisionDirectionAcceptActionType;
    humanConfirmed: true;
    draftPostId: number;
    draftVersion: number;
    snapshotContentHash: string;
    policyProfileDigest: string;
    actorUserId: number;
    actionType: RevisionDirectionAcceptActionType;
    targetType: 'revision_direction';
    targetRef: string;
    payloadDigest: string;
    governancePolicyId: string;
    governancePolicyVersionId: string;
    governancePolicyVersion: number;
    governanceRuleId: string;
    contractVersionId: string;
    authorityBindingId: string;
    profileBindingId: string;
    invocationId: string;
    requestId: string;
    caseId: string;
    reasonCodes: [
        'registered_action_intent_confirmed',
        'active_governance_binding_resolved',
        'lossless_case_upgrade',
    ];
    evaluatedAt: string;
    receiptDigest: string;
}

export type CrystallizationRoutingReceipt =
    | OrdinaryCrystallizationRoutingReceipt
    | GovernedCaseCrystallizationRoutingReceipt;

export interface DraftVersionSnapshotRecord {
    draftPostId: number;
    draftVersion: number;
    contentSnapshot: string;
    contentHash: string;
    createdFromState: string;
    createdBy: number | null;
    sourceEditAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    crystallizationRoutingReceipt: CrystallizationRoutingReceipt | null;
    createdAt: string;
}

function mapCrystallizationRoutingReceipt(
    value: Prisma.JsonValue | null,
): CrystallizationRoutingReceipt | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const receipt = value as Record<string, unknown>;
    const commonInvalid = (
        (receipt.schemaVersion !== 1 && receipt.schemaVersion !== 2)
        || receipt.humanConfirmed !== true
        || !Number.isInteger(receipt.draftPostId)
        || !Number.isInteger(receipt.draftVersion)
        || typeof receipt.snapshotContentHash !== 'string'
        || !/^[a-f0-9]{64}$/.test(receipt.snapshotContentHash)
        || typeof receipt.policyProfileDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(receipt.policyProfileDigest)
        || !Number.isInteger(receipt.actorUserId)
        || !Array.isArray(receipt.reasonCodes)
        || typeof receipt.evaluatedAt !== 'string'
        || typeof receipt.receiptDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest)
    );
    if (commonInvalid) return null;
    if (receipt.path === 'ordinary_knowledge') {
        if (!Array.isArray(receipt.reasonCodes)) return null;
        const reasonCodes = (receipt.reasonCodes as unknown[]).join(',');
        if (
            receipt.actionIntent !== 'none'
            || (receipt.schemaVersion === 1
                && reasonCodes !== 'no_structured_action_intent,ordinary_collaboration_confirmed')
            || (receipt.schemaVersion === 2
                && reasonCodes !== 'no_structured_action_intent,ordinary_collaboration_confirmed,failed_retry_submit_authority_superseded')
            || (receipt.schemaVersion === 2 && !isValidSupersededOrdinaryReceipts(receipt.supersededReceipts))
        ) return null;
    } else if (receipt.path === 'governed_case') {
        if (
            receipt.schemaVersion !== 1
            || !isRevisionDirectionAcceptActionType(receipt.actionIntent)
            || receipt.actionType !== receipt.actionIntent
            || receipt.targetType !== 'revision_direction'
            || !isNonEmptyString(receipt.targetRef)
            || !isDigest(receipt.payloadDigest)
            || !isNonEmptyString(receipt.governancePolicyId)
            || !isNonEmptyString(receipt.governancePolicyVersionId)
            || !Number.isInteger(receipt.governancePolicyVersion)
            || !isNonEmptyString(receipt.governanceRuleId)
            || !isNonEmptyString(receipt.contractVersionId)
            || !isNonEmptyString(receipt.authorityBindingId)
            || !isNonEmptyString(receipt.profileBindingId)
            || !isNonEmptyString(receipt.invocationId)
            || !isNonEmptyString(receipt.requestId)
            || !isNonEmptyString(receipt.caseId)
            || !Array.isArray(receipt.reasonCodes)
            || receipt.reasonCodes.join(',') !== 'registered_action_intent_confirmed,active_governance_binding_resolved,lossless_case_upgrade'
        ) return null;
    } else {
        return null;
    }
    const mapped = receipt as unknown as CrystallizationRoutingReceipt;
    const { receiptDigest: _receiptDigest, ...unsignedReceipt } = mapped;
    const expectedDigest = hashCanonicalGovernanceValue(
        'alcheme.knowledge.crystallization-routing-receipt.v1',
        unsignedReceipt,
    );
    return expectedDigest === mapped.receiptDigest ? mapped : null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isDigest(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isValidSupersededOrdinaryReceipts(
    value: unknown,
): value is SupersededOrdinaryCrystallizationRoutingReceipt[] {
    return Array.isArray(value)
        && value.length > 0
        && value.every((item) => (
            item != null
            && typeof item === 'object'
            && !Array.isArray(item)
            && isDigest((item as Record<string, unknown>).receiptDigest)
            && Number.isInteger((item as Record<string, unknown>).actorUserId)
            && isNonEmptyString((item as Record<string, unknown>).evaluatedAt)
        ));
}

function matchesOrdinaryRoutingContext(
    receipt: CrystallizationRoutingReceipt,
    input: {
        draftPostId: number;
        draftVersion: number;
        snapshotContentHash: string;
        policyProfileDigest: string;
    },
): receipt is OrdinaryCrystallizationRoutingReceipt {
    return receipt.path === 'ordinary_knowledge'
        && receipt.actionIntent === 'none'
        && receipt.humanConfirmed === true
        && receipt.draftPostId === input.draftPostId
        && receipt.draftVersion === input.draftVersion
        && receipt.snapshotContentHash === input.snapshotContentHash
        && receipt.policyProfileDigest === input.policyProfileDigest;
}

function matchesGovernedCaseRoutingContext(
    receipt: CrystallizationRoutingReceipt,
    input: {
        draftPostId: number;
        draftVersion: number;
        snapshotContentHash: string;
        policyProfileDigest: string;
        actionType: RevisionDirectionAcceptActionType;
        targetRef: string;
        payloadDigest: string;
        governancePolicyId: string;
        governancePolicyVersionId: string;
        governancePolicyVersion: number;
        governanceRuleId: string;
        contractVersionId: string;
        authorityBindingId: string;
        profileBindingId: string;
        invocationId: string;
        requestId: string;
        caseId: string;
    },
): receipt is GovernedCaseCrystallizationRoutingReceipt {
    return matchesGovernedCaseRoutingReplay(receipt, {
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
        policyProfileDigest: input.policyProfileDigest,
        actionType: input.actionType,
        targetRef: input.targetRef,
        requestId: input.requestId,
    })
        && receipt.payloadDigest === input.payloadDigest
        && receipt.governancePolicyId === input.governancePolicyId
        && receipt.governancePolicyVersionId === input.governancePolicyVersionId
        && receipt.governancePolicyVersion === input.governancePolicyVersion
        && receipt.governanceRuleId === input.governanceRuleId
        && receipt.contractVersionId === input.contractVersionId
        && receipt.authorityBindingId === input.authorityBindingId
        && receipt.profileBindingId === input.profileBindingId
        && receipt.invocationId === input.invocationId
        && receipt.caseId === input.caseId
        && receipt.snapshotContentHash === input.snapshotContentHash;
}

export function matchesGovernedCaseRoutingReplay(
    receipt: CrystallizationRoutingReceipt | null | undefined,
    input: {
        draftPostId: number;
        draftVersion: number;
        actorUserId?: number;
        policyProfileDigest: string;
        actionType: RevisionDirectionAcceptActionType;
        targetRef: string;
        requestId: string;
    },
): receipt is GovernedCaseCrystallizationRoutingReceipt {
    return receipt?.path === 'governed_case'
        && receipt.actionIntent === input.actionType
        && receipt.actionType === input.actionType
        && receipt.targetType === 'revision_direction'
        && receipt.targetRef === input.targetRef
        && receipt.requestId === input.requestId
        && receipt.draftPostId === input.draftPostId
        && receipt.draftVersion === input.draftVersion
        && receipt.policyProfileDigest === input.policyProfileDigest
        && (input.actorUserId === undefined || receipt.actorUserId === input.actorUserId);
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function mapRowToRecord(row: DraftVersionSnapshotRow): DraftVersionSnapshotRecord {
    return {
        draftPostId: row.draftPostId,
        draftVersion: row.draftVersion,
        contentSnapshot: row.contentSnapshot,
        contentHash: row.contentHash,
        createdFromState: row.createdFromState,
        createdBy: row.createdBy ?? null,
        sourceEditAnchorId: row.sourceEditAnchorId ?? null,
        sourceSummaryHash: row.sourceSummaryHash ?? null,
        sourceMessagesDigest: row.sourceMessagesDigest ?? null,
        crystallizationRoutingReceipt: mapCrystallizationRoutingReceipt(
            row.crystallizationRoutingReceipt,
        ),
        createdAt: row.createdAt.toISOString(),
    };
}

export async function loadDraftVersionSnapshot(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
    },
): Promise<DraftVersionSnapshotRecord | null> {
    const rows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        SELECT
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            crystallization_routing_receipt AS "crystallizationRoutingReceipt",
            created_at AS "createdAt"
        FROM draft_version_snapshots
        WHERE draft_post_id = ${input.draftPostId}
          AND draft_version = ${input.draftVersion}
        LIMIT 1
    `);

    return rows[0] ? mapRowToRecord(rows[0]) : null;
}

export async function createDraftVersionSnapshot(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
        contentSnapshot: string;
        createdFromState: 'drafting';
        createdBy: number | null;
    },
): Promise<DraftVersionSnapshotRecord> {
    const contentSnapshot = String(input.contentSnapshot || '');
    const contentHash = sha256Hex(contentSnapshot);
    const [latestDraftAnchor, matchingCollabAnchors] = await Promise.all([
        getLatestDraftAnchorByPostId(prisma, input.draftPostId),
        getCollabEditAnchorsBySnapshotHash(prisma, {
            draftPostId: input.draftPostId,
            snapshotHash: contentHash,
            limit: 5,
        }),
    ]);
    const latestAnchoredMatchingCollabAnchor =
        matchingCollabAnchors.find((anchor) => anchor.status === 'anchored') || null;

    const insertedRows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        INSERT INTO draft_version_snapshots (
            draft_post_id,
            draft_version,
            content_snapshot,
            content_hash,
            created_from_state,
            created_by,
            source_edit_anchor_id,
            source_summary_hash,
            source_messages_digest,
            created_at
        )
        VALUES (
            ${input.draftPostId},
            ${input.draftVersion},
            ${contentSnapshot},
            ${contentHash},
            ${input.createdFromState},
            ${input.createdBy},
            ${latestAnchoredMatchingCollabAnchor?.anchorId || null},
            ${latestDraftAnchor?.summaryHash || null},
            ${latestDraftAnchor?.messagesDigest || null},
            NOW()
        )
        ON CONFLICT (draft_post_id, draft_version) DO NOTHING
        RETURNING
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            crystallization_routing_receipt AS "crystallizationRoutingReceipt",
            created_at AS "createdAt"
    `);

    if (insertedRows[0]) {
        return mapRowToRecord(insertedRows[0]);
    }

    const existing = await loadDraftVersionSnapshot(prisma, {
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
    });
    if (!existing) {
        throw new Error('draft_version_snapshot_unavailable');
    }
    return existing;
}

export async function updateDraftVersionSnapshotSourceEvidence(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
        sourceEditAnchorId?: string | null;
        sourceSummaryHash?: string | null;
        sourceMessagesDigest?: string | null;
    },
): Promise<DraftVersionSnapshotRecord | null> {
    const rows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        UPDATE draft_version_snapshots
        SET
            source_edit_anchor_id = COALESCE(${input.sourceEditAnchorId ?? null}, source_edit_anchor_id),
            source_summary_hash = COALESCE(${input.sourceSummaryHash ?? null}, source_summary_hash),
            source_messages_digest = COALESCE(${input.sourceMessagesDigest ?? null}, source_messages_digest)
        WHERE draft_post_id = ${input.draftPostId}
          AND draft_version = ${input.draftVersion}
        RETURNING
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            crystallization_routing_receipt AS "crystallizationRoutingReceipt",
            created_at AS "createdAt"
    `);

    return rows[0] ? mapRowToRecord(rows[0]) : null;
}

export async function recordOrdinaryCrystallizationRoutingReceipt(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
        actorUserId: number;
        policyProfileDigest: string;
        evaluatedAt: Date;
        allowRetryActorSupersession?: boolean;
    },
): Promise<OrdinaryCrystallizationRoutingReceipt> {
    const snapshot = await loadDraftVersionSnapshot(prisma, {
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
    });
    if (!snapshot) throw new Error('draft_version_snapshot_unavailable');
    const existing = snapshot.crystallizationRoutingReceipt;
    if (existing) {
        if (!matchesOrdinaryRoutingContext(existing, {
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
            snapshotContentHash: snapshot.contentHash,
            policyProfileDigest: input.policyProfileDigest,
        })) throw new Error('draft_crystallization_routing_conflict');
        if (
            existing.actorUserId === input.actorUserId
            || input.allowRetryActorSupersession !== true
        ) return existing;
    }

    const unsignedReceipt = existing
        ? {
            schemaVersion: 2 as const,
            path: 'ordinary_knowledge' as const,
            actionIntent: 'none' as const,
            humanConfirmed: true as const,
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
            snapshotContentHash: snapshot.contentHash,
            policyProfileDigest: input.policyProfileDigest,
            actorUserId: input.actorUserId,
            reasonCodes: [
                'no_structured_action_intent',
                'ordinary_collaboration_confirmed',
                'failed_retry_submit_authority_superseded',
            ] as OrdinaryCrystallizationRoutingReceipt['reasonCodes'],
            supersededReceipts: [
                ...(existing.schemaVersion === 2 ? existing.supersededReceipts || [] : []),
                {
                    receiptDigest: existing.receiptDigest,
                    actorUserId: existing.actorUserId,
                    evaluatedAt: existing.evaluatedAt,
                },
            ],
            evaluatedAt: input.evaluatedAt.toISOString(),
        }
        : {
            schemaVersion: 1 as const,
            path: 'ordinary_knowledge' as const,
            actionIntent: 'none' as const,
            humanConfirmed: true as const,
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
            snapshotContentHash: snapshot.contentHash,
            policyProfileDigest: input.policyProfileDigest,
            actorUserId: input.actorUserId,
            reasonCodes: [
                'no_structured_action_intent',
                'ordinary_collaboration_confirmed',
            ] as OrdinaryCrystallizationRoutingReceipt['reasonCodes'],
            evaluatedAt: input.evaluatedAt.toISOString(),
        };
    const receipt: OrdinaryCrystallizationRoutingReceipt = {
        ...unsignedReceipt,
        receiptDigest: hashCanonicalGovernanceValue(
            'alcheme.knowledge.crystallization-routing-receipt.v1',
            unsignedReceipt,
        ),
    };
    const receiptJson = JSON.stringify(receipt);
    const receiptAssignment = existing
        ? Prisma.sql`CAST(${receiptJson} AS jsonb)`
        : Prisma.sql`COALESCE(crystallization_routing_receipt, CAST(${receiptJson} AS jsonb))`;
    const receiptGuard = existing
        ? Prisma.sql`crystallization_routing_receipt ->> 'receiptDigest' = ${existing.receiptDigest}`
        : Prisma.sql`(
            crystallization_routing_receipt IS NULL
            OR crystallization_routing_receipt ->> 'receiptDigest' = ${receipt.receiptDigest}
        )`;
    const rows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        UPDATE draft_version_snapshots
        SET crystallization_routing_receipt = ${receiptAssignment}
        WHERE draft_post_id = ${input.draftPostId}
          AND draft_version = ${input.draftVersion}
          AND ${receiptGuard}
        RETURNING
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            crystallization_routing_receipt AS "crystallizationRoutingReceipt",
            created_at AS "createdAt"
    `);
    const persisted = rows[0]
        ? mapRowToRecord(rows[0]).crystallizationRoutingReceipt
        : (await loadDraftVersionSnapshot(prisma, {
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
        }))?.crystallizationRoutingReceipt;
    if (
        !persisted
        || persisted.receiptDigest !== receipt.receiptDigest
        || persisted.actorUserId !== input.actorUserId
        || !matchesOrdinaryRoutingContext(persisted, {
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
            snapshotContentHash: snapshot.contentHash,
            policyProfileDigest: input.policyProfileDigest,
        })
    ) {
        throw new Error('draft_crystallization_routing_conflict');
    }
    return persisted;
}

export async function recordGovernedCaseCrystallizationRoutingReceipt(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
        actorUserId: number;
        policyProfileDigest: string;
        actionType: RevisionDirectionAcceptActionType;
        targetRef: string;
        payloadDigest: string;
        governancePolicyId: string;
        governancePolicyVersionId: string;
        governancePolicyVersion: number;
        governanceRuleId: string;
        contractVersionId: string;
        authorityBindingId: string;
        profileBindingId: string;
        invocationId: string;
        requestId: string;
        caseId: string;
        evaluatedAt: Date;
    },
): Promise<GovernedCaseCrystallizationRoutingReceipt> {
    const snapshot = await loadDraftVersionSnapshot(prisma, {
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
    });
    if (!snapshot) throw new Error('draft_version_snapshot_unavailable');
    const context = {
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
        snapshotContentHash: snapshot.contentHash,
        policyProfileDigest: input.policyProfileDigest,
        actionType: input.actionType,
        targetRef: input.targetRef,
        payloadDigest: input.payloadDigest,
        governancePolicyId: input.governancePolicyId,
        governancePolicyVersionId: input.governancePolicyVersionId,
        governancePolicyVersion: input.governancePolicyVersion,
        governanceRuleId: input.governanceRuleId,
        contractVersionId: input.contractVersionId,
        authorityBindingId: input.authorityBindingId,
        profileBindingId: input.profileBindingId,
        invocationId: input.invocationId,
        requestId: input.requestId,
        caseId: input.caseId,
    } as const;
    if (snapshot.crystallizationRoutingReceipt) {
        if (!matchesGovernedCaseRoutingContext(snapshot.crystallizationRoutingReceipt, context)) {
            throw new Error('draft_crystallization_routing_conflict');
        }
        return snapshot.crystallizationRoutingReceipt;
    }

    const unsignedReceipt = {
        schemaVersion: 1 as const,
        path: 'governed_case' as const,
        actionIntent: input.actionType,
        humanConfirmed: true as const,
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
        snapshotContentHash: snapshot.contentHash,
        policyProfileDigest: input.policyProfileDigest,
        actorUserId: input.actorUserId,
        actionType: input.actionType,
        targetType: 'revision_direction' as const,
        targetRef: input.targetRef,
        payloadDigest: input.payloadDigest,
        governancePolicyId: input.governancePolicyId,
        governancePolicyVersionId: input.governancePolicyVersionId,
        governancePolicyVersion: input.governancePolicyVersion,
        governanceRuleId: input.governanceRuleId,
        contractVersionId: input.contractVersionId,
        authorityBindingId: input.authorityBindingId,
        profileBindingId: input.profileBindingId,
        invocationId: input.invocationId,
        requestId: input.requestId,
        caseId: input.caseId,
        reasonCodes: [
            'registered_action_intent_confirmed',
            'active_governance_binding_resolved',
            'lossless_case_upgrade',
        ] as GovernedCaseCrystallizationRoutingReceipt['reasonCodes'],
        evaluatedAt: input.evaluatedAt.toISOString(),
    };
    const receipt: GovernedCaseCrystallizationRoutingReceipt = {
        ...unsignedReceipt,
        receiptDigest: hashCanonicalGovernanceValue(
            'alcheme.knowledge.crystallization-routing-receipt.v1',
            unsignedReceipt,
        ),
    };
    const receiptJson = JSON.stringify(receipt);
    const rows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        UPDATE draft_version_snapshots
        SET crystallization_routing_receipt = COALESCE(
            crystallization_routing_receipt,
            CAST(${receiptJson} AS jsonb)
        )
        WHERE draft_post_id = ${input.draftPostId}
          AND draft_version = ${input.draftVersion}
          AND (
              crystallization_routing_receipt IS NULL
              OR crystallization_routing_receipt ->> 'receiptDigest' = ${receipt.receiptDigest}
          )
        RETURNING
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            crystallization_routing_receipt AS "crystallizationRoutingReceipt",
            created_at AS "createdAt"
    `);
    const persisted = rows[0]
        ? mapRowToRecord(rows[0]).crystallizationRoutingReceipt
        : (await loadDraftVersionSnapshot(prisma, {
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
        }))?.crystallizationRoutingReceipt;
    if (!persisted || !matchesGovernedCaseRoutingContext(persisted, context)) {
        throw new Error('draft_crystallization_routing_conflict');
    }
    return persisted;
}
