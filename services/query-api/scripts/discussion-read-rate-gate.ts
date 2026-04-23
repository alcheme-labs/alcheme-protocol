/* eslint-disable no-console */

type Sample = {
    status: number;
    durationMs: number;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ratio(part: number, whole: number): number {
    if (whole <= 0) return 0;
    return part / whole;
}

async function main() {
    const baseUrl = (process.env.DISCUSSION_RATE_GATE_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
    const circleId = parsePositiveInt(process.env.DISCUSSION_RATE_GATE_CIRCLE_ID, 1);
    const durationMs = parsePositiveInt(process.env.DISCUSSION_RATE_GATE_DURATION_MS, 120_000);
    const basePollMs = parsePositiveInt(process.env.DISCUSSION_RATE_GATE_BASE_POLL_MS, 3_000);
    const backoffMaxMs = parsePositiveInt(process.env.DISCUSSION_RATE_GATE_BACKOFF_MAX_MS, 30_000);
    const limit = parsePositiveInt(process.env.DISCUSSION_RATE_GATE_LIMIT, 120);
    const includeDeleted = process.env.DISCUSSION_RATE_GATE_INCLUDE_DELETED === 'true';

    const query = new URLSearchParams();
    query.set('limit', String(limit));
    if (includeDeleted) {
        query.set('includeDeleted', 'true');
    }

    const endpoint = `${baseUrl}/api/v1/discussion/circles/${circleId}/messages?${query.toString()}`;

    const startedAt = Date.now();
    let nextDelayMs = basePollMs;
    let failures = 0;
    const samples: Sample[] = [];

    console.log('[discussion-read-rate-gate] start', {
        endpoint,
        durationMs,
        basePollMs,
        backoffMaxMs,
    });

    while (Date.now() - startedAt < durationMs) {
        const requestStart = Date.now();
        let status = 0;

        try {
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                },
            });
            status = response.status;
            // Consume body to include response transfer in latency samples.
            await response.text();
        } catch {
            status = 0;
        }

        const duration = Date.now() - requestStart;
        samples.push({ status, durationMs: duration });

        const isSuccess = status >= 200 && status < 300;
        if (isSuccess) {
            failures = 0;
            nextDelayMs = basePollMs;
        } else {
            failures = Math.min(failures + 1, 8);
            nextDelayMs = Math.min(backoffMaxMs, basePollMs * (2 ** failures));
        }

        const elapsed = Date.now() - startedAt;
        const remaining = durationMs - elapsed;
        if (remaining <= 0) break;
        await sleep(Math.min(nextDelayMs, remaining));
    }

    const totalRequests = samples.length;
    const status429 = samples.filter((sample) => sample.status === 429).length;
    const status5xx = samples.filter((sample) => sample.status >= 500 && sample.status < 600).length;
    const status2xx = samples.filter((sample) => sample.status >= 200 && sample.status < 300).length;
    const networkFailures = samples.filter((sample) => sample.status === 0).length;
    const avgLatencyMs = totalRequests > 0
        ? Number((samples.reduce((sum, sample) => sum + sample.durationMs, 0) / totalRequests).toFixed(2))
        : 0;
    const maxLatencyMs = samples.reduce((max, sample) => Math.max(max, sample.durationMs), 0);

    const ratio429 = ratio(status429, totalRequests);
    const ratio5xx = ratio(status5xx, totalRequests);

    const gateResult = {
        totalRequests,
        status2xx,
        status429,
        status5xx,
        networkFailures,
        ratio429,
        ratio5xx,
        avgLatencyMs,
        maxLatencyMs,
    };

    console.log('[discussion-read-rate-gate] summary', gateResult);

    const failuresSummary: string[] = [];
    if (totalRequests < 35) {
        failuresSummary.push(`total requests below threshold: ${totalRequests} < 35`);
    }
    if (ratio429 > 0) {
        failuresSummary.push(`429 ratio must be 0, got ${(ratio429 * 100).toFixed(2)}%`);
    }
    if (ratio5xx > 0.01) {
        failuresSummary.push(`5xx ratio must be <= 1%, got ${(ratio5xx * 100).toFixed(2)}%`);
    }

    if (failuresSummary.length > 0) {
        console.error('[discussion-read-rate-gate] FAIL', {
            failures: failuresSummary,
        });
        process.exit(1);
    }

    console.log('[discussion-read-rate-gate] PASS');
}

main().catch((error) => {
    console.error('[discussion-read-rate-gate] ERROR', error);
    process.exit(1);
});
