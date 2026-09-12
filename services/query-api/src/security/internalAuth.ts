import type { IncomingHttpHeaders } from 'node:http';

import { isInsecureSharedSecretValue } from '../config/jwtSecret';

function normalizeToken(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function parseBearerToken(headerValue: string | undefined): string | null {
    const normalized = normalizeToken(headerValue);
    if (!normalized?.startsWith('Bearer ')) return null;
    return normalizeToken(normalized.slice('Bearer '.length));
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

export function configuredInternalApiToken(env: NodeJS.ProcessEnv = process.env): string | null {
    const token = normalizeToken(env.INTERNAL_API_TOKEN);
    if (!token || isInsecureSharedSecretValue(token)) return null;
    return token;
}

export function readInternalApiRequestToken(headers: IncomingHttpHeaders): string | null {
    const headerToken = normalizeToken(firstHeaderValue(headers['x-internal-api-token']));
    if (headerToken) return headerToken;
    return parseBearerToken(firstHeaderValue(headers.authorization));
}

export function isInternalApiRequest(input: {
    headers: IncomingHttpHeaders;
    env?: NodeJS.ProcessEnv;
}): boolean {
    const expected = configuredInternalApiToken(input.env ?? process.env);
    if (!expected) return false;
    return readInternalApiRequestToken(input.headers) === expected;
}

export function assertInternalApiRequest(input: {
    headers: IncomingHttpHeaders;
    env?: NodeJS.ProcessEnv;
}): void {
    if (!isInternalApiRequest(input)) {
        throw new Error('Internal API token required');
    }
}
