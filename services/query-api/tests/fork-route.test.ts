import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { forkRouter } from '../src/rest/fork';
import * as forkReadModel from '../src/services/fork/readModel';
import * as forkRuntime from '../src/services/fork/runtime';

function getRouteHandler(router: Router, path: string, method: 'get' | 'post') {
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

function makeQualifiedSnapshot() {
    return {
        thresholdMode: 'contribution_threshold',
        minimumContributions: 3,
        contributorCount: 4,
        minimumRole: 'Member',
        actorRole: 'Moderator',
        actorIdentityLevel: 'Member',
        requiresGovernanceVote: false,
        qualifies: true,
        qualificationStatus: 'qualified',
    } as any;
}

describe('fork route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('creates a fork as attached filing and returns lineage on success', async () => {
        jest.spyOn(forkRuntime, 'resolveForkQualification').mockResolvedValue(makeQualifiedSnapshot());
        jest.spyOn(forkRuntime, 'createForkCircle').mockResolvedValue({
            declaration: {
                declarationId: 'fork-declaration-1',
                sourceCircleId: 7,
                targetCircleId: 71,
                actorUserId: 11,
                declarationText: '需要沿着不同的未来方向继续。',
                originAnchorRef: 'knowledge:alpha',
                qualificationSnapshot: makeQualifiedSnapshot(),
                status: 'completed',
                executionAnchorDigest: null,
                createdAt: new Date('2026-03-22T19:00:00.000Z'),
                updatedAt: new Date('2026-03-22T19:00:00.000Z'),
            },
            lineage: {
                lineageId: 'fork-lineage-1',
                sourceCircleId: 7,
                targetCircleId: 71,
                declarationId: 'fork-declaration-1',
                createdBy: 11,
                originAnchorRef: 'knowledge:alpha',
                inheritanceSnapshot: {
                    sourceType: 'inherited_editable',
                    inheritanceMode: 'inherit_but_editable',
                },
                executionAnchorDigest: null,
                createdAt: new Date('2026-03-22T19:00:00.000Z'),
                updatedAt: new Date('2026-03-22T19:00:00.000Z'),
            },
            reconciliationPending: false,
        } as any);

        const router = forkRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:sourceCircleId/forks', 'post');
        const req = {
            userId: 11,
            params: { sourceCircleId: '7' },
            body: {
                declarationId: 'fork-declaration-1',
                declarationText: '需要沿着不同的未来方向继续。',
                originAnchorRef: 'knowledge:alpha',
                targetCircleId: 71,
                inheritanceSnapshot: {
                    sourceType: 'inherited_editable',
                    inheritanceMode: 'inherit_but_editable',
                },
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.declaration.declarationId).toBe('fork-declaration-1');
        expect(res.payload.lineage.targetCircleId).toBe(71);
    });

    test('allows prepare-only filing before the target circle id exists', async () => {
        const qualificationSpy = jest.spyOn(forkRuntime, 'resolveForkQualification')
            .mockResolvedValue(makeQualifiedSnapshot());
        const createSpy = jest.spyOn(forkRuntime, 'createForkCircle').mockResolvedValue({
            declaration: {
                declarationId: 'fork-declaration-attached',
                sourceCircleId: 7,
                targetCircleId: null,
                actorUserId: 11,
                declarationText: '先准备 attached filing，再等待钱包签名创建圈层。',
                originAnchorRef: 'circle:7',
                qualificationSnapshot: makeQualifiedSnapshot(),
                status: 'attached',
                executionAnchorDigest: null,
                createdAt: new Date('2026-03-22T19:05:00.000Z'),
                updatedAt: new Date('2026-03-22T19:05:00.000Z'),
            },
            lineage: null,
            reconciliationPending: false,
        } as any);

        const router = forkRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:sourceCircleId/forks', 'post');
        const req = {
            userId: 11,
            params: { sourceCircleId: '7' },
            body: {
                declarationId: 'fork-declaration-attached',
                declarationText: '先准备 attached filing，再等待钱包签名创建圈层。',
                originAnchorRef: 'circle:7',
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.declaration.status).toBe('attached');
        expect(res.payload.declaration.targetCircleId).toBeNull();
        expect(qualificationSpy).toHaveBeenCalled();
        expect(createSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                declarationId: 'fork-declaration-attached',
                targetCircleId: null,
            }),
        );
    });

    test('returns reconciliation-pending instead of 500 when off-chain lineage repair is deferred', async () => {
        jest.spyOn(forkRuntime, 'resolveForkQualification').mockResolvedValue(makeQualifiedSnapshot());
        jest.spyOn(forkRuntime, 'createForkCircle').mockResolvedValue({
            declaration: {
                declarationId: 'fork-declaration-repair',
                sourceCircleId: 7,
                targetCircleId: 72,
                actorUserId: 11,
                declarationText: '链上已经成功，线下谱系稍后补齐。',
                originAnchorRef: 'summary:branch-1',
                qualificationSnapshot: makeQualifiedSnapshot(),
                status: 'reconciliation_pending',
                executionAnchorDigest: 'digest-fork-anchor-1',
                createdAt: new Date('2026-03-22T19:10:00.000Z'),
                updatedAt: new Date('2026-03-22T19:10:00.000Z'),
            },
            lineage: null,
            reconciliationPending: true,
        } as any);

        const router = forkRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:sourceCircleId/forks', 'post');
        const req = {
            userId: 11,
            params: { sourceCircleId: '7' },
            body: {
                declarationId: 'fork-declaration-repair',
                declarationText: '链上已经成功，线下谱系稍后补齐。',
                originAnchorRef: 'summary:branch-1',
                targetCircleId: 72,
                inheritanceSnapshot: {
                    sourceType: 'inherited_locked',
                    inheritanceMode: 'inherit_locked',
                },
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.reconciliationPending).toBe(true);
        expect(res.payload.declaration.status).toBe('reconciliation_pending');
    });

    test('reads fork lineage through the dedicated public exit', async () => {
        jest.spyOn(forkReadModel, 'loadForkLineageView').mockResolvedValue({
            circleId: 7,
            asSource: [
                {
                    lineageId: 'fork-lineage-1',
                    sourceCircleId: 7,
                    targetCircleId: 71,
                    declarationId: 'fork-declaration-1',
                    sourceCircleName: 'Source Circle',
                    targetCircleName: 'Forked Circle',
                    declarationText: '需要沿着不同的未来方向继续。',
                    status: 'completed',
                    originAnchorRef: 'knowledge:alpha',
                    executionAnchorDigest: null,
                    createdAt: '2026-03-22T19:00:00.000Z',
                },
            ],
            asTarget: [],
        } as any);

        const router = forkRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:circleId/lineage', 'get');
        const req = {
            params: { circleId: '7' },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.asSource).toHaveLength(1);
        expect(res.payload.asSource[0].targetCircleId).toBe(71);
    });
});
