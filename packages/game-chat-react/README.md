# @alcheme/game-chat-react

Optional React components for external game projects that want a simple UI on top of the Alcheme headless communication and voice clients.

This package is intentionally adapter-based. It does not require API users to use React, and it does not import Plaza, draft, semantic, knowledge, transcript, or recap controls.

## Build

```bash
npm --workspace @alcheme/game-chat-react run build
```

## Components

- `ChatPanel`: message list, composer, send state, and stream reconnect state.
- `VoiceControls`: join/leave, mute/unmute, and participant list.

Pass adapters compatible with the existing headless SDK runtime methods.
