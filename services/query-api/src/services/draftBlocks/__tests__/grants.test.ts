import { describe, expect, test } from '@jest/globals';

import {
    claimArgumentBlockLease,
    type TemporaryEditGrantRuntimeView,
} from '../runtime';
import {
    expireTemporaryEditGrant,
    issueTemporaryEditGrant,
    requestTemporaryEditGrant,
    revokeTemporaryEditGrant,
    type TemporaryEditGrantRecord,
    type TemporaryEditGrantStore,
} from '../grants';

function createInMemoryStore() {
    const grants = new Map<string, TemporaryEditGrantRecord>();

    const store: TemporaryEditGrantStore = {
        async getGrant(grantId) {
            return grants.get(grantId) ?? null;
        },
        async saveGrant(grant) {
            grants.set(grant.grantId, grant);
            return grant;
        },
        async listDraftGrants(input) {
            return Array.from(grants.values())
                .filter((grant) => (
                    grant.draftPostId === input.draftPostId
                    && (!input.blockId || grant.blockId === input.blockId)
                ))
                .sort((left, right) => left.requestedAt.getTime() - right.requestedAt.getTime());
        },
    };

    return { store, grants };
}

describe('temporary edit grant runtime', () => {
    test('grants can be requested, issued, revoked, and expire', async () => {
        const { store } = createInMemoryStore();

        const requested = await requestTemporaryEditGrant(store, {
            grantId: 'grant-1',
            draftPostId: 42,
            blockId: 'paragraph:1',
            granteeUserId: 77,
            requestedBy: 77,
            approvalMode: 'manager_confirm',
            requestedAt: new Date('2026-03-22T09:00:00.000Z'),
        });
        expect(requested.status).toBe('requested');

        const issued = await issueTemporaryEditGrant(store, {
            grantId: 'grant-1',
            grantedBy: 9,
            grantedAt: new Date('2026-03-22T09:10:00.000Z'),
            expiresAt: new Date('2026-03-22T10:10:00.000Z'),
        });
        expect(issued.status).toBe('active');
        expect(issued.grantedBy).toBe(9);

        const revoked = await revokeTemporaryEditGrant(store, {
            grantId: 'grant-1',
            revokedBy: 9,
            revokedAt: new Date('2026-03-22T09:30:00.000Z'),
        });
        expect(revoked.status).toBe('revoked');

        const requestedAgain = await requestTemporaryEditGrant(store, {
            grantId: 'grant-2',
            draftPostId: 42,
            blockId: 'paragraph:1',
            granteeUserId: 77,
            requestedBy: 77,
            approvalMode: 'manager_confirm',
            requestedAt: new Date('2026-03-22T09:40:00.000Z'),
        });
        const issuedAgain = await issueTemporaryEditGrant(store, {
            grantId: requestedAgain.grantId,
            grantedBy: 9,
            grantedAt: new Date('2026-03-22T09:45:00.000Z'),
            expiresAt: new Date('2026-03-22T09:50:00.000Z'),
        });
        const expired = await expireTemporaryEditGrant(store, {
            grantId: issuedAgain.grantId,
            now: new Date('2026-03-22T10:00:00.000Z'),
        });
        expect(expired.status).toBe('expired');
    });

    test('active grants bridge into block lease permission checks', () => {
        const temporaryEditGrant: TemporaryEditGrantRuntimeView = {
            grantId: 'grant-1',
            draftPostId: 42,
            blockId: 'paragraph:1',
            granteeUserId: 77,
            requestedBy: 77,
            grantedBy: 9,
            revokedBy: null,
            approvalMode: 'manager_confirm',
            status: 'active',
            governanceProposalId: null,
            requestNote: null,
            expiresAt: '2026-03-22T10:10:00.000Z',
            requestedAt: '2026-03-22T09:00:00.000Z',
            grantedAt: '2026-03-22T09:10:00.000Z',
            revokedAt: null,
            updatedAt: '2026-03-22T09:10:00.000Z',
        };

        const lease = claimArgumentBlockLease({
            draftPostId: 42,
            draftVersion: 3,
            blockId: 'paragraph:1',
            holderUserId: 77,
            canClaimLease: false,
            temporaryEditGrant,
            now: '2026-03-22T09:20:00.000Z',
            ttlSeconds: 300,
        });

        expect(lease.status).toBe('active');
        expect(lease.blockId).toBe('paragraph:1');
        expect(lease.holderUserId).toBe(77);
    });

    test('governance-bearing grant requests preserve governance proposal linkage', async () => {
        const { store } = createInMemoryStore();

        const requested = await requestTemporaryEditGrant(store, {
            grantId: 'grant-gov-1',
            draftPostId: 42,
            blockId: 'paragraph:2',
            granteeUserId: 88,
            requestedBy: 88,
            approvalMode: 'governance_vote',
            governanceProposalId: 'gov-grant-1',
            requestedAt: new Date('2026-03-22T09:00:00.000Z'),
        });

        expect(requested.approvalMode).toBe('governance_vote');
        expect(requested.governanceProposalId).toBe('gov-grant-1');
        expect(requested.status).toBe('requested');
    });
});
