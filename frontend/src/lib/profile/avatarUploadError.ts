export function mapAvatarUploadError(
    error: unknown,
    copy: {
        mimeUnsupported: string;
        tooLarge: string;
        genericFailure: string;
    },
): string {
    const raw = error instanceof Error && error.message
        ? error.message
        : String(error || '').trim();
    const normalized = raw.toLowerCase();
    if (normalized.includes('profile_avatar_mime_unsupported')) {
        return copy.mimeUnsupported;
    }
    if (normalized.includes('profile_avatar_too_large')) {
        return copy.tooLarge;
    }
    return copy.genericFailure;
}
