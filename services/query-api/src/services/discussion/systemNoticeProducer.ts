import crypto from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
    DISCUSSION_STREAM_KEY,
    buildDiscussionRoomKey,
    buildDiscussionSigningMessage,
    buildDiscussionSigningPayload,
    computeDiscussionEnvelopeId,
    sha256Hex,
    updateOffchainWatermark,
} from '../offchainDiscussion';
import { sqlTimestampWithoutTimeZone } from '../../utils/sqlTimestamp';
import { resolveCandidateGenerationGovernanceReadModel } from '../governance/read-models';
import type { DraftCandidateGovernanceStatus } from '../policy/types';
import {
    AUTHOR_ANNOTATION_KINDS,
    type AuthorAnnotationKind,
} from './structuredMessageMetadata';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type SemanticFacet,
} from './analysis/types';
import { buildDiscussionSystemNoticeSeed } from './systemNoticeSeam';
import { publishDiscussionRealtimeEvent } from './realtime';

const SYSTEM_NOTICE_SENDER_PUBKEY = 'system_notice';
const SYSTEM_NOTICE_SENDER_HANDLE = 'ghost.system';
const SYSTEM_NOTICE_AUTH_MODE = 'system_notice';

type NoticeKind = 'draft_candidate_notice' | 'governance_notice';

interface DiscussionNoticeRow {
    envelopeId: string;
    lamport: bigint;
}

export interface PublishDraftCandidateSystemNoticesInput {
    circleId: number;
    summary: string;
    sourceMessageIds: string[];
    sourceSemanticFacets: SemanticFacet[];
    sourceAuthorAnnotations: AuthorAnnotationKind[];
    draftPostId?: number | null;
    triggerReason: string;
    candidateStateOverride?: DraftCandidateGovernanceStatus | null;
    draftGenerationStatus?: string | null;
    draftGenerationMethod?: string | null;
    draftGenerationError?: string | null;
    draftGenerationSourceDigest?: string | null;
}

export interface PublishedDraftCandidateSystemNotices {
    candidateId: string;
    candidateState: DraftCandidateGovernanceStatus;
    draftCandidateNoticeEnvelopeId: string | null;
    governanceNoticeEnvelopeId: string | null;
}

function normalizeSourceMessageIds(value: string[]): string[] {
    const seen = new Set<string>();
    for (const raw of value) {
        const normalized = String(raw || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
    }
    return Array.from(seen);
}

function normalizeSourceSemanticFacets(value: SemanticFacet[]): SemanticFacet[] {
    const seen = new Set<SemanticFacet>();
    for (const label of value) {
        if (!(DISCUSSION_SEMANTIC_FACETS as readonly string[]).includes(label)) continue;
        seen.add(label);
    }
    return DISCUSSION_SEMANTIC_FACETS.filter((label) => seen.has(label));
}

function normalizeSourceAuthorAnnotations(value: AuthorAnnotationKind[]): AuthorAnnotationKind[] {
    const seen = new Set<AuthorAnnotationKind>();
    for (const label of value) {
        if (!(AUTHOR_ANNOTATION_KINDS as readonly string[]).includes(label)) continue;
        seen.add(label);
    }
    return AUTHOR_ANNOTATION_KINDS.filter((label) => seen.has(label));
}

function normalizeSummaryPreview(value: string): string | null {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.slice(0, 500);
}

function normalizeDraftPostId(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
    return value;
}

export function buildDraftCandidateId(input: {
    circleId: number;
    sourceMessageIds: string[];
}): string {
    const digest = sha256Hex(`${input.circleId}:${input.sourceMessageIds.join('|')}`);
    return `cand_${digest.slice(0, 24)}`;
}

export function resolveCandidateStateForNotice(input: {
    governanceState: DraftCandidateGovernanceStatus;
    draftPostId: number | null;
}): DraftCandidateGovernanceStatus {
    if (input.draftPostId && (input.governanceState === 'open' || input.governanceState === 'proposal_active')) {
        return 'accepted';
    }
    return input.governanceState;
}

function buildNoticePayloadText(input: {
    kind: NoticeKind;
    state: DraftCandidateGovernanceStatus;
}): string {
    if (input.kind === 'draft_candidate_notice') {
        if (input.state === 'accepted') return 'discussion candidate accepted as draft';
        if (input.state === 'pending') return 'discussion candidate draft generation pending';
        if (input.state === 'generation_failed') return 'discussion candidate generation failed';
        return 'discussion candidate notice';
    }
    if (input.state === 'pending') return 'governance execution pending for draft generation';
    if (input.state === 'generation_failed') return 'governance execution failed for draft generation';
    if (input.state === 'proposal_active') return 'governance proposal active for draft generation';
    if (input.state === 'accepted') return 'governance executed for draft generation';
    return 'governance notice for draft generation';
}

export function buildNoticeEventKey(input: {
    kind: NoticeKind;
    candidateId: string;
    state: DraftCandidateGovernanceStatus;
    draftPostId: number | null;
    proposalId: string | null;
    executionError: string | null;
    draftGenerationStatus?: string | null;
    draftGenerationError?: string | null;
    draftGenerationSourceDigest?: string | null;
}): string {
    const seed = [
        input.kind,
        input.candidateId,
        input.state,
        input.draftPostId ? String(input.draftPostId) : '',
        input.proposalId || '',
        input.executionError || '',
        input.draftGenerationStatus || '',
        input.draftGenerationError || '',
        input.draftGenerationSourceDigest || '',
    ].join('|');
    return `notice_${sha256Hex(seed).slice(0, 24)}`;
}

async function findExistingNotice(input: {
    prisma: PrismaClient;
    circleId: number;
    messageKind: NoticeKind;
    noticeEventKey: string;
}): Promise<string | null> {
    const rows = await input.prisma.$queryRaw<Array<{ envelopeId: string }>>(Prisma.sql`
        SELECT envelope_id AS "envelopeId"
        FROM circle_discussion_messages
        WHERE circle_id = ${input.circleId}
          AND message_kind = ${input.messageKind}
          AND metadata->>'noticeEventKey' = ${input.noticeEventKey}
        ORDER BY lamport DESC
        LIMIT 1
    `);
    return rows[0]?.envelopeId ?? null;
}

function normalizeSubjectType(value: string | null): 'knowledge' | 'discussion_message' | null {
    if (value === 'knowledge' || value === 'discussion_message') return value;
    return null;
}

async function publishSystemNotice(input: {
    prisma: PrismaClient;
    redis?: Pick<Redis, 'publish'> | null;
    circleId: number;
    messageKind: NoticeKind;
    metadata: Record<string, unknown>;
    payloadText: string;
    subjectType: string | null;
    subjectId: string | null;
}): Promise<string | null> {
    const seed = buildDiscussionSystemNoticeSeed({
        messageKind: input.messageKind,
        metadata: input.metadata,
        payloadText: input.payloadText,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
    });
    if (!seed) return null;

    const noticeEventKey = typeof seed.metadata.noticeEventKey === 'string'
        ? seed.metadata.noticeEventKey.trim()
        : '';
    if (!noticeEventKey) return null;

    const existingEnvelopeId = await findExistingNotice({
        prisma: input.prisma,
        circleId: input.circleId,
        messageKind: seed.messageKind,
        noticeEventKey,
    });
    if (existingEnvelopeId) {
        return existingEnvelopeId;
    }

    const roomKey = buildDiscussionRoomKey(input.circleId);
    const clientTimestamp = new Date();
    const clientTimestampIso = clientTimestamp.toISOString();
    const nonce = crypto.randomBytes(10).toString('hex');
    const subjectType = normalizeSubjectType(seed.subjectType);
    const subjectId = subjectType ? seed.subjectId : null;
    const signingPayload = buildDiscussionSigningPayload({
        roomKey,
        circleId: input.circleId,
        senderPubkey: SYSTEM_NOTICE_SENDER_PUBKEY,
        text: seed.payloadText,
        clientTimestamp: clientTimestampIso,
        nonce,
        prevEnvelopeId: null,
        subjectType,
        subjectId,
    });
    const signedMessage = buildDiscussionSigningMessage(signingPayload);
    const payloadHash = sha256Hex(seed.payloadText);
    const persistedAt = sqlTimestampWithoutTimeZone(clientTimestamp);
    const envelopeId = computeDiscussionEnvelopeId({
        roomKey,
        senderPubkey: SYSTEM_NOTICE_SENDER_PUBKEY,
        payloadHash,
        clientTimestamp: clientTimestampIso,
        nonce,
        prevEnvelopeId: null,
        signatureBase64: null,
        subjectType,
        subjectId,
    });

    const inserted = await input.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<DiscussionNoticeRow[]>(Prisma.sql`
            INSERT INTO circle_discussion_messages (
                envelope_id,
                stream_key,
                room_key,
                circle_id,
                sender_pubkey,
                sender_handle,
                message_kind,
                metadata,
                subject_type,
                subject_id,
                payload_text,
                payload_hash,
                nonce,
                signature,
                signature_scheme,
                signed_message,
                signature_verified,
                auth_mode,
                session_id,
                relevance_score,
                semantic_score,
                quality_score,
                spam_score,
                decision_confidence,
                relevance_method,
                is_featured,
                feature_reason,
                featured_at,
                is_ephemeral,
                expires_at,
                client_timestamp,
                prev_envelope_id,
                created_at,
                updated_at
            )
            VALUES (
                ${envelopeId},
                ${DISCUSSION_STREAM_KEY},
                ${roomKey},
                ${input.circleId},
                ${SYSTEM_NOTICE_SENDER_PUBKEY},
                ${SYSTEM_NOTICE_SENDER_HANDLE},
                ${seed.messageKind},
                ${JSON.stringify(seed.metadata)}::jsonb,
                ${subjectType},
                ${subjectId},
                ${seed.payloadText},
                ${payloadHash},
                ${nonce},
                ${null},
                'ed25519',
                ${signedMessage},
                ${true},
                ${SYSTEM_NOTICE_AUTH_MODE},
                ${null},
                ${1},
                ${1},
                ${0.7},
                ${0},
                ${0.7},
                'system',
                ${false},
                ${null},
                ${null},
                ${false},
                ${null},
                ${sqlTimestampWithoutTimeZone(clientTimestamp)},
                ${null},
                ${persistedAt},
                ${persistedAt}
            )
            RETURNING envelope_id AS "envelopeId", lamport AS "lamport"
        `);

        const row = rows[0];
        if (!row) {
            throw new Error('failed_to_insert_system_notice');
        }

        await updateOffchainWatermark(tx, {
            lamport: row.lamport,
            envelopeId: row.envelopeId,
        });

        return row;
    });

    if (input.redis) {
        await publishDiscussionRealtimeEvent(input.redis, {
            circleId: input.circleId,
            latestLamport: Number(inserted.lamport),
            envelopeId: inserted.envelopeId,
            reason: input.messageKind === 'draft_candidate_notice'
                ? 'candidate_notice_updated'
                : 'system_notice_published',
        });
    }

    return inserted.envelopeId;
}

export async function publishDraftCandidateSystemNotices(
    prisma: PrismaClient,
    input: PublishDraftCandidateSystemNoticesInput,
    redis?: Pick<Redis, 'publish'> | null,
): Promise<PublishedDraftCandidateSystemNotices | null> {
    const sourceMessageIds = normalizeSourceMessageIds(input.sourceMessageIds);
    if (sourceMessageIds.length === 0) {
        return null;
    }
    const sourceSemanticFacets = normalizeSourceSemanticFacets(input.sourceSemanticFacets);
    const sourceAuthorAnnotations = normalizeSourceAuthorAnnotations(input.sourceAuthorAnnotations);
    const summary = normalizeSummaryPreview(input.summary);
    const draftPostId = normalizeDraftPostId(input.draftPostId);

    const candidateId = buildDraftCandidateId({
        circleId: input.circleId,
        sourceMessageIds,
    });
    const governance = await resolveCandidateGenerationGovernanceReadModel(prisma, {
        circleId: input.circleId,
        candidateId,
    });

    const candidateState = input.candidateStateOverride ?? resolveCandidateStateForNotice({
        governanceState: governance.candidateStatus,
        draftPostId,
    });

    const proposalId = governance.proposal?.proposalId ?? null;
    const executionError = governance.proposal?.executionError ?? null;
    const draftGenerationStatus = input.draftGenerationStatus ?? candidateState;
    const draftGenerationError = input.draftGenerationError ?? executionError;
    const draftGenerationSourceDigest = input.draftGenerationSourceDigest ?? null;
    const noticeMetadata: Record<string, unknown> = {
        candidateId,
        state: candidateState,
        summary,
        sourceMessageIds,
        sourceSemanticFacets,
        sourceAuthorAnnotations,
        lastProposalId: proposalId,
        lastExecutionError: executionError,
        draftPostId,
        canRetry: candidateState === governance.failureRecovery.failedStatus,
        failureRecovery: {
            failedStatus: governance.failureRecovery.failedStatus,
            canRetryExecutionRoles: governance.failureRecovery.canRetryExecutionRoles,
            retryExecutionReusesPassedProposal: governance.failureRecovery.retryExecutionReusesPassedProposal,
            canCancelRoles: governance.failureRecovery.canCancelRoles,
        },
        governanceCandidateStatus: governance.candidateStatus,
        governanceProposalStatus: governance.proposal?.status ?? null,
        triggerReason: input.triggerReason,
        draftGenerationStatus,
        draftGenerationMethod: input.draftGenerationMethod ?? null,
        draftGenerationError,
        draftGenerationSourceDigest,
    };

    const subjectId = sourceMessageIds[sourceMessageIds.length - 1] ?? null;
    const candidateNoticeEventKey = buildNoticeEventKey({
        kind: 'draft_candidate_notice',
        candidateId,
        state: candidateState,
        draftPostId,
        proposalId,
        executionError,
        draftGenerationStatus,
        draftGenerationError,
        draftGenerationSourceDigest,
    });
    const draftCandidateNoticeEnvelopeId = await publishSystemNotice({
        prisma,
        redis,
        circleId: input.circleId,
        messageKind: 'draft_candidate_notice',
        metadata: {
            ...noticeMetadata,
            noticeEventKey: candidateNoticeEventKey,
        },
        payloadText: buildNoticePayloadText({
            kind: 'draft_candidate_notice',
            state: candidateState,
        }),
        subjectType: 'discussion_message',
        subjectId,
    });

    let governanceNoticeEnvelopeId: string | null = null;
    if (governance.proposal || candidateState === 'pending' || candidateState === 'generation_failed' || candidateState === 'proposal_active') {
        const governanceNoticeEventKey = buildNoticeEventKey({
            kind: 'governance_notice',
            candidateId,
            state: candidateState,
            draftPostId,
            proposalId,
            executionError,
            draftGenerationStatus,
            draftGenerationError,
            draftGenerationSourceDigest,
        });
        governanceNoticeEnvelopeId = await publishSystemNotice({
            prisma,
            redis,
            circleId: input.circleId,
            messageKind: 'governance_notice',
            metadata: {
                ...noticeMetadata,
                noticeEventKey: governanceNoticeEventKey,
            },
            payloadText: buildNoticePayloadText({
                kind: 'governance_notice',
                state: candidateState,
            }),
            subjectType: 'discussion_message',
            subjectId,
        });
    }

    return {
        candidateId,
        candidateState,
        draftCandidateNoticeEnvelopeId,
        governanceNoticeEnvelopeId,
    };
}
