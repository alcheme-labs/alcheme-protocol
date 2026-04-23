import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
    DEFAULT_IDENTITY_REGISTRY_NAME,
    deriveIdentityRegistryPda,
    deriveUserIdentityPda,
    IdentityResolver,
} from '../src/identity-resolver';

describe('IdentityResolver', () => {
    const identityProgramId = Keypair.generate().publicKey;
    const contributor = Keypair.generate().publicKey;
    const handle = 'alice';

    it('resolves handle-backed identity PDAs from db mapping + chain existence', async () => {
        const identityRegistryPda = deriveIdentityRegistryPda(
            identityProgramId,
            DEFAULT_IDENTITY_REGISTRY_NAME,
        );
        const userIdentityPda = deriveUserIdentityPda(identityProgramId, identityRegistryPda, handle);
        const connection = {
            getAccountInfo: jest
                .fn()
                .mockResolvedValueOnce({ executable: false })
                .mockResolvedValueOnce({ executable: false }),
        } as unknown as Connection;

        const resolver = new IdentityResolver(
            {
                findUserHandleByPubkey: jest.fn().mockResolvedValue(handle),
            },
            connection,
            identityProgramId,
            DEFAULT_IDENTITY_REGISTRY_NAME,
            'error',
        );

        const resolved = await resolver.resolveContributor(contributor);

        expect(resolved).not.toBeNull();
        expect(resolved?.handle).toBe(handle);
        expect(resolved?.identityRegistryPda.equals(identityRegistryPda)).toBe(true);
        expect(resolved?.userIdentityPda.equals(userIdentityPda)).toBe(true);
    });

    it('returns null when handle mapping is missing', async () => {
        const connection = {
            getAccountInfo: jest.fn(),
        } as unknown as Connection;

        const resolver = new IdentityResolver(
            {
                findUserHandleByPubkey: jest.fn().mockResolvedValue(null),
            },
            connection,
            identityProgramId,
            DEFAULT_IDENTITY_REGISTRY_NAME,
            'error',
        );

        const resolved = await resolver.resolveContributor(contributor);

        expect(resolved).toBeNull();
        expect((connection.getAccountInfo as jest.Mock)).not.toHaveBeenCalled();
    });

    it('returns null when derived user identity account is absent', async () => {
        const connection = {
            getAccountInfo: jest
                .fn()
                .mockResolvedValueOnce({ executable: false })
                .mockResolvedValueOnce(null),
        } as unknown as Connection;

        const resolver = new IdentityResolver(
            {
                findUserHandleByPubkey: jest.fn().mockResolvedValue(handle),
            },
            connection,
            identityProgramId,
            DEFAULT_IDENTITY_REGISTRY_NAME,
            'error',
        );

        const resolved = await resolver.resolveContributor(contributor);

        expect(resolved).toBeNull();
    });

    it('derives PDAs from an explicit non-default registry name', async () => {
        const customRegistryName = 'custom_identity_registry';
        const identityRegistryPda = deriveIdentityRegistryPda(
            identityProgramId,
            customRegistryName,
        );
        const userIdentityPda = deriveUserIdentityPda(identityProgramId, identityRegistryPda, handle);
        const connection = {
            getAccountInfo: jest
                .fn()
                .mockResolvedValueOnce({ executable: false })
                .mockResolvedValueOnce({ executable: false }),
        } as unknown as Connection;

        const resolver = new IdentityResolver(
            {
                findUserHandleByPubkey: jest.fn().mockResolvedValue(handle),
            },
            connection,
            identityProgramId,
            customRegistryName,
            'error',
        );

        const resolved = await resolver.resolveContributor(contributor);

        expect(resolved).not.toBeNull();
        expect(resolved?.identityRegistryPda.equals(identityRegistryPda)).toBe(true);
        expect(resolved?.userIdentityPda.equals(userIdentityPda)).toBe(true);
    });
});
