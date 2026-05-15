# External App V3 Emergency Authority Matrix

This document defines the implementation baseline for ExternalApp V3 emergency controls.
Emergency authority is a scoped correction mechanism for protocol and official managed-node risk. It is not an app shutdown system, not a public self-hosted node control system, and not a source of Alcheme responsibility for external app outcomes.

## Scope

Emergency actions must prefer the narrowest effective control:

1. Capability temporary limit.
2. Official managed-node throttling or restriction.
3. Official managed-node emergency hold.
4. App-store temporary hidden or limited state.
5. New economic exposure pause.
6. External route warning.
7. Registry `suspended`.
8. Registry `revoked`.

An emergency hold on an official managed node does not imply self-hosted node shutdown, external-app shutdown, app-store delisting, registry suspension, or registry revocation.

## Required Receipt Fields

Every emergency action must record:

- `actionScope`
- affected capabilities
- operator or committee identity
- evidence digest
- start time
- expiry time
- existing-session effect
- owner notification status
- appeal route
- source governance, arbitration, or operator receipt

The action must be temporary, scoped, receipt-bound, and appealable.

## Duration Defaults

- Capability limits and managed-node throttles: maximum 24 hours before review.
- Official managed-node emergency hold: maximum 48 hours before governance extension.
- App-store hidden or limited state: maximum 72 hours before governance extension.
- New economic exposure pause: maximum 72 hours before governance extension.
- Registry `suspended`: requires active governance or arbitration receipt and an expiry or review deadline.
- Registry `revoked`: requires final adjudication or clear machine-verifiable severe violation under active policy.

## Severe Violation List

Registry revocation may be considered only for:

- Valid proof of key compromise affecting protocol receipts.
- Valid proof of malicious receipt forgery or replay.
- Valid proof of bypassing required risk-disclaimer or bond-disposition receipts.
- Valid proof of repeated managed-node abuse after governance-backed suspension.
- Final governance or arbitration decision requiring registry revocation.

Public complaints, weak evidence, unresolved projection disputes, app-store ranking concerns, or external route concerns are not enough for registry revocation.

## Owner Notice And Appeal

The owner must receive notice for every emergency action unless notice itself would materially worsen an active key-compromise incident. The action record must still state why notice was delayed and when notice becomes required.

Every emergency action must include an appeal route. Appeals may use the active `external_app_appeal` governance role binding or an arbitration reference that remains bound to a GovernanceExecutionReceipt.

## Correction Receipts

If an emergency action was too broad, expired, unsupported by evidence, or based on stale projection data, a correction receipt must be recorded. Correction receipts must identify the prior action, correction digest, actor, evidence digest, and resulting state.

## Wording Boundary

Emergency controls reduce misuse risk and protect protocol integrity. They do not make Alcheme a compensating party, insurer, guarantor, fiduciary, principal protector, or liability-bearing operator for external app behavior or participant outcomes.
