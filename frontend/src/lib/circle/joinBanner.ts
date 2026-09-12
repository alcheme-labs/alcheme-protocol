import type { CircleMembershipSnapshot } from '../circles/membership';
import type { WalletIdentityState } from '../auth/identityOnboarding';
import type { CircleJoinCopy } from './utils';
import { getJoinButtonLabel, getJoinHintText } from './utils';

export type CircleJoinBannerAction =
    | 'connect_wallet'
    | 'register_identity'
    | 'retry_session'
    | 'join'
    | 'passive';

export interface CircleJoinBannerState {
    action: CircleJoinBannerAction;
    label: string;
    hint: string | null;
}

interface CircleJoinBannerLabels {
    connectWallet: string;
    connectWalletHint: string;
    registerIdentity: string;
    registerIdentityHint: string;
    retrySession?: string;
    retrySessionHint?: string;
    unresolvedMembershipLabel?: string;
    unresolvedMembershipHint?: string;
}

interface CircleJoinBannerOptions {
    identityState?: WalletIdentityState | null;
    membershipFetchFailed?: boolean;
}

export function resolveCircleJoinBannerState(
    snapshot: CircleMembershipSnapshot | null,
    walletConnected: boolean,
    copy: CircleJoinCopy,
    labels?: CircleJoinBannerLabels,
    options?: CircleJoinBannerOptions,
): CircleJoinBannerState {
    if (!walletConnected) {
        return {
            action: 'connect_wallet',
            label: labels?.connectWallet || 'Connect wallet',
            hint: labels?.connectWalletHint || 'Connect your wallet before joining this circle.',
        };
    }

    if (!snapshot) {
        if (options?.identityState === 'unregistered') {
            return {
                action: 'register_identity',
                label: labels?.registerIdentity || 'Create identity',
                hint: labels?.registerIdentityHint || 'Create an identity before joining this circle.',
            };
        }
        if (options?.identityState === 'session_error') {
            return {
                action: 'retry_session',
                label: labels?.retrySession || 'Retry',
                hint: labels?.retrySessionHint || 'We could not confirm your identity state. Please try again.',
            };
        }
        if (options?.membershipFetchFailed) {
            return {
                action: 'retry_session',
                label: labels?.retrySession || 'Retry',
                hint: labels?.retrySessionHint || 'We could not confirm your circle access. Please try again.',
            };
        }
        return {
            action: 'passive',
            label: labels?.unresolvedMembershipLabel || 'Working…',
            hint: labels?.unresolvedMembershipHint || 'Checking your circle access.',
        };
    }

    if (snapshot && !snapshot.authenticated) {
        return {
            action: 'register_identity',
            label: labels?.registerIdentity || 'Create identity',
            hint: labels?.registerIdentityHint || 'Create an identity before joining this circle.',
        };
    }

    if (
        snapshot
        && (
            snapshot.joinState === 'pending'
            || snapshot.joinState === 'invite_required'
            || snapshot.joinState === 'insufficient_crystals'
            || snapshot.joinState === 'banned'
        )
    ) {
        return {
            action: 'passive',
            label: getJoinButtonLabel(snapshot, copy),
            hint: getJoinHintText(snapshot, copy),
        };
    }

    return {
        action: 'join',
        label: getJoinButtonLabel(snapshot, copy),
        hint: getJoinHintText(snapshot, copy),
    };
}
