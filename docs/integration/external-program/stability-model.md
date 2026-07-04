# External Program Stability Model

Status: public stability and risk-label model summary.

This document explains how external program trust, discovery, capability, and
economic signals should be interpreted by clients and developers. It is not a
production legal agreement, settlement runbook, or private operator policy.

## Core Principle

External program stability is layered. No single signal makes an app safe,
endorsed, insured, or guaranteed.

```text
Layer 1: registered identity and manifest facts
Layer 2: operator discovery and capability policy
Layer 3: risk disclaimers and receipt evidence
Layer 4: optional bond, challenge, and rule-execution state
Layer 5: governance or arbitration for subjective and high-risk cases
```

Money, bonds, or backing may increase accountability, but money alone must not
buy trust. Negative feedback may affect risk labels, ranking, or review state,
but subjective punishment should require evidence and governance or arbitration
where applicable.

## Public Status Families

Compatible runtimes may expose status labels in these families:

| Family | Meaning | Boundary |
| --- | --- | --- |
| Registry | Whether app identity and manifest facts are anchored or recognized | Registry status is not a safety guarantee. |
| Discovery | Whether the app appears in official discovery surfaces | Listing is not endorsement. |
| Managed-node access | Whether the app can use operator-managed runtime paths | Access can be limited, downgraded, or revoked separately from discovery. |
| Capability policy | Which runtime capabilities are enabled | Capabilities can differ by environment and review state. |
| Risk/disclaimer | Which scoped terms users or developers accepted | Receipts prove acknowledgement, not risk removal. |
| Stability projection | Aggregated operational and governance state | Projection helps explain state; it is not compensation or insurance. |

## Developer Agreement And Receipts

Production registration requires the developer to review scoped terms and submit
receipt evidence. The receipt binds to the manifest hash and active review
policy version id.

If the manifest changes materially, the developer agreement acceptance must bind
to the new manifest hash. Reusing a stale manifest hash or stale policy epoch
should be rejected by the operator runtime.

## Bond And Challenge Boundary

Some environments may expose bond or challenge state. Treat that state as
rule-execution and accountability infrastructure.

It must not be described as:

- Alcheme compensation.
- user reimbursement.
- insurance.
- refund coverage.
- principal protection.
- platform liability.
- a make-whole promise.

Participant-posted bonds may be locked, released, forfeited, or routed only by
active policy and valid receipts. Subjective disputes should preserve evidence,
response, and appeal windows when the operator or governance policy requires
them.

## Emergency And Downgrade Boundary

Emergency controls should be narrow, receipt-bound, and time-limited. They may
pause official exposure or managed-node capability when a serious risk appears.

They should not be treated as a generic right to shut down an external program
outside Alcheme-managed surfaces. App-store delisting, managed-node downgrade,
capability limits, registry revocation, and service suspension are separate
states.

## Client Display Guidance

Client UI should use plain status language:

- `sandbox`: development or demo registration only.
- `review_pending`: production review request opened but not executed.
- `listed`: visible in discovery.
- `limited`: access or capability restrictions apply.
- `risk_disclaimer_required`: user or developer must review scoped terms before
  entering an action.
- `status_sync_pending`: operator projection has not caught up with registry or
  execution receipts.
- `revoked` or `delisted`: official exposure removed.

Avoid language such as safe, guaranteed, insured, protected, covered, certified,
or endorsed unless a later product/legal review explicitly creates that product
meaning.

## External Developer Checklist

For a production-facing external program:

- Keep manifest, owner wallet, server key, origins, callbacks, and capabilities
  stable across review.
- Use the active review policy version id from
  `GET /api/v1/external-apps/review-policy/current` when computing the developer
  agreement receipt.
- Recompute receipts when terms, policy epoch, or manifest hash changes.
- Surface scoped risk disclaimers before users enter risky actions.
- Treat discovery and stability labels as context, not permission to bypass
  runtime checks.
- Keep app-operated routes clearly separate from Alcheme managed-node paths.
