# External Program V3 Entrypoint Index

Date: 2026-05-15
Status: Implementation navigation index

This document maps the current ExternalApp V3 entrypoints. **External Program**
is the product-facing term; `ExternalApp` remains the current implementation
object. This index does not create new product rules. Product semantics remain
defined by the External Program product architecture, V3 stability model,
settlement asset policy, evidence policy, risk disclaimer policy, and emergency
authority matrix.

Use this index to avoid mixing sandbox registration, production governance,
SDK surfaces, chain custody, app-operated routes, and smoke tests.

## 1. Player And App Discovery Entrypoints

Primary frontend entrypoint:

- `frontend/src/app/(main)/apps/page.tsx`
- Runtime route: `/apps`

Purpose:

- Show reviewed or listed external programs.
- Show registry, discovery, managed-node, stability, rollout, bond, and
  governance projection labels.
- Make clear that external programs are operated by their owners and are not Alcheme
  endorsements.

Backing API entrypoints:

- `GET /api/v1/external-apps/discovery`
- `GET /api/v1/external-apps/:appId/stability-projection`

Code:

- `services/query-api/src/rest/externalApps.ts`
- `services/query-api/src/services/externalApps/storeProjection.ts`
- `services/query-api/src/services/externalApps/stabilityProjection.ts`

Boundary:

- Discovery is a read surface.
- Discovery must not expose private app config or imply app safety,
  compensation, insurance, guarantee, or Alcheme endorsement.

## 2. External Developer Entrypoints

Browser/runtime SDK:

- `@alcheme/sdk/runtime/communication`
- `@alcheme/sdk/runtime/voice`
- `@alcheme/sdk/runtime/errors`

Server-side SDK:

- `@alcheme/sdk/server`
- Deprecated compatibility alias: `@alcheme/sdk/runtime/server`

Protocol SDK:

- `@alcheme/sdk/protocol`
- `@alcheme/sdk/modules/external-app-registry`
- `@alcheme/sdk/modules/external-app-economics`
- `@alcheme/sdk/idl/*.json`

Code:

- `sdk/src/runtime/*`
- `sdk/src/server.ts`
- `sdk/src/protocol.ts`
- `sdk/src/modules/external-app-registry.ts`
- `sdk/src/modules/external-app-economics.ts`
- `sdk/src/idl/external_app_registry.json`
- `sdk/src/idl/external_app_economics.json`

Boundary:

- Browser code must not hold program authority keys.
- Program authority claims and production owner assertions belong on server-side
  code.
- Protocol builders are low-level transaction helpers, not product approval
  shortcuts.

## 3. Sandbox Registration Entrypoint

API:

- `POST /api/v1/external-apps`

Required environment:

- `EXTERNAL_APP_ADMIN_TOKEN`

Code:

- `services/query-api/src/rest/externalApps.ts`
- `services/query-api/src/services/externalApps/registry.ts`

Purpose:

- Register local, sandbox, or demo external programs for development and integration
  testing.

Boundary:

- This is not mainnet production approval.
- This endpoint must not be used as evidence that an app has passed production
  review.

## 4. Production Registration And Review Entrypoint

API:

- `GET /api/v1/external-apps/risk-disclaimers/developer_registration`
- `POST /api/v1/external-apps/:appId/production-registration-requests`

Code:

- `services/query-api/src/rest/externalApps.ts`
- `services/query-api/src/services/externalApps/productionRegistry.ts`
- `services/query-api/src/services/externalApps/riskDisclaimer.ts`
- `services/query-api/src/services/externalApps/manifest.ts`
- `services/query-api/src/services/externalApps/manifestPlatformValidation.ts`
- `services/query-api/src/services/externalApps/ownerAssertion.ts`
- `services/query-api/src/services/governance/systemRoleBindings.ts`

Purpose:

- Validate production manifest shape.
- Validate owner assertion and manifest hash.
- Require a developer agreement receipt before opening production review.
- Resolve the active ExternalApp review role binding.
- Open a governance request instead of directly activating production runtime
  authority.

Boundary:

- Creating a production registration request does not activate the app.
- The developer agreement is shown through the scoped disclaimer endpoint before
  submission. The full terms stay retrievable off chain; the terms digest,
  acceptance digest, app id, actor, policy epoch, and chain receipt evidence are
  stored as proof.
- Production registration must carry `developerAgreement` with the scoped
  `developer_registration` terms digest, acceptance digest, chain receipt PDA,
  receipt digest, and transaction signature. The agreement binds to the manifest
  hash, so changing the manifest requires a new acceptance.
- The `developerAgreement.policyEpochId` must be the active External Program
  review policy version id resolved from the system role binding. It is not
  returned by the generic terms endpoint and must not be invented by the
  external program client.
- Query API verifies the chain receipt PDA, account data, receipt digest, and
  transaction status before opening production review when risk-receipt
  verification is enabled. Production defaults this verification to required.
- Existing active runtime credentials must not be replaced until governance
  accepts and execution is recorded.

## 4.1 Participant Risk Disclaimer Entrypoint

API:

- `GET /api/v1/external-apps/risk-disclaimers/:scope`
- `POST /api/v1/external-apps/:appId/risk-disclaimer-acceptances`

Scopes:

- `external_app_entry`
- `challenge_bond`
- `bond_disposition`
- `developer_registration`

Code:

- `services/query-api/src/rest/externalApps.ts`
- `services/query-api/src/services/externalApps/riskDisclaimer.ts`
- `programs/external-app-economics`
- `sdk/src/modules/external-app-economics.ts`

Boundary:

- This is a proof/receipt path, not a liability or compensation path.
- The browser or external program must show the scoped terms before the user signs
  or submits the chain transaction.
- The Solana receipt records digest-level proof. Raw legal text, private
  evidence, and UI copy are not written directly to chain.
- Query API stores the chain receipt metadata so reviewers and clients can
  reconcile the user-facing acceptance with the on-chain receipt.
- The chain receipt PDA is stable for `appIdHash + actor + scope`; if terms or a
  manifest-bound developer agreement changes, the same PDA is re-signed and
  overwritten with the newest terms digest, acceptance digest, policy epoch
  digest, and timestamp.

## 5. Core Review Circle And Governance Entrypoints

Bootstrap and inspection scripts:

- `scripts/bootstrap-external-app-governance-role-bindings.ts`
- `scripts/inspect-external-app-governance-role-binding.ts`

Environment:

- `EXTERNAL_APP_REVIEW_PRIMARY_CIRCLE_ID`
- `EXTERNAL_APP_REVIEW_PRIMARY_POLICY_ID`
- `EXTERNAL_APP_REVIEW_PRIMARY_POLICY_VERSION_ID`
- `EXTERNAL_APP_REVIEW_PRIMARY_ENVIRONMENT`
- `EXTERNAL_APP_REVIEW_PRIMARY_CREATED_BY_PUBKEY`

Code:

- `services/query-api/src/services/governance/systemRoleBindings.ts`
- `services/query-api/src/services/governance/actionTypes.ts`
- `services/query-api/src/services/externalApps/reviewBinding.ts`

Boundary:

- A core review circle is protocol-recognized through an active system role
  binding.
- The implementation must not treat any ordinary circle shape as an official
  ExternalApp review council merely because it is auxiliary, governance-oriented,
  or secret.

## 6. Settlement Asset And Bond Entrypoints

Program:

- `programs/external-app-economics`

SDK:

- `sdk/src/modules/external-app-economics.ts`
- `@alcheme/sdk/modules/external-app-economics`

Settlement setup:

- `scripts/bootstrap-external-app-settlement-mint.ts`

Environment:

- `EXTERNAL_APP_ECONOMICS_PROGRAM_ID`
- `EXTERNAL_APP_ECONOMICS_MODE`
- `EXTERNAL_APP_ECONOMICS_AUTHORITY_KEYPAIR_PATH`
- `EXTERNAL_APP_ECONOMICS_AUTHORITY_SIGNER_URL`
- `EXTERNAL_APP_ECONOMICS_AUTHORITY_SIGNER_TOKEN`
- `EXTERNAL_APP_ECONOMICS_IDL_PATH`
- `EXTERNAL_APP_SETTLEMENT_ASSET_MODE`
- `EXTERNAL_APP_SETTLEMENT_TEST_MINT`
- `EXTERNAL_APP_SETTLEMENT_TEST_MINT_AUTHORITY`

Boundary:

- Production settlement starts disabled until an approved asset allowlist and
  governance-controlled authority path exist.
- Test mint mode is local/devnet only.
- Bond flows are rule-based bond disposition, not Alcheme compensation,
  reimbursement, insurance, guarantee, refund, principal protection, or
  make-whole recovery.

## 7. App-Operated External Route Entrypoints

API:

- `GET /api/v1/external-nodes/routes`

Code:

- `services/query-api/src/rest/externalNodes.ts`
- `services/query-api/src/services/externalNodes/nodeProjection.ts`

Purpose:

- Show app-operated or third-party route declarations with provenance.

Boundary:

- External routes are not Alcheme managed nodes.
- External routes do not contribute ranking weight by default.
- External routes must carry non-endorsement text and must not be presented as a
  public Alcheme-certified self-hosted node network.

## 8. Smoke And Verification Entrypoints

Smoke scripts:

- `scripts/smoke/external-app-registry-v2-smoke.mjs`
- `scripts/smoke/external-app-v3a-projection-smoke.mjs`
- `scripts/smoke/external-app-v3b-economics-smoke.mjs`
- `scripts/smoke/external-app-v3b-settlement-asset-smoke.mjs`
- `scripts/smoke/external-app-v3c-bond-disposition-smoke.mjs`
- `scripts/smoke/external-app-v3d-governance-smoke.mjs`

Execution gates:

- V3B/V3C write smoke defaults to read-only or skipped chain submission.
- Chain-writing smoke requires explicit execute flags such as
  `ALCHEME_EXTERNAL_APP_V3C_EXECUTE=true` or
  `ALCHEME_EXTERNAL_APP_V3B_EXECUTE=true`.
- Write smoke should run only in local/devnet test environments.

Boundary:

- Smoke data is test data.
- Smoke output is verification evidence, not product approval, governance truth,
  app-store ranking input, or settlement authority.
- Production should use read-only health checks, not write smoke.

## 9. Local Stack Entrypoints

Scripts:

- `scripts/start-local-stack.sh`
- `scripts/deploy-local-optimized.sh`
- `scripts/initialize-programs.ts`

Generated runtime config:

- `sdk/localnet-config.json`

Boundary:

- Local stack is a consolidated developer topology.
- Local success does not imply production topology, production custody policy, or
  production settlement readiness.
