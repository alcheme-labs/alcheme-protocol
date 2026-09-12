import type {
    ExtensionCapabilitiesResponse,
    ExtensionCapabilityRecord,
    ExtensionCardModel,
    ExtensionCapabilityCopy,
    ExtensionEntryDefinition,
    NormalizedExtensionCapability,
} from './types.ts';

function isDisabledByManifest(capability: ExtensionCapabilityRecord): boolean {
    return ['suspended', 'deprecated', 'draft'].includes(capability.status)
        || ['suspended_by_governance', 'deprecated_extension', 'draft_not_enabled'].includes(capability.reason ?? '');
}

export function normalizeExtensionCapabilityState(
    catalog: Pick<ExtensionCapabilitiesResponse, 'manifestSource' | 'manifestReason' | 'consistency'>,
    capability: ExtensionCapabilityRecord,
): NormalizedExtensionCapability {
    if (catalog.manifestSource === 'missing' || catalog.manifestReason) {
        return {
            extensionId: capability.extensionId,
            displayName: capability.displayName,
            state: 'misconfigured',
            reasonCode: catalog.manifestReason ?? 'manifest_root_missing',
            indexedSlot: catalog.consistency.indexedSlot,
        };
    }

    if (isDisabledByManifest(capability)) {
        return {
            extensionId: capability.extensionId,
            displayName: capability.displayName,
            state: 'disabled',
            reasonCode: capability.reason ?? capability.status,
            indexedSlot: catalog.consistency.indexedSlot,
        };
    }

    if (capability.runtime.registrationStatus === 'registered_disabled') {
        return {
            extensionId: capability.extensionId,
            displayName: capability.displayName,
            state: 'disabled',
            reasonCode: 'registered_disabled',
            indexedSlot: catalog.consistency.indexedSlot,
        };
    }

    if (capability.runtime.registrationStatus === 'runtime_unavailable') {
        return {
            extensionId: capability.extensionId,
            displayName: capability.displayName,
            state: 'temporarily_unavailable',
            reasonCode: capability.runtime.reason ?? 'runtime_lookup_failed',
            indexedSlot: catalog.consistency.indexedSlot,
        };
    }

    if (capability.runtime.registrationStatus === 'registered_enabled' && catalog.consistency.stale) {
        return {
            extensionId: capability.extensionId,
            displayName: capability.displayName,
            state: 'syncing',
            reasonCode: null,
            indexedSlot: catalog.consistency.indexedSlot,
        };
    }

    if (capability.status === 'active' && capability.runtime.registrationStatus === 'not_registered') {
        return {
            extensionId: capability.extensionId,
            displayName: capability.displayName,
            state: 'not_registered',
            reasonCode: null,
            indexedSlot: catalog.consistency.indexedSlot,
        };
    }

    if (capability.status === 'active' && capability.runtime.registrationStatus === 'registered_enabled' && !catalog.consistency.stale) {
        return {
            extensionId: capability.extensionId,
            displayName: capability.displayName,
            state: 'available',
            reasonCode: null,
            indexedSlot: catalog.consistency.indexedSlot,
        };
    }

    return {
        extensionId: capability.extensionId,
        displayName: capability.displayName,
        state: 'temporarily_unavailable',
        reasonCode: capability.runtime.reason ?? 'runtime_lookup_failed',
        indexedSlot: catalog.consistency.indexedSlot,
    };
}

function disabledMessage(reasonCode: string | null, copy: ExtensionCapabilityCopy): string {
    if (reasonCode === 'deprecated_extension') {
        return copy.cards.disabledMessages.deprecatedExtension;
    }
    if (reasonCode === 'draft_not_enabled') {
        return copy.cards.disabledMessages.draftNotEnabled;
    }
    if (reasonCode === 'registered_disabled') {
        return copy.cards.disabledMessages.registeredDisabled;
    }
    return copy.cards.disabledMessages.default;
}

export function buildExtensionCapabilityCardModel(
    entry: ExtensionEntryDefinition,
    normalized: NormalizedExtensionCapability,
    copy: ExtensionCapabilityCopy,
): ExtensionCardModel {
    const effectiveState = normalized.state === 'available' && !entry.href
        ? 'misconfigured'
        : normalized.state;
    const reasonCode = normalized.state === 'available' && !entry.href
        ? 'missing_entry_href'
        : normalized.reasonCode;

    const meta = normalized.indexedSlot > 0
        ? copy.cards.metaIndexedSlot(normalized.indexedSlot)
        : copy.cards.metaWaitingIndex;

    if (effectiveState === 'available') {
        return {
            extensionId: entry.extensionId,
            title: entry.title,
            description: entry.description,
            state: effectiveState,
            badge: copy.cards.badges.available,
            message: copy.cards.messages.available,
            meta,
            cta: {
                enabled: true,
                label: copy.cards.cta.open,
                href: entry.href,
                external: true,
            },
            showRetry: false,
        };
    }

    if (effectiveState === 'disabled') {
        return {
            extensionId: entry.extensionId,
            title: entry.title,
            description: entry.description,
            state: effectiveState,
            badge: copy.cards.badges.disabled,
            message: disabledMessage(reasonCode, copy),
            meta,
            cta: {
                enabled: false,
                label: copy.cards.cta.unavailable,
                href: null,
                external: true,
            },
            showRetry: false,
        };
    }

    if (effectiveState === 'syncing') {
        return {
            extensionId: entry.extensionId,
            title: entry.title,
            description: entry.description,
            state: effectiveState,
            badge: copy.cards.badges.syncing,
            message: copy.cards.messages.syncing,
            meta,
            cta: {
                enabled: false,
                label: copy.cards.cta.syncing,
                href: null,
                external: true,
            },
            showRetry: true,
        };
    }

    if (effectiveState === 'not_registered') {
        return {
            extensionId: entry.extensionId,
            title: entry.title,
            description: entry.description,
            state: effectiveState,
            badge: copy.cards.badges.not_registered,
            message: copy.cards.messages.notRegistered,
            meta,
            cta: {
                enabled: false,
                label: copy.cards.cta.notOpen,
                href: null,
                external: true,
            },
            showRetry: false,
        };
    }

    if (effectiveState === 'misconfigured') {
        return {
            extensionId: entry.extensionId,
            title: entry.title,
            description: entry.description,
            state: effectiveState,
            badge: copy.cards.badges.misconfigured,
            message: reasonCode === 'missing_entry_href'
                ? copy.cards.messages.missingEntryHref
                : copy.cards.messages.misconfigured,
            meta,
            cta: {
                enabled: false,
                label: copy.cards.cta.pendingConfig,
                href: null,
                external: true,
            },
            showRetry: false,
        };
    }

    return {
        extensionId: entry.extensionId,
        title: entry.title,
        description: entry.description,
        state: 'temporarily_unavailable',
        badge: copy.cards.badges.temporarily_unavailable,
        message: copy.cards.messages.temporarilyUnavailable,
        meta,
        cta: {
            enabled: false,
            label: copy.cards.cta.unavailable,
            href: null,
            external: true,
        },
        showRetry: true,
    };
}

export function buildMissingCapabilityCardModel(
    entry: ExtensionEntryDefinition,
    copy: ExtensionCapabilityCopy,
): ExtensionCardModel {
    return buildExtensionCapabilityCardModel(entry, {
        extensionId: entry.extensionId,
        displayName: entry.title,
        state: 'misconfigured',
        reasonCode: 'catalog_entry_missing',
        indexedSlot: 0,
    }, copy);
}
