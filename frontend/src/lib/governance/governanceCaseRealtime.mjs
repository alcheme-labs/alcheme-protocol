/**
 * @param {unknown} error
 * @returns {number | null}
 */
export function governanceCaseRequestStatus(error) {
    if (error && typeof error === 'object') {
        const status = Number(error.status ?? error.statusCode);
        if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
    const message = error instanceof Error ? error.message : String(error ?? '');
    const match = /^(\d{3})(?:\s|$)/.exec(message);
    return match ? Number(match[1]) : null;
}

/**
 * Start the HTTP Case projection fallback. The caller supplies the projection
 * policy; this controller never infers workflow phase or reads a chain RPC.
 *
 * @param {{
 *   policy: {mode: string, refreshAfterMs: number | null, terminal: boolean},
 *   getVisibilityState: () => string,
 *   load: () => Promise<unknown>,
 *   setTimer?: (callback: () => void, delay: number) => unknown,
 *   clearTimer?: (id: unknown) => void,
 *   addVisibilityListener?: (listener: () => void) => void,
 *   removeVisibilityListener?: (listener: () => void) => void,
 * }} input
 * @returns {() => void}
 */
export function startGovernanceCaseForegroundRefetch(input) {
    const refreshAfterMs = input.policy?.refreshAfterMs;
    if (
        input.policy?.mode !== 'foreground_refetch'
        || input.policy?.terminal !== false
        || !Number.isInteger(refreshAfterMs)
        || refreshAfterMs < 3_000
        || refreshAfterMs > 5_000
    ) return () => undefined;

    const setTimer = input.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay));
    const clearTimer = input.clearTimer ?? ((id) => window.clearTimeout(Number(id)));
    const addVisibilityListener = input.addVisibilityListener
        ?? ((listener) => document.addEventListener('visibilitychange', listener));
    const removeVisibilityListener = input.removeVisibilityListener
        ?? ((listener) => document.removeEventListener('visibilitychange', listener));
    let stopped = false;
    let inFlight = false;
    let timer = null;

    const clearScheduled = () => {
        if (timer === null) return;
        clearTimer(timer);
        timer = null;
    };
    const schedule = () => {
        if (
            stopped
            || inFlight
            || timer !== null
            || input.getVisibilityState() !== 'visible'
        ) return;
        timer = setTimer(run, refreshAfterMs);
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearScheduled();
        removeVisibilityListener(onVisibilityChange);
    };
    const run = () => {
        timer = null;
        if (stopped || inFlight || input.getVisibilityState() !== 'visible') return;
        inFlight = true;
        void Promise.resolve()
            .then(input.load)
            .catch((error) => {
                const status = governanceCaseRequestStatus(error);
                if (status === 401 || status === 403 || status === 404 || status === 410) stop();
            })
            .finally(() => {
                inFlight = false;
                schedule();
            });
    };
    const onVisibilityChange = () => {
        clearScheduled();
        if (input.getVisibilityState() === 'visible') run();
    };

    addVisibilityListener(onVisibilityChange);
    schedule();
    return stop;
}
