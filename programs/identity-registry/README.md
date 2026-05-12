# Identity Registry Program Architecture

HTML diagram: [Open this subproject map](../../docs/architecture/subproject-maps.html#identity-registry).

`identity-registry` owns on-chain identity records, handle mappings, verification attributes, and reputation-related identity fields.

## System Position

```mermaid
flowchart LR
    sdk["@alcheme/sdk identity module"] --> program["identity-registry"]
    extension["contribution-engine"] -. "reputation settlement" .-> program
    program --> accounts["UserIdentityAccount\nHandleMappingAccount\nIdentityRegistryAccount"]
    program -. "identity events" .-> event["event-emitter"]
    indexer["indexer-core"] --> readmodel["users read model"]
```

## Internal Map

```mermaid
flowchart TB
    lib["src/lib.rs"] --> ix["instructions.rs"]
    lib --> state["state.rs"]
    lib --> validation["validation.rs"]
    ix --> register["register_identity"]
    ix --> update["update_identity\nadd_verification_attribute"]
    ix --> reputation["update_reputation\nupdate_reputation_by_extension"]
    ix --> query["verify_identity\nget_identity_info\nget_user_reputation"]
    state --> user["UserIdentityAccount"]
    state --> handle["HandleMappingAccount"]
    state --> registry["IdentityRegistryAccount"]
```

## Responsibility

- Registers and updates user identity records and handle mappings.
- Stores identity profile, verification, reputation, social, economic, and content statistics fields.
- Exposes CPI-style reads for identity verification and reputation lookup.
- Accepts extension-driven reputation updates through the extension reputation path.

## Entry Points

| Surface | File |
| --- | --- |
| Program module | `programs/identity-registry/src/lib.rs` |
| Instructions | `programs/identity-registry/src/instructions.rs` |
| State | `programs/identity-registry/src/state.rs` |
| Validation | `programs/identity-registry/src/validation.rs` |
| SDK caller | `sdk/src/modules/identity.ts` |

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which reputation updates require extension registry authorization? | Trace `update_reputation_by_extension` in `instructions.rs`. |
| Which identity events are projected into `User` rows? | Compare emitted identity events with `services/indexer-core/src/parsers/event_parser.rs`. |
| Which profile fields are duplicated in the off-chain read model? | Compare `UserIdentityAccount` with `services/query-api/prisma/schema.prisma` model `User`. |
