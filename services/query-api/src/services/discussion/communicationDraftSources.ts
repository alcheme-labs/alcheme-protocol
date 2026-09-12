import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import type { InitialDraftSourceMessage } from '../../ai/discussion-initial-draft';
import {
    assertCommunicationMessageCoveredByGrant,
} from '../communication/contributionGrant';
import { computeCommunicationPayloadHash } from '../communication/payloadHash';

type PrismaLike = PrismaClient;

export class CommunicationDraftSourceError extends Error {
    readonly statusCode: number;

    constructor(readonly code: string, statusCode = 409) {
        super(code);
        this.name = 'CommunicationDraftSourceError';
        this.statusCode = statusCode;
    }
}

export interface AuthorizedCommunicationDraftSources {
    sourceMaterialIds: number[];
    sourceMessageIds: string[];
    sourceMessages: InitialDraftSourceMessage[];
    externalAppId: string;
    roomKey: string;
}

function normalizePositiveIds(values: readonly unknown[]): number[] {
    const seen = new Set<number>();
    for (const value of values) {
        const id = Number(value);
        if (Number.isSafeInteger(id) && id > 0) seen.add(id);
    }
    return Array.from(seen);
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export async function loadAuthorizedCommunicationDraftSources(
    prisma: PrismaLike,
    input: {
        circleId: number;
        sourceMaterialIds: number[];
        now?: Date;
    },
): Promise<AuthorizedCommunicationDraftSources> {
    const sourceMaterialIds = normalizePositiveIds(input.sourceMaterialIds);
    if (sourceMaterialIds.length === 0) {
        throw new CommunicationDraftSourceError('draft_candidate_missing_source_materials', 400);
    }
    const materials = await prisma.sourceMaterial.findMany({
        where: { id: { in: sourceMaterialIds } },
        select: {
            id: true,
            circleId: true,
            draftPostId: true,
            originType: true,
            originRef: true,
            externalAppId: true,
            roomKey: true,
            lifecycleStatus: true,
            contentDigest: true,
            provenance: true,
        },
    });
    const byId = new Map(materials.map((material) => [material.id, material]));
    if (sourceMaterialIds.some((id) => !byId.has(id))) {
        throw new CommunicationDraftSourceError('source_material_not_found', 404);
    }
    const orderedMaterials = sourceMaterialIds.map((id) => byId.get(id)!);
    const first = orderedMaterials[0];
    const externalAppId = String(first.externalAppId || '').trim();
    const roomKey = String(first.roomKey || '').trim();
    if (!externalAppId || !roomKey) {
        throw new CommunicationDraftSourceError('communication_source_scope_missing');
    }
    for (const material of orderedMaterials) {
        if (
            material.circleId !== input.circleId
            || material.originType !== 'communication_message'
            || !material.originRef
            || material.externalAppId !== externalAppId
            || material.roomKey !== roomKey
        ) {
            throw new CommunicationDraftSourceError('communication_source_scope_mismatch', 403);
        }
        if (material.draftPostId !== null) {
            throw new CommunicationDraftSourceError('source_material_already_bound_to_draft');
        }
        if (material.lifecycleStatus !== 'accepted_to_plaza') {
            throw new CommunicationDraftSourceError('source_material_not_accepted_for_draft');
        }
    }

    const sourceMessageIds = orderedMaterials.map((material) => material.originRef!);
    const messageRows = await prisma.communicationMessage.findMany({
        where: { envelopeId: { in: sourceMessageIds } },
        orderBy: [{ lamport: 'asc' }, { id: 'asc' }],
    });
    const messageById = new Map(messageRows.map((message) => [message.envelopeId, message]));
    const sessionIds = Array.from(new Set(messageRows
        .map((message) => message.sessionId)
        .filter((value): value is string => Boolean(value))));
    const sessions = await prisma.communicationSession.findMany({
        where: { sessionId: { in: sessionIds } },
    });
    const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
    const now = input.now ?? new Date();
    const sourceMessages: InitialDraftSourceMessage[] = [];

    for (const material of orderedMaterials) {
        const message = messageById.get(material.originRef!);
        if (!message) {
            throw new CommunicationDraftSourceError('communication_message_not_found', 404);
        }
        if (
            message.roomKey !== roomKey
            || message.messageKind !== 'plain'
            || !message.payloadText?.trim()
            || message.deleted
            || message.hidden
            || (message.expiresAt && message.expiresAt.getTime() <= now.getTime())
        ) {
            throw new CommunicationDraftSourceError('communication_message_unavailable');
        }
        const payloadHash = computeCommunicationPayloadHash({
            roomKey: message.roomKey,
            senderPubkey: message.senderPubkey,
            messageKind: message.messageKind,
            text: message.payloadText,
            metadata: message.metadata,
            storageUri: message.storageUri,
            durationMs: message.durationMs,
        });
        if (
            payloadHash !== message.payloadHash
            || material.contentDigest !== sha256Hex(message.payloadText.trim())
        ) {
            throw new CommunicationDraftSourceError('communication_source_content_mismatch');
        }
        if (!message.sessionId) {
            throw new CommunicationDraftSourceError('communication_message_contribution_not_authorized', 403);
        }
        const session = sessionById.get(message.sessionId);
        if (!session) {
            throw new CommunicationDraftSourceError('communication_message_session_not_found', 403);
        }
        const grant = assertCommunicationMessageCoveredByGrant({
            session,
            message,
            externalAppId,
            circleId: input.circleId,
        });
        const provenance = material.provenance && typeof material.provenance === 'object' && !Array.isArray(material.provenance)
            ? material.provenance as Record<string, unknown>
            : null;
        if (
            provenance?.originMessageSenderPubkey !== message.senderPubkey
            || provenance?.originMessagePayloadHash !== message.payloadHash
            || provenance?.contributionGrantDigest !== grant.digest
        ) {
            throw new CommunicationDraftSourceError('communication_source_provenance_mismatch');
        }
        sourceMessages.push({
            envelopeId: message.envelopeId,
            senderPubkey: message.senderPubkey,
            senderHandle: message.senderHandle,
            messageKind: 'plain',
            metadataDigest: null,
            interactionResult: null,
            payloadText: message.payloadText.trim(),
            payloadHash: message.payloadHash,
            lamport: message.lamport,
            createdAt: message.createdAt,
            relevanceStatus: 'ready',
            semanticScore: 1,
            focusScore: 1,
            qualityScore: 0.5,
            spamScore: 0,
            decisionConfidence: 0.5,
            relevanceMethod: 'communication_authorized',
            semanticFacets: [],
            authorAnnotations: [],
        });
    }

    return {
        sourceMaterialIds,
        sourceMessageIds,
        sourceMessages,
        externalAppId,
        roomKey,
    };
}
