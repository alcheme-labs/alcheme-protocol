/* ═══════════════════════════════════════════
   GraphQL response types
   Mirrors the query-api schema.ts types
   ═══════════════════════════════════════════ */

export interface GQLUser {
    id: number;
    handle: string;
    pubkey: string;
    displayName: string | null;
    bio: string | null;
    avatarUri: string | null;
    reputationScore: number;
    stats: {
        followers: number;
        following: number;
        posts: number;
        circles: number;
    };
    totem?: GQLTotem | null;
    createdAt: string;
}

export interface GQLTotem {
    stage: string;
    crystalCount: number;
    citationCount: number;
    circleCount: number;
    dustFactor: number;
    lastActiveAt: string;
}

export interface GQLPost {
    id: number;
    contentId: string;
    onChainAddress?: string | null;
    text: string | null;
    contentType: string;
    tags: string[];
    status:
    | 'Active'
    | 'Draft'
    | 'Published'
    | 'Archived'
    | 'Deleted'
    | 'Moderated'
    | 'Suspended'
    | 'Flagged'
    | 'UnderReview'
    | 'Hidden';
    visibility: 'Public' | 'CircleOnly' | 'FollowersOnly' | 'Private';
    v2VisibilityLevel?: 'Public' | 'CircleOnly' | 'FollowersOnly' | 'Private';
    v2AudienceKind?: 'Public' | 'Private' | 'FollowersOnly' | 'CircleOnly' | null;
    v2AudienceRef?: number | null;
    v2Status?: GQLPost['status'];
    protocolCircleId?: number | null;
    circleOnChainAddress?: string | null;
    liked: boolean;
    repostOfAddress?: string | null;
    repostOf?: GQLRepostSourcePost | null;
    stats: {
        likes: number;
        reposts: number;
        replies: number;
        views: number;
        heatScore: number;
    };
    author: {
        id: number;
        handle: string;
        pubkey: string;
        displayName: string | null;
        avatarUri: string | null;
        reputationScore: number;
    };
    circle: {
        id: number;
        name: string;
    } | null;
    createdAt: string;
    updatedAt: string;
}

export interface GQLRepostSourcePost {
    id: number;
    contentId: string;
    text: string | null;
    status: GQLPost['status'];
    visibility: GQLPost['visibility'];
    author: GQLPost['author'];
    circle: GQLPost['circle'];
    createdAt: string;
    updatedAt: string;
}

export interface GQLThreadPost extends GQLPost {
    replies: GQLPost[];
}

export type PublicFlowKind = 'Discussion' | 'Crystal';

export interface GQLPublicFlowItem {
    id: string;
    kind: PublicFlowKind;
    sourceId: string;
    title: string;
    excerpt: string;
    circleId: number;
    circleName: string;
    circleLevel: number;
    authorHandle: string;
    authorPubkey: string | null;
    score: number;
    featuredReason: string | null;
    createdAt: string;
}

export type IdentityLevel = 'Visitor' | 'Initiate' | 'Member' | 'Elder';

export interface GQLCircle {
    id: number;
    name: string;
    description: string | null;
    avatarUri: string | null;
    circleType: 'Open' | 'Closed' | 'Secret';
    level: number;
    knowledgeCount: number;
    genesisMode: 'BLANK' | 'SEEDED' | string | null;
    kind: 'main' | 'auxiliary';
    mode: 'knowledge' | 'social';
    minCrystals: number;
    parentCircleId: number | null;
    stats: {
        members: number;
        posts: number;
    };
    creator: {
        id: number;
        handle: string;
        pubkey: string;
        displayName: string | null;
    };
    createdAt: string;
}

export interface GQLCircleWithChildren extends GQLCircle {
    childCircles?: GQLCircleWithChildren[];
}

export interface GQLCircleWithMembers extends GQLCircle {
    members?: GQLCircleMember[];
}

export interface GQLCircleMember {
    user: {
        id: number;
        handle: string;
        pubkey: string;
        displayName: string | null;
        avatarUri: string | null;
    };
    role: 'Owner' | 'Admin' | 'Moderator' | 'Member';
    status: 'Active' | 'Banned' | 'Left';
    identityLevel: IdentityLevel;
    joinedAt: string;
}

export interface GQLCircleDetail extends GQLCircleWithChildren {
    members: GQLCircleMember[];
    posts: GQLPost[];
}

// ── Query response types ──

export interface FeedResponse {
    feed: GQLPost[];
}

export interface FollowingFlowResponse {
    followingFlow: GQLPost[];
}

export interface PublicFlowResponse {
    publicFlow: GQLPublicFlowItem[];
}

export interface MeResponse {
    me: GQLUser | null;
}

export interface TrendingResponse {
    trending: GQLPost[];
}

export interface UserResponse {
    user: GQLUser | null;
}

export interface CircleResponse {
    circle: GQLCircleDetail | null;
    circleDescendants: GQLCircleWithMembers[];
}

export interface CirclePostsResponse {
    circle: {
        id: number;
        posts: GQLPost[];
    } | null;
}

export interface PostThreadResponse {
    post: GQLThreadPost | null;
}

export interface CirclesResponse {
    circles: GQLCircle[];
}

export interface SearchUsersResponse {
    searchUsers: GQLUser[];
}

export interface SearchPostsResponse {
    searchPosts: GQLPost[];
}

export interface MyCirclesResponse {
    myCircles: GQLCircle[];
}

export interface AllCirclesResponse {
    allCircles: GQLCircle[];
}

export interface SearchCirclesResponse {
    searchCircles: GQLCircle[];
}

// ── Mutation response types ──

// CreatePostResponse / DeletePostResponse removed — 走链上 SDK

export interface UpdateUserResponse {
    updateUser: GQLUser;
}

export interface EvaluateIdentityResponse {
    evaluateIdentity: {
        previousLevel: IdentityLevel;
        currentLevel: IdentityLevel;
        changed: boolean;
    };
}

export interface GQLGhostDraftProvenance {
    origin: string;
    providerMode: string;
    model: string;
    promptAsset: string;
    promptVersion: string;
    sourceDigest: string;
    ghostRunId: number | null;
}

export interface GQLGhostDraftSuggestion {
    suggestionId: string;
    targetType: string;
    targetRef: string;
    threadIds: string[];
    issueTypes: string[];
    summary: string;
    suggestedText: string;
}

export interface GQLGhostDraftResult {
    generationId: number;
    postId: number;
    draftText: string;
    suggestions: GQLGhostDraftSuggestion[];
    model: string;
    generatedAt: string;
    provenance: GQLGhostDraftProvenance;
}

export interface GQLGhostDraftSeededReferenceInput {
    path: string;
    line: number;
}

export interface GhostDraftGenerateInput {
    postId: number;
    preferAutoApply?: boolean | null;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | null;
    seededReference?: GQLGhostDraftSeededReferenceInput | null;
    sourceMaterialIds?: number[] | null;
}

export interface GhostDraftJobResponse {
    generateGhostDraft: {
        jobId: number;
        status: string;
        postId: number;
        autoApplyRequested: boolean;
    };
}

export interface AcceptGhostDraftResponse {
    acceptGhostDraft: {
        generation: GQLGhostDraftResult;
        applied: boolean;
        changed: boolean;
        acceptanceId: number | null;
        acceptanceMode: string | null;
        acceptedAt: string | null;
        acceptedByUserId: number | null;
        acceptedSuggestion: GQLGhostDraftSuggestion | null;
        acceptedThreadIds: string[];
        workingCopyContent: string;
        workingCopyHash: string;
        updatedAt: string;
        heatScore: number;
    };
}

// ── Notification types ──

export interface GQLNotification {
    id: number;
    type: string;
    title: string;
    body: string | null;
    displayTitle: string;
    displayBody: string | null;
    sourceType: string | null;
    sourceId: string | null;
    circleId: number | null;
    read: boolean;
    createdAt: string;
}

export interface NotificationsResponse {
    myNotifications: GQLNotification[];
}

export interface MarkNotificationsReadResponse {
    markNotificationsRead: boolean;
}

// ── Knowledge types ──

export interface GQLKnowledge {
    id: number;
    knowledgeId: string;
    onChainAddress: string;
    title: string;
    description: string | null;
    ipfsCid: string | null;
    contentHash: string | null;
    author: GQLUser;
    circle: GQLCircle;
    sourceCircle: GQLCircle | null;
    version: number;
    contributorsRoot: string | null;
    contributorsCount: number;
    contributors: GQLKnowledgeContributor[];
    references: GQLKnowledgeLineageLink[];
    citedBy: GQLKnowledgeLineageLink[];
    versionTimeline: GQLKnowledgeVersionEvent[];
    stats: {
        qualityScore: number;
        citationCount: number;
        viewCount: number;
        heatScore: number;
    };
    crystalParams: GQLCrystalParams | null;
    createdAt: string;
    updatedAt: string;
}

export interface GQLCrystalParams {
    seed: string;
    hue: number;
    facets: number;
}

export interface GQLKnowledgeContributor {
    handle: string;
    pubkey: string;
    role: 'Author' | 'Discussant' | 'Reviewer' | 'Cited' | 'Unknown';
    weight: number;
    authorType: 'HUMAN' | 'AGENT';
    authorityScore: number;
    reputationDelta: number;
    settledAt: string;
    sourceType: 'SNAPSHOT' | 'SETTLEMENT';
    sourceDraftPostId: number | null;
    sourceAnchorId: string | null;
    sourcePayloadHash: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
}

export interface GQLKnowledgeLineageLink {
    knowledgeId: string;
    onChainAddress: string;
    title: string;
    circleId: number;
    circleName: string;
    heatScore: number;
    citationCount: number;
    createdAt: string;
}

export interface GQLKnowledgeVersionEvent {
    id: string;
    eventType: string;
    version: number;
    actorPubkey: string | null;
    actorHandle: string | null;
    contributorsCount: number | null;
    contributorsRoot: string | null;
    sourceEventTimestamp: string;
    eventAt: string;
    createdAt: string;
}

export interface GQLKnowledgeVersionSnapshot {
    knowledgeId: string;
    version: number;
    eventType: string;
    actorPubkey: string | null;
    actorHandle: string | null;
    contributorsCount: number | null;
    contributorsRoot: string | null;
    sourceEventTimestamp: string;
    eventAt: string;
    createdAt: string;
    title: string | null;
    description: string | null;
    ipfsCid: string | null;
    contentHash: string | null;
    hasContentSnapshot: boolean;
}

export interface GQLKnowledgeVersionFieldChange {
    field: string;
    label: string;
    fromValue: string;
    toValue: string;
}

export interface GQLKnowledgeVersionDiff {
    knowledgeId: string;
    fromVersion: number;
    toVersion: number;
    fromSnapshot: GQLKnowledgeVersionSnapshot;
    toSnapshot: GQLKnowledgeVersionSnapshot;
    fieldChanges: GQLKnowledgeVersionFieldChange[];
    unavailableFields: string[];
    summary: string;
}

export interface KnowledgeResponse {
    knowledge: GQLKnowledge | null;
}

export interface KnowledgeVersionDiffResponse {
    knowledge: {
        knowledgeId: string;
        versionDiff: GQLKnowledgeVersionDiff | null;
    } | null;
}

export interface KnowledgeByOnChainAddressResponse {
    knowledgeByOnChainAddress: GQLKnowledge | null;
}

export interface KnowledgeByCircleResponse {
    knowledgeByCircle: GQLKnowledge[];
}

export interface MyKnowledgeItem {
    id: number;
    knowledgeId: string;
    onChainAddress: string;
    title: string;
    description: string | null;
    version: number;
    contributorsCount: number;
    circle: { id: number; name: string } | null;
    stats: { qualityScore: number; citationCount: number; viewCount: number; heatScore: number };
    crystalParams: GQLCrystalParams | null;
    createdAt: string;
}

export interface MyKnowledgeResponse {
    myKnowledge: MyKnowledgeItem[];
}

// ── DraftComment types ──

export interface GQLDraftComment {
    id: number;
    postId: number;
    user: GQLUser;
    content: string;
    lineRef: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DraftCommentsResponse {
    draftComments: GQLDraftComment[];
}

export interface AddDraftCommentResponse {
    addDraftComment: GQLDraftComment;
}

// ── DraftSummary & MemberProfile types ──

export interface GQLDraftSummary {
    postId: number;
    title: string;
    excerpt: string | null;
    heatScore: number;
    status: string;
    commentCount: number;
    ageDays: number;
    createdAt: string;
    updatedAt: string;
}

export interface CircleDraftsResponse {
    circleDrafts: GQLDraftSummary[];
}

export interface GQLMemberProfile {
    user: Pick<GQLUser, 'id' | 'handle' | 'pubkey' | 'displayName' | 'avatarUri' | 'reputationScore'>;
    viewerFollows: boolean;
    isSelf: boolean;
    role: 'Owner' | 'Admin' | 'Moderator' | 'Member';
    joinedAt: string;
    knowledgeCount: number;
    ownedCrystalCount: number;
    totalCitations: number;
    circleCount: number;
    sharedCircles: Array<{
        id: number;
        name: string;
        kind: string;
        level: number;
    }>;
    recentActivity: Array<{
        type: 'post' | 'draft' | 'crystal';
        text: string;
        createdAt: string;
    }>;
}

export interface MemberProfileResponse {
    memberProfile: GQLMemberProfile | null;
}
