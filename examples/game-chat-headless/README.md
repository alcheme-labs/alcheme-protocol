# Game Chat Headless Example

This example shows the intended SDK-level integration shape for a game client.
It is a template, not a runnable app by itself.

The current integration is headless:

- no React UI requirement
- no Plaza dependency
- no audio recording
- no transcript or recap
- no temporary-room chain write

## Files

- `src/main.ts`: client-side SDK flow with an injected wallet signer and voice
  provider client.

## Required Runtime Pieces

Game client:

- a wallet object that exposes `publicKey` and `signMessage(message)`
- an Alcheme query-api base URL
- a voice provider adapter if voice is enabled

Game server:

- an `ExternalApp` row in Alcheme
- an Ed25519 server key whose public key is stored on `ExternalApp.serverPublicKey`
- a short-lived `appRoomClaim` for each external room/member sync request

## Minimal Flow

1. Ask the game server for an `appRoomClaim`.
2. Resolve or create the communication room.
3. Create a wallet-signed communication session.
4. Send/list/stream text and optional voice clip messages.
5. Pass the communication session token to the voice client.
6. Join voice through an injected provider client.

## Running As A Real Example Later

To make this executable, add a small package around this directory and install:

```bash
npm install @alcheme/sdk livekit-client
```

Then replace the placeholder wallet and `voiceProviderClient` in `src/main.ts`
with real browser wallet and LiveKit code.
