import type { AiJobType } from '../aiJobs/types';

export type AiOperatingLayerTaskStatus = 'current' | 'reserve' | 'future';

export type AiExecutionStrategy =
    | 'llm_structured_generate'
    | 'rule_then_llm_boundary_judge'
    | 'embedding_retrieval'
    | 'statistics_score'
    | 'deterministic_only';

export type AiCapability =
    | 'text.generate'
    | 'text.structure'
    | 'text.embed'
    | 'text.classify';

export interface AiTaskCatalogEntry {
    taskType: string;
    catalogVersion: string;
    status: AiOperatingLayerTaskStatus;
    executionStrategy: AiExecutionStrategy;
    requiredCapabilities: AiCapability[];
    allowedProviderProfiles: string[];
    promptVersion: string | null;
    outputSchemaVersion: string;
    currentOwnerPath: string;
    aiJobType: AiJobType | null;
}

export interface AiJobCompatibility {
    jobType: AiJobType;
    modelTask: boolean;
    asyncDomainTask: boolean;
    taskType: string | null;
    taskCatalogVersion: string | null;
    executionStrategy: AiExecutionStrategy | 'domain_async';
    requiredCapabilities: AiCapability[];
}

export type EvidenceSourceType =
    | 'source_material'
    | 'seeded_source'
    | 'formal_reference'
    | 'draft_issue'
    | 'domain_artifact'
    | 'trend_receipt';

export type EvidenceVisibility =
    | 'public'
    | 'member_visible'
    | 'reviewer_only'
    | 'sealed'
    | 'redacted';

export interface EvidenceRef {
    sourceType: EvidenceSourceType;
    sourceId: string;
    digest: string;
    visibility: EvidenceVisibility;
    locator: {
        type: string;
        ref: string;
    };
    permissionSnapshot: Record<string, unknown>;
    capturedAt: string;
    expiresAt: string | null;
}

export type AiRuntimeRole = 'PUBLIC_NODE' | 'PRIVATE_SIDECAR' | 'TEST';

export interface ContextCapsule {
    id: string;
    taskType: string;
    subjectType: string;
    subjectId: string;
    actorUserId: number | null;
    visibility: string;
    runtimeRole: AiRuntimeRole;
    sourceDigest: string;
    contextDigest: string;
    sourceRefs: EvidenceRef[];
    contextPayload: Record<string, unknown>;
    excerptPolicy: Record<string, unknown>;
    redactionReport: Record<string, unknown>[];
    tokenBudget: Record<string, unknown>;
    privatePlaintextMode: string;
    createdAt: string;
}
