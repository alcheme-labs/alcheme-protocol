import type { PrismaClient } from '@prisma/client';

import { loadPrivateText } from '../privateContentBridge';

const SEEDED_REFERENCE_PATTERN = /@file:([A-Za-z0-9._/-]+):([1-9]\d*)/g;

interface SeededReferenceNodeRecord {
    name: string;
    contentText: string | null;
    contentLocator?: string | null;
    contentHash: string | null;
}

interface SeededReferenceFindFirstArgs {
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

interface SeededReferenceNodeDelegate {
    findFirst(args: SeededReferenceFindFirstArgs): Promise<SeededReferenceNodeRecord | null>;
}

function seededSourceNodes(prisma: PrismaClient): SeededReferenceNodeDelegate {
    return (prisma as unknown as { seededSourceNode: SeededReferenceNodeDelegate }).seededSourceNode;
}

export interface SeededReferenceToken {
    raw: string;
    path: string;
    line: number;
    index: number;
}

export interface ResolvedSeededReference extends SeededReferenceToken {
    fileName: string;
    lineText: string;
    contentDigest: string | null;
}

export function parseSeededReferenceToken(value: string): SeededReferenceToken | null {
    const matches = Array.from(value.matchAll(SEEDED_REFERENCE_PATTERN));
    if (matches.length !== 1) return null;
    const match = matches[0];
    if (match[0] !== value) return null;

    return {
        raw: match[0],
        path: match[1],
        line: Number.parseInt(match[2], 10),
        index: match.index ?? 0,
    };
}

export function extractSeededReferenceTokens(value: string): SeededReferenceToken[] {
    return Array.from(value.matchAll(SEEDED_REFERENCE_PATTERN)).map((match) => ({
        raw: match[0],
        path: match[1],
        line: Number.parseInt(match[2], 10),
        index: match.index ?? 0,
    }));
}

function getLineText(contentText: string | null | undefined, line: number): string {
    if (!contentText) return '';
    const lines = contentText.split(/\r?\n/);
    return lines[line - 1] || '';
}

export async function resolveSeededReference(
    prisma: PrismaClient,
    input: { circleId: number; value: string },
): Promise<ResolvedSeededReference | null> {
    const parsed = parseSeededReferenceToken(input.value);
    if (!parsed) return null;

    const node = await seededSourceNodes(prisma).findFirst({
        where: {
            circleId: input.circleId,
            path: parsed.path,
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

    return {
        ...parsed,
        fileName: String(node.name || parsed.path.split('/').pop() || parsed.path),
        lineText: getLineText(contentText, parsed.line),
        contentDigest: node.contentHash ? String(node.contentHash) : null,
    };
}
