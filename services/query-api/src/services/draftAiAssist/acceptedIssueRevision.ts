import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiGenerationMetadata } from '../../ai/metadata';

import { assertAiTaskAllowed, generateAiText } from '../../ai/provider';
import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../ai/prompts/registry';
import { authorizeDraftActionForActor } from '../auth/actorPermissions';
import { listDraftDiscussionThreads, type DraftDiscussionThreadRecord } from '../draftDiscussionLifecycle';
import { resolveDraftLifecycleReadModel } from '../draftLifecycle/readModel';
import {
    buildGhostDraftSuggestionId,
    sha256Hex,
} from '../ghostDraft/readModel';
import { buildSourceMaterialGroundingContext } from '../sourceMaterials/readModel';
import { markSourceMaterialsUsedInDraft } from '../sourceMaterials/lifecycleHooks';
import { resolveCircleDraftPromptForGeneration } from '../policy/circleDraftPrompt';
import { extractSeededReferenceTokens } from '../seeded/reference-parser';
import { loadSeededFileContext } from '../seeded/file-tree';
import type {
    AcceptedIssueRevisionGenerateInput,
    AcceptedIssueRevisionGenerateResult,
    AcceptedIssueRevisionManualReasonCode,
} from './types';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const ACCEPTED_ISSUE_REVISION_PROMPT_ASSET = 'accepted-issue-revision' as const;
const ISSUE_SUMMARY_MESSAGE_TYPES = new Set(['create', 'followup', 'propose', 'comment', 'accept']);
const GENERATED_TEXT_KEYS = [
    'suggested_text',
    'suggestedText',
    'draft_text',
    'draftText',
    'text',
] as const;

interface TargetGroup {
    targetType: 'paragraph';
    targetRef: string;
    paragraphIndex: number;
    currentText: string;
    threadIds: string[];
    issueTypes: string[];
    summaries: string[];
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

function normalizeSourceMaterialIds(value: number[] | null | undefined): number[] {
    return Array.from(new Set(
        (Array.isArray(value) ? value : [])
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0),
    )).sort((left, right) => left - right);
}

function normalizeThreadIds(value: Array<number | string> | null | undefined): string[] {
    return Array.from(new Set(
        (Array.isArray(value) ? value : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean),
    ));
}

function parseParagraphIndex(targetRef: string | null | undefined): number | null {
    const matched = String(targetRef || '').trim().match(/^paragraph:(\d+)$/i);
    if (!matched) return null;
    const parsed = Number.parseInt(matched[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractPatchParagraphs(text: string): string[] {
    return Array.from(String(text || '').matchAll(/[^\r\n]+/g))
        .map((match) => String(match[0] || '').trim())
        .filter(Boolean);
}

function normalizeMultilineText(value: string): string {
    return String(value || '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');
}

function buildManualResult(input: {
    draftPostId: number;
    reasonCode: AcceptedIssueRevisionManualReasonCode;
    reason: string;
    targetType?: 'paragraph' | 'structure' | 'document' | null;
    targetRef?: string | null;
    threadIds?: string[];
}): AcceptedIssueRevisionGenerateResult {
    return {
        status: 'manual_handling',
        draftPostId: input.draftPostId,
        generationId: null,
        reasonCode: input.reasonCode,
        reason: input.reason,
        targetType: input.targetType ?? null,
        targetRef: input.targetRef ?? null,
        threadIds: input.threadIds ?? [],
    };
}

function resolveIssueSummary(thread: DraftDiscussionThreadRecord): string {
    const preferredMessage = (thread.messages || []).find((message) => (
        ISSUE_SUMMARY_MESSAGE_TYPES.has(String(message.messageType || '').trim())
        && String(message.content || '').trim().length > 0
    ));
    if (preferredMessage) return String(preferredMessage.content || '').trim();

    const latestContent = String(thread.latestMessage?.content || '').trim();
    if (
        latestContent
        && ISSUE_SUMMARY_MESSAGE_TYPES.has(String(thread.latestMessage?.messageType || '').trim())
    ) {
        return latestContent;
    }

    return latestContent || `Accepted issue ${thread.id} targets ${thread.targetRef}.`;
}

function selectEligibleAcceptedThreads(input: {
    threads: DraftDiscussionThreadRecord[];
    requestedThreadIds: string[];
    targetRef: string | null;
}): DraftDiscussionThreadRecord[] {
    const requested = new Set(input.requestedThreadIds);
    return input.threads.filter((thread) => {
        if (requested.size > 0 && !requested.has(String(thread.id))) return false;
        if (thread.state !== 'accepted') return false;
        if (thread.latestApplication) return false;
        if (input.targetRef && thread.targetRef !== input.targetRef) return false;
        return true;
    });
}

function buildTargetGroups(input: {
    threads: DraftDiscussionThreadRecord[];
    currentText: string;
}): { groups: TargetGroup[]; manualThread: DraftDiscussionThreadRecord | null } {
    const paragraphs = extractPatchParagraphs(input.currentText);
    const grouped = new Map<string, TargetGroup>();

    for (const thread of input.threads) {
        if (thread.targetType !== 'paragraph') {
            return { groups: [], manualThread: thread };
        }
        const paragraphIndex = parseParagraphIndex(thread.targetRef);
        if (paragraphIndex === null || paragraphIndex >= paragraphs.length) {
            return { groups: [], manualThread: thread };
        }
        const existing = grouped.get(thread.targetRef);
        if (existing) {
            if (!existing.threadIds.includes(thread.id)) existing.threadIds.push(thread.id);
            if (!existing.issueTypes.includes(thread.issueType)) existing.issueTypes.push(thread.issueType);
            const summary = resolveIssueSummary(thread);
            if (summary && !existing.summaries.includes(summary)) existing.summaries.push(summary);
            continue;
        }
        grouped.set(thread.targetRef, {
            targetType: 'paragraph',
            targetRef: thread.targetRef,
            paragraphIndex,
            currentText: paragraphs[paragraphIndex],
            threadIds: [thread.id],
            issueTypes: thread.issueType ? [thread.issueType] : [],
            summaries: [resolveIssueSummary(thread)].filter(Boolean),
        });
    }

    return { groups: Array.from(grouped.values()), manualThread: null };
}

function collectJsonCandidates(raw: string): string[] {
    const trimmed = String(raw || '').trim();
    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (candidate: string) => {
        const normalized = String(candidate || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
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

function parseAiPayload(raw: string): Record<string, unknown> | null {
    for (const candidate of collectJsonCandidates(raw)) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Continue probing common LLM wrapper formats.
        }
    }
    return null;
}

function pickGeneratedText(value: Record<string, unknown>): string {
    for (const key of GENERATED_TEXT_KEYS) {
        const nested = value[key];
        if (typeof nested === 'string' && nested.trim()) {
            return normalizeMultilineText(nested);
        }
    }
    return '';
}

function buildPersistedPayload(input: {
    rawOutput: string;
    groups: TargetGroup[];
}): string {
    const targetByRef = new Map(input.groups.map((group) => [group.targetRef, group] as const));
    const parsed = parseAiPayload(input.rawOutput);
    const persistedSuggestions: Array<Record<string, unknown>> = [];

    if (parsed && Array.isArray(parsed.suggestions)) {
        parsed.suggestions.forEach((value, index) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return;
            const item = value as Record<string, unknown>;
            const targetRef = String(item.target_ref ?? item.targetRef ?? '').trim();
            const group = targetByRef.get(targetRef) || (input.groups.length === 1 ? input.groups[0] : input.groups[index]);
            const suggestedText = pickGeneratedText(item);
            if (!group || !suggestedText) return;
            persistedSuggestions.push({
                suggestion_id: buildGhostDraftSuggestionId({
                    targetRef: group.targetRef,
                    threadIds: group.threadIds,
                    index,
                }),
                target_type: group.targetType,
                target_ref: group.targetRef,
                thread_ids: group.threadIds,
                issue_types: group.issueTypes,
                summary: typeof item.summary === 'string'
                    ? normalizeMultilineText(item.summary)
                    : group.summaries[0] || '',
                suggested_text: suggestedText,
            });
        });
    }

    if (persistedSuggestions.length === 0 && input.groups.length === 1) {
        const fallbackText = normalizeMultilineText(input.rawOutput);
        if (fallbackText) {
            const group = input.groups[0];
            persistedSuggestions.push({
                suggestion_id: buildGhostDraftSuggestionId({
                    targetRef: group.targetRef,
                    threadIds: group.threadIds,
                    index: 0,
                }),
                target_type: group.targetType,
                target_ref: group.targetRef,
                thread_ids: group.threadIds,
                issue_types: group.issueTypes,
                summary: group.summaries[0] || '',
                suggested_text: fallbackText,
            });
        }
    }

    if (persistedSuggestions.length === 0) {
        throw new Error('accepted_issue_revision_suggestions_missing');
    }

    return JSON.stringify({ suggestions: persistedSuggestions });
}

async function buildSeededGroundingContext(
    prisma: PrismaLike,
    input: {
        circleId: number;
        workingCopyText: string;
        selectedReference?: AcceptedIssueRevisionGenerateInput['seededReference'];
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
    for (const token of extractSeededReferenceTokens(input.workingCopyText)) {
        references.set(`${token.path}:${token.line}`, token);
    }
    const items = Array.from(references.values()).slice(0, 4);
    const resolved = await Promise.all(items.map((reference) => loadSeededFileContext(prisma as PrismaClient, {
        circleId: input.circleId,
        path: reference.path,
        line: reference.line,
        before: 1,
        after: 1,
    })));
    return resolved.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function buildAcceptedIssueRevisionPrompt(input: {
    workingCopyText: string;
    circleName: string | null;
    circleDescription: string | null;
    groups: TargetGroup[];
    seededSourceContext: Array<{
        path: string;
        line: number;
        fileName: string;
        lineText: string;
        snippet: string;
    }>;
    sourceMaterialContext: Array<{
        materialId: number;
        name: string;
        mimeType?: string | null;
        locatorType: string;
        locatorRef: string;
        text: string;
    }>;
}): string {
    const schema = getPromptSchema(ACCEPTED_ISSUE_REVISION_PROMPT_ASSET);
    const parts: string[] = [
        'Accepted review issues to apply to the current working copy:',
    ];
    input.groups.forEach((group, groupIndex) => {
        parts.push(`  ${groupIndex + 1}. ${group.targetRef} threads=[${group.threadIds.join(', ')}] issue_types=[${group.issueTypes.join(', ')}]`);
        group.threadIds.forEach((threadId) => {
            parts.push(`     Thread #${threadId}`);
        });
        parts.push(`     Current target paragraph: ${group.currentText.slice(0, 500)}`);
        group.summaries.forEach((summary, summaryIndex) => {
            parts.push(`     ${summaryIndex + 1}) ${summary.slice(0, 320)}`);
        });
    });
    parts.push('');
    if (input.circleName) {
        parts.push(`Circle: ${input.circleName}`);
        if (input.circleDescription) parts.push(`Circle description: ${input.circleDescription}`);
        parts.push('');
    }
    if (input.seededSourceContext.length > 0) {
        parts.push('Seeded source context:');
        input.seededSourceContext.forEach((item, index) => {
            parts.push(`  ${index + 1}. @file:${item.path}:${item.line} (${item.fileName})`);
            if (item.lineText) parts.push(`     Focus line: ${item.lineText.slice(0, 220)}`);
            if (item.snippet) parts.push(`     Nearby excerpt: ${item.snippet.split('\n').join('\n     ').slice(0, 600)}`);
        });
        parts.push('');
    }
    if (input.sourceMaterialContext.length > 0) {
        parts.push('Accepted source materials:');
        input.sourceMaterialContext.forEach((item, index) => {
            parts.push(`  ${index + 1}. ${item.name} [${item.locatorType}:${item.locatorRef}]`);
            parts.push(`     ${item.text.slice(0, 360)}`);
        });
        parts.push('');
    }
    parts.push('Current working copy:');
    parts.push(input.workingCopyText.slice(0, 2200));
    parts.push('');
    parts.push('Return JSON matching this schema:');
    parts.push(JSON.stringify(schema));
    return parts.join('\n');
}

function buildSourceDigest(input: {
    workingCopyText: string;
    groups: TargetGroup[];
    seededSourceContext: unknown[];
    sourceMaterialContext: unknown[];
}): string {
    return sha256Hex(stableStringify({
        workingCopyText: input.workingCopyText,
        groups: input.groups.map((group) => ({
            targetRef: group.targetRef,
            threadIds: group.threadIds,
            issueTypes: group.issueTypes,
            summaries: group.summaries,
        })),
        seededSourceContext: input.seededSourceContext,
        sourceMaterialContext: input.sourceMaterialContext,
    }));
}

export async function generateAcceptedIssueRevision(
    prisma: PrismaLike,
    input: AcceptedIssueRevisionGenerateInput,
): Promise<AcceptedIssueRevisionGenerateResult> {
    const draftPostId = Number(input.draftPostId);
    const readAccess = await authorizeDraftActionForActor(prisma as PrismaClient, {
        actor: input.actor,
        postId: draftPostId,
        action: 'read',
    });
    if (!readAccess.allowed) {
        return buildManualResult({
            draftPostId,
            reasonCode: 'read_access_denied',
            reason: readAccess.message || readAccess.error || 'Read access is required.',
        });
    }
    if (!readAccess.post?.circleId || !readAccess.circleActor) {
        return buildManualResult({
            draftPostId,
            reasonCode: 'circle_context_missing',
            reason: 'Circle governance context is required for accepted issue revision.',
        });
    }

    const lifecycle = await resolveDraftLifecycleReadModel(prisma as PrismaClient, {
        draftPostId,
    });
    if (lifecycle.documentStatus !== 'drafting') {
        return buildManualResult({
            draftPostId,
            reasonCode: 'not_drafting',
            reason: 'Accepted issue revision is only available while the draft is in drafting.',
        });
    }

    const post = await prisma.post.findUnique({
        where: { id: draftPostId },
        include: {
            circle: {
                select: {
                    id: true,
                    name: true,
                    description: true,
                },
            },
        },
    });
    if (!post) {
        throw new Error('draft_not_found');
    }

    const targetRef = String(input.targetRef || '').trim() || null;
    const requestedThreadIds = normalizeThreadIds(input.threadIds);
    const threads = await listDraftDiscussionThreads(prisma as PrismaClient, {
        draftPostId,
        limit: 100,
    });
    const acceptedThreads = selectEligibleAcceptedThreads({
        threads,
        requestedThreadIds,
        targetRef,
    });
    if (acceptedThreads.length === 0) {
        return buildManualResult({
            draftPostId,
            reasonCode: 'no_accepted_issues',
            reason: 'No accepted unapplied issue is available for this revision.',
            targetRef,
            threadIds: requestedThreadIds,
        });
    }

    const workingCopyText = String((post as any).text || '');
    const { groups, manualThread } = buildTargetGroups({
        threads: acceptedThreads,
        currentText: workingCopyText,
    });
    if (manualThread || groups.length === 0) {
        return buildManualResult({
            draftPostId,
            reasonCode: 'requires_manual_handling',
            reason: 'The accepted issue target has changed or is not a paragraph target.',
            targetType: manualThread?.targetType ?? null,
            targetRef: manualThread?.targetRef ?? targetRef,
            threadIds: manualThread ? [manualThread.id] : acceptedThreads.map((thread) => thread.id),
        });
    }

    const sourceMaterialIds = normalizeSourceMaterialIds(input.sourceMaterialIds ?? null);
    const sourceMaterialContext = (post as any).circle?.id
        ? await buildSourceMaterialGroundingContext(prisma as PrismaClient, {
            circleId: Number((post as any).circle.id),
            draftPostId,
            materialIds: sourceMaterialIds,
        })
        : [];
    if (sourceMaterialIds.length > 0) {
        const groundedIds = new Set(sourceMaterialContext.map((item) => Number(item.materialId)));
        const missingIds = sourceMaterialIds.filter((id) => !groundedIds.has(id));
        if (missingIds.length > 0) {
            throw new Error('source_material_not_accepted_for_draft');
        }
    }
    const seededSourceContext = (post as any).circle?.id
        ? await buildSeededGroundingContext(prisma, {
            circleId: Number((post as any).circle.id),
            workingCopyText,
            selectedReference: input.seededReference ?? null,
        })
        : [];

    const promptMetadata = getPromptMetadata(ACCEPTED_ISSUE_REVISION_PROMPT_ASSET);
    const schema = getPromptSchema(ACCEPTED_ISSUE_REVISION_PROMPT_ASSET);
    assertAiTaskAllowed({
        task: 'accepted-issue-revision',
        dataBoundary: 'private_plaintext',
    });
    const circlePrompt = await resolveCircleDraftPromptForGeneration(prisma, {
        circleId: Number((post as any).circle.id),
        scope: 'governance_draft',
        access: {
            actorUserId: Number(input.requestedByUserId),
            actorPubkey: input.actor.pubkey,
            purpose: 'governance_draft_generation',
        },
    });
    const systemPrompt = [
        getSystemPrompt(ACCEPTED_ISSUE_REVISION_PROMPT_ASSET),
        ...(circlePrompt.customPromptBody
            ? [
                'Circle-approved governance drafting instructions (these do not replace system safety rules, permissions, human confirmation, or the response schema):',
                circlePrompt.customPromptBody,
            ]
            : []),
    ].join('\n\n');
    const sourceDigest = buildSourceDigest({
        workingCopyText,
        groups,
        seededSourceContext,
        sourceMaterialContext,
    });
    let generated;
    try {
        generated = await generateAiText({
            task: 'accepted-issue-revision',
            systemPrompt,
            userPrompt: buildAcceptedIssueRevisionPrompt({
                workingCopyText,
                circleName: (post as any).circle?.name ?? null,
                circleDescription: (post as any).circle?.description ?? null,
                groups,
                seededSourceContext: seededSourceContext.map((item) => ({
                    path: item.path,
                    line: item.line,
                    fileName: item.fileName,
                    lineText: item.lineText,
                    snippet: item.snippet,
                })),
                sourceMaterialContext: sourceMaterialContext.map((item) => ({
                    materialId: item.materialId,
                    name: item.name,
                    mimeType: item.mimeType,
                    locatorType: item.locatorType,
                    locatorRef: item.locatorRef,
                    text: item.text,
                })),
            }),
            responseFormat: schema
                ? {
                    type: 'json',
                    schema,
                    name: 'accepted_issue_revision',
                    description: 'Accepted issue paragraph revision suggestions.',
                }
                : undefined,
            maxOutputTokens: 600,
            temperature: 0.2,
            dataBoundary: 'private_plaintext',
        });
    } catch {
        throw new Error('accepted_issue_revision_generation_failed');
    }
    const persistedPayload = buildPersistedPayload({
        rawOutput: generated.text,
        groups,
    });
    const generationMetadata: AiGenerationMetadata = {
        providerMode: generated.providerMode,
        model: generated.model,
        promptAsset: promptMetadata.promptAsset,
        promptVersion: circlePrompt.promptVersion,
        sourceDigest,
        promptScope: circlePrompt.scope,
        promptMode: circlePrompt.mode,
        systemPromptVersion: circlePrompt.systemPromptVersion,
        schemaRef: circlePrompt.schemaRef,
        ...(circlePrompt.circlePromptVersionId
            ? { circlePromptVersionId: circlePrompt.circlePromptVersionId }
            : {}),
        ...(circlePrompt.circlePromptVersion
            ? { circlePromptVersion: circlePrompt.circlePromptVersion }
            : {}),
        ...(circlePrompt.circlePromptDigest
            ? { circlePromptDigest: circlePrompt.circlePromptDigest }
            : {}),
        ...(circlePrompt.approvalRef ? { approvalRef: circlePrompt.approvalRef } : {}),
        ...(circlePrompt.selectionApprovalRef
            ? { selectionApprovalRef: circlePrompt.selectionApprovalRef }
            : {}),
    };
    const persisted = await (prisma as any).ghostDraftGeneration.create({
        data: {
            draftPostId,
            requestedByUserId: Number(input.requestedByUserId),
            origin: 'ai',
            providerMode: generated.providerMode,
            model: generated.model,
            promptAsset: promptMetadata.promptAsset,
            promptVersion: circlePrompt.promptVersion,
            sourceDigest,
            generationMetadata,
            ghostRunId: null,
            draftText: persistedPayload,
        },
    });

    await markSourceMaterialsUsedInDraft(prisma as PrismaClient, {
        draftPostId,
        actorUserId: Number(input.requestedByUserId),
        sourceMaterialIds,
    });

    return {
        status: 'generated',
        draftPostId,
        generationId: Number(persisted.id),
        model: String(generated.model || ''),
        promptAsset: ACCEPTED_ISSUE_REVISION_PROMPT_ASSET,
        promptVersion: circlePrompt.promptVersion,
        targetRef: groups[0].targetRef,
        threadIds: groups.flatMap((group) => group.threadIds),
    };
}
