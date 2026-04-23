import { EventEmitter } from 'events';

import type { AiJobRecord } from './types';

const streamEmitter = new EventEmitter();
streamEmitter.setMaxListeners(0);

export interface AiJobStreamEvent {
    jobId: number;
    jobType: AiJobRecord['jobType'];
    scopeType: AiJobRecord['scopeType'];
    scopeDraftPostId: number | null;
    scopeCircleId: number | null;
    requestedByUserId: number | null;
    status: AiJobRecord['status'];
    attempts: number;
    maxAttempts: number;
    result: Record<string, unknown> | null;
    error: {
        code: string | null;
        message: string | null;
    } | null;
    updatedAt: string;
    completedAt: string | null;
}

function getChannelName(jobId: number): string {
    return `ai-job:${jobId}`;
}

function sanitizeAiJobResult(result: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const allowedKeys = new Set([
        'generationId',
        'postId',
        'model',
        'autoApplied',
        'acceptanceId',
        'changed',
        'acceptanceMode',
        'workingCopyHash',
        'updatedAt',
        'heatScore',
        'triggered',
        'reason',
        'draftPostId',
        'circleId',
    ]);
    return Object.fromEntries(
        Object.entries(result).filter(([key]) => allowedKeys.has(key)),
    );
}

export function toAiJobStreamEvent(job: AiJobRecord): AiJobStreamEvent {
    return {
        jobId: job.id,
        jobType: job.jobType,
        scopeType: job.scopeType,
        scopeDraftPostId: job.scopeDraftPostId,
        scopeCircleId: job.scopeCircleId,
        requestedByUserId: job.requestedByUserId,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        result: sanitizeAiJobResult(job.result),
        error: job.lastErrorCode || job.lastErrorMessage
            ? {
                code: job.lastErrorCode,
                message: job.lastErrorMessage,
            }
            : null,
        updatedAt: job.updatedAt.toISOString(),
        completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    };
}

export function publishAiJobStreamEvent(job: AiJobRecord): void {
    streamEmitter.emit(getChannelName(job.id), toAiJobStreamEvent(job));
}

export function subscribeToAiJobStream(
    jobId: number,
    listener: (event: AiJobStreamEvent) => void,
): () => void {
    const channel = getChannelName(jobId);
    streamEmitter.on(channel, listener);
    return () => {
        streamEmitter.off(channel, listener);
    };
}

export function serializeAiJobSseEvent(event: AiJobStreamEvent): string {
    return `event: ai-job\ndata: ${JSON.stringify(event)}\n\n`;
}
