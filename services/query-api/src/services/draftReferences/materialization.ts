import type { PrismaClient } from '@prisma/client';

import * as draftReferenceReadModel from './readModel';
import type {
    ReferenceMaterializationClient,
    ReferenceMaterializationInput,
} from './referenceMaterializationClient';
import { ReferenceMaterializationClientError } from './referenceMaterializationClient';

export class DraftReferenceMaterializationError extends Error {
    constructor(
        public readonly code:
            | 'draft_reference_unresolved'
            | 'draft_reference_ambiguous'
            | 'draft_reference_self_reference'
            | 'reference_materialization_failed',
        message: string,
        public readonly details?: unknown,
        public readonly causeError?: unknown,
    ) {
        super(message);
        this.name = 'DraftReferenceMaterializationError';
    }
}

export interface DraftReferenceMaterializationResult {
    attempted: number;
    succeeded: number;
    skipped: number;
    signatures: string[];
}

function uniqueReferences(
    references: ReferenceMaterializationInput[],
): ReferenceMaterializationInput[] {
    const seen = new Set<string>();
    const deduped: ReferenceMaterializationInput[] = [];
    for (const reference of references) {
        const key = `${reference.sourceOnChainAddress}:${reference.targetOnChainAddress}:${reference.referenceType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(reference);
    }
    return deduped;
}

export async function materializeDraftCrystalReferencesOrThrow(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        targetKnowledgeId: string;
        targetOnChainAddress: string;
        requestedByUserId: number | null;
        referenceClient: ReferenceMaterializationClient;
    },
): Promise<DraftReferenceMaterializationResult> {
    const links = await draftReferenceReadModel.loadDraftReferenceLinks(prisma, input.draftPostId);
    if (links.length === 0) {
        return {
            attempted: 0,
            succeeded: 0,
            skipped: 0,
            signatures: [],
        };
    }

    const unresolved = links.filter((link) => link.resolutionStatus === 'not_found');
    if (unresolved.length > 0) {
        throw new DraftReferenceMaterializationError(
            'draft_reference_unresolved',
            'One or more crystal references could not be resolved.',
            unresolved.map((link) => ({
                referenceId: link.referenceId,
                crystalName: link.crystalName,
            })),
        );
    }

    const ambiguous = links.filter((link) => link.resolutionStatus === 'ambiguous');
    if (ambiguous.length > 0) {
        throw new DraftReferenceMaterializationError(
            'draft_reference_ambiguous',
            'One or more crystal references are ambiguous.',
            ambiguous.map((link) => ({
                referenceId: link.referenceId,
                crystalName: link.crystalName,
            })),
        );
    }

    const resolvedReferences: ReferenceMaterializationInput[] = links.map((link) => {
        if (
            !link.sourceKnowledgeId
            || !link.sourceOnChainAddress
        ) {
            throw new DraftReferenceMaterializationError(
                'draft_reference_unresolved',
                'A resolved crystal reference is missing source knowledge identity.',
                {
                    referenceId: link.referenceId,
                    crystalName: link.crystalName,
                },
            );
        }
        if (
            link.sourceKnowledgeId === input.targetKnowledgeId
            || link.sourceOnChainAddress === input.targetOnChainAddress
        ) {
            throw new DraftReferenceMaterializationError(
                'draft_reference_self_reference',
                'A crystallized draft cannot cite itself.',
                {
                    referenceId: link.referenceId,
                    crystalName: link.crystalName,
                    targetKnowledgeId: input.targetKnowledgeId,
                },
            );
        }
        return {
            sourceOnChainAddress: input.targetOnChainAddress,
            targetOnChainAddress: link.sourceOnChainAddress,
            referenceType: 'citation',
        };
    });

    const deduped = uniqueReferences(resolvedReferences);
    try {
        const signatures = await input.referenceClient.addReferences(deduped);
        return {
            attempted: deduped.length,
            succeeded: deduped.length,
            skipped: resolvedReferences.length - deduped.length,
            signatures,
        };
    } catch (error) {
        const message = error instanceof ReferenceMaterializationClientError
            && error.code === 'reference_materialization_config_invalid'
            ? 'Crystal reference sync is not configured for this node.'
            : 'Crystal references failed to sync on chain.';
        throw new DraftReferenceMaterializationError(
            'reference_materialization_failed',
            message,
            {
                draftPostId: input.draftPostId,
                targetKnowledgeId: input.targetKnowledgeId,
                requestedByUserId: input.requestedByUserId,
            },
            error,
        );
    }
}
