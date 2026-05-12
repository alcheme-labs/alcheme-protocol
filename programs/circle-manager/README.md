# Circle Manager Program Architecture

HTML diagram: [Open this subproject map](../../docs/architecture/subproject-maps.html#circle-manager).

`circle-manager` owns circle hierarchy, membership, forks, knowledge records, transfer proposals, proof attestors, membership attestors, and contributor-proof bindings.

## System Position

```mermaid
flowchart LR
    sdk["@alcheme/sdk circles module"] --> program["circle-manager"]
    frontend["frontend circle flows"] --> sdk
    program --> accounts["Circle\nCircleMemberAccount\nKnowledge\nKnowledgeBinding\nForkAnchor\nAttestor registries"]
    program -. "circle / knowledge events" .-> event["event-emitter"]
    content["content-manager"] -. "read membership" .-> program
    indexer["indexer-core"] --> readmodel["Circle / Knowledge read model"]
```

## Internal Map

```mermaid
flowchart TB
    lib["src/lib.rs"] --> ix["instructions.rs"]
    lib --> state["state.rs"]
    ix --> circle["initialize\ncreate_circle\nupdate flags\narchive/restore/migrate"]
    ix --> membership["join/leave\nadd/remove/update member\nclaim membership"]
    ix --> fork["anchor_circle_fork"]
    ix --> knowledge["submit_knowledge\ncpi_promote_knowledge"]
    ix --> transfer["propose_transfer\nvote\nAI evaluation\nexecute_transfer"]
    ix --> attestors["proof and membership attestor registries"]
    ix --> contributors["bind/update contributor proofs"]
```

## Responsibility

- Stores the chain-side circle hierarchy and membership authority facts.
- Anchors fork declarations and knowledge-binding records.
- Manages knowledge submission, transfer proposals, AI evaluation inputs, and transfer execution.
- Provides membership and knowledge authority facts used by content and crystallization flows.

## Entry Points

| Surface | File |
| --- | --- |
| Program module | `programs/circle-manager/src/lib.rs` |
| Instructions | `programs/circle-manager/src/instructions.rs` |
| State | `programs/circle-manager/src/state.rs` |
| Program tests | `programs/circle-manager/tests/*.rs` |
| SDK caller | `sdk/src/modules/circles.ts` |

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which circle hierarchy facts are copied, inherited, or only linked by fork metadata? | Compare `Circle`, `CircleForkAnchor`, `KnowledgeBinding`, and indexer projection. |
| Which membership gates are on-chain versus query-api runtime gates? | Trace `claim_circle_membership`, query-api membership services, and frontend join flows. |
| Which contributor proof bindings are required before crystallization is considered complete? | Trace `bind_contributor_proof`, `bind_and_update_contributors`, and receipt/entitlement code. |
