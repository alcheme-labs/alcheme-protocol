# External App Chat Headless Example

HTML diagram: [Open this subproject map](../../docs/architecture/subproject-maps.html#game-chat-headless).

This example shows the intended SDK-level integration shape for an external app or runtime client.
It is a template, not a runnable app by itself.

The current integration is headless:

- no React UI requirement
- no Plaza dependency
- no audio recording
- no transcript or recap
- no temporary-room chain write

## System Position

```mermaid
flowchart LR
    app["external app client"] --> sdk["@alcheme/sdk"]
    app --> server["external app server"]
    server --> claim["appRoomClaim"]
    claim --> sdk
    sdk --> query["query-api communication / voice routes"]
    query --> external["ExternalApp / CommunicationRoom"]
    sdk --> voice["voice provider adapter"]
```

## Runtime Flow

```mermaid
sequenceDiagram
    participant App as External app client
    participant Server as External app server
    participant SDK as Alcheme SDK
    participant API as query-api
    participant Voice as Voice provider

    App->>Server: request appRoomClaim
    Server-->>App: signed claim
    App->>SDK: joinExternalRoom(claim)
    SDK->>API: resolve/create communication room
    SDK->>API: sync room member from appRoomClaim
    SDK->>API: issue communication access token
    App->>SDK: send/list/subscribe messages
    SDK->>API: communication runtime routes
    App->>SDK: joinVoice
    SDK->>Voice: provider adapter join
```

## Files

- `src/main.ts`: client-side SDK flow with an injected wallet signer and voice
  provider client.

## Required Runtime Pieces

External app client:

- a wallet object that exposes `publicKey` and `signMessage(message)`
- an Alcheme query-api base URL
- a voice provider adapter if voice is enabled

External app server:

- an `ExternalApp` row in Alcheme
- an Ed25519 server key whose public key is stored on `ExternalApp.serverPublicKey`
- a short-lived `appRoomClaim` for each external room/member sync request

## Minimal Flow

1. Ask the external app server for an `appRoomClaim`.
2. Call `joinExternalRoom` to resolve/create the room, sync membership, and create a wallet-signed communication session.
3. Send/list/stream text and optional voice clip messages.
4. Pass the communication session token to the voice client.
5. Join voice through an injected provider client.

## Running As A Real Example Later

To make this executable, add a small package around this directory and install:

```bash
npm install @alcheme/sdk livekit-client
```

Then replace the example wallet and `voiceProviderClient` in `src/main.ts`
with real browser wallet and LiveKit code.

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| What should the external app server sign into `appRoomClaim`? | Check query-api communication route validation and SDK runtime types. |
| Which voice provider is used in production-like runs? | Check query-api voice provider config and the injected `VoiceProviderClient`. |
| Which room metadata should external apps persist locally? | Compare `resolveRoom` responses with host runtime state requirements. |
