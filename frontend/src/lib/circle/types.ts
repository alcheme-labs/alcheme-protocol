import type { ChatRecordMessage } from '@/components/circle/ChatRecordBubble/ChatRecordBubble';
import type {
    AuthorAnnotationKind,
    SemanticFacet,
} from '@/features/discussion-intake/labels/structuredMetadata';
import type { CircleAccessRequirement } from '@/lib/circle/accessPolicy';

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
    tabs: ('plaza' | 'feed' | 'crucible' | 'sanctuary')[];
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
    ephemeral: boolean;
    highlights: number;
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
    isFeatured?: boolean;
    featureReason?: string | null;
    featuredAt?: string | null;
    envelopeId?: string;
    senderPubkey?: string;
    messageKind?: string | null;
    metadata?: Record<string, unknown> | null;
    relevanceStatus?: 'pending' | 'ready' | 'stale' | 'failed' | null;
    semanticFacets?: SemanticFacet[];
    focusScore?: number | null;
    focusLabel?: 'focused' | 'contextual' | 'off_topic' | null;
    authorAnnotations?: AuthorAnnotationKind[];
    primaryAuthorAnnotation?: AuthorAnnotationKind | null;
    focusTag?: string | null;
    selectedForCandidate?: boolean;
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
