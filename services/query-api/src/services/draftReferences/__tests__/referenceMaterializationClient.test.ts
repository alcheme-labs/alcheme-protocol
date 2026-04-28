import { describe, expect, jest, test } from '@jest/globals';
import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    createReferenceMaterializationClient,
    createReferenceMaterializationClientFromEnv,
    ReferenceMaterializationClientError,
    type ReferenceMaterializationInput,
} from '../referenceMaterializationClient';

function pubkey(): string {
    return Keypair.generate().publicKey.toBase58();
}

function ref(overrides: Partial<ReferenceMaterializationInput> = {}): ReferenceMaterializationInput {
    return {
        sourceOnChainAddress: pubkey(),
        targetOnChainAddress: pubkey(),
        referenceType: 'citation',
        ...overrides,
    };
}

describe('reference materialization client', () => {
    test('missing live config fails with a clear configuration error', () => {
        expect(() => createReferenceMaterializationClientFromEnv({} as any)).toThrow(
            ReferenceMaterializationClientError,
        );
        try {
            createReferenceMaterializationClientFromEnv({} as any);
        } catch (error) {
            expect((error as ReferenceMaterializationClientError).code).toBe(
                'reference_materialization_config_invalid',
            );
        }
    });

    test('invalid source or target address fails before submitting', async () => {
        const sdk = {
            addReference: jest.fn(async () => 'sig-1'),
        };
        const client = createReferenceMaterializationClient({
            sdk,
            retryBaseDelayMs: 0,
        });

        await expect(client.addReferences([
            ref({ sourceOnChainAddress: 'not-a-pubkey' }),
        ])).rejects.toMatchObject({
            code: 'reference_materialization_invalid_input',
        });
        expect(sdk.addReference).not.toHaveBeenCalled();
    });

    test('duplicate already-existing references are treated as success', async () => {
        const sdk = {
            addReference: jest.fn(async () => {
                throw new Error('Account already initialized');
            }),
        };
        const client = createReferenceMaterializationClient({
            sdk,
            retryBaseDelayMs: 0,
        });

        await expect(client.addReferences([ref()])).resolves.toEqual([]);
        expect(sdk.addReference).toHaveBeenCalledTimes(1);
    });

    test('ambiguous custom program error 0x0 is not treated as a duplicate reference', async () => {
        const sdk = {
            addReference: jest.fn(async () => {
                throw new Error('failed to send transaction: custom program error: 0x0');
            }),
        };
        const client = createReferenceMaterializationClient({
            sdk,
            maxRetries: 3,
            retryBaseDelayMs: 0,
        });

        await expect(client.addReferences([ref()])).rejects.toMatchObject({
            code: 'reference_materialization_failed',
        });
        expect(sdk.addReference).toHaveBeenCalledTimes(1);
    });

    test('transient RPC and blockhash failures retry before succeeding', async () => {
        const sleep = jest.fn(async () => undefined);
        const addReference = jest.fn<() => Promise<string>>()
                .mockRejectedValueOnce(new Error('blockhash not found'))
                .mockRejectedValueOnce(new Error('503 service unavailable'))
                .mockResolvedValueOnce('sig-ok');
        const sdk = {
            addReference,
        };
        const client = createReferenceMaterializationClient({
            sdk,
            maxRetries: 3,
            retryBaseDelayMs: 1,
            sleep,
        });

        await expect(client.addReferences([ref()])).resolves.toEqual(['sig-ok']);
        expect(sdk.addReference).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    test('permanent chain errors produce a structured failure', async () => {
        const sdk = {
            addReference: jest.fn(async () => {
                throw new Error('custom authority constraint failed');
            }),
        };
        const client = createReferenceMaterializationClient({
            sdk,
            maxRetries: 3,
            retryBaseDelayMs: 0,
        });

        await expect(client.addReferences([ref()])).rejects.toMatchObject({
            code: 'reference_materialization_failed',
        });
        expect(sdk.addReference).toHaveBeenCalledTimes(1);
    });

    test('client submits once per deduped reference, not a true multi-instruction batch', async () => {
        const source = pubkey();
        const target = pubkey();
        const secondTarget = pubkey();
        const sdk = {
            addReference: jest.fn(async () => `sig-${sdk.addReference.mock.calls.length}`),
        } as any;
        const client = createReferenceMaterializationClient({
            sdk,
            retryBaseDelayMs: 0,
        });

        await expect(client.addReferences([
            ref({ sourceOnChainAddress: source, targetOnChainAddress: target }),
            ref({ sourceOnChainAddress: source, targetOnChainAddress: target }),
            ref({ sourceOnChainAddress: source, targetOnChainAddress: secondTarget }),
        ])).resolves.toEqual(['sig-1', 'sig-2']);
        expect(sdk.addReference).toHaveBeenCalledTimes(2);
    });

    test('empty reference list is a no-op', async () => {
        const sdk = {
            addReference: jest.fn(async () => 'sig-1'),
        };
        const client = createReferenceMaterializationClient({
            sdk,
            retryBaseDelayMs: 0,
        });

        await expect(client.addReferences([])).resolves.toEqual([]);
        expect(sdk.addReference).not.toHaveBeenCalled();
    });

    test('live adapter IDL stays in sync with the SDK contribution engine IDL', () => {
        const queryApiIdl = JSON.parse(readFileSync(
            path.resolve(process.cwd(), 'src/idl/contribution_engine.json'),
            'utf8',
        ));
        const sdkIdl = JSON.parse(readFileSync(
            path.resolve(process.cwd(), '../../sdk/src/idl/contribution_engine.json'),
            'utf8',
        ));

        expect(queryApiIdl).toEqual(sdkIdl);
    });

    test('live adapter account contract mirrors SDK addReference', () => {
        const clientSource = readFileSync(
            path.resolve(process.cwd(), 'src/services/draftReferences/referenceMaterializationClient.ts'),
            'utf8',
        );
        const sdkSource = readFileSync(
            path.resolve(process.cwd(), '../../sdk/src/modules/contribution-engine.ts'),
            'utf8',
        );
        const normalizedClientSource = clientSource.replace(/'/g, '"');
        const normalizedSdkSource = sdkSource.replace(/'/g, '"');

        expect(clientSource).toContain('source-compatible with sdk/src/modules/contribution-engine.ts');
        for (const marker of [
            'findReferencePda',
            'Buffer.from("ref")',
            'addReference(refType)',
            'sourceContent',
            'targetContent',
            'systemProgram',
        ]) {
            expect(normalizedClientSource).toContain(marker);
            expect(normalizedSdkSource).toContain(marker);
        }
    });
});
