const inFlightRequests = new Map();

/**
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export function runGovernanceBootstrapSingleFlight(key, operation) {
    const existing = inFlightRequests.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(operation);
    const tracked = request.finally(() => {
        if (inFlightRequests.get(key) === tracked) inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, tracked);
    return tracked;
}

/**
 * @param {string | null} value
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function parseRetryAfterSeconds(value, nowMs = Date.now()) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
    const retryAt = Date.parse(value);
    if (!Number.isFinite(retryAt)) return null;
    return Math.max(1, Math.ceil((retryAt - nowMs) / 1000));
}
