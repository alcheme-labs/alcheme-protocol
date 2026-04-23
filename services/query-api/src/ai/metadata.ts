import crypto from 'crypto';

export interface AiGenerationMetadata {
    providerMode: string;
    model: string;
    promptAsset: string;
    promptVersion: string;
    sourceDigest: string;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `"${key}":${stableStringify(nested)}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

export function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

export function buildAiSourceDigest(value: unknown): string {
    return sha256Hex(stableStringify(value));
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

export function normalizeAiGenerationMetadata(value: unknown): AiGenerationMetadata | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const root = value as Record<string, unknown>;
    const providerMode = asString(root.providerMode);
    const model = asString(root.model);
    const promptAsset = asString(root.promptAsset);
    const promptVersion = asString(root.promptVersion);
    const sourceDigest = asString(root.sourceDigest);

    if (!providerMode || !model || !promptAsset || !promptVersion || !sourceDigest) {
        return null;
    }

    return {
        providerMode,
        model,
        promptAsset,
        promptVersion,
        sourceDigest,
    };
}
