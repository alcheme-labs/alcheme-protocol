export function formatCoordinate(value: number): string {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(6);
}

export function formatRadius(meters: number): string {
    const value = Math.max(0, Math.round(Number(meters || 0)));
    if (value >= 1000) {
        const km = value / 1000;
        return `${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km`;
    }
    return `${value} m`;
}

export function formatAnchorUpdatedAt(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}
