import crypto from 'crypto';

import {
    buildContextCapsule,
    persistContextCapsule,
} from '../aiOperatingLayer/contextFabric';
import type { EvidenceRef } from '../aiOperatingLayer/types';
import {
    KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
    KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
    type KnowledgeRelationshipCoverageAuditPayload,
    type KnowledgeRelationshipLabelCatalogItem,
    type KnowledgeRelationshipLabelClassificationPayload,
    type KnowledgeRelationshipSnapshot,
} from './types';

const CONTEXT_TTL_MS = 30 * 60 * 1000;
const MAX_SOURCE_KNOWLEDGE = 8;
const MAX_RECENT_ASSIGNMENTS = 40;

export async function persistKnowledgeRelationshipLabelClassificationContext(input: {
    prisma: any;
    knowledgeId: string;
    sourceDraftId?: string | null;
    now?: Date;
}): Promise<{
    capsuleId: string;
    contextDigest: string;
    sourceDigest: string;
    payload: KnowledgeRelationshipLabelClassificationPayload;
}> {
    const now = input.now ?? new Date();
    const knowledgeId = normalizeString(input.knowledgeId);
    if (!knowledgeId) throw new Error('knowledge_relationship_label_context_missing_knowledge_id');

    const knowledge = await input.prisma.knowledge.findUnique({
        where: { knowledgeId },
        select: {
            knowledgeId: true,
            circleId: true,
            title: true,
            description: true,
            contentHash: true,
            version: true,
            createdAt: true,
        },
    });
    if (!knowledge) throw new Error('knowledge_relationship_label_context_knowledge_not_found');

    const [activeLabels, sourceKnowledge, sourceDraft] = await Promise.all([
        loadActiveLabelCatalog(input.prisma),
        loadSourceKnowledge(input.prisma, knowledge.circleId, knowledge.knowledgeId),
        loadSourceDraft(input.prisma, input.sourceDraftId),
    ]);

    const payload: KnowledgeRelationshipLabelClassificationPayload = {
        kind: 'knowledge_relationship_label_classification.v1',
        circleId: Number(knowledge.circleId),
        knowledge: toKnowledgeSnapshot(knowledge),
        sourceDraft,
        sourceKnowledge,
        acceptedIssues: [],
        evidenceSummary: {
            sourceDigest: normalizeHex(knowledge.contentHash) || null,
            sourceKnowledgeCount: sourceKnowledge.length,
            sourceDraftBound: Boolean(sourceDraft.sourceDraftId),
        },
        activeLabelCatalog: activeLabels,
    };
    const evidenceRefs = [
        buildKnowledgeEvidenceRef(payload.circleId, payload.knowledge, now),
        ...payload.sourceKnowledge.map((item) => buildKnowledgeEvidenceRef(payload.circleId, item, now)),
        sourceDraft.postId
            ? buildDraftEvidenceRef(payload.circleId, sourceDraft.postId, sourceDraft.contentHash, now)
            : null,
    ].filter((item): item is EvidenceRef => Boolean(item));

    const capsule = buildContextCapsule({
        taskType: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
        subjectType: 'knowledge',
        subjectId: knowledgeId,
        actorUserId: null,
        visibility: 'public_protocol',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs,
        contextPayload: payload as unknown as Record<string, unknown>,
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'knowledge_relationship_label_v1',
        },
        tokenBudget: {
            maxInputTokens: 1400,
            maxOutputTokens: 500,
            maxEvidenceRefs: evidenceRefs.length,
        },
        privatePlaintextMode: 'public_protocol',
    });
    if (!capsule.ok) {
        throw new Error(`knowledge_relationship_label_context_rejected:${capsule.error}`);
    }

    await persistContextCapsule(input.prisma, capsule.capsule, {
        cacheKey: `knowledge_relationship_label:${knowledgeId}:${capsule.capsule.contextDigest}`,
        expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS),
    });
    return {
        capsuleId: capsule.capsule.id,
        contextDigest: capsule.capsule.contextDigest,
        sourceDigest: capsule.capsule.sourceDigest,
        payload,
    };
}

export async function persistKnowledgeRelationshipCoverageAuditContext(input: {
    prisma: any;
    circleId?: number | null;
    now?: Date;
}): Promise<{
    capsuleId: string;
    contextDigest: string;
    sourceDigest: string;
    payload: KnowledgeRelationshipCoverageAuditPayload;
}> {
    const now = input.now ?? new Date();
    const circleId = normalizePositiveInt(input.circleId);
    const [activeLabels, recentAssignments] = await Promise.all([
        loadActiveLabelCatalog(input.prisma),
        loadRecentAssignments(input.prisma, circleId),
    ]);
    const assignmentStats = summarizeAssignments(recentAssignments, activeLabels);
    const payload: KnowledgeRelationshipCoverageAuditPayload = {
        kind: 'knowledge_relationship_label_coverage_audit.v1',
        scope: {
            type: circleId ? 'circle' : 'system',
            circleId,
        },
        activeLabelCatalog: activeLabels,
        assignmentStats,
        recentAssignmentSamples: recentAssignments.slice(0, MAX_RECENT_ASSIGNMENTS).map((row) => ({
            knowledgeId: normalizeString(row.knowledgeId),
            labelKey: normalizeString(row.labelKey),
            assignedBy: normalizeString(row.assignedBy),
            confidence: normalizeConfidence(row.confidence),
        })),
    };
    const evidenceRefs = activeLabels.map((label) => ({
        sourceType: 'domain_artifact',
        sourceId: `knowledge_relationship_label:${label.key}`,
        digest: digestHex(label),
        visibility: 'public',
        locator: {
            type: 'knowledge_relationship_label',
            ref: label.key,
        },
        permissionSnapshot: {
            metadataOnly: true,
            scope: payload.scope.type,
            circleId,
        },
        capturedAt: now.toISOString(),
        expiresAt: null,
    } satisfies EvidenceRef));

    const capsule = buildContextCapsule({
        taskType: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
        subjectType: payload.scope.type,
        subjectId: circleId ? String(circleId) : 'system',
        actorUserId: null,
        visibility: 'public_protocol',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs,
        contextPayload: payload as unknown as Record<string, unknown>,
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'knowledge_relationship_coverage_v1',
        },
        tokenBudget: {
            maxInputTokens: 1600,
            maxOutputTokens: 800,
            maxEvidenceRefs: evidenceRefs.length,
        },
        privatePlaintextMode: 'public_protocol',
    });
    if (!capsule.ok) {
        throw new Error(`knowledge_relationship_coverage_context_rejected:${capsule.error}`);
    }

    await persistContextCapsule(input.prisma, capsule.capsule, {
        cacheKey: `knowledge_relationship_coverage:${payload.scope.type}:${payload.scope.circleId ?? 'system'}:${capsule.capsule.contextDigest}`,
        expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS),
    });
    return {
        capsuleId: capsule.capsule.id,
        contextDigest: capsule.capsule.contextDigest,
        sourceDigest: capsule.capsule.sourceDigest,
        payload,
    };
}

export async function loadKnowledgeRelationshipLabelClassificationContext(
    prisma: any,
    input: {
        contextCapsuleId: string | null | undefined;
        expectedKnowledgeId?: string | null;
        now?: Date;
    },
): Promise<{
    capsuleId: string;
    subjectId: string;
    sourceDigest: string;
    contextDigest: string;
    payload: KnowledgeRelationshipLabelClassificationPayload;
    evidenceRefs: EvidenceRef[];
    expiresAt: Date | null;
}> {
    const row = await loadContextCapsuleRow(prisma, input.contextCapsuleId);
    if (String(row.taskType || row.task_type || '') !== KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE) {
        throw new Error('context_capsule_task_mismatch');
    }
    const subjectId = normalizeString(row.subjectId ?? row.subject_id);
    if (input.expectedKnowledgeId && subjectId !== input.expectedKnowledgeId) {
        throw new Error('context_capsule_subject_mismatch');
    }
    const expiresAt = normalizeDate(row.expiresAt ?? row.expires_at);
    if (expiresAt && expiresAt.getTime() < (input.now ?? new Date()).getTime()) {
        throw new Error('context_capsule_expired');
    }
    const payload = normalizeClassificationPayload(row.contextPayload ?? row.context_payload);
    if (!payload) throw new Error('context_capsule_payload_invalid');
    return {
        capsuleId: String(row.id),
        subjectId,
        sourceDigest: normalizeString(row.sourceDigest ?? row.source_digest),
        contextDigest: normalizeString(row.contextDigest ?? row.context_digest),
        payload,
        evidenceRefs: Array.isArray(row.sourceRefs ?? row.source_refs)
            ? (row.sourceRefs ?? row.source_refs) as EvidenceRef[]
            : [],
        expiresAt,
    };
}

export async function loadKnowledgeRelationshipCoverageAuditContext(
    prisma: any,
    input: {
        contextCapsuleId: string | null | undefined;
        expectedCircleId?: number | null;
        now?: Date;
    },
): Promise<{
    capsuleId: string;
    subjectId: string;
    sourceDigest: string;
    contextDigest: string;
    payload: KnowledgeRelationshipCoverageAuditPayload;
    evidenceRefs: EvidenceRef[];
    expiresAt: Date | null;
}> {
    const row = await loadContextCapsuleRow(prisma, input.contextCapsuleId);
    if (String(row.taskType || row.task_type || '') !== KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE) {
        throw new Error('context_capsule_task_mismatch');
    }
    const payload = normalizeCoveragePayload(row.contextPayload ?? row.context_payload);
    if (!payload) throw new Error('context_capsule_payload_invalid');
    const subjectType = normalizeString(row.subjectType ?? row.subject_type);
    const subjectId = normalizeString(row.subjectId ?? row.subject_id);
    if (subjectType !== payload.scope.type) {
        throw new Error('context_capsule_subject_mismatch');
    }
    const expectedSubjectId = payload.scope.circleId ? String(payload.scope.circleId) : 'system';
    if (subjectId !== expectedSubjectId) {
        throw new Error('context_capsule_subject_mismatch');
    }
    if (
        input.expectedCircleId
        && Number(payload.scope.circleId ?? 0) !== Number(input.expectedCircleId)
    ) {
        throw new Error('context_capsule_subject_mismatch');
    }
    const expiresAt = normalizeDate(row.expiresAt ?? row.expires_at);
    if (expiresAt && expiresAt.getTime() < (input.now ?? new Date()).getTime()) {
        throw new Error('context_capsule_expired');
    }
    return {
        capsuleId: String(row.id),
        subjectId: normalizeString(row.subjectId ?? row.subject_id),
        sourceDigest: normalizeString(row.sourceDigest ?? row.source_digest),
        contextDigest: normalizeString(row.contextDigest ?? row.context_digest),
        payload,
        evidenceRefs: Array.isArray(row.sourceRefs ?? row.source_refs)
            ? (row.sourceRefs ?? row.source_refs) as EvidenceRef[]
            : [],
        expiresAt,
    };
}

async function loadActiveLabelCatalog(prisma: any): Promise<KnowledgeRelationshipLabelCatalogItem[]> {
    const rows = typeof prisma?.knowledgeRelationshipLabel?.findMany === 'function'
        ? await prisma.knowledgeRelationshipLabel.findMany({
            where: { status: 'active' },
            orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
        })
        : [];
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        key: normalizeString(row.key),
        displayName: localizedText(row.displayName, row.key),
        description: localizedText(row.description, ''),
    })).filter((item) => item.key);
}

async function loadSourceKnowledge(
    prisma: any,
    circleId: number,
    excludedKnowledgeId: string,
): Promise<KnowledgeRelationshipSnapshot[]> {
    if (typeof prisma?.knowledge?.findMany !== 'function') return [];
    const rows = await prisma.knowledge.findMany({
        where: {
            circleId,
            knowledgeId: { not: excludedKnowledgeId },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: MAX_SOURCE_KNOWLEDGE,
        select: {
            knowledgeId: true,
            title: true,
            description: true,
            contentHash: true,
            version: true,
            createdAt: true,
        },
    });
    return (Array.isArray(rows) ? rows : []).map(toKnowledgeSnapshot);
}

async function loadSourceDraft(
    prisma: any,
    sourceDraftId: string | null | undefined,
): Promise<KnowledgeRelationshipLabelClassificationPayload['sourceDraft']> {
    const normalized = normalizeString(sourceDraftId);
    const postId = normalized.startsWith('post:')
        ? normalizePositiveInt(normalized.slice('post:'.length))
        : null;
    if (!postId || typeof prisma?.post?.findUnique !== 'function') {
        return {
            sourceDraftId: normalized || null,
            postId,
            contentHash: null,
            draftVersion: null,
        };
    }
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            contentId: true,
        },
    });
    const workflow = typeof prisma?.draftWorkflowState?.findUnique === 'function'
        ? await prisma.draftWorkflowState.findUnique({
            where: { draftPostId: postId },
            select: { currentSnapshotVersion: true },
        })
        : null;
    return {
        sourceDraftId: normalized,
        postId,
        contentHash: digestHex({
            postId,
            contentId: post?.contentId ?? null,
        }),
        draftVersion: normalizePositiveInt(workflow?.currentSnapshotVersion),
    };
}

async function loadRecentAssignments(prisma: any, circleId: number | null): Promise<any[]> {
    if (typeof prisma?.knowledgeRelationshipAssignment?.findMany !== 'function') return [];
    const rows = await prisma.knowledgeRelationshipAssignment.findMany({
        where: circleId
            ? { knowledge: { circleId } }
            : undefined,
        orderBy: [{ updatedAt: 'desc' }],
        take: MAX_RECENT_ASSIGNMENTS,
        include: {
            knowledge: {
                select: {
                    circleId: true,
                },
            },
        },
    });
    return Array.isArray(rows) ? rows : [];
}

function summarizeAssignments(
    assignments: any[],
    labels: KnowledgeRelationshipLabelCatalogItem[],
): KnowledgeRelationshipCoverageAuditPayload['assignmentStats'] {
    const counts = new Map(labels.map((label) => [label.key, 0]));
    for (const row of assignments) {
        const labelKey = normalizeString(row.labelKey);
        counts.set(labelKey, (counts.get(labelKey) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([labelKey, assignmentCount]) => ({
        labelKey,
        assignmentCount,
    }));
}

async function loadContextCapsuleRow(prisma: any, contextCapsuleId: string | null | undefined): Promise<any> {
    const id = normalizeString(contextCapsuleId);
    if (!id) throw new Error('missing_context_capsule');
    const row = typeof prisma?.aiContextCapsule?.findUnique === 'function'
        ? await prisma.aiContextCapsule.findUnique({ where: { id } })
        : null;
    if (!row) throw new Error('missing_context_capsule');
    return row;
}

function normalizeClassificationPayload(value: unknown): KnowledgeRelationshipLabelClassificationPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const payload = value as KnowledgeRelationshipLabelClassificationPayload;
    if (payload.kind !== 'knowledge_relationship_label_classification.v1') return null;
    if (!payload.knowledge?.knowledgeId || !Array.isArray(payload.activeLabelCatalog)) return null;
    return payload;
}

function normalizeCoveragePayload(value: unknown): KnowledgeRelationshipCoverageAuditPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const payload = value as KnowledgeRelationshipCoverageAuditPayload;
    if (payload.kind !== 'knowledge_relationship_label_coverage_audit.v1') return null;
    if (!payload.scope || !Array.isArray(payload.activeLabelCatalog)) return null;
    return payload;
}

function toKnowledgeSnapshot(row: any): KnowledgeRelationshipSnapshot {
    return {
        knowledgeId: normalizeString(row.knowledgeId),
        title: normalizeText(row.title, 180),
        description: normalizeText(row.description, 500) || null,
        contentHash: normalizeHex(row.contentHash) || null,
        version: normalizePositiveInt(row.version),
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    };
}

function buildKnowledgeEvidenceRef(
    circleId: number,
    knowledge: KnowledgeRelationshipSnapshot,
    now: Date,
): EvidenceRef {
    return {
        sourceType: 'domain_artifact',
        sourceId: `knowledge:${knowledge.knowledgeId}`,
        digest: normalizeHex(knowledge.contentHash) || digestHex(knowledge),
        visibility: 'public',
        locator: {
            type: 'knowledge',
            ref: knowledge.knowledgeId,
        },
        permissionSnapshot: {
            circleId,
            metadataOnly: true,
        },
        capturedAt: now.toISOString(),
        expiresAt: null,
    };
}

function buildDraftEvidenceRef(
    circleId: number,
    postId: number,
    contentHash: string | null,
    now: Date,
): EvidenceRef {
    return {
        sourceType: 'domain_artifact',
        sourceId: `post:${postId}`,
        digest: normalizeHex(contentHash) || digestHex(`post:${postId}`),
        visibility: 'public',
        locator: {
            type: 'post',
            ref: String(postId),
        },
        permissionSnapshot: {
            circleId,
            metadataOnly: true,
        },
        capturedAt: now.toISOString(),
        expiresAt: null,
    };
}

function localizedText(value: unknown, fallback: unknown): string {
    if (typeof value === 'string') return normalizeText(value, 240);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        return normalizeText(record.en ?? record.zh ?? Object.values(record).find((item) => typeof item === 'string'), 240);
    }
    return normalizeText(fallback, 240);
}

function normalizeText(value: unknown, maxLength: number): string {
    return normalizeString(value).replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
}

function normalizeConfidence(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeHex(value: unknown): string {
    const text = normalizeString(value);
    return /^[a-f0-9]{64}$/i.test(text) ? text.toLowerCase() : '';
}

function normalizeDate(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function digestHex(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return crypto.createHash('sha256').update(text).digest('hex');
}
