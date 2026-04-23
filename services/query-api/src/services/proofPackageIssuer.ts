import crypto from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { sqlTimestampWithoutTimeZone } from '../utils/sqlTimestamp';

export interface ProofPackageIssuanceMessage {
    proof_package_hash: string;
    contributors_root: string;
    contributors_count: number;
    source_anchor_id: string;
    binding_version: number;
    generated_at: string;
}

export interface IssueProofPackageSignatureInput extends ProofPackageIssuanceMessage {
    issuerKeyId?: string;
    issuerSecret?: string;
    issuedAt?: Date | string;
}

export interface IssueProofPackageSignatureResult {
    issuer_key_id: string;
    issued_signature: string;
    issued_at: string;
    signed_message: string;
}

export interface PersistProofPackageInput {
    draftPostId: number;
    proofPackageHash: string;
    sourceAnchorId: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    canonicalProofPackage: Prisma.JsonValue;
    generatedAt: string;
    generatedBy: string;
    issuerKeyId: string;
    issuedSignature: string;
    issuedAt: string;
}

export interface PersistedProofPackageRecord {
    draftPostId: number;
    proofPackageHash: string;
    sourceAnchorId: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    generatedAt: string;
    issuerKeyId: string;
    issuedSignature: string;
    issuedAt: string;
}

interface DraftProofPackageRow {
    id: bigint;
    draftPostId: number;
    proofPackageHash: string;
    sourceAnchorId: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    generatedAt: Date;
}

interface DraftProofPackageIssuanceRow {
    issuerKeyId: string;
    issuedSignature: string;
    issuedAt: Date;
}

const PROOF_BINDING_CANONICAL_DOMAIN = Buffer.from('alcheme:proof_binding:v1', 'utf8');

function normalizeHex64(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error('invalid_hex_64');
    }
    return normalized;
}

function normalizePositiveU16(value: number, errorCode: string): number {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error(errorCode);
    }
    return value;
}

function normalizeIssuerKeyId(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error('missing_issuer_key_id');
    }
    try {
        return new PublicKey(normalized).toBase58();
    } catch {
        throw new Error('invalid_issuer_key_id');
    }
}

function parseIssuerSecretBytes(value: string): Uint8Array {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        throw new Error('missing_issuer_secret');
    }

    if (trimmed.startsWith('[')) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            throw new Error('invalid_issuer_secret');
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('invalid_issuer_secret');
        }
        const bytes = parsed.map((item) => Number(item));
        if (bytes.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
            throw new Error('invalid_issuer_secret');
        }
        return Uint8Array.from(bytes);
    }

    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
        return Uint8Array.from(Buffer.from(trimmed, 'hex'));
    }

    try {
        return Uint8Array.from(bs58.decode(trimmed));
    } catch {
        throw new Error('invalid_issuer_secret');
    }
}

function normalizeIssuerSecretKey(value: string, issuerKeyId: string): Uint8Array {
    const secretBytes = parseIssuerSecretBytes(value);
    let keyPair: nacl.SignKeyPair;
    if (secretBytes.length === 64) {
        keyPair = nacl.sign.keyPair.fromSecretKey(secretBytes);
    } else if (secretBytes.length === 32) {
        keyPair = nacl.sign.keyPair.fromSeed(secretBytes);
    } else {
        throw new Error('invalid_issuer_secret');
    }

    const derivedIssuer = new PublicKey(keyPair.publicKey).toBase58();
    if (derivedIssuer !== issuerKeyId) {
        throw new Error('issuer_key_id_secret_mismatch');
    }
    return keyPair.secretKey;
}

function normalizeIsoDate(value: Date | string | undefined): string {
    if (!value) {
        return new Date().toISOString();
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('invalid_timestamp');
    }
    return date.toISOString();
}

function normalizeProofPackageIssuanceMessage(input: ProofPackageIssuanceMessage): ProofPackageIssuanceMessage {
    const payload: ProofPackageIssuanceMessage = {
        proof_package_hash: normalizeHex64(input.proof_package_hash),
        contributors_root: normalizeHex64(input.contributors_root),
        contributors_count: normalizePositiveU16(input.contributors_count, 'invalid_contributors_count'),
        source_anchor_id: normalizeHex64(input.source_anchor_id),
        binding_version: normalizePositiveU16(input.binding_version, 'invalid_binding_version'),
        generated_at: normalizeIsoDate(input.generated_at),
    };
    return payload;
}

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

function toUnixSeconds(isoTimestamp: string): number {
    const millis = new Date(isoTimestamp).getTime();
    if (Number.isNaN(millis)) {
        throw new Error('invalid_timestamp');
    }
    return Math.floor(millis / 1000);
}

function buildProofBindingCanonicalDigest(input: ProofPackageIssuanceMessage): string {
    const generatedAtSeconds = toUnixSeconds(input.generated_at);
    return crypto
        .createHash('sha256')
        .update(PROOF_BINDING_CANONICAL_DOMAIN)
        .update(Buffer.from(input.proof_package_hash, 'hex'))
        .update(Buffer.from(input.contributors_root, 'hex'))
        .update(toU16LE(input.contributors_count))
        .update(Buffer.from(input.source_anchor_id, 'hex'))
        .update(toU16LE(input.binding_version))
        .update(toI64LE(generatedAtSeconds))
        .digest('hex');
}

export function buildProofPackageIssuanceMessage(input: ProofPackageIssuanceMessage): string {
    return JSON.stringify(normalizeProofPackageIssuanceMessage(input));
}

export function issueProofPackageSignature(
    input: IssueProofPackageSignatureInput,
): IssueProofPackageSignatureResult {
    const issuerKeyId = normalizeIssuerKeyId(
        String(input.issuerKeyId ?? process.env.DRAFT_PROOF_ISSUER_KEY_ID ?? ''),
    );
    const canonicalMessage = normalizeProofPackageIssuanceMessage(input);
    const issuerSecretKey = normalizeIssuerSecretKey(
        String(input.issuerSecret ?? process.env.DRAFT_PROOF_ISSUER_SECRET ?? ''),
        issuerKeyId,
    );
    const message = JSON.stringify(canonicalMessage);
    const issuedAt = normalizeIsoDate(input.issuedAt);
    const digest = Buffer.from(buildProofBindingCanonicalDigest(canonicalMessage), 'hex');
    const signature = Buffer.from(nacl.sign.detached(digest, issuerSecretKey)).toString('hex');

    return {
        issuer_key_id: issuerKeyId,
        issued_signature: signature,
        issued_at: issuedAt,
        signed_message: message,
    };
}

async function loadExistingProofPackage(
    prisma: PrismaClient,
    draftPostId: number,
    proofPackageHash: string,
): Promise<DraftProofPackageRow | null> {
    const rows = await prisma.$queryRaw<DraftProofPackageRow[]>(Prisma.sql`
        SELECT
            id,
            draft_post_id AS "draftPostId",
            proof_package_hash AS "proofPackageHash",
            source_anchor_id AS "sourceAnchorId",
            contributors_root AS "contributorsRoot",
            contributors_count AS "contributorsCount",
            binding_version AS "bindingVersion",
            generated_at AS "generatedAt"
        FROM draft_proof_packages
        WHERE draft_post_id = ${draftPostId}
          AND proof_package_hash = ${proofPackageHash}
        ORDER BY id DESC
        LIMIT 1
    `);
    return rows[0] || null;
}

export async function persistProofPackageIssuance(
    prisma: PrismaClient,
    input: PersistProofPackageInput,
): Promise<PersistedProofPackageRecord> {
    const proofPackageHash = normalizeHex64(input.proofPackageHash);
    const sourceAnchorId = normalizeHex64(input.sourceAnchorId);
    const contributorsRoot = normalizeHex64(input.contributorsRoot);
    const generatedAt = normalizeIsoDate(input.generatedAt);
    const issuedAt = normalizeIsoDate(input.issuedAt);
    const generatedAtDate = new Date(generatedAt);
    const issuedAtDate = new Date(issuedAt);
    if (!Number.isFinite(input.draftPostId) || input.draftPostId <= 0) {
        throw new Error('invalid_draft_post_id');
    }
    const contributorsCount = normalizePositiveU16(
        input.contributorsCount,
        'invalid_contributors_count',
    );
    const bindingVersion = normalizePositiveU16(
        input.bindingVersion,
        'invalid_binding_version',
    );
    const issuerKeyId = normalizeIssuerKeyId(input.issuerKeyId);

    const inserted = await prisma.$queryRaw<DraftProofPackageRow[]>(Prisma.sql`
        INSERT INTO draft_proof_packages (
            draft_post_id,
            proof_package_hash,
            source_anchor_id,
            contributors_root,
            contributors_count,
            binding_version,
            canonical_proof_package,
            generated_at,
            generated_by,
            created_at
        )
        VALUES (
            ${input.draftPostId},
            ${proofPackageHash},
            ${sourceAnchorId},
            ${contributorsRoot},
            ${contributorsCount},
            ${bindingVersion},
            ${JSON.stringify(input.canonicalProofPackage)}::jsonb,
            ${sqlTimestampWithoutTimeZone(generatedAtDate)},
            ${input.generatedBy},
            NOW()
        )
        ON CONFLICT (draft_post_id, proof_package_hash) DO NOTHING
        RETURNING
            id,
            draft_post_id AS "draftPostId",
            proof_package_hash AS "proofPackageHash",
            source_anchor_id AS "sourceAnchorId",
            contributors_root AS "contributorsRoot",
            contributors_count AS "contributorsCount",
            binding_version AS "bindingVersion",
            generated_at AS "generatedAt"
    `);

    const proofPackage =
        inserted[0]
        || await loadExistingProofPackage(prisma, input.draftPostId, proofPackageHash);
    if (!proofPackage) {
        throw new Error('proof_package_persist_failed');
    }

    const insertedIssuance = await prisma.$queryRaw<DraftProofPackageIssuanceRow[]>(Prisma.sql`
        INSERT INTO draft_proof_package_issuances (
            proof_package_id,
            issuer_key_id,
            issued_signature,
            issued_at,
            created_at
        )
        VALUES (
            ${proofPackage.id},
            ${issuerKeyId},
            ${input.issuedSignature},
            ${sqlTimestampWithoutTimeZone(issuedAtDate)},
            NOW()
        )
        RETURNING
            issuer_key_id AS "issuerKeyId",
            issued_signature AS "issuedSignature",
            issued_at AS "issuedAt"
    `);
    const issuance = insertedIssuance[0] || null;
    if (!issuance) {
        throw new Error('proof_package_issuance_persist_failed');
    }

    return {
        draftPostId: proofPackage.draftPostId,
        proofPackageHash: proofPackage.proofPackageHash,
        sourceAnchorId: proofPackage.sourceAnchorId,
        contributorsRoot: proofPackage.contributorsRoot,
        contributorsCount: proofPackage.contributorsCount,
        bindingVersion: proofPackage.bindingVersion,
        generatedAt: proofPackage.generatedAt.toISOString(),
        issuerKeyId: issuance.issuerKeyId,
        issuedSignature: issuance.issuedSignature,
        issuedAt: issuance.issuedAt.toISOString(),
    };
}
