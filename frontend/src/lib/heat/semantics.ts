export type HeatState = 'active' | 'cooling' | 'frozen';

export const HEAT_ACTIVE_MIN = 50;
export const HEAT_COOLING_MIN = 10;

const HEAT_STATE_LABELS: Record<HeatState, string> = {
    active: '活跃',
    cooling: '冷却中',
    frozen: '已冻结',
};

export function clampHeatScore(score: number): number {
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, score));
}

export function resolveHeatState(score: number): HeatState {
    const clamped = clampHeatScore(score);
    if (clamped > HEAT_ACTIVE_MIN) return 'active';
    if (clamped >= HEAT_COOLING_MIN) return 'cooling';
    return 'frozen';
}

export function resolveHeatStateLabel(state: HeatState): string {
    return HEAT_STATE_LABELS[state];
}

export function resolveHeatLabel(score: number): string {
    return resolveHeatStateLabel(resolveHeatState(score));
}

export function resolveHeatTemperature(score: number): number {
    return clampHeatScore(score) / 100;
}
