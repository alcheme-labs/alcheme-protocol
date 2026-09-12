'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
    createHostedAppActionIntent,
    openHostedAppSession,
} from '@/lib/api/hostedApps';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';

import {
    assertManagedAppOriginIsIsolated,
    createHostedAppRuntimeBridge,
} from './runtimeBridge';
import { NativeActionConfirmSheet } from './NativeActionConfirmSheet';
import {
    digestSignatureActionPreview,
    stableStringify,
} from './signatureActionPreview.mjs';
import type { SignatureIntentReviewProps } from './SignatureIntentReview';

export interface HostedAppFrameProps {
    appId: string;
    appName: string;
    releaseId: string;
    circleId: number;
    bundleUrl: string;
    manifestHash: string;
    managedOriginSuffix?: string;
}

interface HostedAppRuntimeSession {
    bridgeSessionToken: string;
    releaseOrigin: string;
    sessionDigest: string;
}

interface PendingSignatureIntent {
    payload: Record<string, unknown>;
    review: SignatureIntentReviewProps;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    signing: boolean;
}

const DEFAULT_MANAGED_ORIGIN_SUFFIX = '.apps.alchemeusercontent.local';

export function HostedAppFrame(props: HostedAppFrameProps) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const pendingSignatureRef = useRef<PendingSignatureIntent | null>(null);
    const { signMessageForAction } = useWalletActionRunner();
    const [session, setSession] = useState<HostedAppRuntimeSession | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pendingSignatureIntent, setPendingSignatureIntent] = useState<PendingSignatureIntent | null>(null);

    useEffect(() => {
        let mounted = true;
        setSession(null);
        setError(null);

        openHostedAppSession(props.appId, {
            releaseId: props.releaseId,
            circleId: props.circleId,
            manifestHash: props.manifestHash,
            bundleUrl: props.bundleUrl,
        })
            .then((value) => {
                const nextSession = parseRuntimeSession(value);
                assertRuntimeLaunchAllowed({
                    bundleUrl: props.bundleUrl,
                    releaseOrigin: nextSession.releaseOrigin,
                    managedOriginSuffix: props.managedOriginSuffix || DEFAULT_MANAGED_ORIGIN_SUFFIX,
                });
                if (mounted) setSession(nextSession);
            })
            .catch((reason) => {
                if (mounted) {
                    setError(reason instanceof Error ? reason.message : 'hosted_app_session_failed');
                }
            });

        return () => {
            mounted = false;
        };
    }, [
        props.appId,
        props.releaseId,
        props.circleId,
        props.manifestHash,
        props.bundleUrl,
        props.managedOriginSuffix,
    ]);

    const clearPendingSignatureIntent = useCallback(() => {
        pendingSignatureRef.current = null;
        setPendingSignatureIntent(null);
    }, []);

    const requestSignatureIntent = useCallback((payload: Record<string, unknown>) => {
        if (pendingSignatureRef.current) {
            throw new Error('hosted_app_signature_intent_already_pending');
        }
        const review = parseSignatureIntentReview(payload, props);
        return new Promise((resolve, reject) => {
            const pending = {
                payload,
                review,
                resolve,
                reject,
                signing: false,
            };
            pendingSignatureRef.current = pending;
            setPendingSignatureIntent(pending);
        });
    }, [props]);

    const cancelSignatureIntent = useCallback(() => {
        const pending = pendingSignatureRef.current;
        if (!pending) return;
        pending.reject(new Error('hosted_app_signature_denied'));
        clearPendingSignatureIntent();
    }, [clearPendingSignatureIntent]);

    const confirmSignatureIntent = useCallback(async () => {
        const pending = pendingSignatureRef.current;
        if (!pending) return;
        const signingPending = { ...pending, signing: true };
        pendingSignatureRef.current = signingPending;
        setPendingSignatureIntent(signingPending);
        try {
            const confirmedPreviewDigest = await digestSignatureActionPreview({
                purpose: requiredString(pending.payload.purpose, 'hosted_app_signature_purpose_required'),
                chainId: pending.review.chainId,
                programOrContract: pending.review.programOrContract,
                method: pending.review.method,
                accounts: pending.review.accounts,
                amount: pending.review.amount,
                spender: pending.review.spender,
                typedDataDomain: pending.review.typedDataDomain,
                simulationResultDigest: pending.review.simulationResultDigest,
                riskExplanation: pending.review.riskExplanation,
                payloadDigest: pending.review.payloadDigest,
                previewDigest: pending.review.previewDigest,
                replayDomain: pending.review.replayDomain,
                nonce: pending.review.nonce,
                appId: props.appId,
                releaseId: props.releaseId,
                manifestHash: props.manifestHash,
                circleId: props.circleId,
                userPubkey: pending.review.userLabel,
                riskLevel: requiredString(pending.payload.riskLevel, 'hosted_app_signature_riskLevel_required'),
                signer: requiredString(
                    pending.payload.signer ?? pending.review.userLabel,
                    'hosted_app_signature_signer_required',
                ),
                expiresAt: pending.review.expiresAt,
            });
            const message = stableStringify({
                domain: 'alcheme-hosted-app-signature',
                appId: props.appId,
                releaseId: props.releaseId,
                manifestHash: props.manifestHash,
                circleId: props.circleId,
                payloadDigest: pending.review.payloadDigest,
                previewDigest: pending.review.previewDigest,
                actionPreviewDigest: confirmedPreviewDigest,
                replayDomain: pending.review.replayDomain,
                nonce: pending.review.nonce,
                expiresAt: pending.review.expiresAt,
            });
            const signature = await signMessageForAction({
                kind: 'signed_server_mutation',
                source: `hosted_app_runtime:${props.appId}`,
                key: `hosted_app_signature:${pending.review.nonce}`,
                message,
            });
            const signatureDigest = await sha256Bytes(signature);
            const result = await createHostedAppActionIntent(props.appId, {
                ...pending.payload,
                actionId: 'request_signature_intent',
                signatureDigest,
                signatureAlgorithm: 'wallet.signMessage',
                confirmedPreviewDigest,
            });
            pending.resolve(result);
        } catch (reason) {
            pending.reject(reason);
        } finally {
            clearPendingSignatureIntent();
        }
    }, [
        clearPendingSignatureIntent,
        props.appId,
        props.circleId,
        props.manifestHash,
        props.releaseId,
        signMessageForAction,
    ]);

    useEffect(() => {
        if (!session) return;
        const bridge = createHostedAppRuntimeBridge({
            appId: props.appId,
            releaseId: props.releaseId,
            circleId: props.circleId,
            manifestHash: props.manifestHash,
            releaseOrigin: session.releaseOrigin,
            bridgeSessionToken: session.bridgeSessionToken,
            sessionDigest: session.sessionDigest,
            getTargetWindow: () => iframeRef.current?.contentWindow ?? null,
            requestSignatureIntent,
        });
        window.addEventListener('message', bridge.handleMessage);
        return () => window.removeEventListener('message', bridge.handleMessage);
    }, [props.appId, props.releaseId, props.circleId, props.manifestHash, requestSignatureIntent, session]);

    if (error) {
        return <div role="alert">Hosted app runtime unavailable.</div>;
    }

    if (!session) {
        return <div role="status">Loading hosted app runtime.</div>;
    }

    return (
        <>
            <iframe
                ref={iframeRef}
                title={props.appName}
                src={props.bundleUrl}
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            />
            <NativeActionConfirmSheet
                open={Boolean(pendingSignatureIntent)}
                actionId="request_signature_intent"
                title="Review Signature"
                appName={props.appName}
                actionLabel="Wallet signature request"
                description={pendingSignatureIntent?.review.riskExplanation}
                previewDigest={pendingSignatureIntent?.review.previewDigest}
                payloadDigest={pendingSignatureIntent?.review.payloadDigest}
                signatureIntent={pendingSignatureIntent?.review ?? null}
                confirmLabel={pendingSignatureIntent?.signing ? 'Signing' : 'Sign'}
                cancelLabel="Deny"
                onConfirm={() => {
                    void confirmSignatureIntent();
                }}
                onCancel={cancelSignatureIntent}
            />
        </>
    );
}

function parseRuntimeSession(value: unknown): HostedAppRuntimeSession {
    if (!value || typeof value !== 'object') {
        throw new Error('hosted_app_session_invalid');
    }
    const record = value as Record<string, unknown>;
    if (record.ok !== true) {
        throw new Error('hosted_app_session_denied');
    }
    const bridgeSessionToken = typeof record.bridgeSessionToken === 'string'
        ? record.bridgeSessionToken
        : '';
    const releaseOrigin = typeof record.releaseOrigin === 'string'
        ? record.releaseOrigin
        : '';
    const sessionDigest = typeof record.sessionDigest === 'string'
        ? record.sessionDigest
        : '';
    if (!bridgeSessionToken || !releaseOrigin || !sessionDigest) {
        throw new Error('hosted_app_session_invalid');
    }
    return { bridgeSessionToken, releaseOrigin, sessionDigest };
}

function assertRuntimeLaunchAllowed(input: {
    bundleUrl: string;
    releaseOrigin: string;
    managedOriginSuffix: string;
}) {
    const releaseOrigin = new URL(input.releaseOrigin).origin;
    const bundleOrigin = new URL(input.bundleUrl).origin;
    if (bundleOrigin !== releaseOrigin) {
        throw new Error('hosted_app_release_origin_mismatch');
    }
    assertManagedAppOriginIsIsolated({
        appOrigin: releaseOrigin,
        forbiddenOrigins: resolveForbiddenFirstPartyOrigins(),
        requiredSuffix: input.managedOriginSuffix,
    });
}

function resolveForbiddenFirstPartyOrigins(): string[] {
    const values = [
        window.location.origin,
        process.env.NEXT_PUBLIC_SIDECAR_BASE_URL,
        process.env.NEXT_PUBLIC_WALLET_CALLBACK_ORIGIN,
        process.env.NEXT_PUBLIC_ADMIN_ORIGIN,
        process.env.NEXT_PUBLIC_PRIVATE_STORAGE_GATEWAY_ORIGIN,
    ];
    return values.filter((value): value is string => Boolean(value));
}

function parseSignatureIntentReview(
    payload: Record<string, unknown>,
    props: HostedAppFrameProps,
): SignatureIntentReviewProps {
    return {
        chainId: requiredString(payload.chainId, 'hosted_app_signature_chainId_required'),
        programOrContract: requiredString(
            payload.programOrContract,
            'hosted_app_signature_programOrContract_required',
        ),
        method: requiredString(payload.method, 'hosted_app_signature_method_required'),
        accounts: normalizeStringList(payload.accounts),
        amount: optionalString(payload.amount),
        spender: optionalString(payload.spender),
        typedDataDomain: optionalString(payload.typedDataDomain),
        simulationResultDigest: requiredString(
            payload.simulationResultDigest,
            'hosted_app_signature_simulationResultDigest_required',
        ),
        riskExplanation: requiredString(payload.riskExplanation, 'hosted_app_signature_riskExplanation_required'),
        payloadDigest: requiredString(payload.payloadDigest, 'hosted_app_signature_payloadDigest_required'),
        previewDigest: requiredString(payload.previewDigest, 'hosted_app_signature_previewDigest_required'),
        replayDomain: requiredString(payload.replayDomain, 'hosted_app_signature_replayDomain_required'),
        nonce: requiredString(payload.nonce, 'hosted_app_signature_nonce_required'),
        appLabel: props.appId,
        releaseLabel: props.releaseId,
        circleLabel: String(props.circleId),
        userLabel: requiredString(payload.signer ?? payload.userPubkey, 'hosted_app_signature_signer_required'),
        expiresAt: requiredString(payload.expiresAt, 'hosted_app_signature_expiresAt_required'),
    };
}

function requiredString(value: unknown, errorCode: string): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new Error(errorCode);
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => String(entry).trim()).filter(Boolean);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return `sha256:${Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')}`;
}
