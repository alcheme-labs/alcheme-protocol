const MAX_TRUSTED_PROXY_HOPS = 8;

export function resolveQueryApiTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.QUERY_API_TRUST_PROXY_HOPS;
    if (raw === undefined) return 0;

    const normalized = raw.trim();
    if (!/^\d+$/.test(normalized)) {
        throw new Error('QUERY_API_TRUST_PROXY_HOPS must be an integer from 0 to 8');
    }
    const hops = Number(normalized);
    if (!Number.isSafeInteger(hops) || hops < 0 || hops > MAX_TRUSTED_PROXY_HOPS) {
        throw new Error('QUERY_API_TRUST_PROXY_HOPS must be an integer from 0 to 8');
    }
    return hops;
}
