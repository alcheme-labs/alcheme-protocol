'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@apollo/client/react';

import { fetchDraftLifecycle } from '@/lib/api/draftWorkingCopy';
import { getQueryApiBaseUrl } from '@/lib/config/queryApiBase';
import {
    fetchAiJobPayload,
    fetchDraftAiJobsPayload,
    fetchGhostDraftGenerationPayload,
    openAiJobEventStream,
} from '@/lib/api/ghostDrafts';
import { ACCEPT_GHOST_DRAFT, GENERATE_GHOST_DRAFT } from '@/lib/apollo/queries';
import type { SeededReferenceSelection } from '@/lib/api/circlesSeeded';
import type {
    AcceptGhostDraftResponse,
    GQLGhostDraftProvenance,
    GQLGhostDraftSuggestion,
    GhostDraftGenerateInput,
    GhostDraftJobResponse,
    GQLGhostDraftResult,
} from '@/lib/apollo/types';

export type GhostDraftStatus =
    | 'idle'
    | 'pending'
    | 'candidate'
    | 'accepted'
    | 'applied'
    | 'error';

export interface GhostDraftCandidateView {
    generationId: number;
    postId: number;
    draftText: string;
    suggestions: GhostDraftSuggestionView[];
    model: string;
    generatedAt: string;
    provenance: GQLGhostDraftProvenance;
}

export interface GhostDraftSuggestionView {
    suggestionId: string;
    targetType: string;
    targetRef: string;
    threadIds: string[];
    issueTypes: string[];
    summary: string;
    suggestedText: string;
}

interface UseGhostDraftGenerationOptions {
    postId: number | null;
    currentContent: string;
    canEditWorkingCopy: boolean;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | null;
    selectedSeededReference?: SeededReferenceSelection | null;
    sourceMaterialIds?: number[] | null;
    copy: {
        errors: {
            missingDraftContext: string;
            missingArtifact: string;
            missingContent: string;
            generateFailed: string;
            acceptFailed: string;
        };
    };
    onApplied?: (input: {
        draftText: string;
        acceptedSuggestion: GhostDraftSuggestionView | null;
        acceptedThreadIds: string[];
        workingCopyContent: string;
        workingCopyHash: string;
        workingCopyUpdatedAt: string;
        mode: 'AUTO_FILL' | 'ACCEPT_SUGGESTION';
        shouldReplaceLiveDoc: boolean;
        heatScore: number;
    }) => Promise<void> | void;
}

interface GhostDraftState {
    status: GhostDraftStatus;
    candidate: GhostDraftCandidateView | null;
    error: string | null;
    pendingJobId: number | null;
}

interface GhostDraftJobEnvelope {
    jobId: number;
    status: string;
    postId: number;
    autoApplyRequested: boolean;
}

interface GhostDraftJobSnapshot {
    jobId: number;
    status: string;
    result: Record<string, unknown> | null;
    error: {
        code: string | null;
        message: string | null;
    } | null;
}

interface GhostDraftJobListResponse {
    ok: true;
    jobs: any[];
}

interface GhostDraftApplyOutcome {
    ok: boolean;
    status: GhostDraftStatus;
}

function normalizeSuggestion(payload: GQLGhostDraftSuggestion | null | undefined): GhostDraftSuggestionView | null {
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

function normalizeCandidate(payload: GQLGhostDraftResult | null | undefined): GhostDraftCandidateView | null {
    if (!payload) return null;
    const suggestions = Array.isArray(payload?.suggestions)
        ? payload.suggestions
            .map((suggestion) => normalizeSuggestion(suggestion))
            .filter((suggestion): suggestion is GhostDraftSuggestionView => Boolean(suggestion))
        : [];
    const draftText = String(payload?.draftText || '').trim();
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
    payload: GhostDraftJobResponse['generateGhostDraft'] | null | undefined,
): GhostDraftJobEnvelope | null {
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

function toJobSnapshot(payload: any): GhostDraftJobSnapshot | null {
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function useGhostDraftGeneration(options: UseGhostDraftGenerationOptions) {
    const [state, setState] = useState<GhostDraftState>({
        status: 'idle',
        candidate: null,
        error: null,
        pendingJobId: null,
    });
    const [runGenerateGhostDraft] = useMutation<GhostDraftJobResponse>(GENERATE_GHOST_DRAFT);
    const [runAcceptGhostDraft] = useMutation<AcceptGhostDraftResponse>(ACCEPT_GHOST_DRAFT);
    const latestCurrentContentRef = useRef(String(options.currentContent || ''));
    const latestCanEditWorkingCopyRef = useRef(Boolean(options.canEditWorkingCopy));
    const latestWorkingCopyHashRef = useRef(String(options.workingCopyHash || ''));
    const latestWorkingCopyUpdatedAtRef = useRef(String(options.workingCopyUpdatedAt || ''));
    const latestSelectedSeededReferenceRef = useRef<SeededReferenceSelection | null>(options.selectedSeededReference || null);
    const latestSourceMaterialIdsRef = useRef<number[]>(
        Array.isArray(options.sourceMaterialIds)
            ? options.sourceMaterialIds
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0)
            : [],
    );
    const latestOnAppliedRef = useRef(options.onApplied);
    const pendingJobIdRef = useRef<number | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const pollTimerRef = useRef<number | null>(null);
    const queryApiBaseUrl = useMemo(
        () => getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL),
        [],
    );

    useEffect(() => {
        latestCurrentContentRef.current = String(options.currentContent || '');
        latestCanEditWorkingCopyRef.current = Boolean(options.canEditWorkingCopy);
        latestWorkingCopyHashRef.current = String(options.workingCopyHash || '');
        latestWorkingCopyUpdatedAtRef.current = String(options.workingCopyUpdatedAt || '');
        latestSelectedSeededReferenceRef.current = options.selectedSeededReference || null;
        latestSourceMaterialIdsRef.current = Array.isArray(options.sourceMaterialIds)
            ? options.sourceMaterialIds
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0)
            : [];
        latestOnAppliedRef.current = options.onApplied;
    }, [
        options.canEditWorkingCopy,
        options.currentContent,
        options.onApplied,
        options.selectedSeededReference,
        options.sourceMaterialIds,
        options.workingCopyHash,
        options.workingCopyUpdatedAt,
    ]);

    const canSafelyAutoApply = options.canEditWorkingCopy && !String(options.currentContent || '').trim();

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

    useEffect(() => {
        return () => {
            stopMonitoringJob();
        };
    }, [stopMonitoringJob]);

    const applyCandidate = useCallback(async (
        candidate: GhostDraftCandidateView,
        suggestion: GhostDraftSuggestionView,
        mode: 'AUTO_FILL' | 'ACCEPT_SUGGESTION',
    ): Promise<GhostDraftApplyOutcome> => {
        if (mode === 'AUTO_FILL' && !latestCanEditWorkingCopyRef.current) {
            return {
                ok: false,
                status: 'candidate',
            };
        }

        const acceptance = await runAcceptGhostDraft({
            variables: {
                input: {
                    postId: candidate.postId,
                    generationId: candidate.generationId,
                    suggestionId: suggestion.suggestionId,
                    mode,
                    workingCopyHash: latestWorkingCopyHashRef.current || null,
                    workingCopyUpdatedAt: latestWorkingCopyUpdatedAtRef.current || null,
                },
            },
        });
        const payload = acceptance.data?.acceptGhostDraft;
        if (!payload) {
            return {
                ok: false,
                status: 'candidate',
            };
        }

        await latestOnAppliedRef.current?.({
            draftText: candidate.draftText,
            acceptedSuggestion: normalizeSuggestion(payload.acceptedSuggestion) || suggestion,
            acceptedThreadIds: Array.isArray(payload.acceptedThreadIds)
                ? payload.acceptedThreadIds.map((value) => String(value || '').trim()).filter(Boolean)
                : [],
            workingCopyContent: payload.workingCopyContent,
            workingCopyHash: payload.workingCopyHash,
            workingCopyUpdatedAt: payload.updatedAt,
            mode,
            shouldReplaceLiveDoc:
                payload.applied
                && (
                    mode === 'ACCEPT_SUGGESTION'
                    || String(latestCurrentContentRef.current || '').trim().length > 0
                ),
            heatScore: Number(payload.heatScore || 0),
        });
        return {
            ok: Boolean(payload.acceptanceId || payload.applied),
            status: payload.applied
                ? 'applied'
                : (mode === 'ACCEPT_SUGGESTION' && payload.acceptanceId ? 'accepted' : 'candidate'),
        };
    }, [runAcceptGhostDraft]);

    const fetchGhostDraftCandidate = useCallback(async (
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
                    throw new Error(options.copy.errors.missingContent);
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
            : new Error(options.copy.errors.missingContent);
    }, [options.copy.errors.missingContent, queryApiBaseUrl]);

    const fetchJobSnapshot = useCallback(async (jobId: number) => {
        const payload = await fetchAiJobPayload<{ ok: true; job: any }>({
            queryApiBaseUrl,
            jobId,
        });
        return toJobSnapshot(payload.job);
    }, [queryApiBaseUrl]);

    const fetchLatestGhostDraftJobSnapshot = useCallback(async (
        postId: number,
        preferredJobId?: number | null,
    ) => {
        const payload = await fetchDraftAiJobsPayload<GhostDraftJobListResponse>({
            queryApiBaseUrl,
            postId,
            limit: 10,
        });
        const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
        const ghostDraftJobs = jobs
            .map((job) => ({
                jobType: String(job?.jobType || '').trim(),
                snapshot: toJobSnapshot(job),
            }))
            .filter((entry): entry is { jobType: string; snapshot: GhostDraftJobSnapshot } => (
                entry.jobType === 'ghost_draft_generate' && Boolean(entry.snapshot)
            ));

        if (preferredJobId && Number.isFinite(preferredJobId) && preferredJobId > 0) {
            const preferred = ghostDraftJobs.find((entry) => entry.snapshot.jobId === preferredJobId);
            if (preferred) {
                return preferred.snapshot;
            }
        }

        return ghostDraftJobs[0]?.snapshot || null;
    }, [queryApiBaseUrl]);

    const handleCompletedJob = useCallback(async (snapshot: GhostDraftJobSnapshot) => {
        const generationId = Number(snapshot.result?.generationId ?? 0);
        if (!Number.isFinite(generationId) || generationId <= 0) {
            throw new Error(options.copy.errors.missingArtifact);
        }
        const candidate = await fetchGhostDraftCandidate(generationId, {
            attempts: 4,
            retryDelayMs: 250,
        });

        if (Boolean(snapshot.result?.autoApplied)) {
            const lifecycle = await fetchDraftLifecycle({
                draftPostId: candidate.postId,
            });
            const workingCopyContent = String(lifecycle.workingCopy?.workingCopyContent || candidate.draftText || '').trim();
            await latestOnAppliedRef.current?.({
                draftText: candidate.draftText,
                acceptedSuggestion: null,
                acceptedThreadIds: [],
                workingCopyContent,
                workingCopyHash: String(lifecycle.workingCopy?.workingCopyHash || snapshot.result?.workingCopyHash || ''),
                workingCopyUpdatedAt: String(lifecycle.workingCopy?.updatedAt || snapshot.result?.updatedAt || ''),
                mode: 'AUTO_FILL',
                shouldReplaceLiveDoc: String(latestCurrentContentRef.current || '').trim().length > 0,
                heatScore: Number(snapshot.result?.heatScore ?? 0),
            });
            setState({
                status: 'applied',
                candidate,
                error: null,
                pendingJobId: null,
            });
            return;
        }

        setState({
            status: 'candidate',
            candidate,
            error: null,
            pendingJobId: null,
        });
    }, [fetchGhostDraftCandidate, options.copy.errors.missingArtifact]);

    const handleJobSnapshot = useCallback(async (snapshot: GhostDraftJobSnapshot) => {
        const postId = options.postId;
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
                error: snapshot.error?.message || options.copy.errors.generateFailed,
                pendingJobId: null,
            });
            return;
        }

        if (snapshot.status === 'succeeded') {
            try {
                await handleCompletedJob(snapshot);
            } catch (error) {
                try {
                    if (postId && Number.isFinite(postId)) {
                        const recoveredSnapshot = await fetchLatestGhostDraftJobSnapshot(postId, snapshot.jobId);
                        if (recoveredSnapshot?.status === 'succeeded') {
                            await handleCompletedJob(recoveredSnapshot);
                            return;
                        }
                    }
                } catch {
                    // Fall back to the original error state below.
                }

                setState({
                    status: 'error',
                    candidate: null,
                    error: error instanceof Error ? error.message : options.copy.errors.generateFailed,
                    pendingJobId: null,
                });
            }
        }
    }, [
        fetchLatestGhostDraftJobSnapshot,
        handleCompletedJob,
        options.copy.errors.generateFailed,
        options.postId,
        stopMonitoringJob,
    ]);

    const schedulePoll = useCallback((jobId: number) => {
        if (typeof window === 'undefined') return;
        if (pollTimerRef.current !== null) {
            window.clearTimeout(pollTimerRef.current);
        }

        pollTimerRef.current = window.setTimeout(async () => {
            try {
                const snapshot = await fetchJobSnapshot(jobId);
                if (!snapshot) {
                    throw new Error('ai job not found');
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
                    error: error instanceof Error ? error.message : options.copy.errors.generateFailed,
                    pendingJobId: null,
                });
            }
        }, 1200);
    }, [fetchJobSnapshot, handleJobSnapshot, options.copy.errors.generateFailed, stopMonitoringJob]);

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
            let payload: GhostDraftJobSnapshot | null = null;
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

    const generateGhostDraft = useCallback(async () => {
        if (!options.postId || !Number.isFinite(options.postId)) {
            setState({
                status: 'error',
                candidate: null,
                error: options.copy.errors.missingDraftContext,
                pendingJobId: null,
            });
            return null;
        }

        setState({
            status: 'pending',
            candidate: null,
            error: null,
            pendingJobId: null,
        });

        try {
            const input: GhostDraftGenerateInput = {
                postId: options.postId,
                preferAutoApply: false,
                workingCopyHash: latestWorkingCopyHashRef.current || null,
                workingCopyUpdatedAt: latestWorkingCopyUpdatedAtRef.current || null,
                seededReference: latestSelectedSeededReferenceRef.current
                    ? {
                        path: latestSelectedSeededReferenceRef.current.path,
                        line: latestSelectedSeededReferenceRef.current.line,
                    }
                    : null,
                sourceMaterialIds: latestSourceMaterialIdsRef.current,
            };
            const result = await runGenerateGhostDraft({
                variables: {
                    input,
                },
            });
            const envelope = normalizeJobEnvelope(result.data?.generateGhostDraft);
            if (!envelope) {
                throw new Error('AI 没有返回有效的任务信息。');
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
                error: error instanceof Error ? error.message : options.copy.errors.generateFailed,
                pendingJobId: null,
            });
            return null;
        }
    }, [
        options.copy.errors.generateFailed,
        options.copy.errors.missingDraftContext,
        options.postId,
        runGenerateGhostDraft,
        startMonitoringJob,
        stopMonitoringJob,
    ]);

    useEffect(() => {
        stopMonitoringJob();
        const postId = options.postId;

        if (!postId || !Number.isFinite(postId)) {
            setState({
                status: 'idle',
                candidate: null,
                error: null,
                pendingJobId: null,
            });
            return;
        }

        let cancelled = false;
        setState({
            status: 'idle',
            candidate: null,
            error: null,
            pendingJobId: null,
        });

        void (async () => {
            try {
                const recoveredSnapshot = await fetchLatestGhostDraftJobSnapshot(postId);
                if (!recoveredSnapshot || cancelled) return;
                if (recoveredSnapshot.status === 'queued' || recoveredSnapshot.status === 'running') {
                    setState({
                        status: 'pending',
                        candidate: null,
                        error: null,
                        pendingJobId: recoveredSnapshot.jobId,
                    });
                    startMonitoringJob(recoveredSnapshot.jobId);
                    return;
                }
                if (recoveredSnapshot.status === 'succeeded') {
                    await handleCompletedJob(recoveredSnapshot);
                }
            } catch {
                if (cancelled) return;
            }
        })();

        return () => {
            cancelled = true;
            stopMonitoringJob();
        };
    }, [fetchLatestGhostDraftJobSnapshot, handleCompletedJob, options.postId, startMonitoringJob, stopMonitoringJob]);

    const acceptSuggestion = useCallback(async (suggestion: GhostDraftSuggestionView) => {
        if (!state.candidate) return;
        try {
            const outcome = await applyCandidate(state.candidate, suggestion, 'ACCEPT_SUGGESTION');
            setState({
                status: outcome.status,
                candidate: state.candidate,
                error: null,
                pendingJobId: null,
            });
        } catch (error) {
            setState({
                status: 'error',
                candidate: state.candidate,
                error: error instanceof Error ? error.message : options.copy.errors.acceptFailed,
                pendingJobId: null,
            });
        }
    }, [applyCandidate, options.copy.errors.acceptFailed, state.candidate]);

    const ignoreCandidate = useCallback(() => {
        setState({
            status: 'idle',
            candidate: null,
            error: null,
            pendingJobId: null,
        });
    }, []);

    const retryGhostDraft = useCallback(async () => {
        return generateGhostDraft();
    }, [generateGhostDraft]);

    return useMemo(() => ({
        status: state.status,
        candidate: state.candidate,
        error: state.error,
        pendingJobId: state.pendingJobId,
        canSafelyAutoApply,
        generateGhostDraft,
        acceptSuggestion,
        ignoreCandidate,
        retryGhostDraft,
    }), [
        acceptSuggestion,
        canSafelyAutoApply,
        generateGhostDraft,
        ignoreCandidate,
        retryGhostDraft,
        state.candidate,
        state.error,
        state.pendingJobId,
        state.status,
    ]);
}

export default useGhostDraftGeneration;
