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
        expect(source).toContain('tokenMetadataInitializeWithRentTransfer');
        expect(source).toContain('tokenMetadataUpdateFieldWithRentTransfer');
        expect(source).toContain('const accountLength = getMintLen(extensions)');
        expect(source).toContain('mint.publicKey');
        expect(source).toContain('input.metadataUri');
    });

    test('keeps variable metadata writes out of the mint initialization transaction', () => {
        const initStart = source.indexOf('const initTransaction = new Transaction().add(');
        const initSend = source.indexOf('sendAndConfirmTransaction(connection, initTransaction');
        const metadataInit = source.indexOf('await tokenMetadataInitializeWithRentTransfer(');
        const updateLoop = source.indexOf('await tokenMetadataUpdateFieldWithRentTransfer(');
        const mintTransaction = source.indexOf('const mintTransaction = new Transaction().add(');

        expect(initStart).toBeGreaterThanOrEqual(0);
        expect(initSend).toBeGreaterThan(initStart);
        expect(metadataInit).toBeGreaterThan(initSend);
        expect(updateLoop).toBeGreaterThan(metadataInit);
        expect(mintTransaction).toBeGreaterThan(updateLoop);

        const initBlock = source.slice(initStart, initSend);
        expect(initBlock).not.toContain('tokenMetadataInitializeWithRentTransfer');
        expect(initBlock).not.toContain('tokenMetadataUpdateFieldWithRentTransfer');
    });
});
