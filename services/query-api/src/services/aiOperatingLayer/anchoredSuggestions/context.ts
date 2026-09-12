import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import {
    findPlazaVisibleCircleDiscussionMessagesByEnvelopeIdsMap,
    type DiscussionRow,
} from '../../discussion/messagesReadModel';
import {
    buildContextCapsule,
    persistContextCapsule,
} from '../contextFabric';
import type { EvidenceRef } from '../types';
import {
    ANCHORED_SUGGESTION_TASK_TYPE,
    type AnchoredSuggestionCandidateSnapshot,
    type AnchoredSuggestionContextPayload,
} from './types';

const CONTEXT_TTL_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 24;
const SUGGESTION_MESSAGE_KINDS = new Set(['plain', 'root']);

export async function persistAnchoredSuggestionContext(input: {
    prisma: any;
    circleId: number;
    requestedByUserId: number;
    envelopeIds: string[];
    locale: 'en' | 'zh' | 'fr' | 'es';
    now?: Date;
}): Promise<
    | {
        empty: true;
        capsuleId: null;
        contextDigest: null;
        sourceDigest: null;
        payload: AnchoredSuggestionContextPayload;
    }
    | {
        empty: false;
        capsuleId: string;
        contextDigest: string;
        sourceDigest: string;
        payload: AnchoredSuggestionContextPayload;
    }
> {
    const rowsByEnvelopeId = await findPlazaVisibleCircleDiscussionMessagesByEnvelopeIdsMap({
        prisma: input.prisma,
        circleId: input.circleId,
        envelopeIds: normalizeEnvelopeIds(input.envelopeIds).slice(0, MAX_CANDIDATES),
        includeDeleted: false,
    });
    const orderedRows = normalizeEnvelopeIds(input.envelopeIds)
        .map((envelopeId) => rowsByEnvelopeId.get(envelopeId))
        .filter((row): row is DiscussionRow => Boolean(row))
        .filter((row) => SUGGESTION_MESSAGE_KINDS.has(normalizeString(row.messageKind)))
        .filter((row) => normalizeFocusLabel(row.focusLabel) !== 'off_topic');
    const replyCounts = await loadReplyCounts(input.prisma, input.circleId, orderedRows.map((row) => row.envelopeId));
    const candidates = orderedRows.map((row) => buildCandidate(row, replyCounts.get(row.envelopeId) || 0));
    const evidenceRefs = candidates.map((candidate) => buildEvidenceRef(input.circleId, candidate, input.now));
    const payload: AnchoredSuggestionContextPayload = {
        kind: 'anchored_interaction_suggestions.v1',
        circleId: input.circleId,
        locale: input.locale,
        candidateEnvelopeIds: candidates.map((candidate) => candidate.envelopeId),
        candidates,
    };
    if (candidates.length === 0) {
        return {
            empty: true,
            capsuleId: null,
            contextDigest: null,
            sourceDigest: null,
            payload,
        };
    }
    const capsuleContextPayload = {
        ...payload,
        requestActorUserId: input.requestedByUserId,
    };

    const capsule = buildContextCapsule({
        taskType: ANCHORED_SUGGESTION_TASK_TYPE,
        subjectType: 'circle',
        subjectId: String(input.circleId),
        actorUserId: input.requestedByUserId,
        visibility: 'member_visible',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs,
        contextPayload: capsuleContextPayload as unknown as Record<string, unknown>,
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'anchored_suggestions_v1',
        },
        tokenBudget: {
            maxInputTokens: 1200,
            maxOutputTokens: 1000,
            maxEvidenceRefs: MAX_CANDIDATES,
        },
        privatePlaintextMode: 'member_visible',
    });
    if (!capsule.ok) {
        throw new Error(`anchored_suggestion_context_rejected:${capsule.error}`);
    }
    await persistContextCapsule(input.prisma, capsule.capsule, {
        cacheKey: `anchored_suggestions:${input.circleId}:${capsule.capsule.contextDigest}`,
        expiresAt: new Date((input.now ?? new Date()).getTime() + CONTEXT_TTL_MS),
    });
    return {
        empty: false,
        capsuleId: capsule.capsule.id,
        contextDigest: capsule.capsule.contextDigest,
        sourceDigest: capsule.capsule.sourceDigest,
        payload,
    };
}

export async function loadAnchoredSuggestionContext(
    prisma: any,
    input: {
        contextCapsuleId: string | null | undefined;
        expectedCircleId?: number | null;
        expectedActorUserId?: number | null;
        now?: Date;
    },
): Promise<{
    capsuleId: string;
    sourceDigest: string;
    contextDigest: string;
    payload: AnchoredSuggestionContextPayload;
}> {
    const contextCapsuleId = normalizeString(input.contextCapsuleId);
    if (!contextCapsuleId) throw new Error('missing_context_capsule');
    const row = typeof prisma?.aiContextCapsule?.findUnique === 'function'
        ? await prisma.aiContextCapsule.findUnique({ where: { id: contextCapsuleId } })
        : null;
    if (!row) throw new Error('missing_context_capsule');
    if (String(row.taskType || row.task_type || '') !== ANCHORED_SUGGESTION_TASK_TYPE) {
        throw new Error('context_capsule_task_mismatch');
    }
    if (input.expectedCircleId && String(row.subjectId || row.subject_id || '') !== String(input.expectedCircleId)) {
        throw new Error('context_capsule_subject_mismatch');
    }
    if (
        input.expectedActorUserId
        && Number(row.actorUserId ?? row.actor_user_id ?? 0) !== Number(input.expectedActorUserId)
    ) {
        throw new Error('context_capsule_actor_mismatch');
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

export function normalizeAnchoredSuggestionLocale(value: unknown): 'en' | 'zh' | 'fr' | 'es' {
    const normalized = normalizeString(value).toLowerCase().split(/[-_]/)[0];
    return normalized === 'zh' || normalized === 'fr' || normalized === 'es' ? normalized : 'en';
}

export function normalizeEnvelopeIds(value: unknown): string[] {
    const raw = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    return Array.from(new Set(raw
        .map((item) => normalizeString(item))
        .filter((item) => /^[a-z0-9_.:-]{3,128}$/i.test(item))));
}

function buildCandidate(row: DiscussionRow, replyCount: number): AnchoredSuggestionCandidateSnapshot {
    return {
        envelopeId: row.envelopeId,
        messageId: Number(row.lamport || 0),
        createdAt: row.createdAt?.toISOString?.() ?? null,
        clientTimestamp: row.clientTimestamp?.toISOString?.() ?? null,
        messageKind: normalizeString(row.messageKind) === 'root' ? 'root' : 'plain',
        semanticFacets: normalizeStringArray(row.semanticFacets),
        authorAnnotationKinds: normalizeAuthorAnnotationKinds(row.authorAnnotations),
        focusScore: normalizeScore(row.focusScore),
        relevanceScore: normalizeScore(row.semanticScore ?? row.relevanceScore),
        focusLabel: normalizeFocusLabel(row.focusLabel),
        usefulCount: Math.max(0, Math.trunc(Number(row.usefulCount || 0))),
        replyCount,
        actionSignals: detectActionSignals(row.payloadText, row.semanticFacets, row.authorAnnotations),
        payloadHash: normalizeHexDigest(normalizeString(row.payloadHash) || digestHex(row.payloadText)),
    };
}

async function loadReplyCounts(prisma: any, circleId: number, envelopeIds: string[]): Promise<Map<string, number>> {
    if (!envelopeIds.length || typeof prisma?.$queryRaw !== 'function') return new Map();
    const rows = await prisma.$queryRaw(Prisma.sql`
        SELECT subject_id AS "subjectId", COUNT(*)::INT AS "replyCount"
        FROM circle_discussion_messages
        WHERE circle_id = ${circleId}
          AND subject_type = 'discussion_message'
          AND subject_id IN (${Prisma.join(envelopeIds)})
          AND deleted = FALSE
        GROUP BY subject_id
    `) as Array<{ subjectId: string; replyCount: number }>;
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [
        String(row.subjectId),
        Math.max(0, Math.trunc(Number(row.replyCount || 0))),
    ]));
}

function buildEvidenceRef(circleId: number, candidate: AnchoredSuggestionCandidateSnapshot, now?: Date): EvidenceRef {
    return {
        sourceType: 'domain_artifact',
        sourceId: candidate.envelopeId,
        digest: normalizeHexDigest(candidate.payloadHash || candidate.envelopeId),
        visibility: 'member_visible',
        locator: {
            type: 'discussion_message',
            ref: candidate.envelopeId,
        },
        permissionSnapshot: {
            circleId,
            metadataOnly: true,
            messageKind: candidate.messageKind,
        },
        capturedAt: (now ?? new Date()).toISOString(),
        expiresAt: null,
    };
}

function detectActionSignals(rawText: string, rawFacets: unknown, rawAnnotations: unknown): string[] {
    const text = normalizeString(rawText).toLowerCase();
    const facets = normalizeStringArray(rawFacets);
    const annotations = normalizeAuthorAnnotationKinds(rawAnnotations);
    const signals = new Set<string>();
    if (includesAny(text, ['谁来', '谁愿意', '报名', '认领', '参与', '补充', '分工', '接龙', 'volunteer', 'join', 'signup', 'participant'])) {
        signals.add('signup_signal');
    }
    if (includesAny(text, ['a/b', '选哪个', '选择', '投票', '是否同意', '同意吗', '优先级', 'vote', 'poll', 'option', 'choose', 'agree'])) {
        signals.add('poll_signal');
    }
    if (includesAny(text, ['证据', '验证', '反例', '质疑', '事实核查', '可靠吗', '可靠', '证明', 'evidence', 'verify', 'challenge', 'fact check'])) {
        signals.add('challenge_signal');
    }
    if (includesAny(text, ['总结', '沉淀', '草稿', '整理成结论', '知识沉淀', 'crystallization', 'draft', 'summary'])) {
        signals.add('draft_only_signal');
    }
    if (facets.includes('question') || facets.includes('problem')) signals.add('question_facet');
    if (facets.includes('proposal')) signals.add('proposal_facet');
    if (facets.includes('criteria')) signals.add('criteria_facet');
    if (annotations.length > 0) signals.add('author_annotation');
    return [...signals].sort();
}

function includesAny(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function normalizePayload(value: unknown): AnchoredSuggestionContextPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.kind !== 'anchored_interaction_suggestions.v1') return null;
    const circleId = Number(record.circleId);
    if (!Number.isFinite(circleId) || circleId <= 0) return null;
    const candidates = Array.isArray(record.candidates)
        ? record.candidates.map(normalizeCandidate).filter((candidate): candidate is AnchoredSuggestionCandidateSnapshot => Boolean(candidate))
        : [];
    return {
        kind: 'anchored_interaction_suggestions.v1',
        circleId: Math.trunc(circleId),
        locale: normalizeAnchoredSuggestionLocale(record.locale),
        candidateEnvelopeIds: normalizeEnvelopeIds(record.candidateEnvelopeIds),
        candidates,
    };
}

function normalizeCandidate(value: unknown): AnchoredSuggestionCandidateSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const envelopeId = normalizeString(record.envelopeId);
    if (!envelopeId) return null;
    return {
        envelopeId,
        messageId: Math.max(0, Math.trunc(Number(record.messageId || 0))),
        createdAt: normalizeNullableString(record.createdAt),
        clientTimestamp: normalizeNullableString(record.clientTimestamp),
        messageKind: record.messageKind === 'root' ? 'root' : 'plain',
        semanticFacets: normalizeStringArray(record.semanticFacets),
        authorAnnotationKinds: normalizeStringArray(record.authorAnnotationKinds),
        focusScore: normalizeScore(record.focusScore),
        relevanceScore: normalizeScore(record.relevanceScore),
        focusLabel: normalizeFocusLabel(record.focusLabel),
        usefulCount: Math.max(0, Math.trunc(Number(record.usefulCount || 0))),
        replyCount: Math.max(0, Math.trunc(Number(record.replyCount || 0))),
        actionSignals: normalizeStringArray(record.actionSignals),
        payloadHash: normalizeString(record.payloadHash),
    };
}

function normalizeString(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeNullableString(value: unknown): string | null {
    const text = normalizeString(value);
    return text || null;
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => normalizeString(item).toLowerCase()).filter(Boolean))).sort();
}

function normalizeAuthorAnnotationKinds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                return (item as Record<string, unknown>).kind;
            }
            return '';
        })
        .map((item) => normalizeString(item).toLowerCase())
        .filter(Boolean))).sort();
}

function normalizeScore(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeFocusLabel(value: unknown): AnchoredSuggestionCandidateSnapshot['focusLabel'] {
    return value === 'focused' || value === 'contextual' || value === 'off_topic' ? value : null;
}

function digestHex(value: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function normalizeHexDigest(value: string): string {
    const text = normalizeString(value).toLowerCase();
    return /^[a-f0-9]{64}$/.test(text) ? text : digestHex(text);
}
