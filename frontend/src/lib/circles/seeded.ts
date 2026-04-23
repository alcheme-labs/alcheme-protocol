import { resolveNodeRoute } from '@/lib/config/nodeRouting';

export interface SeededSourceInput {
    path: string;
    content: string;
    mimeType?: string | null;
}

export interface SeededFileTreeNode {
    id: number;
    nodeType: 'directory' | 'file';
    name: string;
    path: string;
    depth: number;
    sortOrder: number;
    mimeType: string | null;
    byteSize: number;
    lineCount: number | null;
    contentDigest?: string | null;
    contentText: string | null;
    children: SeededFileTreeNode[];
}

export interface SeededReferenceSelection {
    raw: string;
    path: string;
    line: number;
    fileName?: string;
}

export async function importSeededSources(
    circleId: number,
    seededSources: SeededSourceInput[],
): Promise<{ circleId: number; fileCount: number; nodeCount: number; manifestDigest?: string | null }> {
    const route = await resolveNodeRoute('seeded');
    const response = await fetch(`${route.urlBase}/api/v1/circles/${circleId}/seeded/import`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            files: seededSources,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`import seeded sources failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    return {
        circleId: Number(data?.circleId || circleId),
        fileCount: Number(data?.fileCount || 0),
        nodeCount: Number(data?.nodeCount || 0),
        manifestDigest: typeof data?.manifest?.digest === 'string' ? data.manifest.digest : null,
    };
}

export async function fetchSeededFileTree(circleId: number): Promise<SeededFileTreeNode[]> {
    const route = await resolveNodeRoute('seeded');
    const response = await fetch(`${route.urlBase}/api/v1/circles/${circleId}/seeded/tree`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
    });

    if (response.status === 404 || response.status === 409) {
        return [];
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`fetch seeded file tree failed: ${response.status} ${body}`);
    }

    const data = await response.json().catch(() => null);
    const tree = Array.isArray(data?.tree)
        ? data.tree
        : Array.isArray(data?.nodes)
            ? data.nodes
            : [];
    return tree as SeededFileTreeNode[];
}
