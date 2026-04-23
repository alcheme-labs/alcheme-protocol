import { beforeEach, describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

jest.mock('../src/services/contributorProof', () => {
    const actual = jest.requireActual('../src/services/contributorProof') as Record<string, unknown>;
    return {
        ...(actual as any),
        getDraftContributorProof: jest.fn(async () => ({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        })),
    };
});

jest.mock('../src/services/collabEditAnchor', () => ({
    getCollabEditAnchorById: jest.fn(async () => ({
        anchorId: 'a'.repeat(64),
        draftPostId: 42,
        status: 'anchored',
        snapshotHash: 'b'.repeat(64),
        payloadHash: 'b'.repeat(64),
        canonicalPayload: null,
        proofUri: null,
        txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
        txSlot: BigInt(123),
        createdAt: new Date('2026-03-13T12:00:00.000Z'),
        anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
        updatedAt: new Date('2026-03-13T12:00:00.000Z'),
    })),
    getCollabEditAnchorsByPostId: jest.fn(async () => ([
        {
            anchorId: 'a'.repeat(64),
            draftPostId: 42,
            status: 'anchored',
            payloadHash: 'b'.repeat(64),
            canonicalPayload: {
                draftPostId: 42,
                circleId: 7,
                summaryHash: 'c'.repeat(64),
                messagesDigest: 'd'.repeat(64),
                messages: [],
            },
            proofUri: null,
            txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
            txSlot: BigInt(123),
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
        },
    ])),
    verifyCollabEditAnchor: jest.fn(() => ({ verifiable: true })),
}));

jest.mock('../src/services/proofPackage', () => ({
    PROOF_PACKAGE_BINDING_VERSION: 2,
    buildCanonicalProofPackageV2: jest.fn(() => ({
        canonical_proof_package: {
            schema_version: 2,
            draft_anchor: 'a'.repeat(64),
            collab_edit_anchor: 'a'.repeat(64),
            contributors: [],
            root: 'e'.repeat(64),
            count: 1,
            discussion_resolution_refs: [],
            generated_at: '2026-03-13T12:00:00.000Z',
        },
        proof_package_hash: '9'.repeat(64),
    })),
}));

jest.mock('../src/services/proofPackageIssuer', () => ({
    issueProofPackageSignature: jest.fn(() => ({
        issuer_key_id: 'attestor-dev',
        issued_signature: '4'.repeat(128),
        issued_at: '2026-03-13T12:00:01.000Z',
        signed_message: '{}',
    })),
    persistProofPackageIssuance: jest.fn(async () => ({
        draftPostId: 42,
        proofPackageHash: '9'.repeat(64),
        sourceAnchorId: 'a'.repeat(64),
        contributorsRoot: 'e'.repeat(64),
        contributorsCount: 1,
        bindingVersion: 2,
        generatedAt: '2026-03-13T12:00:00.000Z',
        issuerKeyId: 'attestor-dev',
        issuedSignature: '4'.repeat(128),
        issuedAt: '2026-03-13T12:00:01.000Z',
    })),
}));

const upsertCrystalEntitlementsForKnowledgeMock = jest.fn(async () => ({
    knowledgeRowId: 9,
    knowledgePublicId: 'knowledge-9',
    entitlementCount: 1,
    ownerPubkeys: ['11111111111111111111111111111111'],
}));
const enqueueCrystalAssetIssueJobMock = jest.fn(async () => ({
    knowledgeRowId: 9,
    knowledgePublicId: 'knowledge-9',
    enqueued: true,
    jobId: 501,
}));

jest.mock('../src/services/crystalEntitlements/upsert', () => ({
    upsertCrystalEntitlementsForKnowledge: (...args: any[]) => (upsertCrystalEntitlementsForKnowledgeMock as any)(...args),
}));

jest.mock('../src/services/crystalAssets/enqueue', () => ({
    enqueueCrystalAssetIssueJob: (...args: any[]) => (enqueueCrystalAssetIssueJobMock as any)(...args),
}));

import { discussionRouter } from '../src/rest/discussion';
import * as draftLifecycleReadModelService from '../src/services/draftLifecycle/readModel';
import { DraftWorkflowStateError } from '../src/services/draftLifecycle/workflowState';
import {
    DraftContributorProofError,
    getDraftContributorProof,
} from '../src/services/contributorProof';
import {
    getCollabEditAnchorById,
    getCollabEditAnchorsByPostId,
    verifyCollabEditAnchor,
} from '../src/services/collabEditAnchor';
import { buildCanonicalProofPackageV2 } from '../src/services/proofPackage';
import {
    issueProofPackageSignature,
    persistProofPackageIssuance,
} from '../src/services/proofPackageIssuer';
import * as knowledgeContributions from '../src/services/knowledgeContributions';

function createPrismaMock() {
    let membership = {
        role: 'Moderator',
        status: 'Active',
        identityLevel: 'Member',
    };
    let policyRow: any = null;
    const deleteMany = jest.fn<() => Promise<any>>().mockResolvedValue({ count: 0 });
    const createMany = jest.fn<() => Promise<any>>().mockResolvedValue({ count: 1 });
    const prisma: any = {
        setMembership(nextMembership: typeof membership) {
            membership = nextMembership;
        },
        setPolicyRow(nextPolicyRow: any) {
            policyRow = nextPolicyRow;
        },
        post: {
            findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                id: 42,
                authorId: 9,
                circleId: 7,
                status: 'Draft',
                contentId: 'draft-content-42',
                heatScore: 16,
            }),
        },
        circle: {
            findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ creatorId: 9 }),
        },
        circleMember: {
            findUnique: jest.fn<() => Promise<any>>().mockImplementation(async () => membership),
        },
        knowledge: {
            findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
                onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                sourceContentId: null,
                heatScore: 0,
                contributorsRoot: 'e'.repeat(64),
                contributorsCount: 1,
            }),
            update: jest.fn<() => Promise<any>>().mockResolvedValue({
                id: 9,
                knowledgeId: 'knowledge-9',
                sourceContentId: 'draft-content-42',
                heatScore: 16,
            }),
        },
        user: {
            findMany: jest.fn<() => Promise<any>>().mockResolvedValue([
                {
                    pubkey: '11111111111111111111111111111111',
                    handle: 'alice',
                },
            ]),
        },
        knowledgeContribution: {
            deleteMany,
            createMany,
        },
        $queryRaw: jest.fn(async (...args: any[]) => {
            const query = args[0];
            const queryText = Array.isArray(query?.strings)
                ? query.strings.join(' ')
                : String(query || '');
            if (queryText.includes('FROM knowledge_binding')) {
                return [{
                    sourceAnchorId: 'a'.repeat(64),
                    proofPackageHash: '9'.repeat(64),
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 1,
                }];
            }
            if (queryText.includes('FROM circle_policy_profiles')) {
                return policyRow ? [policyRow] : [];
            }
            return [];
        }),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    return prisma;
}

function getRouteHandler(router: Router, path: string) {
    const layer = (router as any).stack.find((item: any) => item.route?.path === path);
    if (!layer?.route?.stack?.[0]?.handle) {
        throw new Error(`discussion route handler not found: ${path}`);
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

function createBindingBody(overrides: Record<string, unknown> = {}) {
    return {
        knowledgePda: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
        proofPackageHash: '9'.repeat(64),
        sourceAnchorId: 'a'.repeat(64),
        contributorsRoot: 'e'.repeat(64),
        contributorsCount: 1,
        bindingVersion: 2,
        generatedAt: '2026-03-13T12:00:00.000Z',
        issuerKeyId: '11111111111111111111111111111111',
        issuedSignature: '4'.repeat(128),
        proofPackage: {
            schema_version: 2,
            draft_anchor: 'a'.repeat(64),
            collab_edit_anchor: 'a'.repeat(64),
            contributors: [],
            root: 'e'.repeat(64),
            count: 1,
            discussion_resolution_refs: [],
            generated_at: '2026-03-13T12:00:00.000Z',
        },
        ...overrides,
    };
}

describe('draft crystallization binding route', () => {
    let prisma: ReturnType<typeof createPrismaMock>;
    let handler: ReturnType<typeof getRouteHandler>;

    beforeEach(() => {
        delete process.env.DRAFT_STRICT_BINDING_MODE;
        (buildCanonicalProofPackageV2 as any).mockClear();
        prisma = createPrismaMock();
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );
        (issueProofPackageSignature as any).mockReset();
        (issueProofPackageSignature as any).mockReturnValue({
            issuer_key_id: 'attestor-dev',
            issued_signature: '4'.repeat(128),
            issued_at: '2026-03-13T12:00:01.000Z',
            signed_message: '{}',
        });
        (persistProofPackageIssuance as any).mockReset();
        (persistProofPackageIssuance as any).mockResolvedValue({
            draftPostId: 42,
            proofPackageHash: '9'.repeat(64),
            sourceAnchorId: 'a'.repeat(64),
            contributorsRoot: 'e'.repeat(64),
            contributorsCount: 1,
            bindingVersion: 2,
            generatedAt: '2026-03-13T12:00:00.000Z',
            issuerKeyId: 'attestor-dev',
            issuedSignature: '4'.repeat(128),
            issuedAt: '2026-03-13T12:00:01.000Z',
        });
        upsertCrystalEntitlementsForKnowledgeMock.mockReset();
        upsertCrystalEntitlementsForKnowledgeMock.mockResolvedValue({
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            entitlementCount: 1,
            ownerPubkeys: ['11111111111111111111111111111111'],
        });
        (getDraftContributorProof as any).mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        });
        (getCollabEditAnchorsByPostId as any).mockResolvedValue([
            {
                anchorId: 'a'.repeat(64),
                draftPostId: 42,
                status: 'anchored',
                payloadHash: 'b'.repeat(64),
                canonicalPayload: {
                    draftPostId: 42,
                    circleId: 7,
                    summaryHash: 'c'.repeat(64),
                    messagesDigest: 'd'.repeat(64),
                    messages: [],
                },
                proofUri: null,
                txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
                txSlot: BigInt(123),
                createdAt: new Date('2026-03-13T12:00:00.000Z'),
                anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
                updatedAt: new Date('2026-03-13T12:00:00.000Z'),
            },
        ]);
        (verifyCollabEditAnchor as any).mockReturnValue({ verifiable: true });
        jest.spyOn(draftLifecycleReadModelService, 'finalizeDraftLifecycleCrystallization')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallized',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-13T12:00:00.000Z',
                transitionMode: 'crystallization_succeeded',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: 'c'.repeat(64),
                    sourceMessagesDigest: 'd'.repeat(64),
                    contentHash: 'b'.repeat(64),
                    createdAt: '2026-03-13T12:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 2,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-13T12:00:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 2,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any);
        jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallization_active',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-13T12:00:00.000Z',
                transitionMode: 'enter_crystallization',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: 'c'.repeat(64),
                    sourceMessagesDigest: 'd'.repeat(64),
                    contentHash: 'b'.repeat(64),
                    createdAt: '2026-03-13T12:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 2,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-13T12:00:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 2,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any);
    });

    test('binds indexed knowledge to the source draft after crystallization', async () => {
        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
            sourceContentId: 'draft-content-42',
            knowledgeId: 'knowledge-9',
            sourceDraftHeatScore: 16,
            knowledgeHeatScore: 16,
            proofPackageIssuance: {
                persisted: true,
                proofPackageHash: '9'.repeat(64),
                issuerKeyId: 'attestor-dev',
            },
        });
        expect(persistProofPackageIssuance as any).toHaveBeenCalledTimes(1);
        expect(buildCanonicalProofPackageV2 as any).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('allows initiates to bind crystallization when circle policy grants enter_crystallization permission', async () => {
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

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects crystallization binding before the draft has entered crystallization_active', async () => {
        jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-13T12:00:00.000Z',
                transitionMode: 'manual_lock',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: 'c'.repeat(64),
                    sourceMessagesDigest: 'd'.repeat(64),
                    contentHash: 'b'.repeat(64),
                    createdAt: '2026-03-13T12:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 2,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-13T12:00:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 2,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'draft_not_ready_for_crystallization_execution',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('fails the binding request when lifecycle finalization fails for non-idempotent reasons', async () => {
        jest.spyOn(draftLifecycleReadModelService, 'finalizeDraftLifecycleCrystallization')
            .mockRejectedValue(new Error('draft lifecycle finalize exploded'));

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(500);
        expect(res.payload).toMatchObject({
            error: 'draft_lifecycle_finalize_failed',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('fails the binding request when finalize reports not_in_crystallization but lifecycle is still not crystallized', async () => {
        jest.spyOn(draftLifecycleReadModelService, 'finalizeDraftLifecycleCrystallization')
            .mockRejectedValue(new DraftWorkflowStateError(
                'draft_not_in_crystallization',
                409,
                'draft is not currently in crystallization state',
            ));
        const resolveLifecycleSpy = jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel');
        resolveLifecycleSpy
            .mockResolvedValueOnce({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallization_active',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-13T12:00:00.000Z',
                transitionMode: 'enter_crystallization',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: 'c'.repeat(64),
                    sourceMessagesDigest: 'd'.repeat(64),
                    contentHash: 'b'.repeat(64),
                    createdAt: '2026-03-13T12:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 2,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-13T12:00:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 2,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any)
            .mockResolvedValueOnce({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-13T12:00:00.000Z',
                transitionMode: 'manual_lock',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: 'c'.repeat(64),
                    sourceMessagesDigest: 'd'.repeat(64),
                    contentHash: 'b'.repeat(64),
                    createdAt: '2026-03-13T12:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 2,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-13T12:00:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 2,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(500);
        expect(res.payload).toMatchObject({
            error: 'draft_lifecycle_finalize_failed',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode blocks crystallization binding when contribution sync fails', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        prisma.knowledge.findUnique
            .mockResolvedValueOnce({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
                onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                sourceContentId: null,
                heatScore: 0,
                contributorsRoot: 'e'.repeat(64),
                contributorsCount: 1,
            })
            .mockResolvedValueOnce(null);
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'contribution_sync_required',
            mode: 'enforce',
        });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode requires a valid proof snapshot payload', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: {
                knowledgePda: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
            },
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'invalid_proof_snapshot',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode rejects proof snapshot when signature mismatches payload', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody({
                issuedSignature: '1'.repeat(128),
            }),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'invalid_proof_snapshot',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode forwards issuer configuration errors instead of misclassifying as invalid snapshot', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (issueProofPackageSignature as any).mockImplementationOnce(() => {
            throw new Error('missing_issuer_secret');
        });
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.payload).toBeNull();
        expect(next).toHaveBeenCalledTimes(1);
        const forwardedError = next.mock.calls[0][0] as Error;
        expect(forwardedError).toBeInstanceOf(Error);
        expect(forwardedError.message).toBe('missing_issuer_secret');
    });

    test('enforce mode treats issuer key mismatch in request snapshot as invalid proof snapshot', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (issueProofPackageSignature as any).mockImplementationOnce(() => {
            throw new Error('issuer_key_id_secret_mismatch');
        });
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'invalid_proof_snapshot',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode syncs contributions against request source anchor snapshot', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        const syncSpy = jest.spyOn(knowledgeContributions, 'syncKnowledgeContributionsFromDraftProof');
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody({
                proofPackageHash: '9'.repeat(64),
                sourceAnchorId: 'a'.repeat(64),
                contributorsRoot: 'e'.repeat(64),
                contributorsCount: 1,
            }),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(syncSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                draftPostId: 42,
                knowledgeOnChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
            }),
            expect.objectContaining({
                requireBindingProjection: true,
                proofAnchorId: 'a'.repeat(64),
                expectedProofPackageHash: '9'.repeat(64),
                expectedContributorsRoot: 'e'.repeat(64),
                expectedContributorsCount: 1,
            }),
        );
        syncSpy.mockRestore();
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode upserts crystal entitlements after strict contribution sync succeeds', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(upsertCrystalEntitlementsForKnowledgeMock).toHaveBeenCalledWith(prisma, {
            knowledgePublicId: 'knowledge-9',
        });
        expect(enqueueCrystalAssetIssueJobMock).toHaveBeenCalledWith(prisma, {
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            requestedByUserId: 1,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode does not return success when entitlement upsert fails', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        upsertCrystalEntitlementsForKnowledgeMock.mockRejectedValueOnce(new Error('entitlement_sync_failed'));
        const finalizeSpy = jest.spyOn(draftLifecycleReadModelService, 'finalizeDraftLifecycleCrystallization');
        finalizeSpy.mockClear();
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.payload).toBeNull();
        expect(finalizeSpy).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        const forwardedError = next.mock.calls[0][0] as Error;
        expect(forwardedError).toBeInstanceOf(Error);
        expect(forwardedError.message).toBe('entitlement_sync_failed');
    });

    test('enforce mode does not return success when crystal asset enqueue fails', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        enqueueCrystalAssetIssueJobMock.mockRejectedValueOnce(new Error('crystal_enqueue_failed'));
        const finalizeSpy = jest.spyOn(draftLifecycleReadModelService, 'finalizeDraftLifecycleCrystallization');
        finalizeSpy.mockClear();
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.payload).toBeNull();
        expect(finalizeSpy).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        const forwardedError = next.mock.calls[0][0] as Error;
        expect(forwardedError).toBeInstanceOf(Error);
        expect(forwardedError.message).toBe('crystal_enqueue_failed');
    });

    test('enforce mode returns knowledge_circle_mismatch diagnostic when draft and knowledge circles diverge', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        prisma.knowledge.findUnique.mockResolvedValueOnce({
            id: 9,
            knowledgeId: 'knowledge-9',
            circleId: 99,
            onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
            sourceContentId: null,
            heatScore: 0,
        });
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'knowledge_circle_mismatch',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode returns proof_binding_required when indexed root/count diverges from proof package', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        prisma.knowledge.findUnique
            .mockResolvedValueOnce({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
                onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                sourceContentId: null,
                heatScore: 0,
            })
            .mockResolvedValueOnce({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
                onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                sourceContentId: null,
                heatScore: 0,
                contributorsRoot: '1'.repeat(64),
                contributorsCount: 1,
            });
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'proof_binding_required',
            mode: 'enforce',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode no longer depends on latest anchor state for proof-package issuance persistence', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (getCollabEditAnchorsByPostId as any).mockResolvedValueOnce([
            {
                anchorId: 'a'.repeat(64),
                draftPostId: 42,
                status: 'pending',
                payloadHash: 'b'.repeat(64),
                canonicalPayload: null,
                proofUri: null,
                txSignature: null,
                txSlot: null,
                createdAt: new Date('2026-03-13T12:00:00.000Z'),
                updatedAt: new Date('2026-03-13T12:00:00.000Z'),
            },
        ]);

        let stagedWrites = 0;
        let committedWrites = 0;
        const txKnowledgeUpdate = jest.fn(async (args: any) => {
            stagedWrites += 1;
            return prisma.knowledge.update(args);
        });
        const txDeleteMany = jest.fn(async (args: any) => {
            stagedWrites += 1;
            return prisma.knowledgeContribution.deleteMany(args);
        });
        const txCreateMany = jest.fn(async (args: any) => {
            stagedWrites += 1;
            return prisma.knowledgeContribution.createMany(args);
        });

        prisma.$transaction = jest.fn(async (cb: any) => {
            stagedWrites = 0;
            const tx = {
                ...prisma,
                knowledge: {
                    ...prisma.knowledge,
                    update: txKnowledgeUpdate,
                },
                knowledgeContribution: {
                    ...prisma.knowledgeContribution,
                    deleteMany: txDeleteMany,
                    createMany: txCreateMany,
                },
            };
            try {
                const result = await cb(tx);
                committedWrites += stagedWrites;
                return result;
            } catch (error) {
                stagedWrites = 0;
                throw error;
            }
        });

        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(txKnowledgeUpdate).toHaveBeenCalledTimes(1);
        expect(txDeleteMany).toHaveBeenCalledTimes(1);
        expect(txCreateMany).toHaveBeenCalledTimes(1);
        expect(committedWrites).toBe(3);
        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            proofPackageIssuance: {
                persisted: true,
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode preserves draft_anchor_unverifiable from contribution sync as 422', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (getDraftContributorProof as any).mockRejectedValueOnce(
            new DraftContributorProofError('draft_anchor_unverifiable', 409, 'draft_anchor_unverifiable'),
        );
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(422);
        expect(res.payload).toMatchObject({
            error: 'draft_anchor_unverifiable',
            mode: 'enforce',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('enforce mode issuance persistence uses request snapshot and does not re-fetch contributor proof', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        const syncSpy = jest.spyOn(knowledgeContributions, 'syncKnowledgeContributionsFromDraftProof')
            .mockResolvedValueOnce({
                synced: true,
                knowledgeId: 'knowledge-9',
                contributorsCount: 1,
                contributorsRoot: 'e'.repeat(64),
            });
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            mode: 'enforce',
        });
        expect(next).not.toHaveBeenCalled();
        syncSpy.mockRestore();
    });

    test('enforce mode forwards internal contribution sync failures to next middleware', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        prisma.user.findMany.mockRejectedValueOnce(new Error('db_unavailable'));
        handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/crystallization-binding',
        );

        const req = {
            params: { postId: '42' },
            body: createBindingBody(),
            userId: 1,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.payload).toBeNull();
        expect(next).toHaveBeenCalledTimes(1);
        const forwardedError = next.mock.calls[0][0] as Error;
        expect(forwardedError).toBeInstanceOf(Error);
        expect(forwardedError.message).toBe('db_unavailable');
    });
});

describe('draft strict gate routes', () => {
    let prisma: ReturnType<typeof createPrismaMock>;

    beforeEach(() => {
        delete process.env.DRAFT_STRICT_BINDING_MODE;
        (buildCanonicalProofPackageV2 as any).mockClear();
        upsertCrystalEntitlementsForKnowledgeMock.mockReset();
        upsertCrystalEntitlementsForKnowledgeMock.mockResolvedValue({
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            entitlementCount: 1,
            ownerPubkeys: ['11111111111111111111111111111111'],
        });
        enqueueCrystalAssetIssueJobMock.mockReset();
        enqueueCrystalAssetIssueJobMock.mockResolvedValue({
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            enqueued: true,
            jobId: 501,
        });
        prisma = createPrismaMock();
        jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallization_active',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-13T12:00:00.000Z',
                transitionMode: 'enter_crystallization',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: 'c'.repeat(64),
                    sourceMessagesDigest: 'd'.repeat(64),
                    contentHash: 'b'.repeat(64),
                    createdAt: '2026-03-13T12:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 2,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-13T12:00:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 2,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any);
        (persistProofPackageIssuance as any).mockReset();
        (persistProofPackageIssuance as any).mockResolvedValue({
            draftPostId: 42,
            proofPackageHash: '9'.repeat(64),
            sourceAnchorId: 'a'.repeat(64),
            contributorsRoot: 'e'.repeat(64),
            contributorsCount: 1,
            bindingVersion: 2,
            generatedAt: '2026-03-13T12:00:00.000Z',
            issuerKeyId: 'attestor-dev',
            issuedSignature: 'sig-base64',
            issuedAt: '2026-03-13T12:00:01.000Z',
        });
        (getDraftContributorProof as any).mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        });
        (getCollabEditAnchorsByPostId as any).mockResolvedValue([
            {
                anchorId: 'a'.repeat(64),
                draftPostId: 42,
                status: 'anchored',
                payloadHash: 'b'.repeat(64),
                canonicalPayload: {
                    draftPostId: 42,
                    circleId: 7,
                    summaryHash: 'c'.repeat(64),
                    messagesDigest: 'd'.repeat(64),
                    messages: [],
                },
                proofUri: null,
                txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
                txSlot: BigInt(123),
                createdAt: new Date('2026-03-13T12:00:00.000Z'),
                anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
                updatedAt: new Date('2026-03-13T12:00:00.000Z'),
            },
        ]);
        (getCollabEditAnchorById as any).mockResolvedValue({
            anchorId: 'a'.repeat(64),
            draftPostId: 42,
            status: 'anchored',
            snapshotHash: 'b'.repeat(64),
            payloadHash: 'b'.repeat(64),
            canonicalPayload: null,
            proofUri: null,
            txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
            txSlot: BigInt(123),
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
        });
        (verifyCollabEditAnchor as any).mockReturnValue({ verifiable: true });
    });

    test('publish-readiness returns warning payload in warn mode when anchor is not final', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'warn';
        (getCollabEditAnchorById as any).mockResolvedValue({
            anchorId: 'a'.repeat(64),
            draftPostId: 42,
            status: 'pending',
            snapshotHash: 'b'.repeat(64),
            payloadHash: 'b'.repeat(64),
            canonicalPayload: null,
            proofUri: null,
            txSignature: null,
            txSlot: null,
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            anchoredAt: null,
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
        });
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/publish-readiness',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ready: true,
            mode: 'warn',
            warning: {
                code: 'draft_anchor_not_final',
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('publish-readiness uses the stable snapshot bound anchor instead of a newer pending anchor', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (getCollabEditAnchorsByPostId as any).mockResolvedValue([
            {
                anchorId: 'p'.repeat(64),
                draftPostId: 42,
                status: 'pending',
                snapshotHash: 'f'.repeat(64),
                payloadHash: 'b'.repeat(64),
                canonicalPayload: null,
                proofUri: null,
                txSignature: null,
                txSlot: null,
                createdAt: new Date('2026-03-13T12:05:00.000Z'),
                updatedAt: new Date('2026-03-13T12:05:00.000Z'),
            },
        ]);
        (getCollabEditAnchorById as any).mockResolvedValue({
            anchorId: 'a'.repeat(64),
            draftPostId: 42,
            status: 'anchored',
            snapshotHash: 'b'.repeat(64),
            payloadHash: 'b'.repeat(64),
            canonicalPayload: null,
            proofUri: null,
            txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
            txSlot: BigInt(123),
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
        });
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/publish-readiness',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ready: true,
            reason: 'ok',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('publish-readiness blocks when the stable snapshot bound anchor hash mismatches the locked snapshot', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (getCollabEditAnchorById as any).mockResolvedValue({
            anchorId: 'a'.repeat(64),
            draftPostId: 42,
            status: 'anchored',
            snapshotHash: '9'.repeat(64),
            payloadHash: 'b'.repeat(64),
            canonicalPayload: null,
            proofUri: null,
            txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
            txSlot: BigInt(123),
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
        });
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/publish-readiness',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            ready: false,
            error: 'draft_anchor_snapshot_mismatch',
            mode: 'enforce',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('contributor-proof returns warning payload in off mode when proof is unverifiable', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'off';
        (getDraftContributorProof as any).mockRejectedValue(
            new DraftContributorProofError('draft_anchor_unverifiable', 409, 'draft_anchor_unverifiable'),
        );
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/contributor-proof',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            mode: 'off',
            warning: {
                code: 'draft_anchor_unverifiable',
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('proof-package returns signed package payload when strict checks pass', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/proof-package',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            mode: 'enforce',
            draftPostId: 42,
            root: 'e'.repeat(64),
            count: 1,
            proof_package_hash: '9'.repeat(64),
            source_anchor_id: 'a'.repeat(64),
            binding_version: 2,
            issuer_key_id: 'attestor-dev',
            issued_signature: '4'.repeat(128),
        });
        expect(buildCanonicalProofPackageV2 as any).toHaveBeenCalledTimes(1);
        expect((buildCanonicalProofPackageV2 as any).mock.calls[0]?.[0]).toMatchObject({
            generatedAt: '2026-03-13T12:00:01.000Z',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('proof-package uses the stable snapshot bound anchor instead of a newer pending anchor', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (getCollabEditAnchorsByPostId as any).mockResolvedValue([
            {
                anchorId: 'p'.repeat(64),
                draftPostId: 42,
                status: 'pending',
                snapshotHash: 'f'.repeat(64),
                payloadHash: 'b'.repeat(64),
                canonicalPayload: null,
                proofUri: null,
                txSignature: null,
                txSlot: null,
                createdAt: new Date('2026-03-13T12:05:00.000Z'),
                updatedAt: new Date('2026-03-13T12:05:00.000Z'),
            },
        ]);
        (getCollabEditAnchorById as any).mockResolvedValue({
            anchorId: 'a'.repeat(64),
            draftPostId: 42,
            status: 'anchored',
            snapshotHash: 'b'.repeat(64),
            payloadHash: 'b'.repeat(64),
            canonicalPayload: null,
            proofUri: null,
            txSignature: '5nFH2HEzcJvVkxqhSLfWgQo1GJx7fknHf4xvNc2ci7Q4',
            txSlot: BigInt(123),
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            anchoredAt: new Date('2026-03-13T12:00:01.000Z'),
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
        });
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/proof-package',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            mode: 'enforce',
            source_anchor_id: 'a'.repeat(64),
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('proof-package returns canonical package with warning when issuer config is missing', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (issueProofPackageSignature as any).mockImplementationOnce(() => {
            throw new Error('missing_issuer_key_id');
        });
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/proof-package',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            mode: 'enforce',
            draftPostId: 42,
            root: 'e'.repeat(64),
            count: 1,
            proof_package_hash: '9'.repeat(64),
            source_anchor_id: 'a'.repeat(64),
            binding_version: 2,
            warning: {
                code: 'proof_package_issuer_misconfigured',
                message: 'proof package issuer configuration is invalid',
            },
        });
        expect(res.payload.issuer_key_id).toBeUndefined();
        expect(res.payload.issued_signature).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    test('proof-package blocks in enforce mode when contributor proof is unverifiable', async () => {
        process.env.DRAFT_STRICT_BINDING_MODE = 'enforce';
        (getDraftContributorProof as any).mockRejectedValue(
            new DraftContributorProofError('draft_anchor_unverifiable', 409, 'draft_anchor_unverifiable'),
        );
        const handler = getRouteHandler(
            discussionRouter(prisma as any, {} as any),
            '/drafts/:postId/proof-package',
        );
        const req = { params: { postId: '42' }, userId: 1 } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(422);
        expect(res.payload).toMatchObject({
            error: 'draft_anchor_unverifiable',
            mode: 'enforce',
        });
        expect(next).not.toHaveBeenCalled();
    });
});
