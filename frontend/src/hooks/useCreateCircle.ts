'use client';

import { useState, useCallback } from 'react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { waitForSignatureSlot, waitForIndexedSlot } from '@/lib/consistency/sync';
import {
    updateCircleGhostSettings,
    type CircleGhostSettings,
} from '@/lib/circles/ghostSettings';
import {
    updateCircleGenesisMode,
    type CircleGenesisMode,
} from '@/lib/circles/genesisMode';
import { updateCircleMetadata } from '@/lib/circles/metadata';
import {
    importSeededSources,
    type SeededSourceInput,
} from '@/lib/circles/seeded';
import { updateCircleJoinPolicy } from '@/lib/circles/membership';
import {
    updateCircleDraftWorkflowPolicy,
    updateCircleDraftLifecycleTemplate,
    type CircleDraftWorkflowPolicy,
    type CircleDraftLifecycleTemplatePatch,
} from '@/lib/circles/policyProfile';
import {
    getCreateCircleSignerUnavailableError,
    waitForCircleReadModelVisibility,
} from '@/lib/circles/createCircleFlow';
import { useI18n } from '@/i18n/useI18n';
import { getBrowserOnlyMockUnsupportedError } from '@/lib/testing/browserOnlyMockPolicy';

interface CreateCircleOptions {
    name: string;
    description?: string;
    level?: number;        // 默认 0 (Plaza)
    parentCircle?: number;
    kind?: 'main' | 'auxiliary';
    mode?: 'knowledge' | 'social';
    minCrystals?: number;
    accessType?: 'free' | 'crystal' | 'invite' | 'approval';
    genesisMode?: 'BLANK' | 'SEEDED';
    seededSources?: SeededSourceInput[];
    ghostSettings?: Partial<CircleGhostSettings>;
    draftLifecycleTemplate?: CircleDraftLifecycleTemplatePatch;
    draftWorkflowPolicy?: CircleDraftWorkflowPolicy;
    forkAnchor?: {
        sourceCircleId: number;
        forkDeclarationDigest: string | Uint8Array | number[];
    };
}

interface UseCreateCircleReturn {
    createCircle: (options: CreateCircleOptions) => Promise<{
        txSignature: string;
        circleId: number;
    } | null>;
    loading: boolean;
    syncing: boolean;
    indexed: boolean;
    error: string | null;
    txSignature: string | null;
}

function normalizeCreateCircleError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const logs = Array.isArray((error as any)?.logs) ? (error as any).logs.join(' ') : '';
    const message = `${raw} ${logs}`.toLowerCase();

    if (message.includes('wallet not connected') || message.includes('not connected')) {
        return '请先连接钱包再创建圈层。';
    }

    if (
        message.includes('user rejected') ||
        message.includes('user denied') ||
        message.includes('denied transaction') ||
        message.includes('rejected the request')
    ) {
        return '你取消了钱包签名，圈层未创建。';
    }

    if (message.includes('insufficient funds') || message.includes('insufficient lamports')) {
        return '钱包 SOL 余额不足，无法支付链上手续费。';
    }

    if (message.includes('constraintseeds') || message.includes('constraint seeds')) {
        return '圈层程序配置与当前网络不匹配（PDA 校验失败）。请检查 RPC 与 Program ID。';
    }

    if (
        message.includes('accountnotinitialized') ||
        message.includes('account does not exist') ||
        message.includes('could not find account') ||
        message.includes('not initialized')
    ) {
        return '圈层管理器尚未初始化，请先由管理员执行 initialize。';
    }

    if (
        message.includes('this transaction was reverted during simulation') ||
        message.includes('transaction simulation failed') ||
        message.includes('unknown error occurred') ||
        message.includes('custom program error')
    ) {
        return '交易模拟失败。请确认钱包网络与当前 RPC 一致，并检查圈层程序是否已正确部署与初始化。';
    }

    if (
        message.includes('accountnotfound') ||
        message.includes('attempt to debit an account but found no record of a prior credit') ||
        message.includes('no prior credit')
    ) {
        return '钱包余额不足或账户未激活，请先转入少量 SOL 后重试。';
    }

    return raw || '创建圈层失败';
}

function encodeCircleFlags(
    kind: 'main' | 'auxiliary',
    mode: 'knowledge' | 'social',
    minCrystals: number,
): BN {
    const kindBit = kind === 'auxiliary' ? 1 : 0;
    const modeBit = mode === 'social' ? 1 : 0;
    const boundedMinCrystals = Math.max(0, Math.min(Math.floor(minCrystals), 0xffff));
    const flags = kindBit | (modeBit << 1) | (boundedMinCrystals << 2);
    return new BN(flags);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncCircleGhostSettingsWithRetry(input: {
    circleId: number;
    settings: Partial<CircleGhostSettings>;
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    creationTxSignature?: string;
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 15);
    const delayMs = Math.max(200, input.delayMs ?? 1000);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await updateCircleGhostSettings(input.circleId, input.settings, {
                actorPubkey: input.actorPubkey,
                signMessage: input.signMessage,
                creationTxSignature: input.creationTxSignature,
            });
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

    throw lastError instanceof Error ? lastError : new Error('sync ghost settings failed');
}

async function syncCircleJoinPolicyWithRetry(input: {
    circleId: number;
    accessType: 'free' | 'crystal' | 'invite' | 'approval';
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 15);
    const delayMs = Math.max(200, input.delayMs ?? 1000);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await updateCircleJoinPolicy(input.circleId, {
                accessType: input.accessType,
            }, {
                actorPubkey: input.actorPubkey,
                signMessage: input.signMessage,
            });
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

    throw lastError instanceof Error ? lastError : new Error('sync join policy failed');
}

async function syncCircleGenesisModeWithRetry(input: {
    circleId: number;
    genesisMode: CircleGenesisMode;
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 15);
    const delayMs = Math.max(200, input.delayMs ?? 1000);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await updateCircleGenesisMode(input.circleId, input.genesisMode, {
                actorPubkey: input.actorPubkey,
                signMessage: input.signMessage,
            });
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

    throw lastError instanceof Error ? lastError : new Error('sync genesis mode failed');
}

async function syncCircleMetadataWithRetry(input: {
    circleId: number;
    description?: string | null;
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 15);
    const delayMs = Math.max(200, input.delayMs ?? 1000);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await updateCircleMetadata(input.circleId, {
                description: input.description ?? null,
            }, {
                actorPubkey: input.actorPubkey,
                signMessage: input.signMessage,
            });
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

    throw lastError instanceof Error ? lastError : new Error('sync circle metadata failed');
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

async function syncCircleDraftLifecycleTemplateWithRetry(input: {
    circleId: number;
    template: CircleDraftLifecycleTemplatePatch;
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 15);
    const delayMs = Math.max(200, input.delayMs ?? 1000);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await updateCircleDraftLifecycleTemplate(input.circleId, input.template, {
                actorPubkey: input.actorPubkey,
                signMessage: input.signMessage,
            });
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

    throw lastError instanceof Error ? lastError : new Error('sync draft lifecycle template failed');
}

async function syncCircleDraftWorkflowPolicyWithRetry(input: {
    circleId: number;
    policy: CircleDraftWorkflowPolicy;
    actorPubkey: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 15);
    const delayMs = Math.max(200, input.delayMs ?? 1000);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await updateCircleDraftWorkflowPolicy(input.circleId, input.policy, {
                actorPubkey: input.actorPubkey,
                signMessage: input.signMessage,
            });
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

    throw lastError instanceof Error ? lastError : new Error('sync draft workflow policy failed');
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
    const t = useI18n('CreateCircleFlow');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [indexed, setIndexed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);

    const createCircle = useCallback(async (options: CreateCircleOptions): Promise<{
        txSignature: string;
        circleId: number;
    } | null> => {
        const isE2EMockMode = process.env.NEXT_PUBLIC_E2E_WALLET_MOCK === '1';

        if (!publicKey) {
            setError('请先连接钱包');
            return null;
        }
        if (isE2EMockMode) {
            setError(getBrowserOnlyMockUnsupportedError('create_circle'));
            return null;
        }
        if (!sdk) {
            setError('请先连接钱包');
            return null;
        }

        const signerUnavailableError = getCreateCircleSignerUnavailableError(signMessage);
        if (signerUnavailableError) {
            setError(signerUnavailableError);
            return null;
        }

        setLoading(true);
        setSyncing(false);
        setIndexed(false);
        setError(null);
        setTxSignature(null);

        try {
            if (options.parentCircle !== undefined && (options.parentCircle < 0 || options.parentCircle > 255)) {
                throw new Error('parentCircle 超出链上 u8 范围 (0-255)');
            }

            const targetKind = options.kind ?? 'main';
            const targetMode = options.mode ?? 'knowledge';
            const targetMinCrystals = options.minCrystals ?? 0;
            let tx: string | null = null;
            let createdCircleId: number | null = null;
            let e2eSignatureSlot: number | null = null;

            const activeSdk = sdk;
            if (!activeSdk) {
                throw new Error('请先连接钱包。');
            }

            const payer = activeSdk.provider.publicKey;
            if (!payer) {
                throw new Error('钱包未连接，无法签名交易。');
            }

            const payerAccount = await activeSdk.connection.getAccountInfo(payer);
            if (!payerAccount) {
                throw new Error(
                    `当前钱包 ${payer.toBase58()} 账户不存在或未激活`,
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
                    `圈层程序未部署到当前 RPC（${activeSdk.connection.rpcEndpoint}）。请检查 NEXT_PUBLIC_SOLANA_RPC_URL / NEXT_PUBLIC_CIRCLES_PROGRAM_ID。`,
                );
            }

            if (!managerAccount) {
                throw new Error(
                    `圈层管理器未初始化（${circleManagerPda.toBase58()}）。请先由管理员执行 circles.initialize()。`,
                );
            }

            if (!eventProgramAccount?.executable) {
                throw new Error(
                    `事件程序未部署到当前 RPC（${activeSdk.connection.rpcEndpoint}）。请检查 NEXT_PUBLIC_EVENT_PROGRAM_ID。`,
                );
            }

            if (!eventEmitterAccount) {
                throw new Error(
                    `事件发射器未初始化（${eventEmitterPda.toBase58()}）。请先执行 initialize_event_emitter。`,
                );
            }

            const nextCircleId = () => ((Date.now() + Math.floor(Math.random() * 10_000)) % 255) + 1;
            let lastError: Error | null = null;

            for (let attempt = 0; attempt < 4; attempt += 1) {
                const circleId = nextCircleId();
                try {
                    tx = await activeSdk.circles.createCircle({
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
                        decisionEngine: {
                            votingGovernance: {
                                minVotes: new BN(1),
                                voteDuration: new BN(86400),
                                quorumPercentage: 50,
                            },
                        },
                    });
                    createdCircleId = circleId;
                    break;
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error('创建圈层失败');
                    const message = String(lastError.message || '').toLowerCase();
                    const isCollision =
                        message.includes('already in use')
                        || message.includes('already exists')
                        || message.includes('account in use');
                    if (!isCollision) {
                        throw lastError;
                    }
                }
            }

            if (!tx) {
                throw lastError || new Error('创建圈层失败：未能分配可用的 circle_id');
            }

            if (createdCircleId === null) {
                throw new Error('创建圈层失败：未获取圈层 ID');
            }

            const targetFlags = encodeCircleFlags(targetKind, targetMode, targetMinCrystals);
            const needFlagUpdate =
                targetKind !== 'main' ||
                targetMode !== 'knowledge' ||
                targetMinCrystals > 0;

            let flagsUpdateTx: string | null = null;
            if (needFlagUpdate) {
                const circlesModule = activeSdk.circles as any;
                const [circlePda] = PublicKey.findProgramAddressSync(
                    [new TextEncoder().encode('circle'), Uint8Array.of(createdCircleId)],
                    activeSdk.circles.programId,
                );

                const eventAccounts = await circlesModule.resolveEventAccounts();
                flagsUpdateTx = await circlesModule.program.methods
                    .updateCircleFlags(targetFlags)
                    .accounts({
                        circle: circlePda,
                        authority: payer,
                        eventProgram: eventAccounts.eventProgram,
                        eventEmitter: eventAccounts.eventEmitter,
                        eventBatch: eventAccounts.eventBatch,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
            }

            let forkAnchorTx: string | null = null;
            if (options.forkAnchor) {
                try {
                    forkAnchorTx = await (activeSdk.circles as any).anchorCircleFork({
                        sourceCircleId: options.forkAnchor.sourceCircleId,
                        targetCircleId: createdCircleId,
                        forkDeclarationDigest: options.forkAnchor.forkDeclarationDigest,
                    });
                } catch (anchorError) {
                    console.warn('[useCreateCircle] anchor fork failed', anchorError);
                    setError((prev) =>
                        prev
                            ? `${prev} Fork 轻锚点写入失败，可稍后补写。`
                            : '圈层已创建，但 Fork 轻锚点写入失败，可稍后补写。',
                    );
                }
            }

            const signaturesToTrack = [tx, flagsUpdateTx, forkAnchorTx].filter(
                (sig): sig is string => typeof sig === 'string' && sig.length > 0,
            );
            const signatureSlots = await Promise.all(
                signaturesToTrack.map((sig) => waitForSignatureSlot(activeSdk.connection, sig)),
            );
            const resolvedSlots = signatureSlots.filter(
                (slot): slot is number => typeof slot === 'number' && slot > 0,
            );
            e2eSignatureSlot = resolvedSlots.length > 0 ? Math.max(...resolvedSlots) : null;

            setTxSignature(tx);

            setSyncing(true);
            const targetIndexedSlot = e2eSignatureSlot;

            if (targetIndexedSlot !== null) {
                const indexWait = await waitForIndexedSlot(targetIndexedSlot);
                if (!indexWait.ok) {
                    setError('交易已上链，但索引尚未追平，稍后刷新可见。');
                }
            } else {
                setError('交易已提交，暂未获取确认槽位。');
            }

            const circleVisible = await waitForCircleReadModelVisibility({
                circleId: createdCircleId,
            });
            setIndexed(circleVisible);
            if (!circleVisible) {
                setError((prev) =>
                    prev
                        ? `${prev} 新圈层暂未出现在圈层列表读模型中，稍后刷新可见。`
                        : '圈层已创建，但新圈层暂未出现在圈层列表读模型中，稍后刷新可见。',
                );
                return {
                    txSignature: tx,
                    circleId: createdCircleId,
                };
            }

            if (
                typeof options.description === 'string'
                && options.description.trim().length > 0
            ) {
                try {
                    if (!publicKey || !signMessage) {
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    await syncCircleMetadataWithRetry({
                        circleId: createdCircleId,
                        description: options.description,
                        actorPubkey: publicKey.toBase58(),
                        signMessage,
                    });
                } catch (metadataError) {
                    console.warn('[useCreateCircle] sync circle metadata failed', metadataError);
                    setError((prev) =>
                        prev
                            ? `${prev} ${t('errors.metadataSyncFailedSuffix')}`
                            : t('errors.metadataSyncFailed'),
                    );
                }
            }

            if (
                options.ghostSettings
                && Object.keys(options.ghostSettings).length > 0
            ) {
                try {
                    if (!publicKey || !signMessage) {
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    await syncCircleGhostSettingsWithRetry({
                        circleId: createdCircleId,
                        settings: options.ghostSettings,
                        actorPubkey: publicKey.toBase58(),
                        signMessage,
                        creationTxSignature: tx,
                    });
                } catch (ghostError) {
                    console.warn('[useCreateCircle] save ghost settings failed', ghostError);
                    setError((prev) =>
                        prev
                            ? `${prev} AI配置保存失败，可在圈层设置页重试。`
                            : '圈层已创建，但 AI 配置保存失败，可在圈层设置页重试。',
                    );
                }
            }

            try {
                if (!publicKey || !signMessage) {
                    throw new Error('wallet_sign_message_unavailable');
                }
                if (options.genesisMode) {
                    await syncCircleGenesisModeWithRetry({
                        circleId: createdCircleId,
                        genesisMode: options.genesisMode,
                        actorPubkey: publicKey.toBase58(),
                        signMessage,
                    });
                } else {
                    await syncCircleGenesisModeWithRetry({
                        circleId: createdCircleId,
                        genesisMode: 'BLANK',
                        actorPubkey: publicKey.toBase58(),
                        signMessage,
                    });
                }
            } catch (genesisError) {
                console.warn('[useCreateCircle] sync genesis mode failed', genesisError);
                setError((prev) =>
                    prev
                        ? `${prev} 内容起点保存失败，可在圈层设置页重试。`
                        : '圈层已创建，但内容起点保存失败，可在圈层设置页重试。',
                );
            }

            if (options.genesisMode === 'SEEDED' && Array.isArray(options.seededSources) && options.seededSources.length > 0) {
                try {
                    await syncSeededSourcesWithRetry({
                        circleId: createdCircleId,
                        seededSources: options.seededSources,
                    });
                } catch (seededError) {
                    console.warn('[useCreateCircle] sync seeded sources failed', seededError);
                    setError((prev) =>
                        prev
                            ? `${prev} Seeded 源文件导入失败，可稍后重试。`
                            : '圈层已创建，但 Seeded 源文件导入失败，可稍后重试。',
                    );
                }
            }

            try {
                if (!publicKey || !signMessage) {
                    throw new Error('wallet_sign_message_unavailable');
                }
                const effectiveAccessType =
                    options.accessType
                    || (options.minCrystals && options.minCrystals > 0 ? 'crystal' : 'free');
                await syncCircleJoinPolicyWithRetry({
                    circleId: createdCircleId,
                    accessType: effectiveAccessType,
                    actorPubkey: publicKey.toBase58(),
                    signMessage,
                });
            } catch (policyError) {
                console.warn('[useCreateCircle] sync join policy failed', policyError);
                setError((prev) =>
                    prev
                        ? `${prev} 准入策略同步失败，可在圈层设置页重试。`
                        : '圈层已创建，但准入策略同步失败，可在圈层设置页重试。',
                );
            }

            if (options.draftLifecycleTemplate) {
                try {
                    if (!publicKey || !signMessage) {
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    await syncCircleDraftLifecycleTemplateWithRetry({
                        circleId: createdCircleId,
                        template: options.draftLifecycleTemplate,
                        actorPubkey: publicKey.toBase58(),
                        signMessage,
                    });
                } catch (policyError) {
                    console.warn('[useCreateCircle] sync draft lifecycle template failed', policyError);
                    setError((prev) =>
                        prev
                            ? `${prev} 草稿流程设置保存失败，可在圈层设置页重试。`
                            : '圈层已创建，但草稿流程设置保存失败，可在圈层设置页重试。',
                    );
                }
            }

            if (options.draftWorkflowPolicy) {
                try {
                    if (!publicKey || !signMessage) {
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    await syncCircleDraftWorkflowPolicyWithRetry({
                        circleId: createdCircleId,
                        policy: options.draftWorkflowPolicy,
                        actorPubkey: publicKey.toBase58(),
                        signMessage,
                    });
                } catch (policyError) {
                    console.warn('[useCreateCircle] sync draft workflow policy failed', policyError);
                    setError((prev) =>
                        prev
                            ? `${prev} 问题单与阶段权限保存失败，可在圈层设置页重试。`
                            : '圈层已创建，但问题单与阶段权限保存失败，可在圈层设置页重试。',
                    );
                }
            }

            return {
                txSignature: tx,
                circleId: createdCircleId,
            };
        } catch (err: unknown) {
            const msg = normalizeCreateCircleError(err);
            setError(msg);
            console.error('[useCreateCircle]', err);
            return null;
        } finally {
            setSyncing(false);
            setLoading(false);
        }
    }, [sdk, publicKey, signMessage]);

    return { createCircle, loading, syncing, indexed, error, txSignature };
}
