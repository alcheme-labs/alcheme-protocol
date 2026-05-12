# Query API Prisma Schema Architecture

HTML diagram: [Open this subproject map](../../../docs/architecture/subproject-maps.html#prisma).

`services/query-api/prisma/schema.prisma` defines the Postgres read model and runtime-state model used by `query-api`. It is not just an indexer mirror: it also stores off-chain runtime state for discussion, drafts, collaboration-adjacent flows, governance, AI jobs, communication, voice, and crystallization.

## System Position

```mermaid
flowchart LR
    indexer["indexer-core"] --> prisma["Prisma schema / Postgres"]
    query["query-api runtime"] --> prisma
    prisma --> graphql["GraphQL resolvers"]
    prisma --> rest["REST services"]
    frontend["frontend"] --> rest
    frontend --> graphql
```

## Domain Model Map

```mermaid
flowchart TB
    identity["Identity\nUser / Follow / UserRelationship / UserTotem"]
    social["Social content\nPost / Like / Conversation / Message"]
    circles["Circles\nCircle / CircleMember / Join / Invite / MembershipEvent"]
    discussion["Discussion\nCircleDiscussionMessage / Highlight / Session"]
    communication["Communication\nExternalApp / Room / Member / Session / Message / Voice"]
    draft["Draft runtime\nDraft threads / VersionSnapshot / Workflow / Proof / Attempts"]
    knowledge["Knowledge\nKnowledge / Binding / Reference / Version / Contribution"]
    crystal["Crystal\nEntitlement / Asset / Receipt"]
    governance["Governance\nProposal / Vote / Policy / Request / Signal / Decision / Receipt"]
    fork["Forks\nForkDeclaration / Lineage / Retention / ActivityRollup"]
    ai["AI and ghost\nAiJob / GhostRun / GhostDraftGeneration / Acceptance"]
    indexer["Indexer state\nSyncCheckpoint / RuntimeState / ProgramCursor / FailedSlot"]
    settlement["Contribution settlement\nAuthorityScore / AntiGamingFlag / SettlementHistory"]
    notifications["Notifications\nNotification"]

    indexer --> identity
    indexer --> social
    indexer --> circles
    circles --> discussion
    discussion --> draft
    draft --> knowledge
    knowledge --> crystal
    circles --> governance
    circles --> fork
    communication --> discussion
    ai --> discussion
    settlement --> knowledge
    notifications --> identity
```

## Chain Projection Versus Runtime State

```mermaid
flowchart LR
    chain["chain-authoritative facts\naccounts / events / signatures"] --> indexer["indexer-core"]
    indexer --> projected["projected read models\nUser / Post / Circle / Knowledge"]
    query["query-api services"] --> runtime["runtime-owned models\nAiJob / DiscussionSession / DraftWorkflowState / CommunicationRoom"]
    query --> hybrid["hybrid models\nCrystalReceipt / GovernanceExecutionReceipt / CrystallizationAttempt"]
    projected --> app["frontend queries"]
    runtime --> app
    hybrid --> app
    hybrid -. "must reference or verify" .-> chain
```

## Ownership Reading

| Ownership | Write Path | Typical Models | Rule Of Thumb |
| --- | --- | --- | --- |
| Chain-authoritative | Anchor programs, signatures, and emitted events. | Source accounts and protocol anchors outside Prisma. | Canonical truth lives on-chain; Prisma can cache or reference it, not replace it. |
| Projected read model | `services/indexer-core/src/database/*`. | `User`, `Post`, `Circle`, `Knowledge`, sync and cursor models. | If it can be rebuilt from chain events, the indexer should own the write. |
| Runtime-owned state | `services/query-api/src/services/*`, `src/rest/*`, workers, and cron jobs. | `AiJob`, `DiscussionSession`, `DraftWorkflowState`, `CommunicationRoom`, `VoiceSession`, governance workflow rows. | If `query-api` creates, schedules, reconciles, or expires it, it is runtime-owned. |
| Hybrid state | `query-api` writes plus chain proof or anchor verification. | `CrystalReceipt`, `GovernanceExecutionReceipt`, crystallization attempt and binding records. | A row is only valid if its referenced chain fact or signature still matches. |

## Model Groups

| Group | Models |
| --- | --- |
| Identity and profile | `User`, `Follow`, `UserRelationship`, `UserTotem` |
| Social content | `Post`, `Like`, `Conversation`, `ConversationParticipant`, `Message` |
| Circles and membership | `Circle`, `CircleMember`, `CircleJoinRequest`, `CircleInvite`, `CircleMembershipEvent` |
| Indexer health | `SyncCheckpoint`, `IndexerRuntimeState`, `IndexerProgramCursor`, `IndexerFailedSlot` |
| Discussion runtime | `CircleDiscussionMessage`, `DiscussionMessageHighlight`, `DiscussionSession` |
| Communication and voice | `ExternalApp`, `CommunicationRoom`, `CommunicationRoomMember`, `CommunicationSession`, `CommunicationMessage`, `VoiceSession`, `VoiceParticipant` |
| Draft and proof runtime | `DraftDiscussionThread`, `DraftDiscussionMessage`, `DraftVersionSnapshot`, `DraftWorkflowState`, `DraftProofPackage`, `DraftCrystallizationAttempt` |
| Governance and policy | `GovernanceProposal`, `GovernanceVote`, `GovernancePolicy`, `GovernancePolicyVersion`, `GovernanceRequest`, `GovernanceDecision`, `GovernanceExecutionReceipt`, `CirclePolicyProfile` |
| Fork and revision direction | `ForkDeclaration`, `CircleForkLineage`, `CircleForkRetentionState`, `CircleActivityRollup`, `RevisionDirectionProposal`, `TemporaryEditGrant` |
| Knowledge and crystals | `Knowledge`, `KnowledgeBinding`, `KnowledgeReference`, `KnowledgeVersionEvent`, `KnowledgeContribution`, `CrystalEntitlement`, `CrystalAsset`, `CrystalReceipt` |
| AI and ghost drafts | `GhostRun`, `CircleGhostSetting`, `PendingCircleGhostSetting`, `GhostDraftGeneration`, `GhostDraftAcceptance`, `DraftCandidateAcceptance`, `DraftCandidateGenerationAttempt`, `AiJob` |
| Contribution settlement | `AuthorityScore`, `AntiGamingFlag`, `SettlementHistory` |
| Notifications and access | `Notification`, `AccessRule`, `Permission`, `TokenTransaction` |

## Entry Points

| Surface | File or Command |
| --- | --- |
| Prisma schema | `services/query-api/prisma/schema.prisma` |
| Prisma client generation | `cd services/query-api && npm run prisma:generate` |
| Prisma migration | `cd services/query-api && npm run prisma:migrate` |
| Query API database client | `services/query-api/src/database.ts` |
| Indexer writer | `services/indexer-core/src/database/*` |

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which models are projected only by the indexer? | Trace writes in `services/indexer-core/src/database/*`. |
| Which models are query-api runtime state? | Trace `prisma.*` writes in `services/query-api/src/services/*` and `src/rest/*`. |
| Which models duplicate on-chain account fields? | Compare Prisma fields with `programs/*/src/state.rs`. |
| Which runtime models need retention or cleanup policies? | Inspect cron services and models with lifecycle or timestamp fields. |
