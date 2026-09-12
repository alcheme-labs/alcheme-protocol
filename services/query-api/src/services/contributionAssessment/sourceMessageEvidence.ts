import crypto from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import {
    getDraftAnchorById,
    type DraftAnchorCanonicalPayload,
    type DraftAnchorRecord,
} from '../draftAnchor';
import type {
    DraftContributorProofRecord,
} from '../contributorProof';
import type {
    ContributionEvidenceRef,
} from './types';
import { computeCommunicationPayloadHash } from '../communication/payloadHash';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const MAX_SOURCE_MESSAGE_EXCERPT_CHARS = 1000;

interface SourceMessageRow {
    envelopeId: string;
    senderPubkey: string;
    payloadText: string;
    payloadHash: string;
    semanticScore: Prisma.Decimal | number | string | null;
    relevanceMethod: string | null;
    messageKind: string | null;
}

interface CommunicationSourceMessageRow {
    envelopeId: string;
    roomKey: string;
    senderPubkey: string;
    payloadText: string | null;
    payloadHash: string;
    messageKind: string;
    metadata: unknown;
    storageUri: string | null;
    durationMs: number | null;
    deleted: boolean;
    hidden: boolean;
}

interface CommunicationSourceMaterialRow {
    id: number;
    originRef: string | null;
    roomKey: string | null;
    contentDigest: string;
    lifecycleStatus: string;
    provenance: unknown;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function normalizeHex64(value: unknown): string | null {
    const normalized = normalizeString(value)?.toLowerCase() || null;
    return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeScore(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const raw = typeof value === 'object' && value && 'toString' in value
        ? String((value as { toString(): string }).toString())
        : String(value);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
}

function isValidPubkey(value: unknown): value is string {
    return canonicalSolanaPublicKeyString(value) !== null;
}

function normalizeExcerpt(value: unknown): string | null {
    const normalized = normalizeString(value);
    if (!normalized) return null;
    return normalized.slice(0, MAX_SOURCE_MESSAGE_EXCERPT_CHARS);
}

function digestRefScope(value: string): string {
    return sha256Hex(value).slice(0, 16);
}

function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function anchorMatchesContributorProof(
    anchor: DraftAnchorRecord,
    contributorProof: DraftContributorProofRecord,
): anchor is DraftAnchorRecord & { canonicalPayload: DraftAnchorCanonicalPayload } {
    if (!anchor.canonicalPayload) return false;
    return anchor.draftPostId === contributorProof.draftPostId
        && anchor.circleId === contributorProof.circleId
        && normalizeHex64(anchor.anchorId) === normalizeHex64(contributorProof.anchorId)
        && normalizeHex64(anchor.payloadHash) === normalizeHex64(contributorProof.payloadHash)
        && normalizeHex64(anchor.summaryHash) === normalizeHex64(contributorProof.summaryHash)
        && normalizeHex64(anchor.messagesDigest) === normalizeHex64(contributorProof.messagesDigest)
        && anchor.canonicalPayload.draftPostId === contributorProof.draftPostId
        && anchor.canonicalPayload.circleId === contributorProof.circleId
        && normalizeHex64(anchor.canonicalPayload.summaryHash) === normalizeHex64(contributorProof.summaryHash)
        && normalizeHex64(anchor.canonicalPayload.messagesDigest) === normalizeHex64(contributorProof.messagesDigest);
}

export async function buildSourceMessageEvidenceRefsForContributorProof(input: {
    prisma: PrismaLike;
    contributorProof: DraftContributorProofRecord;
}): Promise<ContributionEvidenceRef[]> {
    const anchor = await getDraftAnchorById(input.prisma, input.contributorProof.anchorId);
    if (!anchor || !anchorMatchesContributorProof(anchor, input.contributorProof)) {
        return [];
    }

    const anchorMessages = Array.isArray(anchor.canonicalPayload.messages)
        ? anchor.canonicalPayload.messages
        : [];
    const envelopeIds = anchorMessages
        .map((message) => normalizeString(message.envelopeId))
        .filter((value): value is string => Boolean(value));
    if (
        envelopeIds.length !== anchorMessages.length
        || envelopeIds.length === 0
        || new Set(envelopeIds).size !== envelopeIds.length
    ) {
        return [];
    }

    const communicationRefs = await buildCommunicationSourceMessageEvidenceRefs(input.prisma, {
        contributorProof: input.contributorProof,
        anchor,
        envelopeIds,
    });
    if (communicationRefs) return communicationRefs;

    const rows = await input.prisma.circleDiscussionMessage.findMany({
        where: {
            envelopeId: { in: envelopeIds },
            circleId: input.contributorProof.circleId,
            deleted: false,
        },
        select: {
            envelopeId: true,
            senderPubkey: true,
            payloadText: true,
            payloadHash: true,
            semanticScore: true,
            relevanceMethod: true,
            messageKind: true,
        },
    }) as SourceMessageRow[];

    const rowByEnvelopeId = new Map(rows.map((row) => [row.envelopeId, row]));
    const refs: ContributionEvidenceRef[] = [];

    for (const anchorMessage of anchorMessages) {
        const envelopeId = normalizeString(anchorMessage.envelopeId);
        if (!envelopeId) return [];
        const row = rowByEnvelopeId.get(envelopeId);
        if (!row) return [];

        const anchorPayloadHash = normalizeHex64(anchorMessage.payloadHash);
        const rowPayloadHash = normalizeHex64(row.payloadHash);
        if (!anchorPayloadHash || anchorPayloadHash !== rowPayloadHash) return [];
        if (!isValidPubkey(row.senderPubkey)) return [];
        if (row.senderPubkey !== anchorMessage.senderPubkey) return [];
        if (sha256Hex(row.payloadText) !== rowPayloadHash) return [];

        const excerpt = normalizeExcerpt(row.payloadText);
        if (!excerpt) return [];

        refs.push({
            refId: `source-message:${rowPayloadHash}:${digestRefScope(envelopeId)}`,
            refType: 'source_message',
            contributorPubkey: row.senderPubkey,
            hash: rowPayloadHash,
            excerpt,
            stage: 'source_discussion',
            retention: 'retained',
            metadata: {
                semanticScore: normalizeScore(row.semanticScore ?? anchorMessage.semanticScore),
                relevanceMethod: normalizeString(row.relevanceMethod || anchorMessage.relevanceMethod),
                messageKind: normalizeString(row.messageKind),
            },
        });
    }

    return refs;
}

async function buildCommunicationSourceMessageEvidenceRefs(
    prisma: PrismaLike,
    input: {
        contributorProof: DraftContributorProofRecord;
        anchor: DraftAnchorRecord & { canonicalPayload: DraftAnchorCanonicalPayload };
        envelopeIds: string[];
    },
): Promise<ContributionEvidenceRef[] | null> {
    const prismaAny = prisma as any;
    if (
        typeof prismaAny.sourceMaterial?.findMany !== 'function'
        || typeof prismaAny.communicationMessage?.findMany !== 'function'
    ) {
        return null;
    }
    const materials = await prismaAny.sourceMaterial.findMany({
        where: {
            circleId: input.contributorProof.circleId,
            draftPostId: input.contributorProof.draftPostId,
            originType: 'communication_message',
            originRef: { in: input.envelopeIds },
            lifecycleStatus: { in: ['used_in_draft', 'crystallized'] },
        },
        select: {
            id: true,
            originRef: true,
            roomKey: true,
            contentDigest: true,
            lifecycleStatus: true,
            provenance: true,
        },
    }) as CommunicationSourceMaterialRow[];
    if (materials.length === 0) return null;
    if (materials.length !== input.envelopeIds.length) return [];
    const materialByOriginRef = new Map(materials.map((material) => [material.originRef, material]));
    if (materialByOriginRef.size !== materials.length) return [];

    const rows = await prismaAny.communicationMessage.findMany({
        where: {
            envelopeId: { in: input.envelopeIds },
            deleted: false,
            hidden: false,
        },
        select: {
            envelopeId: true,
            roomKey: true,
            senderPubkey: true,
            payloadText: true,
            payloadHash: true,
            messageKind: true,
            metadata: true,
            storageUri: true,
            durationMs: true,
            deleted: true,
            hidden: true,
        },
    }) as CommunicationSourceMessageRow[];
    const rowByEnvelopeId = new Map(rows.map((row) => [row.envelopeId, row]));
    const refs: ContributionEvidenceRef[] = [];
    for (const anchorMessage of input.anchor.canonicalPayload.messages) {
        const envelopeId = normalizeString(anchorMessage.envelopeId);
        if (!envelopeId) return [];
        const row = rowByEnvelopeId.get(envelopeId);
        const material = materialByOriginRef.get(envelopeId);
        if (!row || !material || row.messageKind !== 'plain' || !row.payloadText?.trim()) return [];
        const anchorPayloadHash = normalizeHex64(anchorMessage.payloadHash);
        const rowPayloadHash = normalizeHex64(row.payloadHash);
        const canonicalPayloadHash = computeCommunicationPayloadHash({
            roomKey: row.roomKey,
            senderPubkey: row.senderPubkey,
            messageKind: row.messageKind,
            text: row.payloadText,
            metadata: row.metadata,
            storageUri: row.storageUri,
            durationMs: row.durationMs,
        });
        if (
            !anchorPayloadHash
            || anchorPayloadHash !== rowPayloadHash
            || canonicalPayloadHash !== rowPayloadHash
            || row.senderPubkey !== anchorMessage.senderPubkey
            || !isValidPubkey(row.senderPubkey)
            || row.roomKey !== input.anchor.roomKey
            || material.roomKey !== input.anchor.roomKey
            || material.contentDigest !== sha256Hex(row.payloadText.trim())
        ) return [];
        const provenance = material.provenance && typeof material.provenance === 'object' && !Array.isArray(material.provenance)
            ? material.provenance as Record<string, unknown>
            : null;
        if (
            provenance?.originMessageSenderPubkey !== row.senderPubkey
            || provenance?.originMessagePayloadHash !== row.payloadHash
        ) return [];
        const excerpt = normalizeExcerpt(row.payloadText);
        if (!excerpt) return [];
        refs.push({
            refId: `source-message:${rowPayloadHash}:${digestRefScope(envelopeId)}`,
            refType: 'source_message',
            contributorPubkey: row.senderPubkey,
            hash: rowPayloadHash,
            excerpt,
            stage: 'source_discussion',
            retention: 'retained',
            metadata: {
                semanticScore: normalizeScore(anchorMessage.semanticScore),
                relevanceMethod: normalizeString(anchorMessage.relevanceMethod),
                messageKind: row.messageKind,
                sourceCarrier: 'communication_message',
                sourceMaterialId: material.id,
            },
        });
    }
    return refs;
}
