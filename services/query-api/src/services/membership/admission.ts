import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export type MembershipAdmissionKind = 'Open' | 'Invite' | 'Approval';

export interface MembershipAdmissionGrant {
    circleId: number;
    memberPubkey: string;
    role: 'Member';
    kind: MembershipAdmissionKind;
    artifactId: number;
    issuedAt: string;
    expiresAt: string;
    issuerKeyId: string;
    issuedSignature: string;
}

const MEMBERSHIP_ADMISSION_DOMAIN = Buffer.from('alcheme:membership_admission:v1', 'utf8');

function normalizePubkey(value: string, errorCode: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error(errorCode);
    }
    try {
        return new PublicKey(normalized).toBase58();
    } catch {
        throw new Error(errorCode);
    }
}

function parseSecretBytes(value: string): Uint8Array {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        throw new Error('missing_membership_bridge_issuer_secret');
    }
    if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
            throw new Error('invalid_membership_bridge_issuer_secret');
        }
        return Uint8Array.from(parsed.map((entry) => Number(entry)));
    }
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
        return Uint8Array.from(Buffer.from(trimmed, 'hex'));
    }
    return Uint8Array.from(bs58.decode(trimmed));
}

function normalizeSecretKey(secret: string, issuerKeyId: string): Uint8Array {
    const bytes = parseSecretBytes(secret);
    const keyPair = bytes.length === 64
        ? nacl.sign.keyPair.fromSecretKey(bytes)
        : nacl.sign.keyPair.fromSeed(bytes);
    const derivedIssuer = new PublicKey(keyPair.publicKey).toBase58();
    if (derivedIssuer !== issuerKeyId) {
        throw new Error('membership_bridge_issuer_key_mismatch');
    }
    return keyPair.secretKey;
}

function normalizeUnixSeconds(value: Date | string | number | undefined, fallbackSeconds: number): number {
    if (value === undefined) return fallbackSeconds;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    const millis = new Date(value).getTime();
    if (!Number.isFinite(millis)) {
        throw new Error('invalid_membership_admission_timestamp');
    }
    return Math.floor(millis / 1000);
}

function toU64LE(value: number): Buffer {
    const output = Buffer.alloc(8);
    output.writeBigUInt64LE(BigInt(Math.max(0, Math.floor(value))), 0);
    return output;
}

function toI64LE(value: number): Buffer {
    const output = Buffer.alloc(8);
    output.writeBigInt64LE(BigInt(Math.floor(value)), 0);
    return output;
}

function roleIndex(role: 'Member'): number {
    return role === 'Member' ? 3 : 3;
}

function kindIndex(kind: MembershipAdmissionKind): number {
    if (kind === 'Invite') return 1;
    if (kind === 'Approval') return 2;
    return 0;
}

export function buildMembershipAdmissionDigest(input: {
    circleId: number;
    memberPubkey: string;
    role: 'Member';
    kind: MembershipAdmissionKind;
    artifactId: number;
    issuedAt: number;
    expiresAt: number;
}): Buffer {
    const member = new PublicKey(normalizePubkey(input.memberPubkey, 'invalid_membership_admission_member'));
    return crypto
        .createHash('sha256')
        .update(MEMBERSHIP_ADMISSION_DOMAIN)
        .update(Buffer.from([input.circleId]))
        .update(member.toBuffer())
        .update(Buffer.from([roleIndex(input.role)]))
        .update(Buffer.from([kindIndex(input.kind)]))
        .update(toU64LE(input.artifactId))
        .update(toI64LE(input.issuedAt))
        .update(toI64LE(input.expiresAt))
        .digest();
}

export function issueMembershipAdmissionGrant(input: {
    circleId: number;
    memberPubkey: string;
    kind: MembershipAdmissionKind;
    artifactId?: number;
    issuedAt?: Date | string | number;
    expiresAt?: Date | string | number;
}): MembershipAdmissionGrant {
    // This issuer is a trusted membership attestor configured for the current
    // environment. After the registry upgrade it no longer needs to be the
    // circle_manager admin, but it must still match the configured secret.
    const issuerKeyId = normalizePubkey(
        String(process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID || ''),
        'missing_membership_bridge_issuer_key_id',
    );
    const issuerSecretKey = normalizeSecretKey(
        String(process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET || ''),
        issuerKeyId,
    );
    const nowSeconds = Math.floor(Date.now() / 1000);
    const issuedAt = normalizeUnixSeconds(input.issuedAt, nowSeconds);
    const expiresAt = normalizeUnixSeconds(input.expiresAt, issuedAt + 10 * 60);
    const artifactId = Math.max(0, Math.floor(Number(input.artifactId || 0)));
    const memberPubkey = normalizePubkey(input.memberPubkey, 'invalid_membership_admission_member');
    const role: 'Member' = 'Member';
    const digest = buildMembershipAdmissionDigest({
        circleId: input.circleId,
        memberPubkey,
        role,
        kind: input.kind,
        artifactId,
        issuedAt,
        expiresAt,
    });
    const signature = Buffer.from(nacl.sign.detached(digest, issuerSecretKey)).toString('hex');

    return {
        circleId: input.circleId,
        memberPubkey,
        role,
        kind: input.kind,
        artifactId,
        issuedAt: new Date(issuedAt * 1000).toISOString(),
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        issuerKeyId,
        issuedSignature: signature,
    };
}
