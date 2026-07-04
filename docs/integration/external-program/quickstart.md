# External Program Integration Quickstart

Status: public developer quickstart for sandbox, devnet, and reviewed production
external program integrations against an Alcheme-compatible operator runtime.

## Terminology

Alcheme uses **External Program** as the product-facing umbrella term for any
third-party runtime that connects to Alcheme capabilities. An external program
can be a web app, native app, desktop app, bot, server workflow, or another
interactive runtime.

The current code and API model is still named `ExternalApp`. Treat `ExternalApp`
as the implementation object for an external program registration. Existing
package names such as `@alcheme/game-chat-react`, example paths such as
`examples/game-chat-headless`, and legacy smoke script names are compatibility
names, not the product definition.

## What You Can Integrate Today

Implemented surfaces:

- Discover runtime requirements, review policy, stable error codes, and app
  integration status through public-safe status endpoints.
- Register a sandbox external program through self-service owner proof for
  local or devnet testing.
- Resolve deterministic communication rooms for external program contexts.
- Create wallet-signed communication sessions.
- Send, list, and stream signed text messages.
- Send voice clip messages by referencing externally stored audio.
- Create or reuse voice sessions and receive provider join tokens.
- Submit selected runtime evidence as SourceMaterial candidates when the target
  runtime exposes the private sidecar surface, then read app-scoped candidate
  status.
- Fetch accepted knowledge context packages with explicit empty-state and
  app/user scope fields.
- Use optional React chat and voice controls through an adapter package.
- Open reviewed production registration requests with a manifest, owner
  assertion, and developer risk-disclaimer receipt.

Current boundaries:

- Temporary external program room state is runtime-owned, not written to chain.
- External program chat does not automatically create Plaza discussion posts,
  drafts, crystals, or contribution records.
- Production registration review is separate from sandbox registration.
- Alcheme discovery, managed-node access, and risk labels are not endorsements,
  operator responsibility, or outcome responsibility for external program
  behavior.

## Pick An Integration Mode

| Mode | Use It For | Entry |
| --- | --- | --- |
| Sandbox | Local/dev integration, early prototype, CI smoke. | `POST /api/v1/external-apps/sandbox-registrations` with owner proof. Admin token bootstrap is fallback only. |
| Reviewed production | Public exposure, official discovery, stricter CORS and room authority. | Manifest + owner assertion + developer agreement receipt + governance review request. |
| Direct external route | Continuity through an app-operated route outside Alcheme managed nodes. | Route declaration/read projection; not a public Alcheme-certified node network. |

For most external programs, start with sandbox mode, verify communication and
voice behavior, then move to reviewed production registration.

## Install SDK Packages

Headless integration:

```bash
npm install @alcheme/sdk@devnet
```

Optional React UI adapter:

```bash
npm install @alcheme/game-chat-react@devnet
```

If the needed devnet package has not been published yet, test with a local
tarball instead of importing source files directly:

```bash
cd /path/to/alcheme-protocol/sdk
npm run build
npm pack --pack-destination /tmp
cd /path/to/external-program
npm install /tmp/alcheme-sdk-<version>.tgz
```

Source aliases are acceptable for Alcheme co-development, but external programs
should prefer a packed or published package because it exercises the same export
map as npm consumers.

Browser code should import runtime surfaces only:

```ts
import { createAlchemeGameChatClient } from "@alcheme/sdk/runtime/communication";
import { createAlchemeVoiceClient } from "@alcheme/sdk/runtime/voice";
import { fetchKnowledgeContextPackage } from "@alcheme/sdk/runtime/knowledge-context";
import { submitExternalProgramSourceMaterial } from "@alcheme/sdk/runtime/source-materials";
```

Server code should import server-only helpers:

```ts
import type { ExternalAppManifestInput } from "@alcheme/sdk/server";
import {
  computeExternalAppManifestHash,
  computeSandboxExternalAppManifestHash,
  computeExternalAppRiskDisclaimerAcceptanceDigest,
  encodeExternalAppServerPayload,
  signAppRoomClaim,
  signKnowledgeContextClaim,
  signExternalAppOwnerAssertion,
  signSourceMaterialStatusClaim,
  signSourceSubmissionClaim,
} from "@alcheme/sdk/server";
```

Protocol transaction helpers are exposed separately:

```ts
import {
  buildAnchorExternalAppRegistrationInstruction,
  buildRecordRiskDisclaimerAcceptanceInstruction,
} from "@alcheme/sdk/protocol";
```

Do not put server private keys, program authority keys, admin tokens, or settlement
authority keys in browser code.

## Runtime Endpoint

The public baseline does not include the first-party managed runtime, operator
indexer/query implementations, or local stack scripts. For integration testing,
point the SDK at an official Alcheme-compatible runtime endpoint or at a runtime
supplied by the Alcheme team. Private-tree maintainers can run the internal
local stack, but that operator workflow is outside this public baseline.

Before implementation, obtain these values from the operator or developer
portal:

| Value | Used For | Notes |
| --- | --- | --- |
| Runtime API base URL | SDK `apiBaseUrl` | Must include the `/api/v1` prefix expected by runtime clients. |
| App id | `externalAppId`, manifest, room claims | Stable across sandbox and production unless the operator issues a new registration. |
| Allowed origins | Browser CORS and manifest review | Must include the external program web origins used by real clients. |
| Server Ed25519 public key | `appRoomClaim` verification | The matching private key stays on the external program server. |
| Owner wallet pubkey | manifest, owner assertion, review | Must be a valid base58 Solana public key. |
| Chain cluster and program ids | protocol transactions and receipts | Do not reuse localnet ids for devnet or mainnet. |
| Runtime capabilities | claim TTLs, sidecar mode, voice mode | Read `GET /api/v1/external-apps/runtime-capabilities`; do not infer from docs alone. |
| Active review policy version id | `developerAgreement.policyEpochId` | Read `GET /api/v1/external-apps/review-policy/current`; do not invent this client-side. |
| Stable error contract | UI copy and remediation | Read `GET /api/v1/external-apps/error-contract`. |
| Voice provider policy | Live voice behavior | Voice may be disabled, token-only, or backed by a provider such as LiveKit. |
| Source-material sidecar access | `POST /external-apps/:appId/source-materials` | Required only for community knowledge continuity; unavailable runtimes return `private_sidecar_required`. |

An external program can build the client and server integration without the
private runtime source. Routine sandbox field discovery should come from the
runtime endpoints above and the self-service registration route below.
Production review, emergency actions, and fallback bootstrap remain operator
or governance responsibilities.

## Sandbox Registration

Sandbox registration creates an `ExternalApp` runtime record so room claim
verification and CORS policy can recognize the external program. The normal
path is self-service owner proof:

```ts
import {
  computeSandboxExternalAppManifestHash,
  signExternalAppOwnerAssertion,
} from "@alcheme/sdk/server";

const manifest = {
  version: "1",
  appId: "example-external-program",
  name: "Example External Program",
  homeUrl: "http://localhost:5173",
  ownerWallet: "solana:devnet:<owner-wallet-pubkey>",
  serverPublicKey: "<ed25519-server-public-key>",
  allowedOrigins: ["http://localhost:5173"],
  capabilities: ["communication.rooms"],
};

const manifestHash = computeSandboxExternalAppManifestHash(manifest);
const ownerAssertion = await signExternalAppOwnerAssertion(
  {
    appId: manifest.appId,
    ownerWallet: manifest.ownerWallet,
    manifestHash,
    audience: "alcheme:external-app-sandbox-registration",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    nonce: crypto.randomUUID(),
  },
  signWithOwnerWalletAsBase64Ed25519,
);

await fetch(`${apiBaseUrl}/external-apps/sandbox-registrations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ manifest, ownerAssertion }),
});
```

`owner-wallet-pubkey` and `ed25519-server-public-key` must be valid base58
Solana public keys. Sandbox mode does not accept arbitrary labels. Remote
non-local HTTP origins are rejected; production manifests must use HTTPS.

The admin route exists only for local/operator fallback:

```http
POST /api/v1/external-apps
x-external-app-admin-token: <EXTERNAL_APP_ADMIN_TOKEN>
Content-Type: application/json
```

Example bootstrap body:

```json
{
  "id": "example-external-program",
  "name": "Example External Program",
  "ownerPubkey": "<owner-wallet-pubkey>",
  "allowedOrigins": ["https://example.test"],
  "serverPublicKey": "<ed25519-server-public-key>",
  "claimAuthMode": "server_ed25519",
  "status": "active"
}
```

`EXTERNAL_APP_ADMIN_TOKEN` is a local/operator bootstrap token. It is not a
production approval mechanism, not the normal sandbox onboarding path, and must
not be shipped to users.

Demo or hosted environments should set bootstrap tokens through deployment
secrets and should not expose them to external program clients.

## Server-Signed Room Claim

Production-grade external program rooms require a server-signed `appRoomClaim`.
The external program server owns the signing key; the browser only receives the
short-lived claim.

```ts
import { signAppRoomClaim } from "@alcheme/sdk/server";

async function createRoomClaim(input: {
  walletPubkey: string;
  roomId: string;
}) {
  return signAppRoomClaim(
    {
      externalAppId: "example-external-program",
      roomType: "custom",
      externalRoomId: input.roomId,
      walletPubkeys: [input.walletPubkey],
      roles: { [input.walletPubkey]: "member" },
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      nonce: crypto.randomUUID(),
    },
    async (encodedPayload) => {
      return signBase64Ed25519WithYourServerKey(encodedPayload);
    },
  );
}
```

The signer must return a base64 Ed25519 signature over the encoded payload
string. The server public key must match the registered `ExternalApp`
`serverPublicKey`.

The same server key model is used for `sourceSubmissionClaim`,
`sourceMaterialStatusClaim`, and `knowledgeContextClaim`. See
[Server-Signed Claims](./server-signed-claims.md) for the exact payload fields
and signing examples. For non-sandbox server-signed claims, provide the accepted
`serverKeyVersion`. Production runtime readiness also depends on
`runtime-capabilities.serverKeyLifecycle.productionStable` and the app's
`integration-status`; if production-stable key lifecycle is false, review can
activate the app record while runtime claim acceptance remains blocked until key
lifecycle activation is complete.

## Browser Runtime Flow

The browser joins through the runtime client. `createAlchemeGameChatClient` is
the current SDK export name for the generic communication client.

```ts
import { createAlchemeGameChatClient } from "@alcheme/sdk/runtime/communication";
import { createAlchemeVoiceClient } from "@alcheme/sdk/runtime/voice";

const chat = createAlchemeGameChatClient({
  apiBaseUrl: "http://localhost:4000/api/v1",
  wallet,
});

const voice = createAlchemeVoiceClient({
  apiBaseUrl: "http://localhost:4000/api/v1",
  wallet,
  providerClient: liveKitOrHostVoiceAdapter,
});

const appRoomClaim = await fetch("/api/alcheme-room-claim", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    walletPubkey: wallet.publicKey,
    roomId: "room-001",
  }),
}).then((response) => response.json());

const joined = await chat.joinExternalRoom({
  externalAppId: "example-external-program",
  roomType: "custom",
  externalRoomId: "room-001",
  parentCircleId: 130,
  appRoomClaim,
  sessionTtlSec: 7200,
});

await chat.sendRoomMessage(joined.room.roomKey, {
  text: "hello from an external program",
});

voice.setCommunicationSession(
  joined.room.roomKey,
  joined.communicationAccessToken,
);

const connection = await voice.joinVoice(joined.room.roomKey);
```

The SDK calls the operator runtime in the required order:

1. Resolve or create the deterministic external program room.
2. Sync the member from the signed `appRoomClaim`.
3. Create a wallet-signed communication session.
4. Use the room-scoped communication token for messages and voice.

## Community Knowledge Continuity

External program runtime chat and voice stay in `communication_messages`.
Reusable knowledge moves into a Circle only through `SourceMaterial` review.
This flow is optional and requires operator-enabled community knowledge
continuity. Source-material submission additionally requires the operator to
expose the `source_materials` private sidecar surface for the target runtime.

The normal sequence is:

1. Register the external program.
2. Accept the developer risk disclaimer for the relevant scope.
3. Bind a primary Circle or attached Circle through sandbox bootstrap or
   governance review.
4. Resolve runtime rooms with `parentCircleId` so the operator runtime can
   enforce the active binding.
5. Submit selected runtime evidence as a source material candidate.
6. Accept the candidate into Plaza through Circle policy or governance review.
7. Fetch a knowledge context package for room UI, server logic, or in-program
   community surfaces.

The claim endpoints in the examples below, such as
`/api/alcheme-source-submission-claim`, are external-program server routes. They
are not Alcheme runtime routes. Implement them with the payload rules in
[Server-Signed Claims](./server-signed-claims.md), then pass the returned claim
envelope into the SDK runtime request.

Submitting a source material candidate:

```ts
const summaryText =
  "Players agreed the frost boss needs a resistance strategy.";

const sourceRequest = {
  roomKey: joined.room.roomKey,
  originType: "communication_message",
  originRef: "envelope-1",
  targetCircleId: 130,
  summaryText,
  evidencePrivacyClass: "circle_only",
  requestedLifecycleStatus: "submitted",
  submittedByPubkey: wallet.publicKey,
};

const sourceSubmissionClaim = await fetch(
  "/api/alcheme-source-submission-claim",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: "example-external-program",
      ...sourceRequest,
    }),
  },
).then((response) => response.json());

await submitExternalProgramSourceMaterial({
  apiBaseUrl: "http://localhost:4000/api/v1",
  appId: "example-external-program",
  request: {
    ...sourceRequest,
    sourceSubmissionClaim,
  },
});
```

Check candidate status with either the source material id or the exact origin
tuple. Server-signed apps attach a `sourceMaterialStatusClaim`; wallet-only
sandbox reads can omit it. Status responses are app-scoped and do not expose
the raw claim digest:

```http
GET /api/v1/external-apps/:appId/source-materials/:sourceMaterialId/status
GET /api/v1/external-apps/:appId/source-materials/status?originType=communication_message&originRef=envelope-1
```

The response includes `status.lifecycleStatus`, `status.statusGroup`,
`status.canAppearInKnowledgeContext`, `status.claimDigestRecorded`, and
`status.scope`. The scope is explicitly app-scoped and not user-scoped.

Fetching accepted knowledge context:

```ts
const knowledgeCircleId = 130;
const knowledgeContextRequest = {
  appId: "example-external-program",
  roomKey: joined.room.roomKey,
  walletPubkey: wallet.publicKey,
  parentCircleId: knowledgeCircleId,
  requestedCapability: "knowledge_context",
  purpose: "room_sidebar",
};

const knowledgeContextClaim = await fetch(
  "/api/alcheme-knowledge-context-claim",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: knowledgeContextRequest.appId,
      roomKey: knowledgeContextRequest.roomKey,
      circleId: knowledgeCircleId,
      walletPubkey: knowledgeContextRequest.walletPubkey,
      requestedCapability: knowledgeContextRequest.requestedCapability,
      purpose: knowledgeContextRequest.purpose,
    }),
  },
).then((response) => response.json());

const context = await fetchKnowledgeContextPackage({
  apiBaseUrl: "http://localhost:4000/api/v1",
  request: {
    ...knowledgeContextRequest,
    knowledgeContextClaim,
  },
});
```

The package returns references, summaries, permissions, cache metadata, and the
non-endorsement boundary. It does not return sealed evidence, private locators,
raw room history, unpublished drafts, or automatic crystals.

If the app and Circle binding are valid but no accepted content is available,
the package returns `items: []` with `emptyReason:
"no_accepted_source_material"`. If accepted rows exist but none are available
to external apps because of audience/provenance policy, the response uses
`emptyReason: "no_external_app_visible_source_material"`. The response `scope`
also distinguishes app-level context from user-scoped context through
`scope.appScoped` and `scope.userScoped`.

If the source-material route returns `private_sidecar_required`, the target
operator endpoint has not exposed the `source_materials` sidecar surface. The
external program cannot enable that from client code.

## Voice And Voice Clips

Live voice uses the configured provider adapter. The operator runtime is the
control plane; LiveKit or another provider is the media plane.

If you operate an Alcheme-compatible runtime, the voice provider is configured
server-side. A LiveKit-backed runtime typically needs values like:

```bash
VOICE_PROVIDER=livekit
VOICE_PUBLIC_URL=ws://localhost:7880
LIVEKIT_SERVER_URL=http://localhost:7880
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

`VOICE_REQUIRE_PROVIDER_HEALTH=false` allows the operator runtime to create
sessions and issue provider tokens even when the media provider health check is
unhealthy. That is useful for control-plane smoke tests, but it does not prove
microphone audio is flowing. For real audio testing, set
`VOICE_REQUIRE_PROVIDER_HEALTH=true` and confirm:

```http
GET /api/v1/voice/health
```

returns `healthy: true` before treating the voice UI as a real LiveKit call.

Speaker limits are policy-driven:

```bash
VOICE_PLATFORM_MAX_SPEAKERS_PER_SESSION=100
VOICE_DEFAULT_MAX_SPEAKERS_PER_SESSION=16
VOICE_SPEAKER_LIMIT_STRATEGY=listen_only
```

External program rooms can pass a signed `voicePolicy` inside `appRoomClaim`.
Unsigned browser metadata is ignored for external program room authority.

Voice clips are message records that reference externally stored audio:

```ts
await chat.sendRoomVoiceClip(joined.room.roomKey, {
  storageUri: "https://cdn.example.test/clips/clip-1.webm",
  durationMs: 4200,
  fileSizeBytes: 8192,
  payloadText: "optional caption",
});
```

The operator runtime stores the URI, duration, file size, optional text, and
payload hash. It does not store raw audio bytes.

## Minimal Browser LiveKit Adapter

The SDK voice client receives a provider adapter. For a browser LiveKit
integration, install `livekit-client` in the external program:

```bash
npm install livekit-client
```

Then adapt the provider token issued by the operator runtime:

```ts
import { Room } from "livekit-client";
import type {
  VoiceProviderClient,
  VoiceProviderConnection,
} from "@alcheme/sdk/runtime/voice";

export const liveKitProviderClient: VoiceProviderClient = {
  async join(input): Promise<VoiceProviderConnection> {
    if (input.provider !== "livekit") {
      throw new Error(`unsupported voice provider: ${input.provider}`);
    }

    const room = new Room();
    await room.connect(input.url, input.token);

    if (input.canPublishAudio) {
      await room.localParticipant.setMicrophoneEnabled(true);
    }

    return {
      async leave() {
        await room.disconnect();
      },
      async setMicrophoneMuted(muted: boolean) {
        if (!input.canPublishAudio) return;
        await room.localParticipant.setMicrophoneEnabled(!muted);
      },
      getParticipants() {
        const participants: Array<{
          walletPubkey: string;
          speaking?: boolean;
          muted?: boolean;
          mutedBySelf?: boolean;
        }> = [
          {
            walletPubkey: room.localParticipant.identity,
            speaking: room.localParticipant.isSpeaking,
            mutedBySelf: !room.localParticipant.isMicrophoneEnabled,
          },
        ];

        for (const participant of room.remoteParticipants.values()) {
          const audioPublications = Array.from(
            participant.audioTrackPublications.values(),
          );
          participants.push({
            walletPubkey: participant.identity,
            speaking: participant.isSpeaking,
            muted:
              audioPublications.length > 0 &&
              audioPublications.every((publication) => publication.isMuted),
          });
        }

        return participants;
      },
    };
  },
};
```

This adapter proves browser media only when LiveKit is reachable and
`VOICE_REQUIRE_PROVIDER_HEALTH=true` is enforced in the environment under test.

## Optional React UI

`@alcheme/game-chat-react` contains optional UI components:

- `ChatPanel`
- `VoiceControls`

The package is adapter-based. It does not own wallet signing, room claims,
provider setup, or Alcheme product state. The external program supplies adapters
that wrap the SDK runtime clients.

## Reviewed Production Registration

Production registration is not the sandbox admin route. It requires:

- a normalized manifest
- an owner assertion
- a scoped developer agreement shown to the developer
- an on-chain risk-disclaimer receipt through the ExternalApp Economics program
- a production registration request opened for the recognized review circle

Manifest hash:

```ts
const manifest: ExternalAppManifestInput = {
  version: "1",
  appId: "example-external-program",
  name: "Example External Program",
  homeUrl: "https://example.test",
  ownerWallet: "solana:devnet:<owner-wallet-pubkey>",
  serverPublicKey: "<ed25519-server-public-key>",
  allowedOrigins: ["https://example.test"],
  platforms: {
    redirectUris: ["https://example.test/alcheme/callback"],
  },
  capabilities: ["communication.rooms", "voice.sessions"],
  callbacks: {
    serverCallbacks: ["https://example.test/api/alcheme/callback"],
  },
  policy: {
    approvedRedirectHosts: ["example.test"],
  },
};

const manifestHash = computeExternalAppManifestHash(manifest);
```

Owner assertion:

```ts
const ownerAssertion = await signExternalAppOwnerAssertion(
  {
    appId: manifest.appId,
    ownerWallet: manifest.ownerWallet,
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

The owner assertion signer must be the manifest owner wallet. Do not sign this
claim with the external program server key unless that server key is also the
owner wallet key under an explicit operator-approved custody model.

Fetch the developer terms:

```http
GET /api/v1/external-apps/risk-disclaimers/developer_registration
```

Before computing the acceptance digest, call the review policy endpoint and use
its active External Program review policy version id. This value becomes
`policyEpochId` and must match the production review role binding used by the
operator runtime. Do not invent this value in an external program client.

```http
GET /api/v1/external-apps/review-policy/current
```

Compute the acceptance digest with `bindingDigest = manifestHash`, record the
acceptance on chain through `ExternalAppEconomics`, then submit the receipt
evidence:

```ts
const acceptanceDigest = computeExternalAppRiskDisclaimerAcceptanceDigest({
  externalAppId: manifest.appId,
  actorPubkey: "<owner-wallet-pubkey>",
  scope: "developer_registration",
  policyEpochId: "<review-policy-version-id>",
  disclaimerVersion: "<terms version>",
  termsDigest: "sha256:<terms digest>",
  bindingDigest: manifestHash,
});
```

```http
POST /api/v1/external-apps/:appId/risk-disclaimer-acceptances
```

The acceptance body includes:

```json
{
  "actorPubkey": "<owner-wallet-pubkey>",
  "scope": "developer_registration",
  "policyEpochId": "<review-policy-version-id>",
  "disclaimerVersion": "<terms version>",
  "termsDigest": "sha256:<terms digest>",
  "acceptanceDigest": "sha256:<acceptance digest>",
  "bindingDigest": "sha256:<manifest hash>",
  "chainReceiptPda": "<receipt PDA>",
  "chainReceiptDigest": "sha256:<account-data digest>",
  "txSignature": "<solana signature>"
}
```

Then open the production review request:

```http
POST /api/v1/external-apps/:appId/production-registration-requests
```

Request body:

```json
{
  "manifest": {
    "version": "1",
    "appId": "example-external-program",
    "name": "Example External Program",
    "homeUrl": "https://example.test",
    "ownerWallet": "solana:devnet:<owner-wallet-pubkey>",
    "serverPublicKey": "<ed25519-server-public-key>",
    "allowedOrigins": ["https://example.test"],
    "platforms": {
      "redirectUris": ["https://example.test/alcheme/callback"]
    },
    "capabilities": ["communication.rooms", "voice.sessions"],
    "callbacks": {
      "serverCallbacks": ["https://example.test/api/alcheme/callback"]
    },
    "policy": {
      "approvedRedirectHosts": ["example.test"]
    }
  },
  "ownerAssertion": {
    "payload": "<base64url owner assertion payload>",
    "signature": "<base64 owner wallet signature>"
  },
  "reviewPolicyVersionId": "<review-policy-version-id>",
  "developerAgreement": {
    "disclaimerVersion": "<terms version>",
    "termsDigest": "sha256:<terms digest>",
    "acceptanceDigest": "sha256:<acceptance digest>",
    "signatureDigest": "sha256:<optional wallet signature digest>",
    "chainReceiptPda": "<receipt PDA>",
    "chainReceiptDigest": "<64 hex account-data digest>",
    "txSignature": "<solana signature>"
  }
}
```

The operator may also require `reviewCircleId`, `reviewPolicyId`,
`reviewPolicyVersion`, or `reviewRoleKey` when multiple production review
bindings exist. Use values returned by `review-policy/current` or the developer
portal for that runtime; do not invent them client-side.

The operator runtime verifies the manifest hash, owner wallet signature, active
review binding, developer agreement digest, receipt PDA, account owner, account
contents, receipt digest, and transaction status when risk receipt verification
is enabled.

## Public Baseline Verification

The public baseline can verify the public SDK, protocol, and optional React UI
package. From the exported public repository, use:

```bash
npm run test:sdk
npm run typecheck:game-chat-react
npm run build:sdk
```

Those checks do not prove that a specific operator runtime endpoint is healthy.
For runtime verification against an operator endpoint, run this integration
checklist:

1. Confirm the operator supplied a runtime API base URL with `/api/v1`.
2. Fetch runtime capabilities, review policy, and error contract:

```http
GET /api/v1/external-apps/runtime-capabilities
GET /api/v1/external-apps/review-policy/current
GET /api/v1/external-apps/error-contract
```

3. Fetch the scoped developer terms:

```http
GET /api/v1/external-apps/risk-disclaimers/developer_registration
```

4. Register a sandbox `ExternalApp` through `/external-apps/sandbox-registrations`.
5. Check `GET /api/v1/external-apps/:appId/integration-status`.
6. Generate an `appRoomClaim` on the external program server.
7. Call `joinExternalRoom` from a browser client with a real wallet signer.
8. Send, list, and stream a signed text message.
9. If voice is enabled, request a voice token and join through the configured
   provider adapter.
10. If knowledge continuity is enabled, submit selected evidence as source
   material and fetch a knowledge context package after Circle review accepts it.

Private-tree smoke commands such as `smoke:external-game-local` and
`smoke:external-app-registry-v2` are operator/runtime validation tools. They are
not part of the public baseline command surface.

## Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| Browser request is blocked before reaching the API | Origin is not registered or allowed by operator CORS policy | Add the real origin to the sandbox or reviewed production registration. |
| `external_app_not_found` | `externalAppId` is not registered on that runtime | Use the operator-issued app id or complete sandbox registration first. |
| Room join fails with claim or signature errors | `appRoomClaim` was signed with the wrong key, expired, wrong room id, or missing wallet | Regenerate the claim server-side with the registered Ed25519 key and the exact wallet/room tuple. |
| Messages fail after room join | Communication session token was not stored or passed to the SDK method | Use `joinExternalRoom` and reuse the returned `communicationAccessToken`. |
| Voice token succeeds but microphone audio does not work | Provider adapter or provider health is not actually connected | Check the operator voice policy and verify the injected provider client with the real provider. |
| Source material submission returns `private_sidecar_required` | The target runtime did not expose the `source_materials` private sidecar surface | Check `runtime-capabilities.sourceMaterialMode`; use a provisioned community-knowledge endpoint or skip SourceMaterial submission. |
| Source material submission returns claim mismatch | The signed payload does not match the submitted room, origin, Circle, summary, privacy, or submitter | Regenerate `sourceSubmissionClaim` from the exact request values. |
| Knowledge context returns claim mismatch | `knowledgeContextClaim` does not match the room, Circle, wallet, capability, or purpose | Regenerate the claim with the same `parentCircleId` or `primaryCircleId` used by the request. |
| Production registration rejects `policyEpochId` | The value was guessed or stale | Re-read `GET /api/v1/external-apps/review-policy/current` and rebuild the developer agreement receipt with the current policy version id. |
| Production registration rejects owner assertion | The owner assertion was signed by the wrong key, expired, or bound to a different manifest hash | Sign the assertion with the manifest owner wallet and the exact manifest hash submitted. |
| Receipt digest mismatch | Manifest, terms, policy epoch, or account digest changed between signing and submission | Recompute the manifest hash and acceptance digest from the exact values submitted. |
| Discovery does not list the app after review request creation | Production review request is pending, rejected, or not executed | Wait for governance execution; request creation alone does not activate discovery. |

## Production Safety Checklist

Before exposing an external program through Alcheme official discovery or
managed-node paths:

- Do not use `wallet_only_dev`.
- Do not use the sandbox admin route as production approval.
- Keep server signing keys off the browser.
- Verify the manifest hash matches the reviewed manifest.
- Verify allowed origins, redirect URIs, callback hosts, and server public key.
- Require developer agreement receipt evidence for production registration.
- Keep app-store delisting separate from service shutdown.
- Treat bond disposition as rule execution, not platform coverage or platform
  responsibility.
- Make risk disclaimers visible before users enter scoped risky actions.
- Run public SDK checks and the operator-provided runtime smoke or integration
  checklist for the changed surface.

## More Detail

- [External Program Communication And Voice Integration](./communication-and-voice.md)
- [External Program Server-Signed Claims](./server-signed-claims.md)
- [External Program Entrypoint Index](./entrypoints.md)
- [External Program And Compatible Runtime Access Architecture](./runtime-access-architecture.md)
- [External Program Stability Model](./stability-model.md)
- [SDK README](../../../sdk/README.md)
- [Headless communication example](../../../examples/game-chat-headless/README.md)
- [Optional React UI adapter](../../../packages/game-chat-react/README.md)
