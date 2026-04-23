import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const enqueueDiscussionTriggerEvaluationJobMock = jest.fn();

jest.mock('../../../../ai/discussion-draft-trigger', () => ({
    enqueueDiscussionTriggerEvaluationJob: (...args: unknown[]) => enqueueDiscussionTriggerEvaluationJobMock(...args),
}));

import { runDiscussionAnalysisPostWriteEffects } from '../postWriteEffects';

describe('discussion analysis post-write effects', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('invalidates summary cache and re-enqueues trigger evaluation when a message becomes ready', async () => {
        const prisma = {} as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;
        (enqueueDiscussionTriggerEvaluationJobMock as any).mockResolvedValue({ id: 12 });

        await runDiscussionAnalysisPostWriteEffects({
            prisma,
            redis,
            circleId: 7,
            previousStatus: 'pending',
            nextStatus: 'ready',
            requestedByUserId: 9,
        });

        expect(redis.del).toHaveBeenCalledWith('discussion:summary:circle:7');
        expect(enqueueDiscussionTriggerEvaluationJobMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            requestedByUserId: 9,
        });
    });

    test('does not enqueue trigger evaluation when the status does not transition to ready', async () => {
        const prisma = {} as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;

        await runDiscussionAnalysisPostWriteEffects({
            prisma,
            redis,
            circleId: 7,
            previousStatus: 'ready',
            nextStatus: 'ready',
        });

        expect(redis.del).toHaveBeenCalledWith('discussion:summary:circle:7');
        expect(enqueueDiscussionTriggerEvaluationJobMock).not.toHaveBeenCalled();
    });
});
