import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import {
    loadNodeRuntimeConfig,
    requirePrivateSidecarSurface,
} from '../../../config/services';
import {
    requireCircleActorForAuthActor,
    type AuthActor,
} from '../../auth/actor';
import {
    authorizeDraftActionForActor,
    requireSourceMaterialAccessForActor,
} from '../../auth/actorPermissions';
import { callAiCapability } from '../capabilities/adapter';
import {
    createAiGenerationFailureError,
    toAiGenerationFailureCode,
} from '../generationFailure';
import type { AiJobRecord } from '../../aiJobs/types';
import {
    buildNoSourceAnswerText,
    loadSourceGroundedAnswer,
    normalizeLocale,
    updateSourceGroundedAnswer,
} from './artifacts';
import { parseSourceGroundedAskModelOutput } from './schema';
import {
    buildRefId,
    normalizeScopes,
    selectSourceGroundedAskEvidence,
} from './sourceSelector';
import {
    SOURCE_GROUNDED_ASK_SCHEMA_VERSION,
    SOURCE_GROUNDED_ASK_TASK_TYPE,
    type SourceGroundedAskContextPayload,
    type SourceGroundedCitation,
} from './types';

export async function processSourceGroundedAskJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const answerId = typeof input.job.payload?.answerId === 'string'
        ? input.job.payload.answerId.trim()
        : '';
    if (!answerId) throw new Error('invalid_source_grounded_ask_job_payload');

    const answer = await loadSourceGroundedAnswer(prisma, answerId);
    if (!answer) {
        throw new Error('source_grounded_ask_answer_not_found');
    }

    try {
        const context = await loadContextCapsule(prisma, input.job.contextCapsuleId);
        if (!context) {
            throw new Error('source_grounded_ask_context_not_found');
        }

        const payload = normalizeContextPayload(context.contextPayload, answerId);
        const needsSourceMaterial = requiresSourceMaterialGate(payload);
        await reauthorizeWorkerRead(prisma, {
            answer,
            payload,
            needsSourceMaterial,
        });
        if (needsSourceMaterial) {
            const sidecar = requirePrivateSidecarSurface('source_materials');
            if (!sidecar.ok) {
                throw new Error('private_sidecar_required');
            }
        }
        const selection = await selectSourceGroundedAskEvidence(prisma, {
            circleId: payload.circleId,
            draftPostId: payload.draftPostId,
            scopes: payload.scopes,
            sourceMaterialIds: payload.sourceMaterialIds,
            knowledgeIds: payload.knowledgeIds,
            trendReceiptIds: payload.trendReceiptIds,
            includeProviderContext: true,
        });

        if (selection.evidenceRefs.length === 0) {
            await updateSourceGroundedAnswer(prisma, answerId, {
                status: 'no_source',
                failureCode: 'no_accessible_source',
                answerText: buildNoSourceAnswerText(answer.locale),
                limitations: [],
                citations: [],
                evidenceRefs: [],
                sourceDigest: selection.sourceDigest,
            });
            return {
                answerId,
                status: 'no_source',
                sourceCount: 0,
            };
        }

        const promptMetadata = getPromptMetadata('source-grounded-ask');
        const allowedRefIds = selection.evidenceRefs.map(buildRefId);
        let answerText = '';
        let limitations: string[] = [];
        let citations: SourceGroundedCitation[] = [];
        let modelProfile: string | null = null;

        try {
            const capability = await callAiCapability({
                taskType: SOURCE_GROUNDED_ASK_TASK_TYPE,
                capability: 'text.structure',
                privacyProfile: selection.hasSourceMaterial ? 'private_plaintext' : 'public_protocol',
                runtimeRole: loadNodeRuntimeConfig().runtimeRole,
                input: {
                    systemPrompt: getSystemPrompt('source-grounded-ask'),
                    prompt: buildUserPrompt({
                        question: String(answer.question || ''),
                        locale: normalizeLocale(answer.locale),
                        sources: selection.providerSources,
                        allowedRefIds,
                    }),
                    responseFormat: {
                        type: 'json',
                        name: 'source_grounded_ask',
                        schema: getPromptSchema('source-grounded-ask') ?? undefined,
                    },
                    temperature: 0.1,
                    maxOutputTokens: 900,
                },
            });
            modelProfile = capability.model;
            const parsed = parseSourceGroundedAskModelOutput({
                rawText: capability.output.text,
                allowedRefIds,
            });
            answerText = parsed.answer;
            limitations = parsed.limitations;
            citations = selection.citations
                .filter((citation) => parsed.citedRefIds.includes(citation.refId))
                .map((citation) => ({
                    ...citation,
                    note: parsed.citationNotes[citation.refId] ?? null,
                }));
        } catch (error) {
            throw createAiGenerationFailureError(toAiGenerationFailureCode(error));
        }

        await updateSourceGroundedAnswer(prisma, answerId, {
            status: 'ready',
            failureCode: null,
            answerText,
            limitations,
            citations,
            evidenceRefs: selection.evidenceRefs,
            sourceDigest: selection.sourceDigest,
            modelProfile,
            promptVersion: promptMetadata.promptVersion,
            outputSchemaVersion: SOURCE_GROUNDED_ASK_SCHEMA_VERSION,
        });

        return {
            answerId,
            status: 'ready',
            sourceCount: selection.evidenceRefs.length,
            failureCode: null,
        };
    } catch (error) {
        await markSourceGroundedAnswerFailed(prisma, answerId, answer.locale, error);
        throw error;
    }
}

async function reauthorizeWorkerRead(
    prisma: any,
    input: {
        answer: any;
        payload: SourceGroundedAskContextPayload;
        needsSourceMaterial: boolean;
    },
): Promise<void> {
    if (typeof prisma?.user?.findUnique !== 'function') return;
    const ownerUserId = Number(input.answer.ownerUserId ?? 0);
    if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) {
        throw new Error('source_grounded_ask_actor_missing');
    }
    const user = await prisma.user.findUnique({
        where: { id: ownerUserId },
        select: {
            id: true,
            pubkey: true,
            handle: true,
            displayName: true,
        },
    });
    if (!user?.pubkey) {
        throw new Error('source_grounded_ask_actor_missing');
    }
    const actor: AuthActor = {
        userId: user.id,
        pubkey: user.pubkey,
        handle: user.handle ?? '',
        displayName: user.displayName ?? null,
        sessionId: null,
        authSource: 'session_cookie',
        identity: {
            handle: user.handle ?? '',
            identityPubkey: user.pubkey,
            accountAddress: '',
            presence: 'verified',
        },
    };
    await requireCircleActorForAuthActor(actor, prisma, {
        circleId: input.payload.circleId,
        action: 'circle.read',
    });
    if (input.payload.draftPostId) {
        const access = await authorizeDraftActionForActor(prisma, {
            actor,
            postId: input.payload.draftPostId,
            action: 'read',
        });
        if (!access.allowed) {
            throw new Error(access.error || 'draft_read_denied');
        }
    }
    if (input.needsSourceMaterial) {
        await requireSourceMaterialAccessForActor(prisma, {
            actor,
            circleId: input.payload.circleId,
        });
    }
}

function requiresSourceMaterialGate(payload: SourceGroundedAskContextPayload): boolean {
    return payload.sourceMaterialIds.length > 0
        || payload.scopes.includes('source_materials')
        || payload.scopes.includes('current_draft');
}

async function markSourceGroundedAnswerFailed(
    prisma: any,
    answerId: string,
    locale: string,
    error: unknown,
): Promise<void> {
    const failureCode = normalizeFailureCode(error);
    await updateSourceGroundedAnswer(prisma, answerId, {
        status: 'failed',
        failureCode,
        answerText: normalizeLocale(locale) === 'zh'
            ? '来源问答生成失败。请刷新或重新提问。'
            : 'Source-grounded answer generation failed. Refresh or ask again.',
        limitations: [failureCode],
    });
}

function normalizeFailureCode(error: unknown): string {
    const record = error && typeof error === 'object'
        ? error as { code?: unknown }
        : null;
    if (record?.code === 'invalid_model_output' || record?.code === 'provider_failed') {
        return record.code;
    }
    const message = error instanceof Error ? error.message : '';
    if (message === 'invalid_model_output' || message === 'provider_failed') {
        return message;
    }
    if ([
        'source_grounded_ask_context_not_found',
        'source_grounded_ask_actor_missing',
        'private_sidecar_required',
        'draft_read_denied',
        'source_material_access_denied',
    ].includes(message)) {
        return message;
    }
    return 'source_grounded_ask_failed';
}

async function loadContextCapsule(prisma: any, contextCapsuleId: string | null | undefined) {
    if (!contextCapsuleId || typeof prisma?.aiContextCapsule?.findUnique !== 'function') return null;
    return prisma.aiContextCapsule.findUnique({
        where: { id: contextCapsuleId },
    });
}

function normalizeContextPayload(value: unknown, answerId: string): SourceGroundedAskContextPayload {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        kind: 'source_grounded_ask.v1',
        answerId,
        circleId: Number(record.circleId ?? 0),
        draftPostId: Number.isFinite(Number(record.draftPostId)) && Number(record.draftPostId) > 0
            ? Number(record.draftPostId)
            : null,
        scopes: normalizeScopes(Array.isArray(record.scopes) ? record.scopes as string[] : [], Number(record.draftPostId)),
        sourceMaterialIds: Array.isArray(record.sourceMaterialIds)
            ? record.sourceMaterialIds.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
            : [],
        knowledgeIds: Array.isArray(record.knowledgeIds)
            ? record.knowledgeIds.map((item) => String(item || '').trim()).filter(Boolean)
            : [],
        trendReceiptIds: Array.isArray(record.trendReceiptIds)
            ? record.trendReceiptIds.map((item) => String(item || '').trim()).filter(Boolean)
            : [],
        questionDigest: String(record.questionDigest || ''),
        locale: normalizeLocale(record.locale),
        sourceDigest: String(record.sourceDigest || ''),
    };
}

function buildUserPrompt(input: {
    question: string;
    locale: 'en' | 'zh';
    sources: Array<{
        refId: string;
        sourceType: string;
        title: string;
        summary: string;
        excerpt: string;
        stale: boolean;
    }>;
    allowedRefIds: string[];
}): string {
    return JSON.stringify({
        task: SOURCE_GROUNDED_ASK_TASK_TYPE,
        locale: input.locale,
        question: input.question,
        allowedRefIds: input.allowedRefIds,
        sources: input.sources.map((source) => ({
            refId: source.refId,
            sourceType: source.sourceType,
            title: source.title,
            summary: source.summary,
            excerpt: source.excerpt,
            stale: source.stale,
        })),
        outputContract: {
            answer: 'answer only from supplied sources',
            citations: 'array of { refId, note } where refId is one of allowedRefIds',
            limitations: 'state missing or stale evidence limitations',
            forbidden: ['invented citations', 'actions', 'raw private metadata', 'provider traces'],
        },
    });
}
