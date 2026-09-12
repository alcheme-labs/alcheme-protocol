import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    requireCircleManagerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { authorizeAiJobReadForActor } from '../services/aiJobs/access';
import { listAiJobs, loadAiJobById, toAiJobView } from '../services/aiJobs/readModel';
import {
    serializeAiJobSseEvent,
    subscribeToAiJobStream,
    toAiJobStreamEvent,
} from '../services/aiJobs/stream';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseBoolLike(value: unknown): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function aiJobsRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const streamPollMs = Math.max(250, Number(process.env.AI_JOB_STREAM_POLL_MS || 1_000));

    router.get('/', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });

            const draftPostId = parsePositiveInt(req.query.draftPostId);
            const circleId = parsePositiveInt(req.query.circleId);
            const requestedByMe = parseBoolLike(req.query.requestedByMe);
            const limit = parsePositiveInt(req.query.limit) ?? 20;

            if (draftPostId) {
                const access = await authorizeDraftActionForActor(prisma as any, {
                    actor,
                    postId: draftPostId,
                    action: 'read',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }

                const jobs = await listAiJobs(prisma as any, {
                    scopeType: 'draft',
                    scopeDraftPostId: draftPostId,
                    limit,
                });
                return res.status(200).json({
                    ok: true,
                    jobs: jobs.map(toAiJobView),
                });
            }

            if (circleId) {
                await requireCircleManagerForActor(prisma as any, {
                    actor,
                    circleId,
                });

                const jobs = await listAiJobs(prisma as any, {
                    scopeType: 'circle',
                    scopeCircleId: circleId,
                    limit,
                });
                return res.status(200).json({
                    ok: true,
                    jobs: jobs.map(toAiJobView),
                });
            }

            if (requestedByMe) {
                const pageSize = Math.max(1, limit);
                let offset = 0;
                const authorized = [] as Awaited<ReturnType<typeof listAiJobs>>;

                while (authorized.length < limit) {
                    const page = await listAiJobs(prisma as any, {
                        requestedByUserId: actor.userId,
                        limit: pageSize,
                        offset,
                    });
                    if (!page.length) break;

                    const authorizedPage = (
                        await Promise.all(
                            page.map(async (job) => {
                                const access = await authorizeAiJobReadForActor(prisma as any, {
                                    job,
                                    actor,
                                });
                                return access.allowed ? job : null;
                            }),
                        )
                    ).filter((job): job is NonNullable<typeof job> => Boolean(job));
                    authorized.push(...authorizedPage);

                    if (page.length < pageSize) break;
                    offset += page.length;
                }
                return res.status(200).json({
                    ok: true,
                    jobs: authorized.slice(0, limit).map(toAiJobView),
                });
            }

            return res.status(400).json({
                error: 'ai_job_scope_filter_required',
                message: 'provide draftPostId, circleId, or requestedByMe',
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/:jobId', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const jobId = parsePositiveInt(req.params.jobId);
            if (!jobId) {
                return res.status(400).json({ error: 'invalid_ai_job_id' });
            }

            const job = await loadAiJobById(prisma as any, jobId);
            if (!job) {
                return res.status(404).json({ error: 'ai_job_not_found' });
            }

            const access = await authorizeAiJobReadForActor(prisma as any, {
                job,
                actor,
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            return res.status(200).json({
                ok: true,
                job: toAiJobView(job),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/:jobId/stream', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const jobId = parsePositiveInt(req.params.jobId);
            if (!jobId) {
                return res.status(400).json({ error: 'invalid_ai_job_id' });
            }

            const job = await loadAiJobById(prisma as any, jobId);
            if (!job) {
                return res.status(404).json({ error: 'ai_job_not_found' });
            }

            const access = await authorizeAiJobReadForActor(prisma as any, {
                job,
                actor,
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof (res as any).flushHeaders === 'function') {
                (res as any).flushHeaders();
            }
            res.write(serializeAiJobSseEvent(toAiJobStreamEvent(job)));

            if (job.status === 'succeeded' || job.status === 'failed') {
                res.end();
                return;
            }

            let closed = false;
            let lastObservedUpdatedAt = job.updatedAt.toISOString();
            let pollTimer: NodeJS.Timeout | null = null;

            const cleanup = () => {
                if (closed) return;
                closed = true;
                unsubscribe();
                if (pollTimer) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                }
            };

            const unsubscribe = subscribeToAiJobStream(job.id, (event) => {
                if (closed) return;
                res.write(serializeAiJobSseEvent(event));
                lastObservedUpdatedAt = event.updatedAt;
                if (event.status === 'succeeded' || event.status === 'failed') {
                    cleanup();
                    res.end();
                }
            });

            pollTimer = setInterval(() => {
                void (async () => {
                    if (closed) return;
                    const latest = await loadAiJobById(prisma as any, job.id);
                    if (!latest) {
                        cleanup();
                        res.end();
                        return;
                    }
                    const updatedAt = latest.updatedAt.toISOString();
                    if (updatedAt === lastObservedUpdatedAt) {
                        return;
                    }
                    lastObservedUpdatedAt = updatedAt;
                    const event = toAiJobStreamEvent(latest);
                    res.write(serializeAiJobSseEvent(event));
                    if (event.status === 'succeeded' || event.status === 'failed') {
                        cleanup();
                        res.end();
                    }
                })().catch(() => {
                    cleanup();
                    res.end();
                });
            }, streamPollMs);

            req.on('close', () => {
                cleanup();
            });
            return;
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
