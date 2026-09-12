import type {
    EvidenceRef,
    EvidenceSourceType,
    EvidenceVisibility,
} from '../types';
import type { DraftReferenceLinkRecord } from '../../draftReferences/readModel';

export const SOURCE_GROUNDED_ASK_TASK_TYPE = 'source.grounded_ask.v1';
export const SOURCE_GROUNDED_ASK_SCHEMA_VERSION = 'v1';

export type SourceGroundedAskScope =
    | 'current_circle'
    | 'current_draft'
    | 'source_materials'
    | 'formal_references'
    | 'trend_receipts';

export type SourceGroundedAnswerStatus =
    | 'pending'
    | 'ready'
    | 'no_source'
    | 'failed';

export interface SourceGroundedCitation {
    refId: string;
    sourceType: EvidenceSourceType;
    sourceId: string;
    title: string;
    locator: {
        type: string;
        ref: string;
    };
    visibility: EvidenceVisibility;
    stale: boolean;
    capturedAt: string | null;
    createdAt?: string | null;
    fetchedAt?: string | null;
    expiresAt: string | null;
    sourceStatus?: string | null;
    licenseNote?: string | null;
    note?: string | null;
}

export interface SourceGroundedProviderSource {
    refId: string;
    sourceType: EvidenceSourceType;
    sourceId: string;
    title: string;
    summary: string;
    excerpt: string;
    stale: boolean;
}

export interface SourceGroundedAskSelectionInput {
    circleId: number;
    draftPostId?: number | null;
    scopes?: SourceGroundedAskScope[] | string[] | null;
    sourceMaterialIds?: number[] | null;
    knowledgeIds?: string[] | null;
    trendReceiptIds?: string[] | null;
    includeProviderContext?: boolean;
    now?: Date;
    draftReferenceLinks?: DraftReferenceLinkRecord[] | null;
    maxSources?: number;
}

export interface SourceGroundedAskSelection {
    evidenceRefs: EvidenceRef[];
    citations: SourceGroundedCitation[];
    providerSources: SourceGroundedProviderSource[];
    sourceDigest: string;
    scopeSnapshot: Record<string, unknown>;
    hasSourceMaterial: boolean;
}

export interface SourceGroundedAskContextPayload {
    kind: 'source_grounded_ask.v1';
    answerId: string;
    circleId: number;
    draftPostId: number | null;
    scopes: SourceGroundedAskScope[];
    sourceMaterialIds: number[];
    knowledgeIds: string[];
    trendReceiptIds: string[];
    questionDigest: string;
    locale: string;
    sourceDigest: string;
}
