import { apiFetch } from '@/lib/api/fetch';
import { getQueryApiBaseUrl } from '@/lib/config/queryApiBase';

export interface DiscussionAnalysisDiagnosticsResponse {
    ok: true;
    diagnostics: {
        envelopeId: string;
        circleId: number;
        roomKey: string;
        senderPubkey: string;
        senderHandle: string | null;
        payloadText: string;
        metadata: unknown;
        deleted: boolean;
        createdAt: string;
        updatedAt: string;
        analysis: {
            relevanceStatus: string;
            semanticScore: number | null;
            embeddingScore: number | null;
            qualityScore: number | null;
            spamScore: number | null;
            decisionConfidence: number | null;
            relevanceMethod: string | null;
            actualMode: string | null;
            analysisVersion: string | null;
            topicProfileVersion: string | null;
            semanticFacets: string[];
            focusScore: number | null;
            focusLabel: string | null;
            isFeatured: boolean;
            featureReason: string | null;
            analysisCompletedAt: string | null;
            analysisErrorCode: string | null;
            analysisErrorMessage: string | null;
            authorAnnotations: string[];
        };
        topicProfile: {
            currentVersion: string;
            messageVersion: string | null;
            isStale: boolean;
            snapshotText: string;
            sourceDigest: string;
            embeddingAvailable: boolean;
            embeddingModel: string | null;
            embeddingProviderMode: 'builtin' | 'external' | null;
        };
    };
}

export interface DiscussionSummaryDiagnosticsResponse {
    ok: true;
    diagnostics: {
        scope: 'circle-scoped';
        input: {
            circleId: number;
            summaryUseLLM: boolean;
            currentSummaryUseLLM: boolean;
            messageWindowSize: number;
            sourceMessages: Array<{
                senderHandle: string | null;
                senderPubkey: string;
                text: string;
                createdAt: string;
                relevanceScore: number | null;
                focusScore: number | null;
                semanticFacets: string[];
            }>;
            windowDigest: string;
            inputFidelity: 'exact_cached_window' | 'metadata_only';
            configSource: 'circle' | 'global_default';
            currentConfigSource: 'circle' | 'global_default';
        };
        runtime: {
            method: 'rule' | 'llm';
            generationMetadata: {
                providerMode: string;
                model: string;
                promptAsset: string;
                promptVersion: string;
                sourceDigest: string;
            } | null;
            fromCache: boolean;
            generatedAt: string | null;
            cachedSourceDigest: string | null;
            fallback: {
                attemptedMethod: 'llm';
                reason: 'llm_output_truncated' | 'llm_output_unparseable' | 'llm_request_failed';
                rawFinishReason: string | null;
                rawResponseSnippet: string | null;
                errorMessage: string | null;
            } | null;
        };
        output: {
            summary: string;
            messageCount: number;
        };
        failure: {
            code: string | null;
            message: string | null;
        };
    };
}

export interface DiscussionTriggerDiagnosticsResponse {
    ok: true;
    diagnostics: {
        scope: 'circle-scoped';
        circleId: number;
        createdAt: string;
        input: {
            windowEnvelopeIds: string[];
            windowDigest: string | null;
            triggerSettings: {
                draftTriggerMode: string | null;
                triggerSummaryUseLLM: boolean | null;
                minMessages: number | null;
                minQuestionCount: number | null;
                minFocusedRatio: number | null;
            };
            messageCount: number | null;
            focusedCount: number | null;
            focusedRatio: number | null;
            questionCount: number | null;
        };
        runtime: {
            summaryMethod: string | null;
            aiJobId: number | null;
            aiJobAttempt: number | null;
            requestedByUserId: number | null;
            judge: Record<string, unknown> | null;
        };
        output: {
            status: string;
            reason: string;
            summaryPreview: string | null;
            draftPostId: number | null;
        };
        failure: {
            code: string | null;
            message: string | null;
        };
    };
}

export interface DiscussionGhostDraftDiagnosticsResponse {
    ok: true;
    diagnostics: null;
}

export interface DiscussionHumanOverrideDiagnosticsResponse {
    ok: true;
    diagnostics: null;
}

async function parseJsonResponse(response: Response): Promise<any> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function normalizeCircleId(circleId: string | number): string {
    const normalizedCircleId = String(circleId).trim();
    if (!normalizedCircleId) {
        throw new Error('请输入 circle id');
    }
    return normalizedCircleId;
}

export async function fetchDiscussionAnalysisDiagnostics(
    envelopeId: string,
): Promise<DiscussionAnalysisDiagnosticsResponse['diagnostics']> {
    const normalizedEnvelopeId = envelopeId.trim();
    if (!normalizedEnvelopeId) {
        throw new Error('请输入 envelope id');
    }

    const response = await apiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/discussion/admin/messages/${encodeURIComponent(normalizedEnvelopeId)}/analysis`,
        {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
            },
        },
    );
    const payload = await parseJsonResponse(response);
    if (!response.ok || !payload?.diagnostics) {
        throw new Error(payload?.error || 'discussion_analysis_diagnostics_failed');
    }
    return payload.diagnostics;
}

export async function reanalyzeDiscussionMessage(envelopeId: string): Promise<{ jobId: number; status: string }> {
    const normalizedEnvelopeId = envelopeId.trim();
    if (!normalizedEnvelopeId) {
        throw new Error('请输入 envelope id');
    }

    const response = await apiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/discussion/admin/messages/${encodeURIComponent(normalizedEnvelopeId)}/reanalyze`,
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        },
    );
    const payload = await parseJsonResponse(response);
    if (!response.ok || typeof payload?.jobId !== 'number') {
        throw new Error(payload?.error || 'discussion_analysis_reanalyze_failed');
    }
    return {
        jobId: payload.jobId,
        status: payload.status || 'queued',
    };
}

export async function fetchDiscussionSummaryDiagnostics(
    circleId: string | number,
): Promise<DiscussionSummaryDiagnosticsResponse['diagnostics']> {
    const normalizedCircleId = normalizeCircleId(circleId);
    const response = await apiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/discussion/admin/circles/${encodeURIComponent(normalizedCircleId)}/summary`,
        {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
            },
        },
    );
    const payload = await parseJsonResponse(response);
    if (!response.ok || !payload?.diagnostics) {
        throw new Error(payload?.error || 'discussion_summary_diagnostics_failed');
    }
    return payload.diagnostics;
}

export async function fetchDiscussionTriggerDiagnostics(
    circleId: string | number,
): Promise<DiscussionTriggerDiagnosticsResponse['diagnostics']> {
    const normalizedCircleId = normalizeCircleId(circleId);
    const response = await apiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/discussion/admin/circles/${encodeURIComponent(normalizedCircleId)}/trigger`,
        {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
            },
        },
    );
    const payload = await parseJsonResponse(response);
    if (!response.ok || !payload?.diagnostics) {
        throw new Error(payload?.error || 'discussion_trigger_diagnostics_failed');
    }
    return payload.diagnostics;
}
