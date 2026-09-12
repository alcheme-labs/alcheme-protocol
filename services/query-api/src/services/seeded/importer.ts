import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';

import { buildPrivateTextLocator, storePrivateText } from '../privateContentBridge';

export interface SeededImportFileInput {
    path: string;
    content: string;
    mimeType?: string | null;
}

export interface SeededImportPlanNode {
    path: string;
    parentPath: string | null;
    nodeType: 'directory' | 'file';
    name: string;
    depth: number;
    sortOrder: number;
    mimeType: string | null;
    contentText: string | null;
    contentHash: string | null;
    byteSize: number;
    lineCount: number | null;
}

export interface SeededManifestNodeSnapshot {
    path: string;
    nodeType: 'directory' | 'file';
    contentHash: string | null;
    byteSize: number;
    lineCount: number | null;
}

export interface SeededImportPlan {
    nodes: SeededImportPlanNode[];
    fileCount: number;
    directoryCount: number;
    manifestDigest: string;
}

export interface SeededPlaintextCustodyPolicy {
    manifestAvailability: 'digest_and_reference_metadata';
    plaintextHosting: 'circle_seeded_explicit';
    defaultPersistence: 'trusted_private_store';
    plaintextReadAccess: 'active_member_or_creator';
    readPath: 'authorized_private_fetch_bridge';
}

export const SEEDED_PLAINTEXT_CUSTODY: SeededPlaintextCustodyPolicy = {
    manifestAvailability: 'digest_and_reference_metadata',
    plaintextHosting: 'circle_seeded_explicit',
    defaultPersistence: 'trusted_private_store',
    plaintextReadAccess: 'active_member_or_creator',
    readPath: 'authorized_private_fetch_bridge',
};

function sha256Hex(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}

function normalizeSeededPath(input: string): string {
    const normalized = input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    if (!normalized) {
        throw new Error('seeded_file_path_required');
    }
    const segments = normalized.split('/');
    for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..') {
            throw new Error(`invalid_seeded_file_path:${input}`);
        }
    }
    return segments.join('/');
}

function compareNodes(a: SeededImportPlanNode, b: SeededImportPlanNode): number {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const parentCompare = (a.parentPath || '').localeCompare(b.parentPath || '');
    if (parentCompare !== 0) return parentCompare;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.path.localeCompare(b.path);
}

export function buildSeededImportPlan(files: SeededImportFileInput[]): SeededImportPlan {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('seeded_files_required');
    }

    const normalizedFiles = files.map((file) => ({
        path: normalizeSeededPath(file.path),
        content: typeof file.content === 'string' ? file.content : '',
        mimeType: typeof file.mimeType === 'string' && file.mimeType.trim() ? file.mimeType.trim() : null,
    }));

    const uniquePaths = new Set<string>();
    const nodes = new Map<string, SeededImportPlanNode>();

    for (const file of normalizedFiles.sort((a, b) => a.path.localeCompare(b.path))) {
        if (uniquePaths.has(file.path)) {
            throw new Error(`duplicate_seeded_file_path:${file.path}`);
        }
        uniquePaths.add(file.path);

        const segments = file.path.split('/');
        let parentPath: string | null = null;
        for (let index = 0; index < segments.length - 1; index += 1) {
            const dirPath = segments.slice(0, index + 1).join('/');
            if (!nodes.has(dirPath)) {
                nodes.set(dirPath, {
                    path: dirPath,
                    parentPath,
                    nodeType: 'directory',
                    name: segments[index],
                    depth: index,
                    sortOrder: 0,
                    mimeType: null,
                    contentText: null,
                    contentHash: null,
                    byteSize: 0,
                    lineCount: null,
                });
            }
            parentPath = dirPath;
        }

        const byteSize = Buffer.byteLength(file.content, 'utf8');
        nodes.set(file.path, {
            path: file.path,
            parentPath,
            nodeType: 'file',
            name: segments[segments.length - 1],
            depth: segments.length - 1,
            sortOrder: 0,
            mimeType: file.mimeType,
            contentText: file.content,
            contentHash: sha256Hex(file.content),
            byteSize,
            lineCount: file.content.length > 0 ? file.content.split(/\r?\n/).length : 0,
        });
    }

    const childrenByParent = new Map<string | null, SeededImportPlanNode[]>();
    for (const node of nodes.values()) {
        const list = childrenByParent.get(node.parentPath) || [];
        list.push(node);
        childrenByParent.set(node.parentPath, list);
    }

    for (const list of childrenByParent.values()) {
        list.sort((a, b) => {
            if (a.nodeType !== b.nodeType) {
                return a.nodeType === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        list.forEach((node, index) => {
            node.sortOrder = index;
        });
    }

    const orderedNodes = Array.from(nodes.values()).sort(compareNodes);
    return {
        nodes: orderedNodes,
        fileCount: orderedNodes.filter((node) => node.nodeType === 'file').length,
        directoryCount: orderedNodes.filter((node) => node.nodeType === 'directory').length,
        manifestDigest: buildSeededManifestDigest(orderedNodes),
    };
}

export function buildSeededManifestDigest(nodes: SeededManifestNodeSnapshot[]): string {
    const canonical = JSON.stringify(nodes.map((node) => ({
        path: node.path,
        nodeType: node.nodeType,
        contentHash: node.contentHash,
        byteSize: node.byteSize,
        lineCount: node.lineCount,
    })));
    return sha256Hex(canonical);
}

export async function importSeededSources(
    prisma: PrismaClient,
    input: { circleId: number; files: SeededImportFileInput[] },
): Promise<{ circleId: number; fileCount: number; nodeCount: number; manifestDigest: string }> {
    const plan = buildSeededImportPlan(input.files);
    const contentLocators = new Map<string, string>();
    await Promise.all(plan.nodes.map(async (node) => {
        if (node.nodeType !== 'file' || !node.contentText) {
            return;
        }

        const locator = buildPrivateTextLocator(
            'seeded',
            String(input.circleId),
            node.path,
        );
        await storePrivateText({
            locator,
            content: node.contentText,
        });
        contentLocators.set(node.path, locator);
    }));

    await prisma.$transaction(async (tx) => {
        await (tx as any).seededSourceNode.deleteMany({
            where: { circleId: input.circleId },
        });

        const idsByPath = new Map<string, number>();
        for (const node of plan.nodes) {
            const created = await (tx as any).seededSourceNode.create({
                data: {
                    circleId: input.circleId,
                    parentId: node.parentPath ? idsByPath.get(node.parentPath) ?? null : null,
                    nodeType: node.nodeType,
                    name: node.name,
                    path: node.path,
                    depth: node.depth,
                    sortOrder: node.sortOrder,
                    mimeType: node.mimeType,
                    contentText: node.nodeType === 'file' ? null : node.contentText,
                    contentLocator: node.nodeType === 'file'
                        ? contentLocators.get(node.path) ?? null
                        : null,
                    contentHash: node.contentHash,
                    byteSize: node.byteSize,
                    lineCount: node.lineCount,
                },
                select: {
                    id: true,
                    path: true,
                },
            });
            idsByPath.set(created.path, created.id);
        }
    });

    return {
        circleId: input.circleId,
        fileCount: plan.fileCount,
        nodeCount: plan.nodes.length,
        manifestDigest: plan.manifestDigest,
    };
}
