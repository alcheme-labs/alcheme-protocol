import { authenticatedApiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

const PROFILE_AVATAR_MAX_BYTES = 512 * 1024;
const PROFILE_AVATAR_MAX_EDGE = 1024;
const avatarObjectUrlCache = new Map<string, Promise<string | null>>();

export async function uploadProfileAvatar(file: File): Promise<{ avatarUri: string }> {
    const payload = await encodeProfileAvatarFile(file);
    const route = await resolveNodeRoute('profile_avatar');
    const response = await authenticatedApiFetch(`${route.urlBase}/api/v1/users/me/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const json = await response.json().catch(() => null) as { avatarUri?: string; error?: string } | null;
    if (!response.ok || !json?.avatarUri) {
        throw new Error(json?.error || `profile avatar upload failed: ${response.status}`);
    }
    return { avatarUri: json.avatarUri };
}

export async function fetchProfileAvatarObjectUrl(handle: string, avatarUri: string): Promise<string | null> {
    const cacheKey = `${handle}:${avatarUri}`;
    const cached = avatarObjectUrlCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const request = loadProfileAvatarObjectUrl(handle);
    avatarObjectUrlCache.set(cacheKey, request);
    const result = await request;
    if (!result) {
        avatarObjectUrlCache.delete(cacheKey);
    }
    return result;
}

async function loadProfileAvatarObjectUrl(handle: string): Promise<string | null> {
    const route = await resolveNodeRoute('profile_avatar');
    const response = await authenticatedApiFetch(
        `${route.urlBase}/api/v1/users/${encodeURIComponent(handle)}/avatar`,
        { method: 'GET', cache: 'no-store' },
    );
    if (!response.ok) {
        return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
        return null;
    }
    const blob = await response.blob();
    if (!blob.size) {
        return null;
    }
    return URL.createObjectURL(blob);
}

async function encodeProfileAvatarFile(file: File): Promise<{ mimeType: 'image/jpeg'; contentBase64: string }> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error('profile_avatar_mime_unsupported');
    }
    try {
        const scale = Math.min(1, PROFILE_AVATAR_MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('profile_avatar_mime_unsupported');
        }
        context.drawImage(bitmap, 0, 0, width, height);
        for (const quality of [0.86, 0.72, 0.58, 0.42]) {
            const blob = await canvasToJpeg(canvas, quality);
            if (blob.size <= PROFILE_AVATAR_MAX_BYTES) {
                return {
                    mimeType: 'image/jpeg',
                    contentBase64: await readBlobAsBase64(blob),
                };
            }
        }
        throw new Error('profile_avatar_too_large');
    } finally {
        bitmap.close();
    }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('profile_avatar_mime_unsupported'));
                return;
            }
            resolve(blob);
        }, 'image/jpeg', quality);
    });
}

function readBlobAsBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('profile_avatar_read_failed'));
        reader.readAsDataURL(blob);
    });
}
