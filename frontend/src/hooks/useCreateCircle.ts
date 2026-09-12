'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';
import { waitForSignatureSlot, waitForIndexedSlot } from '@/lib/api/sync';
import {
    importSeededSources,
    type SeededSourceInput,
} from '@/lib/api/circlesSeeded';
import {
    updateCirclePostCreateSettings,
    type CirclePostCreateSettingsPatch,
} from '@/lib/api/circlesPostCreateSettings';
import {
    clearPendingPostCreateSettings,
    savePendingPostCreateSettings,
} from '@/lib/circles/postCreateSettingsRecovery';
import {
    getCreateCircleSignerUnavailableError,
    settleCreateCirclePostCreateSync,
    waitForCircleReadModelVisibility,
} from '@/lib/api/createCircleFlow';
import { useI18n } from '@/i18n/useI18n';
import { encodeCircleFlags } from '@/lib/circle/flags';
import { syncNewCircleGovernanceBootstrap } from '@/lib/api/circlesGovernanceBootstrap';
import {
    clearPendingNewCircleGovernanceBootstrap,
    listPendingNewCircleGovernanceBootstraps,
    savePendingNewCircleGovernanceBootstrap,
} from '@/lib/circles/governanceBootstrapRecovery';
import { isBrowserOnlyMockWallet } from '@/lib/testing/browserOnlyMockPolicy';
import {
    resolveCreateCirclePostCreatePlan,
    resolveCreateCirclePreflight,
    resolvePostCreateSettingsApplication,
    resolvePostCreateSettingsFailure,
    resolvePostCreateSettingsReadModelGate,
    resolvePostCreateSyncSettlement,
    resolveSeededSourcesImportFailure,
    type CreateCircleOrchestratorOptions,
    type CreateCirclePostCreateSettingsStatus,
} from '@/lib/createCircle/createCircleOrchestrator';

interface CreateCircleOptions extends CreateCircleOrchestratorOptions {
    name: string;
    level?: number;        // 默认 0 (Plaza)
    parentCircle?: number;
    forkAnchor?: {
        sourceCircleId: number;
        forkDeclarationDigest: string | Uint8Array | number[];
    };
}

interface CreateCircleResult {
    txSignature: string;
    circleId: number;
    notice: string | null;
    indexed: boolean;
    governanceBootstrapStatus: 'bootstrap_pending' | 'pending_recovery';
    postCreateSettingsStatus: CreateCirclePostCreateSettingsStatus;
    pendingPostCreateSettings?: CirclePostCreateSettingsPatch;
}

interface UseCreateCircleReturn {
    createCircle: (options: CreateCircleOptions) => Promise<CreateCircleResult | null>;
    clearNotice: () => void;
    loading: boolean;
    syncing: boolean;
    indexed: boolean;
    error: string | null;
    notice: string | null;
    txSignature: string | null;
}

type CreateCircleTranslator = ReturnType<typeof useI18n>;

function normalizeCreateCircleError(error: unknown, t: CreateCircleTranslator): string {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const logs = Array.isArray((error as any)?.logs) ? (error as any).logs.join(' ') : '';
    const message = `${raw} ${logs}`.toLowerCase();

    if (message.includes('wallet not connected') || message.includes('not connected')) {
        return t('errors.walletNotConnected');
    }

    if (
        message.includes('user rejected') ||
        message.includes('user denied') ||
        message.includes('denied transaction') ||
        message.includes('rejected the request')
    ) {
        return t('errors.userRejected');
    }

    if (message.includes('insufficient funds') || message.includes('insufficient lamports')) {
        return t('errors.insufficientFunds');
    }

    if (message.includes('constraintseeds') || message.includes('constraint seeds')) {
        return t('errors.constraintSeeds');
    }

    if (
        message.includes('accountnotinitialized') ||
        message.includes('account does not exist') ||
        message.includes('could not find account') ||
        message.includes('not initialized')
    ) {
        return t('errors.circleManagerMissing');
    }

    if (
        message.includes('this transaction was reverted during simulation') ||
        message.includes('transaction simulation failed') ||
        message.includes('unknown error occurred') ||
        message.includes('custom program error')
    ) {
        return t('errors.simulationFailed');
    }

    if (
        message.includes('accountnotfound') ||
        message.includes('attempt to debit an account but found no record of a prior credit') ||
        message.includes('no prior credit')
    ) {
        return t('errors.accountNotReady');
    }

    return raw || t('errors.genericFailure');
}

function appendCreateCircleNotice(previous: string | null, next: string): string {
    return previous ? `${previous} ${next}` : next;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryPendingNewCircleGovernanceBootstrap(
    pending: Parameters<typeof savePendingNewCircleGovernanceBootstrap>[0],
    initialDelayMs: number = 0,
): Promise<void> {
    if (initialDelayMs > 0) await sleep(initialDelayMs);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await syncNewCircleGovernanceBootstrap(pending);
            clearPendingNewCircleGovernanceBootstrap(pending.circleId);
            return;
        } catch {
            if (attempt < 4) await sleep(5_000);
        }
    }
}

function getCreateCirclePostCreateSyncTimeoutMs(): number {
    const configuredTimeoutMs = Number(process.env.NEXT_PUBLIC_CREATE_CIRCLE_POST_SYNC_TIMEOUT_MS);
    if (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0) {
        return Math.floor(configuredTimeoutMs);
    }
    return 20_000;
}

async function syncSeededSourcesWithRetry(input: {
    circleId: number;
    seededSources: SeededSourceInput[];
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 15);
    const delayMs = Math.max(200, input.delayMs ?? 1000);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await importSeededSources(input.circleId, input.seededSources);
            return;
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error ?? '');
            const retriable =
                message.includes('404')
                || message.includes('circle_not_found')
                || message.includes('fetch failed')
                || message.includes('network');
            if (!retriable || attempt === maxAttempts) {
                break;
            }
            await sleep(delayMs);
        }
    }

    throw lastError instanceof Error ? lastError : new Error('sync seeded sources failed');
}

/**
 * useCreateCircle — 创建圈层（链上交易）
 *
 * 调用 SDK circles.createCircle() 在链上创建圈层。
 * 交易确认后由 indexer 监听 CircleCreated 事件入库。
 */
export function useCreateCircle(): UseCreateCircleReturn {
    const sdk = useAlchemeSDK();
    const { publicKey, signMessage } = useWallet();
    const { runWalletAction, runWalletActionBatch, signMessageForAction } = useWalletActionRunner();
    const { identityState, sessionUser } = useIdentityOnboarding();
    const sessionUserPubkey = sessionUser?.pubkey ?? null;
    const t = useI18n('CreateCircleFlow');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [indexed, setIndexed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);
    const inFlightRef = useRef<Promise<CreateCircleResult | null> | null>(null);

    useEffect(() => {
        if (!sessionUserPubkey) return;
        for (const pending of listPendingNewCircleGovernanceBootstraps(sessionUserPubkey)) {
            void retryPendingNewCircleGovernanceBootstrap(pending);
        }
    }, [sessionUserPubkey]);

    const clearNotice = useCallback(() => {
        setNotice(null);
    }, []);

    const createCircle = useCallback(async (options: CreateCircleOptions): Promise<CreateCircleResult | null> => {
        if (inFlightRef.current) return inFlightRef.current;

        const run = (async () => {
            const isE2EMockMode = isBrowserOnlyMockWallet();
            const signerUnavailableError = getCreateCircleSignerUnavailableError(
                signMessage,
                t('errors.walletMessageSigningUnsupported'),
            );
            const preflight = resolveCreateCirclePreflight({
                walletPubkey: publicKey?.toBase58() ?? null,
                identityState,
                sessionUserPubkey,
                isE2EMockMode,
                hasSdk: Boolean(sdk),
                signerUnavailableError,
            });
            if (preflight.status !== 'completed') {
                setError(
                    preflight.errorMessage
                    ?? (preflight.errorKey ? t(preflight.errorKey) : t('errors.genericFailure')),
                );
                return null;
            }
            const creatorPubkey = sessionUserPubkey;
            if (!creatorPubkey) {
                setError(t('errors.identityRequired'));
                return null;
            }

            setLoading(true);
            setSyncing(false);
            setIndexed(false);
            setError(null);
            setNotice(null);
            setTxSignature(null);

            try {
                if (options.parentCircle !== undefined && (options.parentCircle < 0 || options.parentCircle > 255)) {
                    throw new Error(t('errors.parentCircleOutOfRange'));
                }

                const postCreatePlan = resolveCreateCirclePostCreatePlan(options);
                let tx: string | null = null;
                let createdCircleId: number | null = null;
                let e2eSignatureSlot: number | null = null;
                let completionNotice: string | null = null;
                const addCompletionNotice = (message: string) => {
                    completionNotice = appendCreateCircleNotice(completionNotice, message);
                    setNotice(completionNotice);
                };

                const activeSdk = sdk;
                if (!activeSdk) {
                    throw new Error(t('errors.walletNotConnected'));
                }

                const payer = activeSdk.provider.publicKey;
                if (!payer) {
                    throw new Error(t('errors.walletSignerMissing'));
                }

                const payerAccount = await activeSdk.connection.getAccountInfo(payer);
                if (!payerAccount) {
                    throw new Error(
                        t('errors.payerAccountMissing', {wallet: payer.toBase58()}),
                    );
                }

                const [circleManagerPda] = PublicKey.findProgramAddressSync(
                    [new TextEncoder().encode('circle_manager')],
                    activeSdk.circles.programId,
                );

                const [eventEmitterPda] = PublicKey.findProgramAddressSync(
                    [new TextEncoder().encode('event_emitter')],
                    activeSdk.event.programId,
                );

                const [programAccount, managerAccount, eventProgramAccount, eventEmitterAccount] = await Promise.all([
                    activeSdk.connection.getAccountInfo(activeSdk.circles.programId),
                    activeSdk.connection.getAccountInfo(circleManagerPda),
                    activeSdk.connection.getAccountInfo(activeSdk.event.programId),
                    activeSdk.connection.getAccountInfo(eventEmitterPda),
                ]);

                if (!programAccount?.executable) {
                    throw new Error(
                        t('errors.circleProgramMissing', {rpc: activeSdk.connection.rpcEndpoint}),
                    );
                }

                if (!managerAccount) {
                    throw new Error(
                        t('errors.circleManagerMissingDetailed', {pda: circleManagerPda.toBase58()}),
                    );
                }

                if (!eventProgramAccount?.executable) {
                    throw new Error(
                        t('errors.eventProgramMissing', {rpc: activeSdk.connection.rpcEndpoint}),
                    );
                }

                if (!eventEmitterAccount) {
                    throw new Error(
                        t('errors.eventEmitterMissing', {pda: eventEmitterPda.toBase58()}),
                    );
                }

                const nextCircleId = () => ((Date.now() + Math.floor(Math.random() * 10_000)) % 255) + 1;
                const findCirclePda = (candidateCircleId: number) => PublicKey.findProgramAddressSync(
                    [new TextEncoder().encode('circle'), Uint8Array.of(candidateCircleId)],
                    activeSdk.circles.programId,
                )[0];
                const selectAvailableCircleId = async (): Promise<number> => {
                    for (let attempt = 0; attempt < 4; attempt += 1) {
                        const candidateCircleId = nextCircleId();
                        const circlePda = findCirclePda(candidateCircleId);
                        const existingCircleAccount = await activeSdk.connection.getAccountInfo(circlePda);
                        if (!existingCircleAccount) {
                            return candidateCircleId;
                        }
                    }
                    throw new Error(t('errors.circleIdAllocationFailed'));
                };

                const circleId = await selectAvailableCircleId();
                try {
                    tx = await runWalletAction({
                        kind: 'circle_create',
                        source: 'create_circle',
                        key: `circle_create:${options.name.trim() || 'untitled'}`,
                        run: () => activeSdk.circles.createCircle({
                            circleId,
                            name: options.name,
                            level: options.level ?? 0,
                            parentCircle: options.parentCircle,
                            knowledgeGovernance: {
                                minQualityScore: 50,
                                minCuratorReputation: 10,
                                transferCooldown: new BN(3600),
                                maxTransfersPerDay: 10,
                                requirePeerReview: false,
                                peerReviewCount: 0,
                                autoQualityCheck: true,
                            },
                        }),
                    });
                    createdCircleId = circleId;
                } catch (error) {
                    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
                    const isCollision =
                        message.includes('already in use')
                        || message.includes('already exists')
                        || message.includes('account in use');
                    if (isCollision) {
                        throw new Error(t('errors.circleIdCollisionAfterSignature'));
                    }
                    throw error;
                }

                if (!tx || createdCircleId === null) {
                    throw new Error(t('errors.circleIdMissing'));
                }

                let flagsUpdateTx: string | null = null;
                let forkAnchorTx: string | null = null;
                e2eSignatureSlot = await waitForSignatureSlot(activeSdk.connection, tx);

                setTxSignature(tx);

                setSyncing(true);
                const targetIndexedSlot = e2eSignatureSlot;

                if (targetIndexedSlot !== null) {
                    const indexWait = await waitForIndexedSlot(targetIndexedSlot);
                    if (!indexWait.ok) {
                        addCompletionNotice(t('errors.indexerLagging'));
                    }
                } else {
                    addCompletionNotice(t('errors.signatureSlotMissing'));
                }

                const circleVisible = await waitForCircleReadModelVisibility({
                    circleId: createdCircleId,
                });
                setIndexed(circleVisible);
                if (!circleVisible) {
                    addCompletionNotice(t('errors.readModelLagging'));
                }
                let governanceBootstrapStatus: CreateCircleResult['governanceBootstrapStatus'] =
                    'pending_recovery';
                const governanceBootstrapRecovery = {
                    circleId: createdCircleId,
                    actorPubkey: creatorPubkey,
                    creationTxSignature: tx,
                };
                if (circleVisible) {
                    try {
                        await syncNewCircleGovernanceBootstrap(governanceBootstrapRecovery);
                        clearPendingNewCircleGovernanceBootstrap(createdCircleId);
                        governanceBootstrapStatus = 'bootstrap_pending';
                    } catch (bootstrapError) {
                        console.warn('[useCreateCircle] governance bootstrap sync failed', bootstrapError);
                        const pendingBootstrap = {
                            ...governanceBootstrapRecovery,
                            createdAt: new Date().toISOString(),
                            reason: 'sync_failed' as const,
                        };
                        savePendingNewCircleGovernanceBootstrap(pendingBootstrap);
                        void retryPendingNewCircleGovernanceBootstrap(pendingBootstrap, 5_000);
                        addCompletionNotice(t('errors.circleGovernanceBootstrapPending'));
                    }
                } else {
                    const pendingBootstrap = {
                        ...governanceBootstrapRecovery,
                        createdAt: new Date().toISOString(),
                        reason: 'read_model_pending' as const,
                    };
                    savePendingNewCircleGovernanceBootstrap(pendingBootstrap);
                    void retryPendingNewCircleGovernanceBootstrap(pendingBootstrap, 5_000);
                    addCompletionNotice(t('errors.circleGovernanceBootstrapPending'));
                }

                const {
                    expectedPostCreatePromptCount,
                    hasPostCreatePatch,
                    hasPostCreateSyncWork,
                    postCreatePatch,
                } = postCreatePlan;
                const targetFlags = encodeCircleFlags({
                    kind: postCreatePlan.targetKind,
                    mode: postCreatePlan.targetMode,
                    minCrystals: postCreatePlan.targetMinCrystals,
                });
                let postCreateSettingsStatus: CreateCirclePostCreateSettingsStatus =
                    postCreatePlan.initialPostCreateSettingsStatus;
                let pendingPostCreateSettings: CirclePostCreateSettingsPatch | undefined;

                const syncPostCreateCircleSettings = async (): Promise<void> => {
                    if (postCreatePlan.needFlagUpdate) {
                        try {
                            const circlesModule = activeSdk.circles as typeof activeSdk.circles & {
                                updateCircleFlags: (circleId: number, flags: BN) => Promise<string>;
                            };
                            flagsUpdateTx = await circlesModule.updateCircleFlags(createdCircleId, targetFlags);
                        } catch (flagsError) {
                            console.warn('[useCreateCircle] update circle flags failed', flagsError);
                            addCompletionNotice(t('errors.circleFlagsSyncFailed'));
                        }
                    }

                    if (options.forkAnchor) {
                        try {
                            forkAnchorTx = await (activeSdk.circles as any).anchorCircleFork({
                                sourceCircleId: options.forkAnchor.sourceCircleId,
                                targetCircleId: createdCircleId,
                                forkDeclarationDigest: options.forkAnchor.forkDeclarationDigest,
                            });
                        } catch (anchorError) {
                            console.warn('[useCreateCircle] anchor fork failed', anchorError);
                            addCompletionNotice(t('errors.forkAnchorSyncFailed'));
                        }
                    }

                    if (hasPostCreatePatch) {
                        const readModelGate = resolvePostCreateSettingsReadModelGate({
                            circleVisible,
                            hasPostCreatePatch,
                        });
                        if (readModelGate.status === 'pending') {
                            postCreateSettingsStatus = readModelGate.postCreateSettingsStatus ?? postCreateSettingsStatus;
                            pendingPostCreateSettings = postCreatePatch;
                            savePendingPostCreateSettings({
                                circleId: createdCircleId,
                                patch: postCreatePatch,
                                createdAt: new Date().toISOString(),
                                reason: readModelGate.pendingReason ?? 'read_model_pending',
                            });
                            if (readModelGate.noticeKey) {
                                addCompletionNotice(t(readModelGate.noticeKey));
                            }
                        } else {
                            try {
                                if (!sessionUserPubkey) {
                                    throw new Error('wallet_sign_message_unavailable');
                                }
                                const result = await updateCirclePostCreateSettings(createdCircleId, postCreatePatch, {
                                    actorPubkey: sessionUserPubkey,
                                    signMessage: (message: Uint8Array) => signMessageForAction({
                                        kind: 'circle_post_create_settings_sync',
                                        source: 'create_circle_post_create_settings',
                                        key: `circle_post_create_settings:${createdCircleId}`,
                                        message,
                                        preserveCurrentAction: true,
                                    }),
                                });
                                const settingsDecision = resolvePostCreateSettingsApplication(result);
                                if (settingsDecision.status === 'requires_governance') {
                                    postCreateSettingsStatus = settingsDecision.postCreateSettingsStatus ?? postCreateSettingsStatus;
                                    pendingPostCreateSettings = postCreatePatch;
                                    savePendingPostCreateSettings({
                                        circleId: createdCircleId,
                                        patch: postCreatePatch,
                                        createdAt: new Date().toISOString(),
                                        reason: settingsDecision.pendingReason ?? 'requires_governance',
                                    });
                                    if (settingsDecision.noticeKey) {
                                        addCompletionNotice(t(settingsDecision.noticeKey));
                                    }
                                    return;
                                }
                                postCreateSettingsStatus = settingsDecision.postCreateSettingsStatus ?? postCreateSettingsStatus;
                                if (settingsDecision.shouldClearPendingPostCreateSettings) {
                                    clearPendingPostCreateSettings(createdCircleId);
                                }
                            } catch (postCreateError) {
                                const failureDecision = resolvePostCreateSettingsFailure();
                                postCreateSettingsStatus = failureDecision.postCreateSettingsStatus ?? postCreateSettingsStatus;
                                pendingPostCreateSettings = postCreatePatch;
                                savePendingPostCreateSettings({
                                    circleId: createdCircleId,
                                    patch: postCreatePatch,
                                    createdAt: new Date().toISOString(),
                                    reason: failureDecision.pendingReason ?? 'sync_failed',
                                });
                                console.warn('[useCreateCircle] sync post-create settings failed', postCreateError);
                                if (failureDecision.noticeKey) {
                                    addCompletionNotice(t(failureDecision.noticeKey));
                                }
                                throw postCreateError;
                            }
                        }
                    }

                    if (options.genesisMode === 'SEEDED' && Array.isArray(options.seededSources) && options.seededSources.length > 0) {
                        try {
                            await syncSeededSourcesWithRetry({
                                circleId: createdCircleId,
                                seededSources: options.seededSources,
                            });
                        } catch (seededError) {
                            const seededDecision = resolveSeededSourcesImportFailure();
                            console.warn('[useCreateCircle] sync seeded sources failed', seededError);
                            if (seededDecision.noticeKey) {
                                addCompletionNotice(t(seededDecision.noticeKey));
                            }
                        }
                    }

                    const postCreateChainSignatures = [flagsUpdateTx, forkAnchorTx].filter(
                        (sig): sig is string => typeof sig === 'string' && sig.length > 0,
                    );
                    if (postCreateChainSignatures.length > 0) {
                        const postCreateSlots = await Promise.all(
                            postCreateChainSignatures.map((sig) => waitForSignatureSlot(activeSdk.connection, sig)),
                        );
                        const resolvedPostCreateSlots = postCreateSlots.filter(
                            (slot): slot is number => typeof slot === 'number' && slot > 0,
                        );
                        const postCreateIndexedSlot = resolvedPostCreateSlots.length > 0
                            ? Math.max(...resolvedPostCreateSlots)
                            : null;
                        if (postCreateIndexedSlot !== null) {
                            const postCreateIndexWait = await waitForIndexedSlot(postCreateIndexedSlot);
                            if (!postCreateIndexWait.ok) {
                                addCompletionNotice(t('errors.indexerLagging'));
                            }
                        }
                    }
                };

                if (hasPostCreateSyncWork) {
                    const postCreateSyncResult = await runWalletActionBatch({
                        kind: 'circle_post_create_settings_sync',
                        source: 'create_circle_post_create_settings',
                        key: `circle_post_create_settings_sync:${createdCircleId}`,
                        expectedWalletPromptCount: expectedPostCreatePromptCount,
                        run: () => settleCreateCirclePostCreateSync(
                            syncPostCreateCircleSettings,
                            { timeoutMs: getCreateCirclePostCreateSyncTimeoutMs() },
                        ),
                    });

                    if (postCreateSyncResult.status === 'timeout') {
                        const timeoutDecision = resolvePostCreateSyncSettlement({
                            resultStatus: postCreateSyncResult.status,
                            hasPostCreatePatch,
                            hasPendingPostCreateSettings: Boolean(pendingPostCreateSettings),
                        });
                        console.warn('[useCreateCircle] post-create settings sync timed out');
                        if (timeoutDecision.postCreateSettingsStatus) {
                            postCreateSettingsStatus = timeoutDecision.postCreateSettingsStatus;
                        }
                        if (timeoutDecision.shouldPersistPendingPostCreateSettings) {
                            pendingPostCreateSettings = postCreatePatch;
                            savePendingPostCreateSettings({
                                circleId: createdCircleId,
                                patch: postCreatePatch,
                                createdAt: new Date().toISOString(),
                                reason: timeoutDecision.pendingReason ?? 'sync_failed',
                            });
                        }
                        if (timeoutDecision.noticeKey) {
                            addCompletionNotice(t(timeoutDecision.noticeKey));
                        }
                    } else if (postCreateSyncResult.status === 'failed') {
                        const failedDecision = resolvePostCreateSyncSettlement({
                            resultStatus: postCreateSyncResult.status,
                            hasPostCreatePatch,
                            hasPendingPostCreateSettings: Boolean(pendingPostCreateSettings),
                        });
                        console.warn('[useCreateCircle] post-create settings sync failed', postCreateSyncResult.error);
                        if (failedDecision.shouldPersistPendingPostCreateSettings) {
                            pendingPostCreateSettings = postCreatePatch;
                            savePendingPostCreateSettings({
                                circleId: createdCircleId,
                                patch: postCreatePatch,
                                createdAt: new Date().toISOString(),
                                reason: failedDecision.pendingReason ?? 'sync_failed',
                            });
                        }
                        if (failedDecision.noticeKey) {
                            addCompletionNotice(t(failedDecision.noticeKey));
                        }
                    }
                }

                return {
                    txSignature: tx,
                    circleId: createdCircleId,
                    notice: completionNotice,
                    indexed: circleVisible,
                    governanceBootstrapStatus,
                    postCreateSettingsStatus,
                    ...(pendingPostCreateSettings ? { pendingPostCreateSettings } : {}),
                };
            } catch (err: unknown) {
                const msg = normalizeCreateCircleError(err, t);
                setError(msg);
                console.error('[useCreateCircle]', err);
                return null;
            } finally {
                setSyncing(false);
                setLoading(false);
            }
        })();

        inFlightRef.current = run.finally(() => {
            inFlightRef.current = null;
        });
        return inFlightRef.current;
    }, [
        identityState,
        publicKey,
        runWalletAction,
        runWalletActionBatch,
        sdk,
        sessionUserPubkey,
        signMessage,
        signMessageForAction,
        t,
    ]);

    return { createCircle, clearNotice, loading, syncing, indexed, error, notice, txSignature };
}
