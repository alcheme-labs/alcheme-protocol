import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';

const source = readFileSync(
    path.resolve(__dirname, '../crystalAssets/mintAdapter.ts'),
    'utf8',
);

describe('Token-2022 crystal mint metadata wiring', () => {
    test('initializes token metadata on the mint account before minting supply', () => {
        expect(source).toContain('createInitializeMetadataPointerInstruction');
        expect(source).toContain('createInitializeTokenMetadataInstruction');
        expect(source).toContain('createUpdateTokenMetadataFieldInstruction');
        expect(source).toContain('packTokenMetadata');
        expect(source).toContain('TYPE_SIZE + LENGTH_SIZE + packTokenMetadata(tokenMetadata).length');
        expect(source).toContain('metadata: mint.publicKey');
        expect(source).toContain('uri: input.metadataUri');
    });

    test('keeps additional metadata field updates out of the mint initialization transaction', () => {
        const initStart = source.indexOf('const initTransaction = new Transaction().add(');
        const initSend = source.indexOf('sendAndConfirmTransaction(connection, initTransaction');
        const updateLoop = source.indexOf('for (const [field, value] of input.additionalMetadata)');
        const mintTransaction = source.indexOf('const mintTransaction = new Transaction().add(');

        expect(initStart).toBeGreaterThanOrEqual(0);
        expect(initSend).toBeGreaterThan(initStart);
        expect(updateLoop).toBeGreaterThan(initSend);
        expect(mintTransaction).toBeGreaterThan(updateLoop);

        const initBlock = source.slice(initStart, initSend);
        expect(initBlock).not.toContain('createUpdateTokenMetadataFieldInstruction');
    });
});
