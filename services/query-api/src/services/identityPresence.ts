import {
    deriveIdentityRegistryPda,
    deriveUserIdentityPda,
    verifyIdentityAccount,
} from './chain/accountPresence';

export type IdentityAccountPresence = 'exists' | 'missing' | 'unavailable';

export {
    deriveIdentityRegistryPda,
    deriveUserIdentityPda,
};

export async function resolveIdentityAccountPresence(handle: string): Promise<IdentityAccountPresence> {
    const verification = await verifyIdentityAccount({ handle });
    if (verification.ok) return 'exists';
    if (verification.presence === 'missing' || verification.presence === 'mismatch') return 'missing';
    return 'unavailable';
}
