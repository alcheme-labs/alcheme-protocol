const INSECURE_JWT_SECRET_DEFAULTS = new Set([
    'change-me-in-production',
    'dev-secret',
    'CHANGE_ME_LONG_RANDOM_JWT_SECRET',
    'CHANGE_ME_JWT_SECRET',
]);

const INSECURE_SHARED_SECRET_DEFAULTS = new Set([
    ...INSECURE_JWT_SECRET_DEFAULTS,
    'CHANGE_ME_INTERNAL_API_TOKEN',
    'CHANGE_ME_EXTERNAL_APP_ADMIN_TOKEN',
    'CHANGE_ME_ANCHOR_SIGNER_TOKEN',
]);

function normalizeOptionalString(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function parseBool(value: string | undefined, fallback = false): boolean {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return fallback;
}

function isLocalHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    return normalized === 'localhost'
        || normalized === '127.0.0.1'
        || normalized === '::1'
        || normalized.endsWith('.localhost');
}

function isNonLocalHttpUrl(value: string | undefined): boolean {
    const normalized = normalizeOptionalString(value);
    if (!normalized) return false;
    try {
        const url = new URL(normalized);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        return !isLocalHostname(url.hostname);
    } catch {
        return false;
    }
}

function hasNonLocalHttpOriginList(value: string | undefined): boolean {
    const normalized = normalizeOptionalString(value);
    if (!normalized) return false;
    return normalized
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .some(isNonLocalHttpUrl);
}

export function isPublicHardeningRequired(env: NodeJS.ProcessEnv = process.env): boolean {
    const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
    const deploymentProfile = env.QUERY_API_DEPLOYMENT_PROFILE?.trim().toLowerCase();
    return nodeEnv === 'production'
        || parseBool(env.QUERY_API_PUBLIC_HARDENING, false)
        || deploymentProfile === 'public_node_only'
        || isNonLocalHttpUrl(env.QUERY_API_PUBLIC_BASE_URL)
        || isNonLocalHttpUrl(env.QUERY_API_SIDECAR_BASE_URL)
        || hasNonLocalHttpOriginList(env.CORS_ALLOWED_ORIGINS);
}

export function isExplicitFalse(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === '0' || normalized === 'false' || normalized === 'no';
}

export function isInsecureSharedSecretValue(value: string | undefined): boolean {
    const configured = normalizeOptionalString(value);
    if (!configured) return false;
    const upper = configured.toUpperCase();
    return INSECURE_SHARED_SECRET_DEFAULTS.has(configured)
        || upper.startsWith('CHANGE_ME')
        || upper.startsWith('CHANGE-ME')
        || upper.startsWith('CHANGEME');
}

export function assertStrongPublicSecret(input: {
    value: string | undefined;
    requiredError: string;
    insecureDefaultError: string;
    tooShortError: string;
    minLength?: number;
}): string {
    const configured = normalizeOptionalString(input.value);
    if (!configured) {
        throw new Error(input.requiredError);
    }
    if (isInsecureSharedSecretValue(configured)) {
        throw new Error(input.insecureDefaultError);
    }
    if (configured.length < (input.minLength ?? 24)) {
        throw new Error(input.tooShortError);
    }
    return configured;
}

export function resolveJwtSecret(
    env: NodeJS.ProcessEnv = process.env,
    options: {
        publicHardeningRequired?: boolean;
        localFallback?: string;
    } = {},
): string {
    const publicHardeningRequired = options.publicHardeningRequired ?? isPublicHardeningRequired(env);
    const localFallback = options.localFallback ?? 'change-me-in-production';
    const configured = normalizeOptionalString(env.JWT_SECRET);
    const secret = configured ?? localFallback;

    if (!publicHardeningRequired) {
        return secret;
    }
    return assertStrongPublicSecret({
        value: configured ?? undefined,
        requiredError: 'jwt_secret_required',
        insecureDefaultError: 'jwt_secret_insecure_default',
        tooShortError: 'jwt_secret_too_short',
    });
}
