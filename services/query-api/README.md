# Query API Architecture

HTML diagram: [Open this subproject map](../../docs/architecture/subproject-maps.html#query-api).

`services/query-api/` is the Node runtime host for Alcheme. It serves GraphQL and REST read/write surfaces, but it also owns runtime services such as discussion, collaboration, AI jobs, voice, governance, draft workflow, crystallization side effects, and private sidecar routes.

## System Position

```mermaid
flowchart TB
    frontend["frontend"] --> query["query-api"]
    sdk["@alcheme/sdk runtime clients"] --> query
    query --> postgres["Postgres read model"]
    query --> redis["Redis sessions/cache"]
    query --> solana["Solana RPC / Anchor writers"]
    indexer["indexer-core"] --> postgres
    indexer --> redis
    signer["anchor-signer"] -. "external signing" .-> query
    livekit["voice provider"] -. "webhook/provider adapter" .-> query
```

## Request And Runtime Map

```mermaid
flowchart TB
    http["HTTP server"] --> app["Express app"]
    app --> middleware["helmet / cors / json / session / logging / consistency headers"]
    middleware --> graphql["Apollo GraphQL\n/graphql"]
    middleware --> rest["REST router\n/api/v1"]
    rest --> sidecar_gate["private-sidecar route gate"]
    sidecar_gate --> routers["users / posts / circles / discussion / communication / voice / governance / crystallization / extensions"]
    graphql --> resolvers["GraphQL resolvers"]
    resolvers --> prisma["Prisma"]
    routers --> services["runtime services"]
    services --> prisma
    services --> redis["Redis"]
    services --> anchors["anchor writers / Solana RPC"]
    services --> ai["AI jobs and discussion intelligence"]
    services --> collab["Yjs collaboration"]
    services --> voice["voice provider adapters"]
```

## Background Services

```mermaid
flowchart LR
    startup["startQueryApiServer"] --> schema["ensure off-chain discussion schema"]
    startup --> app["createApp"]
    startup --> collab["setupCollaboration"]
    startup --> aiworker["startAiJobWorker"]
    startup --> cache["CacheInvalidator"]
    startup --> heat["heat decay cron"]
    startup --> identity["identity evaluation cron"]
    startup --> draft["draft workflow cron"]
    startup --> fork["fork retention cron"]
    startup --> sync["off-chain peer sync"]
    startup --> ghost["pending ghost settings reconciler"]
```

## API Surface Split

```mermaid
flowchart TB
    role{"QUERY_API_RUNTIME_ROLE"}
    role -->|PUBLIC_NODE| public["public-node safe APIs"]
    role -->|PRIVATE_SIDECAR| sidecar["sidecar-owned APIs"]
    public --> gql["graphql"]
    public --> sync["sync status"]
    public --> membership["membership"]
    public --> communication_runtime["communication runtime"]
    public --> voice_runtime["voice runtime"]
    sidecar --> auth["auth session"]
    sidecar --> collab["collab"]
    sidecar --> source["source materials / seeded"]
    sidecar --> discussion["discussion runtime / ghost draft private"]
    sidecar --> provider["voice provider webhook"]
```

## Responsibility

- Serves the GraphQL schema and REST API used by the frontend.
- Reads and writes the Prisma-backed read model and runtime state.
- Hosts private runtime services that are not pure read APIs.
- Enforces public-node versus private-sidecar ownership for sensitive routes.
- Starts background workers and cron jobs needed for current product flows.

## Entry Points

| Surface | File or Command |
| --- | --- |
| Server startup | `services/query-api/src/index.ts` |
| Express/Apollo app | `services/query-api/src/app.ts` |
| REST router | `services/query-api/src/rest/index.ts` |
| GraphQL schema/resolvers | `services/query-api/src/graphql/schema.ts`, `services/query-api/src/graphql/resolvers.ts` |
| Runtime config | `services/query-api/src/config/services.ts` |
| Prisma schema | `services/query-api/prisma/schema.prisma` |
| Build | `cd services/query-api && npm run build` |
| Tests | `cd services/query-api && npm test` |
| MCP server | `cd services/query-api && npm run mcp` |

## Major Runtime Domains

| Domain | Key Paths |
| --- | --- |
| Discussion and ghost drafts | `src/rest/discussion.ts`, `src/ai/*`, `src/services/discussion/*`, `src/services/ghostDraft/*` |
| Draft lifecycle and proof packages | `src/rest/draftLifecycle.ts`, `src/services/draftLifecycle/*`, `src/services/proofPackage*` |
| Crystallization and crystal assets | `src/rest/crystallization.ts`, `src/services/crystallization*`, `src/services/crystalAssets/*`, `src/services/crystalEntitlements/*` |
| Communication rooms and voice | `src/rest/communication.ts`, `src/rest/voice.ts`, `src/services/communication/*`, `src/services/voice/*` |
| Governance and policy | `src/rest/governance.ts`, `src/rest/policy.ts`, `src/services/governance/*`, `src/services/policy/*` |
| Extension discovery | `src/rest/extensions.ts`, `src/services/extensionCatalog.ts` |
| Consistency and sync | `src/services/consistency.ts`, `src/services/offchainPeerSync.ts`, `/sync/status` |

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which routes are safe on public nodes? | Check `publicNodeSafeApis`, `sidecarOwnedApis`, and route matchers in `src/rest/index.ts`. |
| Which runtime writes are chain-authoritative versus read-model side effects? | Trace services that call Solana RPC, anchor writers, or `anchorSigner`. |
| Which background workers are required for a demo to stay healthy? | Check `startQueryApiServer` and local stack process management. |
| Which GraphQL fields still read legacy projections? | Compare `src/graphql/resolvers.ts` with Prisma model groups. |
