import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PRIVATE_CONTENT_SCHEME = 'alcheme-private:';

function normalizeLocatorSegment(segment: string): string {
    const trimmed = String(segment || '').trim();
    if (!trimmed) {
        throw new Error('private_content_locator_segment_required');
    }
    if (trimmed === '.' || trimmed === '..') {
        throw new Error('invalid_private_content_locator_segment');
    }
    return encodeURIComponent(trimmed);
}

function getPrivateContentStoreRoot(): string {
    const configured = String(process.env.PRIVATE_CONTENT_STORE_ROOT || '').trim();
    return configured || join(tmpdir(), 'alcheme-private-content');
}

export function buildPrivateTextLocator(...segments: string[]): string {
    const normalized = segments
        .flatMap((segment) => String(segment || '').split('/'))
        .filter(Boolean)
        .map(normalizeLocatorSegment);

    if (normalized.length === 0) {
        throw new Error('private_content_locator_segments_required');
    }

    const [host, ...pathSegments] = normalized;
    return `${PRIVATE_CONTENT_SCHEME}//${host}${pathSegments.length > 0 ? `/${pathSegments.join('/')}` : ''}`;
}

function resolvePrivateContentPath(locator: string | null | undefined): string | null {
    const normalized = String(locator || '').trim();
    if (!normalized) return null;

    try {
        const url = new URL(normalized);
        if (url.protocol !== PRIVATE_CONTENT_SCHEME) {
            return null;
        }

        const segments = [url.host, ...url.pathname.split('/').filter(Boolean)]
            .map((segment) => decodeURIComponent(segment))
            .map((segment) => {
                if (!segment || segment === '.' || segment === '..') {
                    throw new Error('invalid_private_content_locator');
                }
                return segment;
            });

        return join(getPrivateContentStoreRoot(), ...segments) + '.txt';
    } catch {
        return null;
    }
}

export async function storePrivateText(input: {
    locator: string;
    content: string;
}): Promise<{
    locator: string;
    byteSize: number;
}> {
    const storagePath = resolvePrivateContentPath(input.locator);
    if (!storagePath) {
        throw new Error('invalid_private_content_locator');
    }

    await mkdir(dirname(storagePath), { recursive: true });
    await writeFile(storagePath, input.content, 'utf8');

    return {
        locator: input.locator,
        byteSize: Buffer.byteLength(input.content, 'utf8'),
    };
}

export async function loadPrivateText(locator: string | null | undefined): Promise<string | null> {
    const storagePath = resolvePrivateContentPath(locator);
    if (!storagePath) {
        return null;
    }

    try {
        return await readFile(storagePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
