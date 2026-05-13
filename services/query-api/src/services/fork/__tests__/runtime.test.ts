import { describe, expect, test } from '@jest/globals';
import { CircleType, JoinRequirement } from '@prisma/client';

import {
    createForkCircle,
    evaluateForkQualification,
    isPrivateSourceForkBlocked,
    type CircleForkLineageRecord,
    type ForkCreationResult,
    type ForkDeclarationRecord,
    type ForkRuntimeStore,
} from '../runtime';

function createInMemoryStore(options?: {
    failLineageSave?: boolean;
}) {
    const declarations = new Map<string, ForkDeclarationRecord>();
    const lineages = new Map<string, CircleForkLineageRecord>();

    const store: ForkRuntimeStore = {
        async getDeclaration(declarationId) {
            return declarations.get(declarationId) ?? null;
        },
        async saveDeclaration(declaration) {
            declarations.set(declaration.declarationId, declaration);
            return declaration;
        },
        async getLineageByDeclarationId(declarationId) {
            return lineages.get(declarationId) ?? null;
        },
        async saveLineage(lineage) {
            if (options?.failLineageSave) {
                throw new Error('lineage_write_failed');
            }
            lineages.set(lineage.declarationId, lineage);
            return lineage;
        },
        async listCircleLineages(circleId) {
            return Array.from(lineages.values()).filter((lineage) => (
                lineage.sourceCircleId === circleId
                || lineage.targetCircleId === circleId
            ));
        },
        async listReconciliationPendingDeclarations() {
            return Array.from(declarations.values()).filter((declaration) => (
                declaration.status === 'reconciliation_pending'
            ));
        },
    };

    return {
        store,
        declarations,
        lineages,
    };
}

function expectSuccessfulCreation(result: ForkCreationResult) {
    expect(result.reconciliationPending).toBe(false);
    expect(result.declaration.status).toBe('completed');
    expect(result.lineage).not.toBeNull();
}

describe('fork runtime', () => {
    test('blocks invite-only and secret sources from public fork by default', () => {
        expect(isPrivateSourceForkBlocked({
            joinRequirement: JoinRequirement.InviteOnly,
            circleType: CircleType.Closed,
        })).toBe(true);

        expect(isPrivateSourceForkBlocked({
            joinRequirement: JoinRequirement.ApprovalRequired,
            circleType: CircleType.Closed,
        })).toBe(false);

        expect(isPrivateSourceForkBlocked({
            joinRequirement: JoinRequirement.TokenGated,
            circleType: CircleType.Open,
        })).toBe(false);

        expect(isPrivateSourceForkBlocked({
            joinRequirement: JoinRequirement.Free,
            circleType: CircleType.Secret,
        })).toBe(true);
    });

    test('allows attached filing prepare before target circle exists and finalizes the same declaration later', async () => {
        const { store } = createInMemoryStore();

        const prepared = await createForkCircle(store, {
            declarationId: 'fork-declaration-prepared',
            sourceCircleId: 17,
            actorUserId: 21,
            declarationText: '先把 Fork filing 附在创建动作上，再等待链上圈层创建。',
            originAnchorRef: 'circle:17',
            qualificationSnapshot: {
                thresholdMode: 'contribution_threshold',
                minimumContributions: 3,
                contributorCount: 6,
                minimumRole: 'Member',
                actorRole: 'Admin',
                actorIdentityLevel: 'Elder',
                requiresGovernanceVote: false,
                qualifies: true,
                qualificationStatus: 'qualified',
            },
            inheritanceSnapshot: {
                sourceType: 'inherited_editable',
                configVersion: 6,
            },
            createdAt: new Date('2026-03-22T20:00:00.000Z'),
        });

        expect(prepared.reconciliationPending).toBe(false);
        expect(prepared.declaration.status).toBe('attached');
        expect(prepared.declaration.targetCircleId).toBeNull();
        expect(prepared.lineage).toBeNull();

        const finalized = await createForkCircle(store, {
            declarationId: 'fork-declaration-prepared',
            sourceCircleId: 17,
            actorUserId: 21,
            declarationText: '先把 Fork filing 附在创建动作上，再等待链上圈层创建。',
            originAnchorRef: 'circle:17',
            qualificationSnapshot: {
                thresholdMode: 'contribution_threshold',
                minimumContributions: 3,
                contributorCount: 6,
                minimumRole: 'Member',
                actorRole: 'Admin',
                actorIdentityLevel: 'Elder',
                requiresGovernanceVote: false,
                qualifies: true,
                qualificationStatus: 'qualified',
            },
            inheritanceSnapshot: {
                sourceType: 'inherited_editable',
                configVersion: 6,
            },
            targetCircleId: 171,
            executionAnchorDigest: 'digest-fork-anchor-prepared',
            createdAt: new Date('2026-03-22T20:01:00.000Z'),
        });

        expectSuccessfulCreation(finalized);
        expect(finalized.declaration.declarationId).toBe('fork-declaration-prepared');
        expect(finalized.declaration.targetCircleId).toBe(171);
        expect(finalized.lineage?.targetCircleId).toBe(171);
    });

    test('writes ForkDeclaration as attached filing and persists CircleForkLineage on successful create', async () => {
        const { store } = createInMemoryStore();

        const result = await createForkCircle(store, {
            declarationId: 'fork-declaration-1',
            sourceCircleId: 7,
            actorUserId: 11,
            declarationText: '当前圈层已经朝不同方向推进，需要独立继续。',
            originAnchorRef: 'knowledge:alpha',
            qualificationSnapshot: {
                thresholdMode: 'contribution_threshold',
                minimumContributions: 3,
                contributorCount: 5,
                minimumRole: 'Member',
                actorRole: 'Moderator',
                actorIdentityLevel: 'Member',
                requiresGovernanceVote: false,
                qualifies: true,
                qualificationStatus: 'qualified',
            },
            inheritanceSnapshot: {
                sourceType: 'inherited_editable',
                inheritanceMode: 'inherit_but_editable',
                localEditability: 'editable',
                inheritsFromCircleId: 7,
                configVersion: 4,
            },
            executeChildCircleCreate: async () => ({
                targetCircleId: 71,
                executionAnchorDigest: null,
            }),
            createdAt: new Date('2026-03-22T19:00:00.000Z'),
        });

        expectSuccessfulCreation(result);
        expect(result.declaration).toMatchObject({
            declarationId: 'fork-declaration-1',
            sourceCircleId: 7,
            targetCircleId: 71,
            actorUserId: 11,
            declarationText: '当前圈层已经朝不同方向推进，需要独立继续。',
            status: 'completed',
        });
        expect(result.lineage).toMatchObject({
            sourceCircleId: 7,
            targetCircleId: 71,
            declarationId: 'fork-declaration-1',
            originAnchorRef: 'knowledge:alpha',
            createdBy: 11,
        });
    });

    test('enters reconciliation instead of fake failure when chain create succeeds before lineage repair', async () => {
        const { store } = createInMemoryStore({ failLineageSave: true });

        const result = await createForkCircle(store, {
            declarationId: 'fork-declaration-repair',
            sourceCircleId: 8,
            actorUserId: 12,
            declarationText: '先保留上游脉络，但后续治理方向需要分开。',
            originAnchorRef: 'summary:branch-1',
            qualificationSnapshot: {
                thresholdMode: 'contribution_threshold',
                minimumContributions: 2,
                contributorCount: 4,
                minimumRole: 'Member',
                actorRole: 'Admin',
                actorIdentityLevel: 'Elder',
                requiresGovernanceVote: false,
                qualifies: true,
                qualificationStatus: 'qualified',
            },
            inheritanceSnapshot: {
                sourceType: 'inherited_locked',
                inheritanceMode: 'inherit_locked',
                localEditability: 'locked',
                inheritsFromCircleId: 8,
                configVersion: 5,
            },
            executeChildCircleCreate: async () => ({
                targetCircleId: 72,
                executionAnchorDigest: 'digest-fork-anchor-1',
            }),
            createdAt: new Date('2026-03-22T19:10:00.000Z'),
        });

        expect(result.reconciliationPending).toBe(true);
        expect(result.declaration.status).toBe('reconciliation_pending');
        expect(result.declaration.targetCircleId).toBe(72);
        expect(result.declaration.executionAnchorDigest).toBe('digest-fork-anchor-1');
        expect(result.lineage).toBeNull();
    });

    test('retries reconciliation-pending declarations without requiring a second child circle create', async () => {
        let shouldFailLineageSave = true;
        const { declarations, lineages } = createInMemoryStore();
        const store: ForkRuntimeStore = {
            async getDeclaration(declarationId) {
                return declarations.get(declarationId) ?? null;
            },
            async saveDeclaration(declaration) {
                declarations.set(declaration.declarationId, declaration);
                return declaration;
            },
            async getLineageByDeclarationId(declarationId) {
                return lineages.get(declarationId) ?? null;
            },
            async saveLineage(lineage) {
                if (shouldFailLineageSave) {
                    throw new Error('lineage_write_failed');
                }
                lineages.set(lineage.declarationId, lineage);
                return lineage;
            },
            async listCircleLineages(circleId) {
                return Array.from(lineages.values()).filter((lineage) => (
                    lineage.sourceCircleId === circleId
                    || lineage.targetCircleId === circleId
                ));
            },
            async listReconciliationPendingDeclarations() {
                return Array.from(declarations.values()).filter((declaration) => (
                    declaration.status === 'reconciliation_pending'
                ));
            },
        };

        const firstAttempt = await createForkCircle(store, {
            declarationId: 'fork-declaration-retry',
            sourceCircleId: 18,
            actorUserId: 22,
            declarationText: '第一次 finalize 写谱系失败，第二次只补 filing。',
            originAnchorRef: 'circle:18',
            qualificationSnapshot: {
                thresholdMode: 'contribution_threshold',
                minimumContributions: 2,
                contributorCount: 6,
                minimumRole: 'Member',
                actorRole: 'Admin',
                actorIdentityLevel: 'Elder',
                requiresGovernanceVote: false,
                qualifies: true,
                qualificationStatus: 'qualified',
            },
            inheritanceSnapshot: {
                sourceType: 'inherited_editable',
                configVersion: 7,
            },
            targetCircleId: 181,
            executionAnchorDigest: 'digest-fork-anchor-retry',
            createdAt: new Date('2026-03-22T20:10:00.000Z'),
        });

        expect(firstAttempt.reconciliationPending).toBe(true);
        expect(firstAttempt.declaration.status).toBe('reconciliation_pending');
        expect(firstAttempt.lineage).toBeNull();

        shouldFailLineageSave = false;

        const retried = await createForkCircle(store, {
            declarationId: 'fork-declaration-retry',
            sourceCircleId: 18,
            actorUserId: 22,
            declarationText: '第一次 finalize 写谱系失败，第二次只补 filing。',
            originAnchorRef: 'circle:18',
            qualificationSnapshot: {
                thresholdMode: 'contribution_threshold',
                minimumContributions: 2,
                contributorCount: 6,
                minimumRole: 'Member',
                actorRole: 'Admin',
                actorIdentityLevel: 'Elder',
                requiresGovernanceVote: false,
                qualifies: true,
                qualificationStatus: 'qualified',
            },
            inheritanceSnapshot: {
                sourceType: 'inherited_editable',
                configVersion: 7,
            },
            targetCircleId: 181,
            executionAnchorDigest: 'digest-fork-anchor-retry',
            createdAt: new Date('2026-03-22T20:11:00.000Z'),
        });

        expectSuccessfulCreation(retried);
        expect(retried.declaration.targetCircleId).toBe(181);
        expect(retried.lineage?.targetCircleId).toBe(181);
    });

    test('uses contribution-first qualification with identity floor protection', () => {
        const contributionShortfall = evaluateForkQualification({
            minimumContributions: 3,
            contributorCount: 1,
            minimumRole: 'Member',
            actorRole: 'Admin',
            actorIdentityLevel: 'Elder',
            requiresGovernanceVote: false,
        });
        const identityShortfall = evaluateForkQualification({
            minimumContributions: 3,
            contributorCount: 5,
            minimumRole: 'Elder',
            actorRole: 'Moderator',
            actorIdentityLevel: 'Member',
            requiresGovernanceVote: false,
        });
        const qualified = evaluateForkQualification({
            minimumContributions: 3,
            contributorCount: 5,
            minimumRole: 'Member',
            actorRole: 'Initiate',
            actorIdentityLevel: 'Elder',
            requiresGovernanceVote: false,
        });

        expect(contributionShortfall.qualifies).toBe(false);
        expect(contributionShortfall.qualificationStatus).toBe('contribution_shortfall');
        expect(identityShortfall.qualifies).toBe(false);
        expect(identityShortfall.qualificationStatus).toBe('identity_shortfall');
        expect(qualified.qualifies).toBe(true);
        expect(qualified.qualificationStatus).toBe('qualified');
    });
});
