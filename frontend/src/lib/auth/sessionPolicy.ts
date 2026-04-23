export function parseAuthSessionSignatureRequirement(value: string | undefined): boolean {
    if (value === undefined) return false;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return false;
}

export function requiresAuthSessionSignature(envValue = process.env.NEXT_PUBLIC_AUTH_SESSION_REQUIRE_SIGNATURE): boolean {
    return parseAuthSessionSignatureRequirement(envValue);
}

export function shouldSignAuthSession<T>(
    signMessage: T | undefined,
    envValue = process.env.NEXT_PUBLIC_AUTH_SESSION_REQUIRE_SIGNATURE,
): T | undefined {
    return requiresAuthSessionSignature(envValue) ? signMessage : undefined;
}
