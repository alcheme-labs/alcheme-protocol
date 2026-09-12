import crypto from 'crypto';

export interface AiGenerationMetadata {
    providerMode: string;
    model: string;
    promptAsset: string;
    promptVersion: string;
    sourceDigest: string;
    locale?: string;
    promptScope?: string;
    promptMode?: string;
    systemPromptVersion?: string;
    circlePromptVersionId?: string;
    circlePromptVersion?: number;
    circlePromptDigest?: string;
    approvalRef?: string;
    selectionApprovalRef?: string;
    schemaRef?: string;
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
    const locale = asString(root.locale);
    const promptScope = asString(root.promptScope);
    const promptMode = asString(root.promptMode);
    const systemPromptVersion = asString(root.systemPromptVersion);
    const circlePromptVersionId = asString(root.circlePromptVersionId);
    const circlePromptVersion = typeof root.circlePromptVersion === 'number'
        && Number.isInteger(root.circlePromptVersion)
        && root.circlePromptVersion > 0
        ? root.circlePromptVersion
        : null;
    const circlePromptDigest = asString(root.circlePromptDigest);
    const approvalRef = asString(root.approvalRef);
    const selectionApprovalRef = asString(root.selectionApprovalRef);
    const schemaRef = asString(root.schemaRef);

    if (!providerMode || !model || !promptAsset || !promptVersion || !sourceDigest) {
        return null;
    }

    return {
        providerMode,
        model,
        promptAsset,
        promptVersion,
        sourceDigest,
        ...(locale ? { locale } : {}),
        ...(promptScope ? { promptScope } : {}),
        ...(promptMode ? { promptMode } : {}),
        ...(systemPromptVersion ? { systemPromptVersion } : {}),
        ...(circlePromptVersionId ? { circlePromptVersionId } : {}),
        ...(circlePromptVersion ? { circlePromptVersion } : {}),
        ...(circlePromptDigest ? { circlePromptDigest } : {}),
        ...(approvalRef ? { approvalRef } : {}),
        ...(selectionApprovalRef ? { selectionApprovalRef } : {}),
        ...(schemaRef ? { schemaRef } : {}),
    };
}
