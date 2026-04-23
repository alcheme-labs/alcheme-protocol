import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { BN, BorshCoder, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';

import registryFactoryIdl from '../../../sdk/src/idl/registry_factory.json';
import { loadExtensionRuntimeSnapshot } from '../src/services/extensionCatalog';

const PROGRAM_ID = new PublicKey((registryFactoryIdl as { address: string }).address);
const OWNER = new PublicKey('11111111111111111111111111111111');
const ENABLED_PROGRAM_ID = new PublicKey('4EMGqMpeUHg2nDdWBrYkej1t5pR7LJL1ehBnXHRZJbVV');
const DISABLED_PROGRAM_ID = new PublicKey('75fXAp66PU3sgUcQCGJxdA4MKhFcyXXoGW8rhVk8zm4x');

function encodeRegistryAccount(
    extensions: Array<{ programId: PublicKey; enabled: boolean; permissions: unknown[] }>
) {
    const coder = new BorshCoder(registryFactoryIdl as unknown as Idl);
    return coder.accounts.encode('ExtensionRegistryAccount', {
        inner: {
            bump: 1,
            admin: OWNER,
            extensions: extensions.map((extension) => ({
                program_id: extension.programId,
                permissions: extension.permissions,
                enabled: extension.enabled,
            })),
            max_extensions: 20,
            created_at: new BN(0),
            last_updated: new BN(0),
        },
    });
}

describe('loadExtensionRuntimeSnapshot', () => {
    const originalSolanaRpcUrl = process.env.SOLANA_RPC_URL;
    const originalRpcUrl = process.env.RPC_URL;

    afterEach(() => {
        process.env.SOLANA_RPC_URL = originalSolanaRpcUrl;
        process.env.RPC_URL = originalRpcUrl;
        jest.restoreAllMocks();
    });

    test('decodes enabled registry entries from real account bytes', async () => {
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
        const accountData = await encodeRegistryAccount([
            {
                programId: ENABLED_PROGRAM_ID,
                enabled: true,
                permissions: [{ ReputationWrite: {} }],
            },
        ]);
        jest.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue({
            data: accountData,
            executable: false,
            lamports: 1,
            owner: PROGRAM_ID,
            rentEpoch: 0,
        });

        const snapshot = await loadExtensionRuntimeSnapshot();

        expect(snapshot).toMatchObject({
            source: 'chain',
            reason: null,
            entries: {
                [ENABLED_PROGRAM_ID.toBase58()]: {
                    enabled: true,
                    permissions: ['ReputationWrite'],
                },
            },
        });
    });

    test('decodes disabled registry entries from real account bytes', async () => {
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
        const accountData = await encodeRegistryAccount([
            {
                programId: DISABLED_PROGRAM_ID,
                enabled: false,
                permissions: [{ ContributionRead: {} }],
            },
        ]);
        jest.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue({
            data: accountData,
            executable: false,
            lamports: 1,
            owner: PROGRAM_ID,
            rentEpoch: 0,
        });

        const snapshot = await loadExtensionRuntimeSnapshot();

        expect(snapshot).toMatchObject({
            source: 'chain',
            reason: null,
            entries: {
                [DISABLED_PROGRAM_ID.toBase58()]: {
                    enabled: false,
                    permissions: ['ContributionRead'],
                },
            },
        });
    });

    test('degrades when registry RPC lookup fails', async () => {
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
        jest
            .spyOn(Connection.prototype, 'getAccountInfo')
            .mockRejectedValue(new Error('rpc_down'));

        const snapshot = await loadExtensionRuntimeSnapshot();

        expect(snapshot).toMatchObject({
            source: 'unavailable',
            entries: {},
            reason: 'runtime_lookup_failed',
        });
    });

    test('degrades when the extension registry account is missing', async () => {
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
        jest.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);

        const snapshot = await loadExtensionRuntimeSnapshot();

        expect(snapshot).toMatchObject({
            source: 'unavailable',
            entries: {},
            reason: 'extension_registry_missing',
        });
    });

    test('degrades when registry bytes cannot be decoded', async () => {
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
        jest.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue({
            data: Buffer.from([1, 2, 3, 4]),
            executable: false,
            lamports: 1,
            owner: PROGRAM_ID,
            rentEpoch: 0,
        });

        const snapshot = await loadExtensionRuntimeSnapshot();

        expect(snapshot.source).toBe('unavailable');
        expect(snapshot.entries).toEqual({});
        expect(snapshot.reason).toBe('runtime_decode_failed');
    });
});
