import type { GQLKnowledgeContributor } from '@/lib/apollo/types';
import type { CircleMembershipSnapshot } from '@/lib/api/circlesMembership';
import type { DiscussionMessageDto } from '@/lib/api/discussion';
import type { ViewerIdentityState } from '@/lib/circle/identityTypes';
import type { PlazaMessage } from './types';
import {
    extractStructuredDiscussionMetadata,
    normalizeSemanticFacets,
} from '@/features/discussion-intake/labels/structuredMetadata';
import { resolveActorDisplayLabel } from './identityDisplay';

type CircleUiTranslateValues = Record<string, string | number | Date>;
type CircleUiTranslator = (key: string, values?: CircleUiTranslateValues) => string;

export interface CircleJoinCopy {
    button: {
        join: string;
        createIdentity: string;
        joined: string;
        pending: string;
        approvalRequired: string;
        inviteRequired: string;
        crystalRequirement: (values: {missingCrystals: number}) => string;
        restricted: string;
        rejoin: string;
    };
    hint: {
        visitorDefault: string;
        createIdentity: string;
        pending: string;
        approvalRequired: string;
        inviteRequired: string;
        insufficientCrystals: (values: {required: number; current: number}) => string;
        banned: string;
    };
    errors: {
        walletRequired: string;
        inviteRequired: string;
        insufficientCrystals: string;
        banned: string;
        archived: string;
        requestStateChanged: string;
        membershipBridgeUnavailable: string;
        browserMockUnsupported: string;
        fallback: string;
    };
}

const DEFAULT_JOIN_COPY: CircleJoinCopy = {
    button: {
        join: 'Join circle',
        createIdentity: 'Create identity',
        joined: 'Joined',
        pending: 'Pending',
        approvalRequired: 'Request access',
        inviteRequired: 'Invite required',
        crystalRequirement: ({missingCrystals}) => `${missingCrystals} crystals needed`,
        restricted: 'Restricted',
        rejoin: 'Rejoin',
    },
    hint: {
        visitorDefault: 'Visitors can post ephemeral messages, but only members enter the formal archive.',
        createIdentity: 'Create an identity before joining this circle.',
        pending: 'Your join request has been submitted and is waiting for approval.',
        approvalRequired: 'This circle uses approval-based joining. Submit a request and wait for review.',
        inviteRequired: 'This circle is invite-only. Ask an admin for an invite.',
        insufficientCrystals: ({required, current}) => `Not enough crystals yet: need ${required}, you currently have ${current}.`,
        banned: 'Your access to this circle is currently restricted. Contact an admin if you think this is a mistake.',
    },
    errors: {
        walletRequired: 'Connect your identity before joining the circle.',
        inviteRequired: 'This circle is invite-only. Ask an admin for an invite.',
        insufficientCrystals: 'You do not have enough crystals to join yet.',
        banned: 'Your access to this circle is currently restricted.',
        archived: 'This circle is archived and cannot accept new joins.',
        requestStateChanged: 'That request state changed. Refresh and try again.',
        membershipBridgeUnavailable: 'Your identity was created, but the circle join finalization is temporarily unavailable. Please try joining again.',
        browserMockUnsupported: 'The browser mock wallet cannot finish this on-chain membership action. Use a real wallet to verify this flow.',
        fallback: 'Could not join the circle. Please try again.',
    },
};

export function createCircleJoinCopy(t: CircleUiTranslator): CircleJoinCopy {
    return {
        button: {
            join: t('join.button.join'),
            createIdentity: t('join.button.createIdentity'),
            joined: t('join.button.joined'),
            pending: t('join.button.pending'),
            approvalRequired: t('join.button.approvalRequired'),
            inviteRequired: t('join.button.inviteRequired'),
            crystalRequirement: ({missingCrystals}) => t('join.button.crystalRequirement', {missingCrystals}),
            restricted: t('join.button.restricted'),
            rejoin: t('join.button.rejoin'),
        },
        hint: {
            visitorDefault: t('join.hint.visitorDefault'),
            createIdentity: t('join.hint.createIdentity'),
            pending: t('join.hint.pending'),
            approvalRequired: t('join.hint.approvalRequired'),
            inviteRequired: t('join.hint.inviteRequired'),
            insufficientCrystals: ({required, current}) => t('join.hint.insufficientCrystals', {required, current}),
            banned: t('join.hint.banned'),
        },
        errors: {
            walletRequired: t('join.errors.walletRequired'),
            inviteRequired: t('join.errors.inviteRequired'),
            insufficientCrystals: t('join.errors.insufficientCrystals'),
            banned: t('join.errors.banned'),
            archived: t('join.errors.archived'),
            requestStateChanged: t('join.errors.requestStateChanged'),
            membershipBridgeUnavailable: t('join.errors.membershipBridgeUnavailable'),
            browserMockUnsupported: t('join.errors.browserMockUnsupported'),
            fallback: t('join.errors.fallback'),
        },
    };
}

function getRelativeTimeParts(date: string): { value: number; unit: Intl.RelativeTimeFormatUnit } {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return { value: 0, unit: 'minute' };
    if (minutes < 60) return { value: -minutes, unit: 'minute' };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { value: -hours, unit: 'hour' };
    return { value: -Math.floor(hours / 24), unit: 'day' };
}

export function timeAgo(date: string, locale = 'en'): string {
    const { value, unit } = getRelativeTimeParts(date);
    const formatter = new Intl.RelativeTimeFormat(locale, {
        numeric: 'auto',
    });
    return formatter.format(value, unit);
}

export function mapContributorRole(role: GQLKnowledgeContributor['role']): 'author' | 'discussant' | 'reviewer' | 'cited' | 'unknown' {
    switch (role) {
        case 'Author':
            return 'author';
        case 'Discussant':
            return 'discussant';
        case 'Reviewer':
            return 'reviewer';
        case 'Cited':
            return 'cited';
        default:
            return 'unknown';
    }
}

export function mapMembershipToIdentityState(
    membership: CircleMembershipSnapshot['membership'],
): ViewerIdentityState {
    if (!membership) return 'visitor';
    if (membership.role === 'Owner') return 'owner';
    if (membership.role === 'Admin' || membership.role === 'Moderator') return 'curator';
    if (membership.identityLevel === 'Initiate') return 'initiate';
    if (membership.identityLevel === 'Visitor') return 'visitor';
    return 'member';
}

export function getJoinButtonLabel(snapshot: CircleMembershipSnapshot | null, copy: CircleJoinCopy = DEFAULT_JOIN_COPY): string {
    if (!snapshot) return copy.button.join;
    if (!snapshot.authenticated) return copy.button.createIdentity;
    switch (snapshot.joinState) {
        case 'joined':
            return copy.button.joined;
        case 'pending':
            return copy.button.pending;
        case 'approval_required':
            return copy.button.approvalRequired;
        case 'invite_required':
            return copy.button.inviteRequired;
        case 'insufficient_crystals':
            return copy.button.crystalRequirement({missingCrystals: snapshot.missingCrystals});
        case 'banned':
            return copy.button.restricted;
        case 'left':
            return copy.button.rejoin;
        case 'can_join':
            if (snapshot.membership?.status === 'Left') {
                return copy.button.rejoin;
            }
            return copy.button.join;
        case 'guest':
        default:
            return copy.button.createIdentity;
    }
}

export function getJoinHintText(snapshot: CircleMembershipSnapshot | null, copy: CircleJoinCopy = DEFAULT_JOIN_COPY): string | null {
    if (!snapshot) return copy.hint.visitorDefault;
    if (!snapshot.authenticated) return copy.hint.createIdentity;
    switch (snapshot.joinState) {
        case 'pending':
            return copy.hint.pending;
        case 'approval_required':
            return copy.hint.approvalRequired;
        case 'invite_required':
            return copy.hint.inviteRequired;
        case 'insufficient_crystals':
            return copy.hint.insufficientCrystals({
                required: snapshot.policy.minCrystals,
                current: snapshot.userCrystals,
            });
        case 'banned':
            return copy.hint.banned;
        case 'joined':
            return null;
        default:
            return copy.hint.visitorDefault;
    }
}

export function normalizeJoinActionError(raw: unknown, copy: CircleJoinCopy = DEFAULT_JOIN_COPY): string {
    const message = raw instanceof Error ? raw.message : String(raw || '');
    if (message.includes('401')) return copy.errors.walletRequired;
    if (message.includes('invite_required')) return copy.errors.inviteRequired;
    if (message.includes('insufficient_crystals')) return copy.errors.insufficientCrystals;
    if (message.includes('membership_banned')) return copy.errors.banned;
    if (message.includes('circle_archived')) return copy.errors.archived;
    if (message.includes('join_request_not_pending')) return copy.errors.requestStateChanged;
    if (message.includes('browser_only_mock_unsupported')) return copy.errors.browserMockUnsupported;
    if (
        message.includes('missing_membership_bridge_issuer_key_id')
        || message.includes('missing_membership_bridge_issuer_secret')
        || message.includes('membership_bridge_issuer_key_mismatch')
        || message.includes('membership attestor')
        || message.includes('membership_attestor_registry')
        || message.includes('Error Code: Unauthorized')
        || message.includes('Error Number: 12001')
        || message.includes('custom program error: 0x2ee1')
        || message.includes('权限不足')
    ) {
        return copy.errors.membershipBridgeUnavailable;
    }
    return message || copy.errors.fallback;
}

export function mapDiscussionDtoToPlazaMessage(
    dto: DiscussionMessageDto,
    input?: {
        locale?: string;
        deletedText?: string;
    },
): PlazaMessage {
    const locale = input?.locale || 'en';
    const fallbackAuthor = locale.startsWith('zh') ? '某位成员' : 'A member';
    const serverScore =
        typeof dto.semanticScore === 'number' && Number.isFinite(dto.semanticScore)
            ? Math.max(0, Math.min(1, dto.semanticScore))
            : typeof dto.relevanceScore === 'number' && Number.isFinite(dto.relevanceScore)
                ? Math.max(0, Math.min(1, dto.relevanceScore))
                : null;
    const structuredMetadata = extractStructuredDiscussionMetadata(dto.metadata);
    const metadata = dto.expiresAt
        ? {
            ...(dto.metadata || {}),
            expiresAt: dto.expiresAt,
        }
        : dto.metadata || null;
    const authorAnnotations = Array.isArray(dto.authorAnnotations) && dto.authorAnnotations.length > 0
        ? dto.authorAnnotations
            .map((entry) => entry?.kind)
            .filter((kind): kind is 'fact' | 'explanation' | 'emotion' =>
                kind === 'fact' || kind === 'explanation' || kind === 'emotion')
        : structuredMetadata.authorAnnotations;
    const semanticFacets = normalizeSemanticFacets(dto.semanticFacets);
    return {
        id: dto.lamport,
        author: resolveActorDisplayLabel({
            effectiveName: dto.senderEffectiveDisplayName,
            displaySource: dto.senderDisplaySource,
            pubkey: dto.senderPubkey,
        }, fallbackAuthor),
        text: dto.deleted ? (input?.deletedText || '[message deleted]') : dto.text,
        time: timeAgo(dto.createdAt, locale),
        ephemeral: Boolean(dto.isEphemeral),
        usefulCount:
            typeof dto.usefulCount === 'number' && Number.isFinite(dto.usefulCount)
                ? Math.max(0, dto.usefulCount)
                : 0,
        viewerHasMarkedUseful: Boolean(dto.viewerHasMarkedUseful),
        isFeatured: Boolean(dto.isFeatured),
        featureReason: dto.featureReason || null,
        featuredAt: dto.featuredAt || null,
        envelopeId: dto.envelopeId,
        senderPubkey: dto.senderPubkey,
        senderIdentityLevel: dto.senderIdentityLevel ?? null,
        senderIdentityDisplayName: dto.senderIdentityDisplayName ?? null,
        senderIdentityState: dto.senderIdentityState ?? null,
        senderMembershipSource: dto.senderMembershipSource ?? null,
        senderMembershipCircleId: dto.senderMembershipCircleId ?? null,
        senderRole: dto.senderRole ?? null,
        senderRoleDisplayName: dto.senderRoleDisplayName ?? null,
        subjectType: dto.subjectType ?? null,
        subjectId: dto.subjectId ?? null,
        clientTimestamp: dto.clientTimestamp,
        nonce: dto.nonce,
        messageKind: dto.messageKind || 'plain',
        metadata,
        relevanceStatus: dto.relevanceStatus ?? null,
        semanticFacets,
        focusScore: typeof dto.focusScore === 'number' && Number.isFinite(dto.focusScore)
            ? Math.max(0, Math.min(1, dto.focusScore))
            : null,
        focusLabel: dto.focusLabel ?? null,
        authorAnnotations,
        primaryAuthorAnnotation: structuredMetadata.primaryAuthorAnnotation,
        focusTag: structuredMetadata.focusTag,
        selectedForCandidate: structuredMetadata.selectedForCandidate,
        anchoredInteractions: dto.anchoredInteractions || undefined,
        forwardCard: dto.forwardCard || null,
        forwardBundleCard: dto.forwardBundleCard || null,
        sendState: 'sent',
        deleted: dto.deleted,
        relevanceScore: serverScore ?? 1,
    };
}
