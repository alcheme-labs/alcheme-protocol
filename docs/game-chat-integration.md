# External Program Communication And Voice Integration

This document describes the current headless external program integration path
for Alcheme communication rooms and voice sessions. It is intentionally separate
from Plaza discussion, draft, semantic, and crystallization flows.

Product terminology: **External Program** is the user-facing umbrella term. The
implementation object is still named `ExternalApp`, and legacy SDK/package names
may still contain `game-chat` for compatibility.

## Current Scope

Implemented:

- Resolve communication rooms for circles, direct rooms, and external program
  rooms.
- Create wallet-signed communication sessions.
- Send, list, and stream signed text messages.
- Send voice clip messages by referencing externally stored audio.
- Create voice sessions and issue provider join tokens.
- Use LiveKit through a provider adapter when voice is enabled.
- Run opt-in voice transcription/recap services behind `transcriptionMode`.
- Keep temporary rooms off chain.

Not implemented in this slice:

- React UI kit.
- Browser/provider transcription capture UI.
- Auto draft creation from external program chat or voice.
- Auto crystallization from external program chat or voice.
- On-chain temporary room or voice state.

## Runtime Roles

Alcheme/query-api is the control plane:

- verifies wallet signatures
- verifies external program room claims
- stores room/session/message metadata
- issues voice provider tokens
- enforces room permissions

The WebRTC/SFU provider is the media plane:

- carries live audio
- receives short-lived provider tokens from query-api
- does not make room membership authoritative

Solana remains the settlement/proof layer for the existing protocol paths. This
integration does not write temporary rooms, chat messages, voice sessions, or raw
audio to chain.

## Privacy Defaults

Default behavior is deliberately conservative:

- no raw audio recording
- no transcript storage
- no recap generation
- no automatic draft creation
- no automatic crystallization
- no on-chain temporary room

The room fields `knowledgeMode` and `transcriptionMode` exist so later phases can
enable review-gated capture, but the current default is `off` for non-circle
rooms.

## Environment

Voice is disabled unless explicitly configured.

```bash
VOICE_PROVIDER=disabled
```

To enable LiveKit:

```bash
VOICE_PROVIDER=livekit
VOICE_PUBLIC_URL=wss://your-livekit-host
LIVEKIT_SERVER_URL=https://your-livekit-server-internal-or-public
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
VOICE_REQUIRE_PROVIDER_HEALTH=false
VOICE_PROVIDER_HEALTH_TIMEOUT_MS=1500
VOICE_DEFAULT_TTL_SEC=7200
VOICE_TOKEN_TTL_SEC=900
VOICE_PLATFORM_MAX_SPEAKERS_PER_SESSION=100
VOICE_DEFAULT_MAX_SPEAKERS_PER_SESSION=16
VOICE_SPEAKER_LIMIT_STRATEGY=listen_only
COMMUNICATION_VOICE_CLIP_MAX_DURATION_MS=300000
COMMUNICATION_VOICE_CLIP_MAX_BYTES=26214400
```

`VOICE_PUBLIC_URL` is returned to browser clients in voice join tokens.
`LIVEKIT_SERVER_URL` is the query-api server-side/admin URL used for LiveKit
health checks and room service calls; for local Docker this can be
`http://livekit:7880` while the public URL stays `ws://localhost:7880`.
`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must stay server-side.

Provider readiness is visible at:

```http
GET /api/v1/voice/health
```

When `VOICE_REQUIRE_PROVIDER_HEALTH=true`, voice session creation and token
issuance return `503 voice_provider_unavailable` if the configured provider is
not reachable. Leave this disabled for loose local development and enable it for
smoke tests or demo environments where a false voice success would be confusing.

Voice speaker limits have two layers:

- `VOICE_PLATFORM_MAX_SPEAKERS_PER_SESSION` is the platform hard cap. The local
  default is `100`, matching the current LiveKit Build-plan participant
  concurrency and per-participant audio subscription scale instead of treating
  `16` as a technical ceiling.
- `VOICE_DEFAULT_MAX_SPEAKERS_PER_SESSION` is the fallback room speaker slot
  count when a room does not provide its own policy. The default is `16`, meant
  as a conservative interactive voice-room default for party/guild/gameplay
  rooms, not as the system maximum.
- `VOICE_MAX_SPEAKERS_PER_SESSION` is still accepted as a legacy alias for the
  default room speaker slot count.

`VOICE_SPEAKER_LIMIT_STRATEGY` controls overflow behavior:

- `listen_only` (default): extra participants can join and listen, but receive a
  subscribe-only token with `canPublishAudio=false`.
- `deny`: extra participants are rejected with
  `voice_speaker_limit_reached` / HTTP `429`.
- `queue`: extra participants join as listeners with `role=queued`. When speaker
  slots open, token issuance promotes the earliest queued wallet first, so new
  callers cannot skip the queue.
- `moderated_queue`: participants request the mic and stay listen-only with
  `role=queued` until a room voice moderator approves them. This is the right
  default for guild halls, public lobbies, AMAs, teaching rooms, or any room
  where speaking order needs active control.

External program rooms can set room-specific policy through the server-signed
`appRoomClaim.voicePolicy`. Effective speaker slots are always clamped to the
platform hard cap. Unsigned `metadata.voicePolicy` in the browser request is
ignored for external rooms.

Recommended defaults:

- squad / party chat: `4..8` speaker slots
- dungeon / match room: `8..16` speaker slots
- guild / large lobby: `16..32` speaker slots, usually with `queue`
- hosted event / public hall: `8..24` speaker slots with `moderated_queue`
- open world / very large scene: split by proximity, party, or channel instead
  of running every player as an active microphone publisher in one room

`moderated_queue` is still a voice runtime policy, not the governance module
itself. The voice runtime owns the queue and provider permissions; governance or
room roles can be used as an authorization source for who may approve, reject, or
lower speakers.

## Room Model

Use a circle room when the room is a long-lived Alcheme social or knowledge
container:

- guild
- faction
- long-lived game community
- strategy room tied to existing Alcheme knowledge

Use a communication room when the room is temporary or external-program-native:

- party
- dungeon
- direct call
- match room
- lobby

Room keys are deterministic:

```text
circle:<circleId>
direct:<sha256-wallet-pair>
external:<externalAppId>:<roomType>:<externalRoomId>
```

Supported room types currently include:

```text
circle, custom, direct, dungeon, guild, party, world
```

## Room Capabilities

`CommunicationRoom` is the runtime container. Plaza is a first-party capability
bundle carried by `circle:<circleId>` rooms; Room does not inherit Plaza.

Circle room capabilities default to Plaza-aware behavior:

- text chat and voice enabled
- voice clip references enabled
- Plaza discussion enabled
- AI summary, draft generation, crystallization, and governance enabled through
  the existing review-gated Plaza paths

External program rooms default to generic runtime behavior:

- text chat and voice enabled
- Plaza discussion disabled
- AI summary, draft generation, crystallization, and governance disabled
- voice clips disabled unless a future signed capability design enables them

The storage split is intentional:

```text
Plaza circle discussion: circle_discussion_messages
External/arbitrary room chat: communication_messages
```

Do not migrate Plaza discussion storage into `communication_messages` without the
separate message-unification gate described in
`docs/architecture/room-capability-carrier.md`.

## External Program Registration

External program rooms require an `ExternalApp` row before claim verification can
succeed.

Required fields:

- `id`: stable app id, for example `example-web3-game`
- `name`: display name
- `ownerPubkey`: owner wallet
- `status`: `active`
- `serverPublicKey`: bs58 Ed25519 public key for the external program server
- `claimAuthMode`: `server_ed25519`

Development-only mode `wallet_only_dev` bypasses server claim signatures, but it
must not be used for production integrations.

Local sandbox/dev onboarding can be bootstrapped without manual database edits:

```bash
cd services/query-api
npm run seed:external-app -- \
  --id example-web3-game \
  --name "Example Web3 Game" \
  --owner-pubkey <owner-wallet> \
  --origin http://localhost:5173 \
  --wallet-only-dev
```

The matching admin route is intended only for sandbox/dev operator bootstrap:

```http
POST /api/v1/external-apps
x-external-app-admin-token: <EXTERNAL_APP_ADMIN_TOKEN>
```

Any reviewed production registration must use the ExternalApp manifest and
governance request path, not `wallet_only_dev`.

Before a production registration request is opened, the developer must accept the
scoped developer agreement:

```http
GET /api/v1/external-apps/risk-disclaimers/developer_registration
```

The external program records the acceptance on chain through the ExternalApp
Economics program, then submits the receipt evidence as `developerAgreement` in:

```http
POST /api/v1/external-apps/:appId/production-registration-requests
```

The agreement receipt stores terms and acceptance digests, not the full legal
text. It binds to the manifest hash, so a changed production manifest needs a new
developer agreement receipt.

### ExternalApp Registry V2 Modes

ExternalApp Registry V2 is the Solana/SVM audit root for reviewed production
apps. It stores objective registry facts such as `appIdHash`, owner wallet,
manifest hash, server key hash, policy digest, governance decision digest, and
execution receipt digest. It does not custody bonds or execute slashing.

```bash
EXTERNAL_APP_REGISTRY_MODE=disabled|optional|required
```

- `disabled`: local/runtime-only behavior. No chain registry submission is
  attempted.
- `optional`: query-api attempts chain anchoring when registry config is
  present, but local/dev flows can continue if the chain path is unavailable.
- `required`: production exposure must have a trusted chain projection. For
  `environment=mainnet_production`, discovery, CORS, and room resolution require
  an active registry anchor with both registration and execution-receipt finality
  confirmed or finalized.

Local sandbox apps can remain `disabled` or `optional`. Reviewed production apps
should move to `required` before public exposure. The current smoke entrypoint is:

```bash
npm run smoke:external-app-registry-v2
```

By default this smoke checks manifest hashing, discovery reachability, and the
database projection invariant for required mode. Set
`ALCHEME_EXTERNAL_APP_REGISTRY_EXECUTE=true` only when the local validator,
ExternalApp Registry program, event emitter, registry authority keypair, and IDL
are all configured; then it submits real registry and receipt-anchor
transactions through the chain registry adapter.

The local browser-like smoke path uses a historical script name:

```bash
npm run smoke:external-game-local
```

Set `ALCHEME_API_BASE_URL`, `ALCHEME_EXTERNAL_ORIGIN`,
`EXTERNAL_APP_ADMIN_TOKEN`, and optionally `ALCHEME_SMOKE_REQUIRE_VOICE=true`
for non-default local stacks. The smoke script default matches
`scripts/start-local-stack.sh` (`local-external-app-admin`).

## App Room Claim

For external rooms, the external program server signs a short-lived room claim.
The payload is base64url-encoded JSON, and the signature is base64 Ed25519 over
the encoded payload string.

Payload fields:

```json
{
  "externalAppId": "example-web3-game",
  "roomType": "dungeon",
  "externalRoomId": "run-8791",
  "walletPubkeys": ["<player wallet>"],
  "roles": { "<player wallet>": "member" },
  "voicePolicy": {
    "maxSpeakers": 16,
    "overflowStrategy": "queue",
    "moderatorRoles": ["owner", "moderator", "host"]
  },
  "expiresAt": "2026-05-09T18:00:00.000Z",
  "nonce": "unique-server-nonce"
}
```

The wallet being resolved or synced must appear in `walletPubkeys`. Room-wide
claims without wallet scope are rejected for member sync.

`voicePolicy` is optional. When present, it is copied into room metadata only
after the app-room claim signature, room identity, expiry, nonce, and wallet
scope pass verification.

## API Flow

All paths below assume the query-api prefix `/api/v1`.

### 1. Resolve Room

```http
POST /api/v1/communication/rooms/resolve
Content-Type: application/json
```

```json
{
  "externalAppId": "example-web3-game",
  "roomType": "dungeon",
  "externalRoomId": "run-8791",
  "parentCircleId": 130,
  "ttlSec": 7200,
  "walletPubkey": "<player wallet>",
  "appRoomClaim": {
    "payload": "<base64url payload>",
    "signature": "<base64 ed25519 signature>"
  }
}
```

Response includes `room.roomKey`.

### 2. Sync Room Member

```http
POST /api/v1/communication/rooms/:roomKey/members
Content-Type: application/json
```

```json
{
  "walletPubkey": "<player wallet>",
  "appRoomClaim": {
    "payload": "<base64url payload>",
    "signature": "<base64 ed25519 signature>"
  }
}
```

Circle-backed rooms can use active circle membership instead of external member
sync.

### 3. Create Communication Session

The wallet signs this exact message shape:

```text
alcheme-communication-session:{"v":1,"action":"communication_session_init","walletPubkey":"<player wallet>","scopeType":"room","scopeRef":"<roomKey>","clientTimestamp":"<iso timestamp>","nonce":"<nonce>"}
```

Then call:

```http
POST /api/v1/communication/sessions
Content-Type: application/json
```

```json
{
  "walletPubkey": "<player wallet>",
  "roomKey": "<roomKey>",
  "clientTimestamp": "<iso timestamp>",
  "nonce": "<nonce>",
  "signedMessage": "<exact signed message>",
  "signature": "<base64 wallet signature>"
}
```

Response includes `communicationAccessToken`. The token is scoped to the room and
is used as a bearer token for read, stream, text write, and voice-token routes.

### 4. Send Text

```http
POST /api/v1/communication/rooms/:roomKey/messages
Authorization: Bearer <communicationAccessToken>
Content-Type: application/json
```

```json
{
  "senderPubkey": "<player wallet>",
  "text": "wait, pulling next pack",
  "clientTimestamp": "<iso timestamp>",
  "nonce": "<nonce>",
  "signedMessage": "<message signing payload>"
}
```

Messages are stored as signed envelopes with payload hashes. They do not create
Plaza discussion posts, drafts, crystals, or on-chain writes.

### 5. Send Voice Clip

Voice clips are chat messages that reference already-stored audio. They are not
recorded from an active room call and must not use LiveKit/WebRTC session URIs.

```http
POST /api/v1/communication/rooms/:roomKey/messages
Authorization: Bearer <communicationAccessToken>
Content-Type: application/json
```

```json
{
  "senderPubkey": "<player wallet>",
  "messageKind": "voice_clip",
  "storageUri": "https://cdn.example.test/clips/clip-1.webm",
  "durationMs": 4200,
  "fileSizeBytes": 8192,
  "payloadText": "optional fallback caption",
  "clientTimestamp": "<iso timestamp>",
  "nonce": "<nonce>",
  "signedMessage": "<voice clip signing payload>"
}
```

`storageUri` supports stable external storage such as HTTPS, IPFS, Arweave, or S3
URIs. Query-api stores `storageUri`, `durationMs`, optional `payloadText`, and a
payload hash; it does not store raw audio bytes. `fileSizeBytes` is required so
query-api can enforce `COMMUNICATION_VOICE_CLIP_MAX_BYTES`.

### 6. List Or Stream Messages

```http
GET /api/v1/communication/rooms/:roomKey/messages?afterLamport=0
Authorization: Bearer <communicationAccessToken>
```

```http
GET /api/v1/communication/rooms/:roomKey/stream
Authorization: Bearer <communicationAccessToken>
```

The stream route emits server-sent events for room messages.

### 7. Join Voice

Create or reuse a voice session:

```http
POST /api/v1/voice/sessions
Authorization: Bearer <communicationAccessToken>
Content-Type: application/json
```

```json
{
  "roomKey": "<roomKey>",
  "ttlSec": 7200
}
```

Issue a provider token:

```http
POST /api/v1/voice/sessions/:sessionId/token
Authorization: Bearer <communicationAccessToken>
Content-Type: application/json
```

Muted members can receive subscribe-only tokens. Banned members are rejected
before any provider token is issued.

For `moderated_queue`, ordinary members receive a subscribe-only token with
`policy.speakerLimit.reason = "speaker_approval_required"` and
`role=queued`. Voice moderators approve or reject queued wallets through the
voice-session moderation routes:

```http
POST /api/v1/voice/sessions/:sessionId/speakers/:walletPubkey/approve
Authorization: Bearer <moderator communicationAccessToken>
```

```http
POST /api/v1/voice/sessions/:sessionId/speakers/:walletPubkey/deny
Authorization: Bearer <moderator communicationAccessToken>
```

Approval promotes the target wallet to `role=speaker` only if a speaker slot is
available. Rejection leaves the target as listen-only.

## SDK Flow

The SDK exports:

- `createAlchemeGameChatClient`
- `createAlchemeVoiceClient`
- `joinExternalRoom` on the communication client
- `signAppRoomClaim` from `@alcheme/sdk/server`
- `buildCommunicationSessionBootstrapMessage`
- `buildCommunicationMessageSigningMessage`

Use `joinExternalRoom` for external rooms. It resolves the room, syncs the room
member from `appRoomClaim`, and creates the communication session in the correct
order.

```ts
const joined = await chat.joinExternalRoom({
  externalAppId: "example-web3-game",
  roomType: "dungeon",
  externalRoomId: "run-8791",
  parentCircleId: 130,
  appRoomClaim,
  sessionTtlSec: 7200,
});

const { room } = joined;

await chat.sendRoomMessage(room.roomKey, {
  text: "wait, pulling next pack",
});

await chat.sendRoomVoiceClip(room.roomKey, {
  storageUri: "https://cdn.example.test/clips/clip-1.webm",
  durationMs: 4200,
  fileSizeBytes: 8192,
  payloadText: "optional fallback caption",
});

voice.setCommunicationSession(room.roomKey, joined.communicationAccessToken);
const connection = await voice.joinVoice(room.roomKey);
```

The voice client requires an injected provider client. For browsers, that
provider client should wrap `livekit-client`. Query-api never imports browser
media code.

## Optional Transcription And Recap

Transcription is off by default. A room can only resolve to `live_caption`,
`transcript`, `recap`, or `full` when the server-signed `appRoomClaim` authorizes
the requested `transcriptionMode`; client-side request bodies alone are
downgraded to `off`.

The implemented service boundary is:

- `off`: no transcript, no recap, no draft source.
- `live_caption`: runtime captions only; query-api does not persist segments.
- `transcript` / `full`: transcript segments may be stored as
  `communication_messages` with `messageKind = voice_transcript`.
- `recap`: only the final recap is stored on `VoiceSession.metadata.voiceRecap`.
- `full`: can create a `SourceMaterial` marked by metadata as review-required;
  it does not create a draft or crystal.

V1 recap is rule-based and does not send voice transcript plaintext to an AI
provider. Future model-backed recap must use an explicit private-content AI
boundary.

## Route Boundaries

Public-safe:

- resolve room
- create communication session
- read room metadata with room session
- list messages with room session
- stream messages with room session
- create voice session with room session
- issue voice token with room session

Sidecar or moderator-gated:

- end room
- delete/tombstone message
- mute/kick/end voice session
- LiveKit provider webhook

Not yet exposed as a public route:

- provider transcript ingest and recap job enqueue; the current implementation is
  a service/worker boundary, not a browser API

Forbidden in this integration slice:

- transcript/recap creation
- AI draft candidate creation
- crystallization
- settlement adapter writes
- receipt or asset minting

## Verification Checklist

Before calling an integration complete:

- query-api builds
- Prisma schema validates and client generates
- communication route tests pass
- voice route tests pass
- SDK runtime tests pass
- frontend typecheck still passes if frontend code changed
- `npm run check:covenant` passes
- no temporary external program room, chat message, voice session, or raw audio state is
  written to chain
- `transcriptionMode` remains `off` unless a server-signed app claim explicitly
  authorizes a non-off mode
- external room `voicePolicy` comes from a verified server-signed app claim, and
  effective speaker slots never exceed `VOICE_PLATFORM_MAX_SPEAKERS_PER_SESSION`
