import { IdentityLevel, type IdentityThresholds } from './thresholds';
import type { AppLocale } from '../i18n/locale';
import { localizeIdentityReason } from './reasonLocalization';

type IdentityReasonKey =
    | 'identity.message_threshold_promoted'
    | 'identity.citation_threshold_promoted'
    | 'identity.reputation_threshold_promoted'
    | 'identity.reputation_demotion'
    | 'identity.inactivity_demotion';

interface IdentityReasonMetadata {
    reasonKey: IdentityReasonKey;
    reasonParams: Record<string, string>;
}

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
    locale: AppLocale;
}): string {
    const locale = input.locale;
    if (input.latestEvaluationReason) {
        return localizeIdentityReason(input.latestEvaluationReason, locale);
    }
    if (input.currentLevel === IdentityLevel.Visitor) {
        return localizeIdentityReason(
            buildVisitorEligibilityReason(input.messageCount, input.thresholds.initiateMessages),
            locale,
        );
    }
    if (input.currentLevel === IdentityLevel.Initiate) {
        return localizeIdentityReason(
            buildInitiateEligibilityReason(input.citationCount, input.thresholds.memberCitations),
            locale,
        );
    }
    if (input.currentLevel === IdentityLevel.Member) {
        return localizeIdentityReason(
            buildMemberElderEligibilityReason(input.reputationPercentile, input.thresholds.elderPercentile),
            locale,
        );
    }
    return localizeIdentityReason('已处于长老层级，保持活跃可维持当前身份。', locale);
}

export function buildVisitorDustHint(locale: AppLocale): string {
    if (locale === 'en') {
        return 'Visitors can send dust messages, but they do not enter the formal settlement flow.';
    }
    if (locale === 'es') {
        return 'Los visitantes pueden enviar mensajes efímeros, pero no entran en el flujo formal de asentamiento.';
    }
    if (locale === 'fr') {
        return 'Les visiteurs peuvent envoyer des messages éphémères, mais ils n’entrent pas dans le flux formel de consolidation.';
    }
    return '游客可发烟尘消息，但不进入正式沉淀链路。';
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
    body: string | null;
    sourceId: string;
    metadata: {
        messageKey: 'identity.level_changed';
        params: {
            circleName?: string;
            previousLevel: IdentityLevel;
            nextLevel: IdentityLevel;
            reasonKey?: IdentityReasonKey;
            reasonParams?: Record<string, string>;
        };
    };
} {
    const sourceId = `${input.previousLevel}->${input.newLevel}`;
    const reasonMetadata = buildIdentityReasonMetadata(input.reason);
    const circleName = String(input.circleName || '').trim();
    return {
        title: 'identity.level_changed',
        body: null,
        sourceId,
        metadata: {
            messageKey: 'identity.level_changed',
            params: {
                ...(circleName ? { circleName } : {}),
                previousLevel: input.previousLevel,
                nextLevel: input.newLevel,
                ...(reasonMetadata ?? {}),
            },
        },
    };
}

function buildIdentityReasonMetadata(reason: string | undefined): IdentityReasonMetadata | null {
    if (!reason) return null;

    const messagePromotion = reason.match(/^已发送 (\d+) 条消息，达到 (\d+) 条门槛，已晋升为入局者。$/);
    if (messagePromotion) {
        return {
            reasonKey: 'identity.message_threshold_promoted',
            reasonParams: {
                messageCount: messagePromotion[1],
                threshold: messagePromotion[2],
            },
        };
    }

    const citationPromotion = reason.match(/^已获得 (\d+) 次引用，达到 (\d+) 次门槛，已晋升为成员。$/);
    if (citationPromotion) {
        return {
            reasonKey: 'identity.citation_threshold_promoted',
            reasonParams: {
                citationCount: citationPromotion[1],
                threshold: citationPromotion[2],
            },
        };
    }

    const reputationPromotion = reason.match(/^当前信誉位于前 ([\d.]+)%（阈值前 ([\d.]+)%），已晋升为长老。$/);
    if (reputationPromotion) {
        return {
            reasonKey: 'identity.reputation_threshold_promoted',
            reasonParams: {
                reputationPercentile: reputationPromotion[1],
                threshold: reputationPromotion[2],
            },
        };
    }

    const reputationDemotion = reason.match(/^当前信誉已降至前 ([\d.]+)% 之外（阈值前 ([\d.]+)%），身份调整为成员。$/);
    if (reputationDemotion) {
        return {
            reasonKey: 'identity.reputation_demotion',
            reasonParams: {
                reputationPercentile: reputationDemotion[1],
                threshold: reputationDemotion[2],
            },
        };
    }

    const inactivityDemotion = reason.match(/^已 (\d+) 天未活跃（阈值 (\d+) 天），身份调整为入局者。$/);
    if (inactivityDemotion) {
        return {
            reasonKey: 'identity.inactivity_demotion',
            reasonParams: {
                daysInactive: inactivityDemotion[1],
                threshold: inactivityDemotion[2],
            },
        };
    }

    return null;
}
