# Alcheme External App and Compatible Node Access Product Architecture

Date: 2026-05-13
Status: Product architecture draft
Scope: ExternalApp registration, Alcheme managed node access, self-hosted compatible nodes, SDK boundaries, backing, complaint challenges, and dispute handling.

## 1. Executive Conclusion

Alcheme should treat external app access as its own product layer. It should not
be reduced to a set of `game-chat` or `voice` APIs.

The recommended target architecture is:

> ExternalApp on-chain or chain-anchored registry + `.well-known/alcheme-app.json`
> manifest + externally server-signed `appRoomClaim` + user wallet session + node
> capability discovery + backing, complaint, and dispute mechanisms.

This model needs to support four scenarios at the same time:

1. External programs can connect to Alcheme demo or dev nodes at low cost during development and testing.
2. External programs using Alcheme managed nodes on mainnet are subject to strict review, rate limits, revocation, and accountability.
3. External programs can operate their own Alcheme-compatible nodes.
4. Players and backers can help shape ExternalApp reputation, reducing manual review cost while preserving governance or arbitration for subjective disputes.

Core principles:

- The developer experience should stay lightweight, while the mainnet trust root must be hard.
- CORS is not an authentication mechanism, and domain verification is not the final security root.
- A browser SDK must not hold app authority keys.
- App authority comes from ExternalApp registration state and an externally server-signed claim.
- User action authority comes from user wallet signatures or sessions.
- Backing capital can improve economic security, but it is not the same as trustworthiness.
- Complaint capital can trigger risk downgrades and dispute processes, but principal should not be redistributed automatically based on amount alone.
- App store delisting, managed node downgrades, capability restrictions, and service suspension must remain separate. By default, governance actions should affect distribution and official node policy. Only severe malicious behavior should trigger emergency service holds.
- Product semantics come before code reuse. Existing abstractions should be reused to avoid parallel systems, not simply to write less code. If an existing abstraction breaks ExternalApp product semantics, extend or refactor the abstraction instead of forcing ExternalApp into it.

## 2. Current Code Facts

The repository already has the beginnings of external integration, but it does
not yet form a complete product loop.

Already present:

- An `ExternalApp` data table with fields including `id`, `ownerPubkey`, `status`, `serverPublicKey`, `claimAuthMode`, `allowedOrigins`, and `config`.
- `CommunicationRoom` can be associated with `externalAppId`, `roomType`, and `externalRoomId`.
- `appRoomClaim` already exists as an authority boundary for external app rooms.
- `wallet_only_dev` already exists, but it is a development convenience mode and should not become the production default.
- `query-api` exposes `/api/v1/extensions/capabilities`, which can provide node capabilities and public/private sidecar route information.
- `query-api` exposes `/sync/status`, which can become part of node sync health reporting.
- The existing `registry_factory` and extension registry provide extension and program discovery infrastructure. They are not the ExternalApp mainnet registry.
- `Circle` and `CircleMember` can already carry the organizational boundary for who is allowed to participate in certain public processes.
- `GovernancePolicy`, `GovernancePolicyVersion`, `GovernanceRequest`, `GovernanceSignal`, `GovernanceSnapshot`, `GovernanceDecision`, and `GovernanceExecutionReceipt` already form the generic governance decision foundation. ExternalApp review should not create a parallel review system.
- The current `@alcheme/sdk` root export exposes both on-chain modules and runtime modules. It does not yet provide clear browser runtime, server, and protocol package boundaries.

Current gaps:

- There is no protocol-level ExternalApp registry.
- There is no self-service developer registration or onboarding flow.
- ExternalApp review, app store distribution, managed node quota, and capability limits are not yet connected to the existing Circle/Governance decision path.
- `ExternalApp.allowedOrigins` is not currently used as an Express CORS source.
- Expected integration errors, such as CORS mismatch, missing ExternalApp, and invalid `roomType`, can still surface as 500 errors.
- External integration examples do not fully hide the sequence `resolve room -> sync member -> create session -> voice token`.
- The SDK has not yet been split clearly into browser runtime SDK, server SDK, and protocol SDK, and it lacks browser runtime subpath exports.
- Self-hosted nodes currently only have the beginnings of capability discovery and sync status. That is not the same as a full ExternalApp registry synchronization network.

Therefore, the existing hardening plan should be treated as a V1 developer
experience repair plan, not as the full mainnet product architecture.

## 3. Reference Models

### 3.1 WalletConnect / Reown Verify

What to borrow:

- Domain verification during wallet connection.
- Request origins classified as `VALID`, `INVALID`, `UNKNOWN`, or risky.
- A clear statement that domain verification reduces phishing risk but does not provide absolute security.

How Alcheme should use it:

- ExternalApp should require domain proof and a manifest.
- Nodes may warn, rate-limit, or reject unverified, mismatched, or risky apps.
- Domain proof must not replace owner wallet, server key, app claim, or governance state.

Reference:

- https://docs.walletconnect.network/wallet-sdk/web/verify

### 3.2 Alchemy, QuickNode, And Similar RPC Platforms

What to borrow:

- App is a managed object.
- Origin allowlists, IP allowlists, address allowlists, token/JWT auth, and rate limits can be combined.
- Referrer and origin headers are easy to spoof and must be combined with authentication, quota, and rate limiting.

How Alcheme should use it:

- ExternalApp is a first-class integration object.
- Alcheme managed nodes use ExternalApp quotas, allowed origins, server claims, rate limits, and usage logs.
- CORS only solves browser access. It does not grant business permissions.

Reference:

- https://www.alchemy.com/docs/how-to-add-allowlists-to-your-apps-for-enhanced-security
- https://www.alchemy.com/docs/reference/admin-api/overview
- https://www.quicknode.com/docs/flow/endpoint-security

### 3.3 SIWE / SIWS / CAIP-122

What to borrow:

- Users establish off-chain sessions by signing with their wallet.
- Signed messages need context such as nonce, domain, URI, scope, and expiration time.
- User authorization and application server authorization are separate.

How Alcheme should use it:

- When a user enters an external room, the user still needs a wallet signature or an issued session.
- An ExternalApp server signature can only prove that the room, member, or role came from that app. It cannot replace the player's own authorization.
- Signed messages should bind node audience, chain, nonce, and expiry to prevent replay across nodes and environments.

Reference:

- https://eips.ethereum.org/EIPS/eip-4361
- https://standards.chainagnostic.org/CAIPs/caip-122
- https://docs.phantom.com/solana/signing-a-message
- https://github.com/wallet-standard/wallet-standard

### 3.4 Farcaster / Base Mini App Manifests

What to borrow:

- Apps publish identity, domain, icon, entry point, and account association through a public `.well-known` manifest.
- A manifest allows multiple clients to identify an app through shared public metadata.

How Alcheme should use it:

- Reviewed and production ExternalApps should deploy `https://<domain>/.well-known/alcheme-app.json`.
- Sandbox ExternalApps can initially use local seeds or development configuration without a mandatory manifest.
- The manifest declares app id, owner, server key, origins, callback, capabilities, policy, and SDK version.
- The on-chain registry stores only the manifest hash and trust root. Nodes fetch and verify the manifest.

Reference:

- https://docs.base.org/mini-apps/features/sign-manifest
- https://docs.neynar.com/miniapps/specification

### 3.5 TCR / UMA / Kleros

What to borrow:

- Token-curated registries use staking and challenges to maintain high-quality lists.
- UMA uses optimistic assertions, bonds, challenge windows, and disputes to handle external facts.
- Kleros uses evidence, voting, appeal, and execution for subjective disputes.

How Alcheme should use it:

- ExternalApp can introduce backing pools and complaint challenge pools.
- Light complaints first affect risk score and ranking.
- After thresholds are reached, the app enters a dispute process rather than being punished automatically based only on money.
- Machine-verifiable protocol violations can be punished automatically.
- Subjective disputes must have an evidence window, an appeal window, and a governance or arbitration outcome.

Reference:

- https://gitcoin.co/mechanisms/token-curated-registry
- https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work
- https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters
- https://docs.kleros.io/products/court
- https://docs.kleros.io/products/court/what-happens-during-a-dispute

### 3.6 The Graph

What to borrow:

- Open node networks need indexer or operator registration, staking, sync status, and service-correctness constraints.
- Running a self-hosted node is not just running one service. Compatibility, economic incentives, and error penalties matter.

How Alcheme should use it:

- Self-hosted Alcheme-compatible nodes should declare capabilities, sync status, and protocol version.
- Public service nodes need registration, monitoring, staking or reputation, and error accountability.
- Private self-use nodes can have a low barrier, but they do not automatically receive the same trust level as Alcheme managed nodes.

Reference:

- https://thegraph.com/docs/en/indexing/overview/
- https://thegraph.com/docs/en/indexing/tooling/graph-node/

## 4. Product Objects

### 4.1 ExternalApp

ExternalApp is the identity object for third-party games, tools, mini apps,
community apps, and similar external programs inside Alcheme.

It is not a browser origin, and it is not a simple API key.

ExternalApp should include:

- `appId`
- `displayName`
- `ownerWallet`
- `environment`
- `serverPublicKey`
- `manifestHash`
- `allowedOriginsDigest`
- `capabilities`
- `reviewLevel`
- `registryStatus`
- `discoveryStatus`
- `managedNodePolicy`
- `capabilityPolicies`
- `appTrustScore`
- `trustScore`
- `backingLevel`
- `riskScore`
- `quotaPolicy`
- `ownerBond`
- `communityBackingLevel`
- `createdAt`
- `expiresAt`
- `revokedAt`

`trustScore` is a derived score for display and ranking. App Trust and Node
Trust should not be collapsed into one responsibility object. ExternalApp may
display a health summary for the node it is currently using, but real `Node
Trust` belongs to the node or node operator, not to the app identity itself.

### 4.2 ExternalApp Manifest

Reviewed and production external apps must provide the following file under
their primary domain:

```text
https://example.com/.well-known/alcheme-app.json
```

Sandbox external apps may temporarily omit the manifest, but UI, API responses,
and documentation must clearly mark them as development or test identities. They
must not enter mainnet discovery pages or receive production quota.

Recommended manifest fields:

```json
{
  "version": "1",
  "appId": "last-ignition",
  "name": "Last Ignition",
  "homeUrl": "https://game.example.com",
  "ownerWallet": "solana:<cluster>:<pubkey>",
  "serverPublicKey": "<ed25519 public key>",
  "allowedOrigins": [
    "https://game.example.com"
  ],
  "platforms": {
    "webOrigins": ["https://game.example.com"],
    "nativeBundleIds": ["com.example.lastignition"],
    "desktopAppIds": ["steam:123456", "electron:com.example.lastignition"],
    "redirectUris": ["lastignition://alcheme/callback"]
  },
  "capabilities": [
    "communication.rooms",
    "communication.messages",
    "voice.livekit"
  ],
  "callbacks": {
    "webhookUrl": "https://game.example.com/api/alcheme/webhook"
  },
  "policy": {
    "retention": "ephemeral",
    "moderationContact": "mailto:ops@example.com",
    "privacyUrl": "https://game.example.com/privacy"
  }
}
```

The manifest itself is not the trust root. The trust root comes from the owner
wallet, registry status, and matching manifest hash.

CORS and `allowedOrigins` only cover browser scenarios. Mobile, desktop, Steam,
itch, Electron, Unity, and Godot native clients should prove integration identity
through bundle ids, desktop app ids, redirect URIs, server callbacks, and signing
keys. They must not be forced into a Web origin model.

### 4.3 Alcheme Managed Node

An Alcheme managed node is operated by Alcheme or an authorized operator.

It may provide:

- public query-api
- communication runtime
- voice token control plane
- optional sidecar
- optional AI, Plaza, or draft capabilities
- app onboarding
- rate limiting
- usage audit
- enforcement

Managed nodes must strictly enforce ExternalApp registration, origin policy,
claim verification, session verification, quota, and ban state.

### 4.4 Self-Hosted Compatible Node

A self-hosted compatible node is an Alcheme protocol-compatible node operated by
an external team.

There are two categories:

- Private self-use nodes: serve only the operator's own app and players, with a lower barrier.
- Public service nodes: serve other ExternalApps or users, and therefore need stronger compatibility and reputation constraints.

Self-hosted nodes must provide:

- capabilities endpoint
- sync status
- protocol version
- supported route contracts
- registry projection status
- optional conformance report

Self-hosted or public service nodes should be managed as separate trust objects,
with at least:

- `nodeId`
- `operatorWallet`
- `nodeType`
- `serviceUrl`
- `capabilitiesDigest`
- `protocolVersion`
- `syncStatus`
- `conformanceStatus`
- `nodeTrustScore`
- `nodePolicyStatus`
- `nodeStake` or an equivalent accountability mechanism

A self-hosted node should not receive the same trust level as an Alcheme managed
node merely because it runs a query-api service with the same name.

### 4.5 Backer

A Backer is a user or organization that provides economic backing for an
ExternalApp.

Backing means:

- The app has an economic accountability party.
- Someone is willing to take limited risk for it.
- It can receive a higher economic security level and a higher quota ceiling.

Backing does not mean:

- The app is necessarily safe.
- The app's content is necessarily legal.
- The app is exempt from complaints or review.
- The app can buy unlimited exposure.
- Backing is an investment. It does not promise yield and should not be packaged as a financial product.

### 4.6 Owner Bond

Owner Bond is the accountability deposit posted by the app owner or operator.

It means:

- The app has a clear accountable party.
- The app owner bears first economic responsibility for severe violations.
- When a major dispute is upheld, Owner Bond is the first source for compensating harmed users, node resource losses, and protocol risk pools.

It does not mean:

- Paying a bond bypasses review.
- The app owner can buy exposure with the bond.
- Every complaint should trigger slashing.

### 4.7 Community Backing

Community Backing is limited backing for an app from users or communities.

It mainly affects:

- `Backing Level`
- eligibility for featured or reviewed status
- quota ceiling on official managed nodes
- risk buffer against light complaints

It should not be the first source of compensation when the app owner behaves
maliciously. When a severe violation is upheld, Owner Bond should absorb losses
first. Community Backing may only be slashed in limited form when the rules are
clear, risk disclosure is sufficient, and the ruling confirms that the backing
pool should carry responsibility.

### 4.8 Protocol Risk Pool

The Protocol Risk Pool covers dispute handling costs, node resource loss
backstops, and specific compensation scenarios.

It should not be designed as a speculative yield pool for ordinary users. Its
product goal is to reduce systemic risk, not to create yield expectations.

### 4.9 Challenger

A Challenger is a person or entity that files a funded complaint or challenge
against an ExternalApp.

A Challenger may be:

- a player who has used the app
- a user with room, session, message, voice, or transaction records
- a new user or external observer
- an Alcheme node operator
- a governance member

Different Challengers should have different weights. A user who has actually
used the app should carry more weight than a newly registered user.

## 5. Access Environments

### 5.1 Sandbox

Purpose:

- local development
- demo testing
- quick external game integration trials

Rules:

- May use automatic registration or CLI seeding.
- May use `wallet_only_dev`.
- May use low quotas.
- May allow local origins such as `localhost`, `127.0.0.1`, and common Vite ports.
- Does not enter mainnet discovery.
- Must not claim to be production-ready.
- Must not receive real backing levels.

### 5.2 Devnet Reviewed

Purpose:

- public testing
- devnet demo
- external project gray-release integration

Rules:

- Requires owner wallet.
- Requires server public key.
- Requires manifest.
- Requires origin policy.
- `wallet_only_dev` must not be the default for public demos unless the app is explicitly marked as sandbox.
- Has basic rate limits.
- If risk appears, node operators may quickly downgrade the app, remove it from public distribution, or temporarily restrict high-risk capabilities. Basic communication should not be interrupted by default.

### 5.3 Mainnet Production

Purpose:

- mainnet user access
- use of Alcheme managed nodes
- inclusion in discovery, recommendations, trending surfaces, and the integration ecosystem

Rules:

- Requires an on-chain or chain-anchored ExternalApp Registry.
- Requires owner wallet registration.
- Requires server key.
- Requires manifest hash.
- Requires Owner Bond or an equivalent accountability mechanism.
- Requires review or successful optimistic review.
- Requires continuous risk scoring.
- Requires complaint and dispute mechanisms.
- Must be revocable and downgradeable.

### 5.4 High-Trust / Featured

Purpose:

- high-exposure distribution
- higher managed node quota
- more sensitive capabilities, such as high-concurrency voice, AI processing, and cross-app discovery

Rules:

- Requires higher backing level.
- Requires longer operating history.
- Requires lower dispute rate.
- Requires stricter privacy and moderation policy.
- Requires higher Owner Bond, node resource commitment, or a commercial agreement.

## 6. Integration Shapes

### 6.1 Server-Backed Integration

The default production-grade ExternalApp integration should be server-backed.

Characteristics:

- The external app has its own server.
- The app server stores the private key and signs `appRoomClaim`.
- The user client only holds a wallet session. It does not hold app authority keys.
- This fits app-owned rooms, game-owned roles, cross-player team or room synchronization, and production quota.

This is the recommended path for mainnet production and high-trust integrations.

### 6.2 Client-Only Integration

A client-only app has no secure place to store an app server private key, so it
cannot receive production app-owned room authority.

Allowed paths:

- sandbox or dev testing
- user-owned rooms
- low-trust integration on a self-hosted node
- a future Alcheme hosted claim service, which is equivalent to Alcheme custodying app authority and therefore requires separate review

Client-only integration must not bypass the production `appRoomClaim` boundary,
and the browser SDK must not become an app authority signer.

Alcheme hosted claim service is a separate product shape. It is not a shortcut
around the server-backed model. It means Alcheme custodies app authority, so it
must default to lower quotas, narrower capabilities, stricter review, and
stronger risk controls. By default it must not enter the high-trust or featured
tiers. Permission can only increase after separate assessment and accountability
agreements.

### 6.3 Self-Hosted Node Integration

Self-hosted node integration lets external projects control cost, latency, and
privacy boundaries.

It does not automatically grant official Alcheme app store exposure, and it does
not automatically grant official managed node trust. Self-hosted nodes should
have independent `Node Trust`, while ExternalApp should have independent `App
Trust`.

### 6.4 Official App Store / Discovery Page

The app store here is only Alcheme's official discovery and presentation layer.
It is not an installation market, and it is not a service kill switch.

Basic capabilities:

- Show reviewed or production ExternalApps.
- Show app name, icon, description, entry point, and supported capabilities.
- Show simplified status labels such as `Reviewed`, `Backed`, `Under Challenge`, `Official Node Limited`, and `Self-hosted`.
- Provide categories, search, trending, latest, and recommendations.
- Show necessary risk notices.

Boundaries:

- `delisted` only means removed from official discovery, recommendations, and app store distribution.
- The app store does not decide whether the on-chain ExternalApp exists.
- The app store does not shut down the external app's own service.
- Users may continue through direct links, self-hosted nodes, or the external app's own entry point unless a separate `ManagedNodePolicy` or governance ruling says otherwise.

### 6.5 Boundary With Existing Circle / Governance Abstractions

ExternalApp review and app store governance should be unified into the existing
Circle/Governance system instead of creating an independent review chain.

The decision order should be:

1. First, make sure the product semantics of ExternalApp, app store, managed node, self-hosted node, backing, and complaints are complete.
2. Then place common ideas such as membership, organization boundary, rules, requests, signals, rulings, and execution receipts into the existing Circle/Governance trunk.
3. Finally, add domain adapters for ExternalApp-specific registration, quota, app store state, node execution, and capability limits.

Unification does not mean forcing ExternalApp domain state into Circle or
Governance. `Circle` owns organization and member boundaries. `Governance` owns
decision formation and audit trails. ExternalApp still owns app identity, server
key, manifest, trust, quota, node policy, and capability policy.

Recommended product abstractions:

- The review committee should reuse `Circle` and `CircleMember` organization and membership capabilities, for example an `Alcheme Review Council`.
- That review circle should be marked as a system/governance/private type. It should not automatically enter ordinary circle discovery, fork flows, knowledge ownership, Plaza discussion, or public circle recommendations.
- If the current `Circle` model does not naturally express this governance organization, extend circle kind/mode/metadata or add a clear view boundary instead of making a review council behave like an ordinary content circle.
- Reviewers are `CircleMember` records in that circle. Membership, roles, and eligibility keep using circle membership semantics.
- Review rules are `GovernancePolicy` and `GovernancePolicyVersion`.
- A review, challenge, appeal, delisting, quota adjustment, or capability limit is a `GovernanceRequest`.
- Review opinions, votes, and signed signals are `GovernanceSignal` records.
- Decision snapshots, results, and execution receipts continue to use `GovernanceSnapshot`, `GovernanceDecision`, and `GovernanceExecutionReceipt`.

ExternalApp only adds the necessary domain adapter layer:

- ExternalApp needs a `reviewCircleId`, `reviewPolicyId`, or equivalent configuration that says which circle reviews it under which policy.
- Governance needs ExternalApp-related action types, such as `approve_store_listing`, `approve_managed_node_quota`, `downgrade_discovery_status`, `limit_capability`, and `emergency_hold`.
- An ExternalApp execution adapter must apply governance decisions to states such as `DiscoveryStatus`, `ManagedNodePolicy`, `CapabilityPolicy`, and `RegistryStatus`.
- Conflict-of-interest rules are required. For example, can the app owner, major backers, challengers, or direct competitors participate in a given governance request?

Explicitly avoid creating a parallel system:

- Do not create `ReviewCommittee` instead of `Circle`.
- Do not create `ReviewVote` instead of `GovernanceSignal`.
- Do not create `ReviewDecision` instead of `GovernanceDecision`.
- Do not make app store review status a private state machine understood only by the store.
- Do not let ExternalApp create a governance system separate from the main governance model.
- Do not force ExternalApp node quota, app store state, server key, manifest, or claim authority into Circle or Governance.

The final path should be:

```text
Circle / CircleMember -> GovernancePolicy -> GovernanceRequest -> GovernanceDecision -> GovernanceExecutionReceipt -> ExternalApp execution adapter -> DiscoveryStatus / ManagedNodePolicy / CapabilityPolicy / RegistryStatus
```

## 7. Permission And Signature Model

### 7.1 Keep Three Authorities Separate

ExternalApp integration has three distinct authorities:

1. App authority: whether this room, member, or role is authorized by the ExternalApp.
2. User authority: whether this player truly agreed to enter and speak as this wallet identity.
3. Node authority: whether the current node allows this app to use its resources.

These authorities must not replace one another.

### 7.2 `appRoomClaim`

`appRoomClaim` is signed by the external application server. It should not be
generated by the browser.

Recommended payload:

```json
{
  "version": "1",
  "externalAppId": "last-ignition",
  "roomType": "party",
  "externalRoomId": "coop-restore-ring",
  "walletPubkeys": ["..."],
  "roles": ["player"],
  "permissions": ["read", "write", "voice.listen", "voice.speak"],
  "audience": "https://demo.alcheme.site",
  "registryEpoch": 42,
  "nonce": "...",
  "issuedAt": "...",
  "expiresAt": "..."
}
```

Validation must check:

- signature
- whether the server key matches an active ExternalApp
- whether app id, room type, and room id match the request
- whether the wallet matches the current user session
- whether the nonce has already been used
- whether the claim has expired
- whether the audience matches the current node
- whether the registry epoch is too old

### 7.3 User Wallet Session

User sessions should follow a Solana Wallet Standard / SIWS style.

The signed message should include:

- domain
- URI
- wallet address
- chain or cluster
- nonce
- issuedAt
- expiresAt
- statement
- requested scopes
- node audience

The user session proves user action. It does not prove app authority.

### 7.4 Browser SDK

The Browser SDK is responsible for:

- wallet connect and sign-in
- joining an external room
- syncing a member
- creating a communication session
- sending, listing, and subscribing to messages
- requesting a voice token
- exposing typed errors

The Browser SDK is not responsible for:

- storing the app server private key
- registering a production ExternalApp
- signing `appRoomClaim`
- bypassing membership
- embedding a demo URL or devnet program id as the production default

### 7.5 Server SDK

The Server SDK is responsible for:

- generating and signing `appRoomClaim`
- verifying manifest
- calling the ExternalApp admin API
- syncing members, roles, and room metadata
- handling webhooks
- querying node capabilities
- checking node compatibility
- rotating server keys

### 7.6 Protocol SDK

The Protocol SDK is responsible for:

- ExternalApp Registry transactions
- Owner Bond, Challenge Bond, Node Stake, and similar funding operations
- manifest hash updates
- status updates
- dispute and challenge proposals
- claim or evidence hash anchoring on-chain
- other Alcheme protocol transactions

## 8. Backing And Complaint Challenge Mechanism

### 8.1 Design Goals

This mechanism reduces manual review cost, but it does not fully replace review
or arbitration.

It should answer:

- Which apps deserve higher quota and exposure?
- Which apps receive repeated user complaints and should be ranked lower or trusted less?
- Which apps have severe disputes and should enter adjudication?
- When an app behaves maliciously, how should the app owner's accountability bond absorb losses first?

It must not become:

- trust by money
- competitor-funded shorting
- new-account complaint farming to split principal
- amount-only voting on the truth of facts
- user backing packaged as investment yield

### 8.2 Split The Trust Metrics

ExternalApp should not have only one trust score.

Recommended split:

- `App Trust`: trustworthiness of the app itself.
- `Node Trust`: trustworthiness of the current service node.
- `Trust Score`: aggregate trustworthiness.
- `Backing Level`: strength of economic backing.
- `Risk Score`: complaint, dispute, incident, and abuse risk.
- `Discovery Score`: ranking score for discovery and trending.
- `Compliance State`: review and governance state.
- `Node Quota Tier`: managed node quota tier.

Score meanings:

- `App Trust` and `Node Trust` must be separate. A good app using a bad node, or a bad app using a good node, must not launder trust across boundaries.
- `Backing Level` may increase quota ceilings and risk tolerance, but it must not lift `Trust Score` on its own.
- `Risk Score` directly affects trending rank, default recommendations, and node risk controls.
- `Trust Score` is a derived aggregate score for display and ranking. It is calculated from `App Trust`, `Node Trust`, review, operating history, real user behavior, dispute history, backing, and node health.
- `Discovery Score` must not be determined by money alone.

For ordinary users, avoid exposing too many scores. Recommended simplified
labels:

- `Sandbox`
- `Reviewed`
- `Backed`
- `Under Challenge`
- `Limited`
- `Delisted`
- `Official Node Limited`
- `Managed Node Suspended`
- `Self-hosted`
- `Unverified Node`

Detailed scores should only appear in developer dashboards, governance pages, or
advanced detail views.

### 8.3 Split The Capital Pools

Capital pools must be separated:

- `Owner Bond`: the app owner or operator bond. It is the first source for violation compensation and slashing.
- `Community Backing`: user or community backing. It carries limited risk and must not automatically pay for the app owner's misconduct.
- `Challenge Bond`: the bond paid by a Challenger to cover complaint truthfulness and process cost.
- `Protocol Risk Pool`: the pool used for dispute costs and systemic risk backstops.

Owner Bond and Community Backing must not be merged into one pool. If they are
merged, an app owner's misconduct first harms ordinary backers, and the backing
mechanism loses product trust.

### 8.4 Backing Pool

Users can provide backing for an ExternalApp.

Rules:

- Backing capital has a lockup period.
- Backing yield or weight should have a diminishing curve so a single large holder cannot directly buy trust.
- Backing by the app owner must be marked separately and must not masquerade as third-party trust.
- Backing capital carries limited risk.
- If a severe violation is upheld, Owner Bond should be slashed first. Community Backing should only be slashed in limited form when the rules are clear, risk disclosure is sufficient, and the ruling confirms it should share responsibility.
- Ordinary quality complaints should not directly confiscate backing principal.
- Backing does not promise yield and should not be designed as an investment product.

Benefits from backing:

- Raises `Backing Level`.
- Raises managed node quota ceiling.
- Improves eligibility for reviewed or featured status.
- Provides a buffer against light complaints.

Backing does not directly grant:

- guaranteed trending placement
- exemption from review
- exemption from dispute
- protection from downgrade, official app store removal, or review
- absolute principal safety, although risk must be capped and clearly disclosed before backing

### 8.5 Ordinary Negative Feedback

Unfunded ordinary negative feedback still exists.

Purpose:

- Captures user feedback.
- Affects app rating display.
- Affects a fixed portion of `Risk Score`.
- Acts as a signal for node risk controls and human/governance review.

Limits:

- Does not participate in capital distribution.
- Does not trigger slashing.
- Does not directly delist an app.
- Carries lower weight from new accounts and accounts without usage records.

### 8.6 Funded Complaints

A funded complaint is a Challenge.

Purpose:

- Increases the complaint signal weight.
- Makes the complainant bear the cost of false claims.
- Triggers dispute when thresholds are reached.
- May provide limited reward or compensation priority if successful.

Weight rules:

- Users who have used the app have higher weight.
- Users with room, session, message, voice, or transaction records have higher weight.
- Newly registered users may file complaints, but start with lower weight.
- Complaints from the same funding source, device, or social graph should pass sybil risk controls.
- Large complaints should not increase weight linearly. They should have diminishing returns.
- Successful complaint rewards should primarily compensate cost and incentivize oversight. They should not become the main profit mechanic.

### 8.7 Downgrade And Delisting Rules

Before the dispute threshold is reached:

- Only affects `Risk Score`.
- Lowers discovery ranking.
- Lowers trending and recommendation weight.
- May reduce managed node soft quota.
- Does not confiscate backing principal.
- Does not delist the app from the app store.
- Does not interrupt basic functionality.

At a light threshold:

- The app enters `under_review`.
- Nodes may lower quota.
- Pages show a risk notice.
- The app owner gets a response window.
- The official app store may lower placement or remove featured status.

At a heavy threshold:

- The app enters dispute.
- The official app store may hide or delist the app.
- Official managed nodes may downgrade, rate-limit, or remove high quota.
- High-risk capabilities may be temporarily restricted, such as high-concurrency voice or public discovery exposure.
- The app owner must submit a response or remediation.

App store delisting only means that Alcheme official discovery, recommendation,
and app store surfaces no longer actively distribute the app. Direct links,
existing users, self-hosted nodes, and the external app's own entry point should
continue by default.

Managed node downgrade only means that Alcheme official nodes reduce resource
treatment, such as request rate, concurrency, voice speaker limits, and
AI/sidecar capabilities. It is not a protocol-level ban.

### 8.8 Capability-Level Restrictions

Governance actions should be as capability-scoped as possible. They should not
default to shutting down the entire app.

Examples:

- Voice harassment should first restrict `voice.publish`, speaker slots, or voice room quota.
- AI abuse should first restrict `ai.summary`, AI job quota, or sidecar capabilities.
- Message spam should first restrict `communication.messages.write` or message rate.
- Distribution risk should first restrict `discovery.featured`, `discovery.search`, or `store.listing`.
- Managed node cost risk should first restrict `managed_node_quota`.

Only when risk spreads across capabilities, or when the app owner clearly
circumvents capability-level restrictions maliciously, should enforcement
escalate.

### 8.9 Dispute Process

Recommended process:

1. Challenger submits complaint, bond, and evidence hash.
2. System enters the evidence window.
3. App owner submits a response, remediation note, or counter-evidence.
4. If the app owner does not respond in time, default light or medium penalties may execute.
5. If both sides dispute the facts, the case goes to governance or arbitration.
6. Once the ruling is upheld, execute app store delisting, managed node downgrade, capability-level restrictions, slashing, or compensation.
7. Allow an appeal window.
8. Execute final settlement after the appeal window.

Machine-verifiable protocol violations can bypass subjective arbitration and
trigger automatic penalties, for example:

- signing claims with a revoked server key
- replaying a nonce
- forging a claim
- clearly machine-verifiable violations of a node resource agreement

Manifest hash mismatches, manifest fetch failures, and abnormal domain proof
should let a node reject high privileges, downgrade the app, or put the app into
review first. Automatic penalties or slashing should only happen when evidence
can be submitted and clear responsibility can be assigned. A single node fetch
failure must not directly confiscate funds.

Subjective disputes must go through governance or arbitration, for example:

- fraud allegations
- malicious content
- inducement to transact
- user-rights violations
- content compliance disputes
- improper operations

### 8.10 Capital Distribution

Do not use a rule like "if complaint amount exceeds backing amount, automatically
split all principal."

Recommended rules:

- Failed complaint: part of the complaint bond is forfeited to the protocol pool or to compensate the attacked app.
- Partially upheld complaint: app is downgraded or capability-limited, Owner Bond is slashed by a small percentage, and the complainant receives limited cost compensation.
- Severely upheld complaint: app is delisted from the official app store, managed nodes downgrade it or restrict capabilities, and Owner Bond is slashed first. Community Backing only shares limited losses when rules are clear and the ruling confirms it.
- When there are clearly harmed users, harmed users are compensated first.
- Challenger rewards are capped so complaints do not become the main profit mechanic.
- Community Backer losses are capped unless the backer is the app owner, an affiliate, or explicitly chose a higher-risk backing tier.

Capital priority:

1. Harmed user compensation.
2. Cost compensation for successful Challengers.
3. Node resource loss compensation.
4. Protocol Risk Pool.
5. Remaining funds unlocked for the app owner or Community Backers.

### 8.11 Attack Constraints

The design must prevent:

- rich apps buying trust
- competitors shorting apps
- new-account complaint attacks
- app owners masquerading as backers
- backers entering and exiting quickly to farm levels
- complainants using fake evidence to trigger delisting
- node operators abusing ban authority
- Community Backing being packaged as a yield product

Countermeasures:

- diminishing returns on backing
- lockups and delayed exit
- lower weight for new-account complaints
- usage-record weighting
- evidence hash and public evidence window
- appeal window
- governance or multisig execution for high-risk penalties
- separation between emergency node pause and final ruling
- clear risk disclosure and limited loss caps

## 9. Review And Penalty Model

### 9.1 Three-Layer Governance

Alcheme should use neither pure human review nor pure contract-automated review.

Recommended three-layer model:

1. Contract constraints: registration, stake, status, evidence hash, capital lockup, and final execution.
2. Node execution: CORS, rate limits, tokens, sessions, voice, discovery, and emergency holds.
3. Governance/arbitration: subjective review, dispute rulings, appeals, and severe penalties.

### 9.2 Execution State Model

Product states must be split so "delisted from the app store" is not mistaken
for "service has been shut down."

`DiscoveryStatus`:

- `listed`
- `limited`
- `hidden`
- `delisted`

This only controls official discovery, search, recommendations, and app store
display.

`ManagedNodePolicy`:

- `normal`
- `throttled`
- `restricted`
- `emergency_hold`
- `denied`

This only controls how Alcheme official managed nodes treat the app's resources.

`CapabilityPolicy`:

- `normal`
- `limited`
- `disabled_on_managed_node`

This controls capabilities individually, such as voice, AI, message write, and
featured distribution.

`RegistryStatus`:

- `pending`
- `active`
- `disputed`
- `revoked`

This is the protocol-level identity state. Only severe and adjudicated cases
should enter `revoked`.

### 9.3 Service Suspension Boundary

By default, Alcheme should not have product semantics that let it arbitrarily
shut down the basic functionality of an external app.

Most risks should first be handled through:

- app store hiding or delisting
- lower trending or recommendation weight
- risk notices
- lower official managed node quota
- restricted related capabilities
- a request for the app owner to fix, respond, rotate keys, or add Owner Bond

Only under the following principle should an app enter `emergency_hold` or
`denied`:

> Emergency service suspension is allowed only when failing to stop new official
> managed-node sessions immediately would continue causing clear, severe,
> irreversible, or large-scale harm, and delisting, rate limiting, and
> capability-level restrictions are not enough.

By default, `emergency_hold` only blocks new official managed-node sessions,
token refreshes, and high-risk capability calls. If severe harm is already
continuing through active sessions or tokens, the official managed node may
temporarily invalidate the relevant active managed-node sessions or tokens. This
action must record the trigger reason, affected scope, start time, expected end
time, notify the app owner, and preserve an appeal path.

Examples of severe malicious behavior:

- large-scale phishing, wallet signature theft, or inducing users to reveal private keys or seed phrases
- malware distribution or clear attacks on user devices
- mass issuance of fake `appRoomClaim` using stolen or forged server keys
- ongoing attacks against Alcheme managed nodes, such as resource exhaustion, rate-limit bypass, or service disruption
- repeated nonce replay, claim forgery, or permission bypass after warnings
- continued propagation of severely illegal or high-risk content that creates direct risk to users or the platform
- app owner refusal to respond to key leaks, exploits, or major user harm
- adjudicated severe fraud where continued service would expand the affected victim group

Emergency suspension must be temporary, with a suggested time limit such as 24 to
72 hours. Long-term suspension, slashing, and `revoked` status must go through
evidence, response windows, governance/multisig/arbitration, and appeal windows.

### 9.4 What Contracts Are Good At Handling

- app registration
- owner wallet
- server key hash
- manifest hash
- Owner Bond
- Challenge Bond
- Node Stake for public service nodes
- status
- dispute id
- evidence hash
- challenge bond
- appeal bond
- final ruling
- slash, release, and compensation execution

### 9.5 What Contracts Should Not Judge Alone

- whether an app is fraudulent
- whether content is illegal or malicious
- whether a complaint is true
- whether a lighter penalty is appropriate
- whether there was an operational misunderstanding
- whether protocol-level identity should be revoked forever

These cases must enter governance or arbitration.

### 9.6 Stage Evolution

V1:

- Before any reviewed/production review entry point launches, there must be a minimal ExternalApp governance action type, minimal ExternalApp execution adapter, and execution receipt record.
- If those minimum governance integrations are not complete, related routes may only remain at sandbox/dev seed or local admin tool level. They must not be described as production review.
- Alcheme admin or multisig review is allowed, but it must be recorded through `GovernanceRequest`, `GovernanceDecision`, and `GovernanceExecutionReceipt`. Do not create a parallel review table or private review state machine.
- Off-chain DB can record ExternalApp, but changes to app status, discovery status, managed node policy, and capability policy must land through the ExternalApp execution adapter and leave execution receipts.
- Sandbox, dev, and production must be clearly separated.
- Complaints first affect risk score.
- App store delisting and service suspension must be separated.

V2:

- ExternalApp Registry on-chain or chain-anchored.
- Manifest hash.
- Owner Bond, Community Backing, and complaint challenge pool.
- Multisig review and on-chain events.
- ExternalApp action types, read models, and execution adapter expand from minimal usable form to a complete strategy set, with tests stabilized.

V3:

- optimistic dispute
- governance/arbitration module
- appeal window
- automatic capital settlement execution

V4:

- stake for self-hosted public service nodes
- node service-error challenges
- registry/network-level reputation

## 10. Self-Hosted Compatible Nodes

### 10.1 Why Self-Hosted Nodes Are Needed

External projects may want to:

- control their own costs
- preserve data and privacy boundaries
- provide their own voice, AI, or sidecar capabilities
- avoid depending on Alcheme managed nodes
- reduce latency in high-concurrency games

Self-hosted nodes should therefore be an allowed direction.

### 10.2 Minimum Requirements For Self-Hosted Nodes

Private self-use node:

- Can sync Alcheme chain state.
- Can provide query-api-compatible routes.
- Can expose `/sync/status`.
- Can expose `/api/v1/extensions/capabilities`.
- Can correctly validate ExternalApp and user sessions.
- Can run conformance tests.

Public service node:

- Requires node registration.
- Requires operator identity.
- Requires service terms.
- Requires uptime and sync monitoring.
- Requires Node Stake, node bond, or reputation mechanism.
- Can be challenged for incorrect service.

### 10.3 Relationship With Alcheme Managed Nodes

A self-hosted node can be protocol-compatible, but it does not automatically
inherit the reputation of an Alcheme managed node.

The Alcheme frontend or SDK may let users choose among:

- official managed node
- app-owned node
- community node
- private sidecar

The SDK should use capabilities to determine whether a node supports required
features. It must not assume all query-api deployments are equivalent.

## 11. Developer Integration Path

### 11.1 Quick Browser Game Integration

Target experience:

```ts
const client = createAlchemeRuntimeClient({
  apiBaseUrl,
  wallet,
});

await client.joinExternalRoom({
  externalAppId: "last-ignition",
  roomType: "party",
  externalRoomId: "coop-restore-ring",
  appRoomClaim,
});
```

The SDK should internally handle:

- resolve room
- sync member
- create communication session
- request voice token
- typed errors

### 11.2 Server Integration

The external game server is responsible for:

- storing the app server private key
- signing `appRoomClaim`
- syncing in-game room/member/role state
- receiving webhooks
- handling key rotation

Example:

```ts
const claim = await alchemeServer.signAppRoomClaim({
  externalAppId,
  roomType,
  externalRoomId,
  walletPubkeys,
  roles,
  expiresIn: "10m",
  audience: "https://demo.alcheme.site",
});
```

### 11.3 Client-Only App Integration

Recommended path for apps without a server:

1. Use sandbox/dev environments to validate SDK and experience.
2. Use user-owned rooms or a low-trust self-hosted node.
3. If production app-owned rooms are required, add server signing capability or apply for Alcheme hosted claim service.
4. Hosted claim service means Alcheme custodies app authority and therefore needs stricter review, quota, and accountability boundaries.
5. Hosted claim service does not allow high-trust/featured by default, does not allow broad room/member authority, and must issue short-lived least-privilege claims.

Client-only apps should not receive the same production permissions as
server-backed apps just because their integration path is simpler.

### 11.4 Production Registration

Target flow:

1. Developer connects owner wallet.
2. Developer fills in basic app information.
3. Developer uploads or enters the server public key.
4. Developer deploys `.well-known/alcheme-app.json`.
5. Node verifies domain and manifest.
6. Developer posts Owner Bond.
7. App enters pending/review or an optimistic challenge window.
8. After approval, status becomes active.
9. Node starts allowing production quota.

## 12. Risk Register

| Risk | Impact | Design Response |
| --- | --- | --- |
| Fake app impersonates a real app | Users are phished | Domain manifest + owner wallet + server key + Verify-like risk state |
| Browser forges requests | Fake rooms or node abuse | `appRoomClaim` must be server-signed |
| CORS is mistaken for auth | Server-side requests bypass it | CORS is only browser policy. Business permission still checks claim/session |
| App self-funds high trust | Discovery is manipulated | Backing only affects Backing Level, uses diminishing returns, and does not decide Trust directly |
| Competitor funds complaint attack | Good app is downgraded or delisted | Evidence window, bond, usage-record weighting, appeal |
| New accounts spam complaints | Risk score is distorted | New accounts have lower weight; real usage records increase weight |
| App store delisting is confused with service shutdown | External developers fear excessive platform power | Split `DiscoveryStatus`, `ManagedNodePolicy`, `CapabilityPolicy`, and `RegistryStatus` |
| Backing becomes financialized | Compliance and speculation risk | No yield promises, Owner Bond separated from Community Backing, capped Challenger rewards |
| Non-Web apps are harmed by a CORS-only model | Native/desktop integration becomes difficult | Manifest adds platform bindings, bundle ids, redirect URIs, and server callbacks |
| Client-only app receives excessive authority | App claim key is leaked or forged | Client-only apps are limited to sandbox/user-owned rooms; production app-owned rooms require server-backed or hosted claim |
| Self-hosted node returns incorrect data | Users see incorrect state | Sync status, capabilities, conformance, node reputation, and challenges |
| Server key leak | Claims are forged | Key rotation, short expiry, nonce, revocation |
| Voice provider unavailable | API succeeds but media fails | Provider health check and typed unavailable error |
| Too much moves on-chain | High cost and slow iteration | Store only trust roots and hashes on-chain; keep detailed config in manifest/DB projection |

## 13. Relationship To Existing Implementation Plan

The existing `2026-05-13-external-game-integration-hardening-plan.md` should be
downgraded to a V1 repair plan. It should no longer carry the complete product
architecture definition.

Parts that remain valid:

- ExternalApp onboarding.
- CORS using allowedOrigins.
- Member sync encapsulation.
- Typed errors.
- Local LiveKit quickstart.
- SDK runtime improvements.

Parts that need adjustment based on this document:

- Do not describe a DB admin route as the final production registry.
- Clearly separate sandbox, dev, and production environments.
- Add manifest and owner wallet verification direction.
- Add a Server SDK direction.
- Add later-stage ExternalApp Registry.
- Add backing/complaint challenge mechanisms as the mainnet trust market.
- Add capital layering for Owner Bond, Community Backing, and Protocol Risk Pool.
- Add state layering for app store delisting, managed node downgrade, capability-level restrictions, and emergency service holds.
- Add integration boundaries for client-only apps and native/desktop apps.
- Clarify that self-hosted node compatibility is not complete just because a capabilities endpoint exists.
- Clarify that ExternalApp review reuses existing Circle/Governance abstractions, adding only action types, binding configuration, and an execution adapter. Do not add a parallel review system.

## 14. Staged Roadmap

### Phase A: Confirm Product Architecture

Deliverables:

- This document.
- Update the hardening plan so V1 repairs and mainnet targets are separate.
- List the follow-up contract design plan for ExternalApp Registry.

### Phase B: V1 Developer Experience Repairs

Goals:

- External games can connect to local/dev nodes without manual DB seeding.
- SDK can join a room in one call.
- Errors are understandable.
- CORS is configurable.
- Local LiveKit path is clear.
- Local/dev may use seed or admin route, but any production review entry point must not bypass Governance audit trails from the start.
- Phase B does not implement production review. If an admin route remains, it only serves sandbox/dev or operator bootstrap.

### Phase C: Server SDK And Manifest

Goals:

- External servers can sign claims.
- Manifest can be verified.
- Owner wallet and server key are bound.
- SDK package boundaries are clear.
- Manifest covers Web, native, desktop, and server callbacks.
- Client-only access path is clearly downgraded.
- Add configuration shape for ExternalApp review circle/policy binding so manifest, owner wallet, server key, and review policy can be linked.
- Define minimal ExternalApp governance action types and a minimal execution adapter interface as prerequisites for the Phase D production registry.

### Phase D: Production Registry

Goals:

- ExternalApp Registry on-chain or chain-anchored.
- Manifest hash.
- Owner Bond.
- App status.
- Key rotation.
- Registry projection into query-api.
- Implement minimal ExternalApp governance action types.
- Implement minimal ExternalApp execution adapter.
- App status, discovery status, managed node policy, and capability policy can only be updated by explicit registration flows, governance decisions, or emergency node policy. They must not be changed directly in scattered business routes.

### Phase E: Backing And Challenge

Goals:

- Owner Bond.
- Community Backing.
- Protocol Risk Pool.
- Funded complaints.
- Risk score.
- Dispute thresholds.
- Multisig/governance ruling.
- Capital settlement.
- App store delisting and service suspension remain separate.

### Phase F: Self-Hosted Node Network

Goals:

- conformance tests
- node registration
- node reputation
- service challenges
- stable public/private/sidecar routing

## 15. Explicit Non-Goals

At the current stage:

- Do not make complaint amount directly split backing principal.
- Do not make backing amount equal aggregate trust.
- Do not package Community Backing as an investment or yield product.
- Do not equate app store delisting with service shutdown.
- Do not shut down the entire app by default because one capability is risky.
- Do not let the browser sign app authority claims.
- Do not bring `wallet_only_dev` into production.
- Do not hard-code the Alcheme demo URL into npm packages.
- Do not require DAO arbitration in the first version.
- Do not create parallel tables such as `ReviewCommittee`, `ReviewVote`, or `ReviewDecision` to replace Circle/Governance.
- Do not require a full self-hosted node staking network in the first version.

## 16. Open Decisions

These do not block the product document, but they will affect implementation
parameters:

- Minimum Owner Bond for mainnet production.
- Community Backing lockup period.
- Minimum challenge bond.
- Light and heavy dispute thresholds.
- Curve for increasing complaint weight based on usage records.
- Weight discount for app owner self-backing.
- Minimum operating time for featured apps.
- Maximum temporary duration for `emergency_hold`.
- Which capabilities can be restricted independently and their default downgrade strategies.
- Maximum Community Backing loss cap.
- Whether client-only apps should receive a hosted claim service.
- Whether to integrate an external arbitration protocol or start with Alcheme multisig/governance.
- Whether public self-hosted service nodes require stake from V1.

## 17. Final Product Judgment

This mechanism is worth building, but it must be designed as a credit market
plus governance arbitration plus node execution. It should not become a simple
capital wager.

The right shape is:

- ExternalApp establishes identity through an on-chain or chain-anchored registry.
- Manifest proves domain and capability declarations.
- Server claim proves app room authority.
- Wallet session proves the user's own action.
- Owner Bond provides the first source of accountability.
- Community Backing provides limited economic backing.
- Challenge pool gives complaints a cost.
- Dispute resolution handles subjective conflicts.
- Nodes enforce access control, quota, rate limits, capability-level restrictions, and rare emergency suspensions.

This design can significantly reduce manual review cost without turning Alcheme
into a system where "whoever pays more is trusted," "whoever complains more
wins," or "the platform can arbitrarily shut down external apps."
