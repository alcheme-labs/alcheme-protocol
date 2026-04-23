export type ContentWriteMode = 'v2';

export interface SessionLike {
    authenticated?: boolean;
    user?: {
        handle?: string | null;
    } | null;
}

export interface ContentRouteOptionsLike {
    useV2: true;
    enableV1FallbackOnV2Failure: false;
    identityHandle: string;
    identityRegistryName: string;
    parentAuthorPubkey?: string;
    originalAuthorPubkey?: string;
    quotedAuthorPubkey?: string;
}

export function resolveContentWriteMode(rawMode: string | undefined): ContentWriteMode {
    // v2-only: ignore legacy v1 mode even if env still carries old value.
    const _normalized = String(rawMode || '').trim().toLowerCase();
    return 'v2';
}

export function resolveBindContentId(
    writeMode: ContentWriteMode,
    contentId: { toString(): string },
    expectedContentId: string,
): string {
    void writeMode;
    void expectedContentId;
    return contentId.toString();
}

export function resolveIdentityHandleForV2(
    writeMode: ContentWriteMode,
    session: SessionLike | null | undefined,
): string {
    void writeMode;

    const handle = session?.authenticated
        ? String(session.user?.handle || '').trim()
        : '';

    if (!handle) {
        throw new Error('登录态缺少身份 handle，请重新连接钱包后再试');
    }

    return handle;
}

export function buildV2RouteOptions(
    writeMode: ContentWriteMode,
    identityHandle: string,
    identityRegistryName: string,
): ContentRouteOptionsLike {
    void writeMode;

    return {
        useV2: true,
        enableV1FallbackOnV2Failure: false,
        identityHandle,
        identityRegistryName,
    };
}

export function isV2ContentIdConflictError(error: unknown): boolean {
    const message =
        error instanceof Error
            ? error.message
            : String(error || "");
    const lowered = message.toLowerCase();
    return (
        lowered.includes("already in use") ||
        lowered.includes("allocate: account") ||
        lowered.includes("v2contentidconflict") ||
        lowered.includes("v2contentidreplay")
    );
}
