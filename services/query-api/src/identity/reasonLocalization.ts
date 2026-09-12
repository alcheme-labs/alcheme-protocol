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
    const sentEligibility = reason.match(/^已发送 (\d+) 条消息，达到 (\d+) 条可晋升为(?:入局者|参与者)。$/);
    if (sentEligibility) {
        const [, current, target] = sentEligibility;
        return locale === 'zh'
            ? `已发送 ${current} 条消息，达到 ${target} 条可晋升为参与者。`
            : locale === 'en'
            ? `You have sent ${current} messages; ${target} are required to become a Participant.`
            : locale === 'es'
                ? `Has enviado ${current} mensajes; necesitas ${target} para convertirte en Participante.`
                : `Vous avez envoyé ${current} messages ; ${target} sont requis pour devenir Participant.`;
    }

    const sentPromotion = reason.match(/^已发送 (\d+) 条消息，达到 (\d+) 条门槛，已晋升为(?:入局者|参与者)。$/);
    if (sentPromotion) {
        const [, current, target] = sentPromotion;
        return locale === 'zh'
            ? `已发送 ${current} 条消息，达到 ${target} 条门槛，已晋升为参与者。`
            : locale === 'en'
            ? `You reached ${current} sent messages and crossed the ${target}-message threshold for Participant.`
            : locale === 'es'
                ? `Alcanzaste ${current} mensajes enviados y superaste el umbral de ${target} para Participante.`
                : `Vous avez atteint ${current} messages envoyés et dépassé le seuil de ${target} pour Participant.`;
    }

    const citationEligibility = reason.match(/^已获得 (\d+) 次引用，达到 (\d+) 次可晋升为(?:成员|贡献者)。$/);
    if (citationEligibility) {
        const [, current, target] = citationEligibility;
        return locale === 'zh'
            ? `已获得 ${current} 次引用，达到 ${target} 次可晋升为贡献者。`
            : locale === 'en'
            ? `You have received ${current} citations; ${target} are required to become a Contributor.`
            : locale === 'es'
                ? `Has recibido ${current} citas; necesitas ${target} para convertirte en Colaborador.`
                : `Vous avez reçu ${current} citations ; ${target} sont requises pour devenir Contributeur.`;
    }

    const citationPromotion = reason.match(/^已获得 (\d+) 次引用，达到 (\d+) 次门槛，已晋升为(?:成员|贡献者)。$/);
    if (citationPromotion) {
        const [, current, target] = citationPromotion;
        return locale === 'zh'
            ? `已获得 ${current} 次引用，达到 ${target} 次门槛，已晋升为贡献者。`
            : locale === 'en'
            ? `You reached ${current} citations and crossed the ${target}-citation threshold for Contributor.`
            : locale === 'es'
                ? `Has alcanzado ${current} citas y superaste el umbral de ${target} para Colaborador.`
                : `Vous avez atteint ${current} citations et dépassé le seuil de ${target} pour devenir Contributeur.`;
    }

    const elderPromotion = reason.match(/^当前信誉位于前 ([\d.]+)%（阈值前 ([\d.]+)%），已晋升为(?:长老|资深贡献者)。$/);
    if (elderPromotion) {
        const [, current, target] = elderPromotion;
        return locale === 'zh'
            ? `当前信誉位于前 ${current}%（阈值前 ${target}%），已晋升为资深贡献者。`
            : locale === 'en'
            ? `Your reputation is now in the top ${current}% and has crossed the Senior Contributor threshold of ${target}%.`
            : locale === 'es'
                ? `Tu reputación está ahora en el ${current}% superior y ya superó el umbral de ${target}% para Colaborador sénior.`
                : `Votre réputation est maintenant dans le top ${current}% et a dépassé le seuil de ${target}% pour Contributeur senior.`;
    }

    const elderEligible = reason.match(/^当前信誉位于前 ([\d.]+)%（阈值前 ([\d.]+)%）可晋升为(?:长老|资深贡献者)。$/);
    if (elderEligible) {
        const [, current, target] = elderEligible;
        return locale === 'zh'
            ? `当前信誉位于前 ${current}%（阈值前 ${target}%）可晋升为资深贡献者。`
            : locale === 'en'
            ? `Your reputation is in the top ${current}% and qualifies for the Senior Contributor threshold of ${target}%.`
            : locale === 'es'
                ? `Tu reputación está en el ${current}% superior y cumple el umbral de ${target}% para Colaborador sénior.`
                : `Votre réputation est dans le top ${current}% et remplit le seuil de ${target}% pour Contributeur senior.`;
    }

    const elderMissing = reason.match(/^当前信誉位于前 ([\d.]+)%（需进入前 ([\d.]+)%）方可晋升为(?:长老|资深贡献者)。$/);
    if (elderMissing) {
        const [, current, target] = elderMissing;
        return locale === 'zh'
            ? `当前信誉位于前 ${current}%（需进入前 ${target}%）方可晋升为资深贡献者。`
            : locale === 'en'
            ? `Your reputation is in the top ${current}%; you need to reach the top ${target}% to become a Senior Contributor.`
            : locale === 'es'
                ? `Tu reputación está en el ${current}% superior; necesitas entrar en el ${target}% superior para convertirte en Colaborador sénior.`
                : `Votre réputation est dans le top ${current}% ; vous devez atteindre le top ${target}% pour devenir Contributeur senior.`;
    }

    const reputationDemotion = reason.match(/^当前信誉已降至前 ([\d.]+)% 之外（阈值前 ([\d.]+)%），身份调整为(?:成员|贡献者)。$/);
    if (reputationDemotion) {
        const [, current, target] = reputationDemotion;
        return locale === 'zh'
            ? `当前信誉已降至前 ${current}% 之外（阈值前 ${target}%），身份调整为贡献者。`
            : locale === 'en'
            ? `Your reputation is now in the top ${current}%, outside the Senior Contributor threshold of ${target}%, so your identity changed to Contributor.`
            : locale === 'es'
                ? `Tu reputación está ahora en el ${current}% superior, fuera del umbral de ${target}% para Colaborador sénior, por lo que tu identidad cambió a Colaborador.`
                : `Votre réputation est maintenant dans le top ${current}%, hors du seuil Contributeur senior de ${target}%, votre identité est donc passée à Contributeur.`;
    }

    const inactivityDemotion = reason.match(/^已 (\d+) 天未活跃（阈值 (\d+) 天），身份调整为(?:入局者|参与者)。$/);
    if (inactivityDemotion) {
        const [, current, target] = inactivityDemotion;
        return locale === 'zh'
            ? `已 ${current} 天未活跃（阈值 ${target} 天），身份调整为参与者。`
            : locale === 'en'
            ? `You have been inactive for ${current} days; the inactivity threshold is ${target} days.`
            : locale === 'es'
                ? `Has estado inactivo durante ${current} días; el umbral de inactividad es de ${target} días.`
                : `Vous avez été inactif pendant ${current} jours ; le seuil d’inactivité est de ${target} jours.`;
    }

    if (reason === '继续保持贡献与信誉，有机会晋升为长老。' || reason === '继续保持贡献与信誉，有机会晋升为资深贡献者。') {
        return locale === 'zh'
            ? '继续保持贡献与信誉，有机会晋升为资深贡献者。'
            : locale === 'en'
            ? 'Keep contributing and building your reputation to become a Senior Contributor.'
            : locale === 'es'
                ? 'Sigue contribuyendo y fortaleciendo tu reputación para convertirte en Colaborador sénior.'
                : 'Continuez à contribuer et à renforcer votre réputation pour devenir Contributeur senior.';
    }

    if (reason === '已处于长老层级，保持活跃可维持当前身份。' || reason === '已处于资深贡献者层级，保持活跃可维持当前身份。') {
        return locale === 'zh'
            ? '已处于资深贡献者层级，保持活跃可维持当前身份。'
            : locale === 'en'
            ? 'You are already at the Senior Contributor tier; staying active will help you keep it.'
            : locale === 'es'
                ? 'Ya estás en el nivel de Colaborador sénior; mantenerte activo te ayudará a conservarlo.'
                : 'Vous êtes déjà au niveau Contributeur senior ; rester actif vous aidera à le conserver.';
    }

    return reason;
}
