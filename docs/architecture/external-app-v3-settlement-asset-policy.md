# External Program V3 Settlement Asset Policy

Status: Phase 2 implementation baseline before custody code.

## Defaults

- Local/devnet may use a project-created SPL Token test mint with 6 decimals.
- Production starts with `EXTERNAL_APP_SETTLEMENT_ASSET_MODE=disabled`.
- Production asset allowlist starts empty.
- Custody code may be deployed while production assets remain disabled by
  allowlist.
- The first real production candidate is Solana USDC, activated only by policy
  epoch allowlist after readiness checks.
- SOL, an Alcheme token, arbitrary SPL mints, and Token-2022 extension assets
  are not accepted as first production settlement assets.

## Local And Devnet Test Mint

Local/devnet bootstrap may create a simple SPL Token mint when:

- `EXTERNAL_APP_SETTLEMENT_ASSET_MODE=test_mint`
- `EXTERNAL_APP_SETTLEMENT_TEST_MINT` is empty
- target environment is `local` or `devnet`

The bootstrap must refuse production. It should print
`EXTERNAL_APP_SETTLEMENT_TEST_MINT` after creating the mint and mint only test
balances for development wallets.

## Production Operations

Production allowlist activation requires:

- active policy epoch id
- mint address
- token program id
- decimals
- symbol and display name
- per-app, per-case, and per-user raw caps
- withdrawal lock seconds
- activation receipt id

Paused assets reject new exposure. Retired assets are withdrawal-only for
existing rule-bound cases. Disabled assets reject all new settlement requests.

## Receipt Requirements

Every fund movement must include:

- policy epoch id
- external program id hash
- case id when applicable
- mint
- amount
- authority
- receipt digest

Subjective settlement requires accepted governance or arbitration receipt.
Machine-verifiable settlement is allowed only for explicitly configured case
classes.
