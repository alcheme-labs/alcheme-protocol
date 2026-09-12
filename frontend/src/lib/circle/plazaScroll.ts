export const PLAZA_SCROLL_FOLLOW_THRESHOLD_PX = 72;

export function isPlazaScrolledNearBottom(input: {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
    thresholdPx?: number;
}): boolean {
    const thresholdPx = Math.max(0, input.thresholdPx ?? PLAZA_SCROLL_FOLLOW_THRESHOLD_PX);
    const distanceFromBottom = input.scrollHeight - input.scrollTop - input.clientHeight;
    return distanceFromBottom <= thresholdPx;
}
