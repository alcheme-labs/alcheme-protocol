import type { AppLocale } from '../i18n/locale';

const DEFAULT_IDENTITY_REASON_TEXT: Record<AppLocale, string> = {
    zh: '系统基于贡献与活跃度自动评估。',
    en: 'The system re-evaluated your standing based on contribution and activity.',
    es: 'El sistema volvió a evaluar tu posición según tu contribución y actividad.',
    fr: 'Le système a réévalué votre position en fonction de votre contribution et de votre activité.',
};

export function localizeIdentityReason(
    reason: string | null,
    locale: AppLocale,
): string {
    if (!reason) {
        return DEFAULT_IDENTITY_REASON_TEXT[locale];
    }
    if (locale === 'zh') {
        return reason;
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

    const reputationDemotion = reason.match(/^当前信誉已降至前 ([\d.]+)% 之外（阈值前 ([\d.]+)%），身份调整为成员。$/);
    if (reputationDemotion) {
        const [, current, target] = reputationDemotion;
        return locale === 'en'
            ? `Your reputation is now in the top ${current}%, outside the Elder threshold of ${target}%, so your role changed to Member.`
            : locale === 'es'
                ? `Tu reputación está ahora en el ${current}% superior, fuera del umbral de ${target}% para Anciano, por lo que tu rol cambió a Miembro.`
                : `Votre réputation est maintenant dans le top ${current}%, hors du seuil Ancien de ${target}%, votre rôle est donc passé à Membre.`;
    }

    const inactivityDemotion = reason.match(/^已 (\d+) 天未活跃（阈值 (\d+) 天），身份调整为入局者。$/);
    if (inactivityDemotion) {
        const [, current, target] = inactivityDemotion;
        return locale === 'en'
            ? `You have been inactive for ${current} days; the inactivity threshold is ${target} days.`
            : locale === 'es'
                ? `Has estado inactivo durante ${current} días; el umbral de inactividad es de ${target} días.`
                : `Vous avez été inactif pendant ${current} jours ; le seuil d’inactivité est de ${target} jours.`;
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
