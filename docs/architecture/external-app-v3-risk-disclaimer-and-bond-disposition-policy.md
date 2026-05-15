# External App V3 Risk Disclaimer And Bond Disposition Policy

Status: implementation baseline for V3C.

## Boundary

V3C adds participant risk acceptance and rule-based bond disposition. It does not add loss coverage, user claims, payout queues, refund promises, protection products, or platform liability. Alcheme provides protocol rules, evidence receipts, governance records, discovery surfaces, SDKs, and managed-node capabilities. External app operators and participants accept their own app rules, risks, and consequences.

## Required Acceptance

Before production registration, external-app entry, or any bond-affecting action,
the relevant actor must accept a scoped risk disclaimer. The receipt records:

- external app id hash
- actor pubkey
- scope: `developer_registration`, `external_app_entry`, `challenge_bond`, or
  `bond_disposition`
- policy epoch digest
- terms digest
- acceptance digest
- accepted timestamp

Hash-only acceptance is enough to prove which terms were accepted, but the referenced terms must remain retrievable by the client or reviewer path before any bond-affecting action is shown as valid.

For `developer_registration`, the acceptance digest also binds to the manifest
hash. A production registration request without a matching chain-backed
developer agreement must not enter governance review.
Changing the manifest requires a new developer agreement acceptance. The chain
receipt PDA remains deterministic for the same external app, actor, and scope,
and the latest acceptance overwrites the prior receipt data at that PDA.

User-facing entrypoints:

- `GET /api/v1/external-apps/risk-disclaimers/:scope`
- `POST /api/v1/external-apps/:appId/risk-disclaimer-acceptances`
- `POST /api/v1/external-apps/:appId/production-registration-requests` with
  `developerAgreement`

The full terms are served off chain for readability and versioning. Solana only
stores digest-level receipt data: app id hash, actor, scope, terms digest,
acceptance digest, and policy epoch digest. Query API stores the matching PDA,
receipt digest, and transaction signature for reconciliation. In production,
Query API must verify the PDA, account discriminator, app id hash, actor, scope,
terms digest, acceptance digest, account-data digest, and transaction status
before accepting the receipt metadata.

## Bond States

Allowed V3C bond-disposition states are:

- `unlocked`: bond is not reserved for a disposition case.
- `locked_for_case`: bond is reserved for a specific case and cannot be reused.
- `released`: the case released the lock without routing the bond.
- `forfeited`: the case has a receipt-bound ruling that permits policy routing, but routing has not executed yet.
- `routed_by_policy`: a forfeited amount was moved by policy receipt.
- `paused`: new bond exposure is paused; existing rule-bound cases remain governed by their policy.

## Routing

Forfeited bond routing is rule execution under the active policy and receipts. A routing receipt must include app id hash, case id, receipt id, policy id, amount, source token account, destination token account, authority, and routing digest. The destination must never be labeled as Alcheme compensation, reimbursement, guarantee, insurance, refund, principal protection, or make-whole recovery.

## Prohibited Product Language

User-facing copy, SDK docs, API fields, policy names, and receipts must not use these meanings for V3C: compensation, payout, insurance, guarantee, refund, principal protection, make-whole protection, platform liability, loss coverage, or Alcheme-backed recovery.

Allowed language: risk notice, participant-posted bond, rule-based bond disposition, locked bond, released bond, forfeited bond, routed by policy, evidence receipt, governance receipt, and appeal/correction path.

## Related Parties

Related-party roles are projection inputs, not independent public endorsement. Default roles are owner, team, affiliate, sponsor, paid promoter, node operator, reviewer, and competitor. These roles may reduce support independence, change review routing, or trigger disclosure requirements.

## Acceptance Gates

V3C can be enabled only when:

- scoped risk disclaimer receipts exist for developer registration, entry, and
  bond-affecting actions;
- active policy epoch and asset allowlist are resolved;
- subjective actions require governance or arbitration receipts;
- evidence availability satisfies the evidence-retention policy;
- no public surface presents V3C as coverage, refund, protection, or Alcheme responsibility.
