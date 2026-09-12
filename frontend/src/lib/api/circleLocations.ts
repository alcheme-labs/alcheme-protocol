import { apiFetch, authenticatedApiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import {
    normalizeCircleGeoAnchorEnvelopePayload,
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
} from '@/lib/circles/settingsEnvelope';

export type CircleGeoAnchorVisibility =
    | 'public_discovery'
    | 'members_only'
    | 'managers_only';

export interface CircleGeoAnchorInput {
    label: string;
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    visibility: CircleGeoAnchorVisibility;
}

export interface CircleGeoAnchorDto extends CircleGeoAnchorInput {
    anchorId: string;
    circleId: number;
    role: 'primary' | 'secondary';
    geometryType: 'point_radius' | 'polygon' | 'polyline_corridor';
    status: 'draft' | 'active' | 'archived';
    source: string;
    createdAt: string | null;
    updatedAt: string | null;
    archivedAt: string | null;
}

export interface NearbyCircleLocationDto {
    anchorId: string;
    circleId: number;
    circleName: string;
    circleDescription: string | null;
    membersCount: number;
    postsCount: number;
    label: string;
    radiusMeters: number;
    distanceMeters: number;
    bearingDegrees: number;
    updatedAt: string | null;
}

export interface NearbyCircleLocationInput {
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    limit?: number;
}

export type CircleLocationMutationResult =
    | {
        status: 'executed';
        circleId: number;
        anchor: CircleGeoAnchorDto | null;
        archived?: boolean;
        anchorId?: string | null;
      }
    | {
        status: 'requires_governance';
        request: CircleLocationGovernanceRequest | null;
      };

export interface CircleLocationGovernanceRequest {
    id: string;
    state?: string;
    actionType?: string;
    targetRef?: string;
}

export interface CircleLocationUpdateAuth extends CircleSettingsEnvelopeAuth {}

function normalizeNumber(value: unknown, fallback = 0): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeVisibility(value: unknown): CircleGeoAnchorVisibility {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'members_only' || normalized === 'managers_only') {
        return normalized;
    }
    return 'public_discovery';
}

function normalizeAnchor(value: any): CircleGeoAnchorDto | null {
    if (!value || typeof value !== 'object') return null;
    return {
        anchorId: String(value.anchorId || ''),
        circleId: normalizeNumber(value.circleId),
        role: value.role === 'secondary' ? 'secondary' : 'primary',
        geometryType: value.geometryType === 'polygon'
            ? 'polygon'
            : value.geometryType === 'polyline_corridor'
                ? 'polyline_corridor'
                : 'point_radius',
        label: String(value.label || ''),
        centerLat: normalizeNumber(value.centerLat),
        centerLng: normalizeNumber(value.centerLng),
        radiusMeters: Math.max(0, Math.floor(normalizeNumber(value.radiusMeters))),
        visibility: normalizeVisibility(value.visibility),
        status: value.status === 'draft'
            ? 'draft'
            : value.status === 'archived'
                ? 'archived'
                : 'active',
        source: String(value.source || 'manual'),
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        archivedAt: typeof value.archivedAt === 'string' ? value.archivedAt : null,
    };
}

function normalizeGovernanceRequest(value: any): CircleLocationGovernanceRequest | null {
    if (!value || typeof value !== 'object') return null;
    return {
        id: String(value.id || ''),
        state: typeof value.state === 'string' ? value.state : undefined,
        actionType: typeof value.actionType === 'string' ? value.actionType : undefined,
        targetRef: typeof value.targetRef === 'string' ? value.targetRef : undefined,
    };
}

function normalizeNearbyItem(value: any): NearbyCircleLocationDto {
    return {
        anchorId: String(value?.anchorId || ''),
        circleId: normalizeNumber(value?.circleId),
        circleName: String(value?.circleName || ''),
        circleDescription: typeof value?.circleDescription === 'string' ? value.circleDescription : null,
        membersCount: Math.max(0, Math.floor(normalizeNumber(value?.membersCount))),
        postsCount: Math.max(0, Math.floor(normalizeNumber(value?.postsCount))),
        label: String(value?.label || ''),
        radiusMeters: Math.max(0, Math.floor(normalizeNumber(value?.radiusMeters))),
        distanceMeters: Math.max(0, Math.floor(normalizeNumber(value?.distanceMeters))),
        bearingDegrees: Math.round(((normalizeNumber(value?.bearingDegrees) % 360) + 360) % 360),
        updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    };
}

export function roundDiscoveryCoordinate(value: number): number {
    return Math.round(Number(value) * 10000) / 10000;
}

async function parseJsonOrThrow(response: Response, fallback: string): Promise<any> {
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(`${fallback}: ${response.status} ${text}`);
    }
    return body;
}

export async function fetchCirclePrimaryGeoAnchor(
    circleId: number,
    actorPubkey: string,
    signal?: AbortSignal,
): Promise<CircleGeoAnchorDto | null> {
    const route = await resolveNodeRoute('circle_location_management');
    const params = new URLSearchParams({ actorPubkey });
    const response = await authenticatedApiFetch(
        `${route.urlBase}/api/v1/circle-locations/circles/${circleId}/primary-anchor?${params.toString()}`,
        {
            method: 'GET',
            cache: 'no-store',
            signal,
        },
    );
    const data = await parseJsonOrThrow(response, 'fetch circle primary geo anchor failed');
    return normalizeAnchor(data?.anchor);
}

export async function updateCirclePrimaryGeoAnchor(
    circleId: number,
    input: CircleGeoAnchorInput,
    auth: CircleLocationUpdateAuth,
): Promise<CircleLocationMutationResult> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle location auth missing');
    }
    const payload = normalizeCircleGeoAnchorEnvelopePayload({
        operation: 'upsert',
        label: input.label,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        radiusMeters: input.radiusMeters,
        visibility: input.visibility,
    });
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'circle_geo_anchor',
        payload,
        auth,
    });
    const route = await resolveNodeRoute('circle_location_management');
    const response = await authenticatedApiFetch(
        `${route.urlBase}/api/v1/circle-locations/circles/${circleId}/primary-anchor`,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...payload,
                actorPubkey: auth.actorPubkey,
                signedMessage,
                signature,
            }),
        },
    );
    const data = await parseJsonOrThrow(response, 'update circle primary geo anchor failed');
    if (response.status === 202 || data?.status === 'requires_governance') {
        return {
            status: 'requires_governance',
            request: normalizeGovernanceRequest(data?.request),
        };
    }
    return {
        status: 'executed',
        circleId: Number(data?.circleId || circleId),
        anchor: normalizeAnchor(data?.anchor),
    };
}

export async function archiveCirclePrimaryGeoAnchor(
    circleId: number,
    input: { anchorId?: string | null },
    auth: CircleLocationUpdateAuth,
): Promise<CircleLocationMutationResult> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle location auth missing');
    }
    const payload = normalizeCircleGeoAnchorEnvelopePayload({
        operation: 'archive',
        anchorId: input.anchorId || undefined,
    });
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'circle_geo_anchor',
        payload,
        auth,
    });
    const route = await resolveNodeRoute('circle_location_management');
    const response = await authenticatedApiFetch(
        `${route.urlBase}/api/v1/circle-locations/circles/${circleId}/primary-anchor/archive`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...payload,
                actorPubkey: auth.actorPubkey,
                signedMessage,
                signature,
            }),
        },
    );
    const data = await parseJsonOrThrow(response, 'archive circle primary geo anchor failed');
    if (response.status === 202 || data?.status === 'requires_governance') {
        return {
            status: 'requires_governance',
            request: normalizeGovernanceRequest(data?.request),
        };
    }
    return {
        status: 'executed',
        circleId: Number(data?.circleId || circleId),
        anchor: null,
        archived: Boolean(data?.archived),
        anchorId: typeof data?.anchorId === 'string' ? data.anchorId : null,
    };
}

export async function fetchNearbyCircleLocations(
    input: NearbyCircleLocationInput,
): Promise<{ items: NearbyCircleLocationDto[] }> {
    const route = await resolveNodeRoute('location_discovery');
    const radiusMeters = Math.max(500, Math.min(50000, Math.floor(Number(input.radiusMeters || 5000))));
    const limit = input.limit === undefined
        ? undefined
        : Math.max(1, Math.min(50, Math.floor(Number(input.limit))));
    const requestInit: RequestInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            centerLat: roundDiscoveryCoordinate(input.centerLat),
            centerLng: roundDiscoveryCoordinate(input.centerLng),
            radiusMeters,
            ...(limit ? { limit } : {}),
        }),
    };
    const response = await apiFetch(
        `${route.urlBase}/api/v1/location-discovery/nearby`,
        requestInit,
    );
    const data = await parseJsonOrThrow(response, 'fetch nearby circle locations failed');
    const items = Array.isArray(data?.items) ? data.items.map(normalizeNearbyItem) : [];
    return { items };
}
