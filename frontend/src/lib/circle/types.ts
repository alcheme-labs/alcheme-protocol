import type { ChatRecordMessage } from '@/components/circle/ChatRecordBubble/ChatRecordBubble';
import type {
    AuthorAnnotationKind,
    SemanticFacet,
} from '@/features/discussion-intake/labels/structuredMetadata';
import type { DiscussionAnchoredInteractionDto } from '@/features/anchored-interactions/types';
import type { CircleAccessRequirement } from '@/lib/circle/accessPolicy';
import type {
    CircleIdentityDisplayState,
    CircleIdentityLevelValue,
    CircleMembershipSourceValue,
    CircleRoleValue,
} from '@/lib/circle/identityTypes';

/* ══════════════════════════════════════════
   Sub-Circle (层级) Data Model
   ══════════════════════════════════════════ */

export interface SubCircle {
    id: string;
    name: string;
    level: number;
    isDefault: boolean;
    accessRequirement: CircleAccessRequirement;
    memberCount: number;
    crystalCount: number;
    // ── P3: Auxiliary circle fields ──
    kind: 'main' | 'auxiliary';
    mode: 'social' | 'knowledge';
    parentId: string | null;
    tabs: ('plaza' | 'feed' | 'crucible' | 'sanctuary' | 'governance')[];
    // ── Genesis mode (Phase 1: always BLANK, Phase 2: support SEEDED) ──
    genesisMode: 'BLANK' | 'SEEDED';
}

export interface PlazaMessage {
    id: number;
    lamport?: number | null;
    author: string;
    text: string;
    time: string;
    createdAt?: string | null;
    clientTimestamp?: string | null;
    nonce?: string | null;
    ephemeral: boolean;
    usefulCount: number;
    viewerHasMarkedUseful?: boolean;
    /** AI-assessed relevance to circle topic (0.0=off-topic, 1.0=highly relevant).
     *  Messages below 0.3 are visually dimmed/blurred. */
    relevanceScore?: number;
    /** Legacy local-only forwarded record */
    chatRecord?: {
        sourceCircle: string;
        messages: ChatRecordMessage[];
        forwardedBy: string;
    };
    forwardCard?: {
        sourceEnvelopeId: string | null;
        sourceCircleId: number | null;
        sourceCircleName: string | null;
        sourceLevel: number | null;
        sourceAuthorHandle: string | null;
        forwarderHandle: string | null;
        sourceMessageCreatedAt: string | null;
        forwardedAt: string | null;
        sourceDeleted: boolean;
        snapshotText: string;
    } | null;
    forwardBundleCard?: {
        bundleId: string;
        sourceCircleId: number | null;
        sourceCircleName: string | null;
        sourceLevel: number | null;
        forwarderHandle: string | null;
        forwardedAt: string | null;
        itemCount: number;
        sourceItems: Array<{
            sourceEnvelopeId: string;
            sourceAuthorPubkey: string;
            sourceAuthorDisplayName: string | null;
            sourceAuthorDisplaySource: string | null;
            sourceAuthorDisplayCircleId: number | null;
            sourceMessageCreatedAt: string | null;
            snapshotText: string;
            snapshotTruncated: boolean;
            sourceDeleted: boolean;
        }>;
    } | null;
    isFeatured?: boolean;
    featureReason?: string | null;
    featuredAt?: string | null;
    envelopeId?: string;
    senderPubkey?: string;
    senderIdentityLevel?: CircleIdentityLevelValue | null;
    senderIdentityDisplayName?: string | null;
    senderIdentityState?: CircleIdentityDisplayState | null;
    senderMembershipSource?: CircleMembershipSourceValue | null;
    senderMembershipCircleId?: number | null;
    senderRole?: CircleRoleValue | null;
    senderRoleDisplayName?: string | null;
    messageKind?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
    metadata?: Record<string, unknown> | null;
    relevanceStatus?: 'pending' | 'ready' | 'stale' | 'failed' | null;
    semanticFacets?: SemanticFacet[];
    focusScore?: number | null;
    focusLabel?: 'focused' | 'contextual' | 'off_topic' | null;
    authorAnnotations?: AuthorAnnotationKind[];
    primaryAuthorAnnotation?: AuthorAnnotationKind | null;
    focusTag?: string | null;
    selectedForCandidate?: boolean;
    anchoredInteractions?: DiscussionAnchoredInteractionDto[];
    sendState?: 'sent' | 'pending' | 'failed';
    errorHint?: string;
    deleted?: boolean;
}

export interface PlazaQuickAuxCircle {
    id: string;
    name: string;
    level: number;
    minCrystals: number;
}

export interface CircleGroup {
    name: string;
    subCircles: SubCircle[];
}

export interface DiscussionSessionState {
    sessionId: string;
    discussionAccessToken: string;
    expiresAt: string;
    senderPubkey: string;
    scope: string;
}
