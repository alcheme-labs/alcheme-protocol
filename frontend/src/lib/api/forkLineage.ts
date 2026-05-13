import { apiFetch } from '@/lib/api/fetch';
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
    const response = await apiFetch(
        `${getQueryApiBaseUrl()}/api/v1/policy/circles/${input.circleId}/fork/team04-inputs`,
        {
            method: 'GET',
            credentials: 'include',
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
    inheritanceSnapshot?: Record<string, unknown>;
    executionAnchorDigest?: string | null;
    originAnchorRef?: string | null;
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

export async function createForkFromCircle(input: CreateForkFromCircleInput): Promise<any> {
    const body: Record<string, unknown> = {
        declarationId: input.declarationId,
        declarationText: input.declarationText,
        originAnchorRef: input.originAnchorRef ?? null,
    };
    if (typeof input.targetCircleId === 'number' && Number.isInteger(input.targetCircleId) && input.targetCircleId > 0) {
        body.targetCircleId = input.targetCircleId;
    }
    if (input.inheritanceSnapshot) {
        body.inheritanceSnapshot = input.inheritanceSnapshot;
    }
    if (typeof input.executionAnchorDigest === 'string' && input.executionAnchorDigest.trim().length > 0) {
        body.executionAnchorDigest = input.executionAnchorDigest;
    }

    const response = await apiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/circles/${input.sourceCircleId}/forks`,
        {
            method: 'POST',
            credentials: 'include',
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
    return payload;
}

export async function fetchForkLineageView(input: {
    circleId: number;
}): Promise<ForkLineageView> {
    const response = await apiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/circles/${input.circleId}/lineage`,
        {
            method: 'GET',
            credentials: 'include',
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

export async function fetchForkQualificationSnapshot(input: {
    circleId: number;
}): Promise<ForkQualificationSnapshot> {
    const response = await apiFetch(
        `${getQueryApiBaseUrl()}/api/v1/fork/circles/${input.circleId}/qualification`,
        {
            method: 'GET',
            credentials: 'include',
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
