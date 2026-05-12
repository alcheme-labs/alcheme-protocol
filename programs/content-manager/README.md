# Content Manager Program Architecture

HTML diagram: [Open this subproject map](../../docs/architecture/subproject-maps.html#content-manager).

`content-manager` owns chain-side content records, interaction metadata, V2 audience/lifecycle fields, and draft/crystallization anchor instructions.

## System Position

```mermaid
flowchart LR
    sdk["@alcheme/sdk content module"] --> program["content-manager"]
    program -. "verify identity" .-> identity["identity-registry"]
    program -. "check permission / relationship" .-> access["access-controller"]
    program -. "read circle membership" .-> circle["circle-manager"]
    program -. "content events" .-> event["event-emitter"]
    program --> accounts["ContentPostAccount\nV2ContentAnchorAccount\nContentStatsAccount\nContentStorageAccount"]
    indexer["indexer-core"] --> readmodel["Post / draft / anchor read model"]
```

## Internal Map

```mermaid
flowchart TB
    lib["src/lib.rs"] --> ix["instructions.rs"]
    lib --> state["state.rs"]
    lib --> storage["storage.rs"]
    lib --> validation["validation.rs"]
    ix --> create["create_content\ncreate_content_v2"]
    ix --> social["reply / quote / repost"]
    ix --> lifecycle["publish / archive / restore / tombstone"]
    ix --> draft["enter_draft_crystallization_v2\nanchor_draft_lifecycle_v2"]
    ix --> audience["access and audience checks"]
    ix --> interaction["interactions, scores, visibility, monetization"]
    ix --> cpi["cpi_update_content_status\ncpi_add_content_reference"]
```

## Responsibility

- Creates and updates chain-side content metadata for posts, replies, reposts, quotes, and drafts.
- Stores V2 anchors and lifecycle/audience fields used by newer product flows.
- Calls identity, access, relationship, and circle-membership helpers for gated writes.
- Emits content events that feed the indexer and query-api read model.

## Entry Points

| Surface | File |
| --- | --- |
| Program module | `programs/content-manager/src/lib.rs` |
| Instructions | `programs/content-manager/src/instructions.rs` |
| State | `programs/content-manager/src/state.rs` |
| Storage helpers | `programs/content-manager/src/storage.rs` |
| Validation | `programs/content-manager/src/validation.rs` |
| SDK caller | `sdk/src/modules/content.ts` |

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which V2 lifecycle states are authoritative on-chain versus query-api runtime state? | Compare V2 anchor instructions with `DraftWorkflowState` and draft routes in `query-api`. |
| Which audience rules are enforced before writes? | Trace `create_content_v2_with_access` and `create_content_v2_with_audience`. |
| Which content events are fully projected? | Compare emitted content events with indexer parser branches and Prisma `Post` fields. |
