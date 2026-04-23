import type {
    ExtensionCapabilitiesResponse,
    ExtensionCapabilityRecord,
    ExtensionCardModel,
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

function disabledMessage(reasonCode: string | null): string {
    if (reasonCode === 'deprecated_extension') {
        return '该应用已下线，不再推荐使用';
    }
    if (reasonCode === 'draft_not_enabled') {
        return '该应用尚未完成启用';
    }
    if (reasonCode === 'registered_disabled') {
        return '该应用当前已关闭';
    }
    return '该应用当前已暂停接入';
}

export function buildExtensionCapabilityCardModel(
    entry: ExtensionEntryDefinition,
    normalized: NormalizedExtensionCapability,
): ExtensionCardModel {
    const effectiveState = normalized.state === 'available' && !entry.href
        ? 'misconfigured'
        : normalized.state;
    const reasonCode = normalized.state === 'available' && !entry.href
        ? 'missing_entry_href'
        : normalized.reasonCode;

    const meta = normalized.indexedSlot > 0
        ? `最新索引位点 ${normalized.indexedSlot}`
        : '等待索引状态';

    if (effectiveState === 'available') {
        return {
            extensionId: entry.extensionId,
            title: entry.title,
            description: entry.description,
            state: effectiveState,
            badge: '可用',
            message: '已完成接入，可从官方入口打开。',
            meta,
            cta: {
                enabled: true,
                label: '打开应用',
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
            badge: '已关闭',
            message: disabledMessage(reasonCode),
            meta,
            cta: {
                enabled: false,
                label: '暂不可用',
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
            badge: '同步中',
            message: '索引同步中，稍后可用',
            meta,
            cta: {
                enabled: false,
                label: '同步中',
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
            badge: '未注册',
            message: '应用尚未完成接入',
            meta,
            cta: {
                enabled: false,
                label: '尚未开放',
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
            badge: '配置异常',
            message: reasonCode === 'missing_entry_href'
                ? '官方入口待配置，当前不可启动'
                : '应用配置异常，当前不可用',
            meta,
            cta: {
                enabled: false,
                label: '待配置',
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
        badge: '暂不可用',
        message: '运行状态暂不可确认，请稍后重试',
        meta,
        cta: {
            enabled: false,
            label: '暂不可用',
            href: null,
            external: true,
        },
        showRetry: true,
    };
}

export function buildMissingCapabilityCardModel(entry: ExtensionEntryDefinition): ExtensionCardModel {
    return buildExtensionCapabilityCardModel(entry, {
        extensionId: entry.extensionId,
        displayName: entry.title,
        state: 'misconfigured',
        reasonCode: 'catalog_entry_missing',
        indexedSlot: 0,
    });
}
