function rawErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error || '').trim();
}

export function isMissingOnchainIdentityUpdateError(error: unknown): boolean {
    const normalized = rawErrorMessage(error).toLowerCase();
    return normalized.includes('accountnotinitialized')
        && normalized.includes('user_identity');
}

export interface ProfileUpdateErrorCopy {
    missingIdentity: string;
    invalidPayload: string;
    genericFailure: string;
}

const DEFAULT_COPY: ProfileUpdateErrorCopy = {
    missingIdentity: 'This wallet does not have an editable on-chain identity yet. Create one or refresh your session and try again.',
    invalidPayload: 'The on-chain program rejected this profile update payload. Refresh the page and try again.',
    genericFailure: 'We could not save your profile right now. Please try again later.',
};

export function normalizeProfileUpdateError(
    error: unknown,
    copy: ProfileUpdateErrorCopy = DEFAULT_COPY,
): string {
    const raw = rawErrorMessage(error);
    const normalized = raw.toLowerCase();

    if (isMissingOnchainIdentityUpdateError(error)) {
        return copy.missingIdentity;
    }

    if (normalized.includes('instructiondidnotdeserialize')) {
        return copy.invalidPayload;
    }

    return raw || copy.genericFailure;
}
