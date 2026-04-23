import crypto from 'crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import {
    listDraftDiscussionThreads,
    type DraftDiscussionThreadRecord,
} from '../draftDiscussionLifecycle';
import { resolveDraftLifecycleReadModel } from '../draftLifecycle/readModel';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type ArgumentBlockPermissionSource =
    | 'manager_override'
    | 'block_discussion_participant'
    | 'temporary_grant';

export interface TemporaryEditGrantInput {
    blockId: string;
    userId: number;
    grantedBy: number;
    expiresAt: string | null;
}

export interface ArgumentBlockSnapshotView {
    blockId: string;
    draftPostId: number;
    draftVersion: number;
    legacyTargetType: 'paragraph';
    legacyTargetRef: string;
    orderIndex: number;
    contentSnapshot: string;
    contentHash: string;
    sourceMessageIds: string[];
    discussionThreadIds: string[];
    participantUserIds: number[];
    status: 'active';
}

export interface ArgumentBlockPermissionView {
    blockId: string;
    userId: number | null;
    canEdit: boolean;
    canClaimLease: boolean;
    canManageGrants: boolean;
    permissionSources: ArgumentBlockPermissionSource[];
    temporaryGrantExpiresAt: string | null;
}

export interface DraftReferenceLinkView {
    referenceId: string;
    draftPostId: number;
    draftVersion: number;
    sourceBlockId: string;
    linkText: string;
    crystalName: string;
    crystalBlockAnchor: string | null;
    status: 'parsed';
}

export interface StableDraftReferenceLinkInput {
    referenceId: string;
    draftPostId: number;
    draftVersion: number;
    sourceBlockId: string;
    crystalName: string;
    crystalBlockAnchor: string | null;
    status: 'parsed';
}

export interface DraftBlockReadModel {
    draftPostId: number;
    draftVersion: number;
    blocks: ArgumentBlockSnapshotView[];
    viewerPermissions: ArgumentBlockPermissionView[];
    referenceLinks: DraftReferenceLinkView[];
}

interface DraftPostMembershipRow {
    id: number;
    authorId: number;
    circleId: number | null;
    status: string;
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeIsoString(input: string | Date): string {
    return input instanceof Date ? input.toISOString() : new Date(input).toISOString();
}

function parseIsoMillis(input: string | null | undefined): number {
    if (!input) return 0;
    const parsed = new Date(input).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function splitIntoParagraphBlocks(text: string): Array<{
    blockId: string;
    orderIndex: number;
    contentSnapshot: string;
}> {
    return String(text || '')
        .split(/\n\s*\n+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((contentSnapshot, orderIndex) => ({
            blockId: `paragraph:${orderIndex}`,
            orderIndex,
            contentSnapshot,
        }));
}

function collectParticipantUserIds(
    authorId: number,
    threads: DraftDiscussionThreadRecord[],
): number[] {
    const ids = new Set<number>();
    if (Number.isFinite(authorId) && authorId > 0) {
        ids.add(authorId);
    }

    for (const thread of threads) {
        if (Number.isFinite(thread.createdBy) && thread.createdBy > 0) ids.add(thread.createdBy);
        if (Number.isFinite(thread.latestResolution?.resolvedBy) && thread.latestResolution!.resolvedBy > 0) {
            ids.add(thread.latestResolution!.resolvedBy);
        }
        if (Number.isFinite(thread.latestApplication?.appliedBy) && thread.latestApplication!.appliedBy > 0) {
            ids.add(thread.latestApplication!.appliedBy);
        }
    }

    return Array.from(ids).sort((left, right) => left - right);
}

function resolveMatchingThreads(
    threads: DraftDiscussionThreadRecord[],
    blockId: string,
    draftVersion: number,
): DraftDiscussionThreadRecord[] {
    return threads.filter((thread) =>
        thread.targetVersion === draftVersion
        && thread.targetRef === blockId,
    );
}

function parseCrystalLinks(input: {
    draftPostId: number;
    draftVersion: number;
    sourceBlockId: string;
    contentSnapshot: string;
}): DraftReferenceLinkView[] {
    const pattern = /@crystal\(\s*([^#)\n]+?)\s*(?:#([^)]+?)\s*)?\)/g;
    const links: DraftReferenceLinkView[] = [];
    let match: RegExpExecArray | null = null;
    let occurrenceIndex = 0;

    while ((match = pattern.exec(input.contentSnapshot)) !== null) {
        const crystalName = String(match[1] || '').trim();
        if (!crystalName) continue;
        const crystalBlockAnchor = String(match[2] || '').trim() || null;
        const linkText = String(match[0] || '').trim();

        links.push({
            referenceId: sha256Hex(
                [
                    input.draftPostId,
                    input.draftVersion,
                    input.sourceBlockId,
                    occurrenceIndex,
                    linkText,
                ].join(':'),
            ),
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
            sourceBlockId: input.sourceBlockId,
            linkText,
            crystalName,
            crystalBlockAnchor,
            status: 'parsed',
        });
        occurrenceIndex += 1;
    }

    return links;
}

function deriveViewerPermission(input: {
    blockId: string;
    participantUserIds: number[];
    viewerUserId: number | null;
    membership: {
        role: string;
        status: string;
        identityLevel: string;
    } | null;
    temporaryGrants: TemporaryEditGrantInput[];
    nowIso: string;
}): ArgumentBlockPermissionView {
    const userId = input.viewerUserId;
    const membership = input.membership;
    const activeMembership = membership?.status === 'Active';
    const role = String(membership?.role || '');
    const identityLevel = String(membership?.identityLevel || '');
    const manager =
        activeMembership
        && (role === 'Owner' || role === 'Admin' || role === 'Moderator');
    const baseDraftEditAllowed =
        manager
        || (activeMembership && (identityLevel === 'Member' || identityLevel === 'Elder'));

    const activeGrant = Number.isFinite(userId as number) && (userId as number) > 0
        ? input.temporaryGrants.find((grant) =>
            grant.blockId === input.blockId
            && grant.userId === userId
            && (!grant.expiresAt || parseIsoMillis(grant.expiresAt) > parseIsoMillis(input.nowIso)),
        ) || null
        : null;

    const permissionSources: ArgumentBlockPermissionSource[] = [];
    if (manager) {
        permissionSources.push('manager_override');
    } else if (baseDraftEditAllowed && userId !== null && input.participantUserIds.includes(userId)) {
        permissionSources.push('block_discussion_participant');
    } else if (baseDraftEditAllowed && activeGrant) {
        permissionSources.push('temporary_grant');
    }

    const canEdit = permissionSources.length > 0;

    return {
        blockId: input.blockId,
        userId,
        canEdit,
        canClaimLease: canEdit,
        canManageGrants: manager,
        permissionSources,
        temporaryGrantExpiresAt: activeGrant?.expiresAt || null,
    };
}

export function projectStableDraftReferenceLinks(
    referenceLinks: DraftReferenceLinkView[],
): StableDraftReferenceLinkInput[] {
    return referenceLinks.map((referenceLink) => ({
        referenceId: referenceLink.referenceId,
        draftPostId: referenceLink.draftPostId,
        draftVersion: referenceLink.draftVersion,
        sourceBlockId: referenceLink.sourceBlockId,
        crystalName: referenceLink.crystalName,
        crystalBlockAnchor: referenceLink.crystalBlockAnchor,
        status: referenceLink.status,
    }));
}

async function loadDraftPost(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<DraftPostMembershipRow> {
    const post = await prisma.post.findUnique({
        where: { id: draftPostId },
        select: {
            id: true,
            authorId: true,
            circleId: true,
            status: true,
        },
    });
    if (!post || String(post.status) !== 'Draft') {
        throw new Error('draft_block_read_model_post_not_found');
    }
    return {
        id: post.id,
        authorId: post.authorId,
        circleId: post.circleId,
        status: String(post.status),
    };
}

export async function resolveDraftBlockReadModel(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        viewerUserId: number | null;
        temporaryGrants?: TemporaryEditGrantInput[];
        now?: string | Date;
    },
): Promise<DraftBlockReadModel> {
    const nowIso = normalizeIsoString(input.now || new Date());
    const temporaryGrants = input.temporaryGrants || [];

    const [lifecycle, post, threads] = await Promise.all([
        resolveDraftLifecycleReadModel(prisma as PrismaClient, {
            draftPostId: input.draftPostId,
        }),
        loadDraftPost(prisma, input.draftPostId),
        listDraftDiscussionThreads(prisma as PrismaClient, {
            draftPostId: input.draftPostId,
            limit: 100,
        }),
    ]);

    const membership = input.viewerUserId && post.circleId !== null
        ? await prisma.circleMember.findUnique({
            where: {
                circleId_userId: {
                    circleId: post.circleId,
                    userId: input.viewerUserId,
                },
            },
            select: {
                role: true,
                status: true,
                identityLevel: true,
            },
        })
        : null;

    const draftVersion = lifecycle.workingCopy.basedOnSnapshotVersion;
    const sourceMessageIds = lifecycle.handoff?.sourceMessageIds || [];

    const blocks = splitIntoParagraphBlocks(lifecycle.workingCopy.workingCopyContent).map((block) => {
        const matchingThreads = resolveMatchingThreads(threads, block.blockId, draftVersion);
        return {
            blockId: block.blockId,
            draftPostId: input.draftPostId,
            draftVersion,
            legacyTargetType: 'paragraph' as const,
            legacyTargetRef: block.blockId,
            orderIndex: block.orderIndex,
            contentSnapshot: block.contentSnapshot,
            contentHash: sha256Hex(block.contentSnapshot),
            sourceMessageIds,
            discussionThreadIds: matchingThreads.map((thread) => thread.id),
            participantUserIds: collectParticipantUserIds(post.authorId, matchingThreads),
            status: 'active' as const,
        };
    });

    const referenceLinks = blocks.flatMap((block) =>
        parseCrystalLinks({
            draftPostId: input.draftPostId,
            draftVersion,
            sourceBlockId: block.blockId,
            contentSnapshot: block.contentSnapshot,
        }),
    );

    const viewerPermissions = blocks.map((block) =>
        deriveViewerPermission({
            blockId: block.blockId,
            participantUserIds: block.participantUserIds,
            viewerUserId: input.viewerUserId,
            membership: membership
                ? {
                    role: String(membership.role),
                    status: String(membership.status),
                    identityLevel: String(membership.identityLevel),
                }
                : null,
            temporaryGrants,
            nowIso,
        }),
    );

    return {
        draftPostId: input.draftPostId,
        draftVersion,
        blocks,
        viewerPermissions,
        referenceLinks,
    };
}

export async function resolveStableDraftReferenceLinkInputs(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
    },
): Promise<StableDraftReferenceLinkInput[]> {
    const readModel = await resolveDraftBlockReadModel(prisma, {
        draftPostId: input.draftPostId,
        viewerUserId: null,
    });
    return projectStableDraftReferenceLinks(readModel.referenceLinks);
}
