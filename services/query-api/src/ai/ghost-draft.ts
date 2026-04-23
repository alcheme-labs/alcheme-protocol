/**
 * Ghost Draft — Main Engine
 *
 * Generates AI-assisted draft responses for posts.
 * Uses Vercel AI SDK streaming through New API gateway.
 *
 * Two modes:
 * 1. Generate: Creates a full draft artifact with provenance metadata
 * 2. Stream: Returns a streaming response for real-time UI
 */

import { PrismaClient } from '@prisma/client';
import { streamText } from 'ai';
import { generateAiText, getBuiltinTextModel, getModelId } from './provider';
import { getPromptSchema, getSystemPrompt } from './prompts/registry';
import {
    buildGhostDraftPromptMetadata,
    buildGhostDraftSourceDigest,
    normalizeGhostDraftText,
    toGhostDraftResultView,
} from '../services/ghostDraft/readModel';
import {
    buildGhostDraftUserPrompt,
    buildGhostDraftSuggestionTargets,
    GhostDraftContext,
} from './prompt-templates';
import { serviceConfig } from '../config/services';
import { extractSeededReferenceTokens } from '../services/seeded/reference-parser';
import { loadSeededFileContext } from '../services/seeded/file-tree';
import { buildSourceMaterialGroundingContext } from '../services/sourceMaterials/readModel';
import { listDraftDiscussionThreads, type DraftDiscussionThreadRecord } from '../services/draftDiscussionLifecycle';
export type GhostDraftResult = ReturnType<typeof toGhostDraftResultView>;

export interface GhostDraftGenerationOptions {
    seededReference?: {
        path: string;
        line: number;
    } | null;
    sourceMaterialIds?: number[] | null;
}

const PENDING_GHOST_DRAFT_THREAD_STATES = new Set(['open', 'proposed']);
const ISSUE_SUMMARY_MESSAGE_TYPES = new Set(['create', 'followup', 'propose', 'comment']);
const GENERATED_SUGGESTED_TEXT_KEYS = [
    'suggested_text',
    'suggestedText',
    'draft_text',
    'draftText',
    'comment',
    'text',
] as const;

function resolvePendingIssueSummary(thread: DraftDiscussionThreadRecord): string {
    const preferredMessage = (thread.messages || []).find((message) => (
        ISSUE_SUMMARY_MESSAGE_TYPES.has(String(message.messageType || '').trim())
        && String(message.content || '').trim().length > 0
    ));
    if (preferredMessage) {
        return String(preferredMessage.content || '').trim();
    }

    const latestContent = String(thread.latestMessage?.content || '').trim();
    if (
        latestContent
        && ISSUE_SUMMARY_MESSAGE_TYPES.has(String(thread.latestMessage?.messageType || '').trim())
    ) {
        return latestContent;
    }

    const anyMeaningfulMessage = (thread.messages || []).find((message) => (
        String(message.content || '').trim().length > 0
    ));
    if (anyMeaningfulMessage) {
        return String(anyMeaningfulMessage.content || '').trim();
    }

    return latestContent;
}

function buildGhostDraftGenerationPrompt(context: GhostDraftContext): string {
    const basePrompt = buildGhostDraftUserPrompt(context);
    const schema = getPromptSchema('ghost-draft-comment');
    if (!schema) return basePrompt;
    return [
        basePrompt,
        '',
        'Return JSON matching this schema:',
        JSON.stringify(schema),
    ].join('\n');
}

function normalizeMultilineText(value: string): string {
    return String(value || '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');
}

function collectJsonCandidates(raw: string): string[] {
    const trimmed = String(raw || '').trim();
    const seen = new Set<string>();
    const candidates: string[] = [];
    const pushCandidate = (value: string) => {
        const candidate = String(value || '').trim();
        if (!candidate || seen.has(candidate)) return;
        seen.add(candidate);
        candidates.push(candidate);
    };

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

function tryParseGeneratedSuggestionPayload(raw: string): Record<string, unknown> | null {
    for (const candidate of collectJsonCandidates(raw)) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // ignore malformed candidates
        }
    }
    return null;
}

function pickGeneratedSuggestedText(value: Record<string, unknown>): string {
    for (const key of GENERATED_SUGGESTED_TEXT_KEYS) {
        const nested = value[key];
        if (typeof nested === 'string' && nested.trim()) {
            return normalizeMultilineText(nested);
        }
    }
    return '';
}

function buildPersistedGhostDraftPayload(
    rawOutput: string,
    context: GhostDraftContext,
): string {
    const suggestionTargets = context.pendingSuggestionTargets || [];
    const targetByRef = new Map(
        suggestionTargets.map((target) => [target.targetRef, target] as const),
    );
    const parsed = tryParseGeneratedSuggestionPayload(rawOutput);
    const persistedSuggestions: Array<Record<string, unknown>> = [];

    if (parsed && Array.isArray(parsed.suggestions)) {
        parsed.suggestions.forEach((value, index) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return;
            const item = value as Record<string, unknown>;
            const targetRef = String(item.target_ref ?? item.targetRef ?? '').trim();
            const target = targetByRef.get(targetRef) || suggestionTargets[index] || null;
            const suggestedText = pickGeneratedSuggestedText(item);
            if (!target || !suggestedText) return;

            persistedSuggestions.push({
                target_type: target.targetType,
                target_ref: target.targetRef,
                thread_ids: target.threadIds,
                issue_types: target.issueTypes,
                summary: typeof item.summary === 'string' ? normalizeMultilineText(item.summary) : '',
                suggested_text: suggestedText,
            });
        });
    }

    if (persistedSuggestions.length === 0 && suggestionTargets.length === 1) {
        const fallbackText = normalizeGhostDraftText(rawOutput);
        if (fallbackText) {
            const target = suggestionTargets[0];
            persistedSuggestions.push({
                target_type: target.targetType,
                target_ref: target.targetRef,
                thread_ids: target.threadIds,
                issue_types: target.issueTypes,
                summary: target.summaries[0] || '',
                suggested_text: fallbackText,
            });
        }
    }

    if (persistedSuggestions.length === 0) {
        throw new Error('ghost_draft_suggestions_missing');
    }

    return JSON.stringify({
        suggestions: persistedSuggestions,
    });
}

/**
 * Generate a Ghost Draft for a specific post.
 */
export async function generateGhostDraft(
    prisma: PrismaClient,
    postId: number,
    userId: number,
    options?: GhostDraftGenerationOptions | null,
): Promise<GhostDraftResult> {
    const context = await buildContext(prisma, postId, options);
    const prompt = buildGhostDraftPromptMetadata();
    const sourceDigest = buildGhostDraftSourceDigest(context);

    const generation = await generateAiText({
        task: 'ghost-draft',
        systemPrompt: getSystemPrompt('ghost-draft-comment'),
        userPrompt: buildGhostDraftGenerationPrompt(context),
        maxOutputTokens: 500,
        temperature: 0.7,
        dataBoundary: 'private_plaintext',
    });
    const persistedPayload = buildPersistedGhostDraftPayload(generation.text, context);

    const prismaAny = prisma as any;
    const persisted = await prismaAny.ghostDraftGeneration.create({
        data: {
            draftPostId: postId,
            requestedByUserId: userId,
            origin: 'ai',
            providerMode: generation.providerMode,
            model: generation.model,
            promptAsset: prompt.promptAsset,
            promptVersion: prompt.promptVersion,
            sourceDigest,
            ghostRunId: null,
            draftText: persistedPayload,
        },
    });

    return toGhostDraftResultView(persisted);
}

/**
 * Stream a Ghost Draft response (for real-time UI).
 * Returns a ReadableStream-compatible result.
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function streamGhostDraft(
    prisma: PrismaClient,
    postId: number,
    options?: GhostDraftGenerationOptions | null,
): Promise<any> {
    if (serviceConfig.ai.mode !== 'builtin') {
        throw new Error('Ghost Draft streaming is only available for AI_MODE=builtin');
    }

    const context = await buildContext(prisma, postId, options);
    const modelId = getModelId('ghost-draft');

    return streamText({
        model: getBuiltinTextModel(modelId),
        system: getSystemPrompt('ghost-draft-comment'),
        prompt: buildGhostDraftGenerationPrompt(context),
        maxOutputTokens: 500,
        temperature: 0.7,
    });
}

/**
 * Build the full context needed for Ghost Draft generation.
 */
async function buildContext(
    prisma: PrismaClient,
    postId: number,
    options?: GhostDraftGenerationOptions | null,
): Promise<GhostDraftContext> {
    const post = await prisma.post.findUnique({
        where: { id: postId },
        include: {
            author: { select: { handle: true } },
            circle: { select: { id: true, name: true, description: true } },
            // Get thread context
            threadRoot: {
                include: {
                    thread: {
                        take: 5,
                        orderBy: { createdAt: 'asc' },
                        select: { text: true },
                    },
                },
            },
        },
    });

    if (!post) {
        throw new Error(`Post ${postId} not found`);
    }

    const pendingIssueThreads = (await listDraftDiscussionThreads(prisma, {
        draftPostId: postId,
        limit: 100,
    }))
        .filter((thread) => (
            PENDING_GHOST_DRAFT_THREAD_STATES.has(thread.state)
            && thread.targetType === 'paragraph'
        ))
        .map((thread) => ({
            threadId: thread.id,
            state: thread.state as 'open' | 'proposed' | 'accepted',
            issueType: thread.issueType,
            targetType: thread.targetType,
            targetRef: thread.targetRef,
            summary: resolvePendingIssueSummary(thread)
                || `Issue ${thread.id} targets ${thread.targetType}:${thread.targetRef} as ${thread.issueType}; revise conservatively around that location.`,
        }));

    if (pendingIssueThreads.length === 0) {
        throw new Error('ghost_draft_requires_pending_issue_threads');
    }

    const threadContext = post.threadRoot?.thread
        ?.map(p => p.text)
        .filter((t): t is string => t !== null)
        ?? [];
    const seededSourceContext = post.circle?.id
        ? await buildSeededGroundingContext(prisma, {
            circleId: Number(post.circle.id),
            originalPostText: post.text || '',
            threadContext,
            selectedReference: options?.seededReference ?? null,
        })
        : [];
    const sourceMaterialContext = post.circle?.id
        ? await buildSourceMaterialGroundingContext(prisma, {
            circleId: Number(post.circle.id),
            draftPostId: postId,
            materialIds: options?.sourceMaterialIds ?? null,
        })
        : [];

    return {
        originalPost: {
            text: post.text || '',
            tags: post.tags,
        },
        circle: post.circle
            ? { name: post.circle.name, description: post.circle.description || undefined }
            : undefined,
        threadContext,
        pendingIssueThreads,
        pendingSuggestionTargets: buildGhostDraftSuggestionTargets(pendingIssueThreads),
        seededSourceContext: seededSourceContext.map((item) => ({
            path: item.path,
            line: item.line,
            fileName: item.fileName,
            lineText: item.lineText,
            snippet: item.snippet,
            contentDigest: item.contentDigest,
        })),
        sourceMaterialContext: sourceMaterialContext.map((item) => ({
            materialId: item.materialId,
            name: item.name,
            mimeType: item.mimeType,
            locatorType: item.locatorType,
            locatorRef: item.locatorRef,
            text: item.text,
            textDigest: item.textDigest,
            contentDigest: item.contentDigest,
        })),
    };
}

async function buildSeededGroundingContext(
    prisma: PrismaClient,
    input: {
        circleId: number;
        originalPostText: string;
        threadContext: string[];
        selectedReference?: GhostDraftGenerationOptions['seededReference'];
    },
) {
    const references = new Map<string, { path: string; line: number }>();
    const selectedPath = String(input.selectedReference?.path || '').trim();
    const selectedLine = Number(input.selectedReference?.line || 0);
    if (selectedPath && Number.isFinite(selectedLine) && selectedLine > 0) {
        references.set(`${selectedPath}:${selectedLine}`, {
            path: selectedPath,
            line: selectedLine,
        });
    }

    for (const text of [input.originalPostText, ...input.threadContext]) {
        for (const token of extractSeededReferenceTokens(String(text || ''))) {
            references.set(`${token.path}:${token.line}`, {
                path: token.path,
                line: token.line,
            });
        }
    }

    const items = Array.from(references.values()).slice(0, 4);
    const resolved = await Promise.all(items.map((reference) => loadSeededFileContext(prisma, {
        circleId: input.circleId,
        path: reference.path,
        line: reference.line,
        before: 1,
        after: 1,
    })));

    return resolved.filter((item): item is NonNullable<typeof item> => Boolean(item));
}
