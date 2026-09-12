import type { PrismaClient } from '@prisma/client';

import { loadPrivateText } from '../privateContentBridge';

interface SeededSourceNodeContextRecord {
    name: string;
    contentText: string | null;
    contentLocator?: string | null;
    contentHash: string | null;
}

interface SeededSourceNodeFindManyArgs {
    where: { circleId: number };
    orderBy: Array<
        | { depth: 'asc' | 'desc' }
        | { sortOrder: 'asc' | 'desc' }
        | { path: 'asc' | 'desc' }
    >;
    select: {
        id: true;
        parentId: true;
        nodeType: true;
        name: true;
        path: true;
        depth: true;
        sortOrder: true;
        mimeType: true;
        byteSize: true;
        lineCount: true;
        contentHash: true;
        contentText: true;
        contentLocator: true;
    };
}

interface SeededSourceNodeFindFirstArgs {
    where: {
        circleId: number;
        path: string;
        nodeType: 'file';
    };
    select: {
        name: true;
        contentText: true;
        contentLocator: true;
        contentHash: true;
    };
}

interface SeededSourceNodeDelegate {
    findMany(args: SeededSourceNodeFindManyArgs): Promise<SeededFileTreeRecord[]>;
    findFirst(args: SeededSourceNodeFindFirstArgs): Promise<SeededSourceNodeContextRecord | null>;
}

function seededSourceNodes(prisma: PrismaClient): SeededSourceNodeDelegate {
    return (prisma as unknown as { seededSourceNode: SeededSourceNodeDelegate }).seededSourceNode;
}

export interface SeededFileTreeRecord {
    id: number;
    parentId: number | null;
    nodeType: 'directory' | 'file';
    name: string;
    path: string;
    depth: number;
    sortOrder: number;
    mimeType: string | null;
    byteSize: number;
    lineCount: number | null;
    contentDigest: string | null;
    contentText: string | null;
    contentLocator?: string | null;
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
    contentDigest: string | null;
    contentText: string | null;
    children: SeededFileTreeNode[];
}

export interface SeededFileContextWindow {
    path: string;
    fileName: string;
    line: number;
    lineText: string;
    snippet: string;
    startLine: number;
    endLine: number;
    contentDigest: string | null;
}

function compareNodes(a: SeededFileTreeRecord, b: SeededFileTreeRecord): number {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.nodeType !== b.nodeType) return a.nodeType === 'directory' ? -1 : 1;
    return a.path.localeCompare(b.path);
}

export function buildSeededFileTree(records: SeededFileTreeRecord[]): SeededFileTreeNode[] {
    const childrenByParent = new Map<number | null, SeededFileTreeRecord[]>();
    for (const record of records) {
        const list = childrenByParent.get(record.parentId) || [];
        list.push(record);
        childrenByParent.set(record.parentId, list);
    }

    for (const list of childrenByParent.values()) {
        list.sort(compareNodes);
    }

    const buildChildren = (parentId: number | null): SeededFileTreeNode[] => {
        const children = childrenByParent.get(parentId) || [];
        return children.map((record) => ({
            id: record.id,
            nodeType: record.nodeType,
            name: record.name,
            path: record.path,
            depth: record.depth,
            sortOrder: record.sortOrder,
            mimeType: record.mimeType,
            byteSize: record.byteSize,
            lineCount: record.lineCount,
            contentDigest: record.contentDigest,
            contentText: record.contentText,
            children: buildChildren(record.id),
        }));
    };

    return buildChildren(null);
}

export async function listSeededFileTree(
    prisma: PrismaClient,
    circleId: number,
): Promise<SeededFileTreeNode[]> {
    const records = await seededSourceNodes(prisma).findMany({
        where: { circleId },
        orderBy: [
            { depth: 'asc' },
            { sortOrder: 'asc' },
            { path: 'asc' },
        ],
        select: {
            id: true,
            parentId: true,
            nodeType: true,
            name: true,
            path: true,
            depth: true,
            sortOrder: true,
            mimeType: true,
            byteSize: true,
            lineCount: true,
            contentHash: true,
            contentText: true,
            contentLocator: true,
        },
    });
    const hydrated = await Promise.all((records as Array<SeededFileTreeRecord & {
        contentHash?: string | null;
        contentLocator?: string | null;
    }>).map(async (record) => ({
        ...record,
        contentDigest: (record as any).contentHash ? String((record as any).contentHash) : null,
        contentText: record.nodeType === 'file' && (!record.contentText || record.contentText.length === 0)
            ? (await loadPrivateText((record as any).contentLocator)) || null
            : record.contentText,
        contentLocator: (record as any).contentLocator ?? null,
    })));
    return buildSeededFileTree(hydrated);
}

function buildSnippetWindow(
    contentText: string | null | undefined,
    line: number,
    before = 1,
    after = 1,
): Pick<SeededFileContextWindow, 'lineText' | 'snippet' | 'startLine' | 'endLine'> {
    const lines = String(contentText || '').split(/\r?\n/);
    const safeLine = Math.max(1, line);
    const startLine = Math.max(1, safeLine - before);
    const endLine = Math.min(lines.length || safeLine, safeLine + after);
    const windowLines: string[] = [];

    for (let cursor = startLine; cursor <= endLine; cursor += 1) {
        const sourceLine = lines[cursor - 1] || '';
        windowLines.push(`${cursor}: ${sourceLine}`);
    }

    return {
        lineText: lines[safeLine - 1] || '',
        snippet: windowLines.join('\n').trim(),
        startLine,
        endLine,
    };
}

export async function loadSeededFileContext(
    prisma: PrismaClient,
    input: {
        circleId: number;
        path: string;
        line: number;
        before?: number;
        after?: number;
    },
): Promise<SeededFileContextWindow | null> {
    const path = String(input.path || '').trim();
    const line = Number(input.line || 0);
    if (!path || !Number.isFinite(line) || line <= 0) return null;

    const node = await seededSourceNodes(prisma).findFirst({
        where: {
            circleId: input.circleId,
            path,
            nodeType: 'file',
        },
        select: {
            name: true,
            contentText: true,
            contentLocator: true,
            contentHash: true,
        },
    });
    if (!node) return null;

    const contentText = (typeof node.contentText === 'string' && node.contentText.length > 0)
        ? node.contentText
        : await loadPrivateText((node as any).contentLocator);

    const snippet = buildSnippetWindow(
        contentText,
        line,
        input.before ?? 1,
        input.after ?? 1,
    );

    return {
        path,
        fileName: String(node.name || path.split('/').pop() || path),
        line,
        lineText: snippet.lineText,
        snippet: snippet.snippet,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
        contentDigest: node.contentHash ? String(node.contentHash) : null,
    };
}
