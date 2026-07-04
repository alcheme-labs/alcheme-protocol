# External Program Server-Signed Claims

Status: public server-signed claim contract for External Program integrations.

External programs use short-lived signed claims to bind runtime requests to the
registered app, room, Circle, user, and review context. The browser should never
hold an external program server private key, an admin token, or a production
program authority key.

## Signing Model

Most runtime claims are signed by the external program server Ed25519 key whose
public key is registered on the `ExternalApp` record:

- `appRoomClaim`
- `sourceSubmissionClaim`
- `sourceMaterialStatusClaim`
- `knowledgeContextClaim`

The production registration `ownerAssertion` is different. It must be signed by
the owner wallet key declared in the manifest, not by the external program
server key.

Every claim envelope has the same outer shape:

```ts
type SignedClaim = {
  payload: string;
  signature: string;
};
```

`payload` is a base64url encoded JSON payload. `signature` is a base64 Ed25519
signature over the encoded payload string exactly as submitted.

Use the SDK server helpers from server-side code. The helper builds the versioned
payload and passes the encoded payload string to your signer:

```ts
import { signAppRoomClaim } from "@alcheme/sdk/server";

const claim = await signAppRoomClaim(input, async (encodedPayload) =>
  signBase64Ed25519WithExternalProgramServerKey(encodedPayload),
);
```

`signBase64Ed25519WithExternalProgramServerKey` is intentionally app-specific:
implement it with your server key manager, HSM, KMS, or deployment secret store.
It must return base64, not hex.

The lower-level SDK encoder remains available for advanced cases, but routine
app room, source submission, source status, and knowledge-context claims should
use their dedicated helpers so external programs do not hand-roll canonical
JSON or digests.

Current claim helpers and runtime verifiers implement the v1 server-signed
contract. Production runtime readiness is still gated by the operator runtime's
server key lifecycle state. Read `runtime-capabilities` and
`integration-status`; if `serverKeyLifecycle.productionStable` is false, the app
can be reviewed/activated while production claim acceptance remains blocked
until key lifecycle activation is complete.

## App Room Claim

Use `signAppRoomClaim` for room joins:

```ts
import { signAppRoomClaim } from "@alcheme/sdk/server";

const appRoomClaim = await signAppRoomClaim(
  {
    externalAppId: "example-external-program",
    roomType: "custom",
    externalRoomId: "room-001",
    walletPubkeys: [walletPubkey],
    roles: { [walletPubkey]: "member" },
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    nonce: crypto.randomUUID(),
  },
  async (encodedPayload) =>
    signBase64Ed25519WithExternalProgramServerKey(encodedPayload),
);
```

The runtime verifies that the claim:

- uses the current `claimContractVersion` emitted by the SDK helper
- is signed by the registered `serverPublicKey`
- has not expired
- matches the external program id and room tuple
- includes the joining wallet

## Source Submission Claim

`sourceSubmissionClaim` is required when a server-signed external program
submits selected communication or voice evidence as a `SourceMaterial` candidate.

The source-material route is not a generic public read/write route. It is
available only when the operator exposes the `source_materials` private sidecar
surface for the target runtime. If the operator has not enabled that surface,
the route returns `private_sidecar_required`.

Payload:

```ts
type SourceSubmissionClaimPayload = {
  claimContractVersion: "external_program.claim.v1";
  serverKeyVersion?: string;
  externalAppId: string;
  roomKey: string;
  originType: "communication_message" | "voice_recap" | "external_summary";
  originRef: string;
  targetCircleId: number;
  summaryDigest: string;
  evidencePrivacyClass: "public" | "circle_only" | "reviewer_only" | "sealed";
  requestedLifecycleStatus?: "nominated" | "submitted" | "review_pending";
  submittedByPubkey?: string | null;
  expiresAt: string;
  nonce: string;
};
```

Example:

```ts
import { randomUUID } from "node:crypto";
import { signSourceSubmissionClaim } from "@alcheme/sdk/server";

const summaryText =
  "Players agreed the frost boss needs a resistance strategy.";

const sourceSubmissionClaim = await signSourceSubmissionClaim(
  {
    serverKeyVersion: "2026-07-04-primary",
    externalAppId: "example-external-program",
    roomKey: joined.room.roomKey,
    originType: "communication_message",
    originRef: "envelope-1",
    targetCircleId: 130,
    summaryText,
    evidencePrivacyClass: "circle_only",
    requestedLifecycleStatus: "submitted",
    submittedByPubkey: walletPubkey,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: randomUUID(),
  },
  async (encodedPayload) =>
    signBase64Ed25519WithExternalProgramServerKey(encodedPayload),
);
```

The submitted request must use the same `roomKey`, `originType`, `originRef`,
`targetCircleId`, `summaryText`, privacy class, lifecycle status, and submitter
that the claim binds. The SDK computes `summaryDigest` as the SHA-256 hex digest
of the exact `summaryText` string.

## SourceMaterial Status Claim

`sourceMaterialStatusClaim` is required when a server-signed external program
checks the lifecycle status of a submitted candidate. The claim must bind either
the numeric `sourceMaterialId` or the exact `originType + originRef` lookup
scope used by the GET request.

Payload by id:

```ts
type SourceMaterialStatusClaimPayload = {
  claimContractVersion: "external_program.claim.v1";
  serverKeyVersion?: string;
  externalAppId: string;
  sourceMaterialId: number;
  purpose: "source_material_status";
  expiresAt: string;
  nonce: string;
};
```

Payload by origin:

```ts
type SourceMaterialStatusByOriginClaimPayload = {
  claimContractVersion: "external_program.claim.v1";
  serverKeyVersion?: string;
  externalAppId: string;
  originType: "communication_message" | "voice_recap" | "external_summary";
  originRef: string;
  purpose: "source_material_status";
  expiresAt: string;
  nonce: string;
};
```

Example:

```ts
import { randomUUID } from "node:crypto";
import { signSourceMaterialStatusClaim } from "@alcheme/sdk/server";

const sourceMaterialStatusClaim = await signSourceMaterialStatusClaim(
  {
    serverKeyVersion: "2026-07-04-primary",
    externalAppId: "example-external-program",
    originType: "communication_message",
    originRef: "envelope-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: randomUUID(),
  },
  async (encodedPayload) =>
    signBase64Ed25519WithExternalProgramServerKey(encodedPayload),
);
```

Submit the envelope through headers:

```http
x-external-program-status-claim-payload: <payload>
x-external-program-status-claim-signature: <base64-signature>
```

## Knowledge Context Claim

`knowledgeContextClaim` is required when a server-signed external program
fetches accepted Circle knowledge for room UI, server logic, or in-program
community surfaces.

Payload:

```ts
type KnowledgeContextClaimPayload = {
  claimContractVersion: "external_program.claim.v1";
  serverKeyVersion?: string;
  externalAppId: string;
  roomKey: string;
  circleId: number;
  walletPubkey?: string | null;
  requestedCapability: "knowledge_context";
  purpose: string;
  expiresAt: string;
  nonce: string;
};
```

Example:

```ts
import { randomUUID } from "node:crypto";
import { signKnowledgeContextClaim } from "@alcheme/sdk/server";

const knowledgeContextClaim = await signKnowledgeContextClaim(
  {
    serverKeyVersion: "2026-07-04-primary",
    externalAppId: "example-external-program",
    roomKey: joined.room.roomKey,
    circleId: 130,
    walletPubkey,
    purpose: "room_sidebar",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: randomUUID(),
  },
  async (encodedPayload) =>
    signBase64Ed25519WithExternalProgramServerKey(encodedPayload),
);
```

The `circleId` must match the `primaryCircleId` or `parentCircleId` used in the
runtime request. If the request includes `walletPubkey`, the claim must bind the
same wallet. The runtime also checks that the external program is allowed to use
the target Circle and that knowledge context has not been disabled by app
capability policy.

## Production Owner Assertion

Sandbox self-service registration and production registration both require an
`ownerAssertion` signed by the manifest owner wallet. The audience distinguishes
the flow:

- Sandbox: `alcheme:external-app-sandbox-registration`
- Production: `alcheme:external-app-production-registration`

```ts
import { signExternalAppOwnerAssertion } from "@alcheme/sdk/server";

const ownerAssertion = await signExternalAppOwnerAssertion(
  {
    appId: "example-external-program",
    ownerWallet: "solana:devnet:<owner-wallet-pubkey>",
    manifestHash,
    audience: "alcheme:external-app-production-registration",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    nonce: crypto.randomUUID(),
  },
  async (encodedPayload) => {
    const signatureBytes = await signMessageWithOwnerWallet(
      new TextEncoder().encode(encodedPayload),
    );
    return Buffer.from(signatureBytes).toString("base64");
  },
);
```

The signer must be the owner wallet key declared in the manifest. The runtime
verifies the owner wallet signature, app id, owner wallet, manifest hash,
audience, expiry, and nonce before opening a production registration request.

## Troubleshooting

| Error | Meaning | Fix |
| --- | --- | --- |
| `source_submission_claim_required` | Production source-material submission did not include a claim. | Build and attach `sourceSubmissionClaim` server-side. |
| `source_submission_claim_invalid` | Signature or payload encoding is invalid. | Sign the encoded payload string and return a base64 Ed25519 signature. |
| `source_submission_claim_summary_mismatch` | `summaryDigest` does not match `summaryText`. | Recompute SHA-256 over the exact submitted summary text. |
| `knowledge_context_claim_required` | Production knowledge-context request did not include a claim. | Build and attach `knowledgeContextClaim` server-side. |
| `knowledge_context_claim_mismatch` | Claim fields do not match the request. | Reuse the exact room, Circle, capability, and purpose values. |
| `private_sidecar_required` | The target runtime did not expose the required private sidecar surface. | Check `runtime-capabilities.sourceMaterialMode`; use a provisioned community-knowledge endpoint or skip SourceMaterial submission. |
| `external_app_owner_assertion_signature_invalid` | Owner assertion was not signed by the owner wallet key. | Sign with the manifest owner wallet, not the app server key. |
