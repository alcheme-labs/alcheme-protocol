import { apiFetch, authenticatedApiFetch } from '@/lib/api/fetch';
export type GhostDraftTriggerMode = 'notify_only' | 'auto_draft';

import { getQueryApiBaseUrl as deriveQueryApiBaseUrl } from '@/lib/config/queryApiBase';
import {
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
    normalizeGhostSettingsEnvelopePayload,
} from '@/lib/circles/settingsEnvelope';

export interface CircleGhostSettings {
    summaryUseLLM: boolean;
    draftTriggerMode: GhostDraftTriggerMode;
    triggerSummaryUseLLM: boolean;
    triggerGenerateComment: boolean;
}

export interface CircleGhostSettingsResponse {
    circleId: number;
    source: 'circle' | 'pending' | 'global_default';
    settings: CircleGhostSettings;
}

export const CIRCLE_GHOST_SETTINGS_GOVERNANCE_ACTION = 'circle.policy.ghost.update';

export interface CircleGhostSettingsGovernancePending {
    requestId: string;
    requestedSettings: CircleGhostSettings;
}

export type CircleGhostSettingsUpdateResult =
    | ({ status: 'executed' } & CircleGhostSettingsResponse)
    | ({
        status: 'requires_governance';
        actionType: string;
        request: {
            id: string;
            state: string | null;
            payload: Record<string, unknown> | null;
        };
        requestedSettings: CircleGhostSettings;
      });

export interface GhostSettingsUpdateAuth extends CircleSettingsEnvelopeAuth {
    creationTxSignature?: string;
}

function getQueryApiBaseUrl(): string {
    return deriveQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
}

function normalizeTriggerMode(value: unknown): GhostDraftTriggerMode {
    return String(value || '').toLowerCase() === 'auto_draft' ? 'auto_draft' : 'notify_only';
}

function normalizeBool(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.toLowerCase().trim();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return fallback;
}

export function normalizeCircleGhostSettings(
    value: any,
    fallback?: CircleGhostSettings,
): CircleGhostSettings {
    return {
        summaryUseLLM: normalizeBool(value?.summaryUseLLM, fallback?.summaryUseLLM ?? false),
        draftTriggerMode: value?.draftTriggerMode === undefined
            ? fallback?.draftTriggerMode ?? 'notify_only'
            : normalizeTriggerMode(value?.draftTriggerMode),
        triggerSummaryUseLLM: normalizeBool(
            value?.triggerSummaryUseLLM,
            fallback?.triggerSummaryUseLLM ?? false,
        ),
        triggerGenerateComment: normalizeBool(
            value?.triggerGenerateComment,
            fallback?.triggerGenerateComment ?? true,
        ),
    };
}


export async function fetchCircleGhostSettings(
    circleId: number,
    signal?: AbortSignal,
): Promise<CircleGhostSettingsResponse> {
    const baseUrl = getQueryApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/circles/${circleId}/ghost-settings`, {
        method: 'GET',
        cache: 'no-store',
        signal,
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`fetch ghost settings failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    return {
        circleId: Number(data?.circleId || circleId),
        source: data?.source === 'circle' ? 'circle' : data?.source === 'pending' ? 'pending' : 'global_default',
        settings: normalizeCircleGhostSettings(data?.settings),
    };
}

export async function updateCircleGhostSettings(
    circleId: number,
    settings: Partial<CircleGhostSettings>,
    auth: GhostSettingsUpdateAuth,
): Promise<CircleGhostSettingsUpdateResult> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('ghost settings auth missing');
    }

    const patch = normalizeGhostSettingsEnvelopePayload({
        summaryUseLLM: settings.summaryUseLLM,
        draftTriggerMode: settings.draftTriggerMode,
        triggerSummaryUseLLM: settings.triggerSummaryUseLLM,
        triggerGenerateComment: settings.triggerGenerateComment,
    });
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'ghost_settings',
        payload: patch,
        auth,
        anchor: auth.creationTxSignature ? { creationTxSignature: auth.creationTxSignature } : null,
    });

    const baseUrl = getQueryApiBaseUrl();
    const response = await authenticatedApiFetch(`${baseUrl}/api/v1/circles/${circleId}/ghost-settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...patch,
            actorPubkey: auth.actorPubkey,
            signedMessage,
            signature,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`update ghost settings failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    if (response.status === 202 || data?.status === 'requires_governance') {
        const requestPayload = data?.request?.payload && typeof data.request.payload === 'object'
            ? data.request.payload as Record<string, unknown>
            : null;
        const requestedSettings = normalizeCircleGhostSettings(requestPayload || patch);
        return {
            status: 'requires_governance',
            actionType: String(data?.actionType || CIRCLE_GHOST_SETTINGS_GOVERNANCE_ACTION),
            request: {
                id: String(data?.request?.id || ''),
                state: typeof data?.request?.state === 'string' ? data.request.state : null,
                payload: requestPayload,
            },
            requestedSettings,
        };
    }
    return {
        status: 'executed',
        circleId: Number(data?.circleId || circleId),
        source: data?.source === 'pending' ? 'pending' : 'circle',
        settings: normalizeCircleGhostSettings(data?.settings),
    };
}
