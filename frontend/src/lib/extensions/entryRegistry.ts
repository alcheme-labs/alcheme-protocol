import type { ExtensionEntryDefinition } from './types.ts';
import type { ExtensionGateConfig } from '../config/extensions.ts';
import { shouldExposeExtensionEntry } from '../config/extensions.ts';

const HOME_ENTRIES = [
    {
        extensionId: 'contribution-engine',
        title: '贡献引擎',
        description: '把贡献沉淀为可结算的积分。',
        surface: 'home',
        icon: 'sparkles',
        visibility: 'public',
        type: 'external',
    },
] as const;

export function getHomeExtensionEntries(config: ExtensionGateConfig): ExtensionEntryDefinition[] {
    return HOME_ENTRIES
        .filter((entry) => shouldExposeExtensionEntry(config, entry.extensionId))
        .map((entry) => ({
            ...entry,
            href: entry.extensionId === 'contribution-engine' ? config.contributionEngineUrl : null,
        }));
}
