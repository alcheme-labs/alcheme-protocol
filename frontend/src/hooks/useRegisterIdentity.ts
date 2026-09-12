'use client';

import { useCallback, useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { waitForSignatureSlot } from '@/lib/api/sync';
import {
    ensureWalletSession,
    fetchPublicDemoAdmissionPolicy,
    fetchSessionMe,
    isIdentityNotRegisteredError,
} from '@/lib/api/session';
import { shouldSignAuthSession } from '@/lib/auth/sessionPolicy';
import { useI18n } from '@/i18n/useI18n';
import {
    formatIdentityHandleValidationError,
    validateIdentityHandle,
    type IdentityHandleValidationCopy,
} from '@/lib/identity/handle';
import { ONCHAIN_WRITE_ERROR_CODES } from '@/lib/solana/onchainWriteErrors';
import { notifyIdentityRegistered } from '@/lib/auth/identityRegistrationEvents';
import { waitForIndexedIdentity } from '@/lib/auth/identityRegistrationSync';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';
import { isBrowserOnlyMockWallet } from '@/lib/testing/browserOnlyMockPolicy';

interface RegisterIdentityResult {
    signature: string;
    handle: string;
}

interface UseRegisterIdentityReturn {
    registerIdentity: (input: { handle: string }) => Promise<RegisterIdentityResult | null>;
    loading: boolean;
    syncing: boolean;
    error: string | null;
    txSignature: string | null;
}

function isLocalRpcEndpoint(rpcEndpoint: string | null | undefined): boolean {
    const value = String(rpcEndpoint || '').toLowerCase();
    return value.includes('127.0.0.1:8899')
        || value.includes('localhost:8899');
}

function isDevnetRpcEndpoint(rpcEndpoint: string | null | undefined): boolean {
    const value = String(rpcEndpoint || '').toLowerCase();
    return value.includes('devnet');
}

interface RegisterIdentityErrorCopy {
    walletRequired: string;
    browserMockUnsupported: string;
    fundingLocal: string;
    fundingDevnet: string;
    fundingGeneric: string;
    sessionIndexPending: string;
    indexPending: string;
    signatureCancelled: string;
    handleTaken: string;
    invalidHandle: string;
    genericFailure: string;
}

function getFundingGuidanceMessage(rpcEndpoint: string | null | undefined, copy: RegisterIdentityErrorCopy): string {
    if (isLocalRpcEndpoint(rpcEndpoint)) {
        return copy.fundingLocal;
    }

    if (isDevnetRpcEndpoint(rpcEndpoint)) {
        return copy.fundingDevnet;
    }

    return copy.fundingGeneric;
}

async function waitForAuthenticatedSession(input: {
    publicKey: string;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<void> {
    const publicDemoPolicy = await fetchPublicDemoAdmissionPolicy();
    try {
        await ensureWalletSession({
            publicKey: input.publicKey,
            signMessage: publicDemoPolicy.required
                ? input.signMessage
                : shouldSignAuthSession(input.signMessage),
        });
    } catch (error) {
        if (isIdentityNotRegisteredError(error)) {
            throw new Error(ONCHAIN_WRITE_ERROR_CODES.identitySessionIndexPending);
        }
        throw error;
    }

    const session = await fetchSessionMe();
    if (!session.authenticated || session.user?.pubkey !== input.publicKey) {
        throw new Error(ONCHAIN_WRITE_ERROR_CODES.identitySessionIndexPending);
    }
}

function normalizeRegisterIdentityError(
    error: unknown,
    rpcEndpoint: string | null | undefined,
    copy: RegisterIdentityErrorCopy,
): string {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const message = raw.toLowerCase();

    if (message.includes(ONCHAIN_WRITE_ERROR_CODES.identitySessionIndexPending)) {
        return copy.sessionIndexPending;
    }

    if (message.includes('wallet') && message.includes('connect')) {
        return copy.walletRequired;
    }

    if (
        message.includes('user rejected')
        || message.includes('user denied')
        || message.includes('rejected the request')
    ) {
        return copy.signatureCancelled;
    }

    if (message.includes('already in use') || message.includes('has one') || message.includes('taken')) {
        return copy.handleTaken;
    }

    if (message.includes('invalidhandle') || message.includes('invalid handle')) {
        return copy.invalidHandle;
    }

    if (
        (message.includes('attempt to debit an account') && message.includes('prior credit'))
        || message.includes('insufficient funds')
        || message.includes('insufficient lamports')
    ) {
        return getFundingGuidanceMessage(rpcEndpoint, copy);
    }

    if (message.includes('index') || message.includes('sync')) {
        return copy.indexPending;
    }

    return raw || copy.genericFailure;
}

export function useRegisterIdentity(): UseRegisterIdentityReturn {
    const sdk = useAlchemeSDK();
    const apolloClient = useApolloClient();
    const { connection } = useConnection();
    const { publicKey, signMessage } = useWallet();
    const { runWalletAction } = useWalletActionRunner();
    const t = useI18n('WalletOnchainWrite');
    const identityHandleT = useI18n('IdentityHandleValidation');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);

    const registerIdentity = useCallback(async (input: { handle: string }): Promise<RegisterIdentityResult | null> => {
        const errorCopy: RegisterIdentityErrorCopy = {
            walletRequired: t('errors.walletRequired'),
            browserMockUnsupported: t('errors.browserMockIdentityRegistrationUnsupported'),
            fundingLocal: t('errors.registerFundingLocal'),
            fundingDevnet: t('errors.registerFundingDevnet'),
            fundingGeneric: t('errors.registerFundingGeneric'),
            sessionIndexPending: t('errors.registerSessionIndexPending'),
            indexPending: t('errors.registerIndexPending'),
            signatureCancelled: t('errors.registerSignatureCancelled'),
            handleTaken: t('errors.registerHandleTaken'),
            invalidHandle: t('errors.registerInvalidHandle'),
            genericFailure: t('errors.registerFailed'),
        };
        const identityHandleValidationCopy: IdentityHandleValidationCopy = {
            length: identityHandleT('errors.length'),
            characters: identityHandleT('errors.characters'),
            startsWithNumber: identityHandleT('errors.startsWithNumber'),
            edgeUnderscore: identityHandleT('errors.edgeUnderscore'),
            consecutiveUnderscore: identityHandleT('errors.consecutiveUnderscore'),
        };
        const handle = String(input.handle || '').trim();
        const isE2EMockMode = isBrowserOnlyMockWallet();
        const validationError = validateIdentityHandle(handle);
        if (validationError) {
            setError(formatIdentityHandleValidationError(validationError, identityHandleValidationCopy));
            return null;
        }

        if (!publicKey) {
            setError(errorCopy.walletRequired);
            return null;
        }
        if (isE2EMockMode) {
            setError(errorCopy.browserMockUnsupported);
            return null;
        }
        if (!sdk) {
            setError(errorCopy.walletRequired);
            return null;
        }

        setLoading(true);
        setSyncing(false);
        setError(null);
        setTxSignature(null);

        try {
            let signature: string;
            const activeSdk = sdk;
            if (!activeSdk) {
                throw new Error('wallet not connected');
            }
            const available = await activeSdk.identity.checkHandleAvailability(handle);
            if (!available) {
                throw new Error('handle already in use');
            }
            signature = await runWalletAction({
                kind: 'identity_register',
                source: 'identity_registration',
                key: `identity_register:${handle}`,
                run: () => activeSdk.identity.registerIdentity(handle, handle),
            });
            setTxSignature(signature);
            setSyncing(true);

            await waitForSignatureSlot(activeSdk.connection, signature);

            const identityWait = await waitForIndexedIdentity({
                handle,
                publicKey: publicKey.toBase58(),
            });
            if (!identityWait.ok) {
                setError(identityWait.reason === 'identity_mismatch'
                    ? errorCopy.handleTaken
                    : errorCopy.indexPending);
                return null;
            }

            await waitForAuthenticatedSession({
                publicKey: publicKey.toBase58(),
                signMessage,
            });
            setError(null);
            notifyIdentityRegistered({
                pubkey: publicKey.toBase58(),
                handle,
                signature,
            });
            await apolloClient.reFetchObservableQueries();

            return {
                signature,
                handle,
            };
        } catch (registerError) {
            setError(normalizeRegisterIdentityError(registerError, connection.rpcEndpoint, errorCopy));
            return null;
        } finally {
            setLoading(false);
            setSyncing(false);
        }
    }, [apolloClient, connection.rpcEndpoint, identityHandleT, publicKey, runWalletAction, sdk, signMessage, t]);

    return {
        registerIdentity,
        loading,
        syncing,
        error,
        txSignature,
    };
}
