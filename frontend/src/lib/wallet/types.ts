export type AlchemeWalletSource = 'external' | 'native' | 'embedded';

export type AlchemeWalletProviderKind =
    | 'phantom'
    | 'solflare'
    | 'native_phantom'
    | 'e2e_mock'
    | 'alcheme_embedded'
    | 'unknown';

export type WalletActionKind =
    | 'connect_wallet'
    | 'disconnect_wallet'
    | 'auth_session'
    | 'discussion_session'
    | 'discussion_message'
    | 'signed_server_mutation'
    | 'circle_settings_update'
    | 'circle_post_create_settings_sync'
    | 'profile_update'
    | 'identity_register'
    | 'circle_create'
    | 'circle_join'
    | 'circle_leave'
    | 'circle_member_role_update'
    | 'circle_member_remove'
    | 'tip_transfer'
    | 'governance_signal'
    | 'citation_submit'
    | 'crystallization'
    | 'unknown_onchain_write';

export type WalletConfirmationPolicy =
    | 'none'
    | 'connect'
    | 'session_signature'
    | 'session_token'
    | 'message_signature'
    | 'transaction'
    | 'funds_transfer';

export interface AlchemeWalletAccountSnapshot {
    source: AlchemeWalletSource;
    providerKind: AlchemeWalletProviderKind;
    publicKey: string | null;
    connected: boolean;
    connecting: boolean;
    canSignMessage: boolean;
    canSignTransaction: boolean;
    canSendTransaction: boolean;
    locked?: boolean;
}

export interface WalletActionPolicy {
    kind: WalletActionKind;
    confirmationPolicy: WalletConfirmationPolicy;
    risk: 'low' | 'identity' | 'onchain_write' | 'funds';
    allowSilentRetry: boolean;
    allowRepeatedWalletPrompt: boolean;
    userFacingSummaryKey: string;
}

export interface WalletActionRequest {
    kind: WalletActionKind;
    source: string;
    key?: string;
    expectedWalletPromptCount?: number;
}
