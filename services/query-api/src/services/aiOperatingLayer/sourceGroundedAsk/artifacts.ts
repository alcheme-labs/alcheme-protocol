import crypto from 'crypto';

import type {
    SourceGroundedAnswerStatus,
    SourceGroundedCitation,
} from './types';

const BLOCKED_PUBLIC_KEYS = new Set([
    'rawText',
    'rawTextLocator',
    'privateText',
    'sourceExcerpt',
    'providerRawResponse',
    'rawPrompt',
    'claimToken',
    'contextPayload',
    'capabilityTrace',
]);

export function buildSourceGroundedAnswerId(): string {
    return `sga_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function digestQuestion(question: string): string {
    return crypto.createHash('sha256').update(question).digest('hex');
}

export async function createSourceGroundedAnswer(prisma: any, input: {
    id?: string;
    circleId: number;
    draftPostId?: number | null;
    ownerUserId?: number | null;
    question: string;
    locale: string;
    status: SourceGroundedAnswerStatus;
    failureCode?: string | null;
    answerText?: string;
    limitations?: string[];
    citations?: SourceGroundedCitation[];
    evidenceRefs?: unknown[];
    sourceDigest: string;
    scopeSnapshot?: Record<string, unknown>;
    contextCapsuleId?: string | null;
    aiJobId?: number | null;
    modelProfile?: string | null;
    promptVersion?: string | null;
}) {
    const data = {
        id: input.id ?? buildSourceGroundedAnswerId(),
        circleId: input.circleId,
        draftPostId: input.draftPostId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        question: input.question,
        questionDigest: digestQuestion(input.question),
        locale: normalizeLocale(input.locale),
        status: input.status,
        failureCode: input.failureCode ?? null,
        answerText: input.answerText ?? '',
        limitations: input.limitations ?? [],
        citations: sanitizePublicJson(input.citations ?? []),
        evidenceRefs: sanitizePublicJson(input.evidenceRefs ?? []),
        sourceDigest: input.sourceDigest,
        scopeSnapshot: sanitizePublicJson(input.scopeSnapshot ?? {}),
        contextCapsuleId: input.contextCapsuleId ?? null,
        aiJobId: input.aiJobId ?? null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: 'v1',
    };
    if (typeof prisma?.sourceGroundedAnswer?.create !== 'function') return data;
    return prisma.sourceGroundedAnswer.create({ data });
}

export async function updateSourceGroundedAnswer(prisma: any, answerId: string, data: Record<string, unknown>) {
    const safeData = sanitizePublicJson(data) as Record<string, unknown>;
    if (typeof prisma?.sourceGroundedAnswer?.update !== 'function') {
        return {
            id: answerId,
            ...safeData,
        };
    }
    return prisma.sourceGroundedAnswer.update({
        where: { id: answerId },
        data: safeData,
    });
}

export async function loadSourceGroundedAnswer(prisma: any, answerId: string) {
    if (typeof prisma?.sourceGroundedAnswer?.findUnique !== 'function') return null;
    return prisma.sourceGroundedAnswer.findUnique({
        where: { id: answerId },
    });
}

export async function listSourceGroundedAnswers(prisma: any, input: {
    circleId: number;
    ownerUserId: number;
    draftPostId?: number | null;
    limit?: number;
}) {
    if (typeof prisma?.sourceGroundedAnswer?.findMany !== 'function') return [];
    return prisma.sourceGroundedAnswer.findMany({
        where: {
            circleId: input.circleId,
            ownerUserId: input.ownerUserId,
            draftPostId: input.draftPostId ?? null,
        },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        take: Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))),
    });
}

export function serializeSourceGroundedAnswer(row: any): Record<string, unknown> {
    return sanitizePublicJson({
        id: String(row.id),
        circleId: Number(row.circleId),
        draftPostId: row.draftPostId ?? null,
        ownerUserId: row.ownerUserId ?? null,
        question: String(row.question || ''),
        locale: String(row.locale || 'en'),
        status: String(row.status || ''),
        failureCode: row.failureCode ?? null,
        answerText: String(row.answerText || ''),
        limitations: Array.isArray(row.limitations) ? row.limitations : [],
        citations: Array.isArray(row.citations) ? row.citations : [],
        evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
        sourceDigest: String(row.sourceDigest || ''),
        scopeSnapshot: row.scopeSnapshot && typeof row.scopeSnapshot === 'object' ? row.scopeSnapshot : {},
        aiJobId: row.aiJobId ?? null,
        modelProfile: row.modelProfile ?? null,
        promptVersion: row.promptVersion ?? null,
        outputSchemaVersion: row.outputSchemaVersion ?? 'v1',
        createdAt: serializeDate(row.createdAt),
        updatedAt: serializeDate(row.updatedAt),
    }) as Record<string, unknown>;
}

export function buildNoSourceAnswerText(locale: string): string {
    return normalizeLocale(locale) === 'zh'
        ? '没有可用来源。'
        : 'No available source was found for this question.';
}

export function normalizeLocale(value: unknown): 'en' | 'zh' {
    return String(value || '').trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function sanitizePublicJson(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sanitizePublicJson);
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (BLOCKED_PUBLIC_KEYS.has(key)) continue;
        output[key] = sanitizePublicJson(nested);
    }
    return output;
}

function serializeDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) return value;
    return null;
}
