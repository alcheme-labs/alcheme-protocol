# SVM Rollup Route Record

Status: architecture debt / future adapter route

Alcheme is SVM-first, but not SVM-rollup-first. The current V1 settlement path remains Solana L1 through the settlement-neutral `SettlementAdapter` boundary.

This document records the future SVM rollup or appchain route so the option is not lost, while making clear that production migration requires separate evidence and approval.

## Current Mainline

```text
Solana L1 settlement adapter
  + settlement-neutral proof core
  + batched anchors where useful
  + compressed receipts where appropriate
  + future SVM rollup adapter path preserved
```

## What This Route Means

An SVM rollup route means Alcheme may later evaluate a SVM-compatible execution environment where Solana-style programs and transactions execute outside Solana L1, while the rollup publishes state commitments, data, proofs, or settlement records to another layer.

The preferred migration shape is adapter-based:

```text
Proof payloads
  -> SettlementAdapter
  -> Solana L1 adapter now
  -> future SVM rollup adapter only if gates pass
```

The route should not require product semantics to be rewritten around a specific rollup vendor.

## What This Route Does Not Mean

This document is not approval to:

- migrate production settlement now
- replace Solana L1 as the default V1 settlement path
- move normal chat, voice, moderation, or game membership sync on-chain
- make receipt or master asset issuance part of `SettlementAdapter`
- rewrite user-facing product behavior around a rollup before the adapter path is proven

## Architecture Invariants

These must remain true unless a later architecture decision explicitly replaces them:

1. `SettlementAdapter` handles anchors, checkpoints, and settlement evidence only.
2. Receipt and master asset issuance remain outside `SettlementAdapter`.
3. `CrystalEntitlement` remains gate truth.
4. `CrystalReceipt` remains credential and evidence, not the only gate truth.
5. Governance V1 remains off-chain and policy-based.
6. Governance V2 may anchor canonical digests through the settlement adapter.
7. Governance V3 on-chain execution is selective and reserved for protocol-grade actions such as upgrades, treasury, or asset-control decisions.
8. Communication rooms, voice sessions, normal moderation, and game membership sync stay off-chain by default.
9. Product APIs should expose proof status, not raw rollup vendor concepts.
10. Indexer and read-model code must expose finality explicitly if rollup finality differs from Solana L1.

## When A Spike Is Allowed

A non-production P7 spike may start only by explicit project decision.

Allowed spike work:

- shortlist one or two concrete SVM rollup or appchain candidates
- verify Anchor, PDA, Memo, Token-2022, CPI, RPC, wallet, and upgrade-authority compatibility
- build a branch-local or non-production settlement adapter candidate
- submit or simulate draft anchor and governance digest payloads
- map indexer checkpoints and finality semantics
- produce cost, operations, security, bridge, and vendor-risk findings

Not allowed during a spike:

- changing the production default settlement path
- making application users switch RPCs
- adding a hard dependency on a rollup provider to frontend or query-api
- issuing receipts or master assets through the settlement adapter
- treating the spike as production migration approval

## Production Migration Gates

Production migration can only be considered after at least one hard condition is met:

- single-month chain write cost exceeds 30% of the same-month server runtime cost
- one high-frequency operation P95 cost is 3x the current threshold and batching or compression cannot reduce it
- crystal receipt volume makes ordinary asset issuance uneconomic
- product requirements explicitly need app-specific execution, sponsored fees, custom ordering, or dedicated throughput that Solana L1 plus batching/compression cannot satisfy
- the team has chain infrastructure SRE, security response, bridge, and node operation capacity

If none of these conditions are met, the default decision is to stay on Solana L1 settlement and preserve the rollup route as future architecture debt.

## Candidate Evaluation Checklist

Every candidate must be evaluated against:

| Area | Required Question |
| --- | --- |
| SVM compatibility | Can current Anchor programs build and deploy? Which sysvar, CPI, Token-2022, Memo, or rent paths differ? |
| RPC and wallet compatibility | Can existing `@solana/web3.js` clients use it with endpoint/config changes only? |
| Program identity | Are Program IDs, upgrades, and authorities compatible with the current operations model? |
| Settlement and DA | Where are commitments, data, or proofs published? What is the verification path? |
| Finality | What is the user-visible finality model and rollback/reorg risk? |
| Bridge | What assets or messages need bridging, if any? What is the failure mode? |
| Indexer | Can `indexer-core` project events deterministically? What new cursors/checkpoints are needed? |
| Cost | What are P50/P95/P99 costs for draft anchors and receipt-like paths? |
| Operations | Who runs nodes, monitors liveness, responds to incidents, and handles upgrades? |
| Vendor risk | Is the provider stable enough for Alcheme mainnet commitments? |

## Required Public Artifacts Before Migration

Before any production migration proposal, the repository must contain public, reviewable artifacts for:

- candidate comparison
- Anchor/Solana compatibility audit
- settlement adapter spike results
- indexer/finality mapping
- cost and operations report
- security and bridge risk assessment
- rollback plan

The expected recommendation values are:

- `stay_sol_l1`
- `continue_spike`
- `prepare_migration_decision`
- `reject_candidate`

No candidate should bypass this artifact trail.
