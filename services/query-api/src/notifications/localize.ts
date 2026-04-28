import type { AppLocale } from '../i18n/locale';
import { localizeIdentityReason } from '../identity/reasonLocalization';

type NotificationType = 'draft' | 'forward' | 'highlight' | 'identity' | 'crystal' | 'citation' | 'circle';
type IdentityLevel = 'Visitor' | 'Initiate' | 'Member' | 'Elder';
type TotemStage = 'sprout' | 'bloom' | 'radiant' | 'legendary';

const KNOWN_NOTIFICATION_TYPES = new Set<NotificationType>([
    'draft',
    'forward',
    'highlight',
    'identity',
    'crystal',
    'citation',
    'circle',
]);
const IDENTITY_LEVEL_ORDER: Record<IdentityLevel, number> = {
    Visitor: 0,
    Initiate: 1,
    Member: 2,
    Elder: 3,
};

const IDENTITY_LEVEL_LABELS: Record<AppLocale, Record<IdentityLevel, string>> = {
    zh: {
        Visitor: '游客',
        Initiate: '入局者',
        Member: '成员',
        Elder: '长老',
    },
    en: {
        Visitor: 'Visitor',
        Initiate: 'Initiate',
        Member: 'Member',
        Elder: 'Elder',
    },
    es: {
        Visitor: 'Visitante',
        Initiate: 'Iniciado',
        Member: 'Miembro',
        Elder: 'Anciano',
    },
    fr: {
        Visitor: 'Visiteur',
        Initiate: 'Initié',
        Member: 'Membre',
        Elder: 'Ancien',
    },
};

const FORWARD_TITLE: Record<Exclude<AppLocale, 'zh'>, string> = {
    en: 'Your message was forwarded',
    es: 'Tu mensaje fue reenviado',
    fr: 'Votre message a été transféré',
};

const HIGHLIGHT_TITLE: Record<Exclude<AppLocale, 'zh'>, string> = {
    en: 'Your message was highlighted',
    es: 'Tu mensaje fue destacado',
    fr: 'Votre message a été mis en avant',
};

const DRAFT_TITLE: Record<AppLocale, string> = {
    zh: '讨论可转草稿',
    en: 'Discussion ready for a draft',
    es: 'La discusión ya puede pasar a borrador',
    fr: 'La discussion peut passer en brouillon',
};

const CRYSTAL_TITLE: Record<Exclude<AppLocale, 'zh'>, string> = {
    en: 'Knowledge crystallized',
    es: 'Conocimiento cristalizado',
    fr: 'Connaissance cristallisée',
};

const CITATION_TITLE: Record<Exclude<AppLocale, 'zh'>, string> = {
    en: 'Your crystal was cited',
    es: 'Tu cristal fue citado',
    fr: 'Votre cristal a été cité',
};

const MILESTONE_TITLE: Record<Exclude<AppLocale, 'zh'>, string> = {
    en: 'Crystal milestone',
    es: 'Hito de cristales',
    fr: 'Jalon de cristaux',
};

const TOTEM_COPY: Record<Exclude<AppLocale, 'zh'>, Record<TotemStage, NotificationLocalizationResult>> = {
    en: {
        sprout: {
            displayTitle: 'Your totem began to sprout',
            displayBody: 'Your first knowledge crystal brought your totem to life.',
        },
        bloom: {
            displayTitle: 'Your totem is blooming',
            displayBody: 'Sustained contributions are making your totem brighter.',
        },
        radiant: {
            displayTitle: 'Your totem is radiant',
            displayBody: 'Your thinking has taken root across multiple circles, and your totem is shining.',
        },
        legendary: {
            displayTitle: 'Your totem became legendary',
            displayBody: 'Your knowledge has become a cornerstone of the community.',
        },
    },
    es: {
        sprout: {
            displayTitle: 'Tu tótem empezó a brotar',
            displayBody: 'Tu primer cristal de conocimiento dio vida a tu tótem.',
        },
        bloom: {
            displayTitle: 'Tu tótem está floreciendo',
            displayBody: 'Tus contribuciones constantes hacen que tu tótem brille más.',
        },
        radiant: {
            displayTitle: 'Tu tótem está radiante',
            displayBody: 'Tu pensamiento echó raíces en varios círculos, y tu tótem está brillando.',
        },
        legendary: {
            displayTitle: 'Tu tótem se volvió legendario',
            displayBody: 'Tu conocimiento se convirtió en una piedra angular de la comunidad.',
        },
    },
    fr: {
        sprout: {
            displayTitle: 'Votre totem commence à germer',
            displayBody: 'Votre premier cristal de connaissance a donné vie à votre totem.',
        },
        bloom: {
            displayTitle: 'Votre totem fleurit',
            displayBody: 'Vos contributions régulières rendent votre totem plus lumineux.',
        },
        radiant: {
            displayTitle: 'Votre totem rayonne',
            displayBody: 'Votre pensée a pris racine dans plusieurs cercles, et votre totem rayonne.',
        },
        legendary: {
            displayTitle: 'Votre totem est devenu légendaire',
            displayBody: 'Votre connaissance est devenue une pierre angulaire de la communauté.',
        },
    },
};

export interface NotificationLocalizationInput {
    type: string;
    title: string;
    body: string | null;
    metadata?: unknown;
    sourceType: string | null;
    sourceId: string | null;
    circleId: number | null;
}

export interface NotificationLocalizationResult {
    displayTitle: string;
    displayBody: string | null;
}

export function localizeNotification(
    notification: NotificationLocalizationInput,
    input: {
        locale: AppLocale;
        circleName?: string | null;
    },
): NotificationLocalizationResult {
    const locale = input.locale;

    const structured = localizeStructuredNotification(notification, locale, input.circleName ?? null);
    if (structured) {
        return structured;
    }

    const notificationType = notification.type as NotificationType;
    if (locale === 'zh') {
        if (notificationType === 'draft') {
            return localizeDraft(notification, locale);
        }
        return {
            displayTitle: notification.title,
            displayBody: notification.body,
        };
    }

    if (!KNOWN_NOTIFICATION_TYPES.has(notificationType)) {
        return {
            displayTitle: notification.title,
            displayBody: notification.body,
        };
    }

    switch (notificationType) {
        case 'forward':
            return localizeForward(notification, locale);
        case 'highlight':
            return localizeHighlight(notification, locale);
        case 'draft':
            return localizeDraft(notification, locale);
        case 'identity':
            return localizeIdentity(notification, {
                locale,
                circleName: input.circleName,
            });
        case 'crystal':
            return localizeCrystal(notification, locale);
        case 'citation':
            return localizeCitation(notification, locale);
        case 'circle':
            return localizeCircle(notification, locale);
        default:
            return {
                displayTitle: notification.title,
                displayBody: notification.body,
            };
    }
}

function localizeForward(
    notification: NotificationLocalizationInput,
    locale: Exclude<AppLocale, 'zh'>,
): NotificationLocalizationResult {
    const match = String(notification.body || '').match(/^(.+?) 将你的消息转发到了 (.+)$/);
    if (!match) {
        return {
            displayTitle: FORWARD_TITLE[locale],
            displayBody: notification.body,
        };
    }

    const sender = match[1];
    const circleName = match[2];
    return localizeForwardMessage(sender, circleName, locale);
}

function localizeForwardMessage(
    sender: string,
    circleName: string,
    locale: AppLocale,
): NotificationLocalizationResult {
    if (locale === 'zh') {
        return {
            displayTitle: '你的消息被转发了',
            displayBody: `${sender} 将你的消息转发到了 ${circleName}`,
        };
    }

    const body = locale === 'en'
        ? `${sender} forwarded your message to ${circleName}.`
        : locale === 'es'
            ? `${sender} reenvió tu mensaje a ${circleName}.`
            : `${sender} a transféré votre message vers ${circleName}.`;

    return {
        displayTitle: FORWARD_TITLE[locale],
        displayBody: body,
    };
}

function localizeHighlight(
    notification: NotificationLocalizationInput,
    locale: Exclude<AppLocale, 'zh'>,
): NotificationLocalizationResult {
    return localizeHighlightMessage(locale);
}

function localizeHighlightMessage(locale: AppLocale): NotificationLocalizationResult {
    if (locale === 'zh') {
        return {
            displayTitle: '你的发言被点亮了',
            displayBody: '你在讨论中的发言被其他成员点亮',
        };
    }

    const body = locale === 'en'
        ? 'Another member highlighted your discussion message.'
        : locale === 'es'
            ? 'Otro miembro destacó tu mensaje en la discusión.'
            : 'Un autre membre a mis en avant votre message dans la discussion.';

    return {
        displayTitle: HIGHLIGHT_TITLE[locale],
        displayBody: body,
    };
}

function localizeCrystal(
    notification: NotificationLocalizationInput,
    locale: Exclude<AppLocale, 'zh'>,
): NotificationLocalizationResult {
    if (notification.sourceType === 'totem') {
        const stage = parseTotemStage(notification.sourceId);
        if (stage) {
            return localizeTotemStage(stage, locale);
        }

        return {
            displayTitle: locale === 'en'
                ? 'Your totem evolved'
                : locale === 'es'
                    ? 'Tu tótem evolucionó'
                    : 'Votre totem a évolué',
            displayBody: locale === 'en'
                ? 'Your contribution changed your totem stage.'
                : locale === 'es'
                    ? 'Tu contribución cambió el nivel de tu tótem.'
                    : 'Votre contribution a changé le niveau de votre totem.',
        };
    }

    const title = parseKnowledgeCrystallizedTitle(notification.body);
    return localizeKnowledgeCrystallized(title, locale);
}

function localizeCitation(
    notification: NotificationLocalizationInput,
    locale: Exclude<AppLocale, 'zh'>,
): NotificationLocalizationResult {
    const title = parseKnowledgeCitationTitle(notification.body);
    return localizeKnowledgeCitation(title, locale);
}

function localizeCircle(
    notification: NotificationLocalizationInput,
    locale: Exclude<AppLocale, 'zh'>,
): NotificationLocalizationResult {
    if (notification.sourceType !== 'milestone') {
        return {
            displayTitle: notification.title,
            displayBody: notification.body,
        };
    }

    const milestone = parseCrystalMilestone(notification.sourceId) || parseCrystalMilestone(notification.body);
    return localizeCrystalMilestone(milestone, locale);
}

function localizeStructuredNotification(
    notification: NotificationLocalizationInput,
    locale: AppLocale,
    circleName: string | null,
): NotificationLocalizationResult | null {
    const metadata = parseNotificationMetadata(notification.metadata);
    if (!metadata) return null;

    switch (metadata.messageKey) {
        case 'discussion.forwarded': {
            const senderLabel = getStringParam(metadata.params, 'senderLabel');
            const targetCircleName = getStringParam(metadata.params, 'targetCircleName');
            return senderLabel && targetCircleName
                ? localizeForwardMessage(senderLabel, targetCircleName, locale)
                : null;
        }
        case 'discussion.highlighted':
            return localizeHighlightMessage(locale);
        case 'discussion.draft_ready': {
            const parsed = {
                messageCount: getNumericStringParam(metadata.params, 'messageCount') || '',
                focusedPercent: getNumericStringParam(metadata.params, 'focusedPercent') || '',
                questionCount: getNumericStringParam(metadata.params, 'questionCount') || '',
                summary: getStringParam(metadata.params, 'summary') || '',
            };
            return parsed.messageCount && parsed.focusedPercent && parsed.questionCount && parsed.summary
                ? localizeDraftReady(parsed, locale)
                : null;
        }
        case 'identity.level_changed': {
            const previousLevel = getStringParam(metadata.params, 'previousLevel');
            const nextLevel = getStringParam(metadata.params, 'nextLevel');
            if (!isIdentityLevel(previousLevel) || !isIdentityLevel(nextLevel)) return null;
            return localizeIdentityLevelChanged({
                locale,
                circleId: notification.circleId,
                circleName: getStringParam(metadata.params, 'circleName') || circleName,
                previousLevel,
                nextLevel,
                reasonKey: getStringParam(metadata.params, 'reasonKey'),
                reasonParams: getRecordParam(metadata.params, 'reasonParams'),
                legacyReason: getStringParam(metadata.params, 'reason'),
            });
        }
        case 'knowledge.crystallized':
            return localizeKnowledgeCrystallized(getStringParam(metadata.params, 'knowledgeTitle'), locale);
        case 'knowledge.cited':
            return localizeKnowledgeCitation(getStringParam(metadata.params, 'knowledgeTitle'), locale);
        case 'knowledge.crystal_milestone':
            return localizeCrystalMilestone(getNumericStringParam(metadata.params, 'milestone'), locale);
        case 'totem.stage_upgraded': {
            const stage = getStringParam(metadata.params, 'stage');
            return isTotemStage(stage) ? localizeTotemStage(stage, locale) : null;
        }
        default:
            return null;
    }
}

function localizeIdentityLevelChanged(input: {
    locale: AppLocale;
    circleId: number | null;
    circleName: string | null;
    previousLevel: IdentityLevel;
    nextLevel: IdentityLevel;
    reasonKey: string | null;
    reasonParams: Record<string, unknown>;
    legacyReason: string | null;
}): NotificationLocalizationResult {
    const previousLabel = IDENTITY_LEVEL_LABELS[input.locale][input.previousLevel];
    const nextLabel = IDENTITY_LEVEL_LABELS[input.locale][input.nextLevel];
    const promotion = IDENTITY_LEVEL_ORDER[input.nextLevel] > IDENTITY_LEVEL_ORDER[input.previousLevel];
    const title = input.locale === 'zh'
        ? `${promotion ? '身份晋升为' : '身份调整为'}${nextLabel}`
        : input.locale === 'en'
        ? `${promotion ? 'Promoted to' : 'Identity updated to'} ${nextLabel}`
        : input.locale === 'es'
            ? `${promotion ? 'Ascenso a' : 'Identidad actualizada a'} ${nextLabel}`
            : `${promotion ? 'Promotion au niveau' : 'Identité mise à jour :'} ${nextLabel}`;
    const circleLabel = input.circleName?.trim() || fallbackCircleLabel(input.circleId, input.locale);
    const localizedReason = localizeStructuredIdentityReason(
        input.reasonKey,
        input.reasonParams,
        input.legacyReason,
        input.locale,
    );
    const body = input.locale === 'zh'
        ? `你在「${circleLabel}」的身份由${previousLabel}变更为${nextLabel}。原因：${localizedReason}`
        : input.locale === 'en'
        ? `Your role in “${circleLabel}” changed from ${previousLabel} to ${nextLabel}. ${localizedReason}`
        : input.locale === 'es'
            ? `Tu rol en «${circleLabel}» cambió de ${previousLabel} a ${nextLabel}. ${localizedReason}`
            : `Votre rôle dans «${circleLabel}» est passé de ${previousLabel} à ${nextLabel}. ${localizedReason}`;

    return {
        displayTitle: title,
        displayBody: body,
    };
}

function localizeStructuredIdentityReason(
    reasonKey: string | null,
    params: Record<string, unknown>,
    legacyReason: string | null,
    locale: AppLocale,
): string {
    const messageCount = getNumericStringParam(params, 'messageCount');
    const citationCount = getNumericStringParam(params, 'citationCount');
    const reputationPercentile = getNumericStringParam(params, 'reputationPercentile');
    const daysInactive = getNumericStringParam(params, 'daysInactive');
    const threshold = getNumericStringParam(params, 'threshold');

    if (reasonKey === 'identity.message_threshold_promoted' && messageCount && threshold) {
        return locale === 'zh'
            ? `已发送 ${messageCount} 条消息，达到 ${threshold} 条门槛，已晋升为入局者。`
            : locale === 'en'
            ? `You reached ${messageCount} sent messages and crossed the ${threshold}-message threshold for Initiate.`
            : locale === 'es'
                ? `Alcanzaste ${messageCount} mensajes enviados y superaste el umbral de ${threshold} para Iniciado.`
                : `Vous avez atteint ${messageCount} messages envoyés et dépassé le seuil de ${threshold} pour Initié.`;
    }

    if (reasonKey === 'identity.citation_threshold_promoted' && citationCount && threshold) {
        return locale === 'zh'
            ? `已获得 ${citationCount} 次引用，达到 ${threshold} 次门槛，已晋升为成员。`
            : locale === 'en'
            ? `You reached ${citationCount} citations and crossed the ${threshold}-citation threshold for Member.`
            : locale === 'es'
                ? `Has alcanzado ${citationCount} citas y superaste el umbral de ${threshold} para Miembro.`
                : `Vous avez atteint ${citationCount} citations et dépassé le seuil de ${threshold} pour devenir Membre.`;
    }

    if (reasonKey === 'identity.reputation_threshold_promoted' && reputationPercentile && threshold) {
        return locale === 'zh'
            ? `当前信誉位于前 ${reputationPercentile}%（阈值前 ${threshold}%），已晋升为长老。`
            : locale === 'en'
            ? `Your reputation is now in the top ${reputationPercentile}% and has crossed the Elder threshold of ${threshold}%.`
            : locale === 'es'
                ? `Tu reputación está ahora en el ${reputationPercentile}% superior y ya superó el umbral de ${threshold}% para Anciano.`
                : `Votre réputation est maintenant dans le top ${reputationPercentile}% et a dépassé le seuil de ${threshold}% pour Ancien.`;
    }

    if (reasonKey === 'identity.reputation_demotion' && reputationPercentile && threshold) {
        return locale === 'zh'
            ? `当前信誉已降至前 ${reputationPercentile}% 之外（阈值前 ${threshold}%），身份调整为成员。`
            : locale === 'en'
            ? `Your reputation is now in the top ${reputationPercentile}%, outside the Elder threshold of ${threshold}%, so your role changed to Member.`
            : locale === 'es'
                ? `Tu reputación está ahora en el ${reputationPercentile}% superior, fuera del umbral de ${threshold}% para Anciano, por lo que tu rol cambió a Miembro.`
                : `Votre réputation est maintenant dans le top ${reputationPercentile}%, hors du seuil Ancien de ${threshold}%, votre rôle est donc passé à Membre.`;
    }

    if (reasonKey === 'identity.inactivity_demotion' && daysInactive && threshold) {
        return locale === 'zh'
            ? `已 ${daysInactive} 天未活跃（阈值 ${threshold} 天），身份调整为入局者。`
            : locale === 'en'
            ? `You have been inactive for ${daysInactive} days; the inactivity threshold is ${threshold} days.`
            : locale === 'es'
                ? `Has estado inactivo durante ${daysInactive} días; el umbral de inactividad es de ${threshold} días.`
                : `Vous avez été inactif pendant ${daysInactive} jours ; le seuil d’inactivité est de ${threshold} jours.`;
    }

    return localizeIdentityReason(legacyReason, locale);
}

function localizeKnowledgeCrystallized(
    title: string | null,
    locale: AppLocale,
): NotificationLocalizationResult {
    if (locale === 'zh') {
        return {
            displayTitle: '知识已结晶',
            displayBody: title ? `你的知识「${title}」已成功结晶` : '你的知识已成功结晶',
        };
    }

    const body = title
        ? locale === 'en'
            ? `Your knowledge “${title}” was successfully crystallized.`
            : locale === 'es'
                ? `Tu conocimiento «${title}» se cristalizó correctamente.`
                : `Votre connaissance «${title}» a bien été cristallisée.`
        : locale === 'en'
            ? 'Your knowledge was successfully crystallized.'
            : locale === 'es'
                ? 'Tu conocimiento se cristalizó correctamente.'
                : 'Votre connaissance a bien été cristallisée.';

    return {
        displayTitle: CRYSTAL_TITLE[locale],
        displayBody: body,
    };
}

function localizeKnowledgeCitation(
    title: string | null,
    locale: AppLocale,
): NotificationLocalizationResult {
    if (locale === 'zh') {
        return {
            displayTitle: '你的晶体被引用了',
            displayBody: title ? `你的知识「${title}」被其他晶体引用` : '你的知识被其他晶体引用',
        };
    }

    const body = title
        ? locale === 'en'
            ? `Your knowledge “${title}” was cited by another crystal.`
            : locale === 'es'
                ? `Tu conocimiento «${title}» fue citado por otro cristal.`
                : `Votre connaissance «${title}» a été citée par un autre cristal.`
        : locale === 'en'
            ? 'Your knowledge was cited by another crystal.'
            : locale === 'es'
                ? 'Tu conocimiento fue citado por otro cristal.'
                : 'Votre connaissance a été citée par un autre cristal.';

    return {
        displayTitle: CITATION_TITLE[locale],
        displayBody: body,
    };
}

function localizeCrystalMilestone(
    milestone: string | null,
    locale: AppLocale,
): NotificationLocalizationResult {
    if (locale === 'zh') {
        return {
            displayTitle: '晶体里程碑',
            displayBody: milestone
                ? `你已拥有 ${milestone} 枚知识晶体！继续探索更多圈层吧`
                : '你已达到新的知识晶体里程碑！继续探索更多圈层吧',
        };
    }

    const body = milestone
        ? locale === 'en'
            ? `You now have ${milestone} knowledge crystals. Keep exploring more circles.`
            : locale === 'es'
                ? `Ya tienes ${milestone} cristales de conocimiento. Sigue explorando más círculos.`
                : `Vous avez maintenant ${milestone} cristaux de connaissance. Continuez à explorer d'autres cercles.`
        : locale === 'en'
            ? 'You reached a new knowledge crystal milestone. Keep exploring more circles.'
            : locale === 'es'
                ? 'Alcanzaste un nuevo hito de cristales de conocimiento. Sigue explorando más círculos.'
                : 'Vous avez atteint un nouveau jalon de cristaux de connaissance. Continuez à explorer d’autres cercles.';

    return {
        displayTitle: MILESTONE_TITLE[locale],
        displayBody: body,
    };
}

function localizeTotemStage(stage: TotemStage, locale: AppLocale): NotificationLocalizationResult {
    if (locale !== 'zh') {
        return TOTEM_COPY[locale][stage];
    }

    switch (stage) {
        case 'sprout':
            return {
                displayTitle: '你的图腾开始萌芽了',
                displayBody: '你的首个知识晶体为图腾注入了生命',
            };
        case 'bloom':
            return {
                displayTitle: '你的图腾正在绽放',
                displayBody: '持续的贡献让你的图腾更加明亮',
            };
        case 'radiant':
            return {
                displayTitle: '你的图腾璀璨夺目',
                displayBody: '你的思考在多个圈层扎根，图腾放射出光芒',
            };
        case 'legendary':
            return {
                displayTitle: '你的图腾已成传世之作',
                displayBody: '你的知识已成为社区的基石',
            };
    }
}

function parseNotificationMetadata(value: unknown): { messageKey: string; params: Record<string, unknown> } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const messageKey = typeof record.messageKey === 'string' ? record.messageKey.trim() : '';
    if (!messageKey) return null;

    const params = record.params && typeof record.params === 'object' && !Array.isArray(record.params)
        ? record.params as Record<string, unknown>
        : {};

    return { messageKey, params };
}

function getStringParam(params: Record<string, unknown>, key: string): string | null {
    const value = params[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getNumericStringParam(params: Record<string, unknown>, key: string): string | null {
    const value = params[key];
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
    return null;
}

function getRecordParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = params[key];
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isTotemStage(value: string | null): value is TotemStage {
    return value === 'sprout' || value === 'bloom' || value === 'radiant' || value === 'legendary';
}

function isIdentityLevel(value: string | null): value is IdentityLevel {
    return value === 'Visitor' || value === 'Initiate' || value === 'Member' || value === 'Elder';
}

function parseTotemStage(sourceId: string | null): TotemStage | null {
    const match = String(sourceId || '').match(/^totem:(sprout|bloom|radiant|legendary)$/);
    return match?.[1] as TotemStage || null;
}

function parseKnowledgeCrystallizedTitle(body: string | null): string | null {
    const match = String(body || '').match(/^你的知识「(.+?)」已成功结晶$/);
    return match?.[1]?.trim() || null;
}

function parseKnowledgeCitationTitle(body: string | null): string | null {
    const match = String(body || '').match(/^你的知识「(.+?)」被其他晶体引用$/);
    return match?.[1]?.trim() || null;
}

function parseCrystalMilestone(value: string | null): string | null {
    const normalized = String(value || '');
    const sourceMatch = normalized.match(/^milestone:(\d+)$/);
    if (sourceMatch?.[1]) return sourceMatch[1];
    const bodyMatch = normalized.match(/^你已拥有 (\d+) 枚知识晶体！继续探索更多圈层吧$/);
    return bodyMatch?.[1] || null;
}

function parseDraftNotificationBody(body: string | null): {
    messageCount: string;
    focusedPercent: string;
    questionCount: string;
    summary: string;
} | null {
    const normalized = String(body || '');
    const zhMatch = normalized.match(
        /^圈层讨论已出现成稿信号（(\d+) 条消息，聚焦 (\d+)%，问题 (\d+) 条）。\n建议进入「草稿」Tab 手动整理并打磨，再发起结晶。\n摘要：(.*)$/s,
    );
    if (zhMatch) {
        const [, messageCount, focusedPercent, questionCount, summary] = zhMatch;
        return { messageCount, focusedPercent, questionCount, summary };
    }
    const enMatch = normalized.match(
        /^This discussion is showing draft-ready signals \((\d+) messages, (\d+)% focused, (\d+) questions\)\.\nOpen the Draft tab to shape it before turning it into a crystal\.\nSummary: (.*)$/s,
    );
    if (enMatch) {
        const [, messageCount, focusedPercent, questionCount, summary] = enMatch;
        return { messageCount, focusedPercent, questionCount, summary };
    }
    return null;
}

function localizeDraft(
    notification: NotificationLocalizationInput,
    locale: AppLocale,
): NotificationLocalizationResult {
    const parsed = parseDraftNotificationBody(notification.body);
    if (!parsed) {
        return {
            displayTitle: DRAFT_TITLE[locale],
            displayBody: notification.body,
        };
    }

    return localizeDraftReady(parsed, locale);
}

function localizeDraftReady(
    parsed: {
        messageCount: string;
        focusedPercent: string;
        questionCount: string;
        summary: string;
    },
    locale: AppLocale,
): NotificationLocalizationResult {
    const { messageCount, focusedPercent, questionCount, summary } = parsed;
    const body = locale === 'zh'
        ? [
            `这段讨论已经出现草稿信号（${messageCount} 条消息，聚焦 ${focusedPercent}%，问题 ${questionCount} 条）。`,
            '打开「草稿」页继续整理，再决定是否结晶。',
            `总结：${summary}`,
        ].join('\n')
        : locale === 'en'
            ? [
                `This discussion is showing draft-ready signals (${messageCount} messages, ${focusedPercent}% focused, ${questionCount} questions).`,
                'Open the Draft tab to shape it before turning it into a crystal.',
                `Summary: ${summary}`,
            ].join('\n')
            : locale === 'es'
                ? [
                    `Esta discusión ya muestra señales de pasar a borrador (${messageCount} mensajes, ${focusedPercent}% enfocados, ${questionCount} preguntas).`,
                    'Abre la pestaña Borrador para ordenarla y pulirla antes de convertirla en un cristal.',
                    `Resumen: ${summary}`,
                ].join('\n')
                : [
                    `Cette discussion montre déjà des signaux de passage en brouillon (${messageCount} messages, ${focusedPercent}% focalisés, ${questionCount} questions).`,
                    'Ouvrez l’onglet Brouillon pour la structurer avant de la transformer en cristal.',
                    `Résumé : ${summary}`,
                ].join('\n');

    return {
        displayTitle: DRAFT_TITLE[locale],
        displayBody: body,
    };
}

function localizeIdentity(
    notification: NotificationLocalizationInput,
    input: {
        locale: Exclude<AppLocale, 'zh'>;
        circleName?: string | null;
    },
): NotificationLocalizationResult {
    const levels = parseIdentityLevels(notification.sourceId);
    if (!levels) {
        return {
            displayTitle: notification.title,
            displayBody: notification.body,
        };
    }

    const circleLabel = parseIdentityCircleName(notification.body)
        || input.circleName?.trim()
        || fallbackCircleLabel(notification.circleId, input.locale);
    const previousLabel = IDENTITY_LEVEL_LABELS[input.locale][levels.previousLevel];
    const nextLabel = IDENTITY_LEVEL_LABELS[input.locale][levels.nextLevel];
    const promotion = IDENTITY_LEVEL_ORDER[levels.nextLevel] > IDENTITY_LEVEL_ORDER[levels.previousLevel];
    const title = input.locale === 'en'
        ? `${promotion ? 'Promoted to' : 'Identity updated to'} ${nextLabel}`
        : input.locale === 'es'
            ? `${promotion ? 'Ascenso a' : 'Identidad actualizada a'} ${nextLabel}`
            : `${promotion ? 'Promotion au niveau' : 'Identité mise à jour :'} ${nextLabel}`;

    const rawReason = parseIdentityReason(notification.body);
    const localizedReason = localizeIdentityReason(rawReason, input.locale);
    const body = input.locale === 'en'
        ? `Your role in “${circleLabel}” changed from ${previousLabel} to ${nextLabel}. ${localizedReason}`
        : input.locale === 'es'
            ? `Tu rol en «${circleLabel}» cambió de ${previousLabel} a ${nextLabel}. ${localizedReason}`
            : `Votre rôle dans «${circleLabel}» est passé de ${previousLabel} à ${nextLabel}. ${localizedReason}`;

    return {
        displayTitle: title,
        displayBody: body,
    };
}

function parseIdentityLevels(sourceId: string | null): { previousLevel: IdentityLevel; nextLevel: IdentityLevel } | null {
    const match = String(sourceId || '').match(/^(Visitor|Initiate|Member|Elder)->(Visitor|Initiate|Member|Elder)$/);
    if (!match) {
        return null;
    }
    return {
        previousLevel: match[1] as IdentityLevel,
        nextLevel: match[2] as IdentityLevel,
    };
}

function parseIdentityCircleName(body: string | null): string | null {
    const match = String(body || '').match(/你在「(.+?)」的身份由/);
    return match?.[1]?.trim() || null;
}

function fallbackCircleLabel(circleId: number | null, locale: AppLocale): string {
    if (!circleId) {
        return locale === 'zh'
            ? '该圈层'
            : locale === 'en'
                ? 'this circle'
                : locale === 'es'
                    ? 'este círculo'
                    : 'ce cercle';
    }
    return locale === 'zh'
        ? `圈层 #${circleId}`
        : locale === 'en'
        ? `Circle #${circleId}`
        : locale === 'es'
            ? `Círculo #${circleId}`
            : `Cercle #${circleId}`;
}

function parseIdentityReason(body: string | null): string | null {
    const value = String(body || '');
    const explicitReason = value.match(/原因：(.+)$/s);
    if (explicitReason?.[1]) {
        return explicitReason[1].trim();
    }
    if (value.includes('系统基于贡献与活跃度自动评估。')) {
        return null;
    }
    return null;
}
