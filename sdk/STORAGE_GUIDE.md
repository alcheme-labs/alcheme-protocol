# Alcheme SDK Storage Guide

This guide documents the storage URI boundary enforced by the SDK content
module. The current content-write path is v2-first.

## Current Path: V2

Use v2 when a content write needs an external URI, private storage bridge,
HTTPS storage, self-hosted storage, or another custom storage provider. V2 is
the supported route for private/custom storage and should be the default path
for new content anchor writes.

Typical callers should set `useV2: true` or use the dedicated v2 SDK methods
when attaching private or custom storage.

## Legacy V1 Guard

The legacy v1 content path accepts only the URI schemes that the v1 on-chain
and SDK contract can represent safely:

- `onchain://`
- `arweave://`
- `ipfs://`
- `hybrid://`

私有/自定义 URI（例如 `https://...`）在 v1 中不支持. The SDK rejects these
values before submitting a transaction. It also rejects empty `externalUri`
values instead of silently converting them to `null`.

The v1 path 不会做 silent fallback. If a write needs private/custom storage,
若要使用私有/自定义 URI，请走 v2 路径.
