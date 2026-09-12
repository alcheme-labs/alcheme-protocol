import { createHash } from 'crypto';

export interface SourceMaterialUploadInput {
    name: string;
    mimeType?: string | null;
    content: string;
}

export interface NormalizedSourceMaterialUpload {
    name: string;
    mimeType: string | null;
    content: string;
    byteSize: number;
}

export function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeStorageUri(value: unknown): string | null {
    const direct = normalizeString(value);
    if (!direct) return null;
    if (direct.startsWith('ipfs://')) return direct;
    if (/^(bafy[a-z0-9]+|Qm[1-9A-HJ-NP-Za-km-z]{44})$/i.test(direct)) return `ipfs://${direct}`;
    return null;
}

export function inferStorageProvider(uri: string): string {
    const schemeMatch = uri.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    return schemeMatch?.[1]?.toLowerCase() || 'custom';
}

export function sha256Hex(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function normalizeSourceMaterialUpload(input: SourceMaterialUploadInput): NormalizedSourceMaterialUpload {
    const name = normalizeString(input.name);
    if (!name) {
        throw new Error('source_material_name_required');
    }

    const content = typeof input.content === 'string' ? input.content : '';
    if (!content.trim()) {
        throw new Error('source_material_content_required');
    }

    const mimeType = normalizeString(input.mimeType) || null;

    return {
        name,
        mimeType,
        content,
        byteSize: Buffer.byteLength(content, 'utf8'),
    };
}
