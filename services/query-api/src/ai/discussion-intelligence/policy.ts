import { PrismaClient } from '@prisma/client';
import { loadGhostConfig } from '../ghost/config';
import {
    loadCircleGhostSettingsPatch,
    resolveCircleGhostSettings,
} from '../ghost/circle-settings';
import { DiscussionIntelligencePolicy } from './types';

export async function resolveDiscussionPolicyForCircle(
    prisma: PrismaClient,
    circleId: number,
): Promise<DiscussionIntelligencePolicy> {
    const ghostConfig = loadGhostConfig();
    const circlePatch = await loadCircleGhostSettingsPatch(prisma, circleId);
    const settings = resolveCircleGhostSettings(ghostConfig, circlePatch);

    return {
        circleId,
        source: circlePatch ? 'circle' : 'global_default',
        settings,
        triggerThresholds: {
            enabled: ghostConfig.trigger.enabled,
            windowSize: ghostConfig.trigger.windowSize,
            minMessages: ghostConfig.trigger.minMessages,
            minQuestionCount: ghostConfig.trigger.minQuestionCount,
            minFocusedRatio: ghostConfig.trigger.minFocusedRatio,
            cooldownSec: ghostConfig.trigger.cooldownSec,
        },
    };
}

