export function startMembershipRefresh<TSnapshot, TStatus>(input: {
    circleId: number;
    reset: () => void;
    fetchSnapshot: (circleId: number) => Promise<TSnapshot | null>;
    fetchStatus: (circleId: number) => Promise<TStatus | null>;
    apply: (result: {
        snapshot: TSnapshot | null;
        status: TStatus | null;
        snapshotFailed: boolean;
        statusFailed: boolean;
    }) => void;
    finalize?: () => void;
}): () => void {
    let cancelled = false;

    input.reset();

    void Promise.allSettled([
        input.fetchSnapshot(input.circleId),
        input.fetchStatus(input.circleId),
    ])
        .then(([snapshotResult, statusResult]) => {
            if (cancelled) return;
            input.apply({
                snapshot: snapshotResult.status === 'fulfilled' ? snapshotResult.value : null,
                status: statusResult.status === 'fulfilled' ? statusResult.value : null,
                snapshotFailed: snapshotResult.status === 'rejected',
                statusFailed: statusResult.status === 'rejected',
            });
        })
        .finally(() => {
            if (!cancelled) {
                input.finalize?.();
            }
        });

    return () => {
        cancelled = true;
    };
}
