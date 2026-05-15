# External Program V3 Evidence Privacy And Retention Policy

Status: implementation baseline for V3A no-custody evidence projection.

Alcheme evidence handling separates authenticity, availability, and display. An
`evidenceHash` identifies an evidence package, but subjective punishment requires
the underlying material to remain available to authorized reviewers.

## Visibility Tiers

- `public`: chain transactions, public receipts, public case summaries, and
  non-sensitive node status.
- `reviewer_only`: raw node logs, signed app logs, user reports, service
  callback records, and support materials needed for review.
- `sealed`: private messages, voice transcripts, minors' data, commercial
  secrets, extortion reports, vulnerability details, and process-gated material.

Redaction is a display state, not an authority tier. A redacted public summary
must point back to the original evidence hash and source receipt.

## Action Eligibility

- Tier 1: chain transactions, signed receipts, or Alcheme session plus signed
  app event. These may support deterministic or semi-automatic action when the
  active policy permits it.
- Tier 2: Alcheme usage record plus app server signed incident report. These
  require validation before action.
- Tier 3: screenshots, chat logs, support tickets, or third-party records. These
  may trigger review, risk scoring, and public caution labels, but not automatic
  bond release, slash, revocation, or protocol-level punishment.
- Tier 4: unverifiable material or AI summary without source evidence. These are
  weak risk signals only.

Unavailable, screenshot-only, AI-summary-only, hash-only, or retention-missing
evidence can downgrade risk score, reopen evidence collection, or trigger
review, but cannot trigger automatic bond release, slash, revocation, or
protocol-level punishment.

## Evidence Loss

If evidence becomes unavailable before the response window ends, downgrade,
pause, or reopen evidence collection unless remaining Tier 1 machine-verifiable
evidence is sufficient.

If evidence becomes unavailable during appeal, pause settlement and reopen review
unless remaining Tier 1 machine-verifiable evidence is sufficient.

If evidence becomes unavailable before settlement execution, block bond release,
slash, revocation, and protocol-level punishment unless remaining Tier 1
machine-verifiable evidence is sufficient.

If evidence expires after the required retention window, preserve hash, receipt,
chain-of-custody metadata, and redacted summary where allowed. Reopening requires
new available evidence.

If Alcheme, an official node, or an operator caused evidence loss, do not punish
the target app based on that loss. Open correction and audit logging instead.
This is not compensation, reimbursement, guarantee, insurance, refund, principal
protection, make-whole protection, or platform liability.
