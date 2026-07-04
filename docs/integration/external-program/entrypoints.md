# External Program Entrypoint Index

Status: public navigation index for external program integrations.

This index maps the public entrypoints an external program can depend on. It
does not expose the private first-party runtime implementation, deployment
scripts, signing sidecars, or operator runbooks.

Product terminology: **External Program** is the public term. The protocol,
SDK, and runtime contract may still use `ExternalApp` as the implementation
object name.

## 1. Developer SDK Entrypoints

Browser/runtime SDK:

- `@alcheme/sdk/runtime/communication`
- `@alcheme/sdk/runtime/voice`
- `@alcheme/sdk/runtime/knowledge-context`
- `@alcheme/sdk/runtime/source-materials`
- `@alcheme/sdk/runtime/errors`

Server-side SDK:

- `@alcheme/sdk/server`

Protocol SDK:

- `@alcheme/sdk/protocol`
- `@alcheme/sdk/modules/external-app-registry`
- `@alcheme/sdk/modules/external-app-economics`
- `@alcheme/sdk/idl/*.json`

Boundary:

- Browser code must not hold server private keys, program authority keys, admin
  tokens, or settlement authority keys.
- `@alcheme/sdk/server` belongs on the external program server.
- Protocol builders help construct transactions; they are not production
  approval shortcuts.

## 2. Runtime Communication Entrypoints

Operator-runtime routes under `/api/v1`:

- `POST /communication/rooms/resolve`
- `POST /communication/rooms/:roomKey/members`
- `POST /communication/sessions`
- `POST /communication/rooms/:roomKey/messages`
- `GET /communication/rooms/:roomKey/messages`
- `GET /communication/rooms/:roomKey/stream`
- `POST /voice/sessions`
- `POST /voice/sessions/:sessionId/token`

Boundary:

- The operator runtime verifies app registration, room claims, wallet
  signatures, and room policy.
- Temporary room state, messages, voice sessions, and raw audio are not written
  to chain by this integration.
- Live voice depends on the operator voice policy and the external program's
  injected provider adapter.

## 3. Community Knowledge Entrypoints

Routes:

- `POST /api/v1/external-apps/:appId/source-materials`
- `GET /api/v1/external-apps/:appId/source-materials/:sourceMaterialId/status`
- `GET /api/v1/external-apps/:appId/source-materials/status?originType=...&originRef=...`
- `POST /api/v1/external-apps/:appId/knowledge-context`

Required developer evidence:

- `sourceSubmissionClaim` signed by the registered external program server key.
- `sourceMaterialStatusClaim` signed by the registered external program server
  key for server-signed status reads.
- `knowledgeContextClaim` signed by the registered external program server key.
- Circle binding or attached Circle authority recognized by the operator
  runtime.

Boundary:

- Source-material submission is available only when the operator exposes the
  `source_materials` private sidecar surface.
- SourceMaterial status reads are app-scoped lifecycle projections. They return
  status-group and display eligibility fields, not raw claim digests or private
  evidence.
- Knowledge context returns accepted, displayable references and summaries. It
  does not return sealed evidence, private locators, unpublished drafts, or raw
  room history.
- See [External Program Server-Signed Claims](./server-signed-claims.md) for the
  exact payload fields.

## 4. Sandbox Registration Entrypoint

Route:

- `POST /api/v1/external-apps`

Required operator data:

- `EXTERNAL_APP_ADMIN_TOKEN` or developer portal authorization.
- App id, owner wallet, allowed origins, server public key, and claim auth mode.

Boundary:

- Sandbox registration is for local, devnet, demo, and CI-style integration
  testing.
- It is not production approval and must not be presented as an app-store
  listing, managed-node entitlement, or safety endorsement.

## 5. Production Registration Entrypoints

Routes:

- `GET /api/v1/external-apps/risk-disclaimers/developer_registration`
- `POST /api/v1/external-apps/:appId/risk-disclaimer-acceptances`
- `POST /api/v1/external-apps/:appId/production-registration-requests`

Required developer evidence:

- normalized manifest.
- owner assertion from the registered owner wallet.
- developer terms shown to the developer.
- chain risk-disclaimer receipt evidence.
- active External Program review policy version id from the operator.

Boundary:

- Creating a production registration request does not activate the external
  program.
- Operator governance or review execution is required before official discovery
  or managed-node exposure.
- If the manifest changes, the developer agreement acceptance must bind to the
  new manifest hash.

The request body contains `manifest`, `ownerAssertion`, and
`developerAgreement`. Operator runtimes may also require explicit
`reviewCircleId`, `reviewPolicyId`, `reviewPolicyVersionId`,
`reviewPolicyVersion`, or `reviewRoleKey` when multiple production review
bindings exist.

## 6. Discovery And Projection Entrypoints

Common read routes exposed by compatible operator runtimes:

- `GET /api/v1/external-apps/discovery`
- `GET /api/v1/external-apps/:appId`
- `GET /api/v1/external-apps/:appId/stability-projection`

Boundary:

- Discovery and projection are read surfaces.
- Labels such as reviewed, listed, limited, risk, or stability are not Alcheme
  guarantees, insurance, reimbursement promises, or endorsements.
- External programs remain operated by their owners.

## 7. App-Operated Route Entrypoints

Some external programs may declare their own route or continuity endpoint.

Boundary:

- App-operated routes are not Alcheme managed nodes.
- They should not be described as a public Alcheme-certified self-hosted node
  network.
- They may help users find an app-operated path, but the app operator remains
  responsible for that route.

## 7. Verification Entrypoints

Public baseline commands:

```bash
npm run test:sdk
npm run typecheck:game-chat-react
npm run build:sdk
```

Operator/runtime verification:

- Use the operator-provided runtime endpoint and sandbox registration.
- Run the `joinExternalRoom` flow with a real wallet signer.
- Verify text send/list/stream against the target endpoint.
- Verify voice only when the operator provider is enabled and healthy.
- Treat private-tree smoke scripts as operator validation tools, not public
  baseline commands.
