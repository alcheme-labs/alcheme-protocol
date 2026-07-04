# Alcheme SDK Architecture

HTML diagram: [Open this subproject map](../docs/architecture/subproject-maps.html#sdk).

`sdk/` provides the TypeScript client package for Alcheme. It wraps the Anchor
programs, PDA helpers, transaction helpers, storage helpers, and runtime clients
used by external programs and Alcheme-compatible product surfaces.

## System Position

```mermaid
flowchart LR
    app["product surface / external program"] --> sdk["@alcheme/sdk"]
    sdk --> modules["program modules"]
    sdk --> runtime["runtime clients"]
    modules --> programs["Anchor programs"]
    runtime --> api["operator runtime REST API"]
    sdk --> idl["bundled IDLs"]
```

## Internal Map

```mermaid
flowchart TB
    index["src/index.ts"] --> alcheme["Alcheme class"]
    alcheme --> provider["AnchorProvider"]
    alcheme --> pda["PdaUtils"]
    alcheme --> identity["IdentityModule"]
    alcheme --> content["ContentModule"]
    alcheme --> access["AccessModule"]
    alcheme --> event["EventModule"]
    alcheme --> factory["FactoryModule"]
    alcheme --> messaging["MessagingModule"]
    alcheme --> circles["CirclesModule"]
    alcheme --> contribution["ContributionEngineModule"]
    index --> communication["runtime/communication.ts"]
    index --> voice["runtime/voice.ts"]
    index --> knowledge_context["runtime/knowledge-context.ts"]
    index --> source_materials["runtime/source-materials.ts"]
    server["server.ts"] --> claims["manifest / owner assertion / appRoomClaim"]
    protocol["protocol.ts"] --> external["ExternalApp Registry / Economics builders"]
    index --> utils["crypto / storage / transactions"]
```

## Responsibility

- Provides one `Alcheme` client that constructs typed program modules from configured program IDs.
- Bundles IDLs for core programs and the contribution-engine extension.
- Provides runtime clients for communication rooms, voice integrations,
  knowledge context packages, and source material submission.
- Provides server-side helpers for manifest hashes, owner assertions, app-room claims, callback digests, evidence hashes, and receipt digests through a server-only subpath.
- Provides protocol transaction helpers and ExternalApp IDL-backed builders through a protocol subpath.
- Installs transaction recovery helpers for already-processed send/confirm cases.

## Entry Points

| Surface | File or Command |
| --- | --- |
| Package manifest | `sdk/package.json` |
| Main client | `sdk/src/alcheme.ts` |
| Exports | `sdk/src/index.ts` |
| Program modules | `sdk/src/modules/*.ts` |
| Runtime clients | `sdk/src/runtime/communication.ts`, `sdk/src/runtime/voice.ts`, `sdk/src/runtime/knowledge-context.ts`, `sdk/src/runtime/source-materials.ts` |
| Server helpers | `sdk/src/server.ts` exported as `@alcheme/sdk/server` |
| Protocol helpers | `sdk/src/protocol.ts` exported as `@alcheme/sdk/protocol` |
| IDLs | `sdk/src/idl/*.json` |
| Build | `cd sdk && npm run build` |
| Tests | `cd sdk && npm test` |

The public baseline exports SDK source and a source-first package manifest. It
does not export prebuilt `dist/` artifacts; run the build command in the public
snapshot to generate local build output. Its default `npm test` command runs the
public runtime-client source tests that do not depend on private runtime or
unexported local build artifacts.

`@alcheme/sdk/runtime/server` remains as a deprecated compatibility alias for
early external program integrations. New code should import server authority
helpers from `@alcheme/sdk/server`.

## Runtime Subpath Imports

Browser clients should import the runtime surface they need instead of pulling
the root Anchor/Solana SDK entry by default:

```ts
import { createAlchemeGameChatClient } from "@alcheme/sdk/runtime/communication";
import { createAlchemeVoiceClient } from "@alcheme/sdk/runtime/voice";
import { fetchKnowledgeContextPackage } from "@alcheme/sdk/runtime/knowledge-context";
import { submitExternalProgramSourceMaterial } from "@alcheme/sdk/runtime/source-materials";
```

`createAlchemeGameChatClient` is a compatibility name for the generic
communication runtime client. New product copy should describe it as
communication runtime, not as the full external program scope.

External program servers can build and sign room claims from the server-only helper:

```ts
import {
  computeExternalAppManifestHash,
  computeExternalAppRiskDisclaimerAcceptanceDigest,
  signAppRoomClaim,
  signExternalAppOwnerAssertion,
} from "@alcheme/sdk/server";
```

Protocol builders for ExternalApp registry and economics transactions are exposed
from a separate protocol subpath:

```ts
import {
  buildAnchorExternalAppRegistrationInstruction,
  buildRecordRiskDisclaimerAcceptanceInstruction,
  buildSetAssetAllowlistInstruction,
} from "@alcheme/sdk/protocol";
```

Production ExternalApp registration and participant entry use scoped risk
disclaimer receipts. The app first fetches the terms from an operator runtime
API, then submits an on-chain receipt through the ExternalApp Economics program,
and finally sends the receipt evidence back to that runtime API:

```http
GET /api/v1/external-apps/risk-disclaimers/developer_registration
POST /api/v1/external-apps/:appId/risk-disclaimer-acceptances
```

The chain transaction stores digests, not the full agreement text. For production
registration, the developer agreement acceptance must bind to the manifest hash
and be included as `developerAgreement` when opening the governance request.
External program servers can use `computeExternalAppRiskDisclaimerAcceptanceDigest`
to compute the exact digest that the chain receipt and runtime validation both
expect. The operator runtime production path verifies the submitted receipt PDA,
on-chain account contents, account-data digest, and transaction status before it
opens the review request.

The root `@alcheme/sdk` export must not be used as a server authority surface.
Browser integrations should use only `runtime/communication`, `runtime/voice`,
`runtime/knowledge-context`, `runtime/source-materials`, and `runtime/errors`.

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which SDK methods still point at legacy program IDs by fallback? | Inspect defaults in `sdk/src/alcheme.ts` and compare with `config/devnet-program-ids.json`. |
| Which runtime clients require private-sidecar routes? | Compare `sdk/src/runtime/*` with the operator-provided runtime contract. |
| Which first-party flows bypass SDK and call runtime APIs directly? | Check the private first-party product tree when available. |
