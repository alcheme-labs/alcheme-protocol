import type { PrismaClient } from '@prisma/client';

import { buildPrivateTextLocator, storePrivateText } from '../privateContentBridge';
import {
    normalizeSourceMaterialUpload,
    sha256Hex,
    type SourceMaterialUploadInput,
} from './uploadBridge';

export interface SourceMaterialIngestChunk {
    chunkIndex: number;
    locatorType: 'chunk';
    locatorRef: string;
    text: string;
    textDigest: string;
}

export interface SourceMaterialIngestPlan {
    extractedText: string;
    material: {
        name: string;
        mimeType: string | null;
        byteSize: number;
        extractionStatus: 'ready';
        contentDigest: string;
    };
    chunks: SourceMaterialIngestChunk[];
}

export interface SourceMaterialPlaintextCustody {
    publicNodePersistence: 'digest_locator_and_provenance_metadata';
    privatePlaintextStorage: 'trusted_private_store';
    groundingReadPath: 'authorized_private_fetch_bridge';
}

export const SOURCE_MATERIAL_PLAINTEXT_CUSTODY: SourceMaterialPlaintextCustody = {
    publicNodePersistence: 'digest_locator_and_provenance_metadata',
    privatePlaintextStorage: 'trusted_private_store',
    groundingReadPath: 'authorized_private_fetch_bridge',
};

function splitIntoGroundingChunks(content: string): string[] {
    return String(content || '')
        .split(/\n\s*\n/g)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
}

export function buildSourceMaterialIngestPlan(input: SourceMaterialUploadInput): SourceMaterialIngestPlan {
    const normalized = normalizeSourceMaterialUpload(input);
    const extractedText = normalized.content;
    const chunks = splitIntoGroundingChunks(extractedText).map((text, index) => ({
        chunkIndex: index,
        locatorType: 'chunk' as const,
        locatorRef: `chunk:${index + 1}`,
        text,
        textDigest: sha256Hex(text),
    }));

    return {
        extractedText,
        material: {
            name: normalized.name,
            mimeType: normalized.mimeType,
            byteSize: normalized.byteSize,
            extractionStatus: 'ready',
            contentDigest: sha256Hex(extractedText),
        },
        chunks,
    };
}

export async function createSourceMaterial(
    prisma: PrismaClient,
    input: {
        circleId: number;
        uploadedByUserId: number;
        draftPostId?: number | null;
        discussionThreadId?: string | null;
        seededSourceNodeId?: number | null;
        name: string;
        mimeType?: string | null;
        content: string;
    },
): Promise<{
    id: number;
    circleId: number;
    draftPostId: number | null;
    discussionThreadId: string | null;
    seededSourceNodeId: number | null;
    name: string;
    mimeType: string | null;
    status: 'ai_readable';
    contentDigest: string;
    chunkCount: number;
}> {
    const plan = buildSourceMaterialIngestPlan({
        name: input.name,
        mimeType: input.mimeType,
        content: input.content,
    });
    const rawTextLocator = buildPrivateTextLocator(
        'source-material',
        'raw',
        plan.material.contentDigest,
    );
    await storePrivateText({
        locator: rawTextLocator,
        content: plan.extractedText,
    });
    const chunkStorage = await Promise.all(plan.chunks.map(async (chunk) => {
        const textLocator = buildPrivateTextLocator(
            'source-material',
            'chunk',
            chunk.textDigest,
        );
        await storePrivateText({
            locator: textLocator,
            content: chunk.text,
        });
        return {
            ...chunk,
            textLocator,
        };
    }));

    return prisma.$transaction(async (tx) => {
        const created = await (tx as any).sourceMaterial.create({
            data: {
                circleId: input.circleId,
                uploadedByUserId: input.uploadedByUserId,
                draftPostId: input.draftPostId ?? null,
                discussionThreadId: input.discussionThreadId ?? null,
                seededSourceNodeId: input.seededSourceNodeId ?? null,
                name: plan.material.name,
                mimeType: plan.material.mimeType,
                byteSize: plan.material.byteSize,
                extractionStatus: plan.material.extractionStatus,
                rawText: null,
                rawTextLocator,
                contentDigest: plan.material.contentDigest,
            },
            select: {
                id: true,
                circleId: true,
                draftPostId: true,
                discussionThreadId: true,
                seededSourceNodeId: true,
                name: true,
                mimeType: true,
                contentDigest: true,
            },
        });

        for (const chunk of chunkStorage) {
            await (tx as any).sourceMaterialChunk.create({
                data: {
                    sourceMaterialId: created.id,
                    chunkIndex: chunk.chunkIndex,
                    locatorType: chunk.locatorType,
                    locatorRef: chunk.locatorRef,
                    text: '',
                    textLocator: chunk.textLocator,
                    textDigest: chunk.textDigest,
                },
            });
        }

        return {
            id: created.id,
            circleId: created.circleId,
            draftPostId: created.draftPostId,
            discussionThreadId: created.discussionThreadId,
            seededSourceNodeId: created.seededSourceNodeId,
            name: created.name,
            mimeType: created.mimeType,
            status: 'ai_readable' as const,
            contentDigest: created.contentDigest,
            chunkCount: plan.chunks.length,
        };
    });
}
