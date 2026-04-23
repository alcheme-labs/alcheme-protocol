import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const acceptDraftCandidateIntoDraftMock = jest.fn();

jest.mock('../src/services/discussion/candidateAcceptance', () => ({
    acceptDraftCandidateIntoDraft: acceptDraftCandidateIntoDraftMock,
    DraftCandidateAcceptanceError: class DraftCandidateAcceptanceError extends Error {
        statusCode: number;
        code: string;

        constructor(input: { statusCode: number; code: string; message: string }) {
            super(input.message);
            this.statusCode = input.statusCode;
            this.code = input.code;
        }
    },
}));

import { discussionRouter } from '../src/rest/discussion';

function getRouteHandler(router: Router, path: string, method: 'post') {
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

describe('discussion candidate route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (acceptDraftCandidateIntoDraftMock as any).mockResolvedValue({
            candidateId: 'cand_001',
            draftPostId: 88,
            created: true,
            ghostDraftGenerationId: 301,
        });
    });

    test('creates a draft from a candidate notice', async () => {
        const prisma = {} as any;
        const router = discussionRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:circleId/candidates/:candidateId/create-draft', 'post');
        const res = createMockResponse();
        const next = jest.fn();

        await handler({
            params: { circleId: '7', candidateId: 'cand_001' },
            userId: 19,
        } as any, res as any, next);

        expect(acceptDraftCandidateIntoDraftMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });
        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({
            ok: true,
            result: {
                candidateId: 'cand_001',
                draftPostId: 88,
                created: true,
                ghostDraftGenerationId: 301,
            },
        });
        expect(next).not.toHaveBeenCalled();
    });
});
