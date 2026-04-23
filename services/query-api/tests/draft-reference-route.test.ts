import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { draftReferencesRouter } from '../src/rest/draftReferences';
import * as draftReferenceReadModel from '../src/services/draftReferences/readModel';

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

describe('draft reference route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('publishes one formal DraftReferenceLink read exit for draft consumers', async () => {
        const loadSpy = jest.spyOn(draftReferenceReadModel, 'loadDraftReferenceLinks').mockResolvedValue([
            {
                referenceId: 'ref-1',
                draftPostId: 42,
                draftVersion: 4,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Seed Crystal',
                crystalBlockAnchor: 'anchor-1',
                status: 'parsed',
            },
        ]);

        const router = draftReferencesRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/:postId/reference-links', 'get');
        const req = {
            params: { postId: '42' },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(loadSpy).toHaveBeenCalledWith(expect.anything(), 42);
        expect(res.payload.referenceLinks[0].referenceId).toBe('ref-1');
    });
});
