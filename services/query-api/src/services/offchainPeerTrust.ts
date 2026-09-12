import { createHash } from 'node:crypto';

import nacl from 'tweetnacl';

import type { DiscussionRow } from './discussion/messagesReadModel';

export interface TrustedOffchainPeer {
    peerId: string;
    baseUrl: string;
    deploymentId: string;
    publicKeyBase64: string;
    scopes: string[];
}

export interface SignedDiscussionStreamBatch {
    version: 1;
    peerId: string;
    deploymentId: string;
    streamKey: string;
    afterLamport: string;
    nextAfterLamport: string;
    issuedAt: string;
    expiresAt: string;
    messages: unknown[];
    rootHash: string;
    signatureBase64: string;
}

export interface OffchainDiscussionExportRow extends DiscussionRow {
    signedMessage: string;
}

export class OffchainExportSigningUnconfiguredError extends Error {
    constructor() {
        super('offchain_export_signing_unconfigured');
        this.name = 'OffchainExportSigningUnconfiguredError';
    }
}

type SignedDiscussionStreamBatchVerificationContext = Date | {
    now?: Date;
    streamKey?: string;
    afterLamport?: string;
};

function normalizePeerBaseUrl(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        const path = parsed.pathname.replace(/\/+$/, '');
        return `${parsed.protocol}//${parsed.host}${path}`;
    } catch {
        return null;
    }
}

function normalizeScopes(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((scope) => String(scope || '').trim())
        .filter(Boolean)));
}

export function parseTrustedOffchainPeers(
    raw = process.env.OFFCHAIN_DISCUSSION_TRUSTED_PEERS || '',
): TrustedOffchainPeer[] {
    if (!raw.trim()) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const peers = parsed.flatMap((item): TrustedOffchainPeer[] => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        const peerId = String(record.peerId || '').trim();
        const baseUrl = normalizePeerBaseUrl(String(record.baseUrl || ''));
        const deploymentId = String(record.deploymentId || '').trim();
        const publicKeyBase64 = String(record.publicKeyBase64 || '').trim();
        const scopes = normalizeScopes(record.scopes);
        if (!peerId || !baseUrl || !deploymentId || !publicKeyBase64) return [];
        if (!decodeFixedBase64(publicKeyBase64, 32)) return [];
        if (!scopes.includes('discussion_stream')) return [];
        return [{
            peerId,
            baseUrl,
            deploymentId,
            publicKeyBase64,
            scopes,
        }];
    });

    const seen = new Set<string>();
    return peers.filter((peer) => {
        const key = `${peer.peerId}\n${peer.baseUrl}\n${peer.deploymentId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
        .join(',')}}`;
}

export function canonicalSignedBatchPayload(
    batch: Omit<SignedDiscussionStreamBatch, 'signatureBase64'>,
): string {
    return `alcheme-discussion-stream-batch:${canonicalJson(batch)}`;
}

export function computeDiscussionStreamBatchRoot(messages: unknown[]): string {
    return createHash('sha256')
        .update(canonicalJson(messages))
        .digest('hex');
}

function decodeFixedBase64(value: string, expectedLength: number): Buffer | null {
    try {
        const decoded = Buffer.from(value, 'base64');
        return decoded.length === expectedLength ? decoded : null;
    } catch {
        return null;
    }
}

export function verifySignedDiscussionStreamBatch(
    peer: TrustedOffchainPeer,
    batch: SignedDiscussionStreamBatch,
    context: SignedDiscussionStreamBatchVerificationContext = new Date(),
): boolean {
    try {
        const now = context instanceof Date ? context : context.now ?? new Date();
        if (batch.version !== 1) return false;
        if (batch.peerId !== peer.peerId) return false;
        if (batch.deploymentId !== peer.deploymentId) return false;
        if (!(context instanceof Date) && context.streamKey && batch.streamKey !== context.streamKey) return false;
        if (!(context instanceof Date) && context.afterLamport && batch.afterLamport !== context.afterLamport) return false;
        if (!Array.isArray(batch.messages)) return false;
        const issuedMs = Date.parse(batch.issuedAt);
        const expiresMs = Date.parse(batch.expiresAt);
        const nowMs = now.getTime();
        if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) return false;
        if (expiresMs <= nowMs) return false;
        if (issuedMs > nowMs + 30_000) return false;
        if (batch.rootHash !== computeDiscussionStreamBatchRoot(batch.messages)) return false;
        const publicKey = decodeFixedBase64(peer.publicKeyBase64, 32);
        const signature = decodeFixedBase64(batch.signatureBase64, 64);
        if (!publicKey || !signature) return false;
        const { signatureBase64: _signatureBase64, ...payload } = batch;
        const message = new TextEncoder().encode(canonicalSignedBatchPayload(payload));
        return nacl.sign.detached.verify(message, signature, publicKey);
    } catch {
        return false;
    }
}

function signCanonicalPeerPayload(
    payload: Omit<SignedDiscussionStreamBatch, 'signatureBase64'>,
    signingSecretBase64: string,
): string {
    const secretKey = decodeFixedBase64(signingSecretBase64, 64);
    if (!secretKey) {
        throw new OffchainExportSigningUnconfiguredError();
    }
    const message = new TextEncoder().encode(canonicalSignedBatchPayload(payload));
    return Buffer.from(nacl.sign.detached(message, secretKey)).toString('base64');
}

function dateToIso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decimalToNumber(value: unknown, fallback: number | null): number | null {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
        const parsed = (value as { toNumber: () => number }).toNumber();
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
}

function mapExportRowToSignedPeerMessage(row: OffchainDiscussionExportRow) {
    return {
        envelopeId: row.envelopeId,
        roomKey: row.roomKey,
        circleId: row.circleId,
        senderPubkey: row.senderPubkey,
        senderHandle: row.senderHandle,
        messageKind: row.messageKind,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        metadata: row.metadata,
        forwardBundleCard: null,
        text: row.deleted ? '' : row.payloadText,
        payloadHash: row.payloadHash,
        nonce: row.nonce,
        signature: row.signature,
        signedMessage: row.signedMessage || '',
        signatureVerified: false,
        authMode: row.authMode,
        sessionId: null,
        relevanceScore: decimalToNumber(row.relevanceScore, 1),
        semanticScore: decimalToNumber(row.semanticScore, null),
        qualityScore: decimalToNumber(row.qualityScore, null),
        spamScore: decimalToNumber(row.spamScore, null),
        decisionConfidence: decimalToNumber(row.decisionConfidence, null),
        relevanceMethod: row.relevanceMethod,
        relevanceStatus: row.relevanceStatus,
        embeddingScore: decimalToNumber(row.embeddingScore, null),
        actualMode: row.actualMode,
        analysisVersion: row.analysisVersion,
        topicProfileVersion: row.topicProfileVersion,
        semanticFacets: row.semanticFacets,
        focusScore: decimalToNumber(row.focusScore, null),
        focusLabel: row.focusLabel,
        analysisCompletedAt: dateToIso(row.analysisCompletedAt),
        analysisErrorCode: row.analysisErrorCode,
        analysisErrorMessage: row.analysisErrorMessage,
        authorAnnotations: row.authorAnnotations,
        isFeatured: row.isFeatured,
        featureReason: row.featureReason,
        featuredAt: dateToIso(row.featuredAt),
        isEphemeral: row.isEphemeral,
        expiresAt: dateToIso(row.expiresAt),
        clientTimestamp: row.clientTimestamp.toISOString(),
        lamport: Number(row.lamport),
        prevEnvelopeId: row.prevEnvelopeId,
        deleted: row.deleted,
        tombstoneReason: row.tombstoneReason,
        tombstonedAt: dateToIso(row.tombstonedAt),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function nextLamportCursor(rows: readonly OffchainDiscussionExportRow[], fallback: string): string {
    if (rows.length === 0) return fallback;
    const last = rows[rows.length - 1];
    return String(last.lamport);
}

function buildSignedDiscussionStreamBatchForMessages(
    messages: unknown[],
    input: {
        peerId: string;
        deploymentId: string;
        streamKey: string;
        afterLamport: string;
        nextAfterLamport: string;
        signingSecretBase64: string;
        now?: Date;
    },
): SignedDiscussionStreamBatch {
    if (!input.peerId || !input.deploymentId || !input.signingSecretBase64) {
        throw new OffchainExportSigningUnconfiguredError();
    }
    const now = input.now ?? new Date();
    const payload: Omit<SignedDiscussionStreamBatch, 'signatureBase64'> = {
        version: 1,
        peerId: input.peerId,
        deploymentId: input.deploymentId,
        streamKey: input.streamKey,
        afterLamport: input.afterLamport,
        nextAfterLamport: input.nextAfterLamport,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        messages,
        rootHash: computeDiscussionStreamBatchRoot(messages),
    };
    return {
        ...payload,
        signatureBase64: signCanonicalPeerPayload(payload, input.signingSecretBase64),
    };
}

export function buildSignedDiscussionStreamBatch(
    rows: OffchainDiscussionExportRow[],
    input: {
        peerId: string;
        deploymentId: string;
        streamKey: string;
        afterLamport: string;
        signingSecretBase64: string;
        now?: Date;
    },
): SignedDiscussionStreamBatch {
    const messages = rows.map(mapExportRowToSignedPeerMessage);
    return buildSignedDiscussionStreamBatchForMessages(messages, {
        ...input,
        nextAfterLamport: nextLamportCursor(rows, input.afterLamport),
    });
}

export function buildSignedDiscussionStreamBatchFromMessages(
    messages: unknown[],
    input: {
        peerId: string;
        deploymentId: string;
        streamKey: string;
        afterLamport: string;
        nextAfterLamport: string;
        signingSecretBase64: string;
        now?: Date;
    },
): SignedDiscussionStreamBatch {
    return buildSignedDiscussionStreamBatchForMessages(messages, input);
}
