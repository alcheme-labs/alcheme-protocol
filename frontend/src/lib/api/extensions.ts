import { apiFetch } from './fetch.ts';
import { getPublicNodeGraphqlUrl } from './nodeRouting.ts';
import { getQueryApiBaseUrl } from '../config/queryApiBase.ts';
import type { ExtensionCapabilitiesResponse } from '../extensions/types.ts';

type FetchLike = typeof fetch;

export function buildExtensionCapabilitiesUrl(graphqlEndpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || getPublicNodeGraphqlUrl()): string {
    return `${getQueryApiBaseUrl(graphqlEndpoint)}/api/v1/extensions/capabilities`;
}

export async function fetchExtensionCapabilities(input: {
    graphqlEndpoint?: string;
    fetchImpl?: FetchLike;
} = {}): Promise<ExtensionCapabilitiesResponse> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await apiFetch(buildExtensionCapabilitiesUrl(input.graphqlEndpoint), {
        fetchImpl,
        init: {
            cache: 'no-store',
            headers: {
                Accept: 'application/json',
            },
        },
    });

    if (!response.ok) {
        throw new Error(`extension capability request failed: ${response.status}`);
    }

    return response.json() as Promise<ExtensionCapabilitiesResponse>;
}
