import { afterEach, beforeEach, describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storageRouter } from '../src/rest/storage';
import * as draftLifecycleReadModelService from '../src/services/draftLifecycle/readModel';
import { buildPrivateTextLocator, loadPrivateText } from '../src/services/privateContentBridge';
import { sha256Hex } from '../src/services/sourceMaterials/uploadBridge';

function createPrismaMock() {
    let draft = {
        id: 42,
        authorId: 9,
        circleId: 7,
        status: 'Draft',
    };
    let membership = {
        role: 'Moderator',
        status: 'Active',
        identityLevel: 'Member',
    };
    let circle = {
        creatorId: 9,
    };
    let policyRow: any = null;

    return {
        setDraft(nextDraft: typeof draft) {
            draft = nextDraft;
        },
        setMembership(nextMembership: typeof membership) {
            membership = nextMembership;
        },
        setCircle(nextCircle: typeof circle) {
            circle = nextCircle;
        },
        setPolicyRow(nextPolicyRow: any) {
            policyRow = nextPolicyRow;
        },
        post: {
            findUnique: jest.fn(async () => draft),
            update: jest.fn(async () => ({ id: 42 })),
        },
        circle: {
            findUnique: jest.fn(async () => circle),
        },
        circleMember: {
            findUnique: jest.fn(async () => membership),
        },
        $queryRaw: jest.fn(async (...args: any[]) => {
            const query = args[0];
            const queryText = Array.isArray(query?.strings)
                ? query.strings.join(' ')
                : String(query || '');
            if (queryText.includes('FROM circle_policy_profiles')) {
                return policyRow ? [policyRow] : [];
            }
            return [];
        }),
    };
}

function getFinalDocumentHandler(router: Router) {
    const layer = (router as any).stack.find((item: any) => item.route?.path === '/drafts/:postId/final-document');
    if (!layer?.route?.stack?.[0]?.handle) {
        throw new Error('storage final-document route handler not found');
    }
    return layer.route.stack[0].handle;
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

describe('storage upload bridge', () => {
    const originalEndpoint = process.env.STORAGE_UPLOAD_ENDPOINT;
    const originalBearer = process.env.STORAGE_UPLOAD_BEARER_TOKEN;
    const originalMode = process.env.STORAGE_UPLOAD_MODE;
    const originalPrivateRoot = process.env.PRIVATE_CONTENT_STORE_ROOT;
    let prisma: ReturnType<typeof createPrismaMock>;
    let handler: ReturnType<typeof getFinalDocumentHandler>;

    beforeEach(() => {
        prisma = createPrismaMock();
        handler = getFinalDocumentHandler(storageRouter(prisma as any, {} as any));
        jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallization_active',
            } as any);
        delete (global as any).fetch;
    });

    afterEach(() => {
        process.env.STORAGE_UPLOAD_ENDPOINT = originalEndpoint;
        process.env.STORAGE_UPLOAD_BEARER_TOKEN = originalBearer;
        process.env.STORAGE_UPLOAD_MODE = originalMode;
        process.env.PRIVATE_CONTENT_STORE_ROOT = originalPrivateRoot;
        delete (global as any).fetch;
    });

    test('uploads finalized draft document and returns canonical ipfs uri', async () => {
        process.env.STORAGE_UPLOAD_ENDPOINT = 'https://storage.example/upload';
        process.env.STORAGE_UPLOAD_BEARER_TOKEN = 'secret-token';
        const upstream = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ IpfsHash: 'bafybeigdyrzt4storagebridgeexamplecid' }),
        })) as any;
        (global as any).fetch = upstream;

        const req = {
            params: { postId: '42' },
            body: {
                title: 'Draft Crystal',
                document: '{"version":1,"title":"Draft Crystal","content":"final text"}',
            },
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
            circleId: 7,
            uri: 'ipfs://bafybeigdyrzt4storagebridgeexamplecid',
            storageProvider: 'ipfs',
        });
        expect(next).not.toHaveBeenCalled();
        expect(upstream).toHaveBeenCalledWith(
            'https://storage.example/upload',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer secret-token',
                    'Content-Type': 'application/json',
                }),
            }),
        );
        expect(prisma.post.update).not.toHaveBeenCalled();
    });

    test('rejects when storage provider is not configured', async () => {
        delete process.env.STORAGE_UPLOAD_ENDPOINT;
        delete process.env.STORAGE_UPLOAD_MODE;
        const req = {
            params: { postId: '42' },
            body: {
                title: 'Draft Crystal',
                document: '{"version":1,"title":"Draft Crystal","content":"final text"}',
            },
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(503);
        expect(res.payload).toMatchObject({
            error: 'storage_provider_unavailable',
        });
        expect(next).not.toHaveBeenCalled();
        expect(prisma.post.update).not.toHaveBeenCalled();
    });

    test('stores finalized draft document locally when storage upload mode is local', async () => {
        delete process.env.STORAGE_UPLOAD_ENDPOINT;
        process.env.STORAGE_UPLOAD_MODE = 'local';
        process.env.PRIVATE_CONTENT_STORE_ROOT = await mkdtemp(join(tmpdir(), 'alcheme-storage-upload-test-'));
        const document = '{"version":1,"title":"Draft Crystal","content":"final text"}';

        const req = {
            params: { postId: '42' },
            body: {
                title: 'Draft Crystal',
                document,
            },
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        const digest = sha256Hex(document);
        const locator = buildPrivateTextLocator(
            'draft-crystallization',
            'final-document',
            '42',
            digest,
        );

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
            circleId: 7,
            uri: `ipfs://local-draft-${digest}`,
            storageProvider: 'local',
        });
        await expect(loadPrivateText(locator)).resolves.toBe(document);
        expect(next).not.toHaveBeenCalled();
    });

    test('prefers explicit storage upload endpoint over local mode', async () => {
        process.env.STORAGE_UPLOAD_ENDPOINT = 'https://storage.example/upload';
        process.env.STORAGE_UPLOAD_MODE = 'local';
        const upstream = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ IpfsHash: 'bafybeigdyrzt4storagebridgeexamplecid' }),
        })) as any;
        (global as any).fetch = upstream;

        const req = {
            params: { postId: '42' },
            body: {
                title: 'Draft Crystal',
                document: '{"version":1,"title":"Draft Crystal","content":"final text"}',
            },
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            uri: 'ipfs://bafybeigdyrzt4storagebridgeexamplecid',
            storageProvider: 'ipfs',
        });
        expect(upstream).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('allows initiates to upload finalized draft document when circle policy grants crystallization permission', async () => {
        process.env.STORAGE_UPLOAD_ENDPOINT = 'https://storage.example/upload';
        prisma.setMembership({
            role: 'Member',
            status: 'Active',
            identityLevel: 'Initiate',
        });
        prisma.setPolicyRow({
            circleId: 7,
            sourceType: 'circle_override',
            inheritanceMode: 'independent',
            inheritsFromProfileId: null,
            inheritsFromCircleId: null,
            draftGenerationPolicy: null,
            draftLifecycleTemplate: null,
            draftWorkflowPolicy: {
                createIssueMinRole: 'Member',
                followupIssueMinRole: 'Member',
                reviewIssueMinRole: 'Moderator',
                retagIssueMinRole: 'Moderator',
                applyIssueMinRole: 'Admin',
                manualEndDraftingMinRole: 'Moderator',
                advanceFromReviewMinRole: 'Admin',
                enterCrystallizationMinRole: 'Initiate',
                allowAuthorWithdrawBeforeReview: true,
                allowModeratorRetagIssue: true,
            },
            blockEditEligibilityPolicy: null,
            forkPolicy: null,
            ghostPolicy: null,
            localEditability: 'editable',
            effectiveFrom: new Date('2026-03-20T00:00:00.000Z'),
            resolvedFromProfileVersion: 1,
            configVersion: 1,
        });
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ IpfsHash: 'bafybeigdyrzt4storagebridgeexamplecid' }),
        }));

        const req = {
            params: { postId: '42' },
            body: {
                title: 'Draft Crystal',
                document: '{"version":1,"title":"Draft Crystal","content":"final text"}',
            },
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
        });
        expect(next).not.toHaveBeenCalled();
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects final document upload before the draft has entered crystallization_active', async () => {
        process.env.STORAGE_UPLOAD_ENDPOINT = 'https://storage.example/upload';
        jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
            } as any);
        (global as any).fetch = jest.fn();

        const req = {
            params: { postId: '42' },
            body: {
                title: 'Draft Crystal',
                document: '{"version":1,"title":"Draft Crystal","content":"final text"}',
            },
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'draft_not_ready_for_crystallization_execution',
        });
        expect((global as any).fetch).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
