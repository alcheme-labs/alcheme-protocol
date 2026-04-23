import { IdentityLevel, type IdentityThresholds } from './thresholds';

const IDENTITY_LEVEL_LABEL: Record<IdentityLevel, string> = {
    [IdentityLevel.Visitor]: '游客',
    [IdentityLevel.Initiate]: '入局者',
    [IdentityLevel.Member]: '成员',
    [IdentityLevel.Elder]: '长老',
};

const IDENTITY_LEVEL_ORDER: Record<IdentityLevel, number> = {
    [IdentityLevel.Visitor]: 0,
    [IdentityLevel.Initiate]: 1,
    [IdentityLevel.Member]: 2,
    [IdentityLevel.Elder]: 3,
};

export function buildVisitorEligibilityReason(messageCount: number, initiateMessages: number): string {
    return `已发送 ${messageCount} 条消息，达到 ${initiateMessages} 条可晋升为入局者。`;
}

export function buildVisitorPromotionReason(messageCount: number, initiateMessages: number): string {
    return `已发送 ${messageCount} 条消息，达到 ${initiateMessages} 条门槛，已晋升为入局者。`;
}

export function buildInitiateEligibilityReason(citationCount: number, memberCitations: number): string {
    return `已获得 ${citationCount} 次引用，达到 ${memberCitations} 次可晋升为成员。`;
}

export function buildInitiatePromotionReason(citationCount: number, memberCitations: number): string {
    return `已获得 ${citationCount} 次引用，达到 ${memberCitations} 次门槛，已晋升为成员。`;
}

export function buildMemberElderEligibilityReason(
    reputationPercentile: number | null | undefined,
    elderPercentile: number,
): string {
    if (reputationPercentile === null || reputationPercentile === undefined) {
        return '继续保持贡献与信誉，有机会晋升为长老。';
    }
    if (reputationPercentile <= elderPercentile) {
        return `当前信誉位于前 ${reputationPercentile}%（阈值前 ${elderPercentile}%）可晋升为长老。`;
    }
    return `当前信誉位于前 ${reputationPercentile}%（需进入前 ${elderPercentile}%）方可晋升为长老。`;
}

export function buildMemberElderPromotionReason(reputationPercentile: number, elderPercentile: number): string {
    return `当前信誉位于前 ${reputationPercentile}%（阈值前 ${elderPercentile}%），已晋升为长老。`;
}

export function buildIdentityHint(input: {
    currentLevel: IdentityLevel;
    nextLevel?: IdentityLevel | null;
    thresholds: IdentityThresholds;
    messageCount: number;
    citationCount: number;
    reputationPercentile: number | null;
    latestEvaluationReason?: string | null;
}): string {
    if (input.latestEvaluationReason) {
        return input.latestEvaluationReason;
    }
    if (input.currentLevel === IdentityLevel.Visitor) {
        return buildVisitorEligibilityReason(input.messageCount, input.thresholds.initiateMessages);
    }
    if (input.currentLevel === IdentityLevel.Initiate) {
        return buildInitiateEligibilityReason(input.citationCount, input.thresholds.memberCitations);
    }
    if (input.currentLevel === IdentityLevel.Member) {
        return buildMemberElderEligibilityReason(input.reputationPercentile, input.thresholds.elderPercentile);
    }
    return '已处于长老层级，保持活跃可维持当前身份。';
}

export function buildCompletedIdentityTransitionReason(input: {
    previousLevel: IdentityLevel;
    newLevel: IdentityLevel;
    thresholds: IdentityThresholds;
    messageCount: number;
    citationCount: number;
    reputationPercentile?: number;
    fallbackReason?: string;
}): string | undefined {
    if (input.previousLevel === IdentityLevel.Visitor && input.newLevel === IdentityLevel.Initiate) {
        return buildVisitorPromotionReason(input.messageCount, input.thresholds.initiateMessages);
    }
    if (input.previousLevel === IdentityLevel.Initiate && input.newLevel === IdentityLevel.Member) {
        return buildInitiatePromotionReason(input.citationCount, input.thresholds.memberCitations);
    }
    if (
        input.previousLevel === IdentityLevel.Member
        && input.newLevel === IdentityLevel.Elder
        && typeof input.reputationPercentile === 'number'
    ) {
        return buildMemberElderPromotionReason(input.reputationPercentile, input.thresholds.elderPercentile);
    }
    return input.fallbackReason;
}

export function buildIdentityNotification(input: {
    circleId: number;
    circleName?: string | null;
    previousLevel: IdentityLevel;
    newLevel: IdentityLevel;
    reason?: string;
}): {
    title: string;
    body: string;
    sourceId: string;
} {
    const circleLabel = String(input.circleName || '').trim() || `圈层 #${input.circleId}`;
    const previousLabel = IDENTITY_LEVEL_LABEL[input.previousLevel];
    const nextLabel = IDENTITY_LEVEL_LABEL[input.newLevel];
    const isPromotion = IDENTITY_LEVEL_ORDER[input.newLevel] > IDENTITY_LEVEL_ORDER[input.previousLevel];
    const title = isPromotion
        ? `身份晋升为${nextLabel}`
        : `身份调整为${nextLabel}`;
    const reasonText = input.reason ? `原因：${input.reason}` : '系统基于贡献与活跃度自动评估。';
    const body = `你在「${circleLabel}」的身份由${previousLabel}变更为${nextLabel}。${reasonText}`;
    const sourceId = `${input.previousLevel}->${input.newLevel}`;
    return { title, body, sourceId };
}
