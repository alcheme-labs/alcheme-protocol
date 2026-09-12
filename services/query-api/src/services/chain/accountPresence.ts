import { Connection, PublicKey } from '@solana/web3.js';

const IDENTITY_REGISTRY_SEED = Buffer.from('identity_registry');
const USER_IDENTITY_SEED = Buffer.from('user_identity');
const DEFAULT_IDENTITY_REGISTRY_NAME = 'social_hub_identity';
const DEFAULT_LOCAL_RPC_URL = 'http://127.0.0.1:8899';
const DEFAULT_LOCAL_IDENTITY_PROGRAM_ID = '75fXAp66PU3sgUcQCGJxdA4MKhFcyXXoGW8rhVk8zm4x';

export type ChainPresenceState = 'verified' | 'missing' | 'unavailable' | 'mismatch';

export type ChainPresenceReason =
    | 'empty_handle'
    | 'empty_address'
    | 'invalid_address'
    | 'rpc_unconfigured'
    | 'program_unconfigured'
    | 'identity_registry_missing'
    | 'identity_account_missing'
    | 'identity_decode_failed'
    | 'identity_pubkey_mismatch'
    | 'identity_handle_mismatch'
    | 'account_missing'
    | 'lookup_failed'
    | 'synthetic_projection_address';

export interface ChainPresenceFailure {
    presence: Exclude<ChainPresenceState, 'verified'>;
    reason: ChainPresenceReason;
    recoverable: boolean;
    message: string;
}

export interface VerifiedIdentityAccount {
    presence: 'verified';
    handle: string;
    identityPubkey: string;
    primaryHandle: string;
    accountAddress: string;
}

export type IdentityAccountVerification =
    | (VerifiedIdentityAccount & { ok: true })
    | (ChainPresenceFailure & { ok: false; accountAddress?: string | null });

export interface VerifiedChainAccount {
    presence: 'verified';
    accountAddress: string;
}

export type ChainAccountVerification =
    | (VerifiedChainAccount & { ok: true })
    | (ChainPresenceFailure & { ok: false; accountAddress?: string | null });

interface AccountInfoLike {
    data?: Uint8Array | Buffer;
}

interface ConnectionLike {
    getAccountInfo(pubkey: PublicKey, commitment?: 'confirmed'): Promise<AccountInfoLike | null>;
    getMultipleAccountsInfo?(
        pubkeys: PublicKey[],
        commitment?: 'confirmed',
    ): Promise<Array<AccountInfoLike | null>>;
}

const identityVerificationInFlight = new Map<string, Promise<IdentityAccountVerification>>();
const chainAccountVerificationInFlight = new Map<string, Promise<ChainAccountVerification>>();

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

export function resolveSolanaRpcUrl(): string | null {
    return firstNonEmpty([
        process.env.SOLANA_RPC_URL,
        process.env.RPC_URL,
        process.env.NODE_ENV === 'production' ? null : DEFAULT_LOCAL_RPC_URL,
    ]);
}

function publicKeyFromEnv(candidates: Array<string | undefined | null>): PublicKey | null {
    const raw = firstNonEmpty(candidates);
    if (!raw) return null;
    try {
        return new PublicKey(raw);
    } catch {
        return null;
    }
}

export function resolveIdentityProgramId(): PublicKey | null {
    return publicKeyFromEnv([
        process.env.IDENTITY_PROGRAM_ID,
        process.env.IDENTITY_REGISTRY_PROGRAM_ID,
        process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID,
        process.env.NODE_ENV === 'production' ? null : DEFAULT_LOCAL_IDENTITY_PROGRAM_ID,
    ]);
}

export function resolveIdentityRegistryName(): string {
    return firstNonEmpty([
        process.env.IDENTITY_REGISTRY_NAME,
        process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_NAME,
        DEFAULT_IDENTITY_REGISTRY_NAME,
    ]) || DEFAULT_IDENTITY_REGISTRY_NAME;
}

export function deriveIdentityRegistryPda(
    identityProgramId: PublicKey,
    registryName: string = DEFAULT_IDENTITY_REGISTRY_NAME,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [IDENTITY_REGISTRY_SEED, Buffer.from(registryName)],
        identityProgramId,
    )[0];
}

export function deriveUserIdentityPda(
    identityProgramId: PublicKey,
    identityRegistryPda: PublicKey,
    handle: string,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [USER_IDENTITY_SEED, identityRegistryPda.toBuffer(), Buffer.from(handle)],
        identityProgramId,
    )[0];
}

function failure(
    presence: Exclude<ChainPresenceState, 'verified'>,
    reason: ChainPresenceReason,
    message: string,
    recoverable = true,
): ChainPresenceFailure {
    return { presence, reason, message, recoverable };
}

function asPublicKey(address: string): PublicKey | null {
    try {
        return new PublicKey(address);
    } catch {
        return null;
    }
}

function readU32Le(buffer: Buffer, offset: number): number | null {
    if (offset + 4 > buffer.length) return null;
    return buffer.readUInt32LE(offset);
}

export function decodeUserIdentityAccount(data: Uint8Array | Buffer): {
    identityPubkey: string;
    primaryHandle: string;
} | null {
    const buffer = Buffer.from(data);
    if (buffer.length < 8 + 32 + 4) return null;

    let offset = 8;
    const identityPubkey = new PublicKey(buffer.subarray(offset, offset + 32)).toBase58();
    offset += 32;

    const handleLength = readU32Le(buffer, offset);
    if (handleLength === null) return null;
    offset += 4;
    if (handleLength < 0 || offset + handleLength > buffer.length) return null;

    const primaryHandle = buffer.subarray(offset, offset + handleLength).toString('utf8');
    return {
        identityPubkey,
        primaryHandle,
    };
}

export async function verifyIdentityAccount(input: {
    handle: string;
    expectedPubkey?: string | null;
    connection?: ConnectionLike | null;
}): Promise<IdentityAccountVerification> {
    const handle = String(input.handle || '').trim();
    if (!handle) {
        return {
            ok: false,
            ...failure('missing', 'empty_handle', 'identity handle is required'),
            accountAddress: null,
        };
    }

    const identityProgramId = resolveIdentityProgramId();
    if (!identityProgramId) {
        return {
            ok: false,
            ...failure('unavailable', 'program_unconfigured', 'identity program id is not configured', false),
            accountAddress: null,
        };
    }

    const rpcUrl = input.connection ? null : resolveSolanaRpcUrl();
    const connection = input.connection ?? (rpcUrl ? new Connection(rpcUrl, 'confirmed') : null);
    if (!connection) {
        return {
            ok: false,
            ...failure('unavailable', 'rpc_unconfigured', 'solana rpc url is not configured', false),
            accountAddress: null,
        };
    }

    const registryName = resolveIdentityRegistryName();
    const identityRegistryPda = deriveIdentityRegistryPda(identityProgramId, registryName);
    const userIdentityPda = deriveUserIdentityPda(identityProgramId, identityRegistryPda, handle);
    const expectedPubkey = String(input.expectedPubkey || '').trim();

    const verifyResolvedIdentity = async (): Promise<IdentityAccountVerification> => {
        try {
            const [registryAccount, userIdentityAccount] = connection.getMultipleAccountsInfo
                ? await connection.getMultipleAccountsInfo(
                    [identityRegistryPda, userIdentityPda],
                    'confirmed',
                )
                : await Promise.all([
                    connection.getAccountInfo(identityRegistryPda, 'confirmed'),
                    connection.getAccountInfo(userIdentityPda, 'confirmed'),
                ]);

            if (!registryAccount) {
                return {
                    ok: false,
                    ...failure('unavailable', 'identity_registry_missing', 'identity registry account is missing'),
                    accountAddress: userIdentityPda.toBase58(),
                };
            }
            if (!userIdentityAccount) {
                return {
                    ok: false,
                    ...failure('missing', 'identity_account_missing', 'identity account is missing'),
                    accountAddress: userIdentityPda.toBase58(),
                };
            }

            const decoded = decodeUserIdentityAccount(userIdentityAccount.data || Buffer.alloc(0));
            if (!decoded) {
                return {
                    ok: false,
                    ...failure('mismatch', 'identity_decode_failed', 'identity account could not be decoded'),
                    accountAddress: userIdentityPda.toBase58(),
                };
            }

            if (expectedPubkey && decoded.identityPubkey !== expectedPubkey) {
                return {
                    ok: false,
                    ...failure('mismatch', 'identity_pubkey_mismatch', 'identity account pubkey does not match user projection'),
                    accountAddress: userIdentityPda.toBase58(),
                };
            }
            if (decoded.primaryHandle !== handle) {
                return {
                    ok: false,
                    ...failure('mismatch', 'identity_handle_mismatch', 'identity primary handle does not match user projection'),
                    accountAddress: userIdentityPda.toBase58(),
                };
            }

            return {
                ok: true,
                presence: 'verified',
                handle,
                identityPubkey: decoded.identityPubkey,
                primaryHandle: decoded.primaryHandle,
                accountAddress: userIdentityPda.toBase58(),
            };
        } catch {
            return {
                ok: false,
                ...failure('unavailable', 'lookup_failed', 'identity account lookup failed', false),
                accountAddress: userIdentityPda.toBase58(),
            };
        }
    };

    if (input.connection || !rpcUrl) {
        return verifyResolvedIdentity();
    }

    const verificationKey = JSON.stringify([
        rpcUrl,
        identityProgramId.toBase58(),
        registryName,
        handle,
        expectedPubkey,
    ]);
    const existingVerification = identityVerificationInFlight.get(verificationKey);
    if (existingVerification) {
        return existingVerification;
    }

    const verification = verifyResolvedIdentity();
    identityVerificationInFlight.set(verificationKey, verification);

    try {
        return await verification;
    } finally {
        if (identityVerificationInFlight.get(verificationKey) === verification) {
            identityVerificationInFlight.delete(verificationKey);
        }
    }
}

export async function verifyChainAccountAddress(input: {
    address: string | null | undefined;
    connection?: ConnectionLike | null;
    syntheticAddressReason?: ChainPresenceReason;
}): Promise<ChainAccountVerification> {
    const address = String(input.address || '').trim();
    if (!address) {
        return {
            ok: false,
            ...failure('missing', 'empty_address', 'chain account address is required'),
            accountAddress: null,
        };
    }
    if (input.syntheticAddressReason && !asPublicKey(address)) {
        return {
            ok: false,
            ...failure('mismatch', input.syntheticAddressReason, 'projection address is not a chain account address'),
            accountAddress: address,
        };
    }

    const publicKey = asPublicKey(address);
    if (!publicKey) {
        return {
            ok: false,
            ...failure('mismatch', 'invalid_address', 'chain account address is invalid'),
            accountAddress: address,
        };
    }

    const rpcUrl = input.connection ? null : resolveSolanaRpcUrl();
    const connection = input.connection ?? (rpcUrl ? new Connection(rpcUrl, 'confirmed') : null);
    if (!connection) {
        return {
            ok: false,
            ...failure('unavailable', 'rpc_unconfigured', 'solana rpc url is not configured', false),
            accountAddress: address,
        };
    }

    const verifyResolvedAccount = async (): Promise<ChainAccountVerification> => {
        try {
            const account = await connection.getAccountInfo(publicKey, 'confirmed');
            if (!account) {
                return {
                    ok: false,
                    ...failure('missing', 'account_missing', 'chain account is missing'),
                    accountAddress: address,
                };
            }
            return {
                ok: true,
                presence: 'verified',
                accountAddress: address,
            };
        } catch {
            return {
                ok: false,
                ...failure('unavailable', 'lookup_failed', 'chain account lookup failed', false),
                accountAddress: address,
            };
        }
    };

    if (input.connection || !rpcUrl) {
        return verifyResolvedAccount();
    }

    const verificationKey = JSON.stringify([rpcUrl, publicKey.toBase58()]);
    const existingVerification = chainAccountVerificationInFlight.get(verificationKey);
    if (existingVerification) {
        return existingVerification;
    }

    const verification = verifyResolvedAccount();
    chainAccountVerificationInFlight.set(verificationKey, verification);

    try {
        return await verification;
    } finally {
        if (chainAccountVerificationInFlight.get(verificationKey) === verification) {
            chainAccountVerificationInFlight.delete(verificationKey);
        }
    }
}

export async function verifyCircleAccountAddress(input: {
    address: string | null | undefined;
    connection?: ConnectionLike | null;
}): Promise<ChainAccountVerification> {
    return verifyChainAccountAddress(input);
}

export async function verifyCircleMemberAccountAddress(input: {
    address: string | null | undefined;
    connection?: ConnectionLike | null;
}): Promise<ChainAccountVerification> {
    return verifyChainAccountAddress({
        ...input,
        syntheticAddressReason: 'synthetic_projection_address',
    });
}
