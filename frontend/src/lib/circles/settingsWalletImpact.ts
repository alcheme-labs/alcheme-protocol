import type { WalletImpactItem, WalletImpactSummary } from './createCircleWalletImpact';

export interface AccessPolicyWalletImpactInput {
    minCrystalsChanged?: boolean;
    policyChanged?: boolean;
}

export interface IdentityJoinWalletImpactInput {
    needsIdentityRegistration?: boolean;
    requiresSessionSignature?: boolean;
    willJoinCircle?: boolean;
}

function summarizeSettingsWalletImpact(items: WalletImpactItem[]): WalletImpactSummary {
    const requiredItems = items.filter((item) => item.required);
    return {
        transactionCount: requiredItems.filter((item) => item.kind === 'transaction').length,
        messageSignatureCount: requiredItems.filter((item) => item.kind === 'message_signature').length,
        fundsTransferCount: requiredItems.filter((item) => item.kind === 'funds_transfer').length,
        sessionSignatureCount: requiredItems.filter((item) => item.kind === 'session_signature').length,
        totalPromptCount: requiredItems.length,
        items,
    };
}

export function resolveAccessPolicyWalletImpact(input: AccessPolicyWalletImpactInput): WalletImpactSummary {
    const items: WalletImpactItem[] = [];

    if (input.minCrystalsChanged) {
        items.push({
            id: 'access_policy_flags_update',
            kind: 'transaction',
            labelKey: 'CircleSettings.walletImpact.accessPolicyFlagsUpdate',
            required: true,
        });
    }

    if (input.policyChanged) {
        items.push({
            id: 'access_policy_settings_signature',
            kind: 'message_signature',
            labelKey: 'CircleSettings.walletImpact.accessPolicySettings',
            required: true,
        });
    }

    return summarizeSettingsWalletImpact(items);
}

export function resolveIdentityJoinWalletImpact(input: IdentityJoinWalletImpactInput): WalletImpactSummary {
    const items: WalletImpactItem[] = [];

    if (input.needsIdentityRegistration) {
        items.push({
            id: 'identity_register',
            kind: 'transaction',
            labelKey: 'RegisterIdentitySheet.walletImpact.identityRegister',
            required: true,
        });
    }

    if (input.requiresSessionSignature) {
        items.push({
            id: 'auth_session_signature',
            kind: 'session_signature',
            labelKey: 'RegisterIdentitySheet.walletImpact.sessionSignature',
            required: true,
        });
    }

    if (input.willJoinCircle) {
        items.push({
            id: 'circle_join',
            kind: 'transaction',
            labelKey: 'RegisterIdentitySheet.walletImpact.circleJoin',
            required: true,
        });
    }

    return summarizeSettingsWalletImpact(items);
}
