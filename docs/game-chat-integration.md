# Game Chat And Voice Integration

This document describes the current headless game integration path for Alcheme
communication rooms and voice sessions. It is intentionally separate from Plaza
discussion, draft, semantic, and crystallization flows.

## Current Scope

Implemented:

- Resolve communication rooms for circles, direct rooms, and external game rooms.
- Create wallet-signed communication sessions.
- Send, list, and stream signed text messages.
- Send voice clip messages by referencing externally stored audio.
- Create voice sessions and issue provider join tokens.
- Use LiveKit through a provider adapter when voice is enabled.
- Keep temporary rooms off chain.

Not implemented in this slice:

- React UI kit.
- Transcription, recap, or knowledge capture.
- Auto draft creation from game chat or voice.
- Auto crystallization from game chat or voice.
- On-chain temporary room or voice state.

## Runtime Roles

Alcheme/query-api is the control plane:

- verifies wallet signatures
- verifies external app room claims
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
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
VOICE_DEFAULT_TTL_SEC=7200
VOICE_TOKEN_TTL_SEC=900
COMMUNICATION_VOICE_CLIP_MAX_DURATION_MS=300000
COMMUNICATION_VOICE_CLIP_MAX_BYTES=26214400
```

`VOICE_PUBLIC_URL` is public. `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must stay
server-side.

## Room Model

Use a circle room when the room is a long-lived Alcheme social or knowledge
container:

- guild
- faction
- long-lived game community
- strategy room tied to existing Alcheme knowledge

Use a communication room when the room is temporary or game-native:

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

## External App Registration

External game rooms require an `ExternalApp` row before claim verification can
succeed.

Required fields:

- `id`: stable app id, for example `example-web3-game`
- `name`: display name
- `ownerPubkey`: owner wallet
- `status`: `active`
- `serverPublicKey`: bs58 Ed25519 public key for the game server
- `claimAuthMode`: `server_ed25519`

Development-only mode `wallet_only_dev` bypasses server claim signatures, but it
must not be used for production integrations.

## App Room Claim

For external rooms, the game server signs a short-lived room claim. The payload is
base64url-encoded JSON, and the signature is base64 Ed25519 over the encoded
payload string.

Payload fields:

```json
{
  "externalAppId": "example-web3-game",
  "roomType": "dungeon",
  "externalRoomId": "run-8791",
  "walletPubkeys": ["<player wallet>"],
  "roles": { "<player wallet>": "member" },
  "expiresAt": "2026-05-09T18:00:00.000Z",
  "nonce": "unique-server-nonce"
}
```

The wallet being resolved or synced must appear in `walletPubkeys`. Room-wide
claims without wallet scope are rejected for member sync.

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

## SDK Flow

The SDK exports:

- `createAlchemeGameChatClient`
- `createAlchemeVoiceClient`
- `buildCommunicationSessionBootstrapMessage`
- `buildCommunicationMessageSigningMessage`

Use the chat client first, then pass the communication session token to the voice
client.

```ts
const room = await chat.resolveRoom({
  externalAppId: "example-web3-game",
  roomType: "dungeon",
  externalRoomId: "run-8791",
  parentCircleId: 130,
  appRoomClaim,
});

const session = await chat.createCommunicationSession({
  roomKey: room.roomKey,
});

await chat.sendRoomMessage(room.roomKey, {
  text: "wait, pulling next pack",
});

await chat.sendRoomVoiceClip(room.roomKey, {
  storageUri: "https://cdn.example.test/clips/clip-1.webm",
  durationMs: 4200,
  fileSizeBytes: 8192,
  payloadText: "optional fallback caption",
});

voice.setCommunicationSession(room.roomKey, session.communicationAccessToken);
const connection = await voice.joinVoice(room.roomKey);
```

The voice client requires an injected provider client. For browsers, that
provider client should wrap `livekit-client`. Query-api never imports browser
media code.

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
- no contract or Anchor program files changed
- `transcriptionMode` remains `off` unless a later opt-in phase explicitly
  changes it
