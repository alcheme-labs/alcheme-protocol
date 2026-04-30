import crypto from 'crypto';

import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    ExtensionType,
    LENGTH_SIZE,
    TOKEN_2022_PROGRAM_ID,
    TYPE_SIZE,
    createAssociatedTokenAccountIdempotentInstruction,
    createInitializeMintInstruction,
    createInitializeMetadataPointerInstruction,
    createInitializeNonTransferableMintInstruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    getMintLen,
} from '@solana/spl-token';
import {
    createInitializeInstruction as createInitializeTokenMetadataInstruction,
    createUpdateFieldInstruction as createUpdateTokenMetadataFieldInstruction,
    pack as packTokenMetadata,
    type TokenMetadata,
} from '@solana/spl-token-metadata';
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
    readonly mode: CrystalMintAdapterMode;
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

function truncateMetadataText(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : value.slice(0, maxLength);
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
        name: string;
        symbol: string;
        additionalMetadata: Array<readonly [string, string]>;
        nonTransferable: boolean;
        assetStandard: string;
    }): Promise<CrystalMintOutcome> {
        const owner = new PublicKey(input.ownerPubkey);
        const mint = Keypair.generate();
        const extensions = [
            ExtensionType.MetadataPointer,
            ...(input.nonTransferable ? [ExtensionType.NonTransferable] : []),
        ];
        const tokenMetadata: TokenMetadata = {
            updateAuthority: authority.publicKey,
            mint: mint.publicKey,
            name: truncateMetadataText(input.name, 64),
            symbol: truncateMetadataText(input.symbol, 10),
            uri: input.metadataUri,
            additionalMetadata: input.additionalMetadata,
        };
        const mintLength = getMintLen(extensions);
        const metadataLength = TYPE_SIZE + LENGTH_SIZE + packTokenMetadata(tokenMetadata).length;
        const accountLength = mintLength + metadataLength;
        const lamports = await connection.getMinimumBalanceForRentExemption(accountLength);
        const ownerAta = getAssociatedTokenAddressSync(
            mint.publicKey,
            owner,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const initTransaction = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: authority.publicKey,
                newAccountPubkey: mint.publicKey,
                space: accountLength,
                lamports,
                programId: TOKEN_2022_PROGRAM_ID,
            }),
            createInitializeMetadataPointerInstruction(
                mint.publicKey,
                authority.publicKey,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID,
            ),
        );

        if (input.nonTransferable) {
            initTransaction.add(
                createInitializeNonTransferableMintInstruction(
                    mint.publicKey,
                    TOKEN_2022_PROGRAM_ID,
                ),
            );
        }

        initTransaction.add(
            createInitializeMintInstruction(
                mint.publicKey,
                0,
                authority.publicKey,
                authority.publicKey,
                TOKEN_2022_PROGRAM_ID,
            ),
            createInitializeTokenMetadataInstruction({
                programId: TOKEN_2022_PROGRAM_ID,
                metadata: mint.publicKey,
                updateAuthority: authority.publicKey,
                mint: mint.publicKey,
                mintAuthority: authority.publicKey,
                name: tokenMetadata.name,
                symbol: tokenMetadata.symbol,
                uri: input.metadataUri,
            }),
        );

        await sendAndConfirmTransaction(connection, initTransaction, [authority, mint], {
            commitment: 'confirmed',
        });

        for (const [field, value] of input.additionalMetadata) {
            const metadataTransaction = new Transaction().add(
                createUpdateTokenMetadataFieldInstruction({
                    programId: TOKEN_2022_PROGRAM_ID,
                    metadata: mint.publicKey,
                    updateAuthority: authority.publicKey,
                    field,
                    value,
                }),
            );
            await sendAndConfirmTransaction(connection, metadataTransaction, [authority], {
                commitment: 'confirmed',
            });
        }

        const mintTransaction = new Transaction().add(
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

        await sendAndConfirmTransaction(connection, mintTransaction, [authority], {
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
                name: input.title || `Alcheme Crystal ${input.knowledgePublicId}`,
                symbol: 'ALCH-X',
                additionalMetadata: [
                    ['kind', 'master'],
                    ['knowledge_id', input.knowledgePublicId],
                    ['proof_hash', input.proofPackageHash],
                    ['source_anchor', input.sourceAnchorId],
                    ['contributors_root', input.contributorsRoot],
                ],
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
                name: `Alcheme Receipt ${input.knowledgePublicId}`,
                symbol: 'ALCH-R',
                additionalMetadata: [
                    ['kind', 'receipt'],
                    ['knowledge_id', input.knowledgePublicId],
                    ['entitlement_id', String(input.entitlementId)],
                    ['role', input.contributionRole],
                    ['weight_bps', String(input.contributionWeightBps)],
                    ['proof_hash', input.proofPackageHash],
                ],
                nonTransferable: true,
                assetStandard: 'token2022_non_transferable_receipt',
            });
        },
    };
}

export function createCrystalMintAdapter(
    config: CrystalMintRuntimeConfig = loadCrystalMintRuntimeConfig(),
): CrystalMintAdapter {
    if (config.adapterMode === 'mock_chain') {
        return createMockChainCrystalMintAdapter(config);
    }
    return createToken2022LocalCrystalMintAdapter(config);
}
