import crypto from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

import { getPromptMetadata } from '../../ai/prompts/registry';
import type { GhostDraftContext } from '../../ai/prompt-templates';

export interface GhostDraftProvenanceView {
    origin: 'ai';
    providerMode: string;
    model: string;
    promptAsset: string;
    promptVersion: string;
    sourceDigest: string;
    ghostRunId: number | null;
}

export interface GhostDraftResultView {
    generationId: number;
    postId: number;
    draftText: string;
    suggestions: GhostDraftSuggestionView[];
    model: string;
    generatedAt: Date;
    provenance: GhostDraftProvenanceView;
}

export interface GhostDraftSuggestionView {
    suggestionId: string;
    targetType: 'paragraph' | 'structure' | 'document';
    targetRef: string;
    threadIds: string[];
    issueTypes: string[];
    summary: string;
    suggestedText: string;
}

export interface GhostDraftAcceptanceView {
    generation: GhostDraftResultView;
    applied: boolean;
    changed: boolean;
    acceptanceId: number | null;
    acceptanceMode: string | null;
    acceptedAt: Date | null;
    acceptedByUserId: number | null;
    acceptedSuggestion: GhostDraftSuggestionView | null;
    acceptedThreadIds: string[];
    workingCopyContent: string;
    workingCopyHash: string;
    updatedAt: Date;
    heatScore: number;
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;
const GHOST_DRAFT_PRIMARY_TEXT_KEYS = [
    'draftText',
    'draft_text',
    'draft',
    'reply',
    'comment',
    'summary',
    'text',
] as const;
const GHOST_DRAFT_SUGGESTED_TEXT_KEYS = [
    'suggestedText',
    'suggested_text',
    ...GHOST_DRAFT_PRIMARY_TEXT_KEYS,
] as const;

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `"${key}":${stableStringify(nested)}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

export function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeMultilineText(input: string): string {
    return input
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');
}

function collectGhostDraftPayloadCandidates(raw: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (candidate: string) => {
        const trimmed = candidate.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        candidates.push(trimmed);
    };

    const trimmed = raw.trim();
    pushCandidate(trimmed);

    const afterThink = trimmed.includes('</think>')
        ? trimmed.slice(trimmed.lastIndexOf('</think>') + '</think>'.length)
        : trimmed;
    pushCandidate(afterThink);

    const fencedJsonPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    for (const match of afterThink.matchAll(fencedJsonPattern)) {
        pushCandidate(match[1] || '');
    }

    const firstBrace = afterThink.indexOf('{');
    const lastBrace = afterThink.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        pushCandidate(afterThink.slice(firstBrace, lastBrace + 1));
    }

    return candidates;
}

function tryParseGhostDraftJson(raw: string): Record<string, unknown> | null {
    for (const candidate of collectGhostDraftPayloadCandidates(raw)) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Ignore malformed candidates and continue probing.
        }
    }

    return null;
}

function decodeJsonLikeString(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 2) return trimmed;
    const quote = trimmed[0];
    if ((quote !== '"' && quote !== '\'') || trimmed[trimmed.length - 1] !== quote) {
        return trimmed;
    }

    let inner = trimmed.slice(1, -1);
    inner = inner.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)));
    inner = inner.replace(/\\([\\/"'bfnrt])/g, (_match, escape: string) => {
        switch (escape) {
        case 'b':
            return '\b';
        case 'f':
            return '\f';
        case 'n':
            return '\n';
        case 'r':
            return '\r';
        case 't':
            return '\t';
        default:
            return escape;
        }
    });
    return inner;
}

function decodeJsonLikeFragment(value: string): string {
    let normalized = value.trim();
    normalized = normalized.replace(/[,\s]*[}\]]\s*$/g, '').trim();
    normalized = normalized.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)));
    normalized = normalized.replace(/\\([\\/"'bfnrt])/g, (_match, escape: string) => {
        switch (escape) {
        case 'b':
            return '\b';
        case 'f':
            return '\f';
        case 'n':
            return '\n';
        case 'r':
            return '\r';
        case 't':
            return '\t';
        default:
            return escape;
        }
    });
    return normalized;
}

function tryExtractGhostDraftJsonLikeText(raw: string): string | null {
    for (const candidate of collectGhostDraftPayloadCandidates(raw)) {
        for (const key of GHOST_DRAFT_PRIMARY_TEXT_KEYS) {
            const closedPattern = new RegExp(
                `["']?${escapeRegExp(key)}["']?\\s*:\\s*(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')`,
                'i',
            );
            const closedMatch = candidate.match(closedPattern);
            if (closedMatch?.[1]) {
                return normalizeMultilineText(decodeJsonLikeString(closedMatch[1]));
            }

            const openPattern = new RegExp(
                `["']?${escapeRegExp(key)}["']?\\s*:\\s*(["'])([\\s\\S]*)$`,
                'i',
            );
            const openMatch = candidate.match(openPattern);
            if (openMatch?.[2]) {
                return normalizeMultilineText(decodeJsonLikeFragment(openMatch[2]));
            }
        }
    }
    return null;
}

function normalizeTargetType(value: unknown): GhostDraftSuggestionView['targetType'] | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'paragraph' || normalized === 'structure' || normalized === 'document') {
        return normalized;
    }
    return null;
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
}

export function buildGhostDraftSuggestionId(input: {
    targetRef: string;
    threadIds: string[];
    index: number;
}): string {
    const normalizedTargetRef = String(input.targetRef || '').trim() || 'document';
    const threadKey = input.threadIds.length > 0
        ? input.threadIds.join('-')
        : String(input.index);
    return `${normalizedTargetRef}#${threadKey}`;
}

function normalizeStructuredSuggestion(
    value: unknown,
    index: number,
): GhostDraftSuggestionView | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    const targetType = normalizeTargetType(item.target_type ?? item.targetType) || 'document';
    const targetRef = String(item.target_ref ?? item.targetRef ?? '').trim() || 'document';
    const suggestedText = GHOST_DRAFT_SUGGESTED_TEXT_KEYS.reduce<string>((acc, key) => {
        if (acc) return acc;
        const nested = item[key];
        return typeof nested === 'string' && nested.trim()
            ? normalizeMultilineText(nested)
            : '';
    }, '');
    if (!suggestedText) return null;

    const threadIds = normalizeStringArray(item.thread_ids ?? item.threadIds);
    return {
        suggestionId: String((item.suggestion_id ?? item.suggestionId) || '').trim()
            || buildGhostDraftSuggestionId({
                targetRef,
                threadIds,
                index,
            }),
        targetType,
        targetRef,
        threadIds,
        issueTypes: normalizeStringArray(item.issue_types ?? item.issueTypes),
        summary: typeof item.summary === 'string' ? normalizeMultilineText(item.summary) : '',
        suggestedText,
    };
}

export function extractGhostDraftSuggestions(raw: string): GhostDraftSuggestionView[] {
    const parsed = tryParseGhostDraftJson(String(raw || ''));
    if (!parsed || !Array.isArray(parsed.suggestions)) {
        return [];
    }

    return parsed.suggestions
        .map((item, index) => normalizeStructuredSuggestion(item, index))
        .filter((item): item is GhostDraftSuggestionView => Boolean(item));
}

export function normalizeGhostDraftText(raw: string): string {
    const structuredSuggestions = extractGhostDraftSuggestions(String(raw || ''));
    if (structuredSuggestions.length > 0) {
        return structuredSuggestions[0].suggestedText;
    }

    const parsed = tryParseGhostDraftJson(String(raw || ''));
    if (parsed) {
        for (const key of GHOST_DRAFT_PRIMARY_TEXT_KEYS) {
            if (typeof parsed[key] === 'string' && String(parsed[key]).trim()) {
                return normalizeMultilineText(String(parsed[key]));
            }
        }
    }

    const jsonLikeText = tryExtractGhostDraftJsonLikeText(String(raw || ''));
    if (jsonLikeText) {
        return jsonLikeText;
    }

    const afterThink = String(raw || '').includes('</think>')
        ? String(raw).slice(String(raw).lastIndexOf('</think>') + '</think>'.length)
        : String(raw || '');
    const stripped = afterThink
        .replace(/<think>/gi, ' ')
        .replace(/<\/think>/gi, ' ')
        .replace(/```(?:json)?/gi, ' ')
        .replace(/```/g, ' ');
    return normalizeMultilineText(stripped);
}

export function buildGhostDraftPromptMetadata() {
    return getPromptMetadata('ghost-draft-comment');
}

export function buildGhostDraftSourceDigest(context: GhostDraftContext): string {
    return sha256Hex(stableStringify({
        originalPost: context.originalPost,
        circle: context.circle || null,
        threadContext: context.threadContext,
        pendingIssueThreads: context.pendingIssueThreads || [],
        seededSourceContext: context.seededSourceContext || [],
        sourceMaterialContext: context.sourceMaterialContext || [],
    }));
}

export function toGhostDraftResultView(row: any): GhostDraftResultView {
    const rawDraftText = String(row.draftText || '');
    const suggestions = extractGhostDraftSuggestions(rawDraftText);
    return {
        generationId: Number(row.id),
        postId: Number(row.draftPostId),
        draftText: normalizeGhostDraftText(rawDraftText),
        suggestions,
        model: String(row.model || ''),
        generatedAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
        provenance: {
            origin: 'ai',
            providerMode: String(row.providerMode || 'builtin'),
            model: String(row.model || ''),
            promptAsset: String(row.promptAsset || ''),
            promptVersion: String(row.promptVersion || ''),
            sourceDigest: String(row.sourceDigest || ''),
            ghostRunId:
                row.ghostRunId === null || row.ghostRunId === undefined
                    ? null
                    : (Number.isFinite(Number(row.ghostRunId)) ? Number(row.ghostRunId) : null),
        },
    };
}

export async function loadGhostDraftGenerationView(
    prisma: PrismaLike,
    generationId: number,
): Promise<GhostDraftResultView | null> {
    const prismaAny = prisma as any;
    const row = await prismaAny.ghostDraftGeneration.findUnique({
        where: { id: generationId },
    });
    return row ? toGhostDraftResultView(row) : null;
}
