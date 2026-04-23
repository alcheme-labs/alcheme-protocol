# Membership Attestor Registry Rollout

## What changed

- `circle-manager` now supports a `MembershipAttestorRegistry` PDA.
- `claim_circle_membership` accepts:
  - the legacy `circle_manager.admin` issuer for compatibility, or
  - any issuer registered in the membership attestor registry.
- `query-api` still decides open / invite / approval policy, but now signs grants with a trusted membership attestor instead of assuming the admin wallet.
- `frontend` should consume a freshly published SDK patch release before demo rebuilds.

## Rollout order

1. Build the upgraded program
2. Upgrade the existing devnet `circle-manager`
3. Initialize the membership attestor registry on-chain
4. Register the demo membership attestor public key
5. Set demo `MEMBERSHIP_BRIDGE_ISSUER_*` to that registered attestor keypair
6. Rebuild `query-api` and `frontend`
7. Smoke test open join, invite join, and approval-required join

Do not register the demo attestor before the program upgrade. The old program does not know about the registry account.

## Commands

### 1. Build and upgrade

```bash
cd /Users/taiyi/Desktop/Project/Future/web3/alcheme-protocol
anchor build -p circle-manager
anchor upgrade \
  --provider.cluster https://api.devnet.solana.com \
  --provider.wallet ~/.config/solana/id.json \
  --program-id GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ \
  target/deploy/circle_manager.so
```

### 2. Inspect / initialize / register attestors

Use the helper script:

```bash
cd /Users/taiyi/Desktop/Project/Future/web3/alcheme-protocol
node scripts/membership-attestor-registry.mjs show --rpc https://api.devnet.solana.com
node scripts/membership-attestor-registry.mjs init --rpc https://api.devnet.solana.com
node scripts/membership-attestor-registry.mjs register --rpc https://api.devnet.solana.com --attestor <PUBKEY>
```

### 3. Demo env

Set:

```bash
MEMBERSHIP_BRIDGE_ISSUER_KEY_ID=<registered pubkey>
MEMBERSHIP_BRIDGE_ISSUER_SECRET=<matching secret>
```

The configured key must already be registered on-chain.

## SDK rollout rule

Keep `frontend` on a published `@alcheme/sdk` prerelease instead of a local file dependency. To avoid stale-account-layout failures after contract upgrades:

- bump the SDK patch version,
- publish that SDK release to npm under the `devnet` tag,
- update `frontend/package.json` and `frontend/package-lock.json`,
- then rebuild demo.

## Current compatibility rule

`claim_circle_membership` still accepts `issuer_key_id == circle_manager.admin` as a temporary fallback. Keep that only for migration safety; new environments should register and use dedicated membership attestors.
