import { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    buildDiscussionSummaryCacheKey,
} from './summaryCache';
import {
    buildDiscussionSummarySourceDigest,
    type DiscussionSummaryFallbackDiagnostics,
    type DiscussionSummaryInput,
    type DiscussionSummaryMessage,
    type DiscussionSummaryResult,
} from '../../ai/discussion-summary';

interface DiscussionSummaryRow {
    payloadText: string;
    senderPubkey: string;
    senderHandle: string | null;
    createdAt: Date;
    relevanceScore: Prisma.Decimal | number | string | null;
    semanticScore: Prisma.Decimal | number | string | null;
    focusScore: Prisma.Decimal | number | string | null;
    semanticFacets: Prisma.JsonValue | null;
}

export interface DiscussionSummaryDiagnosticsMessage {
    senderHandle: string | null;
    senderPubkey: string;
    text: string;
    createdAt: string;
    relevanceScore: number | null;
    focusScore: number | null;
    semanticFacets: string[];
}

export interface DiscussionSummaryDiagnosticsRecord {
    scope: 'circle-scoped';
    circleId: number;
    summary: string;
    method: 'rule' | 'llm';
    messageCount: number;
    windowSize: number;
    configSource: 'circle' | 'global_default';
    config: {
        summaryUseLLM: boolean;
    };
    currentConfigSource: 'circle' | 'global_default';
    currentConfig: {
        summaryUseLLM: boolean;
    };
    generationMetadata: DiscussionSummaryResult['generationMetadata'] | null;
    generatedAt: string | null;
    fromCache: boolean;
    fallbackDiagnostics: DiscussionSummaryFallbackDiagnostics | null;
    sourceMessages: DiscussionSummaryDiagnosticsMessage[];
    windowDigest: string;
    inputFidelity: 'exact_cached_window' | 'metadata_only';
    cachedSourceDigest: string | null;
}

function normalizeText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

function toNumberOrNull(value: Prisma.Decimal | number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length > 0);
}

function mapRowToDiagnosticsMessage(row: DiscussionSummaryRow): DiscussionSummaryDiagnosticsMessage | null {
    const text = normalizeText(row.payloadText);
    if (!text) return null;
    return {
        senderHandle: row.senderHandle,
        senderPubkey: row.senderPubkey,
        text,
        createdAt: row.createdAt.toISOString(),
        relevanceScore: toNumberOrNull(row.semanticScore ?? row.relevanceScore),
        focusScore: toNumberOrNull(row.focusScore ?? row.semanticScore ?? row.relevanceScore),
        semanticFacets: toStringArray(row.semanticFacets),
    };
}

function toSummaryInputMessages(messages: DiscussionSummaryDiagnosticsMessage[]): DiscussionSummaryMessage[] {
    return messages.map((message) => ({
        senderHandle: message.senderHandle,
        senderPubkey: message.senderPubkey,
        text: message.text,
        createdAt: new Date(message.createdAt),
        relevanceScore: message.relevanceScore,
        focusScore: message.focusScore,
        semanticFacets: message.semanticFacets,
    }));
}

function normalizeConfigSource(value: unknown, fallback: 'circle' | 'global_default'): 'circle' | 'global_default' {
    return value === 'circle' || value === 'global_default' ? value : fallback;
}

function normalizeSummaryUseLlm(
    value: unknown,
    fallback: boolean,
): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

async function loadCurrentWindow(input: {
    prisma: PrismaClient;
    circleId: number;
    windowSize: number;
}): Promise<{
    circleName: string | null;
    circleDescription: string | null;
    sourceMessages: DiscussionSummaryDiagnosticsMessage[];
    windowDigest: string;
}> {
    const [circle, rows] = await Promise.all([
        input.prisma.circle.findUnique({
            where: { id: input.circleId },
            select: { name: true, description: true },
        }),
        input.prisma.$queryRaw<DiscussionSummaryRow[]>(Prisma.sql`
            SELECT
                payload_text AS "payloadText",
                sender_pubkey AS "senderPubkey",
                sender_handle AS "senderHandle",
                created_at AS "createdAt",
                relevance_score AS "relevanceScore",
                semantic_score AS "semanticScore",
                focus_score AS "focusScore",
                semantic_facets AS "semanticFacets"
            FROM circle_discussion_messages
            WHERE circle_id = ${input.circleId}
              AND subject_type IS NULL
              AND subject_id IS NULL
              AND deleted = FALSE
              AND COALESCE(relevance_status, 'ready') = 'ready'
            ORDER BY lamport DESC
            LIMIT ${input.windowSize}
        `),
    ]);

    const sourceMessages = rows
        .slice()
        .reverse()
        .map(mapRowToDiagnosticsMessage)
        .filter((message): message is DiscussionSummaryDiagnosticsMessage => Boolean(message));

    const windowDigest = buildDiscussionSummarySourceDigest({
        circleName: circle?.name || null,
        circleDescription: circle?.description || null,
        messages: toSummaryInputMessages(sourceMessages),
    });

    return {
        circleName: circle?.name || null,
        circleDescription: circle?.description || null,
        sourceMessages,
        windowDigest,
    };
}

export async function loadDiscussionSummaryDiagnostics(
    prisma: PrismaClient,
    redis: Redis,
    circleId: number,
    input: {
        force?: boolean;
        windowSize: number;
        cacheTtlSec: number;
        summaryUseLLM: boolean;
        configSource: 'circle' | 'global_default';
        summarizeMessages: (input: DiscussionSummaryInput) => Promise<DiscussionSummaryResult>;
    },
): Promise<DiscussionSummaryDiagnosticsRecord> {
    const force = Boolean(input.force);
    const cacheKey = buildDiscussionSummaryCacheKey(circleId);

    if (!force && input.cacheTtlSec > 0) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached) as Partial<DiscussionSummaryDiagnosticsRecord> & {
                    generationMetadata?: DiscussionSummaryResult['generationMetadata'] | null;
                    summary?: string;
                    method?: 'rule' | 'llm';
                    messageCount?: number;
                    generatedAt?: string | null;
                    fallbackDiagnostics?: DiscussionSummaryFallbackDiagnostics | null;
                    sourceMessages?: DiscussionSummaryDiagnosticsMessage[];
                    windowDigest?: string;
                    inputFidelity?: 'exact_cached_window' | 'metadata_only';
                    cachedSourceDigest?: string | null;
                    config?: {
                        summaryUseLLM?: boolean;
                    } | null;
                    configSource?: 'circle' | 'global_default';
                };
                const cachedConfigSource = normalizeConfigSource(parsed.configSource, input.configSource);
                const cachedSummaryUseLLM = normalizeSummaryUseLlm(
                    parsed.config?.summaryUseLLM,
                    input.summaryUseLLM,
                );

                const hasExactCachedWindow = Array.isArray(parsed.sourceMessages)
                    && parsed.sourceMessages.every((message) => typeof message?.text === 'string')
                    && typeof parsed.windowDigest === 'string'
                    && parsed.windowDigest.length > 0;

                if (hasExactCachedWindow) {
                    return {
                        scope: 'circle-scoped',
                        circleId,
                        summary: String(parsed.summary || ''),
                        method: parsed.method === 'rule' ? 'rule' : 'llm',
                        messageCount: Number(parsed.messageCount || 0),
                        windowSize: input.windowSize,
                        configSource: cachedConfigSource,
                        config: {
                            summaryUseLLM: cachedSummaryUseLLM,
                        },
                        currentConfigSource: input.configSource,
                        currentConfig: {
                            summaryUseLLM: input.summaryUseLLM,
                        },
                        generationMetadata: parsed.generationMetadata || null,
                        generatedAt: parsed.generatedAt || null,
                        fromCache: true,
                        fallbackDiagnostics: parsed.fallbackDiagnostics || null,
                        sourceMessages: parsed.sourceMessages || [],
                        windowDigest: parsed.windowDigest!,
                        inputFidelity: parsed.inputFidelity || 'exact_cached_window',
                        cachedSourceDigest:
                            parsed.cachedSourceDigest
                            ?? parsed.generationMetadata?.sourceDigest
                            ?? null,
                    };
                }

                const currentWindow = await loadCurrentWindow({
                    prisma,
                    circleId,
                    windowSize: input.windowSize,
                });

                return {
                    scope: 'circle-scoped',
                    circleId,
                    summary: String(parsed.summary || ''),
                    method: parsed.method === 'rule' ? 'rule' : 'llm',
                    messageCount: Number(parsed.messageCount || currentWindow.sourceMessages.length || 0),
                    windowSize: input.windowSize,
                    configSource: cachedConfigSource,
                    config: {
                        summaryUseLLM: cachedSummaryUseLLM,
                    },
                    currentConfigSource: input.configSource,
                    currentConfig: {
                        summaryUseLLM: input.summaryUseLLM,
                    },
                    generationMetadata: parsed.generationMetadata || null,
                    generatedAt: parsed.generatedAt || null,
                    fromCache: true,
                    fallbackDiagnostics: parsed.fallbackDiagnostics || null,
                    sourceMessages: currentWindow.sourceMessages,
                    windowDigest: currentWindow.windowDigest,
                    inputFidelity: 'metadata_only',
                    cachedSourceDigest: parsed.generationMetadata?.sourceDigest || null,
                };
            }
        } catch {
            // ignore cache read failures
        }
    }

    const currentWindow = await loadCurrentWindow({
        prisma,
        circleId,
        windowSize: input.windowSize,
    });
    const summary = await input.summarizeMessages({
        circleName: currentWindow.circleName,
        circleDescription: currentWindow.circleDescription,
        useLLM: input.summaryUseLLM,
        messages: toSummaryInputMessages(currentWindow.sourceMessages),
    });

    const payload: DiscussionSummaryDiagnosticsRecord = {
        scope: 'circle-scoped',
        circleId,
        summary: summary.summary,
        method: summary.method,
        messageCount: summary.messageCount,
        windowSize: input.windowSize,
        configSource: input.configSource,
        config: {
            summaryUseLLM: input.summaryUseLLM,
        },
        currentConfigSource: input.configSource,
        currentConfig: {
            summaryUseLLM: input.summaryUseLLM,
        },
        generationMetadata: summary.generationMetadata,
        generatedAt: summary.generatedAt.toISOString(),
        fromCache: false,
        fallbackDiagnostics: summary.fallbackDiagnostics,
        sourceMessages: currentWindow.sourceMessages,
        windowDigest: currentWindow.windowDigest,
        inputFidelity: 'exact_cached_window',
        cachedSourceDigest: summary.generationMetadata?.sourceDigest || null,
    };

    if (input.cacheTtlSec > 0) {
        try {
            await redis.setex(cacheKey, input.cacheTtlSec, JSON.stringify(payload));
        } catch {
            // ignore cache write failures
        }
    }

    return payload;
}
