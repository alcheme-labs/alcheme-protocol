'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@apollo/client/react';

import {
    APPLY_ACCEPTED_ISSUE_REVISION,
} from '@/lib/apollo/queries';
import { generateAcceptedIssueRevisionOnPrivateSidecar } from '@/lib/api/draftReviewAiAssist';
import {
    fetchAiJobPayload,
    fetchGhostDraftGenerationPayload,
    openAiJobEventStream,
} from '@/lib/api/ghostDrafts';
import { getQueryApiBaseUrl } from '@/lib/config/queryApiBase';
import type { SeededReferenceSelection } from '@/lib/api/circlesSeeded';
import type {
    AcceptedIssueRevisionGenerateInput,
    AcceptedIssueRevisionJobResponse,
    ApplyAcceptedIssueRevisionResponse,
    GQLGhostDraftResult,
    GQLGhostDraftSuggestion,
    GQLGhostDraftProvenance,
} from '@/lib/apollo/types';

export type AcceptedIssueRevisionAssistStatus =
    | 'idle'
    | 'pending'
    | 'candidate'
    | 'applied'
    | 'error';

export interface AcceptedIssueRevisionSuggestionView {
    suggestionId: string;
    targetType: string;
    targetRef: string;
    threadIds: string[];
    issueTypes: string[];
    summary: string;
    suggestedText: string;
}

export interface AcceptedIssueRevisionCandidateView {
    generationId: number;
    postId: number;
    draftText: string;
    suggestions: AcceptedIssueRevisionSuggestionView[];
    model: string;
    generatedAt: string;
    provenance: GQLGhostDraftProvenance;
}

export interface AcceptedIssueRevisionAppliedPayload {
    generation: GQLGhostDraftResult;
    applied: boolean;
    changed: boolean;
    acceptanceId: number | null;
    acceptanceMode: string | null;
    acceptedAt: string | null;
    acceptedByUserId: number | null;
    acceptedSuggestion: AcceptedIssueRevisionSuggestionView | null;
    acceptedThreadIds: string[];
    workingCopyContent: string;
    workingCopyHash: string;
    workingCopyUpdatedAt: string;
    heatScore: number;
}

export interface AcceptedIssueRevisionGenerateRequest {
    threadIds?: Array<string | number> | null;
    targetRef?: string | null;
    seededReference?: SeededReferenceSelection | null;
    sourceMaterialIds?: number[] | null;
}

interface UseAcceptedIssueRevisionAssistOptions {
    postId: number | null;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | null;
    copy?: {
        errors?: Partial<{
            missingDraftContext: string;
            missingArtifact: string;
            missingContent: string;
            missingSuggestion: string;
            generateFailed: string;
            applyFailed: string;
            staleWorkingCopy: string;
        }>;
    };
    onApplied?: (payload: AcceptedIssueRevisionAppliedPayload) => Promise<void> | void;
}

interface AcceptedIssueRevisionAssistState {
    status: AcceptedIssueRevisionAssistStatus;
    candidate: AcceptedIssueRevisionCandidateView | null;
    error: string | null;
    pendingJobId: number | null;
}

interface AcceptedIssueRevisionJobEnvelope {
    jobId: number;
    status: string;
    postId: number;
    autoApplyRequested: boolean;
}

interface AcceptedIssueRevisionJobSnapshot {
    jobId: number;
    status: string;
    result: Record<string, unknown> | null;
    error: {
        code: string | null;
        message: string | null;
    } | null;
}

const DEFAULT_ERRORS = {
    missingDraftContext: 'missing_draft_context',
    missingArtifact: 'missing_ai_revision_artifact',
    missingContent: 'missing_ai_revision_content',
    missingSuggestion: 'missing_ai_revision_suggestion',
    generateFailed: 'accepted_issue_revision_generate_failed',
    applyFailed: 'accepted_issue_revision_apply_failed',
    staleWorkingCopy: 'accepted_issue_revision_stale_working_copy',
};

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function normalizeSuggestion(
    payload: GQLGhostDraftSuggestion | null | undefined,
): AcceptedIssueRevisionSuggestionView | null {
    const suggestionId = String(payload?.suggestionId || '').trim();
    const suggestedText = String(payload?.suggestedText || '').trim();
    if (!suggestionId || !suggestedText) return null;
    return {
        suggestionId,
        targetType: String(payload?.targetType || '').trim(),
        targetRef: String(payload?.targetRef || '').trim(),
        threadIds: Array.isArray(payload?.threadIds)
            ? payload.threadIds.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
        issueTypes: Array.isArray(payload?.issueTypes)
            ? payload.issueTypes.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
        summary: String(payload?.summary || '').trim(),
        suggestedText,
    };
}

function normalizeCandidate(
    payload: GQLGhostDraftResult | null | undefined,
): AcceptedIssueRevisionCandidateView | null {
    if (!payload) return null;
    const suggestions = Array.isArray(payload.suggestions)
        ? payload.suggestions
            .map((suggestion) => normalizeSuggestion(suggestion))
            .filter((suggestion): suggestion is AcceptedIssueRevisionSuggestionView => Boolean(suggestion))
        : [];
    const draftText = String(payload.draftText || '').trim();
    if (!draftText && suggestions.length === 0) return null;
    return {
        generationId: Number(payload.generationId),
        postId: Number(payload.postId),
        draftText,
        suggestions,
        model: String(payload.model || ''),
        generatedAt: String(payload.generatedAt || ''),
        provenance: payload.provenance,
    };
}

function normalizeJobEnvelope(
    payload: AcceptedIssueRevisionJobResponse['generateAcceptedIssueRevision'] | null | undefined,
): AcceptedIssueRevisionJobEnvelope | null {
    const jobId = Number(payload?.jobId ?? 0);
    const postId = Number(payload?.postId ?? 0);
    if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isFinite(postId) || postId <= 0) {
        return null;
    }
    return {
        jobId,
        status: String(payload?.status || 'queued'),
        postId,
        autoApplyRequested: Boolean(payload?.autoApplyRequested),
    };
}

function toJobSnapshot(payload: any): AcceptedIssueRevisionJobSnapshot | null {
    const jobId = Number(payload?.jobId ?? payload?.id ?? 0);
    if (!Number.isFinite(jobId) || jobId <= 0) return null;
    return {
        jobId,
        status: String(payload?.status || 'queued'),
        result:
            payload?.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
                ? payload.result
                : null,
        error:
            payload?.error && typeof payload.error === 'object'
                ? {
                    code: typeof payload.error.code === 'string' ? payload.error.code : null,
                    message: typeof payload.error.message === 'string' ? payload.error.message : null,
                }
                : ((typeof payload?.lastErrorCode === 'string' || typeof payload?.lastErrorMessage === 'string')
                    ? {
                        code: typeof payload.lastErrorCode === 'string' ? payload.lastErrorCode : null,
                        message: typeof payload.lastErrorMessage === 'string' ? payload.lastErrorMessage : null,
                    }
                    : null),
    };
}

function normalizeSourceMaterialIds(values: number[] | null | undefined): number[] {
    return Array.isArray(values)
        ? values
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
        : [];
}

export function useAcceptedIssueRevisionAssist(options: UseAcceptedIssueRevisionAssistOptions) {
    const errorCopy = useMemo(() => ({
        ...DEFAULT_ERRORS,
        ...(options.copy?.errors || {}),
    }), [options.copy?.errors]);
    const [state, setState] = useState<AcceptedIssueRevisionAssistState>({
        status: 'idle',
        candidate: null,
        error: null,
        pendingJobId: null,
    });
    const [runApplyAcceptedIssueRevision] = useMutation<ApplyAcceptedIssueRevisionResponse>(
        APPLY_ACCEPTED_ISSUE_REVISION,
    );
    const latestWorkingCopyHashRef = useRef(String(options.workingCopyHash || ''));
    const latestWorkingCopyUpdatedAtRef = useRef(String(options.workingCopyUpdatedAt || ''));
    const latestOnAppliedRef = useRef(options.onApplied);
    const latestGenerateRequestRef = useRef<AcceptedIssueRevisionGenerateRequest>({});
    const pendingJobIdRef = useRef<number | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const pollTimerRef = useRef<number | null>(null);
    const queryApiBaseUrl = useMemo(
        () => getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL),
        [],
    );

    useEffect(() => {
        latestWorkingCopyHashRef.current = String(options.workingCopyHash || '');
        latestWorkingCopyUpdatedAtRef.current = String(options.workingCopyUpdatedAt || '');
        latestOnAppliedRef.current = options.onApplied;
    }, [options.onApplied, options.workingCopyHash, options.workingCopyUpdatedAt]);

    const stopMonitoringJob = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (pollTimerRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
        pendingJobIdRef.current = null;
    }, []);

    useEffect(() => () => {
        stopMonitoringJob();
    }, [stopMonitoringJob]);

    const fetchAcceptedIssueRevisionCandidate = useCallback(async (
        generationId: number,
        requestOptions?: {
            attempts?: number;
            retryDelayMs?: number;
        },
    ) => {
        const attempts = Math.max(1, Number(requestOptions?.attempts ?? 1));
        const retryDelayMs = Math.max(50, Number(requestOptions?.retryDelayMs ?? 200));
        let lastError: unknown = null;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const payload = await fetchGhostDraftGenerationPayload<{ ok: true; generation: GQLGhostDraftResult }>({
                    queryApiBaseUrl,
                    generationId,
                });
                const candidate = normalizeCandidate(payload.generation);
                if (!candidate) {
                    throw new Error(errorCopy.missingContent);
                }
                return candidate;
            } catch (error) {
                lastError = error;
                if (attempt < attempts - 1) {
                    await delay(retryDelayMs);
                }
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error(errorCopy.missingContent);
    }, [errorCopy.missingContent, queryApiBaseUrl]);

    const fetchJobSnapshot = useCallback(async (jobId: number) => {
        const payload = await fetchAiJobPayload<{ ok: true; job: any }>({
            queryApiBaseUrl,
            jobId,
        });
        return toJobSnapshot(payload.job);
    }, [queryApiBaseUrl]);

    const handleCompletedJob = useCallback(async (snapshot: AcceptedIssueRevisionJobSnapshot) => {
        const generationId = Number(snapshot.result?.generationId ?? 0);
        if (!Number.isFinite(generationId) || generationId <= 0) {
            throw new Error(errorCopy.missingArtifact);
        }
        const candidate = await fetchAcceptedIssueRevisionCandidate(generationId, {
            attempts: 4,
            retryDelayMs: 250,
        });

        setState({
            status: 'candidate',
            candidate,
            error: null,
            pendingJobId: null,
        });
    }, [errorCopy.missingArtifact, fetchAcceptedIssueRevisionCandidate]);

    const handleJobSnapshot = useCallback(async (snapshot: AcceptedIssueRevisionJobSnapshot) => {
        if (!pendingJobIdRef.current || snapshot.jobId !== pendingJobIdRef.current) {
            return;
        }

        if (snapshot.status === 'queued' || snapshot.status === 'running') {
            setState((current) => ({
                ...current,
                status: 'pending',
                error: null,
                pendingJobId: snapshot.jobId,
            }));
            return;
        }

        stopMonitoringJob();

        if (snapshot.status === 'failed') {
            setState({
                status: 'error',
                candidate: null,
                error: snapshot.error?.message || errorCopy.generateFailed,
                pendingJobId: null,
            });
            return;
        }

        if (snapshot.status === 'succeeded') {
            try {
                await handleCompletedJob(snapshot);
            } catch (error) {
                setState({
                    status: 'error',
                    candidate: null,
                    error: error instanceof Error ? error.message : errorCopy.generateFailed,
                    pendingJobId: null,
                });
            }
        }
    }, [errorCopy.generateFailed, handleCompletedJob, stopMonitoringJob]);

    const schedulePoll = useCallback((jobId: number) => {
        if (typeof window === 'undefined') return;
        if (pollTimerRef.current !== null) {
            window.clearTimeout(pollTimerRef.current);
        }

        pollTimerRef.current = window.setTimeout(async () => {
            try {
                const snapshot = await fetchJobSnapshot(jobId);
                if (!snapshot) {
                    throw new Error('ai_job_not_found');
                }
                await handleJobSnapshot(snapshot);
                if (pendingJobIdRef.current === jobId && (snapshot.status === 'queued' || snapshot.status === 'running')) {
                    schedulePoll(jobId);
                }
            } catch (error) {
                stopMonitoringJob();
                setState({
                    status: 'error',
                    candidate: null,
                    error: error instanceof Error ? error.message : errorCopy.generateFailed,
                    pendingJobId: null,
                });
            }
        }, 1200);
    }, [errorCopy.generateFailed, fetchJobSnapshot, handleJobSnapshot, stopMonitoringJob]);

    const startMonitoringJob = useCallback((jobId: number) => {
        stopMonitoringJob();
        pendingJobIdRef.current = jobId;
        schedulePoll(jobId);

        if (typeof window === 'undefined') {
            return;
        }

        const source = openAiJobEventStream({
            queryApiBaseUrl,
            jobId,
        });
        if (!source) return;
        eventSourceRef.current = source;

        source.addEventListener('ai-job', (event: MessageEvent<string>) => {
            let payload: AcceptedIssueRevisionJobSnapshot | null = null;
            try {
                payload = toJobSnapshot(JSON.parse(event.data));
            } catch {
                payload = null;
            }
            if (!payload) return;
            void handleJobSnapshot(payload);
        });
        source.onerror = () => {
            if (eventSourceRef.current === source) {
                source.close();
                eventSourceRef.current = null;
            }
        };
    }, [handleJobSnapshot, queryApiBaseUrl, schedulePoll, stopMonitoringJob]);

    const generate = useCallback(async (request: AcceptedIssueRevisionGenerateRequest = {}) => {
        const postId = Number(options.postId ?? 0);
        if (!Number.isFinite(postId) || postId <= 0) {
            setState({
                status: 'error',
                candidate: null,
                error: errorCopy.missingDraftContext,
                pendingJobId: null,
            });
            return null;
        }

        latestGenerateRequestRef.current = request;
        setState({
            status: 'pending',
            candidate: null,
            error: null,
            pendingJobId: null,
        });

        try {
            const input: AcceptedIssueRevisionGenerateInput = {
                postId,
                threadIds: Array.isArray(request.threadIds)
                    ? request.threadIds.map((value) => String(value || '').trim()).filter(Boolean)
                    : null,
                targetRef: typeof request.targetRef === 'string' && request.targetRef.trim()
                    ? request.targetRef.trim()
                    : null,
                workingCopyHash: latestWorkingCopyHashRef.current || null,
                workingCopyUpdatedAt: latestWorkingCopyUpdatedAtRef.current || null,
                seededReference: request.seededReference
                    ? {
                        path: request.seededReference.path,
                        line: request.seededReference.line,
                    }
                    : null,
                sourceMaterialIds: normalizeSourceMaterialIds(request.sourceMaterialIds),
            };
            const result = await generateAcceptedIssueRevisionOnPrivateSidecar(input);
            const envelope = normalizeJobEnvelope(result);
            if (!envelope) {
                throw new Error(errorCopy.generateFailed);
            }

            setState({
                status: 'pending',
                candidate: null,
                error: null,
                pendingJobId: envelope.jobId,
            });
            startMonitoringJob(envelope.jobId);
            return envelope;
        } catch (error) {
            stopMonitoringJob();
            setState({
                status: 'error',
                candidate: null,
                error: error instanceof Error ? error.message : errorCopy.generateFailed,
                pendingJobId: null,
            });
            return null;
        }
    }, [
        errorCopy.generateFailed,
        errorCopy.missingDraftContext,
        options.postId,
        startMonitoringJob,
        stopMonitoringJob,
    ]);

    const apply = useCallback(async (
        suggestion: AcceptedIssueRevisionSuggestionView | null = state.candidate?.suggestions[0] || null,
    ) => {
        const candidate = state.candidate;
        if (!candidate || !suggestion) {
            setState((current) => ({
                ...current,
                status: 'error',
                error: errorCopy.missingSuggestion,
            }));
            return null;
        }

        try {
            const response = await runApplyAcceptedIssueRevision({
                variables: {
                    input: {
                        postId: candidate.postId,
                        generationId: candidate.generationId,
                        suggestionId: suggestion.suggestionId,
                        workingCopyHash: latestWorkingCopyHashRef.current || null,
                        workingCopyUpdatedAt: latestWorkingCopyUpdatedAtRef.current || null,
                    },
                },
            });
            const payload = response.data?.applyAcceptedIssueRevision || null;
            if (!payload) {
                throw new Error(errorCopy.applyFailed);
            }

            await latestOnAppliedRef.current?.({
                generation: payload.generation,
                applied: Boolean(payload.applied),
                changed: Boolean(payload.changed),
                acceptanceId: payload.acceptanceId,
                acceptanceMode: payload.acceptanceMode,
                acceptedAt: payload.acceptedAt,
                acceptedByUserId: payload.acceptedByUserId,
                acceptedSuggestion: normalizeSuggestion(payload.acceptedSuggestion) || suggestion,
                acceptedThreadIds: Array.isArray(payload.acceptedThreadIds)
                    ? payload.acceptedThreadIds.map((value) => String(value || '').trim()).filter(Boolean)
                    : [],
                workingCopyContent: payload.workingCopyContent,
                workingCopyHash: payload.workingCopyHash,
                workingCopyUpdatedAt: payload.updatedAt,
                heatScore: Number(payload.heatScore || 0),
            });
            if (!payload.applied) {
                setState({
                    status: 'error',
                    candidate,
                    error: errorCopy.staleWorkingCopy,
                    pendingJobId: null,
                });
                return payload;
            }
            setState({
                status: payload.applied ? 'applied' : 'candidate',
                candidate,
                error: null,
                pendingJobId: null,
            });
            return payload;
        } catch (error) {
            setState({
                status: 'error',
                candidate,
                error: error instanceof Error ? error.message : errorCopy.applyFailed,
                pendingJobId: null,
            });
            return null;
        }
    }, [
        errorCopy.applyFailed,
        errorCopy.missingSuggestion,
        errorCopy.staleWorkingCopy,
        runApplyAcceptedIssueRevision,
        state.candidate,
    ]);

    const ignore = useCallback(() => {
        stopMonitoringJob();
        setState({
            status: 'idle',
            candidate: null,
            error: null,
            pendingJobId: null,
        });
    }, [stopMonitoringJob]);

    const retry = useCallback(async () => {
        return generate(latestGenerateRequestRef.current);
    }, [generate]);

    return useMemo(() => ({
        status: state.status,
        candidate: state.candidate,
        error: state.error,
        pendingJobId: state.pendingJobId,
        generate,
        generateAcceptedIssueRevision: generate,
        apply,
        applyAcceptedIssueRevision: apply,
        ignore,
        retry,
    }), [
        apply,
        generate,
        ignore,
        retry,
        state.candidate,
        state.error,
        state.pendingJobId,
        state.status,
    ]);
}

export default useAcceptedIssueRevisionAssist;
