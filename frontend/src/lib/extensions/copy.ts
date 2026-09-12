import type { ExtensionCapabilityCopy } from './types.ts';

type ExtensionCopyValues = Record<string, string | number | Date>;
type ExtensionCopyTranslator = (key: string, values?: ExtensionCopyValues) => string;

export function createExtensionCapabilityCopy(t: ExtensionCopyTranslator): ExtensionCapabilityCopy {
    return {
        section: {
            eyebrow: t('section.eyebrow'),
            title: t('section.title'),
            subtitle: t('section.subtitle'),
            loading: t('section.loading'),
        },
        entries: {
            contributionEngine: {
                title: t('entries.contributionEngine.title'),
                description: t('entries.contributionEngine.description'),
            },
        },
        cards: {
            retry: t('cards.retry'),
            metaIndexedSlot: (slot) => t('cards.meta.indexedSlot', { slot }),
            metaWaitingIndex: t('cards.meta.waitingIndex'),
            disabledMessages: {
                deprecatedExtension: t('cards.disabledMessages.deprecatedExtension'),
                draftNotEnabled: t('cards.disabledMessages.draftNotEnabled'),
                registeredDisabled: t('cards.disabledMessages.registeredDisabled'),
                default: t('cards.disabledMessages.default'),
            },
            badges: {
                available: t('cards.badges.available'),
                disabled: t('cards.badges.disabled'),
                syncing: t('cards.badges.syncing'),
                temporarily_unavailable: t('cards.badges.temporarilyUnavailable'),
                misconfigured: t('cards.badges.misconfigured'),
                not_registered: t('cards.badges.notRegistered'),
            },
            messages: {
                available: t('cards.messages.available'),
                syncing: t('cards.messages.syncing'),
                notRegistered: t('cards.messages.notRegistered'),
                missingEntryHref: t('cards.messages.missingEntryHref'),
                misconfigured: t('cards.messages.misconfigured'),
                temporarilyUnavailable: t('cards.messages.temporarilyUnavailable'),
            },
            cta: {
                open: t('cards.cta.open'),
                unavailable: t('cards.cta.unavailable'),
                syncing: t('cards.cta.syncing'),
                notOpen: t('cards.cta.notOpen'),
                pendingConfig: t('cards.cta.pendingConfig'),
            },
        },
    };
}
