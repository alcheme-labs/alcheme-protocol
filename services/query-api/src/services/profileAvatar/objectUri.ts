export const PROFILE_AVATAR_URI_PREFIX = 'sf-object:';
export const PROFILE_AVATAR_MAX_BYTES = 512 * 1024;
export const PROFILE_AVATAR_MAX_URI_LENGTH = 256;
export const PROFILE_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ProfileAvatarMimeType = (typeof PROFILE_AVATAR_MIME_TYPES)[number];

export function encodeProfileAvatarUri(objectId: string): string {
    const normalized = String(objectId || '').trim();
    if (!normalized) {
        throw new Error('profile_avatar_object_id_required');
    }
    const uri = `${PROFILE_AVATAR_URI_PREFIX}${normalized}`;
    if (uri.length > PROFILE_AVATAR_MAX_URI_LENGTH) {
        throw new Error('profile_avatar_uri_too_long');
    }
    return uri;
}

export function parseProfileAvatarObjectId(avatarUri: string | null | undefined): string | null {
    const value = String(avatarUri || '').trim();
    if (!value.startsWith(PROFILE_AVATAR_URI_PREFIX)) {
        return null;
    }
    const objectId = value.slice(PROFILE_AVATAR_URI_PREFIX.length).trim();
    return objectId || null;
}

function normalizeDeclaredAvatarMime(raw: unknown): string {
    const value = String(raw || '').trim().toLowerCase().split(';')[0].trim();
    if (value === 'image/jpg' || value === 'image/pjpeg' || value === 'image/jfif' || value === 'image/x-jpeg') {
        return 'image/jpeg';
    }
    if (value === 'image/x-png') {
        return 'image/png';
    }
    if (value === 'image/x-webp') {
        return 'image/webp';
    }
    return value;
}

export function decodeProfileAvatarUpload(input: {
    mimeType?: unknown;
    contentBase64?: unknown;
}): { mimeType: ProfileAvatarMimeType; bytes: Buffer } {
    const declared = normalizeDeclaredAvatarMime(input.mimeType);
    const declaredKnown = PROFILE_AVATAR_MIME_TYPES.includes(declared as ProfileAvatarMimeType)
        ? declared as ProfileAvatarMimeType
        : '';
    const raw = String(input.contentBase64 || '').trim();
    if (!raw) {
        throw Object.assign(new Error('profile_avatar_content_required'), { statusCode: 400 });
    }
    const bytes = Buffer.from(raw, 'base64');
    if (!bytes.byteLength) {
        throw Object.assign(new Error('profile_avatar_content_required'), { statusCode: 400 });
    }
    if (bytes.byteLength > PROFILE_AVATAR_MAX_BYTES) {
        throw Object.assign(new Error('profile_avatar_too_large'), { statusCode: 413 });
    }
    const sniffed = sniffProfileAvatarMime(bytes);
    if (!sniffed) {
        throw Object.assign(new Error('profile_avatar_mime_unsupported'), { statusCode: 415 });
    }
    if (declaredKnown && declaredKnown !== sniffed) {
        throw Object.assign(new Error('profile_avatar_mime_unsupported'), { statusCode: 415 });
    }
    return { mimeType: sniffed, bytes };
}

export function mapProfileAvatarStorageError(error: unknown): { statusCode: number; error: string } | null {
    if (!(error instanceof Error) || !error.message.startsWith('storage_fabric_object_')) {
        return null;
    }
    const httpStatus = Number(/^storage_fabric_object_http_(\d+)$/.exec(error.message)?.[1]);
    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404 || httpStatus === 409 || httpStatus === 429) {
        return { statusCode: httpStatus, error: error.message };
    }
    return { statusCode: 502, error: error.message };
}

export function sniffProfileAvatarMime(bytes: Buffer): ProfileAvatarMimeType | null {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        return 'image/jpeg';
    }
    if (
        bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
    ) {
        return 'image/png';
    }
    if (
        bytes.length >= 12
        && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
        && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
}
