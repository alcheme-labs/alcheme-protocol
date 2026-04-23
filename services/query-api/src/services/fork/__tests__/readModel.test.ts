import { describe, expect, jest, test } from '@jest/globals';

import { loadForkLineageView } from '../readModel';

describe('fork lineage read model', () => {
    test('surfaces retention-backed source marker state alongside lineage truth', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => ([{
                lineageId: 'fork-lineage-1',
                sourceCircleId: 7,
                targetCircleId: 71,
                declarationId: 'fork-declaration-1',
                sourceCircleName: 'Source Circle',
                targetCircleName: 'Forked Circle',
                declarationText: '需要沿着不同的未来方向继续。',
                status: 'completed',
                originAnchorRef: 'knowledge:alpha',
                executionAnchorDigest: 'a'.repeat(64),
                createdAt: new Date('2026-03-22T19:00:00.000Z'),
                currentCheckpointDay: 30,
                nextCheckAt: new Date('2026-04-21T19:00:00.000Z'),
                inactiveStreak: 0,
                markerVisible: true,
                permanentAt: null,
                hiddenAt: null,
                lastEvaluatedAt: new Date('2026-03-29T19:00:00.000Z'),
            }])),
        } as any;

        const view = await loadForkLineageView(prisma, 7);

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(view.asSource).toHaveLength(1);
        expect(view.asSource[0]).toMatchObject({
            targetCircleId: 71,
            markerVisible: true,
            currentCheckpointDay: 30,
            inactiveStreak: 0,
            nextCheckAt: '2026-04-21T19:00:00.000Z',
            permanentAt: null,
            hiddenAt: null,
        });
    });
});
