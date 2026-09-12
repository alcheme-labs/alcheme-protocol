import type { ExtensionCapabilityCopy, ExtensionEntryDefinition } from './types.ts';
import type { ExtensionGateConfig } from '../config/extensions.ts';
import { shouldExposeExtensionEntry } from '../config/extensions.ts';

const HOME_ENTRIES = [
    {
        extensionId: 'contribution-engine',
        surface: 'home',
        icon: 'sparkles',
        visibility: 'public',
        type: 'external',
    },
] as const;

function resolveEntryCopy(
    extensionId: string,
    copy: ExtensionCapabilityCopy,
): Pick<ExtensionEntryDefinition, 'title' | 'description'> {
    if (extensionId === 'contribution-engine') {
        return copy.entries.contributionEngine;
    }
    return {
        title: extensionId,
        description: '',
    };
}

export function getHomeExtensionEntries(
    config: ExtensionGateConfig,
    copy: ExtensionCapabilityCopy,
): ExtensionEntryDefinition[] {
    return HOME_ENTRIES
        .filter((entry) => shouldExposeExtensionEntry(config, entry.extensionId))
        .map((entry) => ({
            ...entry,
            ...resolveEntryCopy(entry.extensionId, copy),
            href: entry.extensionId === 'contribution-engine' ? config.contributionEngineUrl : null,
        }));
}
