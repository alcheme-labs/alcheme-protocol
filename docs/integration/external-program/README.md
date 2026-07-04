# External Program Integration

This is the public developer guide for external programs that run outside
Alcheme and connect through SDK/runtime APIs.

Use **External Program Integration** in public copy. `ExternalApp` is the current
implementation object name in protocol, SDK, and runtime contracts.

## Reading Order

1. [Quickstart](./quickstart.md): install the SDK, obtain operator onboarding
   values, register sandbox access, join a room, send messages, use voice, and
   open reviewed production registration.
2. [Server-Signed Claims](./server-signed-claims.md): app room, source
   submission, knowledge context, and production owner assertion signing
   contracts.
3. [Communication And Voice](./communication-and-voice.md): runtime contract,
   route shape, room claim boundary, message/voice behavior, and verification
   checklist.
4. [Entrypoints](./entrypoints.md): SDK, runtime, sandbox, production,
   discovery, app-operated route, and verification entrypoints.
5. [Runtime Access Architecture](./runtime-access-architecture.md): product
   boundary, access modes, authority model, managed runtime responsibilities,
   and data custody boundaries.
6. [Stability Model](./stability-model.md): registry, discovery, managed-node,
   risk, receipt, bond, and governance signal boundaries.

## Integration Boundary

The public baseline includes protocol code, SDK source, public integration
documents, and examples. It does not include the first-party managed runtime,
operator deployments, production signing sidecars, or private runbooks.

External developers can implement the client/server integration from this guide,
but sandbox registration, CORS authorization, production review, and managed-node
exposure require an Alcheme-compatible operator runtime endpoint and
operator-issued onboarding data.
