import { gql } from 'apollo-server-express';

export const typeDefs = gql`
  scalar DateTime
  scalar BigInt

  type Totem {
    stage: String!
    crystalCount: Int!
    citationCount: Int!
    circleCount: Int!
    dustFactor: Float!
    lastActiveAt: DateTime!
  }

  type User {
    id: Int!
    handle: String!
    pubkey: String!
    displayName: String
    bio: String
    avatarUri: String
    bannerUri: String
    website: String
    location: String
    reputationScore: Float!
    stats: UserStats!
    profile: UserProfile
    posts(limit: Int = 20, offset: Int = 0): [Post!]!
    followers(limit: Int = 50): [User!]!
    following(limit: Int = 50): [User!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    totem: Totem
  }

  type UserStats {
    followers: Int!
    following: Int!
    posts: Int!
    circles: Int!
  }

  type Post {
    id: Int!
    contentId: String!
    onChainAddress: String
    author: User!
    text: String!
    contentType: String!
    storageUri: String
    tags: [String!]!
    stats: PostStats!
    liked: Boolean!
    repostOfAddress: String
    repostOf: Post
    thread: [Post!]!
    replies(limit: Int = 20): [Post!]!
    circle: Circle
    status: PostStatus!
    visibility: String!
    v2VisibilityLevel: String!
    v2AudienceKind: String
    v2AudienceRef: Int
    v2Status: String!
    isV2Private: Boolean!
    isV2Draft: Boolean!
    protocolCircleId: Int
    circleOnChainAddress: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type PostStats {
    likes: Int!
    reposts: Int!
    replies: Int!
    comments: Int!
    shares: Int!
    views: Int!
    heatScore: Float!
  }

  enum PublicFlowKind {
    Discussion
    Crystal
  }

  type PublicFlowItem {
    id: String!
    kind: PublicFlowKind!
    sourceId: String!
    title: String!
    excerpt: String!
    circleId: Int!
    circleName: String!
    circleLevel: Int!
    authorHandle: String!
    authorPubkey: String
    score: Float!
    featuredReason: String
    createdAt: DateTime!
  }

  enum PostStatus {
    Active
    Draft
    Published
    Archived
    Deleted
    Moderated
    Suspended
    Flagged
    UnderReview
    Hidden
  }

  enum Visibility {
    Public
    CircleOnly
    FollowersOnly
    Private
  }

  type Circle {
    id: Int!
    protocolCircleId: Int!
    name: String!
    description: String
    avatarUri: String
    onChainAddress: String!
    creator: User!
    circleType: CircleType!
    level: Int!
    knowledgeCount: Int!
    genesisMode: String
    kind: String!
    mode: String!
    minCrystals: Int!
    parentCircleId: Int
    stats: CircleStats!
    parentCircle: Circle
    childCircles: [Circle!]!
    members(limit: Int = 50): [CircleMember!]!
    posts(limit: Int = 20): [Post!]!
    createdAt: DateTime!
  }

  enum CircleType {
    Open
    Closed
    Secret
  }

  type CircleStats {
    members: Int!
    posts: Int!
  }

  type CircleMember {
    user: User!
    role: MemberRole!
    status: MemberStatus!
    identityLevel: IdentityLevel!
    joinedAt: DateTime!
  }

  enum MemberRole {
    Owner
    Admin
    Moderator
    Member
  }

  enum MemberStatus {
    Active
    Banned
    Left
  }

  enum IdentityLevel {
    Visitor
    Initiate
    Member
    Elder
  }

  type Query {
    # 当前用户 (需要认证)
    me: User
    
    # 用户查询
    user(handle: String!): User
    users(handles: [String!]!): [User!]!
    
    # 帖子查询
    post(contentId: String!): Post
    posts(contentIds: [String!]!): [Post!]!
    
    # Feed
    feed(limit: Int = 20, offset: Int = 0, filter: FeedFilter = VERIFIED_ONLY): [Post!]!
    followingFlow(limit: Int = 20, offset: Int = 0): [Post!]!
    publicFlow(limit: Int = 20, offset: Int = 0): [PublicFlowItem!]!
    
    # 趋势
    trending(timeRange: TimeRange = DAY, limit: Int = 20): [Post!]!
    
    # 圈子
    circle(id: Int!): Circle
    circleDescendants(rootId: Int!): [Circle!]!
    circles(ids: [Int!]!): [Circle!]!
    allCircles(limit: Int = 20, offset: Int = 0): [Circle!]!
    
    # 搜索
    searchUsers(query: String!, limit: Int = 20): [User!]!
    searchPosts(query: String!, tags: [String!], limit: Int = 20): [Post!]!
    searchCircles(query: String!, limit: Int = 20): [Circle!]!
    
    # 草稿 (需要认证)
    myDrafts(limit: Int = 20, offset: Int = 0): [Post!]!
    
    # 我的圈层
    myCircles: [Circle!]!
    
    # 知识晶体
    knowledge(knowledgeId: String!): Knowledge
    knowledgeByOnChainAddress(onChainAddress: String!): Knowledge
    knowledgeByCircle(circleId: Int!, limit: Int = 20, offset: Int = 0): [Knowledge!]!
    myKnowledge(limit: Int = 20, offset: Int = 0): [Knowledge!]!
    knowledgeBinding(knowledgeId: String!): KnowledgeBinding

    # 通知 (需要认证)
    myNotifications(limit: Int = 20, offset: Int = 0): [Notification!]!

    # 草稿批注
    draftComments(postId: Int!, limit: Int = 50): [DraftComment!]!

    # 圈层草稿概览
    circleDrafts(circleId: Int!, limit: Int = 20, offset: Int = 0): [DraftSummary!]!

    # 圈层成员资料
    memberProfile(circleId: Int!, userId: Int!): MemberProfile
  }

  type Knowledge {
    id: Int!
    knowledgeId: String!
    onChainAddress: String!
    title: String!
    description: String
    ipfsCid: String
    contentHash: String
    author: User!
    circle: Circle!
    sourceCircle: Circle
    version: Int!
    contributorsRoot: String
    contributorsCount: Int!
    contributors(limit: Int = 20): [KnowledgeContributor!]!
    references(limit: Int = 8): [KnowledgeLineageLink!]!
    citedBy(limit: Int = 8): [KnowledgeLineageLink!]!
    stats: KnowledgeStats!
    crystalParams: CrystalParams
    binding: KnowledgeBinding
    versionTimeline(limit: Int = 20): [KnowledgeVersionEvent!]!
    versionDiff(fromVersion: Int!, toVersion: Int!): KnowledgeVersionDiff
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type KnowledgeBinding {
    knowledgeId: String!
    sourceAnchorId: String!
    proofPackageHash: String!
    contributorsRoot: String!
    contributorsCount: Int!
    bindingVersion: Int!
    generatedAt: DateTime!
    boundAt: DateTime!
    boundBy: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type KnowledgeVersionEvent {
    id: String!
    eventType: String!
    version: Int!
    actorPubkey: String
    actorHandle: String
    contributorsCount: Int
    contributorsRoot: String
    sourceEventTimestamp: String!
    eventAt: DateTime!
    createdAt: DateTime!
  }

  type KnowledgeVersionSnapshot {
    knowledgeId: String!
    version: Int!
    eventType: String!
    actorPubkey: String
    actorHandle: String
    contributorsCount: Int
    contributorsRoot: String
    sourceEventTimestamp: String!
    eventAt: DateTime!
    createdAt: DateTime!
    title: String
    description: String
    ipfsCid: String
    contentHash: String
    hasContentSnapshot: Boolean!
  }

  type KnowledgeVersionFieldChange {
    field: String!
    label: String!
    fromValue: String!
    toValue: String!
  }

  type KnowledgeVersionDiff {
    knowledgeId: String!
    fromVersion: Int!
    toVersion: Int!
    fromSnapshot: KnowledgeVersionSnapshot!
    toSnapshot: KnowledgeVersionSnapshot!
    fieldChanges: [KnowledgeVersionFieldChange!]!
    unavailableFields: [String!]!
    summary: String!
  }

  type KnowledgeLineageLink {
    knowledgeId: String!
    onChainAddress: String!
    title: String!
    circleId: Int!
    circleName: String!
    heatScore: Float!
    citationCount: Int!
    createdAt: DateTime!
  }

  enum ContributionRole {
    Author
    Discussant
    Reviewer
    Cited
    Unknown
  }

  enum AuthorType {
    HUMAN
    AGENT
  }

  enum KnowledgeContributorSourceType {
    SNAPSHOT
    SETTLEMENT
  }

  type KnowledgeContributor {
    handle: String!
    pubkey: String!
    role: ContributionRole!
    weight: Float!
    authorType: AuthorType!
    authorityScore: Float!
    reputationDelta: Float!
    settledAt: DateTime!
    sourceType: KnowledgeContributorSourceType!
    sourceDraftPostId: Int
    sourceAnchorId: String
    sourcePayloadHash: String
    sourceSummaryHash: String
    sourceMessagesDigest: String
  }

  type KnowledgeStats {
    qualityScore: Float!
    citationCount: Int!
    viewCount: Int!
    heatScore: Float!
  }

  """Frozen crystal visual params computed at crystallization time."""
  type CrystalParams {
    seed: String!
    hue: Int!
    facets: Int!
  }

  type DraftSummary {
    postId: Int!
    title: String!
    excerpt: String
    heatScore: Float!
    status: PostStatus!
    commentCount: Int!
    ageDays: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type MemberProfile {
    user: User!
    viewerFollows: Boolean!
    isSelf: Boolean!
    role: MemberRole!
    joinedAt: DateTime!
    knowledgeCount: Int!
    ownedCrystalCount: Int!
    totalCitations: Int!
    circleCount: Int!
    sharedCircles: [SharedCircleSummary!]!
    recentActivity: [MemberActivityItem!]!
  }

  type SharedCircleSummary {
    id: Int!
    name: String!
    kind: String!
    level: Int!
  }

  enum MemberActivityType {
    post
    draft
    crystal
  }

  type MemberActivityItem {
    type: MemberActivityType!
    text: String!
    createdAt: DateTime!
  }

  type Notification {
    id: Int!
    type: String!
    title: String!
    body: String
    displayTitle: String!
    displayBody: String
    sourceType: String
    sourceId: String
    circleId: Int
    read: Boolean!
    createdAt: DateTime!
  }

  type DraftComment {
    id: Int!
    postId: Int!
    user: User!
    content: String!
    lineRef: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  enum TimeRange {
    HOUR
    DAY
    WEEK
    MONTH
  }

  enum FeedFilter {
    ALL
    VERIFIED_ONLY
    HIGH_QUALITY
  }

  type UserProfile {
    knowledgeCount: Int!
    totalCitations: Int!
    totalViews: Int!
    averageQuality: Float!
    recentActivity: Int!
    unreadNotifications: Int!
  }

  # ══════════════════════════════════════
  # Mutation Input Types
  # ══════════════════════════════════════

  # CreatePostInput removed — 内容创建走链上 SDK (content-manager.create_content)

  input UpdateUserInput {
    displayName: String
    bio: String
    avatarUri: String
    bannerUri: String
    website: String
    location: String
  }

  # ══════════════════════════════════════
  # Mutation Response Types
  # ══════════════════════════════════════

  type IdentityResult {
    previousLevel: IdentityLevel!
    currentLevel: IdentityLevel!
    changed: Boolean!
  }

  type GhostDraftProvenance {
    origin: String!
    providerMode: String!
    model: String!
    promptAsset: String!
    promptVersion: String!
    sourceDigest: String!
    ghostRunId: Int
  }

  type GhostDraftResult {
    generationId: Int!
    postId: Int!
    draftText: String!
    suggestions: [GhostDraftSuggestion!]!
    model: String!
    generatedAt: DateTime!
    provenance: GhostDraftProvenance!
  }

  type GhostDraftSuggestion {
    suggestionId: ID!
    targetType: String!
    targetRef: String!
    threadIds: [ID!]!
    issueTypes: [String!]!
    summary: String!
    suggestedText: String!
  }

  input GhostDraftSeededReferenceInput {
    path: String!
    line: Int!
  }

  input GenerateGhostDraftInput {
    postId: Int!
    preferAutoApply: Boolean
    workingCopyHash: String
    workingCopyUpdatedAt: DateTime
    seededReference: GhostDraftSeededReferenceInput
    sourceMaterialIds: [Int!]
  }

  type GhostDraftJobResult {
    jobId: Int!
    status: String!
    postId: Int!
    autoApplyRequested: Boolean!
  }

  enum GhostDraftAcceptanceMode {
    AUTO_FILL
    ACCEPT_REPLACE
    ACCEPT_SUGGESTION
  }

  input AcceptGhostDraftInput {
    postId: Int!
    generationId: Int!
    mode: GhostDraftAcceptanceMode!
    suggestionId: ID
    workingCopyHash: String
    workingCopyUpdatedAt: DateTime
  }

  type GhostDraftAcceptanceResult {
    generation: GhostDraftResult!
    applied: Boolean!
    changed: Boolean!
    acceptanceId: Int
    acceptanceMode: String
    acceptedAt: DateTime
    acceptedByUserId: Int
    acceptedSuggestion: GhostDraftSuggestion
    acceptedThreadIds: [ID!]!
    workingCopyContent: String!
    workingCopyHash: String!
    updatedAt: DateTime!
    heatScore: Float!
  }

  type HighlightMessageResult {
    ok: Boolean!
    highlightCount: Int!
    isFeatured: Boolean!
    alreadyHighlighted: Boolean!
  }

  # ══════════════════════════════════════
  # Mutations
  # ══════════════════════════════════════

  type Mutation {
    # ── 内容 ──
    # createPost / deletePost removed — 走链上 SDK (content-manager)

    # ── 用户 ──
    updateUser(input: UpdateUserInput!): User!

    # ── P3: Identity ──
    evaluateIdentity(circleId: Int!, userId: Int!): IdentityResult!

    # ── P3: AI ──
    generateGhostDraft(input: GenerateGhostDraftInput!): GhostDraftJobResult!
    acceptGhostDraft(input: AcceptGhostDraftInput!): GhostDraftAcceptanceResult!

    # ── 讨论 ──
    highlightMessage(circleId: Int!, envelopeId: String!): HighlightMessageResult!

    # ── 通知 ──
    markNotificationsRead(ids: [Int!]!): Boolean!

    # ── 草稿批注 ──
    addDraftComment(postId: Int!, content: String!, lineRef: String): DraftComment!
  }
`;
