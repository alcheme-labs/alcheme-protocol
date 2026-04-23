import crypto from 'crypto';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import {
    buildProofPackageIssuanceMessage,
    issueProofPackageSignature,
    persistProofPackageIssuance,
} from '../proofPackageIssuer';

const PROOF_BINDING_CANONICAL_DOMAIN = Buffer.from('alcheme:proof_binding:v1', 'utf8');
const TEST_ISSUER_KEYPAIR = Keypair.fromSeed(Uint8Array.from(Array.from({ length: 32 }, (_v, i) => i + 1)));
const VALID_ISSUER_KEY_ID = TEST_ISSUER_KEYPAIR.publicKey.toBase58();
const VALID_ISSUER_SECRET = JSON.stringify(Array.from(TEST_ISSUER_KEYPAIR.secretKey));

function toU16LE(value: number): Buffer {
    const output = Buffer.alloc(2);
    output.writeUInt16LE(value, 0);
    return output;
}

function toI64LE(value: number | bigint): Buffer {
    const output = Buffer.alloc(8);
    output.writeBigInt64LE(BigInt(value), 0);
    return output;
}

function buildExpectedSignature(input: {
    proofPackageHash: string;
    contributorsRoot: string;
    contributorsCount: number;
    sourceAnchorId: string;
    bindingVersion: number;
    generatedAt: string;
}): string {
    const generatedAtSeconds = Math.floor(new Date(input.generatedAt).getTime() / 1000);
    return crypto
        .createHash('sha256')
        .update(PROOF_BINDING_CANONICAL_DOMAIN)
        .update(Buffer.from(input.proofPackageHash, 'hex'))
        .update(Buffer.from(input.contributorsRoot, 'hex'))
        .update(toU16LE(input.contributorsCount))
        .update(Buffer.from(input.sourceAnchorId, 'hex'))
        .update(toU16LE(input.bindingVersion))
        .update(toI64LE(generatedAtSeconds))
        .digest('hex');
}

describe('proofPackageIssuer', () => {
    test('builds canonical issuance message with frozen schema', () => {
        const message = buildProofPackageIssuanceMessage({
            proof_package_hash: 'A'.repeat(64),
            contributors_root: 'B'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'C'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
        });

        expect(message).toBe(JSON.stringify({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
        }));
    });

    test('issues deterministic signature for the same canonical payload', () => {
        const baseInput = {
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuerSecret: VALID_ISSUER_SECRET,
            issuedAt: '2026-03-13T12:00:05.000Z',
        };

        const first = issueProofPackageSignature(baseInput);
        const second = issueProofPackageSignature(baseInput);

        expect(first.issued_signature).toBe(second.issued_signature);
        expect(first.signed_message).toBe(second.signed_message);
        expect(first.issued_signature).toMatch(/^[a-f0-9]{128}$/);
    });

    test('changes signature when a key field changes', () => {
        const first = issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuerSecret: VALID_ISSUER_SECRET,
            issuedAt: '2026-03-13T12:00:05.000Z',
        });
        const second = issueProofPackageSignature({
            proof_package_hash: 'f'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuerSecret: VALID_ISSUER_SECRET,
            issuedAt: '2026-03-13T12:00:05.000Z',
        });

        expect(first.issued_signature).not.toBe(second.issued_signature);
    });

    test('throws when issuer key id is not configured', () => {
        const previous = process.env.DRAFT_PROOF_ISSUER_KEY_ID;
        delete process.env.DRAFT_PROOF_ISSUER_KEY_ID;
        try {
            expect(() => issueProofPackageSignature({
                proof_package_hash: 'a'.repeat(64),
                contributors_root: 'b'.repeat(64),
                contributors_count: 3,
                source_anchor_id: 'c'.repeat(64),
                binding_version: 2,
                generated_at: '2026-03-13T12:00:00.000Z',
                issuerKeyId: '',
                issuerSecret: 'unit-test-secret',
                issuedAt: '2026-03-13T12:00:05.000Z',
            })).toThrow('missing_issuer_key_id');
        } finally {
            if (typeof previous === 'string') {
                process.env.DRAFT_PROOF_ISSUER_KEY_ID = previous;
            } else {
                delete process.env.DRAFT_PROOF_ISSUER_KEY_ID;
            }
        }
    });

    test('requires issuer secret for issuance', () => {
        const previous = process.env.DRAFT_PROOF_ISSUER_SECRET;
        delete process.env.DRAFT_PROOF_ISSUER_SECRET;
        try {
            expect(() => issueProofPackageSignature({
                proof_package_hash: 'a'.repeat(64),
                contributors_root: 'b'.repeat(64),
                contributors_count: 3,
                source_anchor_id: 'c'.repeat(64),
                binding_version: 2,
                generated_at: '2026-03-13T12:00:00.000Z',
                issuerKeyId: VALID_ISSUER_KEY_ID,
                issuedAt: '2026-03-13T12:00:05.000Z',
            })).toThrow('missing_issuer_secret');
        } finally {
            if (typeof previous === 'string') {
                process.env.DRAFT_PROOF_ISSUER_SECRET = previous;
            } else {
                delete process.env.DRAFT_PROOF_ISSUER_SECRET;
            }
        }
    });

    test('issues ed25519 signature verifiable by issuer_key_id over canonical digest', () => {
        const payload = {
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuerSecret: VALID_ISSUER_SECRET,
            issuedAt: '2026-03-13T12:00:05.000Z',
        };

        const issued = issueProofPackageSignature(payload);
        const digest = Buffer.from(buildExpectedSignature({
            proofPackageHash: payload.proof_package_hash,
            contributorsRoot: payload.contributors_root,
            contributorsCount: payload.contributors_count,
            sourceAnchorId: payload.source_anchor_id,
            bindingVersion: payload.binding_version,
            generatedAt: payload.generated_at,
        }), 'hex');
        const signature = Buffer.from(issued.issued_signature, 'hex');

        expect(signature.length).toBe(64);
        expect(nacl.sign.detached.verify(
            digest,
            signature,
            TEST_ISSUER_KEYPAIR.publicKey.toBytes(),
        )).toBe(true);
    });

    test('throws when issuer secret does not match issuer key id', () => {
        const another = Keypair.fromSeed(Uint8Array.from(Array.from({ length: 32 }, (_v, i) => 255 - i)));
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuerSecret: JSON.stringify(Array.from(another.secretKey)),
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('issuer_key_id_secret_mismatch');
    });

    test('throws when issuer key id is not a valid Solana public key', () => {
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: 'attestor-dev',
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('invalid_issuer_key_id');
    });

    test('throws when contributors_count is outside u16 integer bounds', () => {
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 0,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('invalid_contributors_count');
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 1.25,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('invalid_contributors_count');
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 65536,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 2,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('invalid_contributors_count');
    });

    test('throws when binding_version is outside u16 integer bounds', () => {
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 0,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('invalid_binding_version');
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 1.1,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('invalid_binding_version');
        expect(() => issueProofPackageSignature({
            proof_package_hash: 'a'.repeat(64),
            contributors_root: 'b'.repeat(64),
            contributors_count: 3,
            source_anchor_id: 'c'.repeat(64),
            binding_version: 65536,
            generated_at: '2026-03-13T12:00:00.000Z',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedAt: '2026-03-13T12:00:05.000Z',
        })).toThrow('invalid_binding_version');
    });

    test('persists package metadata and issuance snapshot', async () => {
        const packageRow = {
            id: BigInt(10),
            draftPostId: 42,
            proofPackageHash: 'a'.repeat(64),
            sourceAnchorId: 'c'.repeat(64),
            contributorsRoot: 'b'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            generatedAt: new Date('2026-03-13T12:00:00.000Z'),
        };
        const issuanceRow = {
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedSignature: 'sig-base64',
            issuedAt: new Date('2026-03-13T12:00:05.000Z'),
        };
        const prisma = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([packageRow])
                .mockResolvedValueOnce([issuanceRow]),
        } as any;

        const persisted = await persistProofPackageIssuance(prisma, {
            draftPostId: 42,
            proofPackageHash: 'a'.repeat(64),
            sourceAnchorId: 'c'.repeat(64),
            contributorsRoot: 'b'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            canonicalProofPackage: { schema_version: 2 } as any,
            generatedAt: '2026-03-13T12:00:00.000Z',
            generatedBy: 'query-api',
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedSignature: 'sig-base64',
            issuedAt: '2026-03-13T12:00:05.000Z',
        });

        expect(persisted).toMatchObject({
            draftPostId: 42,
            proofPackageHash: 'a'.repeat(64),
            sourceAnchorId: 'c'.repeat(64),
            contributorsRoot: 'b'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            issuerKeyId: VALID_ISSUER_KEY_ID,
            issuedSignature: 'sig-base64',
        });
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
});
