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
    rankingAdjustmentState: 'normal' | 'adjusted';
    rankingAdjustmentFactorBps: number | null;
    rankingAdjustmentExpiresAt: string | null;
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
    replies?: GQLPost[];
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
export type GQLCircleLifecycleStatus = 'Active' | 'Archived' | 'ForkPending' | 'MergePending' | 'Merged' | 'DissolutionPending';

export interface GQLCircle {
    id: number;
    name: string;
    description: string | null;
    avatarUri: string | null;
    lifecycleStatus: GQLCircleLifecycleStatus;
    archivedAt: string | null;
    archivedByPubkey: string | null;
    archiveReason: string | null;
    circleType: 'Open' | 'Closed' | 'Secret';
    joinRequirement: 'Free' | 'ApprovalRequired' | 'TokenGated' | 'InviteOnly';
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
    circleAlias: string | null;
    effectiveDisplayName: string | null;
    displaySource: string | null;
    displayCircleId: number | null;
    inheritedFromCircleId: number | null;
    globalHandle: string | null;
    globalDisplayName: string | null;
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

export type IssueReviewAssistAction =
    | 'propose_acceptance'
    | 'propose_rejection'
    | 'request_clarification'
    | 'suggest_retag'
    | 'accept_proposal'
    | 'reject_proposal'
    | 'unable_to_judge';

export type IssueReviewAssistReasonCode =
    | 'ok'
    | 'read_access_denied'
    | 'circle_context_missing'
    | 'permission_required'
    | 'unsupported_state'
    | 'target_changed'
    | 'unable_to_judge';

export interface IssueReviewAssistInput {
    draftPostId: number;
    threadId: string | number;
}

export interface GQLIssueReviewAssistPermission {
    action: string;
    allowed: boolean;
    reasonCode: string;
    reason: string;
    minRole: string | null;
}

export interface GQLIssueReviewAssistResult {
    draftPostId: number;
    threadId: string;
    threadState: string | null;
    targetType: string | null;
    targetRef: string | null;
    issueType: string | null;
    action: IssueReviewAssistAction;
    actionable: boolean;
    reasonCode: IssueReviewAssistReasonCode;
    reason: string;
    permissions: GQLIssueReviewAssistPermission[];
}

export interface IssueReviewAssistResponse {
    reviewDraftIssue: GQLIssueReviewAssistResult;
}

export interface AcceptedIssueRevisionGenerateInput {
    postId: number;
    threadIds?: Array<string | number> | null;
    targetRef?: string | null;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | null;
    seededReference?: GQLGhostDraftSeededReferenceInput | null;
    sourceMaterialIds?: number[] | null;
}

export interface AcceptedIssueRevisionJobResponse {
    generateAcceptedIssueRevision: GhostDraftJobResponse['generateGhostDraft'];
}

export interface ApplyAcceptedIssueRevisionInput {
    postId: number;
    generationId: number;
    suggestionId: string;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | null;
}

export interface ApplyAcceptedIssueRevisionResponse {
    applyAcceptedIssueRevision: AcceptGhostDraftResponse['acceptGhostDraft'];
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
    canonicalUrl: string | null;
    decisionStatus: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'unavailable' | null;
    executionStatus: 'not_ready' | 'not_required' | 'pending' | 'executed' | 'failed' | 'skipped' | 'unavailable' | null;
    governanceRecovery: {
        blocker: string;
        category: string | null;
        action: string | null;
        acceptedDecisionPreserved: true;
    } | null;
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

export interface GQLKnowledgeRelationshipLabel {
    key: string;
    displayName: string;
    description: string;
    useCases: string[];
    example: string | null;
    status: string;
    source: string;
    sortOrder: number;
}

export interface GQLKnowledgeRelationshipAssignment {
    knowledgeId: string;
    labelKey: string;
    label: GQLKnowledgeRelationshipLabel;
    sourceKnowledgeIds: string[];
    sourceDraftId: string | null;
    assignedBy: string;
    confidence: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface GQLCrystallizationOutputSummary {
    sourceDraftPostId: number | null;
    sourceDraftVersion: number | null;
    sourceDraftVersionLabel: string | null;
    sourceAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
}

export interface GQLKnowledgePublicationOrigin {
    schemaVersion: 1;
    kind: 'ordinary_collaboration' | 'governance_case_outcome';
    draftPostId: number;
    draftVersion: number;
    snapshotDigest: string;
    routingReceiptDigest: string;
    caseId: string | null;
    requestId: string | null;
    decisionDigest: string | null;
    executionReceiptId: string | null;
    executionStatus: 'not_applicable' | 'executed';
    outcome: 'ordinary' | 'accepted';
    governanceHomeType: 'circle';
    governanceHomeRef: string;
    targetCircleId: number;
    committeeCircleId: number | null;
    submittedByPubkey: string;
    submitAuthoritySemantics: 'legacy_author';
}

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
    relationshipAssignment?: GQLKnowledgeRelationshipAssignment;
    crystallizationOutput?: GQLCrystallizationOutputSummary | null;
    publicationOrigin?: GQLKnowledgePublicationOrigin | null;
    publicationOriginDigest?: string | null;
    publicationState: 'restricted' | 'published' | 'withdrawn' | string;
    publicationLicenseRef: string | null;
    publicationLicenseVersion: string | null;
    publicationLicenseDigest: string | null;
    publicationSourceSnapshotDigest: string | null;
    stablePublicPath: string | null;
    publicReleaseAuthorizedAt: string | null;
    publicationVersions: Array<{
        version: number;
        state: string;
        targetCircleId: number;
        stablePublicPath: string;
        licenseRef: string;
        licenseVersion: string;
        licenseDigest: string;
        sourceSnapshotJson: Record<string, unknown>;
        sourceSnapshotDigest: string;
        authorizationDigest: string;
        authorizedContributors: string[];
        publishedAt: string;
        withdrawnAt: string | null;
        createdAt: string;
    }>;
    versionTimeline: GQLKnowledgeVersionEvent[];
    stats: {
        qualityScore: number;
        citationCount: number;
        viewCount: number;
        heatScore: number;
    };
    crystalParams: GQLCrystalParams | null;
    crystalAsset: GQLCrystalAsset | null;
    crystalReceiptStats: GQLCrystalReceiptStats;
    crystalReceipts: GQLCrystalReceipt[];
    createdAt: string;
    updatedAt: string;
}

export interface GQLCrystalParams {
    seed: string;
    hue: number;
    facets: number;
}

export interface GQLCrystalAsset {
    id: number;
    knowledgePublicId: string;
    ownerPubkey: string;
    masterAssetAddress: string | null;
    assetStandard: string;
    mintStatus: string;
    legacyDisposition: 'legacy_auto_issued' | 'legacy_unsettled' | 'legacy_demo';
    cutoverReadOnly: true;
    metadataUri: string | null;
    mintedAt: string | null;
    lastError: string | null;
}

export interface GQLCrystalReceiptStats {
    totalCount: number;
    mintedCount: number;
    pendingCount: number;
    failedCount: number;
    unknownCount: number;
}

export interface GQLCrystalReceipt {
    id: number;
    knowledgePublicId: string;
    ownerPubkey: string;
    ownerEffectiveDisplayName: string | null;
    ownerDisplaySource: string | null;
    ownerCircleAlias: string | null;
    ownerNeedsDisplayDisambiguation: boolean;
    ownerUserId: number | null;
    contributionRole: string;
    contributionWeightBps: number;
    receiptAssetAddress: string | null;
    assetStandard: string;
    transferMode: string;
    mintStatus: string;
    legacyDisposition: 'legacy_claimed' | 'legacy_unsettled' | 'legacy_demo';
    cutoverReadOnly: true;
    metadataUri: string | null;
    mintedAt: string | null;
    lastError: string | null;
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
    assessmentKind: 'REAL' | 'MOCK' | 'HISTORICAL_FALLBACK' | 'UNKNOWN' | 'NOT_APPLICABLE';
    assessmentAlgorithmVersion: string | null;
    assessmentStatus: string | null;
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
    relationshipAssignment?: GQLKnowledgeRelationshipAssignment;
    crystallizationOutput?: GQLCrystallizationOutputSummary | null;
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
    documentStatus: string;
    publicBlockerCode: string | null;
    commentCount: number;
    ageDays: number;
    lastActivityAt: string;
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
