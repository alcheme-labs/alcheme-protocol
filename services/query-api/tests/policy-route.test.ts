import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const verifyEd25519SignatureBase64Mock = jest.fn();

jest.mock('../src/services/offchainDiscussion', () => ({
    verifyEd25519SignatureBase64: verifyEd25519SignatureBase64Mock,
}));

import { policyRouter } from '../src/rest/policy';
import * as policyProfileService from '../src/services/policy/profile';
import * as draftWorkflowStateService from '../src/services/draftLifecycle/workflowState';

function getRouteHandler(router: Router, path: string, method: 'get' | 'put') {
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

function createPrismaMock(input?: {
    actorRole?: 'Owner' | 'Admin' | 'Moderator' | 'Member' | null;
}) {
    const actorRole = input?.actorRole ?? 'Owner';
    return {
        circle: {
            findUnique: jest.fn(async () => ({
                id: 7,
                creatorId: 9,
                creator: {
                    pubkey: 'owner-pubkey',
                },
                level: 0,
                parentCircleId: null,
                createdAt: new Date('2026-03-19T00:00:00.000Z'),
                joinRequirement: 'Free',
                circleType: 'Open',
                minCrystals: 0,
            })),
        },
        user: {
            findUnique: jest.fn(async ({ where }: any) => {
                if (where?.pubkey === 'owner-pubkey') {
                    return { id: 9 };
                }
                if (where?.pubkey === 'admin-pubkey') {
                    return { id: 12 };
                }
                return null;
            }),
        },
        circleMember: {
            findUnique: jest.fn(async () => actorRole ? ({
                role: actorRole,
                status: 'Active',
            }) : null),
        },
    } as any;
}

describe('policy profile route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-27T00:00:30.000Z').getTime());
        verifyEd25519SignatureBase64Mock.mockReturnValue(true);
        jest.spyOn(draftWorkflowStateService, 'reconcileActiveDraftWorkflowStates').mockResolvedValue({
            draftingUpdatedCount: 0,
            reviewUpdatedCount: 0,
        });
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue({
                circleId: 7,
                sourceType: 'circle_override',
                inheritanceMode: 'independent',
                inheritsFromProfileId: null,
                inheritsFromCircleId: null,
                draftGenerationPolicy: {} as any,
                draftLifecycleTemplate: {
                    templateId: 'fast_deposition',
                    draftGenerationVotingMinutes: 10,
                    draftingWindowMinutes: 45,
                    reviewWindowMinutes: 180,
                    maxRevisionRounds: 2,
                    reviewEntryMode: 'manual_only',
                },
                draftWorkflowPolicy: {
                    createIssueMinRole: 'Member',
                    followupIssueMinRole: 'Member',
                    reviewIssueMinRole: 'Moderator',
                    retagIssueMinRole: 'Moderator',
                    applyIssueMinRole: 'Admin',
                    manualEndDraftingMinRole: 'Moderator',
                    advanceFromReviewMinRole: 'Admin',
                    enterCrystallizationMinRole: 'Moderator',
                    allowAuthorWithdrawBeforeReview: true,
                    allowModeratorRetagIssue: true,
                },
                blockEditEligibilityPolicy: {} as any,
                forkPolicy: {} as any,
                ghostPolicy: {} as any,
                localEditability: 'editable',
                effectiveFrom: new Date('2026-03-19T00:00:00.000Z'),
                resolvedFromProfileVersion: null,
                configVersion: 2,
            } as any);
    });

    test('returns policy profile through the profile route', async () => {
        const prisma = createPrismaMock();
        const router = policyRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/profile', 'get');
        const resolveSpy = jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue({
                circleId: 7,
                sourceType: 'circle_override',
                inheritanceMode: 'independent',
                inheritsFromProfileId: null,
                inheritsFromCircleId: null,
                draftGenerationPolicy: {} as any,
                draftLifecycleTemplate: {
                    templateId: 'fast_deposition',
                    draftGenerationVotingMinutes: 10,
                    draftingWindowMinutes: 45,
                    reviewWindowMinutes: 180,
                    maxRevisionRounds: 2,
                    reviewEntryMode: 'manual_only',
                },
                draftWorkflowPolicy: {
                    createIssueMinRole: 'Member',
                    followupIssueMinRole: 'Member',
                    reviewIssueMinRole: 'Moderator',
                    retagIssueMinRole: 'Moderator',
                    applyIssueMinRole: 'Admin',
                    manualEndDraftingMinRole: 'Moderator',
                    advanceFromReviewMinRole: 'Admin',
                    enterCrystallizationMinRole: 'Moderator',
                    allowAuthorWithdrawBeforeReview: true,
                    allowModeratorRetagIssue: true,
                },
                blockEditEligibilityPolicy: {} as any,
                forkPolicy: {} as any,
                ghostPolicy: {} as any,
                localEditability: 'editable',
                effectiveFrom: new Date('2026-03-19T00:00:00.000Z'),
                resolvedFromProfileVersion: null,
                configVersion: 2,
            });

        const req = {
            params: { id: '7' },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(resolveSpy).toHaveBeenCalledWith(prisma, 7);
        expect(res.payload).toMatchObject({
            circleId: 7,
            profile: {
                draftLifecycleTemplate: {
                    reviewEntryMode: 'manual_only',
                    draftingWindowMinutes: 45,
                    reviewWindowMinutes: 180,
                    maxRevisionRounds: 2,
                },
                draftWorkflowPolicy: {
                    reviewIssueMinRole: 'Moderator',
                    applyIssueMinRole: 'Admin',
                },
            },
        });
    });

    test('allows owners to update draft lifecycle template overrides', async () => {
        const prisma = createPrismaMock({ actorRole: 'Owner' });
        const router = policyRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/profile', 'put');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValueOnce({
                circleId: 7,
                sourceType: 'circle_override',
                inheritanceMode: 'independent',
                inheritsFromProfileId: null,
                inheritsFromCircleId: null,
                draftGenerationPolicy: {} as any,
                draftLifecycleTemplate: {
                    templateId: 'fast_deposition',
                    draftGenerationVotingMinutes: 10,
                    draftingWindowMinutes: 45,
                    reviewWindowMinutes: 180,
                    maxRevisionRounds: 2,
                    reviewEntryMode: 'manual_only',
                },
                draftWorkflowPolicy: {
                    createIssueMinRole: 'Member',
                    followupIssueMinRole: 'Member',
                    reviewIssueMinRole: 'Moderator',
                    retagIssueMinRole: 'Moderator',
                    applyIssueMinRole: 'Admin',
                    manualEndDraftingMinRole: 'Moderator',
                    advanceFromReviewMinRole: 'Admin',
                    enterCrystallizationMinRole: 'Moderator',
                    allowAuthorWithdrawBeforeReview: true,
                    allowModeratorRetagIssue: true,
                },
                blockEditEligibilityPolicy: {} as any,
                forkPolicy: {} as any,
                ghostPolicy: {} as any,
                localEditability: 'editable',
                effectiveFrom: new Date('2026-03-19T00:00:00.000Z'),
                resolvedFromProfileVersion: null,
                configVersion: 2,
            } as any);
        const updateSpy = jest.spyOn(policyProfileService, 'upsertCircleDraftLifecycleTemplate')
            .mockResolvedValue({
                circleId: 7,
                sourceType: 'circle_override',
                inheritanceMode: 'independent',
                inheritsFromProfileId: null,
                inheritsFromCircleId: null,
                draftGenerationPolicy: {} as any,
                draftLifecycleTemplate: {
                    templateId: 'fast_deposition',
                    draftGenerationVotingMinutes: 10,
                    draftingWindowMinutes: 60,
                    reviewWindowMinutes: 240,
                    maxRevisionRounds: 3,
                    reviewEntryMode: 'auto_or_manual',
                },
                draftWorkflowPolicy: {
                    createIssueMinRole: 'Member',
                    followupIssueMinRole: 'Member',
                    reviewIssueMinRole: 'Moderator',
                    retagIssueMinRole: 'Moderator',
                    applyIssueMinRole: 'Admin',
                    manualEndDraftingMinRole: 'Moderator',
                    advanceFromReviewMinRole: 'Admin',
                    enterCrystallizationMinRole: 'Moderator',
                    allowAuthorWithdrawBeforeReview: true,
                    allowModeratorRetagIssue: true,
                },
                blockEditEligibilityPolicy: {} as any,
                forkPolicy: {} as any,
                ghostPolicy: {} as any,
                localEditability: 'editable',
                effectiveFrom: new Date('2026-03-19T00:00:00.000Z'),
                resolvedFromProfileVersion: null,
                configVersion: 2,
            } as any);

        const req = {
            params: { id: '7' },
            body: {
                actorPubkey: 'owner-pubkey',
                signedMessage: 'alcheme-circle-settings:{"v":1,"action":"circle_settings_publish","circleId":7,"actorPubkey":"owner-pubkey","settingKind":"policy_profile","payload":{"draftLifecycleTemplate":{"reviewEntryMode":"auto_or_manual","draftingWindowMinutes":60,"reviewWindowMinutes":240,"maxRevisionRounds":3}},"clientTimestamp":"2026-03-27T00:00:00.000Z","nonce":"policy-lifecycle-01"}',
                signature: 'base64-signature',
                draftLifecycleTemplate: {
                    reviewEntryMode: 'auto_or_manual',
                    draftingWindowMinutes: 60,
                    reviewWindowMinutes: 240,
                    maxRevisionRounds: 3,
                },
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(updateSpy).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            actorUserId: 9,
            patch: {
                reviewEntryMode: 'auto_or_manual',
                draftingWindowMinutes: 60,
                reviewWindowMinutes: 240,
                maxRevisionRounds: 3,
            },
        });
        expect(draftWorkflowStateService.reconcileActiveDraftWorkflowStates).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            template: expect.objectContaining({
                reviewEntryMode: 'auto_or_manual',
                draftingWindowMinutes: 60,
                reviewWindowMinutes: 240,
                maxRevisionRounds: 3,
            }),
            now: expect.any(Date),
        });
        expect(res.payload).toMatchObject({
            circleId: 7,
            profile: {
                draftLifecycleTemplate: {
                    reviewEntryMode: 'auto_or_manual',
                    draftingWindowMinutes: 60,
                    reviewWindowMinutes: 240,
                    maxRevisionRounds: 3,
                },
            },
        });
    });

    test('allows owners to update draft workflow policy overrides', async () => {
        const prisma = createPrismaMock({ actorRole: 'Owner' });
        const router = policyRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/profile', 'put');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValueOnce({
                circleId: 7,
                sourceType: 'circle_override',
                inheritanceMode: 'independent',
                inheritsFromProfileId: null,
                inheritsFromCircleId: null,
                draftGenerationPolicy: {} as any,
                draftLifecycleTemplate: {
                    templateId: 'fast_deposition',
                    draftGenerationVotingMinutes: 10,
                    draftingWindowMinutes: 45,
                    reviewWindowMinutes: 180,
                    maxRevisionRounds: 2,
                    reviewEntryMode: 'manual_only',
                },
                draftWorkflowPolicy: {
                    createIssueMinRole: 'Member',
                    followupIssueMinRole: 'Member',
                    reviewIssueMinRole: 'Moderator',
                    retagIssueMinRole: 'Moderator',
                    applyIssueMinRole: 'Admin',
                    manualEndDraftingMinRole: 'Moderator',
                    advanceFromReviewMinRole: 'Admin',
                    enterCrystallizationMinRole: 'Moderator',
                    allowAuthorWithdrawBeforeReview: true,
                    allowModeratorRetagIssue: true,
                },
                blockEditEligibilityPolicy: {} as any,
                forkPolicy: {} as any,
                ghostPolicy: {} as any,
                localEditability: 'editable',
                effectiveFrom: new Date('2026-03-19T00:00:00.000Z'),
                resolvedFromProfileVersion: null,
                configVersion: 2,
            } as any);
        const updateSpy = jest.spyOn(policyProfileService, 'upsertCircleDraftWorkflowPolicy')
            .mockResolvedValue({
                circleId: 7,
                sourceType: 'circle_override',
                inheritanceMode: 'independent',
                inheritsFromProfileId: null,
                inheritsFromCircleId: null,
                draftGenerationPolicy: {} as any,
                draftLifecycleTemplate: {
                    templateId: 'fast_deposition',
                    draftGenerationVotingMinutes: 10,
                    draftingWindowMinutes: 60,
                    reviewWindowMinutes: 240,
                    maxRevisionRounds: 3,
                    reviewEntryMode: 'auto_or_manual',
                },
                draftWorkflowPolicy: {
                    createIssueMinRole: 'Member',
                    followupIssueMinRole: 'Initiate',
                    reviewIssueMinRole: 'Moderator',
                    retagIssueMinRole: 'Moderator',
                    applyIssueMinRole: 'Admin',
                    manualEndDraftingMinRole: 'Member',
                    advanceFromReviewMinRole: 'Admin',
                    enterCrystallizationMinRole: 'Moderator',
                    allowAuthorWithdrawBeforeReview: true,
                    allowModeratorRetagIssue: true,
                },
                blockEditEligibilityPolicy: {} as any,
                forkPolicy: {} as any,
                ghostPolicy: {} as any,
                localEditability: 'editable',
                effectiveFrom: new Date('2026-03-19T00:00:00.000Z'),
                resolvedFromProfileVersion: null,
                configVersion: 2,
            } as any);

        const req = {
            params: { id: '7' },
            body: {
                actorPubkey: 'owner-pubkey',
                signedMessage: 'alcheme-circle-settings:{"v":1,"action":"circle_settings_publish","circleId":7,"actorPubkey":"owner-pubkey","settingKind":"policy_profile","payload":{"draftWorkflowPolicy":{"followupIssueMinRole":"Initiate","manualEndDraftingMinRole":"Member"}},"clientTimestamp":"2026-03-27T00:00:00.000Z","nonce":"policy-workflow-01"}',
                signature: 'base64-signature',
                draftWorkflowPolicy: {
                    followupIssueMinRole: 'Initiate',
                    manualEndDraftingMinRole: 'Member',
                },
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(draftWorkflowStateService.reconcileActiveDraftWorkflowStates).not.toHaveBeenCalled();
        expect(updateSpy).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            actorUserId: 9,
            patch: {
                followupIssueMinRole: 'Initiate',
                manualEndDraftingMinRole: 'Member',
            },
        });
        expect(res.payload).toMatchObject({
            circleId: 7,
            profile: {
                draftWorkflowPolicy: {
                    followupIssueMinRole: 'Initiate',
                    manualEndDraftingMinRole: 'Member',
                },
            },
        });
    });

    test('rejects policy profile writes without a wallet-signed canonical envelope', async () => {
        const prisma = createPrismaMock({ actorRole: 'Owner' });
        const router = policyRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/profile', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            body: {
                draftLifecycleTemplate: {
                    reviewEntryMode: 'auto_or_manual',
                    draftingWindowMinutes: 60,
                    reviewWindowMinutes: 240,
                    maxRevisionRounds: 3,
                },
            },
        } as any, res as any);

        expect(res.statusCode).toBe(401);
        expect(res.payload).toMatchObject({
            error: 'circle_settings_auth_required',
        });
    });
});
