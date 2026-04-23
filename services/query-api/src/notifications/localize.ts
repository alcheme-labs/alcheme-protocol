import type { AppLocale } from '../i18n/locale';

type NotificationType = 'draft' | 'forward' | 'highlight' | 'identity';
type IdentityLevel = 'Visitor' | 'Initiate' | 'Member' | 'Elder';

const KNOWN_NOTIFICATION_TYPES = new Set<NotificationType>(['draft', 'forward', 'highlight', 'identity']);
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

const DEFAULT_IDENTITY_REASON_TEXT: Record<Exclude<AppLocale, 'zh'>, string> = {
    en: 'The system re-evaluated your standing based on contribution and activity.',
    es: 'El sistema volvió a evaluar tu posición según tu contribución y actividad.',
    fr: 'Le système a réévalué votre position en fonction de votre contribution et de votre activité.',
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

export interface NotificationLocalizationInput {
    type: string;
    title: string;
    body: string | null;
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

function fallbackCircleLabel(circleId: number | null, locale: Exclude<AppLocale, 'zh'>): string {
    if (!circleId) {
        return locale === 'en' ? 'this circle' : locale === 'es' ? 'este círculo' : 'ce cercle';
    }
    return locale === 'en'
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

function localizeIdentityReason(
    reason: string | null,
    locale: Exclude<AppLocale, 'zh'>,
): string {
    if (!reason) {
        return DEFAULT_IDENTITY_REASON_TEXT[locale];
    }

    const sentEligibility = reason.match(/^已发送 (\d+) 条消息，达到 (\d+) 条可晋升为入局者。$/);
    if (sentEligibility) {
        const [, current, target] = sentEligibility;
        return locale === 'en'
            ? `You have sent ${current} messages; ${target} are required to become an Initiate.`
            : locale === 'es'
                ? `Has enviado ${current} mensajes; necesitas ${target} para convertirte en Iniciado.`
                : `Vous avez envoyé ${current} messages ; ${target} sont requis pour devenir Initié.`;
    }

    const sentPromotion = reason.match(/^已发送 (\d+) 条消息，达到 (\d+) 条门槛，已晋升为入局者。$/);
    if (sentPromotion) {
        const [, current, target] = sentPromotion;
        return locale === 'en'
            ? `You reached ${current} sent messages and crossed the ${target}-message threshold for Initiate.`
            : locale === 'es'
                ? `Alcanzaste ${current} mensajes enviados y superaste el umbral de ${target} para Iniciado.`
                : `Vous avez atteint ${current} messages envoyés et dépassé le seuil de ${target} pour Initié.`;
    }

    const citationEligibility = reason.match(/^已获得 (\d+) 次引用，达到 (\d+) 次可晋升为成员。$/);
    if (citationEligibility) {
        const [, current, target] = citationEligibility;
        return locale === 'en'
            ? `You have received ${current} citations; ${target} are required to become a Member.`
            : locale === 'es'
                ? `Has recibido ${current} citas; necesitas ${target} para convertirte en Miembro.`
                : `Vous avez reçu ${current} citations ; ${target} sont requises pour devenir Membre.`;
    }

    const citationPromotion = reason.match(/^已获得 (\d+) 次引用，达到 (\d+) 次门槛，已晋升为成员。$/);
    if (citationPromotion) {
        const [, current, target] = citationPromotion;
        return locale === 'en'
            ? `You reached ${current} citations and crossed the ${target}-citation threshold for Member.`
            : locale === 'es'
                ? `Has alcanzado ${current} citas y superaste el umbral de ${target} para Miembro.`
                : `Vous avez atteint ${current} citations et dépassé le seuil de ${target} pour devenir Membre.`;
    }

    const elderPromotion = reason.match(/^当前信誉位于前 ([\d.]+)%（阈值前 ([\d.]+)%），已晋升为长老。$/);
    if (elderPromotion) {
        const [, current, target] = elderPromotion;
        return locale === 'en'
            ? `Your reputation is now in the top ${current}% and has crossed the Elder threshold of ${target}%.`
            : locale === 'es'
                ? `Tu reputación está ahora en el ${current}% superior y ya superó el umbral de ${target}% para Anciano.`
                : `Votre réputation est maintenant dans le top ${current}% et a dépassé le seuil de ${target}% pour Ancien.`;
    }

    const elderEligible = reason.match(/^当前信誉位于前 ([\d.]+)%（阈值前 ([\d.]+)%）可晋升为长老。$/);
    if (elderEligible) {
        const [, current, target] = elderEligible;
        return locale === 'en'
            ? `Your reputation is in the top ${current}% and qualifies for the Elder threshold of ${target}%.`
            : locale === 'es'
                ? `Tu reputación está en el ${current}% superior y cumple el umbral de ${target}% para Anciano.`
                : `Votre réputation est dans le top ${current}% et remplit le seuil de ${target}% pour Ancien.`;
    }

    const elderMissing = reason.match(/^当前信誉位于前 ([\d.]+)%（需进入前 ([\d.]+)%）方可晋升为长老。$/);
    if (elderMissing) {
        const [, current, target] = elderMissing;
        return locale === 'en'
            ? `Your reputation is in the top ${current}%; you need to reach the top ${target}% to become an Elder.`
            : locale === 'es'
                ? `Tu reputación está en el ${current}% superior; necesitas entrar en el ${target}% superior para convertirte en Anciano.`
                : `Votre réputation est dans le top ${current}% ; vous devez atteindre le top ${target}% pour devenir Ancien.`;
    }

    if (reason === '继续保持贡献与信誉，有机会晋升为长老。') {
        return locale === 'en'
            ? 'Keep contributing and building your reputation to become an Elder.'
            : locale === 'es'
                ? 'Sigue contribuyendo y fortaleciendo tu reputación para convertirte en Anciano.'
                : 'Continuez à contribuer et à renforcer votre réputation pour devenir Ancien.';
    }

    if (reason === '已处于长老层级，保持活跃可维持当前身份。') {
        return locale === 'en'
            ? 'You are already at the Elder tier; staying active will help you keep it.'
            : locale === 'es'
                ? 'Ya estás en el nivel de Anciano; mantenerte activo te ayudará a conservarlo.'
                : 'Vous êtes déjà au niveau Ancien ; rester actif vous aidera à le conserver.';
    }

    return reason;
}
