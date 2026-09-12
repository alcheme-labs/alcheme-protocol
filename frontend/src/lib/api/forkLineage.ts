import { authenticatedApiFetch } from '@/lib/api/fetch';
import {
    pickForkTeam04ResolvedInputs,
    type ForkQualificationSnapshot,
    type Team04ForkResolvedInputs,
} from '@/features/fork-lineage/adapter';

function getQueryApiBaseUrl(): string {
    const graphqlEndpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://127.0.0.1:4000/graphql';
    try {
        return new URL(graphqlEndpoint).origin;
    } catch {
        return 'http://127.0.0.1:4000';
    }
}

function normalizeForkQualificationStatus(value: unknown): ForkQualificationSnapshot['qualificationStatus'] {
    if (
        value === 'qualified'
        || value === 'fork_disabled'
        || value === 'contribution_shortfall'
        || value === 'identity_shortfall'
        || value === 'private_source_not_forkable'
    ) {
        return value;
    }
    return 'contribution_shortfall';
}

export async function fetchForkTeam04ResolvedInputs(input: {
    circleId: number;
}): Promise<Team04ForkResolvedInputs> {
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl()}/api/v1/policy/circles/${input.circleId}/fork/team04-inputs`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new Error(message);
    }
    return pickForkTeam04ResolvedInputs(payload);
}

export interface CreateForkFromCircleInput {
    sourceCircleId: number;
    declarationId: string;
    declarationText: string;
    targetCircleId?: number;
    executionAnchorDigest?: string | null;
    originAnchorRef?: string | null;
    governanceRequestId?: string | null;
}

export interface CreateForkFromCircleResult {
    status: 'requires_governance' | 'prepared' | 'completed';
    governanceRequestId: string | null;
    request?: { id: string; state: string } | null;
    reconciliationPending?: boolean;
}

export interface ForkLineageViewItem {
    lineageId: string;
    sourceCircleId: number;
    targetCircleId: number;
    declarationId: string;
    sourceCircleName: string;
    targetCircleName: string;
    declarationText: string;
    status: string;
    originAnchorRef: string | null;
    executionAnchorDigest: string | null;
    migrationManifest: Record<string, unknown> | null;
    createdAt: string;
    currentCheckpointDay: number | null;
    nextCheckAt: string | null;
    inactiveStreak: number | null;
    markerVisible: boolean | null;
    permanentAt: string | null;
    hiddenAt: string | null;
    lastEvaluatedAt: string | null;
}

export interface ForkLineageView {
    circleId: number;
    asSource: ForkLineageViewItem[];
    asTarget: ForkLineageViewItem[];
}

export interface ForkSourcePathEntryView {
    circleId: number;
    parentCircleId: number | null;
    name: string;
    level: number;
    circleType: string;
    joinRequirement: string;
    minCrystals: number;
    capturedAt: string;
}

export interface ForkContextView {
    circleId: number;
    capsule: null | {
        capsuleId: string;
        sourceCircleId: number;
        targetCircleId: number;
        sourcePath: ForkSourcePathEntryView[];
        originSnapshot: Record<string, unknown>;
        createdAt: string;
        status: string;
    };
    references: Array<{
        referenceId: string;
        referenceType: string;
        sourceCircleId: number;
        visibilityState: string;
        restrictionState: string;
        releaseId: string | null;
        sourceDigest: string | null;
        summaryDigest: string | null;
        canRequestExpansion: boolean;
    }>;
}

export type ForkReferenceExpansionMode = 'summary' | 'full_source';

export interface ForkReferenceExpansionView {
    referenceId: string;
    mode: ForkReferenceExpansionMode;
    status: 'allowed' | 'released_summary' | 'source_gate_required' | 'sealed' | 'revoked' | 'not_found';
    text: string | null;
    sourceDigest: string | null;
    summaryDigest: string | null;
}

function normalizeForkLineageViewItem(raw: unknown): ForkLineageViewItem | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const item = raw as Record<string, unknown>;
    const sourceCircleId = Number(item.sourceCircleId || 0);
    const targetCircleId = Number(item.targetCircleId || 0);
    if (!Number.isFinite(sourceCircleId) || sourceCircleId <= 0 || !Number.isFinite(targetCircleId) || targetCircleId <= 0) {
        return null;
    }
    return {
        lineageId: String(item.lineageId || ''),
        sourceCircleId,
        targetCircleId,
        declarationId: String(item.declarationId || ''),
        sourceCircleName: String(item.sourceCircleName || ''),
        targetCircleName: String(item.targetCircleName || ''),
        declarationText: String(item.declarationText || ''),
        status: String(item.status || 'completed'),
        originAnchorRef: typeof item.originAnchorRef === 'string' ? item.originAnchorRef : null,
        executionAnchorDigest: typeof item.executionAnchorDigest === 'string' ? item.executionAnchorDigest : null,
        migrationManifest: item.migrationManifest && typeof item.migrationManifest === 'object' && !Array.isArray(item.migrationManifest)
            ? item.migrationManifest as Record<string, unknown>
            : null,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        currentCheckpointDay: typeof item.currentCheckpointDay === 'number' ? item.currentCheckpointDay : null,
        nextCheckAt: typeof item.nextCheckAt === 'string' ? item.nextCheckAt : null,
        inactiveStreak: typeof item.inactiveStreak === 'number' ? item.inactiveStreak : null,
        markerVisible: typeof item.markerVisible === 'boolean' ? item.markerVisible : null,
        permanentAt: typeof item.permanentAt === 'string' ? item.permanentAt : null,
        hiddenAt: typeof item.hiddenAt === 'string' ? item.hiddenAt : null,
        lastEvaluatedAt: typeof item.lastEvaluatedAt === 'string' ? item.lastEvaluatedAt : null,
    };
}

function normalizeSourcePathEntry(raw: unknown): ForkSourcePathEntryView | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const item = raw as Record<string, unknown>;
    const circleId = Number(item.circleId || 0);
    if (!Number.isFinite(circleId) || circleId <= 0) {
        return null;
    }
    const parsedParentCircleId = item.parentCircleId === null || item.parentCircleId === undefined
        ? null
        : Number(item.parentCircleId);
    return {
        circleId,
        parentCircleId: typeof parsedParentCircleId === 'number' && Number.isFinite(parsedParentCircleId) && parsedParentCircleId > 0
            ? parsedParentCircleId
            : null,
        name: String(item.name || ''),
        level: Math.max(0, Number(item.level || 0)),
        circleType: String(item.circleType || 'Open'),
        joinRequirement: String(item.joinRequirement || 'Free'),
        minCrystals: Math.max(0, Number(item.minCrystals || 0)),
        capturedAt: String(item.capturedAt || ''),
    };
}

function normalizeForkContextView(raw: unknown): ForkContextView {
    const payload = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const circleId = Math.max(0, Number(payload.circleId || 0));
    const capsulePayload = payload.capsule && typeof payload.capsule === 'object'
        ? payload.capsule as Record<string, unknown>
        : null;
    return {
        circleId,
        capsule: capsulePayload
            ? {
                capsuleId: String(capsulePayload.capsuleId || ''),
                sourceCircleId: Math.max(0, Number(capsulePayload.sourceCircleId || 0)),
                targetCircleId: Math.max(0, Number(capsulePayload.targetCircleId || 0)),
                sourcePath: Array.isArray(capsulePayload.sourcePath)
                    ? capsulePayload.sourcePath
                        .map(normalizeSourcePathEntry)
                        .filter((entry: ForkSourcePathEntryView | null): entry is ForkSourcePathEntryView => Boolean(entry))
                    : [],
                originSnapshot: capsulePayload.originSnapshot && typeof capsulePayload.originSnapshot === 'object'
                    ? capsulePayload.originSnapshot as Record<string, unknown>
                    : {},
                createdAt: String(capsulePayload.createdAt || ''),
                status: String(capsulePayload.status || 'active'),
            }
            : null,
        references: Array.isArray(payload.references)
            ? payload.references.map((entry) => {
                const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
                return {
                    referenceId: String(item.referenceId || ''),
                    referenceType: String(item.referenceType || 'sealed_metadata'),
                    sourceCircleId: Math.max(0, Number(item.sourceCircleId || 0)),
                    visibilityState: String(item.visibilityState || 'sealed_source'),
                    restrictionState: String(item.restrictionState || 'sealed'),
                    releaseId: typeof item.releaseId === 'string' ? item.releaseId : null,
                    sourceDigest: typeof item.sourceDigest === 'string' ? item.sourceDigest : null,
                    summaryDigest: typeof item.summaryDigest === 'string' ? item.summaryDigest : null,
                    canRequestExpansion: Boolean(item.canRequestExpansion),
                };
            }).filter((reference) => reference.referenceId.length > 0)
            : [],
    };
}

function normalizeExpansionStatus(value: unknown): ForkReferenceExpansionView['status'] {
    if (
        value === 'allowed'
        || value === 'released_summary'
        || value === 'source_gate_required'
        || value === 'sealed'
        || value === 'revoked'
        || value === 'not_found'
    ) {
        return value;
    }
    return 'sealed';
}

function normalizeForkReferenceExpansionView(
    raw: unknown,
    input: { referenceId: string; mode: ForkReferenceExpansionMode },
): ForkReferenceExpansionView {
    const payload = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const material = payload.material && typeof payload.material === 'object'
        ? payload.material as Record<string, unknown>
        : null;
    const chunks = material && Array.isArray(material.chunks)
        ? material.chunks
            .map((chunk) => {
                const item = chunk && typeof chunk === 'object' ? chunk as Record<string, unknown> : {};
                return typeof item.text === 'string' ? item.text : '';
            })
            .filter((text) => text.trim().length > 0)
        : [];
    return {
        referenceId: String(payload.referenceId || input.referenceId),
        mode: input.mode,
        status: normalizeExpansionStatus(payload.status),
        text: typeof payload.summaryText === 'string'
            ? payload.summaryText
            : chunks.length > 0
                ? chunks.join('\n\n')
                : typeof payload.text === 'string'
                    ? payload.text
                    : null,
        sourceDigest: typeof payload.sourceDigest === 'string'
            ? payload.sourceDigest
            : typeof material?.contentDigest === 'string'
                ? material.contentDigest
                : null,
        summaryDigest: typeof payload.summaryDigest === 'string' ? payload.summaryDigest : null,
    };
}

export async function createForkFromCircle(input: CreateForkFromCircleInput): Promise<CreateForkFromCircleResult> {
    const body: Record<string, unknown> = {
        declarationId: input.declarationId,
        declarationText: input.declarationText,
        originAnchorRef: input.originAnchorRef ?? null,
    };
    if (typeof input.targetCircleId === 'number' && Number.isInteger(input.targetCircleId) && input.targetCircleId > 0) {
        body.targetCircleId = input.targetCircleId;
    }
    if (typeof input.executionAnchorDigest === 'string' && input.executionAnchorDigest.trim().length > 0) {
        body.executionAnchorDigest = input.executionAnchorDigest;
    }
    if (typeof input.governanceRequestId === 'string' && input.governanceRequestId.trim().length > 0) {
        body.governanceRequestId = input.governanceRequestId;
    }

    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/circles/${input.sourceCircleId}/forks`,
        {
            method: 'POST',
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new Error(message);
    }
    return {
        status: payload?.status === 'requires_governance'
            ? 'requires_governance'
            : payload?.status === 'completed'
                ? 'completed'
                : 'prepared',
        governanceRequestId: typeof payload?.governanceRequestId === 'string'
            ? payload.governanceRequestId
            : typeof payload?.request?.id === 'string'
                ? payload.request.id
                : null,
        request: payload?.request && typeof payload.request === 'object'
            ? { id: String(payload.request.id || ''), state: String(payload.request.state || '') }
            : null,
        reconciliationPending: Boolean(payload?.reconciliationPending),
    };
}

export async function fetchForkLineageView(input: {
    circleId: number;
}): Promise<ForkLineageView> {
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/circles/${input.circleId}/lineage`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new Error(message);
    }
    return {
        circleId: Math.max(0, Number(payload?.circleId || 0)),
        asSource: Array.isArray(payload?.asSource)
            ? payload.asSource
                .map(normalizeForkLineageViewItem)
                .filter((item: ForkLineageViewItem | null): item is ForkLineageViewItem => Boolean(item))
            : [],
        asTarget: Array.isArray(payload?.asTarget)
            ? payload.asTarget
                .map(normalizeForkLineageViewItem)
                .filter((item: ForkLineageViewItem | null): item is ForkLineageViewItem => Boolean(item))
            : [],
    };
}

export async function fetchForkContextView(input: {
    circleId: number;
}): Promise<ForkContextView> {
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/circles/${input.circleId}/context`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new Error(message);
    }
    return normalizeForkContextView(payload);
}

export async function expandForkReference(input: {
    referenceId: string;
    mode: ForkReferenceExpansionMode;
}): Promise<ForkReferenceExpansionView> {
    const query = new URLSearchParams({ mode: input.mode });
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/references/${encodeURIComponent(input.referenceId)}/expand?${query.toString()}`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const status = typeof payload?.error === 'string'
            ? payload.error
            : response.status === 404
                ? 'not_found'
                : 'sealed';
        return {
            referenceId: input.referenceId,
            mode: input.mode,
            status: normalizeExpansionStatus(status),
            text: null,
            sourceDigest: null,
            summaryDigest: null,
        };
    }
    return normalizeForkReferenceExpansionView(payload, input);
}

export async function fetchForkQualificationSnapshot(input: {
    circleId: number;
}): Promise<ForkQualificationSnapshot> {
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/circles/${input.circleId}/qualification`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new Error(message);
    }
    return {
        minimumContributions: Math.max(0, Number(payload?.minimumContributions || 0)),
        contributorCount: Math.max(0, Number(payload?.contributorCount || 0)),
        minimumRole: payload?.minimumRole,
        actorRole: payload?.actorRole ?? null,
        actorIdentityLevel: payload?.actorIdentityLevel ?? null,
        requiresGovernanceVote: Boolean(payload?.requiresGovernanceVote),
        qualifies: Boolean(payload?.qualifies),
        qualificationStatus: normalizeForkQualificationStatus(payload?.qualificationStatus),
    } as ForkQualificationSnapshot;
}
