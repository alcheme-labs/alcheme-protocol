import {
    getRawErrorMessage,
    ONCHAIN_WRITE_ERROR_CODES,
} from '../solana/onchainWriteErrors.ts';

export interface ContentMutationErrorCopy {
    bindCircleAuthorityMissing: string;
    bindCircleFailed: string;
    bindCircleTimeout: string;
    sessionHandleMissing: string;
    sdkV2ContentIdUnavailable: string;
    v2ContentIdConflictRetryFailed: string;
}

export function normalizeContentMutationError(
    error: unknown,
    copy: ContentMutationErrorCopy,
    fallback: string,
): string {
    const raw = getRawErrorMessage(error);

    if (raw.includes(ONCHAIN_WRITE_ERROR_CODES.bindCircleAuthorityMissing)) {
        return copy.bindCircleAuthorityMissing;
    }
    if (raw.includes(ONCHAIN_WRITE_ERROR_CODES.bindCircleTimeout)) {
        return copy.bindCircleTimeout;
    }
    if (raw.includes(ONCHAIN_WRITE_ERROR_CODES.bindCircleFailed)) {
        return copy.bindCircleFailed;
    }
    if (raw.includes(ONCHAIN_WRITE_ERROR_CODES.sessionHandleMissing)) {
        return copy.sessionHandleMissing;
    }
    if (raw.includes(ONCHAIN_WRITE_ERROR_CODES.sdkV2ContentIdUnavailable)) {
        return copy.sdkV2ContentIdUnavailable;
    }
    if (raw.includes(ONCHAIN_WRITE_ERROR_CODES.v2ContentIdConflictRetryFailed)) {
        return copy.v2ContentIdConflictRetryFailed;
    }

    return raw || fallback;
}
