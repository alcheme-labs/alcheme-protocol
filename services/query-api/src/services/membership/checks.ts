import {
    IdentityLevel,
    MemberRole,
    MemberStatus,
    type PrismaClient,
    type Prisma,
} from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export function parseAuthUserIdFromRequest(req: { userId?: unknown } | any): number | null {
    const parsed = Number(req?.userId ?? req?.['userId'] ?? req?.['authUserId']);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

export async function getActiveCircleMembership(
    prisma: PrismaLike,
    input: { circleId: number; userId: number },
) {
    return prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId: input.circleId,
                userId: input.userId,
            },
        },
    });
}

export async function hasActiveCircleMembership(
    prisma: PrismaLike,
    input: { circleId: number; userId: number },
): Promise<boolean> {
    const member = await getActiveCircleMembership(prisma, input);
    return !!member && member.status === MemberStatus.Active;
}

export async function canViewCircleMembers(
    prisma: PrismaLike,
    input: { circleId: number; userId: number | null | undefined; creatorId?: number | null },
): Promise<boolean> {
    if (!input.userId) return false;
    if (input.creatorId && input.creatorId === input.userId) return true;
    return hasActiveCircleMembership(prisma, {
        circleId: input.circleId,
        userId: input.userId,
    });
}

export type DraftPermissionAction = 'read' | 'comment' | 'edit';

export interface DraftAccessDecision {
    allowed: boolean;
    statusCode: number;
    error: string;
    message: string;
    post: {
        id: number;
        authorId: number;
        circleId: number | null;
        status: string;
    } | null;
}

function isManagerRole(role: MemberRole): boolean {
    return role === MemberRole.Owner || role === MemberRole.Admin || role === MemberRole.Moderator;
}

export async function authorizeDraftAction(
    prisma: PrismaLike,
    input: { postId: number; userId: number | null | undefined; action: DraftPermissionAction },
): Promise<DraftAccessDecision> {
    if (!input.userId) {
        return {
            allowed: false,
            statusCode: 401,
            error: 'authentication_required',
            message: 'authentication is required',
            post: null,
        };
    }

    const post = await prisma.post.findUnique({
        where: { id: input.postId },
        select: {
            id: true,
            authorId: true,
            circleId: true,
            status: true,
        },
    });
    if (!post) {
        return {
            allowed: false,
            statusCode: 404,
            error: 'draft_not_found',
            message: 'draft post is not found',
            post: null,
        };
    }
    if (String(post.status) !== 'Draft') {
        return {
            allowed: false,
            statusCode: 409,
            error: 'not_draft_status',
            message: 'target post is not in Draft status',
            post: {
                id: post.id,
                authorId: post.authorId,
                circleId: post.circleId,
                status: String(post.status),
            },
        };
    }

    // Legacy compatibility: if a historical draft is not circle-bound, only author can access.
    if (post.circleId === null) {
        const allowAuthor = post.authorId === input.userId;
        return allowAuthor
            ? {
                allowed: true,
                statusCode: 200,
                error: 'ok',
                message: 'ok',
                post: {
                    id: post.id,
                    authorId: post.authorId,
                    circleId: null,
                    status: String(post.status),
                },
            }
            : {
                allowed: false,
                statusCode: 403,
                error: 'draft_membership_required',
                message: 'draft is not circle-bound; only author can access',
                post: {
                    id: post.id,
                    authorId: post.authorId,
                    circleId: null,
                    status: String(post.status),
                },
            };
    }

    const membership = await prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId: post.circleId,
                userId: input.userId,
            },
        },
        select: {
            role: true,
            status: true,
            identityLevel: true,
        },
    });
    if (!membership || membership.status !== MemberStatus.Active) {
        return {
            allowed: false,
            statusCode: 403,
            error: 'draft_membership_required',
            message: 'only active circle members can access draft resources',
            post: {
                id: post.id,
                authorId: post.authorId,
                circleId: post.circleId,
                status: String(post.status),
            },
        };
    }

    if (input.action === 'read') {
        return {
            allowed: true,
            statusCode: 200,
            error: 'ok',
            message: 'ok',
            post: {
                id: post.id,
                authorId: post.authorId,
                circleId: post.circleId,
                status: String(post.status),
            },
        };
    }

    const manager = isManagerRole(membership.role);
    const allowComment =
        manager
        || membership.identityLevel === IdentityLevel.Initiate
        || membership.identityLevel === IdentityLevel.Member
        || membership.identityLevel === IdentityLevel.Elder;
    const allowEdit =
        manager
        || membership.identityLevel === IdentityLevel.Member
        || membership.identityLevel === IdentityLevel.Elder;

    if (input.action === 'comment' && !allowComment) {
        return {
            allowed: false,
            statusCode: 403,
            error: 'draft_comment_permission_denied',
            message: 'at least Initiate identity is required to comment',
            post: {
                id: post.id,
                authorId: post.authorId,
                circleId: post.circleId,
                status: String(post.status),
            },
        };
    }
    if (input.action === 'edit' && !allowEdit) {
        return {
            allowed: false,
            statusCode: 403,
            error: 'draft_edit_permission_denied',
            message: 'at least Member identity is required to edit',
            post: {
                id: post.id,
                authorId: post.authorId,
                circleId: post.circleId,
                status: String(post.status),
            },
        };
    }

    return {
        allowed: true,
        statusCode: 200,
        error: 'ok',
        message: 'ok',
        post: {
            id: post.id,
            authorId: post.authorId,
            circleId: post.circleId,
            status: String(post.status),
        },
    };
}

export async function requireCircleManagerRole(
    prisma: PrismaLike,
    input: {
        circleId: number;
        userId: number;
        allowModerator?: boolean;
    },
): Promise<boolean> {
    const circle = await prisma.circle.findUnique({
        where: { id: input.circleId },
        select: { creatorId: true },
    });
    if (!circle) return false;
    if (circle.creatorId === input.userId) return true;

    const membership = await prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId: input.circleId,
                userId: input.userId,
            },
        },
        select: {
            role: true,
            status: true,
        },
    });
    if (!membership || membership.status !== MemberStatus.Active) return false;
    if (membership.role === MemberRole.Owner || membership.role === MemberRole.Admin) return true;
    return !!input.allowModerator && membership.role === MemberRole.Moderator;
}

export async function requireCircleOwnerRole(
    prisma: PrismaLike,
    input: {
        circleId: number;
        userId: number;
    },
): Promise<boolean> {
    const circle = await prisma.circle.findUnique({
        where: { id: input.circleId },
        select: { creatorId: true },
    });
    if (!circle) return false;
    if (circle.creatorId === input.userId) return true;

    const membership = await prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId: input.circleId,
                userId: input.userId,
            },
        },
        select: {
            role: true,
            status: true,
        },
    });
    return !!membership && membership.status === MemberStatus.Active && membership.role === MemberRole.Owner;
}
