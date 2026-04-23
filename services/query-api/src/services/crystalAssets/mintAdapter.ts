import crypto from 'crypto';

import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    ExtensionType,
    TOKEN_2022_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    createInitializeMintInstruction,
    createInitializeNonTransferableMintInstruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    getMintLen,
} from '@solana/spl-token';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import {
    loadCrystalMintRuntimeConfig,
    type CrystalMintAdapterMode,
    type CrystalMintRuntimeConfig,
} from '../../config/services';

export interface IssueMasterCrystalAssetInput {
    knowledgeRowId: number;
    knowledgePublicId: string;
    circleId: number;
    ownerPubkey: string;
    title: string;
    description: string | null;
    proofPackageHash: string;
    sourceAnchorId: string;
    contributorsRoot: string;
    contributorsCount: number;
    crystalParams?: Record<string, unknown> | null;
}

export interface IssueCrystalReceiptInput {
    entitlementId: number;
    knowledgeRowId: number;
    knowledgePublicId: string;
    circleId: number;
    ownerPubkey: string;
    contributionRole: string;
    contributionWeightBps: number;
    proofPackageHash: string;
    sourceAnchorId: string;
    contributorsRoot: string;
    contributorsCount: number;
}

export interface CrystalMintOutcome {
    assetAddress: string;
    assetStandard: string;
    metadataUri: string | null;
    mintedAt: Date;
}

export interface CrystalMintAdapter {
    readonly mode: Exclude<CrystalMintAdapterMode, 'disabled'>;
    issueMasterAsset(input: IssueMasterCrystalAssetInput): Promise<CrystalMintOutcome>;
    issueReceipt(input: IssueCrystalReceiptInput): Promise<CrystalMintOutcome>;
}

function trimOrNull(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
}

function buildDataUri(payload: Record<string, unknown>): string {
    return `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
}

function buildMetadataUri(
    config: CrystalMintRuntimeConfig,
    input: {
        kind: 'master' | 'receipt';
        knowledgePublicId: string;
        ownerPubkey?: string;
        payload: Record<string, unknown>;
    },
): string {
    const baseUrl = trimOrNull(config.metadataBaseUrl);
    if (!baseUrl) {
        return buildDataUri(input.payload);
    }

    const normalizedBase = baseUrl.replace(/\/+$/, '');
    if (input.kind === 'master') {
        return `${normalizedBase}/crystals/${encodeURIComponent(input.knowledgePublicId)}/master.json`;
    }
    return `${normalizedBase}/crystals/${encodeURIComponent(input.knowledgePublicId)}/receipts/${encodeURIComponent(input.ownerPubkey || 'unknown')}.json`;
}

function buildMockAddress(scope: 'master' | 'receipt', entropy: string): string {
    const digest = crypto.createHash('sha256').update(`${scope}:${entropy}`).digest('hex');
    return `mock_${scope}_${digest.slice(0, 48)}`;
}

export function resolveMasterAssetOwnerPubkey(
    config: CrystalMintRuntimeConfig,
    fallbackOwnerPubkey: string,
): string {
    return trimOrNull(config.masterOwnerPubkey) || trimOrNull(fallbackOwnerPubkey) || fallbackOwnerPubkey;
}

function createMockChainCrystalMintAdapter(config: CrystalMintRuntimeConfig): CrystalMintAdapter {
    return {
        mode: 'mock_chain',
        async issueMasterAsset(input) {
            const ownerPubkey = resolveMasterAssetOwnerPubkey(config, input.ownerPubkey);
            const metadataUri = buildMetadataUri(config, {
                kind: 'master',
                knowledgePublicId: input.knowledgePublicId,
                payload: {
                    kind: 'master',
                    knowledgePublicId: input.knowledgePublicId,
                    title: input.title,
                    description: input.description,
                    ownerPubkey,
                    proofPackageHash: input.proofPackageHash,
                    sourceAnchorId: input.sourceAnchorId,
                    contributorsRoot: input.contributorsRoot,
                    contributorsCount: input.contributorsCount,
                    crystalParams: input.crystalParams || null,
                },
            });
            return {
                assetAddress: buildMockAddress('master', `${input.knowledgeRowId}:${ownerPubkey}`),
                assetStandard: 'mock_chain_master',
                metadataUri,
                mintedAt: new Date(),
            };
        },
        async issueReceipt(input) {
            const metadataUri = buildMetadataUri(config, {
                kind: 'receipt',
                knowledgePublicId: input.knowledgePublicId,
                ownerPubkey: input.ownerPubkey,
                payload: {
                    kind: 'receipt',
                    entitlementId: input.entitlementId,
                    knowledgePublicId: input.knowledgePublicId,
                    ownerPubkey: input.ownerPubkey,
                    contributionRole: input.contributionRole,
                    contributionWeightBps: input.contributionWeightBps,
                    proofPackageHash: input.proofPackageHash,
                    sourceAnchorId: input.sourceAnchorId,
                    contributorsRoot: input.contributorsRoot,
                    contributorsCount: input.contributorsCount,
                },
            });
            return {
                assetAddress: buildMockAddress('receipt', `${input.entitlementId}:${input.ownerPubkey}`),
                assetStandard: 'mock_chain_receipt',
                metadataUri,
                mintedAt: new Date(),
            };
        },
    };
}

function parseAuthoritySecret(raw: string | null): Uint8Array {
    const normalized = trimOrNull(raw);
    if (!normalized) {
        throw new Error('missing_crystal_mint_authority_secret');
    }

    if (normalized.startsWith('[')) {
        const parsed = JSON.parse(normalized);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('invalid_crystal_mint_authority_secret');
        }
        return Uint8Array.from(parsed.map((value) => Number(value)));
    }

    return bs58.decode(normalized);
}

function createToken2022LocalCrystalMintAdapter(config: CrystalMintRuntimeConfig): CrystalMintAdapter {
    const rpcUrl = trimOrNull(config.rpcUrl);
    if (!rpcUrl) {
        throw new Error('missing_crystal_mint_rpc_url');
    }
    const authority = Keypair.fromSecretKey(parseAuthoritySecret(config.authoritySecret));
    const connection = new Connection(rpcUrl, 'confirmed');

    async function issueMint(input: {
        ownerPubkey: string;
        metadataUri: string;
        nonTransferable: boolean;
        assetStandard: string;
    }): Promise<CrystalMintOutcome> {
        const owner = new PublicKey(input.ownerPubkey);
        const mint = Keypair.generate();
        const extensions = input.nonTransferable ? [ExtensionType.NonTransferable] : [];
        const mintLength = getMintLen(extensions);
        const lamports = await connection.getMinimumBalanceForRentExemption(mintLength);
        const ownerAta = getAssociatedTokenAddressSync(
            mint.publicKey,
            owner,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const transaction = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: authority.publicKey,
                newAccountPubkey: mint.publicKey,
                space: mintLength,
                lamports,
                programId: TOKEN_2022_PROGRAM_ID,
            }),
        );

        if (input.nonTransferable) {
            transaction.add(
                createInitializeNonTransferableMintInstruction(
                    mint.publicKey,
                    TOKEN_2022_PROGRAM_ID,
                ),
            );
        }

        transaction.add(
            createInitializeMintInstruction(
                mint.publicKey,
                0,
                authority.publicKey,
                authority.publicKey,
                TOKEN_2022_PROGRAM_ID,
            ),
            createAssociatedTokenAccountIdempotentInstruction(
                authority.publicKey,
                ownerAta,
                owner,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
            createMintToInstruction(
                mint.publicKey,
                ownerAta,
                authority.publicKey,
                1,
                [],
                TOKEN_2022_PROGRAM_ID,
            ),
        );

        await sendAndConfirmTransaction(connection, transaction, [authority, mint], {
            commitment: 'confirmed',
        });

        return {
            assetAddress: mint.publicKey.toBase58(),
            assetStandard: input.assetStandard,
            metadataUri: input.metadataUri,
            mintedAt: new Date(),
        };
    }

    return {
        mode: 'token2022_local',
        async issueMasterAsset(input) {
            const ownerPubkey = resolveMasterAssetOwnerPubkey(config, input.ownerPubkey);
            const metadataUri = buildMetadataUri(config, {
                kind: 'master',
                knowledgePublicId: input.knowledgePublicId,
                payload: {
                    kind: 'master',
                    knowledgePublicId: input.knowledgePublicId,
                    title: input.title,
                    description: input.description,
                    ownerPubkey,
                    proofPackageHash: input.proofPackageHash,
                    sourceAnchorId: input.sourceAnchorId,
                    contributorsRoot: input.contributorsRoot,
                    contributorsCount: input.contributorsCount,
                    crystalParams: input.crystalParams || null,
                },
            });
            return issueMint({
                ownerPubkey,
                metadataUri,
                nonTransferable: false,
                assetStandard: 'token2022_master_nft',
            });
        },
        async issueReceipt(input) {
            const metadataUri = buildMetadataUri(config, {
                kind: 'receipt',
                knowledgePublicId: input.knowledgePublicId,
                ownerPubkey: input.ownerPubkey,
                payload: {
                    kind: 'receipt',
                    entitlementId: input.entitlementId,
                    knowledgePublicId: input.knowledgePublicId,
                    ownerPubkey: input.ownerPubkey,
                    contributionRole: input.contributionRole,
                    contributionWeightBps: input.contributionWeightBps,
                    proofPackageHash: input.proofPackageHash,
                    sourceAnchorId: input.sourceAnchorId,
                    contributorsRoot: input.contributorsRoot,
                    contributorsCount: input.contributorsCount,
                },
            });
            return issueMint({
                ownerPubkey: input.ownerPubkey,
                metadataUri,
                nonTransferable: true,
                assetStandard: 'token2022_non_transferable_receipt',
            });
        },
    };
}

export function createCrystalMintAdapter(
    config: CrystalMintRuntimeConfig = loadCrystalMintRuntimeConfig(),
): CrystalMintAdapter | null {
    if (config.adapterMode === 'disabled') {
        return null;
    }
    if (config.adapterMode === 'mock_chain') {
        return createMockChainCrystalMintAdapter(config);
    }
    return createToken2022LocalCrystalMintAdapter(config);
}
