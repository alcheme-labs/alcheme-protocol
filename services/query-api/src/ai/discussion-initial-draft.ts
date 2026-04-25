import { Prisma, type PrismaClient } from '@prisma/client';

import { buildAiSourceDigest, type AiGenerationMetadata } from './metadata';
import { generateAiText } from './provider';
import { getPromptMetadata, getPromptSchema, getSystemPrompt } from './prompts/registry';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type AuthorAnnotationKind,
    type SemanticFacet,
} from '../services/discussion/analysis/types';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface SourceMessageRow {
    envelopeId: string;
    senderPubkey: string;
    senderHandle: string | null;
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

export interface InitialDraftSourceMessage {
    envelopeId: string;
    senderPubkey: string;
    senderHandle: string | null;
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

export interface GenerateInitialDiscussionDraftInput {
    circleId: number;
    circleName: string;
    circleDescription?: string | null;
    sourceMessageIds: string[];
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
          AND message_kind NOT IN ('draft_candidate_notice', 'governance_notice')
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

    return sourceMessageIds.map((envelopeId) => normalizeSourceRow(byEnvelopeId.get(envelopeId)!));
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
        const sender = message.senderHandle || message.senderPubkey;
        const facets = message.semanticFacets.length > 0
            ? ` facets=${message.semanticFacets.join(',')}`
            : '';
        return [
            `Message ${index + 1}`,
            `id: ${message.envelopeId}`,
            `time: ${message.createdAt.toISOString()}`,
            `sender: ${sender}`,
            `focus: ${message.focusScore.toFixed(2)}${facets}`,
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
}): AiGenerationMetadata {
    const prompt = getPromptMetadata('discussion-initial-draft');
    return {
        providerMode: input.providerMode,
        model: input.model,
        promptAsset: prompt.promptAsset,
        promptVersion: prompt.promptVersion,
        sourceDigest: input.sourceDigest,
    };
}

export async function generateInitialDiscussionDraft(
    prisma: PrismaLike,
    input: GenerateInitialDiscussionDraftInput,
): Promise<GenerateInitialDiscussionDraftResult> {
    const sourceMessages = await loadInitialDraftSourceMessages(prisma, {
        circleId: input.circleId,
        sourceMessageIds: input.sourceMessageIds,
    });
    const sourceDigest = buildInitialDraftSourceDigest({
        circleName: input.circleName,
        circleDescription: input.circleDescription ?? null,
        messages: sourceMessages,
    });

    let generated;
    try {
        generated = await generateAiText({
            task: 'discussion-initial-draft',
            systemPrompt: getSystemPrompt('discussion-initial-draft'),
            userPrompt: buildInitialDraftPrompt({
                circleName: input.circleName,
                circleDescription: input.circleDescription ?? null,
                sourceMessages,
            }),
            temperature: 0.2,
            maxOutputTokens: 1400,
            responseFormat: {
                type: 'json',
                name: 'discussion_initial_draft',
                description: 'Formal initial discussion draft grounded only in source messages.',
                schema: getPromptSchema('discussion-initial-draft') ?? undefined,
            },
            dataBoundary: 'private_plaintext',
        });
    } catch (error) {
        throw new DiscussionInitialDraftError({
            code: 'initial_draft_generation_failed',
            message: error instanceof Error ? error.message : String(error || ''),
            diagnostics: {
                sourceDigest,
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
                rawResponseSnippet: normalizeMultilineText(generated.text || '').slice(0, 600) || null,
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
        }),
        rawFinishReason: generated.rawFinishReason ?? null,
    };
}
