import type { WalletActionKind, WalletActionPolicy } from './types';

export function shouldUseDiscussionSessionToken(input: {
    discussionAuthMode?: string | null;
}): boolean {
    return (input.discussionAuthMode || 'session_token') === 'session_token';
}

export function resolveWalletActionPolicy(input: {
    kind: WalletActionKind;
    discussionAuthMode?: string | null;
}): WalletActionPolicy {
    if (input.kind === 'connect_wallet') {
        return {
            kind: input.kind,
            confirmationPolicy: 'connect',
            risk: 'low',
            allowSilentRetry: false,
            allowRepeatedWalletPrompt: false,
            userFacingSummaryKey: 'summary.connectWallet',
        };
    }

    if (input.kind === 'disconnect_wallet') {
        return {
            kind: input.kind,
            confirmationPolicy: 'none',
            risk: 'low',
            allowSilentRetry: false,
            allowRepeatedWalletPrompt: false,
            userFacingSummaryKey: 'summary.disconnectWallet',
        };
    }

    if (input.kind === 'auth_session') {
        return {
            kind: input.kind,
            confirmationPolicy: 'session_signature',
            risk: 'identity',
            allowSilentRetry: false,
            allowRepeatedWalletPrompt: false,
            userFacingSummaryKey: 'summary.authSession',
        };
    }

    if (input.kind === 'discussion_message') {
        return {
            kind: input.kind,
            confirmationPolicy: shouldUseDiscussionSessionToken(input) ? 'session_token' : 'message_signature',
            risk: 'low',
            allowSilentRetry: true,
            allowRepeatedWalletPrompt: false,
            userFacingSummaryKey: 'summary.discussionMessage',
        };
    }

    if (input.kind === 'tip_transfer') {
        return {
            kind: input.kind,
            confirmationPolicy: 'funds_transfer',
            risk: 'funds',
            allowSilentRetry: false,
            allowRepeatedWalletPrompt: false,
            userFacingSummaryKey: 'summary.tipTransfer',
        };
    }

    const signedServerMutationKinds: WalletActionKind[] = [
        'signed_server_mutation',
        'circle_settings_update',
        'circle_post_create_settings_sync',
        'governance_signal',
    ];

    if (signedServerMutationKinds.includes(input.kind)) {
        return {
            kind: input.kind,
            confirmationPolicy: 'message_signature',
            risk: 'identity',
            allowSilentRetry: false,
            allowRepeatedWalletPrompt: false,
            userFacingSummaryKey: `summary.${input.kind}`,
        };
    }

    const onchainKinds: WalletActionKind[] = [
        'profile_update',
        'identity_register',
        'circle_create',
        'circle_join',
        'circle_leave',
        'circle_member_role_update',
        'circle_member_remove',
        'citation_submit',
        'crystallization',
        'unknown_onchain_write',
    ];

    if (onchainKinds.includes(input.kind)) {
        return {
            kind: input.kind,
            confirmationPolicy: 'transaction',
            risk: input.kind === 'identity_register' ? 'identity' : 'onchain_write',
            allowSilentRetry: false,
            allowRepeatedWalletPrompt: false,
            userFacingSummaryKey: `summary.${input.kind}`,
        };
    }

    return {
        kind: input.kind,
        confirmationPolicy: 'none',
        risk: 'low',
        allowSilentRetry: true,
        allowRepeatedWalletPrompt: false,
        userFacingSummaryKey: 'summary.default',
    };
}
