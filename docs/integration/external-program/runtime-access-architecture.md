# External Program And Compatible Runtime Access Architecture

Status: public product architecture summary for Route A integrations.

Route A covers external programs that run outside Alcheme and connect through
SDK/runtime APIs. It is separate from Route B hosted apps, where a third-party
frontend is embedded inside Alcheme as a managed iframe.

## Product Boundary

Alcheme provides protocol records, SDK helpers, compatible runtime contracts,
discovery/read projections, governance hooks, evidence rules, and optional
operator-managed node access.

External program operators remain responsible for their program behavior,
product rules, user experience, infrastructure, and risk decisions. Alcheme
discovery, managed-node access, risk labels, or review status must not be
described as compensation, reimbursement, insurance, guarantee, principal
protection, platform liability, or endorsement.

## Access Modes

| Mode | Purpose | What Is Needed |
| --- | --- | --- |
| Sandbox | Early development, demos, integration tests | Operator runtime endpoint, app id, allowed origins, owner wallet, server public key. |
| Reviewed production | Public exposure through official discovery or managed-node paths | Manifest, owner assertion, developer agreement receipt, review request, governance execution. |
| App-operated route | Continuity through infrastructure operated by the external program | Public route declaration and clear non-endorsement boundary. |

Most teams should start with sandbox mode, verify communication and voice, then
open a production registration request only after the client/server integration
is stable.

## Authority Model

External program authority and user authority are separate:

- The external program server signs `appRoomClaim` payloads with its registered
  Ed25519 key.
- The user wallet signs communication sessions and message payloads.
- The operator runtime verifies registration, claims, sessions, CORS, room
  policy, and capability policy.
- Protocol transactions and receipts use chain accounts and program IDs for the
  target cluster.

CORS, domain metadata, and app manifests are useful risk signals. They are not
the final security root by themselves.

## Managed Runtime Responsibilities

A compatible operator runtime is expected to provide:

- external program registration and allowed-origin enforcement.
- communication room resolution.
- member sync from verified room claims.
- wallet-signed communication sessions.
- text and voice-clip message storage.
- optional voice provider token issuance.
- optional source-material intake through a private sidecar surface.
- accepted knowledge-context package generation for authorized Circle bindings.
- developer risk-disclaimer terms and receipt intake.
- production registration request intake.
- discovery and stability projection read surfaces when enabled.

The public baseline does not include the first-party runtime implementation.
External developers should integrate against the runtime contract and operator
endpoint supplied for sandbox, devnet, or production review.

## App-Operated Routes

An app-operated route is infrastructure controlled by the external program or a
third party. It can provide continuity when a program wants to run its own
surface outside an Alcheme managed node.

Boundaries:

- It is not an Alcheme managed node.
- It is not an Alcheme-certified public node network.
- It does not create Alcheme responsibility for external program behavior.
- It should carry provenance and non-endorsement copy wherever surfaced.

## Data And Custody Boundaries

Temporary external program rooms, text messages, voice sessions, and live voice
media stay in runtime/provider layers. They are not automatically written to
chain.

Reusable knowledge enters Alcheme only through explicit SourceMaterial review
and Circle policy or governance acceptance. Accepted knowledge context packages
may be returned to external programs, but sealed evidence, private locators, raw
room history, unpublished drafts, and automatic crystals must not be exposed by
default.

Source-material intake is not available on every compatible runtime endpoint. It
requires the operator to expose the `source_materials` private sidecar surface.
External programs cannot enable that route from browser or SDK code.

## Production Readiness Checklist

Before requesting reviewed production access:

- Use `server_ed25519` room claims instead of `wallet_only_dev`.
- Keep server private keys and admin tokens off the browser.
- Register real allowed origins, redirect URIs, callback hosts, and server
  public key.
- Verify the manifest hash against the exact manifest submitted.
- Show the scoped developer agreement before signing or submitting receipt
  evidence.
- Use the active review policy version id from
  `GET /api/v1/external-apps/review-policy/current`.
- Verify communication session, message, stream, and voice behavior against the
  target operator endpoint.
- If using community knowledge continuity, verify source-material sidecar access
  and server-signed source/knowledge claims against the target endpoint.
- Keep app-store listing, managed-node access, capability limits, and service
  shutdown as separate states.
