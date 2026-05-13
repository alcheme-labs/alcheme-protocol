import { gql } from '@apollo/client';

/* ════════════════════════════════════════════════════
   GraphQL Queries — mapped from query-api schema.ts
   ════════════════════════════════════════════════════ */

// ── Fragment: reusable field sets ──

export const USER_FIELDS = gql`
  fragment UserFields on User {
    id
    handle
    pubkey
    displayName
    bio
    avatarUri
    reputationScore
    stats {
      followers
      following
      posts
      circles
    }
    totem {
      stage
      crystalCount
      citationCount
      circleCount
      dustFactor
      lastActiveAt
    }
    createdAt
  }
`;

export const POST_FIELDS = gql`
  fragment PostFields on Post {
    id
    contentId
    onChainAddress
    text
    contentType
    tags
    status
    visibility
    liked
    repostOfAddress
    repostOf {
      id
      contentId
      text
      status
      visibility
      author {
        id
        handle
        pubkey
        displayName
        avatarUri
        reputationScore
      }
      circle {
        id
        name
      }
      createdAt
      updatedAt
    }
    stats {
      likes
      reposts
      replies
      views
      heatScore
    }
    author {
      id
      handle
      pubkey
      displayName
      avatarUri
      reputationScore
    }
    circle {
      id
      name
    }
    createdAt
    updatedAt
  }
`;

export const CIRCLE_FIELDS = gql`
  fragment CircleFields on Circle {
    id
    name
    description
    avatarUri
    lifecycleStatus
    archivedAt
    archivedByPubkey
    archiveReason
    circleType
    joinRequirement
    level
    knowledgeCount
    genesisMode
    kind
    mode
    minCrystals
    parentCircleId
    stats {
      members
      posts
    }
    creator {
      id
      handle
      pubkey
      displayName
    }
    createdAt
  }
`;

// ── Queries ──

export const GET_ME = gql`
  ${USER_FIELDS}
  query GetMe {
    me {
      ...UserFields
    }
  }
`;

export const GET_FEED = gql`
  ${POST_FIELDS}
  query GetFeed($limit: Int, $offset: Int, $filter: FeedFilter) {
    feed(limit: $limit, offset: $offset, filter: $filter) {
      ...PostFields
    }
  }
`;

export const GET_FOLLOWING_FLOW = gql`
  ${POST_FIELDS}
  query GetFollowingFlow($limit: Int, $offset: Int) {
    followingFlow(limit: $limit, offset: $offset) {
      ...PostFields
    }
  }
`;

export const GET_POST_THREAD = gql`
  ${POST_FIELDS}
  query GetPostThread($contentId: String!, $replyLimit: Int = 50) {
    post(contentId: $contentId) {
      ...PostFields
      replies(limit: $replyLimit) {
        ...PostFields
      }
    }
  }
`;

export const GET_PUBLIC_FLOW = gql`
  query GetPublicFlow($limit: Int, $offset: Int) {
    publicFlow(limit: $limit, offset: $offset) {
      id
      kind
      sourceId
      title
      excerpt
      circleId
      circleName
      circleLevel
      authorHandle
      authorPubkey
      score
      featuredReason
      createdAt
    }
  }
`;

export const GET_TRENDING = gql`
  ${POST_FIELDS}
  query GetTrending($timeRange: TimeRange, $limit: Int) {
    trending(timeRange: $timeRange, limit: $limit) {
      ...PostFields
    }
  }
`;

export const GET_USER = gql`
  ${USER_FIELDS}
  query GetUser($handle: String!) {
    user(handle: $handle) {
      ...UserFields
    }
  }
`;

export const GET_CIRCLE = gql`
  ${CIRCLE_FIELDS}
  ${POST_FIELDS}
  query GetCircle($id: Int!) {
    circle(id: $id) {
      ...CircleFields
      members(limit: 50) {
        user {
          id
          handle
          pubkey
          displayName
          avatarUri
        }
        role
        status
        identityLevel
        joinedAt
      }
      posts(limit: 50) {
        ...PostFields
      }
    }
    circleDescendants(rootId: $id) {
      ...CircleFields
      members(limit: 50) {
        user {
          id
          handle
          pubkey
          displayName
          avatarUri
        }
        role
        status
        identityLevel
        joinedAt
      }
    }
  }
`;

export const GET_CIRCLE_POSTS = gql`
  ${POST_FIELDS}
  query GetCirclePosts($id: Int!, $limit: Int = 50) {
    circle(id: $id) {
      id
      posts(limit: $limit) {
        ...PostFields
      }
    }
  }
`;

export const GET_CIRCLES = gql`
  ${CIRCLE_FIELDS}
  query GetCircles($ids: [Int!]!) {
    circles(ids: $ids) {
      ...CircleFields
    }
  }
`;

export const SEARCH_USERS = gql`
  query SearchUsers($query: String!, $limit: Int) {
    searchUsers(query: $query, limit: $limit) {
      id
      handle
      displayName
      avatarUri
      reputationScore
    }
  }
`;

export const SEARCH_POSTS = gql`
  ${POST_FIELDS}
  query SearchPosts($query: String!, $tags: [String!], $limit: Int) {
    searchPosts(query: $query, tags: $tags, limit: $limit) {
      ...PostFields
    }
  }
`;

export const GET_MY_CIRCLES = gql`
  ${CIRCLE_FIELDS}
  query GetMyCircles {
    myCircles {
      ...CircleFields
    }
  }
`;

export const GET_ALL_CIRCLES = gql`
  ${CIRCLE_FIELDS}
  query GetAllCircles($limit: Int, $offset: Int) {
    allCircles(limit: $limit, offset: $offset) {
      ...CircleFields
    }
  }
`;

export const SEARCH_CIRCLES = gql`
  ${CIRCLE_FIELDS}
  query SearchCircles($query: String!, $limit: Int) {
    searchCircles(query: $query, limit: $limit) {
      ...CircleFields
    }
  }
`;

// ══════════════════════════════════════════════════
// Mutations
// ══════════════════════════════════════════════════

// CREATE_POST / DELETE_POST / JOIN_CIRCLE / LEAVE_CIRCLE removed
// 链上权威写操作统一走 SDK
// See: hooks/useCreateContent.ts, hooks/useDeleteContent.ts, hooks/useCreateCircle.ts

export const UPDATE_USER = gql`
  ${USER_FIELDS}
  mutation UpdateUser($input: UpdateUserInput!) {
    updateUser(input: $input) {
      ...UserFields
    }
  }
`;

export const EVALUATE_IDENTITY = gql`
  mutation EvaluateIdentity($circleId: Int!, $userId: Int!) {
    evaluateIdentity(circleId: $circleId, userId: $userId) {
      previousLevel
      currentLevel
      changed
    }
  }
`;

export const GENERATE_GHOST_DRAFT = gql`
  mutation GenerateGhostDraft($input: GenerateGhostDraftInput!) {
    generateGhostDraft(input: $input) {
      jobId
      status
      postId
      autoApplyRequested
    }
  }
`;

export const ACCEPT_GHOST_DRAFT = gql`
  mutation AcceptGhostDraft($input: AcceptGhostDraftInput!) {
    acceptGhostDraft(input: $input) {
      generation {
        generationId
        postId
        draftText
        suggestions {
          suggestionId
          targetType
          targetRef
          threadIds
          issueTypes
          summary
          suggestedText
        }
        model
        generatedAt
        provenance {
          origin
          providerMode
          model
          promptAsset
          promptVersion
          sourceDigest
          ghostRunId
        }
      }
      applied
      changed
      acceptanceId
      acceptanceMode
      acceptedAt
      acceptedByUserId
      acceptedSuggestion {
        suggestionId
        targetType
        targetRef
        threadIds
        issueTypes
        summary
        suggestedText
      }
      acceptedThreadIds
      workingCopyContent
      workingCopyHash
      updatedAt
      heatScore
    }
  }
`;

// ══════════════════════════════════════════════════
// Notification Queries & Mutations
// ══════════════════════════════════════════════════

export const GET_NOTIFICATIONS = gql`
  query GetNotifications($limit: Int, $offset: Int) {
    myNotifications(limit: $limit, offset: $offset) {
      id
      type
      title
      body
      displayTitle
      displayBody
      sourceType
      sourceId
      circleId
      read
      createdAt
    }
  }
`;

export const MARK_NOTIFICATIONS_READ = gql`
  mutation MarkNotificationsRead($ids: [Int!]!) {
    markNotificationsRead(ids: $ids)
  }
`;

// ══════════════════════════════════════════════════
// Knowledge Queries
// ══════════════════════════════════════════════════

export const GET_KNOWLEDGE = gql`
  query GetKnowledge($knowledgeId: String!) {
    knowledge(knowledgeId: $knowledgeId) {
      id
      knowledgeId
      onChainAddress
      title
      description
      ipfsCid
      contentHash
      version
      contributorsRoot
      contributorsCount
      contributors {
        handle
        pubkey
        role
        weight
        authorType
        authorityScore
        reputationDelta
        settledAt
        sourceType
        sourceDraftPostId
        sourceAnchorId
        sourcePayloadHash
        sourceSummaryHash
        sourceMessagesDigest
      }
      author {
        id
        handle
        pubkey
        displayName
        avatarUri
      }
      circle {
        id
        name
      }
      sourceCircle {
        id
        name
      }
      stats {
        qualityScore
        citationCount
        viewCount
        heatScore
      }
      references(limit: 6) {
        knowledgeId
        onChainAddress
        title
        circleId
        circleName
        heatScore
        citationCount
        createdAt
      }
      citedBy(limit: 6) {
        knowledgeId
        onChainAddress
        title
        circleId
        circleName
        heatScore
        citationCount
        createdAt
      }
      versionTimeline(limit: 20) {
        id
        eventType
        version
        actorPubkey
        actorHandle
        contributorsCount
        contributorsRoot
        sourceEventTimestamp
        eventAt
        createdAt
      }
      crystalParams {
        seed
        hue
        facets
      }
      crystalAsset {
        id
        knowledgePublicId
        ownerPubkey
        masterAssetAddress
        assetStandard
        mintStatus
        metadataUri
        mintedAt
        lastError
      }
      crystalReceiptStats {
        totalCount
        mintedCount
        pendingCount
        failedCount
        unknownCount
      }
      crystalReceipts(limit: 12) {
        id
        knowledgePublicId
        ownerPubkey
        ownerUserId
        contributionRole
        contributionWeightBps
        receiptAssetAddress
        assetStandard
        transferMode
        mintStatus
        metadataUri
        mintedAt
        lastError
      }
      createdAt
      updatedAt
    }
  }
`;

export const GET_KNOWLEDGE_BY_ONCHAIN_ADDRESS = gql`
  query GetKnowledgeByOnChainAddress($onChainAddress: String!) {
    knowledgeByOnChainAddress(onChainAddress: $onChainAddress) {
      id
      knowledgeId
      onChainAddress
      title
      description
      ipfsCid
      contentHash
      version
      contributorsRoot
      contributorsCount
      contributors {
        handle
        pubkey
        role
        weight
        authorType
        authorityScore
        reputationDelta
        settledAt
        sourceType
        sourceDraftPostId
        sourceAnchorId
        sourcePayloadHash
        sourceSummaryHash
        sourceMessagesDigest
      }
      author {
        id
        handle
        pubkey
        displayName
        avatarUri
      }
      circle {
        id
        name
      }
      sourceCircle {
        id
        name
      }
      stats {
        qualityScore
        citationCount
        viewCount
        heatScore
      }
      references(limit: 6) {
        knowledgeId
        onChainAddress
        title
        circleId
        circleName
        heatScore
        citationCount
        createdAt
      }
      citedBy(limit: 6) {
        knowledgeId
        onChainAddress
        title
        circleId
        circleName
        heatScore
        citationCount
        createdAt
      }
      versionTimeline(limit: 20) {
        id
        eventType
        version
        actorPubkey
        actorHandle
        contributorsCount
        contributorsRoot
        sourceEventTimestamp
        eventAt
        createdAt
      }
      crystalParams {
        seed
        hue
        facets
      }
      crystalAsset {
        id
        knowledgePublicId
        ownerPubkey
        masterAssetAddress
        assetStandard
        mintStatus
        metadataUri
        mintedAt
        lastError
      }
      crystalReceiptStats {
        totalCount
        mintedCount
        pendingCount
        failedCount
        unknownCount
      }
      crystalReceipts(limit: 12) {
        id
        knowledgePublicId
        ownerPubkey
        ownerUserId
        contributionRole
        contributionWeightBps
        receiptAssetAddress
        assetStandard
        transferMode
        mintStatus
        metadataUri
        mintedAt
        lastError
      }
      createdAt
      updatedAt
    }
  }
`;

export const GET_KNOWLEDGE_BY_CIRCLE = gql`
  query GetKnowledgeByCircle($circleId: Int!, $limit: Int, $offset: Int) {
    knowledgeByCircle(circleId: $circleId, limit: $limit, offset: $offset) {
      id
      knowledgeId
      onChainAddress
      title
      description
      contentHash
      version
      contributorsRoot
      contributorsCount
      contributors {
        handle
        pubkey
        role
        weight
        authorType
        authorityScore
        reputationDelta
        settledAt
        sourceType
        sourceDraftPostId
        sourceAnchorId
        sourcePayloadHash
        sourceSummaryHash
        sourceMessagesDigest
      }
      author {
        id
        handle
        pubkey
        displayName
        avatarUri
      }
      stats {
        qualityScore
        citationCount
        viewCount
        heatScore
      }
      crystalParams {
        seed
        hue
        facets
      }
      createdAt
      updatedAt
    }
  }
`;

export const GET_KNOWLEDGE_VERSION_DIFF = gql`
  query GetKnowledgeVersionDiff($knowledgeId: String!, $fromVersion: Int!, $toVersion: Int!) {
    knowledge(knowledgeId: $knowledgeId) {
      knowledgeId
      versionDiff(fromVersion: $fromVersion, toVersion: $toVersion) {
        knowledgeId
        fromVersion
        toVersion
        summary
        unavailableFields
        fromSnapshot {
          knowledgeId
          version
          eventType
          actorPubkey
          actorHandle
          contributorsCount
          contributorsRoot
          sourceEventTimestamp
          eventAt
          createdAt
          title
          description
          ipfsCid
          contentHash
          hasContentSnapshot
        }
        toSnapshot {
          knowledgeId
          version
          eventType
          actorPubkey
          actorHandle
          contributorsCount
          contributorsRoot
          sourceEventTimestamp
          eventAt
          createdAt
          title
          description
          ipfsCid
          contentHash
          hasContentSnapshot
        }
        fieldChanges {
          field
          label
          fromValue
          toValue
        }
      }
    }
  }
`;

export const GET_MY_KNOWLEDGE = gql`
  query GetMyKnowledge($limit: Int, $offset: Int) {
    myKnowledge(limit: $limit, offset: $offset) {
      id
      knowledgeId
      onChainAddress
      title
      description
      version
      contributorsCount
      circle {
        id
        name
      }
      stats {
        qualityScore
        citationCount
        viewCount
        heatScore
      }
      crystalParams {
        seed
        hue
        facets
      }
      createdAt
      updatedAt
    }
  }
`;

export const HIGHLIGHT_MESSAGE = gql`
  mutation HighlightMessage($circleId: Int!, $envelopeId: String!) {
    highlightMessage(circleId: $circleId, envelopeId: $envelopeId) {
      ok
      highlightCount
      isFeatured
      alreadyHighlighted
    }
  }
`;

export const GET_CIRCLE_DRAFTS = gql`
  query GetCircleDrafts($circleId: Int!, $limit: Int, $offset: Int) {
    circleDrafts(circleId: $circleId, limit: $limit, offset: $offset) {
      postId
      title
      excerpt
      heatScore
      status
      documentStatus
      commentCount
      ageDays
      createdAt
      updatedAt
    }
  }
`;

export const GET_MEMBER_PROFILE = gql`
  query GetMemberProfile($circleId: Int!, $userId: Int!) {
    memberProfile(circleId: $circleId, userId: $userId) {
      user {
        id
        handle
        pubkey
        displayName
        avatarUri
        reputationScore
      }
      viewerFollows
      isSelf
      role
      joinedAt
      knowledgeCount
      ownedCrystalCount
      totalCitations
      circleCount
      sharedCircles {
        id
        name
        kind
        level
      }
      recentActivity {
        type
        text
        createdAt
      }
    }
  }
`;

// ══════════════════════════════════════════════════
// Draft Comment Queries & Mutations
// ══════════════════════════════════════════════════

export const GET_DRAFT_COMMENTS = gql`
  query GetDraftComments($postId: Int!, $limit: Int) {
    draftComments(postId: $postId, limit: $limit) {
      id
      postId
      user {
        id
        handle
        displayName
        avatarUri
      }
      content
      lineRef
      createdAt
    }
  }
`;

export const ADD_DRAFT_COMMENT = gql`
  mutation AddDraftComment($postId: Int!, $content: String!, $lineRef: String) {
    addDraftComment(postId: $postId, content: $content, lineRef: $lineRef) {
      id
      postId
      user {
        id
        handle
        displayName
      }
      content
      lineRef
      createdAt
    }
  }
`;
