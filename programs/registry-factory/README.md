# Registry Factory Program Architecture

HTML diagram: [Open this subproject map](../../docs/architecture/subproject-maps.html#registry-factory).

`registry-factory` owns registry deployment records, deployment templates, version/health metadata, and the extension registry used by extension authorization.

## System Position

```mermaid
flowchart LR
    sdk["@alcheme/sdk factory module"] --> program["registry-factory"]
    program --> accounts["RegistryFactoryAccount\nDeployedRegistryAccount\nExtensionRegistryAccount"]
    program --> extensions["registered extension programs"]
    extensions -. "authorized CPI" .-> cpi["cpi-interfaces"]
    indexer["indexer-core"] --> readmodel["extension and registry read model"]
```

## Internal Map

```mermaid
flowchart TB
    lib["src/lib.rs"] --> ix["instructions.rs"]
    lib --> state["state.rs"]
    lib --> validation["validation.rs"]
    ix --> config["initialize/update factory config"]
    ix --> templates["create/update/delete deployment templates"]
    ix --> deploy["deploy identity/content/access/event/circle/messaging registries"]
    ix --> lifecycle["upgrade / pause / resume / deprecate registry"]
    ix --> query["get info / validate config / list registries / stats"]
    ix --> ext["initialize/register/remove/update extension registry"]
```

## Responsibility

- Stores registry-factory configuration and deployed registry records.
- Manages deployment templates and lifecycle metadata for registry-like protocol units.
- Owns extension registry accounts that represent which extension programs are registered.
- Provides the registry truth that extension authorization and extension discovery rely on.

## Entry Points

| Surface | File |
| --- | --- |
| Program module | `programs/registry-factory/src/lib.rs` |
| Instructions | `programs/registry-factory/src/instructions.rs` |
| State | `programs/registry-factory/src/state.rs` |
| Validation | `programs/registry-factory/src/validation.rs` |
| SDK caller | `sdk/src/modules/factory.ts` |

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which registry deployment functions create real program instances versus metadata records? | Inspect each deploy instruction implementation and tests. |
| Which extension registry account is used by live extension flows? | Trace registry PDA usage from contribution-engine tests and query-api extension discovery. |
| Which registry events are projected? | Compare factory events with indexer parser coverage. |
