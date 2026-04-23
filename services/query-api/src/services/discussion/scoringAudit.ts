import type { Prisma, PrismaClient } from '@prisma/client';

import { loadDiscussionTopicProfile } from './topicProfile';

// Historical file name kept for Task 10 continuity. The source of truth is now the
// canonical analysis snapshot on circle_discussion_messages, not a separate scorer audit row.

function toNumberOrNull(value: Prisma.Decimal | number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
}

export interface DiscussionAnalysisDiagnosticsSnapshot {
    envelopeId: string;
    circleId: number;
    roomKey: string;
    senderPubkey: string;
    senderHandle: string | null;
    payloadText: string;
    metadata: Prisma.JsonValue | null;
    deleted: boolean;
    createdAt: Date;
    updatedAt: Date;
    analysis: {
        relevanceStatus: string;
        semanticScore: number | null;
        embeddingScore: number | null;
        qualityScore: number | null;
        spamScore: number | null;
        decisionConfidence: number | null;
        relevanceMethod: string | null;
        actualMode: string | null;
        analysisVersion: string | null;
        topicProfileVersion: string | null;
        semanticFacets: string[];
        focusScore: number | null;
        focusLabel: string | null;
        isFeatured: boolean;
        featureReason: string | null;
        analysisCompletedAt: Date | null;
        analysisErrorCode: string | null;
        analysisErrorMessage: string | null;
        authorAnnotations: string[];
    };
    topicProfile: {
        currentVersion: string;
        messageVersion: string | null;
        isStale: boolean;
        snapshotText: string;
        sourceDigest: string;
        embeddingAvailable: boolean;
        embeddingModel: string | null;
        embeddingProviderMode: 'builtin' | 'external' | null;
    };
}

export async function loadDiscussionAnalysisDiagnostics(
    prisma: PrismaClient,
    envelopeId: string,
): Promise<DiscussionAnalysisDiagnosticsSnapshot | null> {
    const row = await prisma.circleDiscussionMessage.findUnique({
        where: { envelopeId },
        select: {
            envelopeId: true,
            circleId: true,
            roomKey: true,
            senderPubkey: true,
            senderHandle: true,
            payloadText: true,
            metadata: true,
            deleted: true,
            createdAt: true,
            updatedAt: true,
            relevanceStatus: true,
            semanticScore: true,
            embeddingScore: true,
            qualityScore: true,
            spamScore: true,
            decisionConfidence: true,
            relevanceMethod: true,
            actualMode: true,
            analysisVersion: true,
            topicProfileVersion: true,
            semanticFacets: true,
            focusScore: true,
            focusLabel: true,
            isFeatured: true,
            featureReason: true,
            analysisCompletedAt: true,
            analysisErrorCode: true,
            analysisErrorMessage: true,
            authorAnnotations: true,
        } as const,
    } as any) as {
        envelopeId: string;
        circleId: number;
        roomKey: string;
        senderPubkey: string;
        senderHandle: string | null;
        payloadText: string;
        metadata: Prisma.JsonValue | null;
        deleted: boolean;
        createdAt: Date;
        updatedAt: Date;
        relevanceStatus: string;
        semanticScore: Prisma.Decimal | number | string | null;
        embeddingScore: Prisma.Decimal | number | string | null;
        qualityScore: Prisma.Decimal | number | string | null;
        spamScore: Prisma.Decimal | number | string | null;
        decisionConfidence: Prisma.Decimal | number | string | null;
        relevanceMethod: string | null;
        actualMode: string | null;
        analysisVersion: string | null;
        topicProfileVersion: string | null;
        semanticFacets: Prisma.JsonValue | null;
        focusScore: Prisma.Decimal | number | string | null;
        focusLabel: string | null;
        isFeatured: boolean;
        featureReason: string | null;
        analysisCompletedAt: Date | null;
        analysisErrorCode: string | null;
        analysisErrorMessage: string | null;
        authorAnnotations: Prisma.JsonValue | null;
    } | null;

    if (!row) {
        return null;
    }

    const topicProfile = await loadDiscussionTopicProfile(prisma, row.circleId);

    return {
        envelopeId: row.envelopeId,
        circleId: row.circleId,
        roomKey: row.roomKey,
        senderPubkey: row.senderPubkey,
        senderHandle: row.senderHandle,
        payloadText: row.payloadText,
        metadata: row.metadata,
        deleted: row.deleted,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        analysis: {
            relevanceStatus: row.relevanceStatus,
            semanticScore: toNumberOrNull(row.semanticScore),
            embeddingScore: toNumberOrNull(row.embeddingScore),
            qualityScore: toNumberOrNull(row.qualityScore),
            spamScore: toNumberOrNull(row.spamScore),
            decisionConfidence: toNumberOrNull(row.decisionConfidence),
            relevanceMethod: row.relevanceMethod,
            actualMode: row.actualMode,
            analysisVersion: row.analysisVersion,
            topicProfileVersion: row.topicProfileVersion,
            semanticFacets: toStringArray(row.semanticFacets),
            focusScore: toNumberOrNull(row.focusScore),
            focusLabel: row.focusLabel,
            isFeatured: row.isFeatured,
            featureReason: row.featureReason,
            analysisCompletedAt: row.analysisCompletedAt,
            analysisErrorCode: row.analysisErrorCode,
            analysisErrorMessage: row.analysisErrorMessage,
            authorAnnotations: toStringArray(row.authorAnnotations),
        },
        topicProfile: {
            currentVersion: topicProfile.topicProfileVersion,
            messageVersion: row.topicProfileVersion,
            isStale: row.relevanceStatus === 'stale'
                || row.topicProfileVersion !== topicProfile.topicProfileVersion,
            snapshotText: topicProfile.snapshotText,
            sourceDigest: topicProfile.sourceDigest,
            embeddingAvailable: Array.isArray(topicProfile.embedding) && topicProfile.embedding.length > 0,
            embeddingModel: topicProfile.embeddingModel,
            embeddingProviderMode: topicProfile.embeddingProviderMode,
        },
    };
}
