import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import { buildAiSourceDigest, type AiGenerationMetadata } from './metadata';
import { assertAiTaskAllowed, generateAiText } from './provider';
import { getPromptMetadata, getPromptSchema, getSystemPrompt } from './prompts/registry';
import {
    CircleDraftPromptError,
    resolveCircleDraftPromptForGeneration,
    type ResolvedCircleDraftPrompt,
} from '../services/policy/circleDraftPrompt';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type AuthorAnnotationKind,
    type SemanticFacet,
} from '../services/discussion/analysis/types';
import { DISCUSSION_FORWARD_PROJECTION_MESSAGE_KINDS } from '../services/discussion/discussionMessageKinds';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface SourceMessageRow {
    envelopeId: string;
    senderPubkey: string;
    senderHandle: string | null;
    messageKind: string | null;
    metadata: unknown;
    payloadText: string;
    payloadHash: string;
    lamport: bigint | number | string;
    createdAt: Date;
    relevanceStatus: string | null;
    semanticScore: unknown;
    focusScore: unknown;
    qualityScore: unknown;
    spamScore: unknown;
    decisionConfidence: unknown;
    relevanceMethod: string | null;
    semanticFacets: unknown;
    authorAnnotations: unknown;
}

export interface InitialDraftInteractionResultMetadata {
    anchorEnvelopeId: string | null;
    reasonCode: string | null;
    aiTreatment: string | null;
    winningOptionId: string | null;
}

export interface InitialDraftSourceMessage {
    envelopeId: string;
    senderPubkey: string;
    senderHandle: string | null;
    messageKind: string;
    metadataDigest: string | null;
    interactionResult: InitialDraftInteractionResultMetadata | null;
    payloadText: string;
    payloadHash: string;
    lamport: bigint;
    createdAt: Date;
    relevanceStatus: 'ready';
    semanticScore: number;
    focusScore: number;
    qualityScore: number;
    spamScore: number;
    decisionConfidence: number;
    relevanceMethod: string;
    semanticFacets: SemanticFacet[];
    authorAnnotations: AuthorAnnotationKind[];
}

export const DISCUSSION_DRAFT_SOURCE_EXCLUDED_MESSAGE_KINDS = [
    'draft_candidate_notice',
    'governance_notice',
    ...DISCUSSION_FORWARD_PROJECTION_MESSAGE_KINDS,
] as const;

const DRAFT_SOURCE_METADATA_DIGEST_KEYS = [
    'interactionId',
    'interactionType',
    'anchorEnvelopeId',
    'reasonCode',
    'resultDigest',
    'resultStatus',
    'projectionVersion',
    'projectionCursor',
    'sourceEventIds',
    'sourceMessageIds',
] as const;

export interface GenerateInitialDiscussionDraftInput {
    circleId: number;
    requestedByUserId: number | null;
    circleName: string;
    circleDescription?: string | null;
    sourceMessageIds: string[];
    sourceMessages?: InitialDraftSourceMessage[];
}

export interface GenerateInitialDiscussionDraftResult {
    title: string;
    draftText: string;
    sections: Array<{ heading: string; body: string }>;
    sourceMessages: InitialDraftSourceMessage[];
    sourceDigest: string;
    generationMetadata: AiGenerationMetadata;
    rawFinishReason: string | null;
}

export class DiscussionInitialDraftError extends Error {
    code: string;
    retryable: boolean;
    diagnostics: Record<string, unknown>;

    constructor(input: {
        code: string;
        message: string;
        retryable?: boolean;
        diagnostics?: Record<string, unknown>;
    }) {
        super(input.message);
        this.name = 'DiscussionInitialDraftError';
        this.code = input.code;
        this.retryable = input.retryable ?? true;
        this.diagnostics = input.diagnostics ?? {};
    }
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

function normalizeText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(input: string): string {
    return String(input || '')
        .split('\n')
        .map((line) => normalizeText(line))
        .filter((line) => line.length > 0)
        .join('\n');
}

function normalizeScore(value: unknown, fallback: number): number {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        const normalized = typeof item === 'string' ? item.trim().toLowerCase() : '';
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
    }
    return Array.from(seen);
}

function normalizeSemanticFacets(value: unknown): SemanticFacet[] {
    const normalized = normalizeStringArray(value);
    return DISCUSSION_SEMANTIC_FACETS.filter((facet) => normalized.includes(facet));
}

function normalizeAuthorAnnotations(value: unknown): AuthorAnnotationKind[] {
    const normalized = normalizeStringArray(value);
    const allowed: AuthorAnnotationKind[] = ['fact', 'explanation', 'emotion'];
    return allowed.filter((label) => normalized.includes(label));
}

function normalizeMessageKind(value: unknown): string {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized || 'plain';
}

function normalizeDigestMetadataValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value
            .map((entry) => typeof entry === 'string' ? entry.trim() : '')
            .filter(Boolean)
            .slice(0, 64);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string') return value.trim().slice(0, 128);
    return null;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeMetadataString(value: unknown, maxLength = 128): string | null {
    return typeof value === 'string' && value.trim()
        ? value.trim().slice(0, maxLength)
        : null;
}

function extractInteractionResultMetadata(value: unknown): InitialDraftInteractionResultMetadata | null {
    const metadata = normalizeRecord(value);
    if (!metadata) return null;
    const resultPayload = normalizeRecord(metadata.resultPayload);
    const result = {
        anchorEnvelopeId: normalizeMetadataString(metadata.anchorEnvelopeId),
        reasonCode: normalizeMetadataString(metadata.reasonCode),
        aiTreatment: normalizeMetadataString(resultPayload?.aiTreatment),
        winningOptionId: normalizeMetadataString(resultPayload?.winningOptionId),
    };
    return Object.values(result).some(Boolean) ? result : null;
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function buildSourceMetadataDigest(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rawRecord = value as Record<string, unknown>;
    const bounded: Record<string, unknown> = {};
    for (const key of DRAFT_SOURCE_METADATA_DIGEST_KEYS) {
        if (!(key in rawRecord)) continue;
        const normalized = normalizeDigestMetadataValue(rawRecord[key]);
        if (normalized === null || (Array.isArray(normalized) && normalized.length === 0)) continue;
        bounded[key] = normalized;
    }
    const interactionResult = extractInteractionResultMetadata(value);
    if (interactionResult) bounded.interactionResult = interactionResult;
    if (Object.keys(bounded).length === 0) return null;
    return crypto.createHash('sha256').update(stableStringify(bounded)).digest('hex');
}

function toBigInt(value: bigint | number | string): bigint {
    try {
        return BigInt(value);
    } catch {
        return BigInt(0);
    }
}

function validateRequiredSourceRow(row: SourceMessageRow): string | null {
    if (!row.envelopeId?.trim()) return 'missing_envelope_id';
    if (!row.senderPubkey?.trim()) return 'missing_sender_pubkey';
    if (!normalizeMultilineText(row.payloadText)) return 'missing_payload_text';
    if (!row.payloadHash?.trim()) return 'missing_payload_hash';
    if (!row.createdAt) return 'missing_created_at';
    return null;
}

function normalizeSourceRow(row: SourceMessageRow): InitialDraftSourceMessage {
    const requiredError = validateRequiredSourceRow(row);
    if (requiredError) {
        throw new DiscussionInitialDraftError({
            code: 'source_messages_invalid',
            message: `source message ${row.envelopeId || 'unknown'} is invalid: ${requiredError}`,
            diagnostics: {
                envelopeId: row.envelopeId || null,
                reason: requiredError,
            },
        });
    }

    const relevanceStatus = String(row.relevanceStatus || 'ready').trim().toLowerCase();
    if (relevanceStatus !== 'ready') {
        throw new DiscussionInitialDraftError({
            code: 'source_messages_not_ready',
            message: `source message ${row.envelopeId} is not ready for draft generation`,
            diagnostics: {
                envelopeId: row.envelopeId,
                relevanceStatus,
            },
        });
    }

    const relevanceScore = 1;
    const semanticScore = normalizeScore(row.semanticScore, relevanceScore);
    const focusScore = normalizeScore(row.focusScore, semanticScore);

    return {
        envelopeId: row.envelopeId.trim(),
        senderPubkey: row.senderPubkey.trim(),
        senderHandle: typeof row.senderHandle === 'string' && row.senderHandle.trim()
            ? row.senderHandle.trim()
            : null,
        messageKind: normalizeMessageKind(row.messageKind),
        metadataDigest: buildSourceMetadataDigest(row.metadata),
        interactionResult: extractInteractionResultMetadata(row.metadata),
        payloadText: normalizeMultilineText(row.payloadText),
        payloadHash: row.payloadHash.trim(),
        lamport: toBigInt(row.lamport),
        createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
        relevanceStatus: 'ready',
        semanticScore,
        focusScore,
        qualityScore: normalizeScore(row.qualityScore, 0.5),
        spamScore: normalizeScore(row.spamScore, 0),
        decisionConfidence: normalizeScore(row.decisionConfidence, 0.5),
        relevanceMethod: typeof row.relevanceMethod === 'string' && row.relevanceMethod.trim()
            ? row.relevanceMethod.trim()
            : 'rule',
        semanticFacets: normalizeSemanticFacets(row.semanticFacets),
        authorAnnotations: normalizeAuthorAnnotations(row.authorAnnotations),
    };
}

export function buildInitialDraftSourceDigest(input: {
    circleName: string;
    circleDescription?: string | null;
    messages: InitialDraftSourceMessage[];
}): string {
    return buildAiSourceDigest({
        circleName: input.circleName || null,
        circleDescription: input.circleDescription || null,
        messages: input.messages.map((message) => ({
            envelopeId: message.envelopeId,
            payloadHash: message.payloadHash,
            lamport: message.lamport.toString(),
            senderPubkey: message.senderPubkey,
            messageKind: message.messageKind,
            metadataDigest: message.metadataDigest,
            interactionResult: message.interactionResult,
            createdAt: message.createdAt.toISOString(),
            semanticScore: Number(message.semanticScore.toFixed(4)),
            focusScore: Number(message.focusScore.toFixed(4)),
            semanticFacets: message.semanticFacets,
            authorAnnotations: message.authorAnnotations,
        })),
    });
}

export async function loadInitialDraftSourceMessages(
    prisma: PrismaLike,
    input: { circleId: number; sourceMessageIds: string[] },
): Promise<InitialDraftSourceMessage[]> {
    const sourceMessageIds = normalizeSourceMessageIds(input.sourceMessageIds);
    if (sourceMessageIds.length === 0) {
        throw new DiscussionInitialDraftError({
            code: 'source_messages_missing',
            message: 'initial draft generation requires source messages',
            diagnostics: { sourceMessageIds },
        });
    }

    const rows = await prisma.$queryRaw<SourceMessageRow[]>(Prisma.sql`
        SELECT
            envelope_id AS "envelopeId",
            sender_pubkey AS "senderPubkey",
            sender_handle AS "senderHandle",
            message_kind AS "messageKind",
            metadata AS "metadata",
            payload_text AS "payloadText",
            payload_hash AS "payloadHash",
            lamport,
            created_at AS "createdAt",
            relevance_status AS "relevanceStatus",
            semantic_score AS "semanticScore",
            focus_score AS "focusScore",
            quality_score AS "qualityScore",
            spam_score AS "spamScore",
            decision_confidence AS "decisionConfidence",
            relevance_method AS "relevanceMethod",
            semantic_facets AS "semanticFacets",
            author_annotations AS "authorAnnotations"
        FROM circle_discussion_messages
        WHERE circle_id = ${input.circleId}
          AND envelope_id IN (${Prisma.join(sourceMessageIds)})
          AND deleted = FALSE
          AND tombstoned_at IS NULL
          AND is_ephemeral = FALSE
          AND message_kind NOT IN (${Prisma.join([...DISCUSSION_DRAFT_SOURCE_EXCLUDED_MESSAGE_KINDS])})
    `);

    const byEnvelopeId = new Map<string, SourceMessageRow>();
    for (const row of rows) {
        byEnvelopeId.set(row.envelopeId, row);
    }

    const missing = sourceMessageIds.filter((envelopeId) => !byEnvelopeId.has(envelopeId));
    if (missing.length > 0) {
        throw new DiscussionInitialDraftError({
            code: 'source_messages_missing',
            message: 'one or more source messages are missing or invalid',
            diagnostics: { missingSourceMessageIds: missing },
        });
    }

    const messages = sourceMessageIds.map((envelopeId) => normalizeSourceRow(byEnvelopeId.get(envelopeId)!));
    await enforceChallengeTrustSourceGate(prisma, {
        circleId: input.circleId,
        sourceMessageIds,
        messages,
    });
    return messages;
}

function validateProvidedInitialDraftSourceMessages(
    messages: InitialDraftSourceMessage[],
    requestedSourceMessageIds: string[],
): InitialDraftSourceMessage[] {
    const requestedIds = normalizeSourceMessageIds(requestedSourceMessageIds);
    if (requestedIds.length === 0 || messages.length !== requestedIds.length) {
        throw new DiscussionInitialDraftError({
            code: 'source_messages_missing',
            message: 'provided source messages do not match the requested source ids',
            retryable: false,
            diagnostics: {
                requestedSourceMessageIds: requestedIds,
                providedSourceMessageIds: messages.map((message) => message.envelopeId),
            },
        });
    }
    const byEnvelopeId = new Map(messages.map((message) => [message.envelopeId, message]));
    if (byEnvelopeId.size !== messages.length || requestedIds.some((id) => !byEnvelopeId.has(id))) {
        throw new DiscussionInitialDraftError({
            code: 'source_messages_invalid',
            message: 'provided source messages contain missing or duplicate ids',
            retryable: false,
        });
    }
    return requestedIds.map((id) => {
        const message = byEnvelopeId.get(id)!;
        if (
            !message.senderPubkey?.trim()
            || !normalizeMultilineText(message.payloadText)
            || !/^[a-f0-9]{64}$/i.test(message.payloadHash)
            || !(message.createdAt instanceof Date)
            || Number.isNaN(message.createdAt.getTime())
            || message.relevanceStatus !== 'ready'
        ) {
            throw new DiscussionInitialDraftError({
                code: 'source_messages_invalid',
                message: `provided source message ${id} is invalid`,
                retryable: false,
                diagnostics: { envelopeId: id },
            });
        }
        return message;
    });
}

async function enforceChallengeTrustSourceGate(
    prisma: PrismaLike,
    input: {
        circleId: number;
        sourceMessageIds: string[];
        messages: InitialDraftSourceMessage[];
    },
): Promise<void> {
    const selectedIds = new Set(input.sourceMessageIds);
    const candidateAnchorIds = input.messages
        .filter((message) => message.messageKind !== 'interaction_result_notice')
        .map((message) => message.envelopeId);
    if (candidateAnchorIds.length === 0) return;

    const noticeRows = await prisma.$queryRaw<SourceMessageRow[]>(Prisma.sql`
        SELECT
            envelope_id AS "envelopeId",
            sender_pubkey AS "senderPubkey",
            sender_handle AS "senderHandle",
            message_kind AS "messageKind",
            metadata AS "metadata",
            payload_text AS "payloadText",
            payload_hash AS "payloadHash",
            lamport,
            created_at AS "createdAt",
            relevance_status AS "relevanceStatus",
            semantic_score AS "semanticScore",
            focus_score AS "focusScore",
            quality_score AS "qualityScore",
            spam_score AS "spamScore",
            decision_confidence AS "decisionConfidence",
            relevance_method AS "relevanceMethod",
            semantic_facets AS "semanticFacets",
            author_annotations AS "authorAnnotations"
        FROM circle_discussion_messages
        WHERE circle_id = ${input.circleId}
          AND subject_type = 'discussion_message'
          AND subject_id IN (${Prisma.join(candidateAnchorIds)})
          AND deleted = FALSE
          AND tombstoned_at IS NULL
          AND is_ephemeral = FALSE
          AND message_kind = 'interaction_result_notice'
    `);

    const rows = Array.isArray(noticeRows) ? noticeRows : [];
    for (const row of rows) {
        const notice = normalizeSourceRow(row);
        const result = notice.interactionResult;
        if (
            result?.anchorEnvelopeId
            && candidateAnchorIds.includes(result.anchorEnvelopeId)
            && result.aiTreatment === 'withhold_trust'
            && !selectedIds.has(notice.envelopeId)
        ) {
            throw new DiscussionInitialDraftError({
                code: 'source_message_withheld_by_challenge',
                message: 'source message has a withhold-trust challenge result notice that must be selected with the source',
                retryable: false,
                diagnostics: {
                    anchorEnvelopeId: result.anchorEnvelopeId,
                    noticeEnvelopeId: notice.envelopeId,
                    reasonCode: result.reasonCode,
                },
            });
        }
    }
}

function buildInitialDraftPrompt(input: {
    circleName: string;
    circleDescription?: string | null;
    sourceMessages: InitialDraftSourceMessage[];
}): string {
    const context = input.circleDescription?.trim()
        ? `${input.circleName} (${input.circleDescription.trim()})`
        : input.circleName;
    const messages = input.sourceMessages.map((message, index) => {
        const sender = message.senderHandle || 'A member';
        const facets = message.semanticFacets.length > 0
            ? ` facets=${message.semanticFacets.join(',')}`
            : '';
        const metadataLines = [
            `metadataDigest: ${message.metadataDigest || 'none'}`,
        ];
        if (message.interactionResult) {
            if (message.interactionResult.anchorEnvelopeId) {
                metadataLines.push(`anchorEnvelopeId: ${message.interactionResult.anchorEnvelopeId}`);
            }
            if (message.interactionResult.reasonCode) {
                metadataLines.push(`reasonCode: ${message.interactionResult.reasonCode}`);
            }
            if (message.interactionResult.aiTreatment) {
                metadataLines.push(`aiTreatment: ${message.interactionResult.aiTreatment}`);
            }
            if (message.interactionResult.winningOptionId) {
                metadataLines.push(`winningOptionId: ${message.interactionResult.winningOptionId}`);
            }
        }
        return [
            `Message ${index + 1}`,
            `id: ${message.envelopeId}`,
            `kind: ${message.messageKind}`,
            `time: ${message.createdAt.toISOString()}`,
            `sender: ${sender}`,
            `focus: ${message.focusScore.toFixed(2)}${facets}`,
            ...metadataLines,
            `text: ${message.payloadText}`,
        ].join('\n');
    });

    return [
        `Circle: ${context}`,
        'Source messages:',
        messages.join('\n\n'),
    ].join('\n\n');
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
    const candidates: string[] = [];
    const push = (value: string) => {
        const trimmed = value.trim();
        if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
    };

    push(raw);
    const afterThink = raw.includes('</think>')
        ? raw.slice(raw.lastIndexOf('</think>') + '</think>'.length)
        : raw;
    push(afterThink);

    const fencedJsonPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    for (const match of afterThink.matchAll(fencedJsonPattern)) {
        push(match[1] || '');
    }

    const firstBrace = afterThink.indexOf('{');
    const lastBrace = afterThink.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        push(afterThink.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Try the next candidate.
        }
    }
    return null;
}

function normalizeSections(value: unknown): Array<{ heading: string; body: string }> {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
            const record = item as Record<string, unknown>;
            const heading = normalizeText(String(record.heading || ''));
            const body = normalizeMultilineText(String(record.body || ''));
            if (!heading || !body) return null;
            return { heading, body };
        })
        .filter((item): item is { heading: string; body: string } => Boolean(item));
}

function renderDraftText(input: {
    title: string;
    sections: Array<{ heading: string; body: string }>;
}): string {
    const blocks = [`# ${input.title}`];
    for (const section of input.sections) {
        blocks.push(`## ${section.heading}`, section.body);
    }
    return blocks.join('\n\n');
}

function normalizeGeneratedDraft(raw: string): {
    title: string;
    sections: Array<{ heading: string; body: string }>;
    draftText: string;
} | null {
    const parsed = tryParseJsonObject(raw);
    if (!parsed) return null;
    const title = normalizeText(String(parsed.title || ''));
    const sections = normalizeSections(parsed.sections);
    if (!title || sections.length === 0) return null;
    return {
        title,
        sections,
        draftText: renderDraftText({ title, sections }),
    };
}

function buildMetadata(input: {
    providerMode: string;
    model: string;
    sourceDigest: string;
    prompt: ResolvedCircleDraftPrompt;
}): AiGenerationMetadata {
    const prompt = getPromptMetadata('discussion-initial-draft');
    return {
        providerMode: input.providerMode,
        model: input.model,
        promptAsset: prompt.promptAsset,
        promptVersion: input.prompt.promptVersion,
        sourceDigest: input.sourceDigest,
        promptScope: input.prompt.scope,
        promptMode: input.prompt.mode,
        systemPromptVersion: input.prompt.systemPromptVersion,
        schemaRef: input.prompt.schemaRef,
        ...(input.prompt.circlePromptVersionId
            ? { circlePromptVersionId: input.prompt.circlePromptVersionId }
            : {}),
        ...(input.prompt.circlePromptVersion
            ? { circlePromptVersion: input.prompt.circlePromptVersion }
            : {}),
        ...(input.prompt.circlePromptDigest
            ? { circlePromptDigest: input.prompt.circlePromptDigest }
            : {}),
        ...(input.prompt.approvalRef ? { approvalRef: input.prompt.approvalRef } : {}),
        ...(input.prompt.selectionApprovalRef
            ? { selectionApprovalRef: input.prompt.selectionApprovalRef }
            : {}),
    };
}

function getProviderErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null;
    const code = (error as Record<string, unknown>).code;
    return typeof code === 'string' && code.trim() ? code.trim() : null;
}

function isInitialDraftGenerationTimeout(error: unknown): boolean {
    if (getProviderErrorCode(error) === 'provider_timeout') return true;
    const name = error && typeof error === 'object'
        ? (error as Record<string, unknown>).name
        : null;
    if (name === 'AbortError') return true;
    const message = error instanceof Error ? error.message : String(error || '');
    return /\b(timeout|timed out|aborted)\b/i.test(message);
}

export async function generateInitialDiscussionDraft(
    prisma: PrismaLike,
    input: GenerateInitialDiscussionDraftInput,
): Promise<GenerateInitialDiscussionDraftResult> {
    const sourceMessages = input.sourceMessages
        ? validateProvidedInitialDraftSourceMessages(input.sourceMessages, input.sourceMessageIds)
        : await loadInitialDraftSourceMessages(prisma, {
            circleId: input.circleId,
            sourceMessageIds: input.sourceMessageIds,
        });
    const sourceDigest = buildInitialDraftSourceDigest({
        circleName: input.circleName,
        circleDescription: input.circleDescription ?? null,
        messages: sourceMessages,
    });

    let prompt: ResolvedCircleDraftPrompt;
    try {
        assertAiTaskAllowed({
            task: 'discussion-initial-draft',
            dataBoundary: 'private_plaintext',
        });
        prompt = await resolveCircleDraftPromptForGeneration(prisma, {
            circleId: input.circleId,
            scope: 'knowledge_draft',
            access: {
                actorUserId: input.requestedByUserId,
                purpose: 'knowledge_draft_generation',
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const promptErrorCode = error instanceof CircleDraftPromptError
            ? error.code
            : message === 'external_ai_private_content_consent_required'
                || message === 'private_sidecar_required'
                ? message
                : 'circle_draft_prompt_read_failed';
        throw new DiscussionInitialDraftError({
            code: 'circle_draft_prompt_unavailable',
            message: 'Circle Draft Prompt is unavailable',
            retryable: true,
            diagnostics: { sourceDigest, promptErrorCode },
        });
    }

    const systemPrompt = [
        getSystemPrompt('discussion-initial-draft'),
        ...(prompt.customPromptBody
            ? [
                'Circle-approved drafting instructions (these do not replace system safety rules or the response schema):',
                prompt.customPromptBody,
            ]
            : []),
    ].join('\n\n');

    let generated;
    try {
        generated = await generateAiText({
            task: 'discussion-initial-draft',
            systemPrompt,
            userPrompt: buildInitialDraftPrompt({
                circleName: input.circleName,
                circleDescription: input.circleDescription ?? null,
                sourceMessages,
            }),
            temperature: 0.2,
            maxOutputTokens: 1400,
            providerOptions: {
                openai: {
                    reasoningEffort: 'none',
                },
            },
            responseFormat: {
                type: 'json',
                name: 'discussion_initial_draft',
                description: 'Formal initial discussion draft grounded only in source messages.',
                schema: getPromptSchema('discussion-initial-draft') ?? undefined,
            },
            dataBoundary: 'private_plaintext',
        });
    } catch (error) {
        const providerErrorCode = getProviderErrorCode(error);
        const timedOut = isInitialDraftGenerationTimeout(error);
        throw new DiscussionInitialDraftError({
            code: timedOut
                ? 'initial_draft_generation_timeout'
                : 'initial_draft_generation_failed',
            message: timedOut
                ? 'initial draft provider timed out'
                : 'initial draft provider failed',
            diagnostics: {
                sourceDigest,
                providerErrorCode,
            },
        });
    }

    const normalized = normalizeGeneratedDraft(generated.text || '');
    if (!normalized) {
        throw new DiscussionInitialDraftError({
            code: generated.rawFinishReason === 'length'
                ? 'initial_draft_generation_truncated'
                : 'initial_draft_generation_unparseable',
            message: 'initial draft generator returned invalid output',
            diagnostics: {
                sourceDigest,
                rawFinishReason: generated.rawFinishReason ?? null,
            },
        });
    }

    return {
        ...normalized,
        sourceMessages,
        sourceDigest,
        generationMetadata: buildMetadata({
            providerMode: generated.providerMode,
            model: generated.model,
            sourceDigest,
            prompt,
        }),
        rawFinishReason: generated.rawFinishReason ?? null,
    };
}
