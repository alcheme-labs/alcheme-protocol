import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import { apiFetchJson } from '@/lib/api/fetch';

export type CircleAgentTriggerScope = 'disabled' | 'draft_only' | 'circle_wide';
export type CircleAgentReviewMode = 'owner_review' | 'admin_review' | 'self_serve';

export interface CircleAgentRecord {
    id: number;
    circleId: number;
    handle: string;
    agentPubkey: string;
    displayName: string | null;
    description: string | null;
    ownerUserId: number | null;
    status: string;
}

export interface CircleAgentPolicy {
    circleId: number;
    triggerScope: CircleAgentTriggerScope;
    costDiscountBps: number;
    reviewMode: CircleAgentReviewMode;
    updatedByUserId: number | null;
    updatedAt?: string | null;
}

export type CircleAgentPolicyPatch = Partial<Pick<
    CircleAgentPolicy,
    'triggerScope' | 'costDiscountBps' | 'reviewMode'
>>;

function normalizeTriggerScope(value: unknown): CircleAgentTriggerScope {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'disabled') return 'disabled';
    if (normalized === 'circle_wide') return 'circle_wide';
    return 'draft_only';
}

function normalizeReviewMode(value: unknown): CircleAgentReviewMode {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'admin_review') return 'admin_review';
    if (normalized === 'self_serve') return 'self_serve';
    return 'owner_review';
}

function normalizeAgentRecord(value: any): CircleAgentRecord {
    return {
        id: Number(value?.id || 0),
        circleId: Number(value?.circleId || 0),
        handle: typeof value?.handle === 'string' ? value.handle : 'agent',
        agentPubkey: typeof value?.agentPubkey === 'string' ? value.agentPubkey : '',
        displayName: typeof value?.displayName === 'string' ? value.displayName : null,
        description: typeof value?.description === 'string' ? value.description : null,
        ownerUserId: typeof value?.ownerUserId === 'number' ? value.ownerUserId : null,
        status: typeof value?.status === 'string' ? value.status : 'active',
    };
}

function normalizeAgentPolicy(circleId: number, value: any): CircleAgentPolicy {
    return {
        circleId: Number(value?.circleId || circleId),
        triggerScope: normalizeTriggerScope(value?.triggerScope),
        costDiscountBps: Number.isFinite(Number(value?.costDiscountBps)) ? Math.max(0, Math.min(10_000, Number(value.costDiscountBps))) : 0,
        reviewMode: normalizeReviewMode(value?.reviewMode),
        updatedByUserId: typeof value?.updatedByUserId === 'number' ? value.updatedByUserId : null,
        updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    };
}

async function fetchJsonOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
    return apiFetchJson(input, { init });
}

export async function fetchCircleAgents(circleId: number): Promise<CircleAgentRecord[]> {
    const route = await resolveNodeRoute('circle_agents');
    const baseUrl = route.urlBase;
    const data = await fetchJsonOrThrow(`${baseUrl}/api/v1/circles/${circleId}/agents`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
    });

    return Array.isArray(data?.agents) ? data.agents.map(normalizeAgentRecord) : [];
}

export async function fetchCircleAgentPolicy(circleId: number): Promise<CircleAgentPolicy> {
    const route = await resolveNodeRoute('circle_agents');
    const baseUrl = route.urlBase;
    const data = await fetchJsonOrThrow(`${baseUrl}/api/v1/circles/${circleId}/agents/policy`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
    });

    return normalizeAgentPolicy(circleId, data?.policy);
}

export async function updateCircleAgentPolicy(
    circleId: number,
    patch: CircleAgentPolicyPatch,
): Promise<CircleAgentPolicy> {
    const route = await resolveNodeRoute('circle_agents');
    const baseUrl = route.urlBase;
    const data = await fetchJsonOrThrow(`${baseUrl}/api/v1/circles/${circleId}/agents/policy`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...patch,
        }),
    });

    return normalizeAgentPolicy(circleId, data?.policy);
}
