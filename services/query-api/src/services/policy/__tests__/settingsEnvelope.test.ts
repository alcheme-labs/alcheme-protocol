import { describe, expect, jest, test } from '@jest/globals';

import {
    loadCircleSettingsEnvelope,
    persistCircleSettingsEnvelopeSection,
    resolveProjectedCircleSettings,
} from '../settingsEnvelope';

describe('circle settings envelope raw prisma binding', () => {
    test('loadCircleSettingsEnvelope keeps prisma binding for $queryRaw', async () => {
        let capturedThis: unknown = null;
        const prisma = {
            marker: 'prisma',
            $queryRaw(this: unknown) {
                capturedThis = this;
                return Promise.resolve([{
                    settingsEnvelope: {
                        v: 1,
                        sections: {
                            membership_policy: {
                                settingKind: 'membership_policy',
                                payload: {
                                    joinRequirement: 'ApprovalRequired',
                                    circleType: 'Closed',
                                    minCrystals: 0,
                                },
                                actorPubkey: 'owner-pubkey',
                                signedMessage: 'signed',
                                signature: 'signature',
                                digest: 'digest',
                                clientTimestamp: '2026-03-27T00:00:00.000Z',
                                nonce: 'nonce',
                                updatedAt: '2026-03-27T00:00:00.000Z',
                            },
                        },
                    },
                }]);
            },
        } as any;

        const result = await loadCircleSettingsEnvelope(prisma, 7);

        expect(capturedThis).toBe(prisma);
        expect(result?.sections.membership_policy?.payload).toMatchObject({
            joinRequirement: 'ApprovalRequired',
            circleType: 'Closed',
            minCrystals: 0,
        });
    });

    test('persistCircleSettingsEnvelopeSection keeps prisma binding for raw executors', async () => {
        let unsafeThis: unknown = null;
        let executeThis: unknown = null;
        const prisma = {
            marker: 'prisma',
            $executeRawUnsafe: jest.fn(function (this: unknown) {
                unsafeThis = this;
                return Promise.resolve(0);
            }),
            $executeRaw: jest.fn(function (this: unknown) {
                executeThis = this;
                return Promise.resolve(1);
            }),
        } as any;

        await persistCircleSettingsEnvelopeSection(prisma, {
            circleId: 7,
            actorUserId: 9,
            section: {
                settingKind: 'membership_policy',
                payload: {
                    joinRequirement: 'ApprovalRequired',
                    circleType: 'Closed',
                    minCrystals: 0,
                },
                actorPubkey: 'owner-pubkey',
                signedMessage: 'signed-message',
                signature: 'signature',
                digest: 'digest',
                clientTimestamp: '2026-03-27T00:00:00.000Z',
                nonce: 'nonce',
                updatedAt: '2026-03-27T00:00:00.000Z',
                anchor: null,
            },
        });

        expect(unsafeThis).toBe(prisma);
        expect(executeThis).toBe(prisma);
        expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
        expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    test('resolveProjectedCircleSettings keeps indexed minCrystals as the projection authority', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [{
                settingsEnvelope: {
                    v: 1,
                    sections: {
                        membership_policy: {
                            settingKind: 'membership_policy',
                            payload: {
                                joinRequirement: 'TokenGated',
                                circleType: 'Open',
                                minCrystals: 2,
                            },
                            actorPubkey: 'owner-pubkey',
                            signedMessage: 'signed',
                            signature: 'signature',
                            digest: 'digest',
                            clientTimestamp: '2026-03-27T00:00:00.000Z',
                            nonce: 'nonce',
                            updatedAt: '2026-03-27T00:00:00.000Z',
                        },
                    },
                },
            }]),
        } as any;

        const result = await resolveProjectedCircleSettings(prisma, {
            id: 7,
            joinRequirement: 'Free' as any,
            circleType: 'Open' as any,
            minCrystals: 5,
        });

        expect(result).toMatchObject({
            joinRequirement: 'TokenGated',
            circleType: 'Open',
            minCrystals: 5,
            source: 'signed_envelope',
        });
    });
});
