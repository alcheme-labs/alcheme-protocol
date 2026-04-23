import {
    DEFAULT_DRAFT_KNOWLEDGE_BINDING_STRATEGY,
    evaluateDraftStrictBindingViolation,
    parseDraftStrictBindingMode,
    validateDraftCrystallizationRequest,
} from '../src/services/crystallizationContract';
import type { Router } from 'express';
import { crystallizationRouter } from '../src/rest/crystallization';
import * as crystallizationReadModel from '../src/services/crystallization/readModel';
import { buildCrystallizationOutputRecord } from '../src/services/crystallization/contracts';

function getRouteHandler(router: Router, path: string) {
    const layer = (router as any).stack.find((item: any) => item.route?.path === path);
    if (!layer?.route?.stack?.[0]?.handle) {
        throw new Error(`route handler not found for ${path}`);
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

describe('draft crystallization contract', () => {
    test('requires explicit binding and all deterministic fields', () => {
        const result = validateDraftCrystallizationRequest({
            draftPostId: 42,
            circleId: 7,
            bindingStrategy: DEFAULT_DRAFT_KNOWLEDGE_BINDING_STRATEGY,
            knowledgePda: 'GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ',
            storageUri: 'ipfs://bafybeigdyrzt4',
            contentHash: 'a'.repeat(64),
            title: 'Deterministic crystal',
            description: 'Finalized draft content',
        });

        expect(result.ok).toBe(true);
        expect(result.value).toMatchObject({
            draftPostId: 42,
            circleId: 7,
            bindingStrategy: 'explicit',
            knowledgePda: 'GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ',
        });
    });

    test('rejects requests with missing deterministic fields', () => {
        const result = validateDraftCrystallizationRequest({
            draftPostId: 42,
            circleId: 7,
            bindingStrategy: 'explicit',
            title: 'Missing knowledge pda',
        });

        expect(result.ok).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'knowledgePda is required',
            'storageUri is required',
            'contentHash is required',
            'description is required',
        ]));
    });

    test('rejects heuristic draft-to-knowledge matching strategies', () => {
        const result = validateDraftCrystallizationRequest({
            draftPostId: 42,
            circleId: 7,
            bindingStrategy: 'title_window',
            knowledgePda: 'GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ',
            storageUri: 'ipfs://bafybeigdyrzt4',
            contentHash: 'a'.repeat(64),
            title: 'Heuristic match',
            description: 'Should be rejected',
        });

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('bindingStrategy must be explicit');
    });

    test('parses strict binding mode from env-compatible values', () => {
        expect(parseDraftStrictBindingMode('off')).toBe('off');
        expect(parseDraftStrictBindingMode('warn')).toBe('warn');
        expect(parseDraftStrictBindingMode('enforce')).toBe('enforce');
        expect(parseDraftStrictBindingMode('unexpected')).toBe('enforce');
    });

    test('returns warning diagnostics in warn mode and blocks in enforce mode', () => {
        const warnDecision = evaluateDraftStrictBindingViolation({
            mode: 'warn',
            code: 'contribution_sync_required',
            message: 'knowledge contribution snapshot sync failed',
            enforceStatusCode: 422,
        });
        expect(warnDecision).toMatchObject({
            blocked: false,
            warning: {
                code: 'contribution_sync_required',
            },
        });

        const enforceDecision = evaluateDraftStrictBindingViolation({
            mode: 'enforce',
            code: 'contribution_sync_required',
            message: 'knowledge contribution snapshot sync failed',
            enforceStatusCode: 422,
        });
        expect(enforceDecision).toMatchObject({
            blocked: true,
            error: {
                code: 'contribution_sync_required',
            },
            statusCode: 422,
        });
    });

    test('splits output truth from binding evidence in the formal contract shape', () => {
        const record = buildCrystallizationOutputRecord({
            knowledgeId: 'knowledge-9',
            sourceDraftPostId: 42,
            sourceDraftVersion: 4,
            contentHash: '1'.repeat(64),
            contributorsRoot: '2'.repeat(64),
            createdAt: new Date('2026-03-21T00:00:00.000Z'),
            sourceAnchorId: '3'.repeat(64),
            sourceSummaryHash: '4'.repeat(64),
            sourceMessagesDigest: '5'.repeat(64),
            proofPackageHash: '6'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            bindingCreatedAt: new Date('2026-03-21T00:01:00.000Z'),
            policyProfileDigest: '7'.repeat(64),
        });

        expect(record).toMatchObject({
            output: {
                knowledgeId: 'knowledge-9',
                sourceDraftPostId: 42,
                sourceDraftVersion: 4,
                contentHash: '1'.repeat(64),
                contributorsRoot: '2'.repeat(64),
            },
            bindingEvidence: {
                sourceAnchorId: '3'.repeat(64),
                proofPackageHash: '6'.repeat(64),
                contributorsCount: 3,
                bindingVersion: 2,
            },
            policyProfileDigest: '7'.repeat(64),
        });
        expect((record?.output as any).sourceAnchorId).toBeUndefined();
        expect((record?.output as any).proofPackageHash).toBeUndefined();
    });

    test('serves formal crystallization output records through the dedicated route', async () => {
        const router = crystallizationRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/knowledge/:knowledgeId/output');
        jest.spyOn(crystallizationReadModel, 'loadCrystallizationOutputRecordByKnowledgeId')
            .mockResolvedValue({
                output: {
                    knowledgeId: 'knowledge-9',
                    sourceDraftPostId: 42,
                    sourceDraftVersion: 4,
                    contentHash: '1'.repeat(64),
                    contributorsRoot: '2'.repeat(64),
                    createdAt: new Date('2026-03-21T00:00:00.000Z'),
                },
                bindingEvidence: {
                    knowledgeId: 'knowledge-9',
                    sourceDraftPostId: 42,
                    sourceDraftVersion: 4,
                    sourceAnchorId: '3'.repeat(64),
                    sourceSummaryHash: '4'.repeat(64),
                    sourceMessagesDigest: '5'.repeat(64),
                    proofPackageHash: '6'.repeat(64),
                    contributorsRoot: '2'.repeat(64),
                    contributorsCount: 3,
                    bindingVersion: 2,
                    createdAt: new Date('2026-03-21T00:01:00.000Z'),
                },
                policyProfileDigest: '7'.repeat(64),
            });

        const req = {
            params: { knowledgeId: 'knowledge-9' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            output: {
                knowledgeId: 'knowledge-9',
                sourceDraftPostId: 42,
                sourceDraftVersion: 4,
            },
            bindingEvidence: {
                sourceAnchorId: '3'.repeat(64),
            },
            policyProfileDigest: '7'.repeat(64),
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('treats sourceAnchorId as the formal provenance path coming from the on-chain binding anchor', () => {
        const record = buildCrystallizationOutputRecord({
            knowledgeId: 'knowledge-9',
            sourceDraftPostId: 42,
            sourceDraftVersion: 4,
            contentHash: '1'.repeat(64),
            contributorsRoot: '2'.repeat(64),
            createdAt: new Date('2026-03-21T00:00:00.000Z'),
            sourceAnchorId: '3'.repeat(64),
            sourceSummaryHash: '4'.repeat(64),
            sourceMessagesDigest: '5'.repeat(64),
            proofPackageHash: '6'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            bindingCreatedAt: new Date('2026-03-21T00:01:00.000Z'),
            policyProfileDigest: '7'.repeat(64),
        });

        expect(record?.bindingEvidence?.sourceAnchorId).toBe('3'.repeat(64));
        expect(record?.output.sourceDraftPostId).toBe(42);
    });
});
