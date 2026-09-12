import crypto from 'crypto';

interface SeededReferenceInput {
    path: string;
    line: number;
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

function normalizeInstant(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        const normalized = String(value).trim();
        return normalized || null;
    }
    return parsed.toISOString();
}

function normalizeSourceMaterialIds(value: number[] | null | undefined): number[] {
    return Array.from(new Set(
        (Array.isArray(value) ? value : [])
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0),
    )).sort((left, right) => left - right);
}

function normalizeSeededReference(
    value: SeededReferenceInput | null | undefined,
): SeededReferenceInput | null {
    if (!value) return null;
    const path = String(value.path || '').trim();
    const line = Number(value.line);
    if (!path || !Number.isFinite(line) || line <= 0) return null;
    return {
        path,
        line,
    };
}

export function buildGhostDraftGenerationDedupeKey(input: {
    postId: number;
    requestedByUserId: number;
    autoApplyRequested: boolean;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | Date | null;
    seededReference?: SeededReferenceInput | null;
    sourceMaterialIds?: number[] | null;
}): string {
    const fingerprint = stableStringify({
        postId: Number(input.postId),
        requestedByUserId: Number(input.requestedByUserId),
        autoApplyRequested: Boolean(input.autoApplyRequested),
        workingCopyHash: typeof input.workingCopyHash === 'string' && input.workingCopyHash.trim()
            ? input.workingCopyHash
            : null,
        workingCopyUpdatedAt: normalizeInstant(input.workingCopyUpdatedAt),
        seededReference: normalizeSeededReference(input.seededReference),
        sourceMaterialIds: normalizeSourceMaterialIds(input.sourceMaterialIds),
    });

    return `ghost_draft_generate:${crypto.createHash('sha256').update(fingerprint).digest('hex')}`;
}
