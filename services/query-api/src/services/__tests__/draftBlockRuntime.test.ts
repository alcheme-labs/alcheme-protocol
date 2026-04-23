import { describe, expect, test } from '@jest/globals';

import {
    claimArgumentBlockLease,
    heartbeatArgumentBlockLease,
    openArgumentBlockRevisionSession,
    releaseArgumentBlockLease,
    setArgumentBlockRevisionSessionStatus,
} from '../draftBlocks/runtime';

describe('draftBlocks runtime sidecar', () => {
    test('claims a lease and advances a revision session through active -> editing -> submitted -> merged', () => {
        const lease = claimArgumentBlockLease({
            draftPostId: 42,
            draftVersion: 2,
            blockId: 'paragraph:0',
            holderUserId: 77,
            canClaimLease: true,
            now: '2026-03-16T11:00:00.000Z',
            ttlSeconds: 300,
        });

        expect(lease).toMatchObject({
            draftPostId: 42,
            draftVersion: 2,
            blockId: 'paragraph:0',
            holderUserId: 77,
            status: 'active',
        });
        expect(lease.leaseId).toMatch(/^[a-f0-9]{64}$/);

        const extendedLease = heartbeatArgumentBlockLease({
            lease,
            now: '2026-03-16T11:03:00.000Z',
            ttlSeconds: 300,
        });
        expect(extendedLease.lastHeartbeatAt).toBe('2026-03-16T11:03:00.000Z');
        expect(extendedLease.expiresAt).toBe('2026-03-16T11:08:00.000Z');

        const session = openArgumentBlockRevisionSession({
            lease: extendedLease,
            baseDraftVersion: 2,
            contentHashBefore: 'a'.repeat(64),
            now: '2026-03-16T11:03:05.000Z',
        });
        expect(session).toMatchObject({
            draftPostId: 42,
            blockId: 'paragraph:0',
            editorUserId: 77,
            leaseId: extendedLease.leaseId,
            status: 'active',
            baseDraftVersion: 2,
            contentHashBefore: 'a'.repeat(64),
        });

        const editing = setArgumentBlockRevisionSessionStatus({
            session,
            nextStatus: 'editing',
            now: '2026-03-16T11:04:00.000Z',
        });
        expect(editing.status).toBe('editing');

        const submitted = setArgumentBlockRevisionSessionStatus({
            session: editing,
            nextStatus: 'submitted',
            now: '2026-03-16T11:05:00.000Z',
            contentAfter: 'Updated block content',
        });
        expect(submitted).toMatchObject({
            status: 'submitted',
            contentAfter: 'Updated block content',
            submittedAt: '2026-03-16T11:05:00.000Z',
        });

        const merged = setArgumentBlockRevisionSessionStatus({
            session: submitted,
            nextStatus: 'merged',
            now: '2026-03-16T11:06:00.000Z',
            closeReason: 'merged_into_working_copy',
        });
        expect(merged).toMatchObject({
            status: 'merged',
            closedAt: '2026-03-16T11:06:00.000Z',
            closeReason: 'merged_into_working_copy',
        });
    });

    test('rejects lease claim when another active holder already owns the block', () => {
        const activeLease = claimArgumentBlockLease({
            draftPostId: 42,
            draftVersion: 2,
            blockId: 'paragraph:0',
            holderUserId: 88,
            canClaimLease: true,
            now: '2026-03-16T11:00:00.000Z',
            ttlSeconds: 300,
        });

        expect(() => claimArgumentBlockLease({
            draftPostId: 42,
            draftVersion: 2,
            blockId: 'paragraph:0',
            holderUserId: 77,
            canClaimLease: true,
            now: '2026-03-16T11:01:00.000Z',
            ttlSeconds: 300,
            existingLease: activeLease,
        })).toThrow('argument_block_lease_conflict');
    });

    test('releases an active lease and prevents further heartbeats', () => {
        const lease = claimArgumentBlockLease({
            draftPostId: 42,
            draftVersion: 2,
            blockId: 'paragraph:1',
            holderUserId: 77,
            canClaimLease: true,
            now: '2026-03-16T11:00:00.000Z',
            ttlSeconds: 300,
        });

        const released = releaseArgumentBlockLease({
            lease,
            now: '2026-03-16T11:02:00.000Z',
            releaseReason: 'user_cancelled',
        });

        expect(released).toMatchObject({
            status: 'released',
            releasedAt: '2026-03-16T11:02:00.000Z',
            releaseReason: 'user_cancelled',
        });

        expect(() => heartbeatArgumentBlockLease({
            lease: released,
            now: '2026-03-16T11:03:00.000Z',
            ttlSeconds: 300,
        })).toThrow('argument_block_lease_not_active');
    });
});
