# External Program Server-Signed Claims

Status: public signing contract for production-grade external program
integrations.

External programs use short-lived signed claims to bind runtime requests to the
registered app, room, Circle, user, and review context. The browser should never
hold an external program server private key, an admin token, or a production
program authority key.

## Signing Model

Most runtime claims are signed by the external program server Ed25519 key whose
public key is registered on the `ExternalApp` record:

- `appRoomClaim`
- `sourceSubmissionClaim`
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

Use the SDK encoder from server-side code when building custom claims:

```ts
import { encodeExternalAppServerPayload } from "@alcheme/sdk/server";

async function signServerClaim(payload: unknown) {
  const encodedPayload = encodeExternalAppServerPayload(payload);
  return {
    payload: encodedPayload,
    signature: await signBase64Ed25519WithExternalProgramServerKey(encodedPayload),
  };
}
```

`signBase64Ed25519WithExternalProgramServerKey` is intentionally app-specific:
implement it with your server key manager, HSM, KMS, or deployment secret store.
It must return base64, not hex.

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

- is signed by the registered `serverPublicKey`
- has not expired
- matches the external program id and room tuple
- includes the joining wallet

## Source Submission Claim

`sourceSubmissionClaim` is required when a production-grade external program
submits selected communication or voice evidence as a `SourceMaterial` candidate.

The source-material route is not a generic public read/write route. It is
available only when the operator exposes the `source_materials` private sidecar
surface for the target runtime. If the operator has not enabled that surface,
the route returns `private_sidecar_required`.

Payload:

```ts
type SourceSubmissionClaimPayload = {
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
import { createHash, randomUUID } from "node:crypto";

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const summaryText =
  "Players agreed the frost boss needs a resistance strategy.";

const sourceSubmissionClaim = await signServerClaim({
  externalAppId: "example-external-program",
  roomKey: joined.room.roomKey,
  originType: "communication_message",
  originRef: "envelope-1",
  targetCircleId: 130,
  summaryDigest: sha256Hex(summaryText),
  evidencePrivacyClass: "circle_only",
  requestedLifecycleStatus: "submitted",
  submittedByPubkey: walletPubkey,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  nonce: randomUUID(),
});
```

The submitted request must use the same `roomKey`, `originType`, `originRef`,
`targetCircleId`, `summaryText`, privacy class, lifecycle status, and submitter
that the claim binds. `summaryDigest` is the SHA-256 hex digest of the exact
`summaryText` string.

## Knowledge Context Claim

`knowledgeContextClaim` is required when a production-grade external program
fetches accepted Circle knowledge for room UI, server logic, or in-program
community surfaces.

Payload:

```ts
type KnowledgeContextClaimPayload = {
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

const knowledgeContextClaim = await signServerClaim({
  externalAppId: "example-external-program",
  roomKey: joined.room.roomKey,
  circleId: 130,
  walletPubkey,
  requestedCapability: "knowledge_context",
  purpose: "room_sidebar",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  nonce: randomUUID(),
});
```

The `circleId` must match the `primaryCircleId` or `parentCircleId` used in the
runtime request. If the request includes `walletPubkey`, the claim must bind the
same wallet. The runtime also checks that the external program is allowed to use
the target Circle and that knowledge context has not been disabled by app
capability policy.

## Production Owner Assertion

Production registration requires an `ownerAssertion` signed by the manifest
owner wallet.

```ts
import { signExternalAppOwnerAssertion } from "@alcheme/sdk/server";

const ownerAssertion = await signExternalAppOwnerAssertion(
  {
    appId: "example-external-program",
    ownerWallet: "solana:devnet:<owner-wallet-pubkey>",
    manifestHash,
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
| `private_sidecar_required` | The operator did not expose the required private sidecar surface. | Ask the operator whether `source_materials` is enabled for this endpoint. |
| `external_app_owner_assertion_signature_invalid` | Owner assertion was not signed by the owner wallet key. | Sign with the manifest owner wallet, not the app server key. |
