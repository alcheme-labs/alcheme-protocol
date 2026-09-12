import { authenticatedApiFetch } from '@/lib/api/fetch';
import { getQueryApiBaseUrl as deriveQueryApiBaseUrl } from '@/lib/config/queryApiBase';
import {
    normalizePostCreateSettingsEnvelopePayload,
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
} from '@/lib/circles/settingsEnvelope';
import type { CircleGhostSettings } from './circlesGhostSettings';
import type {
    CircleDraftLifecycleTemplatePatch,
    CircleDraftWorkflowPolicy,
} from './circlesPolicyProfile';
import type { CircleGenesisMode } from './circlesGenesisMode';

export interface CirclePostCreateSettingsPatch {
    description?: string | null;
    ghostSettings?: Partial<CircleGhostSettings>;
    genesisMode?: CircleGenesisMode;
    joinPolicy?: {
        accessType: 'free' | 'crystal' | 'invite' | 'approval';
        minCrystals: number;
    };
    draftLifecycleTemplate?: CircleDraftLifecycleTemplatePatch;
    draftWorkflowPolicy?: CircleDraftWorkflowPolicy;
}

export type CirclePostCreateSettingsResponse = {
    status?: 'executed';
    ok: boolean;
    circleId: number;
    appliedFields: string[];
    details?: Record<string, unknown>;
} | {
    status: 'requires_governance';
    actionType?: string;
    request?: Record<string, unknown>;
    appliedFields: string[];
};

export interface CirclePostCreateSettingsAuth extends CircleSettingsEnvelopeAuth {}

function getQueryApiBaseUrl(): string {
    return deriveQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
}

function normalizePatch(input: CirclePostCreateSettingsPatch): CirclePostCreateSettingsPatch {
    const payload = normalizePostCreateSettingsEnvelopePayload(input as any);
    return payload as CirclePostCreateSettingsPatch;
}

export async function updateCirclePostCreateSettings(
    circleId: number,
    input: CirclePostCreateSettingsPatch,
    auth: CirclePostCreateSettingsAuth,
): Promise<CirclePostCreateSettingsResponse> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle post-create settings auth missing');
    }
    const patch = normalizePatch(input);
    if (Object.keys(patch).length === 0) {
        return {
            ok: true,
            circleId,
            appliedFields: [],
            details: {},
        };
    }

    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'post_create_settings',
        payload: patch as Record<string, unknown>,
        auth,
    });

    const response = await authenticatedApiFetch(`${getQueryApiBaseUrl()}/api/v1/circles/${circleId}/post-create-settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            actorPubkey: auth.actorPubkey,
            patch,
            signedMessage,
            signature,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`update circle post-create settings failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    if (data?.status === 'requires_governance') {
        return {
            status: 'requires_governance',
            actionType: typeof data.actionType === 'string' ? data.actionType : undefined,
            request: data.request && typeof data.request === 'object' ? data.request : undefined,
            appliedFields: Array.isArray(data?.appliedFields)
                ? data.appliedFields.map((entry: unknown) => String(entry))
                : [],
        };
    }
    if (!data?.ok) {
        throw new Error(`update circle post-create settings failed: unexpected response ${JSON.stringify(data)}`);
    }
    return {
        status: 'executed',
        ok: Boolean(data?.ok),
        circleId: Number(data?.circleId || circleId),
        appliedFields: Array.isArray(data?.appliedFields)
            ? data.appliedFields.map((entry: unknown) => String(entry))
            : [],
        details: data?.details && typeof data.details === 'object' ? data.details : {},
    };
}
