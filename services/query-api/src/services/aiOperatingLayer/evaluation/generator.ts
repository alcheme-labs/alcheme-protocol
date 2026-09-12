import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import {
    loadNodeRuntimeConfig,
    requirePrivateSidecarSurface,
} from '../../../config/services';
import type { AiJobRecord } from '../../aiJobs/types';
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
    getEvaluationArtifact,
    updateEvaluationArtifact,
} from './artifacts';
import { loadNeutralEvaluationConfig } from './config';
import { parseNeutralEvaluationModelOutput } from './schema';
import {
    selectNeutralEvaluationSubjectEvidence,
} from './subjects';
import {
    NEUTRAL_EVALUATION_MAX_OUTPUT_TOKENS,
    NEUTRAL_EVALUATION_SCHEMA_VERSION,
    NEUTRAL_EVALUATION_TASK_TYPE,
    type NeutralEvaluationContextPayload,
    type NeutralEvaluationProviderSource,
    type NeutralEvaluationSubjectType,
} from './types';

export async function processNeutralEvaluationJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const artifactId = typeof input.job.payload?.artifactId === 'string'
        ? input.job.payload.artifactId.trim()
        : '';
    if (!artifactId) throw new Error('invalid_neutral_evaluation_job_payload');

    const artifact = await getEvaluationArtifact(prisma, artifactId);
    if (!artifact) throw new Error('neutral_evaluation_artifact_not_found');

    if (artifact.status !== 'pending') {
        return {
            artifactId,
            status: 'stale',
            currentStatus: String(artifact.status || ''),
        };
    }

    const config = loadNeutralEvaluationConfig();
    if (!config.enabled) {
        await markArtifactFailed(prisma, artifactId, 'neutral_evaluation_disabled');
        return {
            artifactId,
            status: 'disabled',
            failureCode: 'neutral_evaluation_disabled',
        };
    }

    try {
        const context = await loadContextCapsule(prisma, input.job.contextCapsuleId);
        if (!context) {
            await markArtifactFailed(prisma, artifactId, 'neutral_evaluation_context_not_found');
            throw new Error('neutral_evaluation_context_not_found');
        }

        const payload = normalizeContextPayload(context.contextPayload, artifact);
        await reauthorizeWorkerRead(prisma, {
            actorUserId: Number(context.actorUserId ?? artifact.requestedByUserId ?? input.job.requestedByUserId ?? 0),
            payload,
        });
        const selection = await selectNeutralEvaluationSubjectEvidence(prisma, {
            circleId: payload.circleId,
            subjectType: payload.subjectType,
            subjectId: payload.subjectId,
            includeProviderContext: true,
        });

        if (selection.status !== 'ready') {
            await updateEvaluationArtifact(prisma, artifactId, {
                status: selection.status,
                failureCode: selection.blockReason ?? 'no_accessible_source',
                evidenceRefs: selection.evidenceRefs,
                sourceDigest: selection.sourceDigest,
                subjectSnapshot: selection.subjectSnapshot,
            });
            return {
                artifactId,
                status: selection.status,
                failureCode: selection.blockReason ?? 'no_accessible_source',
            };
        }

        const allowedRefIds = selection.evidenceRefs.map(buildRefId);
        const promptMetadata = getPromptMetadata('neutral-evaluation');
        let modelProfile: string | null = null;
        const capability = await callAiCapability({
            taskType: NEUTRAL_EVALUATION_TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: selection.requiresPrivatePlaintext ? 'private_plaintext' : 'public_protocol',
            runtimeRole: loadNodeRuntimeConfig().runtimeRole,
            input: {
                systemPrompt: getSystemPrompt('neutral-evaluation'),
                prompt: buildUserPrompt({
                    locale: normalizeLocale(payload.locale),
                    subjectType: payload.subjectType,
                    allowedRefIds,
                    sources: selection.providerSources,
                }),
                responseFormat: {
                    type: 'json',
                    name: 'neutral_evaluation',
                    schema: getPromptSchema('neutral-evaluation') ?? undefined,
                },
                providerOptions: {
                    openai: {
                        reasoningEffort: 'none',
                    },
                },
                temperature: 0.1,
                maxOutputTokens: NEUTRAL_EVALUATION_MAX_OUTPUT_TOKENS,
            },
        });
        modelProfile = capability.model;
        const parsed = parseNeutralEvaluationModelOutput({
            rawText: capability.output.text,
            allowedRefIds,
        });

        await updateEvaluationArtifact(prisma, artifactId, {
            status: 'ready',
            visibility: 'private',
            summary: parsed.summary,
            claims: parsed.claims,
            evidenceSummary: parsed.evidenceSummary,
            assumptions: parsed.assumptions,
            evidenceGaps: parsed.evidenceGaps,
            counterpoints: parsed.counterpoints,
            verifiableNextSteps: parsed.verifiableNextSteps,
            neutralWordingSuggestion: parsed.neutralWordingSuggestion,
            confidence: parsed.confidence,
            limitations: parsed.limitations,
            evidenceRefs: selection.evidenceRefs,
            sourceDigest: selection.sourceDigest,
            subjectSnapshot: selection.subjectSnapshot,
            modelProfile,
            promptVersion: promptMetadata.promptVersion,
            outputSchemaVersion: NEUTRAL_EVALUATION_SCHEMA_VERSION,
            failureCode: null,
        });

        return {
            artifactId,
            status: 'ready',
            sourceCount: selection.evidenceRefs.length,
        };
    } catch (error) {
        const failureCode = normalizeFailureCode(error);
        await updateEvaluationArtifact(prisma, artifactId, {
            status: 'failed',
            failureCode,
            outputSchemaVersion: NEUTRAL_EVALUATION_SCHEMA_VERSION,
        });
        return {
            artifactId,
            status: 'failed',
            failureCode,
        };
    }
}

async function markArtifactFailed(
    prisma: any,
    artifactId: string,
    failureCode: string,
): Promise<void> {
    await updateEvaluationArtifact(prisma, artifactId, {
        status: 'failed',
        failureCode,
    });
}

async function loadContextCapsule(prisma: any, contextCapsuleId: string | null | undefined) {
    if (!contextCapsuleId || typeof prisma?.aiContextCapsule?.findUnique !== 'function') return null;
    return prisma.aiContextCapsule.findUnique({
        where: { id: contextCapsuleId },
    });
}

async function reauthorizeWorkerRead(
    prisma: any,
    input: {
        actorUserId: number;
        payload: NeutralEvaluationContextPayload;
    },
): Promise<void> {
    if (typeof prisma?.user?.findUnique !== 'function') {
        return;
    }
    if (!Number.isFinite(input.actorUserId) || input.actorUserId <= 0) {
        throw new Error('neutral_evaluation_actor_missing');
    }
    const user = await prisma.user.findUnique({
        where: { id: input.actorUserId },
        select: {
            id: true,
            pubkey: true,
            handle: true,
            displayName: true,
        },
    });
    if (!user?.pubkey) {
        throw new Error('neutral_evaluation_actor_missing');
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

    if (input.payload.subjectType === 'draft_post') {
        const sidecar = requirePrivateSidecarSurface('ghost_draft_private');
        if (!sidecar.ok) throw new Error('private_sidecar_required');
        const draftPostId = Number(input.payload.subjectId);
        if (!Number.isFinite(draftPostId) || draftPostId <= 0) {
            throw new Error('invalid_draft_post_id');
        }
        const access = await authorizeDraftActionForActor(prisma, {
            actor,
            postId: Math.trunc(draftPostId),
            action: 'read',
        });
        if (!access.allowed) {
            throw new Error(access.error || 'draft_read_denied');
        }
        if (access.post?.circleId && Number(access.post.circleId) !== input.payload.circleId) {
            throw new Error('draft_not_found');
        }
    }

    if (input.payload.subjectType === 'source_material') {
        const sidecar = requirePrivateSidecarSurface('source_materials');
        if (!sidecar.ok) throw new Error('private_sidecar_required');
        await requireSourceMaterialAccessForActor(prisma, {
            actor,
            circleId: input.payload.circleId,
        });
    }
}

function normalizeContextPayload(value: unknown, artifact: any): NeutralEvaluationContextPayload {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        kind: 'evaluation_neutral.v1',
        artifactId: String(record.artifactId || artifact.id || ''),
        circleId: Number(record.circleId ?? artifact.circleId ?? 0),
        subjectType: normalizeSubjectType(record.subjectType, artifact.subjectType),
        subjectId: String(record.subjectId ?? artifact.subjectId ?? ''),
        sourceDigest: String(record.sourceDigest ?? artifact.sourceDigest ?? ''),
        locale: normalizeLocale(record.locale),
    };
}

function normalizeSubjectType(
    primary: unknown,
    fallback: unknown,
): NeutralEvaluationSubjectType {
    const value = String(primary || fallback || '');
    if (value === 'draft_post' || value === 'source_material') return value;
    return 'post';
}

function buildRefId(ref: { sourceType: string; sourceId: string }): string {
    return `${ref.sourceType}:${ref.sourceId}`;
}

function normalizeLocale(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return ['en', 'zh', 'fr', 'es'].includes(normalized) ? normalized : 'en';
}

function normalizeFailureCode(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message === 'invalid_neutral_evaluation_output') return 'invalid_model_output';
    if ([
        'neutral_evaluation_context_not_found',
        'neutral_evaluation_actor_missing',
        'private_sidecar_required',
        'invalid_draft_post_id',
        'draft_read_denied',
        'draft_not_found',
        'source_material_access_denied',
    ].includes(message)) {
        return message;
    }
    return 'provider_failed';
}

function buildUserPrompt(input: {
    locale: string;
    subjectType: NeutralEvaluationSubjectType;
    allowedRefIds: string[];
    sources: NeutralEvaluationProviderSource[];
}): string {
    return JSON.stringify({
        task: NEUTRAL_EVALUATION_TASK_TYPE,
        locale: input.locale,
        subjectType: input.subjectType,
        allowedRefIds: input.allowedRefIds,
        sources: input.sources.map((source) => ({
            refId: source.refId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            title: source.title,
            excerpt: source.excerpt,
            visibility: source.visibility,
        })),
        outputContract: {
            summary: 'neutral source-bounded evaluation summary',
            claims: 'each claim must cite one or more allowedRefIds',
            evidenceSummary: 'short notes mapped to allowedRefIds',
            assumptions: 'assumptions needed to interpret the supplied source',
            evidenceGaps: 'missing evidence or unsupported parts',
            counterpoints: 'reasonable counterpoints from the same bounded source set',
            verifiableNextSteps: 'checks a human can perform later',
            neutralWordingSuggestion: 'optional neutral rewording, no direct content write',
            confidence: 'low, medium, or high',
            limitations: 'limitations of the supplied evidence only',
            forbidden: [
                'ranking authors or content',
                'reputation or reward effects',
                'permission or moderation effects',
                'governance or contribution effects',
                'proof package fields',
            ],
        },
    });
}
