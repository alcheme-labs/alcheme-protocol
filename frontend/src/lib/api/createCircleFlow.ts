import { apiFetch } from './fetch.ts';
import { getQueryApiBaseUrl as deriveQueryApiBaseUrl } from '../config/queryApiBase.ts';

const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;
const DEFAULT_VISIBILITY_POLL_MS = 1_500;
const DEFAULT_POST_CREATE_SYNC_TIMEOUT_MS = 20_000;

type FetchLike = typeof fetch;

export type CreateCirclePostCreateSyncResult<T> =
    | { status: 'completed'; value: T }
    | { status: 'failed'; error: unknown }
    | { status: 'timeout' };

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getQueryApiBaseUrl(): string {
    return deriveQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
}

export function getCreateCircleSignerUnavailableError(
    signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined,
): string | null {
    if (signMessage) {
        return null;
    }
    return '当前钱包不支持消息签名，无法完成圈层配置保存。请切换支持消息签名的钱包后再创建。';
}

export async function settleCreateCirclePostCreateSync<T>(
    operation: () => Promise<T>,
    input: { timeoutMs?: number } = {},
): Promise<CreateCirclePostCreateSyncResult<T>> {
    const timeoutMs = Math.max(1, input.timeoutMs ?? DEFAULT_POST_CREATE_SYNC_TIMEOUT_MS);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const operationResult = Promise.resolve()
        .then(operation)
        .then((value): CreateCirclePostCreateSyncResult<T> => ({
            status: 'completed',
            value,
        }))
        .catch((error): CreateCirclePostCreateSyncResult<T> => ({
            status: 'failed',
            error,
        }));

    const timeoutResult = new Promise<CreateCirclePostCreateSyncResult<T>>((resolve) => {
        timeoutId = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    });

    try {
        return await Promise.race([operationResult, timeoutResult]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

export async function waitForCircleReadModelVisibility(input: {
    circleId: number;
    baseUrl?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    pollMs?: number;
}): Promise<boolean> {
    const baseUrl = input.baseUrl || getQueryApiBaseUrl();
    const fetchImpl = input.fetchImpl ?? fetch;
    const timeoutMs = Math.max(1, input.timeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS);
    const pollMs = Math.max(1, input.pollMs ?? DEFAULT_VISIBILITY_POLL_MS);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await apiFetch(`${baseUrl}/api/v1/circles/${input.circleId}`, {
                fetchImpl,
                init: {
                    method: 'GET',
                    cache: 'no-store',
                },
            });
            if (response.ok) {
                return true;
            }
        } catch {
            // Ignore transient fetch failures while polling for eventual visibility.
        }

        await sleep(pollMs);
    }

    return false;
}
