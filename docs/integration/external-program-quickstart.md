# External Program Integration Quickstart

Status: developer quickstart for local, devnet, and reviewed production
external program integrations.

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

- Register a sandbox external program for local or devnet testing.
- Resolve deterministic communication rooms for external program contexts.
- Create wallet-signed communication sessions.
- Send, list, and stream signed text messages.
- Send voice clip messages by referencing externally stored audio.
- Create or reuse voice sessions and receive provider join tokens.
- Use optional React chat and voice controls through an adapter package.
- Open reviewed production registration requests with a manifest, owner
  assertion, and developer risk-disclaimer receipt.

Current boundaries:

- Temporary external program room state is runtime-owned, not written to chain.
- External program chat does not automatically create Plaza discussion posts,
  drafts, crystals, or contribution records.
- Production registration review is separate from sandbox registration.
- Alcheme discovery, managed-node access, and risk labels are not endorsements,
  insurance, compensation promises, or guarantees.

## Pick An Integration Mode

| Mode | Use It For | Entry |
| --- | --- | --- |
| Sandbox | Local/dev integration, early prototype, CI smoke. | Seed script or `POST /api/v1/external-apps` with `EXTERNAL_APP_ADMIN_TOKEN`. |
| Reviewed production | Public exposure, official discovery, stricter CORS and room authority. | Manifest + owner assertion + developer agreement receipt + governance review request. |
| Direct external route | Continuity through an app-operated route outside Alcheme managed nodes. | Route declaration/read projection; not a public Alcheme-certified node network. |

For most external programs, start with sandbox mode, verify communication and
voice behavior, then move to reviewed production registration.

## Install SDK Packages

Headless integration:

```bash
npm install @alcheme/sdk
```

Optional React UI adapter:

```bash
npm install @alcheme/game-chat-react
```

Browser code should import runtime surfaces only:

```ts
import { createAlchemeGameChatClient } from "@alcheme/sdk/runtime/communication";
import { createAlchemeVoiceClient } from "@alcheme/sdk/runtime/voice";
```

Server code should import server-only helpers:

```ts
import {
  computeExternalAppManifestHash,
  computeExternalAppRiskDisclaimerAcceptanceDigest,
  signAppRoomClaim,
  signExternalAppOwnerAssertion,
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

## Local Stack

From the repository root:

```bash
bash scripts/start-local-stack.sh
```

The local stack is a developer topology. It is useful for integration testing,
but it is not proof of production topology or production custody policy.

If the stack is already running and only program deployment/config has changed:

```bash
bash scripts/deploy-local-optimized.sh
```

## Sandbox Registration

Sandbox registration creates a local `ExternalApp` row so room claim verification
and CORS policy can recognize the external program.

Wallet-only development mode is simplest:

```bash
cd services/query-api
npm run seed:external-app -- \
  --id example-external-program \
  --name "Example External Program" \
  --owner-pubkey <owner-wallet> \
  --origin http://localhost:5173 \
  --wallet-only-dev
```

Server-signed mode is closer to production:

```bash
cd services/query-api
npm run seed:external-app -- \
  --id example-external-program \
  --name "Example External Program" \
  --owner-pubkey <owner-wallet> \
  --origin http://localhost:5173 \
  --server-public-key <ed25519-server-public-key>
```

The matching admin route exists for sandbox or operator bootstrap:

```http
POST /api/v1/external-apps
x-external-app-admin-token: <EXTERNAL_APP_ADMIN_TOKEN>
```

`EXTERNAL_APP_ADMIN_TOKEN` is a local/operator bootstrap token. It is not a
production approval mechanism and must not be shipped to users.

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

The SDK calls the Query API in the required order:

1. Resolve or create the deterministic external program room.
2. Sync the member from the signed `appRoomClaim`.
3. Create a wallet-signed communication session.
4. Use the room-scoped communication token for messages and voice.

## Voice And Voice Clips

Live voice uses the configured provider adapter. Alcheme Query API is the
control plane; LiveKit or another provider is the media plane.

Minimum local voice environment:

```bash
VOICE_PROVIDER=livekit
VOICE_PUBLIC_URL=ws://localhost:7880
LIVEKIT_SERVER_URL=http://localhost:7880
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

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

Query API stores the URI, duration, file size, optional text, and payload hash.
It does not store raw audio bytes.

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
const manifestHash = computeExternalAppManifestHash({
  version: "1",
  appId: "example-external-program",
  name: "Example External Program",
  homeUrl: "https://example.test",
  ownerWallet: "solana:<owner-wallet>",
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
});
```

Fetch the developer terms:

```http
GET /api/v1/external-apps/risk-disclaimers/developer_registration
```

Before computing the acceptance digest, obtain the active External Program
review policy version id. This value becomes `policyEpochId` and must match the
production review role binding used by Query API. Do not invent this value in an
external program client.

Local operators can inspect the active binding with:

```bash
./services/query-api/node_modules/.bin/tsx scripts/inspect-external-app-governance-role-binding.ts
```

For hosted/demo environments, expose this value through the developer portal or
operator onboarding material before asking the developer to sign the agreement.

Compute the acceptance digest with `bindingDigest = manifestHash`, record the
acceptance on chain through `ExternalAppEconomics`, then submit the receipt
evidence:

```http
POST /api/v1/external-apps/:appId/risk-disclaimer-acceptances
```

The acceptance body includes:

```json
{
  "actorPubkey": "<owner-wallet>",
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

The request includes the manifest, owner assertion, and `developerAgreement`
evidence. Query API verifies the receipt PDA, account owner, account contents,
receipt digest, and transaction status when risk receipt verification is enabled.

## Local Verification

General consistency:

```bash
npm run check:covenant
```

Legacy local communication smoke script:

```bash
npm run smoke:external-game-local
```

The script name is historical. It verifies the external program communication
path.

V2 registry smoke:

```bash
npm run smoke:external-app-registry-v2
```

V3 smoke scripts are direct Node entrypoints:

```bash
node scripts/smoke/external-app-v3a-projection-smoke.mjs
node scripts/smoke/external-app-v3b-economics-smoke.mjs
node scripts/smoke/external-app-v3b-settlement-asset-smoke.mjs
node scripts/smoke/external-app-v3c-bond-disposition-smoke.mjs
node scripts/smoke/external-app-v3d-governance-smoke.mjs
```

Write smokes default to read-only or skipped chain submission unless an explicit
execute flag is set. Use write smokes only against local or devnet test
environments.

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
- Treat bond disposition as rule execution, not compensation or insurance.
- Make risk disclaimers visible before users enter scoped risky actions.
- Run local smoke and targeted Query API / SDK tests for the changed surface.

## More Detail

- [External Program Communication And Voice Integration](../game-chat-integration.md)
- [External Program V3 Entrypoint Index](../architecture/external-app-v3-entrypoint-index.md)
- [External Program And Compatible Node Access Product Architecture](../architecture/external-app-node-access-product-architecture.md)
- [External Program V3 Stability Model](../architecture/external-app-registry-v3-stability-model.md)
- [SDK README](../../sdk/README.md)
- [Headless communication example](../../examples/game-chat-headless/README.md)
- [Optional React UI adapter](../../packages/game-chat-react/README.md)
