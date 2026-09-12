export type IdentityHandleValidationError =
    | 'length'
    | 'characters'
    | 'starts_with_number'
    | 'edge_underscore'
    | 'consecutive_underscore';

export interface IdentityHandleValidationCopy {
    length: string;
    characters: string;
    startsWithNumber: string;
    edgeUnderscore: string;
    consecutiveUnderscore: string;
}

export function formatIdentityHandleValidationError(
    error: IdentityHandleValidationError,
    copy: IdentityHandleValidationCopy,
): string {
    switch (error) {
        case 'length':
            return copy.length;
        case 'characters':
            return copy.characters;
        case 'starts_with_number':
            return copy.startsWithNumber;
        case 'edge_underscore':
            return copy.edgeUnderscore;
        case 'consecutive_underscore':
            return copy.consecutiveUnderscore;
        default:
            return copy.characters;
    }
}

export function validateIdentityHandle(handle: string): IdentityHandleValidationError | null {
    const trimmed = String(handle || '').trim();

    if (trimmed.length < 3 || trimmed.length > 32) {
        return 'length';
    }

    if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
        return 'characters';
    }

    if (/^[0-9]/.test(trimmed)) {
        return 'starts_with_number';
    }

    if (trimmed.startsWith('_') || trimmed.endsWith('_')) {
        return 'edge_underscore';
    }

    if (trimmed.includes('__')) {
        return 'consecutive_underscore';
    }

    return null;
}
