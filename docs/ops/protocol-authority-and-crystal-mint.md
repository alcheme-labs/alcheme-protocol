# Protocol Authority and Crystal Mint Operations

_Last updated: 2026-04-28_

This runbook records the current wallet/authority facts for Alcheme protocol operations. It is intentionally about operational boundaries, not private key values. Never commit real secrets or production keypairs.

## Why This Exists

Crystal NFT minting introduced another authority secret (`CRYSTAL_MINT_AUTHORITY_SECRET`). That is technically workable, but it creates unnecessary operational burden if every protocol-side action requires a separate wallet to maintain.

The product expectation is:

- Users sign user actions with their own wallet.
- Protocol/backend actions are operated by a small number of protocol-controlled signers.
- Local/demo environments should not require manually maintaining a separate NFT wallet.
- Production may separate authorities for blast-radius control, but that separation must be deliberate and documented.

## Current Authority Surface

| Surface | Current config | Current purpose | Operational note |
| --- | --- | --- | --- |
| User wallet | Browser wallet / native wallet | User-owned identity and user-approved transactions | Not an ops wallet. Do not reuse backend keys for this. |
| Anchor/program operator wallet | `ANCHOR_WALLET`, `ANCHOR_SIGNER_KEYPAIR_PATH` | Local deployment, local signer service, tracker/program operations | This is the natural local/demo protocol signer. |
| Draft proof issuer | `DRAFT_PROOF_ISSUER_KEY_ID`, `DRAFT_PROOF_ISSUER_SECRET` | Signs draft proof packages | This is a proof-signing key, not necessarily a chain wallet from the user's perspective. |
| Membership bridge issuer | `MEMBERSHIP_BRIDGE_ISSUER_KEY_ID`, `MEMBERSHIP_BRIDGE_ISSUER_SECRET` | Signs membership bridge payloads | Local script can derive this from `ANCHOR_WALLET` when unset. |
| Reference materialization authority | `REFERENCE_MATERIALIZATION_AUTHORITY_SECRET` or `CONTRIBUTION_ENGINE_AUTHORITY_SECRET` | Writes crystal reference edges on-chain | Should be treated as protocol authority. Avoid creating a separate manual wallet unless production separation requires it. |
| Crystal NFT mint authority | `CRYSTAL_MINT_AUTHORITY_SECRET` | Creates Token-2022 mint accounts, initializes metadata, mints master assets and contribution receipts | Currently separate. For local/demo operations, this should converge to the protocol signer instead of being another wallet to maintain. |

## Current Code Facts

These are current implementation facts, not necessarily the desired final shape.

- `services/query-api/src/config/services.ts` loads crystal mint config from:
  - `CRYSTAL_MINT_RPC_URL`
  - `CRYSTAL_MINT_AUTHORITY_SECRET`
  - `CRYSTAL_MASTER_OWNER_PUBKEY`
  - `CRYSTAL_METADATA_BASE_URL`
- If `CRYSTAL_MINT_RPC_URL` and `CRYSTAL_MINT_AUTHORITY_SECRET` are both present, query-api uses `token2022_local` minting.
- If either is missing outside production, query-api falls back to `mock_chain` minting.
- In production, missing real mint credentials throws `crystal_mint_credentials_required`.
- `scripts/start-local-stack.sh` defaults `CRYSTAL_MINT_RPC_URL` to the local `$RPC_URL`.
- `scripts/start-local-stack.sh` currently leaves `CRYSTAL_MINT_AUTHORITY_SECRET` empty unless explicitly provided.
- Existing mock-minted rows are not automatically reminted after real credentials are added. The asset job skips rows that are already `mintStatus = minted` with an address.
- Frontend labels any `assetStandard` or address starting with `mock_chain` / `mock_` as demo/mock UI.
- Reference materialization config is loaded separately in `services/query-api/src/services/draftReferences/referenceMaterializationClient.ts` from:
  - `REFERENCE_MATERIALIZATION_RPC_URL` or `SOLANA_RPC_URL` or `RPC_URL`
  - `REFERENCE_MATERIALIZATION_AUTHORITY_SECRET` or `CONTRIBUTION_ENGINE_AUTHORITY_SECRET`
  - `CONTRIBUTION_ENGINE_PROGRAM_ID` or `NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID`

## Desired Operational Rule

For local/demo deployments, maintain one protocol signer by default:

```text
ANCHOR_WALLET / anchor-signer keypair
  -> program/local protocol operations
  -> reference materialization authority
  -> crystal mint authority
```

For production, authority separation is allowed, but it should be explicit:

- Separate mint authority only if the deployment needs reduced blast radius for NFT minting.
- Separate reference authority only if the contribution-engine program requires different permissions or custody.
- Store all production secrets in the deployment secret manager or server-local env files, never in git.
- Document which authority owns which permission before deploy.

## Local Development Setup

Until the startup script is improved, the local way to force real Token-2022 minting is:

```bash
CRYSTAL_MINT_RPC_URL=http://127.0.0.1:8899 \
CRYSTAL_MINT_AUTHORITY_SECRET="$(tr -d '\n' < "$ANCHOR_WALLET")" \
./scripts/start-local-stack.sh
```

If `ANCHOR_WALLET` is unset, it usually defaults to:

```bash
$HOME/.config/solana/id.json
```

Make sure that signer has local SOL:

```bash
solana airdrop 10 "$(solana-keygen pubkey "$ANCHOR_WALLET")" --url http://127.0.0.1:8899
```

If the Solana CLI is not on `PATH`, point `SOLANA_BIN` and `SOLANA_KEYGEN_BIN` at the locally installed binaries:

```bash
SOLANA_BIN=/path/to/solana
SOLANA_KEYGEN_BIN=/path/to/solana-keygen

"$SOLANA_BIN" airdrop 10 \
  "$("$SOLANA_KEYGEN_BIN" pubkey "$ANCHOR_WALLET")" \
  --url http://127.0.0.1:8899
```

## Demo / Server Deployment Notes

- Server-local env and key files must survive git deploys.
- Do not run destructive cleanup commands such as `git clean -fdx` on the server if local `deploy/demo` config or keys are present.
- If the server uses a server-local deployment env file, keep mint/reference authority values there or in the server's secret manager.
- Prefer one server-local protocol signer for demo unless there is a specific reason to split authorities.

## Handling Existing Demo Assets

If a crystal already has `mock_chain_*` asset or receipt rows, adding real mint credentials later does not mutate those rows automatically.

Operational choices:

1. Leave old demo rows as historical demo data.
2. Clear/requeue the affected crystal asset and receipt projections, then rerun issuance.
3. Create a new crystal after real mint config is active.

Do not silently present existing `mock_chain_*` rows as real NFT assets.

## Recommended Follow-Up Implementation

These are product/ops improvements, not current facts:

1. Make `scripts/start-local-stack.sh` default `CRYSTAL_MINT_AUTHORITY_SECRET` from `ANCHOR_WALLET` when unset, mirroring the local membership bridge behavior.
2. Consider a single `PROTOCOL_AUTHORITY_SECRET` or anchor-signer-backed config that can feed reference materialization and crystal minting.
3. Move crystal minting to the existing `anchor-signer` path so query-api does not need to hold raw private key material.
4. Fail loudly when real minting is expected but authority config is missing, instead of silently writing demo assets.
5. Add an operator command for reminting/requeueing mock assets after enabling real mint config.

## Review Boundary

The review finding about `referenceMaterializationClient` using an independent Anchor writer is related but separate:

- It is a code-boundary issue: query-api now has a second on-chain writer implementation that can drift from the SDK.
- It is not a reason to create yet another wallet.
- The operational target remains one protocol signer for local/demo, with optional explicit separation only in production.
