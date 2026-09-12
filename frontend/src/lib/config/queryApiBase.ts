export const DEFAULT_QUERY_API_GRAPHQL_URL = 'http://127.0.0.1:4000/graphql';
export const DEFAULT_QUERY_API_BASE_URL = 'http://127.0.0.1:4000';

export function getQueryApiBaseUrl(graphqlEndpoint = DEFAULT_QUERY_API_GRAPHQL_URL): string {
    const explicitBaseUrl = String(process.env.NEXT_PUBLIC_QUERY_API_BASE_URL || '').trim();
    if (explicitBaseUrl) {
        try {
            return new URL(explicitBaseUrl).origin;
        } catch {
            // fall through to graphql-derived bootstrap
        }
    }

    try {
        return new URL(graphqlEndpoint).origin;
    } catch {
        return DEFAULT_QUERY_API_BASE_URL;
    }
}
