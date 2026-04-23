type IdentityCopyValues = Record<string, string | number | Date>;
type IdentityCopyTranslator = (key: string, values?: IdentityCopyValues) => string;

export interface IdentityCopyBundle {
    levelLabels: Record<'Visitor' | 'Initiate' | 'Member' | 'Elder', string>;
    stateLabels: Record<'visitor' | 'initiate' | 'member' | 'curator' | 'owner', string>;
}

export function createIdentityCopy(
    t: IdentityCopyTranslator,
): IdentityCopyBundle {
    return {
        levelLabels: {
            Visitor: t('levels.Visitor'),
            Initiate: t('levels.Initiate'),
            Member: t('levels.Member'),
            Elder: t('levels.Elder'),
        },
        stateLabels: {
            visitor: t('states.visitor'),
            initiate: t('states.initiate'),
            member: t('states.member'),
            curator: t('states.curator'),
            owner: t('states.owner'),
        },
    };
}

export function normalizeIdentityCopy(text: string | null | undefined): string | null {
    if (!text) return null;
    return text.trim() || null;
}
