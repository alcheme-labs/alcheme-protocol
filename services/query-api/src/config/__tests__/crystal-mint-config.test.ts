import { describe, expect, test } from '@jest/globals';

import { loadCrystalMintRuntimeConfig } from '../services';

describe('crystal mint config', () => {
    test('defaults to mock_chain issuance only outside production', () => {
        const config = loadCrystalMintRuntimeConfig({
            NODE_ENV: 'development',
        } as NodeJS.ProcessEnv);

        expect(config.adapterMode).toBe('mock_chain');
    });

    test('ignores the removed CRYSTAL_MINT_ADAPTER switch', () => {
        const config = loadCrystalMintRuntimeConfig({
            NODE_ENV: 'development',
            CRYSTAL_MINT_ADAPTER: 'disabled',
        } as NodeJS.ProcessEnv);

        expect(config.adapterMode).toBe('mock_chain');
    });

    test('fails fast in production when real mint credentials are missing', () => {
        expect(() => loadCrystalMintRuntimeConfig({
            NODE_ENV: 'production',
            CRYSTAL_MINT_ADAPTER: 'mock_chain',
        } as NodeJS.ProcessEnv)).toThrow('crystal_mint_credentials_required');
    });

    test('uses token2022_local automatically when chain mint credentials exist', () => {
        const config = loadCrystalMintRuntimeConfig({
            NODE_ENV: 'production',
            CRYSTAL_MINT_RPC_URL: 'http://127.0.0.1:8899',
            CRYSTAL_MINT_AUTHORITY_SECRET: '[1,2,3]',
        } as NodeJS.ProcessEnv);

        expect(config.adapterMode).toBe('token2022_local');
    });
});
