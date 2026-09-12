export function shouldSaveComposeDraftContent(text: string): boolean {
    return text.trim().length > 0;
}

export function flushComposeDraftSave({
    text,
    draftPostId,
    workingCopyHash,
    save,
}: {
    text: string;
    draftPostId: number;
    workingCopyHash?: string | null;
    save: (draftPostId: number, text: string, workingCopyHash: string) => unknown;
}): void {
    if (!shouldSaveComposeDraftContent(text)) {
        return;
    }
    if (!workingCopyHash) {
        return;
    }
    void save(draftPostId, text, workingCopyHash);
}

export function rememberDraftPostId(
    map: Record<number, number>,
    circleId: number,
    draftPostId: number,
): Record<number, number> {
    return { ...map, [circleId]: draftPostId };
}

export function readDraftPostId(
    map: Record<number, number>,
    circleId: number,
): number | null {
    const draftPostId = map[circleId];
    return typeof draftPostId === 'number' ? draftPostId : null;
}
