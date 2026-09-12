import rateLimit from 'express-rate-limit';

const DEFAULT_COMMUNICATION_INGRESS_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_COMMUNICATION_INGRESS_MAX = 6000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveCommunicationIngressRateLimitSettings(
    env: NodeJS.ProcessEnv = process.env,
) {
    return {
        windowMs: parsePositiveInt(
            env.COMMUNICATION_INGRESS_RATE_LIMIT_WINDOW_MS,
            DEFAULT_COMMUNICATION_INGRESS_WINDOW_MS,
        ),
        max: parsePositiveInt(
            env.COMMUNICATION_INGRESS_RATE_LIMIT_MAX,
            DEFAULT_COMMUNICATION_INGRESS_MAX,
        ),
    };
}

export function createCommunicationIngressLimiter(
    overrides: Partial<{ windowMs: number; max: number }> = {},
) {
    const settings = {
        ...resolveCommunicationIngressRateLimitSettings(),
        ...overrides,
    };
    return rateLimit({
        windowMs: settings.windowMs,
        max: settings.max,
        message: {
            error: 'Too many communication requests',
            message: 'Please try again later',
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.method === 'OPTIONS',
    });
}

export const communicationIngressLimiter = createCommunicationIngressLimiter();
