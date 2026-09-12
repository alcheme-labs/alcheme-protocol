import crypto from 'crypto';

import {
    buildContextCapsule,
    persistContextCapsule,
} from '../contextFabric';
import type { EvidenceRef } from '../types';
import type { CircleSummarySnapshot } from '../../circleSummary/snapshot';
import type {
    CircleSummaryTopologyItem,
    CircleSummaryTopologyPayload,
} from '../../circleSummary/topology';
import {
    CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE,
    type CircleCognitiveMapContextPayload,
    type CircleCognitiveMapLocale,
    type CognitiveEvidenceState,
    type CognitiveNodeSnapshot,
    type CognitiveRouteSnapshot,
    type CognitiveSourceRef,
} from './types';

const CONTEXT_TTL_MS = 30 * 60 * 1000;

export async function persistCircleCognitiveMapContext(input: {
    prisma: any;
    circleId: number;
    snapshot: CircleSummarySnapshot;
    topology: CircleSummaryTopologyPayload;
    locale: CircleCognitiveMapLocale;
    now?: Date;
}): Promise<{
    capsuleId: string;
    contextDigest: string;
    sourceDigest: string;
    payload: CircleCognitiveMapContextPayload;
}> {
    const payload = buildCircleCognitiveMapContextPayload(input);
    const evidenceRefs = buildEvidenceRefs(payload, input.now ?? new Date());
    const capsule = buildContextCapsule({
        taskType: CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE,
        subjectType: 'circle',
        subjectId: String(input.circleId),
        actorUserId: null,
        visibility: 'public_protocol',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs,
        contextPayload: payload as unknown as Record<string, unknown>,
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'circle_cognitive_map_v1',
        },
        tokenBudget: {
            maxInputTokens: 1800,
            maxOutputTokens: 900,
            maxEvidenceRefs: evidenceRefs.length,
        },
        privatePlaintextMode: 'public_protocol',
    });
    if (!capsule.ok) {
        throw new Error(`circle_cognitive_map_context_rejected:${capsule.error}`);
    }
    await persistContextCapsule(input.prisma, capsule.capsule, {
        cacheKey: `circle_cognitive_map:${input.circleId}:${capsule.capsule.contextDigest}`,
        expiresAt: new Date((input.now ?? new Date()).getTime() + CONTEXT_TTL_MS),
    });
    return {
        capsuleId: capsule.capsule.id,
        contextDigest: capsule.capsule.contextDigest,
        sourceDigest: capsule.capsule.sourceDigest,
        payload,
    };
}

export async function loadCircleCognitiveMapContext(
    prisma: any,
    input: {
        contextCapsuleId: string | null | undefined;
        expectedCircleId?: number | null;
        now?: Date;
    },
): Promise<{
    capsuleId: string;
    sourceDigest: string;
    contextDigest: string;
    payload: CircleCognitiveMapContextPayload;
}> {
    const contextCapsuleId = normalizeString(input.contextCapsuleId);
    if (!contextCapsuleId) throw new Error('missing_context_capsule');
    const row = typeof prisma?.aiContextCapsule?.findUnique === 'function'
        ? await prisma.aiContextCapsule.findUnique({ where: { id: contextCapsuleId } })
        : null;
    if (!row) throw new Error('missing_context_capsule');
    if (String(row.taskType || row.task_type || '') !== CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE) {
        throw new Error('context_capsule_task_mismatch');
    }
    if (input.expectedCircleId && String(row.subjectId || row.subject_id || '') !== String(input.expectedCircleId)) {
        throw new Error('context_capsule_subject_mismatch');
    }
    const expiresAt = row.expiresAt instanceof Date
        ? row.expiresAt
        : row.expiresAt
            ? new Date(String(row.expiresAt))
            : null;
    if (expiresAt && expiresAt.getTime() < (input.now ?? new Date()).getTime()) {
        throw new Error('context_capsule_expired');
    }
    const payload = normalizePayload(row.contextPayload ?? row.context_payload);
    if (!payload) throw new Error('context_capsule_payload_invalid');
    return {
        capsuleId: contextCapsuleId,
        sourceDigest: String(row.sourceDigest || row.source_digest || ''),
        contextDigest: String(row.contextDigest || row.context_digest || ''),
        payload,
    };
}

export function normalizeCircleCognitiveMapLocale(value: unknown): CircleCognitiveMapLocale {
    const normalized = normalizeString(value).toLowerCase().split(/[-_]/)[0];
    return normalized === 'zh' || normalized === 'fr' || normalized === 'es' ? normalized : 'en';
}

function buildCircleCognitiveMapContextPayload(input: {
    circleId: number;
    snapshot: CircleSummarySnapshot;
    topology: CircleSummaryTopologyPayload;
    locale: CircleCognitiveMapLocale;
}): CircleCognitiveMapContextPayload {
    const nodes = buildTopologyNodes(input.topology);
    const routes = buildRoutes(input.snapshot);
    const openQuestions = buildOpenQuestions(input.snapshot);
    const evolution = [
        ...routes.slice(0, 6).map((route) => ({
            id: `route-step-${route.id}`,
            stage: route.stage ?? 'current_map' as const,
            title: route.title,
            summary: route.summary,
            routeIds: [route.id],
            evidenceState: route.evidenceState,
            sourceRefs: route.sourceRefs,
        })),
        ...openQuestions.slice(0, 4).map((question) => ({
            id: `pending-step-${question.questionId}`,
            stage: 'pending_question' as const,
            title: question.title,
            summary: question.body,
            routeIds: [],
            evidenceState: 'missing' as const,
            sourceRefs: [],
        })),
    ];
    const evidenceGapCount = routes.filter((route) => route.evidenceState === 'missing').length;
    const currentTitle = nodes.find((node) => node.relationToCurrent === 'current')?.title || `Circle ${input.circleId}`;

    return {
        kind: 'circle_cognitive_map_explain.v1',
        circleId: input.circleId,
        locale: input.locale,
        mapStatus: {
            stableConclusionCount: routes.filter((route) => route.status === 'stable_conclusion').length,
            pendingQuestionCount: openQuestions.length,
            evidenceGapCount,
            hasDraftBaseline: routes.some((route) => route.sourceRefs.some((ref) => ref.kind === 'draft')),
        },
        visibleFocus: routes[0]?.title || currentTitle,
        topology: {
            sourceVersion: input.topology.sourceVersion,
            nodes,
        },
        routes,
        evolution,
        openQuestions,
        sourceDigestMaterial: {
            summaryId: input.snapshot.summaryId,
            summaryVersion: input.snapshot.version,
            summaryGeneratedAt: input.snapshot.generatedAt.toISOString(),
            summarySourceDigest: input.snapshot.generationMetadata?.sourceDigest ?? null,
            topologySourceVersion: input.topology.sourceVersion,
        },
    };
}

function buildTopologyNodes(topology: CircleSummaryTopologyPayload): CognitiveNodeSnapshot[] {
    const rows: Array<{
        item: CircleSummaryTopologyItem | null;
        relation: CognitiveNodeSnapshot['relationToCurrent'];
        kind: CognitiveNodeSnapshot['kind'];
    }> = [
        { item: topology.parent, relation: 'parent', kind: 'parent_circle' },
        { item: topology.current, relation: 'current', kind: 'current_circle' },
        ...topology.children.slice(0, 3).map((item) => ({ item, relation: 'child' as const, kind: 'child_circle' as const })),
        ...topology.auxiliarySiblings.slice(0, 2).map((item) => ({ item, relation: 'auxiliary' as const, kind: 'auxiliary_circle' as const })),
    ];
    return rows
        .filter((row) => row.item && row.item.accessState !== 'hidden' && normalizeString(row.item.safeTitle))
        .map((row) => {
            const item = row.item as CircleSummaryTopologyItem;
            return {
                id: `${row.relation}-circle-${item.circleId}`,
                kind: row.kind,
                title: normalizeText(item.safeTitle, 120) || `Circle ${item.circleId}`,
                relationToCurrent: row.relation,
                accessState: item.accessState === 'locked' || item.accessState === 'requestable'
                    ? item.accessState
                    : 'readable',
                recommendationSource: 'topology',
            };
        });
}

function buildRoutes(snapshot: CircleSummarySnapshot): CognitiveRouteSnapshot[] {
    return snapshot.viewpointBranches.slice(0, 12).map((branch, index) => {
        const root = ensureRecord(branch);
        const knowledgeId = normalizeString(root.knowledgeId) || `snapshot-route-${index + 1}`;
        const title = normalizeText(root.title, 160) || `Route ${index + 1}`;
        const sourceDraftPostId = normalizePositiveInt(root.sourceDraftPostId);
        const evidenceState = evidenceStateForBinding(root.sourceBindingKind);
        const sourceRefs: CognitiveSourceRef[] = [
            {
                kind: 'knowledge',
                id: knowledgeId,
                label: title,
            },
            ...(sourceDraftPostId
                ? [{
                    kind: 'draft' as const,
                    id: String(sourceDraftPostId),
                    label: `Draft #${sourceDraftPostId}`,
                }]
                : []),
        ];
        return {
            id: `snapshot-${knowledgeId}`,
            role: index === 0 ? 'recommended_start' : 'standard_route',
            status: evidenceState === 'missing' ? 'needs_organization' : 'stable_conclusion',
            evidenceState,
            recommendationSource: 'summary_snapshot',
            title,
            summary: normalizeText(root.routeHint, 240) || normalizeText(root.citationSummary, 180) || title,
            reason: index === 0 ? 'Recommended first route from the summary snapshot.' : 'Related route from the summary snapshot.',
            evidenceLabel: evidenceState,
            sourceLabel: sourceDraftPostId ? `Draft #${sourceDraftPostId}` : 'Source pending',
            nextActionLabel: 'Open route detail',
            stage: 'current_map',
            sourceRefs,
        };
    });
}

function buildOpenQuestions(snapshot: CircleSummarySnapshot): CircleCognitiveMapContextPayload['openQuestions'] {
    return snapshot.openQuestions.slice(0, 8).map((question, index) => {
        const root = ensureRecord(question);
        return {
            questionId: `pending-question-${index + 1}`,
            title: normalizeText(root.title, 160) || `Pending question ${index + 1}`,
            body: normalizeText(root.body, 360),
        };
    });
}

function buildEvidenceRefs(payload: CircleCognitiveMapContextPayload, now: Date): EvidenceRef[] {
    return [
        {
            sourceType: 'domain_artifact',
            sourceId: `circle_summary:${payload.sourceDigestMaterial.summaryId}`,
            digest: normalizeHex(payload.sourceDigestMaterial.summarySourceDigest)
                || digestHex(payload.sourceDigestMaterial),
            visibility: 'public',
            locator: {
                type: 'circle_summary_snapshot',
                ref: payload.sourceDigestMaterial.summaryId,
            },
            permissionSnapshot: {
                circleId: payload.circleId,
                metadataOnly: true,
            },
            capturedAt: now.toISOString(),
            expiresAt: null,
        },
        ...payload.routes.flatMap((route) => route.sourceRefs.map((ref) => ({
            sourceType: 'domain_artifact',
            sourceId: `${ref.kind}:${ref.id}`,
            digest: digestHex(`${ref.kind}:${ref.id}`),
            visibility: 'public',
            locator: {
                type: ref.kind,
                ref: ref.id,
            },
            permissionSnapshot: {
                circleId: payload.circleId,
                metadataOnly: true,
            },
            capturedAt: now.toISOString(),
            expiresAt: null,
        } satisfies EvidenceRef))),
    ];
}

function normalizePayload(value: unknown): CircleCognitiveMapContextPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as CircleCognitiveMapContextPayload;
    const circleId = Number(record.circleId);
    if (record.kind !== 'circle_cognitive_map_explain.v1' || !Number.isFinite(circleId) || circleId <= 0) return null;
    if (!Array.isArray(record.routes) || !Array.isArray(record.topology?.nodes)) return null;
    return record;
}

function ensureRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function evidenceStateForBinding(value: unknown): CognitiveEvidenceState {
    const normalized = normalizeString(value);
    if (normalized === 'snapshot') return 'stable';
    if (normalized === 'settlement_fallback') return 'partial';
    return 'missing';
}

function normalizeText(value: unknown, maxLength: number): string {
    return normalizeString(value).replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeHex(value: unknown): string {
    const text = normalizeString(value);
    return /^[a-f0-9]{64}$/i.test(text) ? text.toLowerCase() : '';
}

function digestHex(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return crypto.createHash('sha256').update(text).digest('hex');
}
