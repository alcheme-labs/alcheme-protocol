import { apiFetch } from '@/lib/api/fetch';
import { getQueryApiBaseUrl as deriveQueryApiBaseUrl } from '@/lib/config/queryApiBase';
import {
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
    normalizeGenesisModeEnvelopePayload,
} from '@/lib/circles/settingsEnvelope';

export type CircleGenesisMode = 'BLANK' | 'SEEDED';

export interface CircleGenesisModeUpdateAuth extends CircleSettingsEnvelopeAuth {}

function getQueryApiBaseUrl(): string {
    return deriveQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
}

function normalizeGenesisMode(value: unknown): CircleGenesisMode {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'BLANK') return 'BLANK';
    if (normalized === 'SEEDED') return 'SEEDED';
    throw new Error(`invalid genesis mode: ${String(value ?? '')}`);
}

export async function updateCircleGenesisMode(
    circleId: number,
    genesisMode: CircleGenesisMode,
    auth: CircleGenesisModeUpdateAuth,
): Promise<{ circleId: number; genesisMode: CircleGenesisMode }> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('genesis mode auth missing');
    }

    const canonicalGenesisMode = normalizeGenesisMode(genesisMode);
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'genesis_mode',
        payload: normalizeGenesisModeEnvelopePayload({
            genesisMode: canonicalGenesisMode,
        }),
        auth,
    });

    const response = await apiFetch(`${getQueryApiBaseUrl()}/api/v1/circles/${circleId}/genesis-mode`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            actorPubkey: auth.actorPubkey,
            genesisMode: canonicalGenesisMode,
            signedMessage,
            signature,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`update genesis mode failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    return {
        circleId: Number(data?.circleId || circleId),
        genesisMode: normalizeGenesisMode(data?.genesisMode),
    };
}
