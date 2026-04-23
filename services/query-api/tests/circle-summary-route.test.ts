import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { circleSummaryRouter } from '../src/rest/circleSummary';
import * as generatorService from '../src/services/circleSummary/generator';
import * as snapshotService from '../src/services/circleSummary/snapshot';

function getRouteHandler(router: Router, path: string, method: 'get') {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === path
        && item.route?.stack?.some((entry: any) => entry.method === method),
    );
    const routeLayer = layer?.route?.stack?.find((entry: any) => entry.method === method);
    if (!routeLayer?.handle) {
        throw new Error(`route handler not found for ${method.toUpperCase()} ${path}`);
    }
    return routeLayer.handle;
}

function createMockResponse() {
    return {
        statusCode: 200,
        payload: null as any,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.payload = payload;
            return this;
        },
    };
}

function makeSnapshot() {
    return {
        summaryId: 'circle-7-v2',
        circleId: 7,
        version: 2,
        issueMap: [{ title: '主问题', body: '当前最成熟的议题入口。' }],
        conceptGraph: { nodes: [{ id: 'knowledge-1', label: '结论 A' }], edges: [] },
        viewpointBranches: [{ knowledgeId: 'knowledge-1', title: '结论 A' }],
        factExplanationEmotionBreakdown: { facts: [], explanations: [], emotions: [] },
        emotionConflictContext: { tensionLevel: 'medium', notes: ['仍有分歧'] },
        sedimentationTimeline: [],
        openQuestions: [],
        generatedAt: new Date('2026-03-21T00:15:00.000Z'),
        generatedBy: 'system_projection',
        generationMetadata: {
            providerMode: 'projection',
            model: 'projection',
            promptAsset: 'circle-summary-projection',
            promptVersion: 'v1',
            sourceDigest: 'projection-digest',
        },
    };
}

function createAccessPrisma(input: {
    creatorId?: number;
    member?: {
        role?: string;
        status?: string;
    } | null;
} = {}) {
    return {
        circle: {
            findUnique: jest.fn(async () => ({
                creatorId: input.creatorId ?? 11,
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => {
                if (input.member === null) {
                    return null;
                }
                if (input.member) {
                    return {
                        role: input.member.role ?? 'Member',
                        status: input.member.status ?? 'Active',
                    };
                }
                return null;
            }),
        },
    } as any;
}

describe('circle summary route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('rejects anonymous circle summary reads', async () => {
        const ensureSpy = jest.spyOn(generatorService, 'ensureLatestCircleSummarySnapshot');

        const router = circleSummaryRouter(createAccessPrisma(), {} as any);
        const handler = getRouteHandler(router, '/:circleId/summary-snapshots/latest', 'get');
        const req = {
            params: { circleId: '7' },
            query: {},
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(401);
        expect(res.payload).toMatchObject({ error: 'authentication_required' });
        expect(ensureSpy).not.toHaveBeenCalled();
    });

    test('serves the latest summary snapshot and only regenerates on miss/staleness/explicit request', async () => {
        const ensureSpy = jest.spyOn(generatorService, 'ensureLatestCircleSummarySnapshot').mockResolvedValue(makeSnapshot() as any);

        const router = circleSummaryRouter(createAccessPrisma({ creatorId: 11 }), {} as any);
        const handler = getRouteHandler(router, '/:circleId/summary-snapshots/latest', 'get');
        const req = {
            params: { circleId: '7' },
            query: {},
            userId: 11,
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(ensureSpy).toHaveBeenCalledWith(expect.anything(), {
            circleId: 7,
            forceGenerate: false,
        });
        expect(res.payload.snapshot.version).toBe(2);
        expect(res.payload.snapshot.generationMetadata).toMatchObject({
            providerMode: 'projection',
            model: 'projection',
            promptAsset: 'circle-summary-projection',
            promptVersion: 'v1',
            sourceDigest: 'projection-digest',
        });
    });

    test('supports explicit snapshot regeneration requests on the latest route', async () => {
        const ensureSpy = jest.spyOn(generatorService, 'ensureLatestCircleSummarySnapshot').mockResolvedValue({
            ...makeSnapshot(),
            version: 3,
            generatedBy: 'user_requested',
        } as any);

        const router = circleSummaryRouter(createAccessPrisma({ creatorId: 11 }), {} as any);
        const handler = getRouteHandler(router, '/:circleId/summary-snapshots/latest', 'get');
        const req = {
            params: { circleId: '7' },
            query: { regenerate: 'true' },
            userId: 11,
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(ensureSpy).toHaveBeenCalledWith(expect.anything(), {
            circleId: 7,
            forceGenerate: true,
        });
        expect(res.payload.snapshot.generatedBy).toBe('user_requested');
        expect(res.payload.snapshot.generationMetadata.providerMode).toBe('projection');
    });

    test('blocks non-managers from explicit summary regeneration', async () => {
        const ensureSpy = jest.spyOn(generatorService, 'ensureLatestCircleSummarySnapshot');

        const router = circleSummaryRouter(createAccessPrisma({
            creatorId: 11,
            member: {
                role: 'Member',
                status: 'Active',
            },
        }), {} as any);
        const handler = getRouteHandler(router, '/:circleId/summary-snapshots/latest', 'get');
        const req = {
            params: { circleId: '7' },
            query: { regenerate: 'true' },
            userId: 8,
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({ error: 'circle_summary_regenerate_forbidden' });
        expect(ensureSpy).not.toHaveBeenCalled();
    });

    test('serves a requested snapshot version through the formal read exit', async () => {
        const loadSpy = jest.spyOn(snapshotService, 'loadCircleSummarySnapshotByVersion').mockResolvedValue(makeSnapshot() as any);

        const router = circleSummaryRouter(createAccessPrisma({
            creatorId: 11,
            member: {
                role: 'Member',
                status: 'Active',
            },
        }), {} as any);
        const handler = getRouteHandler(router, '/:circleId/summary-snapshots/:version', 'get');
        const req = {
            params: { circleId: '7', version: '2' },
            userId: 8,
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(loadSpy).toHaveBeenCalledWith(expect.anything(), 7, 2);
        expect(res.payload.snapshot.summaryId).toBe('circle-7-v2');
        expect(res.payload.snapshot.generationMetadata.promptAsset).toBe('circle-summary-projection');
    });

    test('blocks non-members from reading summary snapshots', async () => {
        const loadSpy = jest.spyOn(snapshotService, 'loadCircleSummarySnapshotByVersion');

        const router = circleSummaryRouter(createAccessPrisma({
            creatorId: 11,
            member: null,
        }), {} as any);
        const handler = getRouteHandler(router, '/:circleId/summary-snapshots/:version', 'get');
        const req = {
            params: { circleId: '7', version: '2' },
            userId: 8,
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({ error: 'circle_summary_access_denied' });
        expect(loadSpy).not.toHaveBeenCalled();
    });
});
