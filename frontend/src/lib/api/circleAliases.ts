import { authenticatedApiFetch } from '@/lib/api/fetch';
import { getQueryApiBaseUrl as deriveQueryApiBaseUrl } from '@/lib/config/queryApiBase';

export interface CircleAliasEffectiveDisplay {
    effectiveName: string;
    displaySource: string;
    displayCircleId: number | null;
    inheritedFromCircleId: number | null;
    globalHandle: string | null;
    globalDisplayName: string | null;
    circleAlias: string | null;
    needsDisplayDisambiguation?: boolean;
    displayCollisionKey?: string | null;
    displayCollisionCount?: number;
}

export interface CircleAliasResponse {
    ok: boolean;
    circleId: number;
    alias: string | null;
    effectiveDisplay: CircleAliasEffectiveDisplay;
    inheritedFromCircle: {
        id: number;
        name: string;
    } | null;
}

export class CircleAliasApiError extends Error {
    readonly status: number;
    readonly code: string | null;

    constructor(input: { action: string; status: number; code: string | null; message: string }) {
        super(`${input.action} failed: ${input.status}${input.code ? ` ${input.code}` : ''}`);
        this.name = 'CircleAliasApiError';
        this.status = input.status;
        this.code = input.code;
        if (input.message) {
            this.message = input.message;
        }
    }
}

function getQueryApiBaseUrl(): string {
    return deriveQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
}

async function readErrorPayload(response: Response): Promise<{ code: string | null; message: string }> {
    const body = await response.text();
    if (!body.trim()) {
        return { code: null, message: '' };
    }

    try {
        const parsed = JSON.parse(body);
        const code = typeof parsed?.error === 'string'
            ? parsed.error
            : typeof parsed?.code === 'string'
                ? parsed.code
                : null;
        const message = typeof parsed?.message === 'string'
            ? parsed.message
            : body;
        return { code, message };
    } catch {
        return { code: null, message: body };
    }
}

async function readAliasResponse(response: Response, action: string): Promise<CircleAliasResponse> {
    if (!response.ok) {
        const { code, message } = await readErrorPayload(response);
        throw new CircleAliasApiError({
            action,
            status: response.status,
            code,
            message,
        });
    }
    const data = await response.json();
    return {
        ok: Boolean(data?.ok),
        circleId: Number(data?.circleId || 0),
        alias: typeof data?.alias === 'string' && data.alias.trim() ? data.alias.trim() : null,
        effectiveDisplay: {
            effectiveName: typeof data?.effectiveDisplay?.effectiveName === 'string'
                ? data.effectiveDisplay.effectiveName
                : '',
            displaySource: typeof data?.effectiveDisplay?.displaySource === 'string'
                ? data.effectiveDisplay.displaySource
                : 'generic_member',
            displayCircleId: Number.isFinite(Number(data?.effectiveDisplay?.displayCircleId))
                ? Number(data.effectiveDisplay.displayCircleId)
                : null,
            inheritedFromCircleId: Number.isFinite(Number(data?.effectiveDisplay?.inheritedFromCircleId))
                ? Number(data.effectiveDisplay.inheritedFromCircleId)
                : null,
            globalHandle: typeof data?.effectiveDisplay?.globalHandle === 'string'
                ? data.effectiveDisplay.globalHandle
                : null,
            globalDisplayName: typeof data?.effectiveDisplay?.globalDisplayName === 'string'
                ? data.effectiveDisplay.globalDisplayName
                : null,
            circleAlias: typeof data?.effectiveDisplay?.circleAlias === 'string'
                ? data.effectiveDisplay.circleAlias
                : null,
            needsDisplayDisambiguation: Boolean(data?.effectiveDisplay?.needsDisplayDisambiguation),
            displayCollisionKey: typeof data?.effectiveDisplay?.displayCollisionKey === 'string'
                ? data.effectiveDisplay.displayCollisionKey
                : null,
            displayCollisionCount: Number.isFinite(Number(data?.effectiveDisplay?.displayCollisionCount))
                ? Number(data.effectiveDisplay.displayCollisionCount)
                : 1,
        },
        inheritedFromCircle: data?.inheritedFromCircle && Number.isFinite(Number(data.inheritedFromCircle.id))
            ? {
                id: Number(data.inheritedFromCircle.id),
                name: typeof data.inheritedFromCircle.name === 'string' ? data.inheritedFromCircle.name : '',
            }
            : null,
    };
}

export async function fetchMyCircleAlias(circleId: number): Promise<CircleAliasResponse> {
    const response = await authenticatedApiFetch(`${getQueryApiBaseUrl()}/api/v1/circles/${circleId}/aliases/me`, {
        method: 'GET',
        cache: 'no-store',
    });
    return readAliasResponse(response, 'fetch circle alias');
}

export async function updateMyCircleAlias(circleId: number, alias: string): Promise<CircleAliasResponse> {
    const response = await authenticatedApiFetch(`${getQueryApiBaseUrl()}/api/v1/circles/${circleId}/aliases/me`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alias }),
    });
    return readAliasResponse(response, 'update circle alias');
}

export async function clearMyCircleAlias(circleId: number): Promise<CircleAliasResponse> {
    const response = await authenticatedApiFetch(`${getQueryApiBaseUrl()}/api/v1/circles/${circleId}/aliases/me`, {
        method: 'DELETE',
    });
    return readAliasResponse(response, 'clear circle alias');
}
