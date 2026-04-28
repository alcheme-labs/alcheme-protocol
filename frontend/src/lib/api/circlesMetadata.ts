import { apiFetch } from '@/lib/api/fetch';
import { getQueryApiBaseUrl as deriveQueryApiBaseUrl } from '@/lib/config/queryApiBase';
import {
    normalizeCircleMetadataEnvelopePayload,
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
} from '@/lib/circles/settingsEnvelope';

export interface CircleMetadataUpdateAuth extends CircleSettingsEnvelopeAuth {}

function getQueryApiBaseUrl(): string {
    return deriveQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
}

export async function updateCircleMetadata(
    circleId: number,
    input: {
        description?: string | null;
    },
    auth: CircleMetadataUpdateAuth,
): Promise<{ circleId: number; name?: string | null; description?: string | null }> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle metadata auth missing');
    }

    const payload = normalizeCircleMetadataEnvelopePayload(input);
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'circle_metadata',
        payload,
        auth,
    });

    const response = await apiFetch(`${getQueryApiBaseUrl()}/api/v1/circles/${circleId}/metadata`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            actorPubkey: auth.actorPubkey,
            description: payload.description ?? null,
            signedMessage,
            signature,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`update circle metadata failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    return {
        circleId: Number(data?.circleId || circleId),
        name: typeof data?.metadata?.name === 'string' ? data.metadata.name : null,
        description: typeof data?.metadata?.description === 'string' ? data.metadata.description : null,
    };
}
