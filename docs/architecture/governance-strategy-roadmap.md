# Governance Strategy Roadmap

Status: architecture debt / staged implementation roadmap

Alcheme has a governance MVP, not the full governance strategy set. The current implementation is intentionally narrow so communication, voice, settlement proof, and audit preflight can stay stable before heavier voting models are added.

This document records the future governance strategy route so it remains visible to future contributors.

## Current Implemented Baseline

The current governance baseline is:

- off-chain query-api governance
- policy/request/signal/snapshot/decision/receipt model
- permission gateway integration
- canonical decision and audit digests
- governance audit preflight through the settlement-neutral proof boundary
- no direct on-chain execution

Implemented strategy subset:

- `authority.direct`
- `claim.external`
- `consent.unanimous`
- `pipeline.any`

This is enough for the current communication, voice, external-app claim, and transcription consent paths.

## Core Boundary

Governance should remain a standalone policy and decision engine.

Product modules should submit governed actions and consume decisions. They should not each implement their own voting, delegation, quorum, veto, timelock, or weighted tally logic.

```text
product module
  -> governed action request
  -> governance engine
  -> decision digest
  -> product execution adapter
```

## What Should Not Happen

Future contributors should not:

- create a second governance runtime beside the existing compatibility path
- make normal room moderation require full on-chain governance
- treat `CrystalReceipt` as the only gate or voting truth
- add arbitrary user-supplied JavaScript strategy execution
- mix strategy expansion into unrelated chat, voice, settlement, or UI work
- make governance V1 perform direct chain execution

## Strategy Expansion Order

### V1.1: Basic Member Voting

Start here when product flows need real member votes.

Candidate strategies:

- `approval.threshold`
- `vote.majority`
- `vote.supermajority`
- simple role-weighted voting
- `pipeline.all`
- basic timelock for accepted decisions

Appropriate actions:

- archive a circle
- remove a member from a long-lived circle
- approve a major room or circle configuration change
- approve a high-impact policy profile change

Required work:

- strategy implementations and tests
- policy config validation
- request lifecycle and expiry rules
- deterministic tally digest
- read model for pending/accepted/rejected decisions
- UI/API surfaces only where a product action actually uses the strategy

Do not include token, NFT, delegated, or quadratic voting in V1.1.

### V1.2: Weighted Governance With Frozen Truth Sources

Start only after entitlement and proof boundaries are stable.

Candidate strategies:

- `vote.weighted`
- crystal-entitlement-weighted voting
- role-plus-reputation weighting
- capped weighted voting

Required conditions:

- `CrystalEntitlement` remains gate truth
- receipt/master asset semantics are stable
- proof package and audit digest fields are stable
- weighting snapshots have deterministic digest and replay semantics

Do not use `CrystalReceipt` as the sole voting truth.

### V1.3: Advanced Off-Chain Voting Models

Start only if a concrete product community needs these mechanics.

Candidate strategies:

- `vote.delegated`
- `vote.approval_choice`
- `vote.ranked_choice`
- `vote.conviction`
- `optimistic.challenge`

Risks to handle:

- delegation loops
- delegation revocation and expiry
- Sybil resistance
- challenge windows
- stale snapshot replay
- voter privacy expectations
- result explainability

These strategies should stay off-chain until their operational and abuse risks are understood.

### V2: Auditable Governance Anchors

V2 adds optional settlement anchoring for governance artifacts.

Anchor candidates:

- policy version digest
- eligibility snapshot digest
- signal root
- decision digest
- execution receipt digest

The chain records proof of governance inputs and outputs. It does not necessarily execute the governed action.

V2 should use `SettlementAdapter` only for anchors, checkpoints, and settlement evidence.

### V3: Selective On-Chain Execution

V3 is for high-value actions where trust-minimized execution is worth the extra cost and security responsibility.

Possible V3 actions:

- protocol upgrades
- treasury or asset-control decisions
- extension registry authority changes
- selected crystallization or mint authority controls

Not default V3 actions:

- normal chat moderation
- game room membership sync
- voice controls
- temporary room lifecycle changes

## Implementation Trigger Rules

Do not implement a strategy just because it exists in the design.

Start a strategy expansion only when at least one is true:

- a real product action needs that strategy
- a governance UX/API surface is blocked by the missing strategy
- a protocol security decision needs a stronger decision rule
- a public audit requirement needs a stable digest/anchor path

If none of these are true, keep the strategy as planned technical debt.

## Required Checks Before Each Strategy Batch

Before implementing a new strategy batch:

1. Confirm the action type and product surface that will use it.
2. Confirm it extends the existing governance engine instead of creating a parallel runtime.
3. Define deterministic config validation.
4. Define deterministic snapshot and tally digests.
5. Define request expiry, cancellation, and replay behavior.
6. Add unit tests for accepted, rejected, pending, expired, malformed, and duplicate-signal cases.
7. Add route/read-model tests only for product surfaces that consume it.
8. Confirm no chain execution is introduced unless this is explicitly V3.

## Default Recommendation

Keep the current governance MVP as the default until a product action needs richer voting.

When richer governance is needed, implement the smallest strategy batch that unlocks that action, in this order:

```text
V1.1 basic member voting
  -> V1.2 frozen-truth weighted voting
  -> V1.3 advanced off-chain voting
  -> V2 audit anchors
  -> V3 selective on-chain execution
```

This avoids turning governance into a large unused framework while keeping the route visible and executable.
