export const ONCHAIN_WRITE_ERROR_CODES = {
    bindCircleAuthorityMissing: 'bind_circle_authority_missing',
    bindCircleFailed: 'bind_circle_failed',
    bindCircleTimeout: 'bind_circle_timeout',
    identitySessionIndexPending: 'identity_session_index_pending',
    likeTargetAddressMissing: 'like_target_address_missing',
    sessionHandleMissing: 'session_handle_missing',
    sdkV2ContentIdUnavailable: 'sdk_v2_content_id_unavailable',
    v2ContentIdConflictRetryFailed: 'v2_content_id_conflict_retry_failed',
    walletMessageSigningUnavailable: 'wallet_message_signing_unavailable',
} as const;

export function getRawErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}
