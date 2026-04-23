import { Connection, PublicKey } from '@solana/web3.js';

const IDENTITY_REGISTRY_SEED = Buffer.from('identity_registry');
const USER_IDENTITY_SEED = Buffer.from('user_identity');
const DEFAULT_IDENTITY_REGISTRY_NAME = 'social_hub_identity';
const DEFAULT_LOCAL_RPC_URL = 'http://127.0.0.1:8899';
const DEFAULT_LOCAL_IDENTITY_PROGRAM_ID = '75fXAp66PU3sgUcQCGJxdA4MKhFcyXXoGW8rhVk8zm4x';

export type IdentityAccountPresence = 'exists' | 'missing' | 'unavailable';

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function resolveIdentityRpcUrl(): string | null {
    return firstNonEmpty([
        process.env.SOLANA_RPC_URL,
        process.env.RPC_URL,
        process.env.NODE_ENV === 'production' ? null : DEFAULT_LOCAL_RPC_URL,
    ]);
}

function resolveIdentityProgramId(): PublicKey | null {
    const raw = firstNonEmpty([
        process.env.IDENTITY_PROGRAM_ID,
        process.env.IDENTITY_REGISTRY_PROGRAM_ID,
        process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID,
        process.env.NODE_ENV === 'production' ? null : DEFAULT_LOCAL_IDENTITY_PROGRAM_ID,
    ]);
    if (!raw) return null;

    try {
        return new PublicKey(raw);
    } catch {
        return null;
    }
}

function resolveIdentityRegistryName(): string {
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

export async function resolveIdentityAccountPresence(handle: string): Promise<IdentityAccountPresence> {
    const normalizedHandle = String(handle || '').trim();
    if (!normalizedHandle) return 'missing';

    const rpcUrl = resolveIdentityRpcUrl();
    const identityProgramId = resolveIdentityProgramId();
    if (!rpcUrl || !identityProgramId) {
        return 'unavailable';
    }

    const connection = new Connection(rpcUrl, 'confirmed');
    const identityRegistryPda = deriveIdentityRegistryPda(
        identityProgramId,
        resolveIdentityRegistryName(),
    );
    const userIdentityPda = deriveUserIdentityPda(
        identityProgramId,
        identityRegistryPda,
        normalizedHandle,
    );

    try {
        const [registryAccount, userIdentityAccount] = await Promise.all([
            connection.getAccountInfo(identityRegistryPda, 'confirmed'),
            connection.getAccountInfo(userIdentityPda, 'confirmed'),
        ]);

        if (!registryAccount) {
            return 'unavailable';
        }

        return userIdentityAccount ? 'exists' : 'missing';
    } catch (error) {
        console.warn('identity presence lookup failed:', error);
        return 'unavailable';
    }
}
