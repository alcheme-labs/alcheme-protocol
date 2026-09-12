import type { PrismaClient } from '@prisma/client';
import { Connection } from '@solana/web3.js';

import type { AppLocale } from '../../../i18n/locale';
import {
    resolveAnchoredInteractionDisplaySnapshots,
    snapshotToDisplayPayloadFields,
    snapshotToMetadata,
    snapshotToPrismaData,
} from './displaySnapshots';

type AnchoredInteractionPrisma = PrismaClient | any;
const LAMPORTS_PER_SOL_BIGINT = BigInt(1_000_000_000);
const ZERO_LAMPORTS = BigInt(0);

export type AnchoredInteractionReceiptStatus = 'pending' | 'confirmed' | 'failed' | 'unverified';

export interface AnchoredInteractionReceiptVerificationResult {
    status: AnchoredInteractionReceiptStatus;
    reasonCode?: string;
}

export interface AnchoredInteractionTransactionVerifier {
    verify(input: {
        signature: string | null;
        assetType: string | null;
        mint: string | null;
        amount: string | null;
        actorPubkey: string | null;
        recipientPubkey: string | null;
    }): Promise<AnchoredInteractionReceiptVerificationResult>;
}

interface SolanaParsedTransactionConnection {
    getParsedTransaction(
        signature: string,
        config?: Record<string, unknown>,
    ): Promise<any | null>;
}

export class AnchoredInteractionReceiptError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode = 400,
    ) {
        super(code);
    }
}

export interface AnchoredInteractionReceiptDto {
    receiptId: string;
    interactionId: string;
    circleId: number;
    receiptType: string;
    status: AnchoredInteractionReceiptStatus;
    actorPubkey: string;
    actorDisplaySnapshot?: string | null;
    actorDisplaySourceSnapshot?: string | null;
    actorDisplayCircleIdSnapshot?: number | null;
    actorInheritedFromCircleIdSnapshot?: number | null;
    actorDisplaySnapshotAt?: string | null;
    actorAliasSnapshot?: string | null;
    recipientPubkey: string | null;
    recipientDisplaySnapshot?: string | null;
    recipientDisplaySourceSnapshot?: string | null;
    recipientDisplayCircleIdSnapshot?: number | null;
    recipientInheritedFromCircleIdSnapshot?: number | null;
    recipientDisplaySnapshotAt?: string | null;
    recipientAliasSnapshot?: string | null;
    assetType: string | null;
    mint: string | null;
    amount: string | null;
    signature: string | null;
    metadata: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
}

export async function recordAnchoredInteractionReceipt(
    prisma: AnchoredInteractionPrisma,
    input: {
        interaction: {
            interactionId: string;
            circleId: number;
            interactionType: string;
        };
        actorPubkey: string;
        eventKind: string;
        payload: Record<string, unknown>;
        verifier?: AnchoredInteractionTransactionVerifier;
        locale?: AppLocale | string;
    },
): Promise<{
    receipt: AnchoredInteractionReceiptDto;
    eventPayload: Record<string, unknown>;
}> {
    const normalized = normalizeReceiptInput(input);
    const existing = await findExistingReceipt(prisma, input, normalized);
    if (existing) {
        assertReceiptActorMatches(existing, input.actorPubkey);
        const receipt = toReceiptDto(existing);
        return {
            receipt,
            eventPayload: buildReceiptEventPayload(receipt),
        };
    }

    const verification = await verifyReceipt(normalized, input.actorPubkey, input.verifier);
    if (verification.status === 'failed') {
        throw new AnchoredInteractionReceiptError(verification.reasonCode || 'receipt_verification_failed');
    }
    const status: AnchoredInteractionReceiptStatus = normalized.requestedStatus === 'failed'
        ? 'failed'
        : verification.status;
    const displaySnapshots = await resolveAnchoredInteractionDisplaySnapshots(prisma, {
        circleId: input.interaction.circleId,
        actorPubkey: input.actorPubkey,
        recipientPubkey: normalized.recipientPubkey,
        locale: input.locale,
    });

    let created: unknown;
    try {
        created = await prisma.discussionAnchoredInteractionReceipt.create({
            data: {
                receiptId: normalized.receiptId,
                interactionId: input.interaction.interactionId,
                circleId: input.interaction.circleId,
                receiptType: normalized.receiptType,
                status,
                actorPubkey: input.actorPubkey,
                ...snapshotToPrismaData('actor', displaySnapshots.actor),
                recipientPubkey: normalized.recipientPubkey,
                ...snapshotToPrismaData('recipient', displaySnapshots.recipient),
                assetType: normalized.assetType,
                mint: normalized.mint,
                amount: normalized.amount,
                signature: normalized.signature,
                metadata: {
                    verificationReasonCode: verification.reasonCode || null,
                    eventKind: input.eventKind,
                    displaySnapshots: {
                        actor: snapshotToMetadata(displaySnapshots.actor),
                        recipient: snapshotToMetadata(displaySnapshots.recipient),
                    },
                },
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const concurrentExisting = await findExistingReceipt(prisma, input, normalized);
        if (!concurrentExisting) throw error;
        assertReceiptActorMatches(concurrentExisting, input.actorPubkey);
        const receipt = toReceiptDto(concurrentExisting);
        return {
            receipt,
            eventPayload: buildReceiptEventPayload(receipt),
        };
    }
    const receipt = toReceiptDto(created);
    return {
        receipt,
        eventPayload: buildReceiptEventPayload(receipt),
    };
}

export function createSolanaRpcReceiptVerifier(
    connection: SolanaParsedTransactionConnection,
): AnchoredInteractionTransactionVerifier {
    return {
        async verify(input) {
            if (input.assetType !== 'SOL') {
                return { status: 'unverified', reasonCode: 'unsupported_asset_verifier' };
            }
            if (!input.signature) {
                return { status: 'pending', reasonCode: 'missing_signature' };
            }
            const expectedLamports = parseSolAmountToLamports(input.amount);
            if (!expectedLamports || !input.actorPubkey || !input.recipientPubkey) {
                return { status: 'failed', reasonCode: 'invalid_expected_transfer' };
            }
            const transaction = await connection.getParsedTransaction(input.signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });
            if (!transaction) {
                return { status: 'pending', reasonCode: 'transaction_not_found' };
            }
            if (transaction.meta?.err) {
                return { status: 'failed', reasonCode: 'transaction_failed' };
            }
            if (hasMatchingSolTransfer(transaction, input.actorPubkey, input.recipientPubkey, expectedLamports)) {
                return { status: 'confirmed' };
            }
            return { status: 'failed', reasonCode: 'transfer_mismatch' };
        },
    };
}

export function createSolanaRpcReceiptVerifierFromEnv(
    env: NodeJS.ProcessEnv = process.env,
): AnchoredInteractionTransactionVerifier | undefined {
    const rpcUrl = firstNonEmptyString(
        env.ANCHORED_INTERACTION_RECEIPT_RPC_URL,
        env.SOLANA_RPC_URL,
        env.RPC_URL,
        env.NEXT_PUBLIC_SOLANA_RPC_URL,
    );
    if (!rpcUrl) return undefined;
    return createSolanaRpcReceiptVerifier(new Connection(rpcUrl, 'confirmed'));
}

function normalizeReceiptInput(input: {
    interaction: { interactionType: string };
    eventKind: string;
    payload: Record<string, unknown>;
}) {
    const receiptId = requiredString(input.payload.receiptId, 'invalid_receipt_id');
    const signature = optionalString(input.payload.signature);
    const recipientPubkey = requiredString(input.payload.recipientPubkey, 'invalid_receipt_recipient');
    const amount = requiredString(input.payload.amount, 'invalid_receipt_amount');
    const assetType = requiredString(input.payload.assetType, 'invalid_receipt_asset');
    const mint = optionalString(input.payload.mint);
    const requestedStatus = normalizeRequestedStatus(input.payload.status);
    return {
        receiptId,
        signature,
        recipientPubkey,
        amount,
        assetType,
        mint,
        requestedStatus,
        receiptType: input.eventKind === 'bounty_settlement_recorded'
            ? 'bounty_settlement'
            : 'tip_transfer',
    };
}

function hasMatchingSolTransfer(
    transaction: any,
    actorPubkey: string,
    recipientPubkey: string,
    expectedLamports: bigint,
): boolean {
    const instructions = transaction?.transaction?.message?.instructions;
    if (!Array.isArray(instructions)) return false;
    return instructions.some((instruction) => {
        const parsed = instruction?.parsed;
        const info = parsed?.info;
        if (instruction?.program !== 'system' || parsed?.type !== 'transfer') return false;
        const lamports = normalizeInstructionLamports(info?.lamports);
        return info?.source === actorPubkey
            && info?.destination === recipientPubkey
            && lamports !== null
            && lamports === expectedLamports;
    });
}

function parseSolAmountToLamports(amount: string | null): bigint | null {
    if (!amount || !/^\d+(\.\d{1,9})?$/.test(amount.trim())) return null;
    const [wholeRaw, fractionalRaw = ''] = amount.trim().split('.');
    const lamports = BigInt(wholeRaw) * LAMPORTS_PER_SOL_BIGINT
        + BigInt(fractionalRaw.padEnd(9, '0'));
    return lamports > ZERO_LAMPORTS ? lamports : null;
}

function normalizeInstructionLamports(value: unknown): bigint | null {
    if (typeof value === 'bigint') return value >= ZERO_LAMPORTS ? value : null;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) return null;
        return BigInt(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        return BigInt(value);
    }
    return null;
}

function firstNonEmptyString(...values: Array<unknown>): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

async function verifyReceipt(
    normalized: {
        signature: string | null;
        assetType: string | null;
        mint: string | null;
        amount: string | null;
        recipientPubkey: string | null;
        requestedStatus: AnchoredInteractionReceiptStatus;
    },
    actorPubkey: string,
    verifier?: AnchoredInteractionTransactionVerifier,
): Promise<AnchoredInteractionReceiptVerificationResult> {
    if (normalized.requestedStatus === 'failed') return { status: 'failed', reasonCode: 'client_reported_failure' };
    if (!verifier) return { status: 'unverified', reasonCode: 'verifier_not_configured' };
    try {
        const result = await verifier.verify({
            signature: normalized.signature,
            assetType: normalized.assetType,
            mint: normalized.mint,
            amount: normalized.amount,
            actorPubkey,
            recipientPubkey: normalized.recipientPubkey,
        });
        if (result.status === 'confirmed'
            || result.status === 'pending'
            || result.status === 'unverified'
            || result.status === 'failed') {
            return result;
        }
    } catch {
        return { status: 'unverified', reasonCode: 'verifier_unavailable' };
    }
    return { status: 'unverified', reasonCode: 'verifier_unavailable' };
}

function findExistingReceipt(
    prisma: AnchoredInteractionPrisma,
    input: {
        interaction: {
            interactionId: string;
            circleId: number;
        };
    },
    normalized: {
        receiptId: string;
        signature: string | null;
    },
) {
    return prisma.discussionAnchoredInteractionReceipt.findFirst({
        where: {
            interactionId: input.interaction.interactionId,
            circleId: input.interaction.circleId,
            OR: [
                { receiptId: normalized.receiptId },
                ...(normalized.signature ? [{ signature: normalized.signature }] : []),
            ],
        },
    });
}

function isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
}

function assertReceiptActorMatches(row: unknown, actorPubkey: string): void {
    const storedActor = row && typeof row === 'object'
        ? (row as { actorPubkey?: unknown }).actorPubkey
        : null;
    if (storedActor !== actorPubkey) {
        throw new AnchoredInteractionReceiptError('receipt_actor_mismatch', 403);
    }
}

function buildReceiptEventPayload(receipt: AnchoredInteractionReceiptDto): Record<string, unknown> {
    return {
        receiptId: receipt.receiptId,
        ...(receipt.signature ? { signature: receipt.signature } : {}),
        ...(receipt.assetType ? { assetType: receipt.assetType } : {}),
        ...(receipt.mint ? { mint: receipt.mint } : {}),
        ...(receipt.amount ? { amount: receipt.amount } : {}),
        ...(receipt.recipientPubkey ? { recipientPubkey: receipt.recipientPubkey } : {}),
        ...snapshotToDisplayPayloadFields('actor', receipt.actorDisplaySnapshot
            ? {
                displaySnapshot: receipt.actorDisplaySnapshot,
                displaySourceSnapshot: receipt.actorDisplaySourceSnapshot || 'generic_member',
                displayCircleIdSnapshot: receipt.actorDisplayCircleIdSnapshot ?? null,
                inheritedFromCircleIdSnapshot: receipt.actorInheritedFromCircleIdSnapshot ?? null,
                displaySnapshotAt: receipt.actorDisplaySnapshotAt ? new Date(receipt.actorDisplaySnapshotAt) : new Date(0),
                aliasSnapshot: receipt.actorAliasSnapshot ?? null,
                needsDisplayDisambiguation: Boolean(
                    (receipt.metadata?.displaySnapshots as any)?.actor?.needsDisplayDisambiguation,
                ),
                displayCollisionKey: (receipt.metadata?.displaySnapshots as any)?.actor?.displayCollisionKey ?? null,
                displayCollisionCount: Number((receipt.metadata?.displaySnapshots as any)?.actor?.displayCollisionCount ?? 1),
            }
            : null),
        ...snapshotToDisplayPayloadFields('recipient', receipt.recipientDisplaySnapshot
            ? {
                displaySnapshot: receipt.recipientDisplaySnapshot,
                displaySourceSnapshot: receipt.recipientDisplaySourceSnapshot || 'generic_member',
                displayCircleIdSnapshot: receipt.recipientDisplayCircleIdSnapshot ?? null,
                inheritedFromCircleIdSnapshot: receipt.recipientInheritedFromCircleIdSnapshot ?? null,
                displaySnapshotAt: receipt.recipientDisplaySnapshotAt ? new Date(receipt.recipientDisplaySnapshotAt) : new Date(0),
                aliasSnapshot: receipt.recipientAliasSnapshot ?? null,
                needsDisplayDisambiguation: Boolean(
                    (receipt.metadata?.displaySnapshots as any)?.recipient?.needsDisplayDisambiguation,
                ),
                displayCollisionKey: (receipt.metadata?.displaySnapshots as any)?.recipient?.displayCollisionKey ?? null,
                displayCollisionCount: Number((receipt.metadata?.displaySnapshots as any)?.recipient?.displayCollisionCount ?? 1),
            }
            : null),
        status: receipt.status,
    };
}

function toReceiptDto(row: any): AnchoredInteractionReceiptDto {
    return {
        receiptId: row.receiptId,
        interactionId: row.interactionId,
        circleId: row.circleId,
        receiptType: row.receiptType,
        status: normalizeStoredStatus(row.status),
        actorPubkey: row.actorPubkey,
        actorDisplaySnapshot: typeof row.actorDisplaySnapshot === 'string' ? row.actorDisplaySnapshot : null,
        actorDisplaySourceSnapshot: typeof row.actorDisplaySourceSnapshot === 'string' ? row.actorDisplaySourceSnapshot : null,
        actorDisplayCircleIdSnapshot: typeof row.actorDisplayCircleIdSnapshot === 'number' ? row.actorDisplayCircleIdSnapshot : null,
        actorInheritedFromCircleIdSnapshot: typeof row.actorInheritedFromCircleIdSnapshot === 'number' ? row.actorInheritedFromCircleIdSnapshot : null,
        actorDisplaySnapshotAt: row.actorDisplaySnapshotAt ? toIsoString(row.actorDisplaySnapshotAt) : null,
        actorAliasSnapshot: typeof row.actorAliasSnapshot === 'string' ? row.actorAliasSnapshot : null,
        recipientPubkey: typeof row.recipientPubkey === 'string' ? row.recipientPubkey : null,
        recipientDisplaySnapshot: typeof row.recipientDisplaySnapshot === 'string' ? row.recipientDisplaySnapshot : null,
        recipientDisplaySourceSnapshot: typeof row.recipientDisplaySourceSnapshot === 'string' ? row.recipientDisplaySourceSnapshot : null,
        recipientDisplayCircleIdSnapshot: typeof row.recipientDisplayCircleIdSnapshot === 'number' ? row.recipientDisplayCircleIdSnapshot : null,
        recipientInheritedFromCircleIdSnapshot: typeof row.recipientInheritedFromCircleIdSnapshot === 'number' ? row.recipientInheritedFromCircleIdSnapshot : null,
        recipientDisplaySnapshotAt: row.recipientDisplaySnapshotAt ? toIsoString(row.recipientDisplaySnapshotAt) : null,
        recipientAliasSnapshot: typeof row.recipientAliasSnapshot === 'string' ? row.recipientAliasSnapshot : null,
        assetType: typeof row.assetType === 'string' ? row.assetType : null,
        mint: typeof row.mint === 'string' ? row.mint : null,
        amount: typeof row.amount === 'string' ? row.amount : null,
        signature: typeof row.signature === 'string' ? row.signature : null,
        metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {},
        ...(row.createdAt ? { createdAt: toIsoString(row.createdAt) } : {}),
        ...(row.updatedAt ? { updatedAt: toIsoString(row.updatedAt) } : {}),
    };
}

function normalizeRequestedStatus(value: unknown): AnchoredInteractionReceiptStatus {
    if (value === 'confirmed' || value === 'pending' || value === 'failed' || value === 'unverified') return value;
    return 'pending';
}

function normalizeStoredStatus(value: unknown): AnchoredInteractionReceiptStatus {
    return normalizeRequestedStatus(value);
}

function requiredString(value: unknown, code: string): string {
    const normalized = optionalString(value);
    if (!normalized) throw new AnchoredInteractionReceiptError(code);
    return normalized;
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
