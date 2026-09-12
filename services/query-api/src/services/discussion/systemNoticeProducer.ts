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
import { projectGovernanceDecisionExecutionStatus } from '../governance/readProjection';
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
import {
    findPlazaVisibleCircleDiscussionMessagesByEnvelopeIdsMap,
    mapRowToDto,
} from './messagesReadModel';
import type { PlazaAnchoredInteractionType } from './anchoredInteractions/types';
import type { DiscussionDraftSourceCarrier } from './draftSourceConsumption';

const SYSTEM_NOTICE_SENDER_PUBKEY = 'system_notice';
const SYSTEM_NOTICE_SENDER_HANDLE = 'ghost.system';
const SYSTEM_NOTICE_AUTH_MODE = 'system_notice';

type NoticeKind = 'draft_candidate_notice' | 'governance_notice' | 'source_material_notice' | 'interaction_result_notice';

interface DiscussionNoticeRow {
    envelopeId: string;
    lamport: bigint;
}

export interface PublishDraftCandidateSystemNoticesInput {
    circleId: number;
    summary: string;
    sourceMessageIds: string[];
    sourceCarrier?: DiscussionDraftSourceCarrier;
    sourceMaterialIds?: number[];
    sourceRoomKey?: string | null;
    sourceSemanticFacets: SemanticFacet[];
    sourceAuthorAnnotations: AuthorAnnotationKind[];
    draftPostId?: number | null;
    triggerReason: string;
    sourceScope?: DraftCandidateSourceScope | null;
    candidateStateOverride?: DraftCandidateGovernanceStatus | null;
    draftGenerationStatus?: string | null;
    draftGenerationMethod?: string | null;
    draftGenerationError?: string | null;
    draftGenerationSourceDigest?: string | null;
}

export interface DraftCandidateSourceScope {
    viewMode?: string | null;
    visibleMessageCount?: number | null;
    filterLabels?: string[] | null;
}

export interface PublishedDraftCandidateSystemNotices {
    candidateId: string;
    candidateState: DraftCandidateGovernanceStatus;
    draftCandidateNoticeEnvelopeId: string | null;
    governanceNoticeEnvelopeId: string | null;
}

export interface PublishSourceMaterialAcceptedSystemNoticeInput {
    circleId: number;
    sourceMaterialId: number;
    originType: string;
    originRef?: string | null;
    externalAppId?: string | null;
    roomKey?: string | null;
    contentDigest: string;
    lifecycleStatus: string;
    evidencePrivacyClass: string;
    summaryText?: string | null;
}

export interface PublishCircleLifecycleSystemNoticeInput {
    circleId: number;
    actionType: string;
    lifecycleStatus: string;
    actorPubkey: string;
    reason?: string | null;
}

export interface PublishInteractionResultNoticeInput {
    circleId: number;
    interactionId: string;
    interactionType: PlazaAnchoredInteractionType;
    anchorType?: 'discussion_message' | 'freeform';
    anchorEnvelopeId: string;
    resultVersion: number;
    resultStatus: 'ignored' | 'resolved';
    resultDigest: string;
    humanSummary: string;
    reasonCode: string;
    sourceEventIds: string[];
    sourceMessageIds: string[];
    projectionVersion: number;
    projectionCursor: number;
    resultPayload: Record<string, unknown>;
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

function normalizeInteractionAnchorType(value: unknown): 'discussion_message' | 'freeform' {
    return value === 'freeform' ? 'freeform' : 'discussion_message';
}

function normalizeStringList(value: string[], limit: number, maxLength: number): string[] {
    const seen = new Set<string>();
    for (const raw of value) {
        const normalized = normalizeNonEmptyString(raw, maxLength);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        if (seen.size >= limit) break;
    }
    return Array.from(seen);
}

function normalizeNonEmptyString(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
}

function normalizeDigest(value: unknown): string | null {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
        ? value.toLowerCase()
        : null;
}

function boundRecord(value: Record<string, unknown>): Record<string, unknown> {
    const json = JSON.stringify(value || {});
    if (json.length <= 4000) return value || {};
    return { truncated: true, digest: sha256Hex(json) };
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

function normalizeDraftCandidateSourceScope(
    value: DraftCandidateSourceScope | null | undefined,
    sourceMessageIds: string[],
): Record<string, unknown> | null {
    if (!value) return null;
    const viewMode = typeof value.viewMode === 'string' && value.viewMode.trim()
        ? value.viewMode.trim()
        : null;
    const visibleMessageCount = typeof value.visibleMessageCount === 'number'
        && Number.isInteger(value.visibleMessageCount)
        && value.visibleMessageCount >= 0
        ? value.visibleMessageCount
        : null;
    const filterLabels = normalizeSourceMessageIds(value.filterLabels ?? []);
    return {
        viewMode,
        visibleMessageCount,
        filterLabels,
        sourceMessageIds,
        sourceMessageCount: sourceMessageIds.length,
    };
}

export function buildDraftCandidateId(input: {
    circleId: number;
    sourceMessageIds: string[];
    sourceCarrier?: DiscussionDraftSourceCarrier;
}): string {
    const digestSeed = input.sourceCarrier === 'communication_message'
        ? `${input.circleId}:communication_message:${input.sourceMessageIds.join('|')}`
        : `${input.circleId}:${input.sourceMessageIds.join('|')}`;
    const digest = sha256Hex(digestSeed);
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
    if (input.kind === 'source_material_notice') return 'source material accepted to Plaza';
    if (input.kind === 'interaction_result_notice') return 'anchored interaction result';
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

export function buildSourceMaterialNoticeEventKey(input: {
    sourceMaterialId: number;
    lifecycleStatus: string;
    contentDigest: string;
}): string {
    const seed = [
        'source_material_notice',
        String(input.sourceMaterialId),
        input.lifecycleStatus,
        input.contentDigest,
    ].join('|');
    return `notice_${sha256Hex(seed).slice(0, 24)}`;
}

export function buildInteractionResultNoticeEventKey(input: {
    interactionId: string;
    resultVersion: number;
    resultStatus: 'ignored' | 'resolved';
    resultDigest: string;
}): string {
    const seed = [
        'interaction_result_notice',
        input.interactionId,
        input.resultVersion,
        input.resultStatus,
        input.resultDigest,
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

function normalizeSubjectType(value: string | null): 'knowledge' | 'discussion_message' | 'source_material' | null {
    if (value === 'knowledge' || value === 'discussion_message' || value === 'source_material') return value;
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
        let message: ReturnType<typeof mapRowToDto> | null = null;
        try {
            const visibleRows = await findPlazaVisibleCircleDiscussionMessagesByEnvelopeIdsMap({
                prisma: input.prisma,
                circleId: input.circleId,
                roomKey: buildDiscussionRoomKey(input.circleId),
                envelopeIds: [inserted.envelopeId],
                includeDeleted: true,
            });
            const visibleRow = visibleRows.get(inserted.envelopeId);
            message = visibleRow ? mapRowToDto(visibleRow) : null;
        } catch {
            // Hydration is an optimization for realtime clients; the light
            // event still lets clients refresh by envelope.
            message = null;
        }
        await publishDiscussionRealtimeEvent(input.redis, {
            circleId: input.circleId,
            latestLamport: Number(inserted.lamport),
            envelopeId: inserted.envelopeId,
            reason: input.messageKind === 'draft_candidate_notice'
                ? 'candidate_notice_updated'
                : input.messageKind === 'interaction_result_notice'
                    ? 'interaction_result_published'
                : 'system_notice_published',
            ...(message ? { message } : {}),
        });
    }

    return inserted.envelopeId;
}

export async function publishInteractionResultNotice(
    prisma: PrismaClient,
    input: PublishInteractionResultNoticeInput,
    redis?: Pick<Redis, 'publish'> | null,
): Promise<string | null> {
    const interactionId = normalizeNonEmptyString(input.interactionId, 64);
    const anchorType = normalizeInteractionAnchorType(input.anchorType);
    const anchorEnvelopeId = normalizeNonEmptyString(input.anchorEnvelopeId, 96);
    const resultDigest = normalizeDigest(input.resultDigest);
    const humanSummary = normalizeSummaryPreview(input.humanSummary);
    const reasonCode = normalizeNonEmptyString(input.reasonCode, 96);
    if (!interactionId || !anchorEnvelopeId || !resultDigest || !humanSummary || !reasonCode) {
        return null;
    }
    const resultVersion = Number.isInteger(input.resultVersion) && input.resultVersion > 0
        ? input.resultVersion
        : input.projectionVersion;
    const noticeEventKey = buildInteractionResultNoticeEventKey({
        interactionId,
        resultVersion,
        resultStatus: input.resultStatus,
        resultDigest,
    });
    const sourceEventIds = normalizeStringList(input.sourceEventIds, 64, 96);
    const sourceMessageIds = anchorType === 'discussion_message'
        ? normalizeStringList(input.sourceMessageIds, 64, 96)
        : [];
    const metadata = {
        kind: 'interaction_result_notice',
        noticeEventKey,
        interactionId,
        interactionType: input.interactionType,
        anchorType,
        anchorEnvelopeId,
        resultVersion,
        resultStatus: input.resultStatus,
        resultDigest,
        humanSummary,
        reasonCode,
        sourceEventIds,
        sourceMessageIds,
        projectionVersion: input.projectionVersion,
        projectionCursor: input.projectionCursor,
        resultPayload: boundRecord(input.resultPayload),
    };

    return publishSystemNotice({
        prisma,
        redis,
        circleId: input.circleId,
        messageKind: 'interaction_result_notice',
        metadata,
        payloadText: humanSummary,
        subjectType: anchorType === 'discussion_message' ? 'discussion_message' : null,
        subjectId: anchorType === 'discussion_message' ? anchorEnvelopeId : null,
    });
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
        sourceCarrier: input.sourceCarrier,
    });
    const governance = await resolveCandidateGenerationGovernanceReadModel(prisma, {
        circleId: input.circleId,
        candidateId,
    });

    const candidateState = input.candidateStateOverride ?? resolveCandidateStateForNotice({
        governanceState: governance.candidateStatus,
        draftPostId,
    });

    const requestId = governance.request?.requestId ?? null;
    const executionError = governance.request?.executionError ?? null;
    const draftGenerationStatus = input.draftGenerationStatus ?? candidateState;
    const draftGenerationError = input.draftGenerationError ?? executionError;
    const draftGenerationSourceDigest = input.draftGenerationSourceDigest ?? null;
    const governanceStatus = governance.request
        ? projectGovernanceDecisionExecutionStatus({
            state: governance.request.state,
            receipts: governance.request.executionStatus
                ? [{ executionStatus: governance.request.executionStatus }]
                : [],
        })
        : null;
    const noticeMetadata: Record<string, unknown> = {
        candidateId,
        state: candidateState,
        summary,
        sourceMessageIds,
        sourceSemanticFacets,
        sourceAuthorAnnotations,
        lastRequestId: requestId,
        lastProposalId: requestId,
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
        governanceRequestState: governance.request?.state ?? null,
        governanceProposalStatus: governance.request?.state ?? null,
        governanceDecisionStatus: governanceStatus?.decisionStatus ?? null,
        governanceExecutionStatus: governanceStatus?.executionStatus ?? null,
        triggerReason: input.triggerReason,
        draftGenerationStatus,
        draftGenerationMethod: input.draftGenerationMethod ?? null,
        draftGenerationError,
        draftGenerationSourceDigest,
        sourceScope: normalizeDraftCandidateSourceScope(input.sourceScope, sourceMessageIds),
        ...(input.sourceCarrier === 'communication_message'
            ? {
                sourceCarrier: input.sourceCarrier,
                sourceMaterialIds: Array.from(new Set((input.sourceMaterialIds ?? [])
                    .filter((id) => Number.isSafeInteger(id) && id > 0))),
                sourceRoomKey: normalizeNonEmptyString(input.sourceRoomKey, 96),
            }
            : {}),
    };

    const subjectId = sourceMessageIds[sourceMessageIds.length - 1] ?? null;
    const candidateNoticeEventKey = buildNoticeEventKey({
        kind: 'draft_candidate_notice',
        candidateId,
        state: candidateState,
        draftPostId,
        proposalId: requestId,
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
    if (governance.request || candidateState === 'pending' || candidateState === 'generation_failed' || candidateState === 'proposal_active') {
        const governanceNoticeEventKey = buildNoticeEventKey({
            kind: 'governance_notice',
            candidateId,
            state: candidateState,
            draftPostId,
            proposalId: requestId,
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

export async function publishSourceMaterialAcceptedSystemNotice(
    prisma: PrismaClient,
    input: PublishSourceMaterialAcceptedSystemNoticeInput,
    redis?: Pick<Redis, 'publish'> | null,
): Promise<string | null> {
    const noticeEventKey = buildSourceMaterialNoticeEventKey({
        sourceMaterialId: input.sourceMaterialId,
        lifecycleStatus: input.lifecycleStatus,
        contentDigest: input.contentDigest,
    });
    return publishSystemNotice({
        prisma,
        redis,
        circleId: input.circleId,
        messageKind: 'source_material_notice',
        metadata: {
            noticeEventKey,
            sourceMaterialId: input.sourceMaterialId,
            originType: input.originType,
            originRef: input.originRef ?? null,
            externalAppId: input.externalAppId ?? null,
            roomKey: input.roomKey ?? null,
            contentDigest: input.contentDigest,
            lifecycleStatus: input.lifecycleStatus,
            evidencePrivacyClass: input.evidencePrivacyClass,
            summaryPreview: normalizeSummaryPreview(input.summaryText ?? ''),
        },
        payloadText: 'source material accepted to Plaza',
        subjectType: 'source_material',
        subjectId: String(input.sourceMaterialId),
    });
}

export async function publishCircleLifecycleSystemNotice(
    prisma: PrismaClient,
    input: PublishCircleLifecycleSystemNoticeInput,
    redis?: Pick<Redis, 'publish'> | null,
): Promise<string | null> {
    const noticeEventKey = `notice_${sha256Hex([
        'circle_lifecycle_notice',
        String(input.circleId),
        input.actionType,
        input.lifecycleStatus,
        input.actorPubkey,
    ].join('|')).slice(0, 24)}`;
    const lifecycleVerb = input.actionType === 'circle.lifecycle.restore'
        ? 'restored'
        : 'archived';
    return publishSystemNotice({
        prisma,
        redis,
        circleId: input.circleId,
        messageKind: 'governance_notice',
        metadata: {
            kind: 'circle_lifecycle_notice',
            noticeEventKey,
            actionType: input.actionType,
            lifecycleStatus: input.lifecycleStatus,
            actorPubkey: input.actorPubkey,
            reason: input.reason || null,
        },
        payloadText: input.reason
            ? `Circle ${lifecycleVerb}. Reason: ${input.reason}`
            : `Circle ${lifecycleVerb}.`,
        subjectType: 'circle',
        subjectId: String(input.circleId),
    });
}
