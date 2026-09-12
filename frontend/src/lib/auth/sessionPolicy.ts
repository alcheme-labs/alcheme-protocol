export function parseAuthSessionSignatureRequirement(value: string | undefined, fallback = false): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return fallback;
}

export function requiresAuthSessionSignature(
    envValue = process.env.NEXT_PUBLIC_AUTH_SESSION_REQUIRE_SIGNATURE,
    fallback = process.env.NODE_ENV === 'production',
): boolean {
    return parseAuthSessionSignatureRequirement(envValue, fallback);
}

export function shouldSignAuthSession<T>(
    signMessage: T | undefined,
    envValue = process.env.NEXT_PUBLIC_AUTH_SESSION_REQUIRE_SIGNATURE,
    fallback = process.env.NODE_ENV === 'production',
): T | undefined {
    return requiresAuthSessionSignature(envValue, fallback) ? signMessage : undefined;
}
