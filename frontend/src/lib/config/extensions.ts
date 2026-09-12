export interface ExtensionGateConfig {
    enabled: boolean;
    allowlist: string[];
    contributionEngineUrl: string | null;
}

function normalizeBoolean(raw: string | undefined): boolean {
    return raw?.trim().toLowerCase() === 'true';
}

function normalizeUrl(raw: string | undefined): string | null {
    const value = raw?.trim();
    if (!value) {
        return null;
    }

    try {
        const url = new URL(value);
        return url.toString();
    } catch {
        return null;
    }
}

export function parseExtensionAllowlist(raw: string | undefined): string[] {
    if (!raw) {
        return [];
    }

    return [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
}

export function resolveExtensionGateConfig(env?: Record<string, string | undefined>): ExtensionGateConfig {
    const resolvedEnv = env ?? {
        NEXT_PUBLIC_EXTENSION_GATE_ENABLED: process.env.NEXT_PUBLIC_EXTENSION_GATE_ENABLED,
        NEXT_PUBLIC_EXTENSION_ALLOWLIST: process.env.NEXT_PUBLIC_EXTENSION_ALLOWLIST,
        NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL: process.env.NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL,
    };

    return {
        enabled: normalizeBoolean(resolvedEnv.NEXT_PUBLIC_EXTENSION_GATE_ENABLED),
        allowlist: parseExtensionAllowlist(resolvedEnv.NEXT_PUBLIC_EXTENSION_ALLOWLIST),
        contributionEngineUrl: normalizeUrl(resolvedEnv.NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL),
    };
}

export function shouldExposeExtensionEntry(config: ExtensionGateConfig, extensionId: string): boolean {
    if (!config.enabled) {
        return false;
    }

    return config.allowlist.includes(extensionId);
}
