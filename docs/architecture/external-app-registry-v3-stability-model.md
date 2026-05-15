# External Program Registry V3 Stability Model

Date: 2026-05-14
Status: Draft for review; superseded in key areas by the 2026-05-14 no-liability and external-route boundary decisions below.
Scope: ExternalApp owner bond, challenge bond, risk disclaimer, participant-posted bond disposition, dispute flow, settlement rules, and stable policy epochs.

Terminology: **External Program** is the product-facing term for third-party
runtimes that connect to Alcheme capabilities. `ExternalApp` remains the current
code, API, and database object name.

## 0. 2026-05-14 Boundary Update

This section supersedes older references in this document to `Independent Support Signal`,
`Independent Support`, `Process Reserve`, compensation claims, payout queues,
microclaims, broad user loss coverage, and public self-hosted node networks.
Those older sections are retained only as historical design exploration. Do not
implement them unless a later plan explicitly replaces this boundary with a new
product, legal, security, and protocol review.

Current product and legal boundaries:

- Alcheme must not be described as compensating, reimbursing, insuring,
  guaranteeing, making users whole, protecting principal, or assuming liability
  for external program behavior or participant outcomes.
- Alcheme provides protocol, node, SDK, discovery, governance, evidence, and
  rule-execution capabilities. External program operators and participants accept
  their own rules, risks, and consequences when entering or using an external
  program.
- Abuse prevention, review, evidence, bond, and governance mechanisms reduce
  misuse risk and execute transparent rules. They do not create Alcheme
  responsibility for what external programs do.
- Default V3C is risk disclaimer plus participant-posted bond disposition:
  bonds may be locked, released, forfeited, or routed by active policy and
  receipts. It is not a compensation, payout, insurance, refund, principal
  protection, make-whole, or platform-liability system.
- Public app-operated external-route node networks are excluded from this plan. External programs
  may declare app-operated routes for continuity, but those routes are outside
  Alcheme's official managed-node system and outside Alcheme responsibility.
  Alcheme does not operate, recognize, recommend, certify, rank, or govern a
  public app-operated external-route node network in this plan.
- Current implementation work should follow
  `docs/plans/2026-05-14-external-app-v3-full-implementation-plan.md` for phase
  order, acceptance gates, and exact terminology.

## 1. Conclusion

V3 should not be a pure token-curated registry, and it should not let complaint
capital automatically confiscate app backing capital.

The recommended model is an ExternalApp Optimistic Trust Onion:

```text
Layer 1: V2 ExternalApp Registry identity and audit root
Layer 2: app-store, managed-node, capability policy, and external-route declaration controls
Layer 3: Owner Bond, Challenge Bond, and participant-posted bond disposition
Layer 4: optimistic challenge, evidence, liveness, and bounded settlement
Layer 5: Circle/Governance or arbitration for subjective and high-risk cases
```

V2 remains the objective SVM audit root for app identity, owner, manifest hash,
server key hash, policy digest, decision digest, and execution receipt digest.
V3 adds economic accountability and dispute settlement, but it must preserve
these product boundaries:

- Money can raise accountability and quota, but money alone cannot buy trust.
- Ordinary negative feedback affects ranking and risk score, not capital.
- Funded complaints can trigger review and disputes, but subjective punishment
requires evidence, response, governance or arbitration, and appeal.
- Owner Bond is a participant-posted accountability deposit, not an Alcheme
  guarantee, coverage pool, or liability source.
- Challenge Bond is a participant-posted process bond, not a reward or payout
  promise.
- App store delisting, managed-node downgrade, capability restriction, and
  protocol revocation stay separate states.
- Emergency holds are temporary official managed-node controls, not a generic
  right to shut down an external program.

### 1.1 Operating Principle

V3 should keep complete rules for the common and controllable cases, while
leaving explicit manual intervention paths for rare, subjective, or dangerous
cases.

The core rule:

```text
Contracts execute objective state, funds, windows, and bounded transitions.
Signed projections handle external facts and operational signals.
Governance handles subjective judgment and exceptional intervention.
Frontend turns the layered state into simple user-facing labels.
```

This means V3 is not "everything on-chain." It is "mechanical rules on-chain,
human judgment only where judgment is unavoidable." The system should not grow a
large number of special-case contracts just to pretend every future dispute can
be decided automatically.

### 1.2 Layer Responsibilities

| Layer | Primary Owner | Automatic By Default | Human / Governance Intervention |
| --- | --- | --- | --- |
| Identity | V2 registry program | app identity, owner, manifest, server key, registry status | versioned registry migration or final revocation |
| Capability | Query API, managed-node policy, governance receipt | listing, quotas, risk labels, capability limits, node-local holds | emergency hold extension, wrongful hold remedy |
| Economic | V3 economic program | bond custody, lockups, challenge windows, bounded release/slash rules | policy epoch changes, high-impact settlement approval |
| Optimistic Challenge | V3 case state plus signed evidence | open case, evidence hash, liveness, response/appeal windows, machine-verifiable outcomes | subjective facts, fraud intent, disputed evidence |
| Governance / Arbitration | Circle/Governance, optional arbitration adapter | final receipt intake and execution after authority check | subjective rulings, capture review, exceptional correction |

Design preference:

- Automate low-risk, objective, reversible, or bounded actions.
- Pause or limit new exposure when the model is uncertain.
- Require governance or arbitration before irreversible subjective punishment.
- Keep manual intervention narrow, receipt-bound, time-limited, and reviewable.
- Do not design for every theoretical edge case in V3 if the result makes the
  normal path too complex.

## 2. Current Alcheme Code Facts

The current repository already has the V3 attachment points. V3 must extend
these instead of creating a parallel product chain.

Existing code facts:

- `programs/external-app-registry/README.md` explicitly says V2 has no Owner
  Bond custody, Independent Support Signal custody, challenge escrow, slashing,
  bond disposition, or appeal settlement. Those are V3.
- `programs/external-app-registry/src/state.rs` stores V2 objective facts in
  `ExternalAppRecord`: `app_id_hash`, owner, server key hash, manifest hash,
  policy digest, review circle, review policy digest, decision digest,
  execution intent digest, optional execution receipt digest, status, expiry,
  and revocation timestamp.
- `services/query-api/prisma/schema.prisma` already has runtime/projection
  fields for `ExternalApp`, `ExternalAppRegistryAnchor`,
  `ExternalAppBacking`, `ExternalAppChallenge`, and `ExternalNode`.
- `services/query-api/src/services/externalApps/backing.ts` currently has only
  simple score helpers:
  - `computeBackingLevel(amountsRaw)`: square-root sum.
  - `computeChallengePressure(backingRaw, challengeRaw)`: challenge/backing
    ratio.
- Governance infrastructure already exists through `GovernancePolicy`,
  `GovernancePolicyVersion`, `GovernanceRequest`, `GovernanceSignal`,
  `GovernanceDecision`, and `GovernanceExecutionReceipt`.
- ExternalApp governance action types already include registration, store
  listing approval, managed-node quota approval, discovery downgrade,
  capability limit, and emergency hold.

Implication:

V3 should add a real economic and dispute layer under the existing ExternalApp
and Governance trunk. It should not add independent review tables, independent
vote tables, or a second "app court" unrelated to Circle/Governance.

## 3. Lessons From Mature Web3 Models

### 3.1 WalletConnect Verify

WalletConnect Verify classifies request origins as valid, invalid, unknown, or
malicious/risky. It also explicitly says domain verification makes
impersonation harder but is not bulletproof.

Alcheme should borrow:

- domain and manifest verification as a risk signal.
- user-facing status labels for verified, unknown, mismatch, and threat.
- no assumption that domain verification is the final trust root.

Alcheme should not borrow:

- treating domain status as enough to grant production authority.

Source: https://docs.walletconnect.network/wallet-sdk/web/verify

### 3.2 Base / Mini App Registration Direction

Base is moving Mini Apps toward a standard web app plus wallet model, with app
metadata registered through Base.dev. The important pattern is that discovery
metadata, wallet authentication, and app runtime remain separate.

Alcheme should borrow:

- app metadata and discovery registration as a product surface.
- wallet-based user identity instead of platform-specific identity only.
- app store metadata separated from runtime permissions.

Alcheme should not borrow:

- a web-only model that excludes desktop, native, Steam, Unity, Godot, or
  app-operated external-route node integrations.

Source: https://docs.base.org/mini-apps/quickstart/migrate-to-standard-web-app

### 3.3 UMA Optimistic Oracle

UMA's Optimistic Oracle uses bonded assertions, challenge windows, disputer
bonds, and escalation to dispute arbitration when an assertion is challenged.
Its docs also warn that bond size and liveness are security and UX tradeoffs.

Alcheme should borrow:

- optimistic acceptance for objective or semi-objective claims.
- explicit liveness windows before high-trust actions finalize.
- proposer and challenger bonds.
- the principle that higher-value actions need higher bonds or longer challenge
  periods.

Alcheme should not borrow blindly:

- treating every app dispute as a price oracle-like fact. App abuse can be
  subjective and needs product-specific evidence rules.

Sources:

- https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work
- https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters

### 3.4 Kleros Court

Kleros models subjective disputes with evidence submission, juror voting, and
appeal. This maps well to fraud, content, harassment, compliance, and user-harm
cases where smart contracts should not judge facts alone.

Alcheme should borrow:

- evidence window.
- response window.
- voting or arbitration phase.
- appeal window.
- case-specific evidence requirements.

Alcheme should not borrow blindly:

- outsourcing every dispute to a third-party court before Alcheme has enough
  product volume and clearly defined dispute classes.

Sources:

- https://docs.kleros.io/products/court
- https://docs.kleros.io/products/court/what-happens-during-a-dispute

### 3.5 The Graph

The Graph separates operators, curators, delegators, and consumers. Indexers
stake to provide service, curators signal quality, and delegation capacity is
tied to self-stake. The current delegation ratio in their docs is 16x
self-stake.

Alcheme should borrow:

- separate app operator accountability from community signal.
- cap how much community support can amplify an app owner's own bond.
- treat node trust and app trust as separate objects.
- expose technical and social reputation instead of one naive score.

Alcheme should not borrow blindly:

- assuming a query-indexer market is identical to an app marketplace.

Sources:

- https://thegraph.com/docs/en/indexing/overview/
- https://thegraph.com/docs/en/resources/roles/delegating/delegating/

### 3.6 Chainlink Staking

Chainlink Staking v0.2 has explicit slashing conditions for node operator
stakers, while community stakers are not at slashing risk in that version. It
also says material changes to slashing conditions should be announced so stakers
can unstake before the upgrade is completed.

Alcheme should borrow:

- slashing rules must be explicit before users lock capital.
- different participant classes can have different risk exposure.
- material risk-rule changes require a migration or exit window.
- community support should not silently become slashable later.

Alcheme should not borrow blindly:

- fixed numeric slashing amounts from Chainlink's oracle-specific model.

Source: https://chain.link/economics/staking

### 3.7 Token-Curated Registries

Token-curated registries show that economic curation can scale, but current
writeups also call out plutocracy, low participation, challenge cost barriers,
collusion, cold-start problems, and subjective quality criteria.

Alcheme should borrow:

- deposits for listing and challenges.
- continuous curation instead of one-time review only.
- challenge incentives.

Alcheme should avoid:

- pure token-weighted truth.
- automatic "complaint money beats backing money, therefore backing principal
  is confiscated."
- making challenger rewards the main profit mechanic.

Source: https://gitcoin.co/mechanisms/token-curated-registry

## 4. Product Objects

V3 adds economic and dispute objects. It does not replace `ExternalApp`,
`ExternalAppRegistryAnchor`, `ExternalNode`, or Governance.

### 4.1 Owner Bond

Owner Bond is the accountable deposit posted by the app owner or operator.

Purpose:

- prove an accountable party exists.
- gate production and high-trust access.
- back managed-node quota.
- provide policy-bound accountability for severe owner misconduct.

Rules:

- Owner Bond is required for `mainnet_production` and `high_trust`.
- Owner Bond is the first pool slashed for upheld severe violations.
- Owner Bond cannot be withdrawn below the active exposure floor while the app
  has active quota, pending cases, active appeal windows, or outstanding
  bond-disposition cases.
- Owner Bond does not buy app store ranking by itself.
- Owner Bond is not insurance, principal protection, or an Alcheme guarantee.
  It only means the owner has posted an accountability deposit that may be used
  under defined policy rules.

### 4.2 Independent Support Signal

Independent Support Signal is user or community support for an ExternalApp. It
is a ranking and governance-context input, not coverage, insurance, compensation,
or Alcheme endorsement.

Purpose:

- signal participant confidence.
- improve capped support level.
- help raise quota ceilings.
- buffer light complaint pressure.

Rules:

- Independent Support is not an investment product and must not promise yield,
  protection, compensation, reimbursement, or guaranteed recovery.
- Product surfaces should prefer labels such as `Independent Support Declared`
  or `Support Signal Disclosed`. The technical name may remain in developer docs,
  but user-facing copy must clearly explain lockup, risk, and non-investment,
  non-coverage semantics.
- Owner-affiliated backing is marked separately and counted as Owner Bond-like
  exposure, not third-party support.
- Related-party backing must be classified before it contributes to public
  community support labels. Related parties include the owner, team, publisher,
  investors, commercial guild partners, paid KOLs, market-making wallets, and
  other wallets with disclosed or detected economic dependence on the app.
- Independent Support Signal has a lockup and delayed exit.
- Independent Support Signal has capped risk. It is not automatically seized when an app
  owner misbehaves.
- Independent Support Signal can share limited losses only when:
  - the risk tier explicitly allowed that loss before backing,
  - the case is upheld through final ruling,
  - Owner Bond has been applied first,
  - the ruling says community backing should share responsibility.

Recommended risk tiers:

| Tier | Use | Loss Exposure |
| --- | --- | --- |
| `supporter` | ordinary community support | no ordinary slashing; only ranking/quota signal |
| `standard_risk` | production backing with risk disclosure | capped loss per final severe ruling |
| `sponsor_affiliate` | owner, team, publisher, or major affiliate support | treated closer to Owner Bond |
| `high_risk_underwriter` | explicit underwriting role | higher cap, separate consent required |

Default UI should start with `supporter` or `standard_risk`. Do not expose
ordinary users to underwriter semantics by default.

Backing from related parties can still be useful, but it must be displayed as
`Sponsor/Affiliate Backing`, `Owner Bond`, or an equivalent non-community label.
It must not be counted as independent community confidence.

### 4.3 Challenge Bond

Challenge Bond is posted by a challenger who files a funded complaint.

Purpose:

- discourage spam and false complaints.
- create process friction for complaints.
- provide policy-bound process-cost recovery through rule-based bond
  disposition.

Rules:

- Challenger reward is capped.
- Failed challenges forfeit part of the Challenge Bond.
- Successful challenges may route forfeited Challenge Bond according to active
  policy and receipts for bounded process-cost recovery or reserve routing. This
  must not be presented as Alcheme compensation or user loss coverage.
- Challenge Bond weight has diminishing returns. Large challengers cannot buy
  automatic truth.
- Challenger routing is not a profit strategy. It should be framed as
  policy-bound process-cost recovery and capped oversight incentive.

### 4.4 Bond Exposure Guard And Process Reserve

V3 may maintain process reserves and bond-exposure guard state, but it must not
create a platform insurance pool or Alcheme compensation promise.

Process reserve scope:

- dispute process costs.
- evidence retention and review-operation costs.
- systemic incident response.
- correction and audit operations.

It is not a yield pool, compensation pool, guarantee fund, or insurance fund. It
may be funded by protocol fees, forfeited bonds, and governance-approved
transfers only under explicit policy caps.

Bond-exposure guard state can pause new exposure, adjust caps, or require
review. It cannot promise recovery for losses or make Alcheme liable for
external-app outcomes.

### 4.5 ExternalNode Stake

ExternalNode stake belongs mostly to V4, not V3, because node correctness,
conformance testing, public service obligations, and node challenge rules are
separate from app identity.

V3 may reserve references to node policy, but it should not merge App Trust and
Node Trust.

## 5. Stable Score Model

V3 should publish score formulas as policy versions. Scores are projections, not
the final source of truth for locked capital.

### 5.1 Separate Scores

Use separate scores:

- `appTrustScore`: review, operating history, upheld dispute rate, owner bond,
  key hygiene, manifest health, usage quality.
- `backingLevel`: effective backing after caps, lockups, and diminishing
  returns.
- `backingIndependenceScore`: how much of the effective backing comes from
  independent users instead of owner-related or commercially related parties.
- `riskScore`: complaints, disputes, evidence severity, recency, sybil risk,
  incident history.
- `discoveryScore`: ranking and recommendation score.
- `managedNodeQuotaTier`: official node resource policy.
- `nodeTrustScore`: node/operator trust, not app trust.
- `challengerReputation`: challenger history, evidence quality, successful
  challenge rate, failed or malicious challenge history, and usage legitimacy.
- `challengeAbuseScore`: likelihood that a complaint pattern is harassment,
  extortion, competitor sabotage, or coordinated abuse.

Do not show all scores to ordinary users. Public labels should stay simple:

- `Sandbox`
- `Reviewed`
- `Owner Bonded`
- `Independent Support Declared`
- `Under Challenge`
- `Limited`
- `Delisted`
- `Official Node Limited`
- `Managed Node Suspended`
- `External Route Declared`
- `Unverified External Route`

Avoid the bare label `Backed` in ordinary user surfaces because it can be read
as an Alcheme guarantee. If a shorter label is necessary, the detail view must
separate `Owner Bond`, `Independent Support Signal`, and
`Sponsor/Affiliate Support`.

### 5.2 Effective Backing

Use square-root or logarithmic weighting instead of linear amount weighting:

```text
backing_weight =
  sqrt(amount_locked)
  * lockup_multiplier
  * account_credibility_multiplier
  * independence_multiplier
```

Recommended constraints:

- A single wallet should have a per-app effective backing cap.
- Wallets related to owner, team, publisher, or known affiliates are not counted
  as independent community backing.
- Wallets with paid promotion, investment, publishing, guild-operation,
  market-making, or revenue-share relationships should be classified as related
  parties unless disclosed and policy-classified otherwise.
- Short lockups should count much less than long lockups.
- Backing can raise `Backing Level` and quota capacity, but should contribute
  only a capped portion of `appTrustScore`.
- Public discovery ranking should use `backingIndependenceScore` as a guardrail:
  an app with large related-party backing and weak independent support should
  not look healthier than a smaller app with real user support.

Borrowing the self-stake capacity idea from The Graph:

```text
community_backing_capacity <= owner_bond_effective * backing_capacity_ratio
```

Initial ratio recommendation:

- `4x` for trust and discovery effects.
- `16x` maximum for quota capacity effects, matching the broad idea that
  delegated/community support should be bounded by owner self-risk.

The ratio must be configurable by policy epoch.

### 5.3 Challenge Pressure

Use diminishing returns and evidence weighting:

```text
challenge_weight =
  sqrt(challenge_bond)
  * evidence_class_multiplier
  * usage_record_multiplier
  * challenger_credibility_multiplier
  * sybil_risk_discount
  * abuse_risk_discount
```

Challenge pressure should compare challenge weight to effective backing and
owner bond, not raw amounts:

```text
challenge_pressure =
  challenge_weight / max(1, backing_weight + owner_bond_weight)
```

Recommended thresholds:

| Threshold | Effect |
| --- | --- |
| `private_watch` | internal risk tracking only; no public heavy warning |
| `public_watch` | lightweight risk notice, not an `Under Challenge` label |
| `review` | app owner response window, feature placement removal after minimum credibility is met |
| `dispute` | formal dispute case opens |
| `severe_fast_track` | temporary managed-node emergency controls allowed |

No threshold should directly transfer all backing principal to challengers.

The public `Under Challenge` label should be reserved for cases that pass
minimum credibility gates. Low-confidence or obviously tactical complaints
should not automatically create a market-damaging public label.

### 5.4 Account Credibility

Challenge and backing weights should consider credibility signals:

- app usage records: room sessions, messages, voice sessions, or protocol
  receipts.
- wallet/session age.
- Alcheme identity or membership proofs when available.
- prior successful or failed challenges.
- sybil clustering risk.
- relationship to app owner, publisher, or competitor.

New users may still complain, but their weight starts lower unless they provide
strong machine-verifiable evidence.

### 5.5 Challenger Reputation And Abuse Controls

V3 must treat challengers as accountable actors, not only as one-off complaint
senders.

Track:

- number of challenges opened.
- percentage upheld, partially upheld, dismissed, or marked abusive.
- evidence quality and timeliness.
- relationship to the app, app competitors, publishers, KOL campaigns, guilds,
  or related commercial parties.
- repeated challenge patterns across the same target or market category.
- private withdrawal or settlement attempts when reported with evidence.

Bond requirements should be dynamic:

- credible used-app challengers with strong evidence can use normal bonds.
- new accounts with no usage history use higher bonds unless evidence is
  machine-verifiable.
- repeat failed challengers use higher bonds.
- challengers with abusive or extortion history may be rate-limited, required
  to post much higher bonds, or temporarily blocked from opening funded
  complaints.

Abusive challenges can trigger a counter-case. If upheld, forfeited Challenge
Bond should first cover the target app's reasonable response cost, then protocol
process costs, then the Process Reserve.

### 5.6 Cold-Start Path

V3 must not accidentally make production exposure available only to large
capital teams.

Add a low-risk path for legitimate small teams:

- `Reviewed Sandbox`: public testing label, no mainnet production claim, low
  official node quota.
- `Low Quota Production`: mainnet production identity with small Owner Bond,
  strict rate limits, and no featured placement.
- `Owner Bond Only`: production app has owner accountability but no independent
  community backing label yet.

Cold-start apps can grow into higher quota through operating history, low risk
score, real usage, and independent support. They should not need large Community
Backing to prove basic legitimacy.

Cold-start apps also need cost protection when targeted by low-credibility
funded complaints. If a challenge is dismissed as abusive, frivolous, or
coordinated, active policy may route reasonable response-cost recovery from the
forfeited Challenge Bond before any remainder flows to the Process Reserve.

## 6. Complaint Types

V3 must classify complaints before deciding whether automation is appropriate.

### 6.1 Machine-Verifiable Violations

Examples:

- server claim signed by a revoked key.
- nonce replay.
- forged `appRoomClaim`.
- manifest hash mismatch after a defined grace period.
- repeated request signing outside the registered app id or audience.
- rate-limit bypass or managed-node resource attack with clear logs.

Handling:

- can trigger automatic or semi-automatic penalties.
- still records evidence hash and execution receipt.
- owner gets a response path unless active harm requires temporary emergency
  controls.
- slashing can be formulaic if the rule existed before the violation.

### 6.2 Operational Violations

Examples:

- stale manifest.
- broken callback.
- excessive error rate.
- LiveKit or voice policy misuse.
- failure to rotate a leaked server key after notice.

Handling:

- first use warnings, quota reduction, and capability limits.
- formal dispute only if repeated or harmful.
- slashing should be small and usually Owner Bond first.

### 6.3 User-Harm And Fraud Allegations

Examples:

- phishing.
- fake reward or asset claims.
- inducement to sign unsafe transactions.
- intentional misrepresentation.
- refusal to remediate major user harm.

Handling:

- evidence and response windows.
- review council or arbitration.
- temporary managed-node controls only for ongoing severe harm.
- final ruling may delist, limit capability, slash Owner Bond, execute
  rule-based bond disposition, or revoke registry status.

### 6.4 Content And Community Disputes

Examples:

- harassment.
- harmful content.
- community policy disputes.
- moderation complaints.

Handling:

- prefer capability-level restrictions and app store policy controls.
- do not default to protocol revocation.
- subjective cases require governance or arbitration.

### 6.5 Frivolous Challenge, Extortion, And Coordinated Attack

This class covers abuse of the complaint system itself.

Examples:

- filing repeated low-evidence complaints to force an app into public warning
  states.
- privately demanding payment, tokens, whitelist slots, promotion, or business
  concessions in exchange for withdrawing a complaint.
- competitor-funded complaint campaigns that hide commercial relationships.
- coordinated complaint timing intended to damage launches, fundraising,
  marketplace listing, or major updates.
- recycling the same weak evidence across multiple cases.
- using new or purchased accounts to create artificial complaint pressure.

Handling:

- low-credibility complaints start in `private_watch` and do not automatically
  create `Under Challenge` public labeling.
- require higher Challenge Bonds for repeat failed challengers or challengers
  with weak usage history.
- allow the target app, review council, or node operator to open a
  challenge-abuse counter-case.
- if abuse is upheld, slash or forfeit the Challenge Bond, reduce
  `challengerReputation`, raise future bond requirements, and route bounded
  response-cost recovery where active policy allows it.
- alleged extortion evidence may be hashed and submitted privately first, then
  disclosed under governance/arbitration rules to avoid doxxing or legal risk.

### 6.6 Misleading Promotion And Financialization Risk

This class covers gray-area misconduct that is common in Web3 and easy to miss
if the model only looks for direct protocol violations.

Examples:

- implying Independent Support Signal produces yield, profit, allocation rights, or
  guaranteed future rewards.
- implying backing, challenge participation, Owner Bond, or Process Reserve
  creates investment exposure, principal protection, insurance coverage, or a
  guaranteed compensation right.
- using `Owner Bonded`, `Independent Support Declared`, or similar labels as if
  they were Alcheme endorsements or guarantees.
- undisclosed paid KOL promotion, guild coordination, or affiliate backing that
  is presented as independent community support.
- misleading roadmap, token, points, airdrop, or reward claims used to attract
  users or backers.
- hiding material risk changes from users who are asked to back the app.

Handling:

- first classify severity and require correction or disclosure.
- downgrade discovery or remove featured placement for unresolved misleading
  promotion.
- classify related-party backing correctly before it contributes to public
  labels or ranking.
- restrict backing or challenge participation for apps or promoters that
  repeatedly market the mechanism as yield, insurance, principal protection, or
  an Alcheme endorsement.
- escalate to fraud/user-harm if users suffered material loss or the app owner
  knowingly refused to correct misleading claims.

## 7. Dispute Lifecycle

Use one lifecycle for funded complaints. Parameters are policy-versioned.

```text
draft complaint
  -> risk notice window when pre-dispute signals are high
  -> challenge opened
  -> credibility gate before heavy public label
  -> liveness / evidence window
  -> owner response window
  -> early resolution or remediation
  -> governance / arbitration
  -> ruling
  -> appeal window
  -> final settlement execution
  -> receipt anchoring and projection
```

Recommended initial windows:

| Stage | Default | Notes |
| --- | --- | --- |
| Optimistic production registration challenge window | 72 hours | high-trust can use 7 days |
| Risk notice window | 24 to 72 hours | pre-dispute warning for high-intensity negative signals |
| Challenge credibility gate | immediate to 24 hours | decides private_watch, public_watch, or formal Under Challenge |
| Evidence window | 72 hours | extendable for complex cases |
| Owner response window | 48 hours | shorter for active severe harm |
| Governance voting or arbitration window | 72 hours | depends on policy |
| Appeal window | 48 to 96 hours | longer for high-value slash |
| Emergency hold max | 24 to 72 hours | temporary managed-node control only |

For low-value or purely operational issues, governance can allow faster
remediation without full arbitration.

The risk notice window is not a final penalty. It exists to prevent suspicious
capital exits and to warn users while evidence is being organized. During this
window, related-party backing and high-risk backing withdrawals should be delayed
or marked pending. Independent low-risk supporter withdrawals can continue unless
an opened case later freezes exposure under the existing policy epoch.

The credibility gate protects apps from market-damaging complaint spam. It
should consider Challenge Bond size after diminishing returns, evidence class,
user usage records, challenger reputation, sybil risk, competitor relationship,
and prior abusive behavior. It does not decide the truth of the complaint; it
only decides how strongly the case should affect public labels before
adjudication.

Emergency holds must auto-expire. The default maximum is 24 hours. A policy may
allow up to 72 hours for severe active harm, but any extension beyond the
initial window requires a governance request, evidence receipt, and explicit
operator accountability. If the hold expires without escalation or ruling, it
must downgrade to `public_watch` or clear.

### 7.1 Evidence Availability And Privacy

A dispute system is only useful if evidence remains available, authentic, and
reviewable without creating unnecessary privacy harm.

Evidence packages should separate:

- `evidenceHash`: immutable digest used for anchoring and receipts.
- `evidenceLocator`: where encrypted or redacted evidence can be retrieved.
- `evidenceClass`: machine-verifiable, node log, app log, user-submitted,
  third-party, private-sensitive, or public summary.
- `submitter`: app owner, challenger, user, node operator, reviewer, or
  arbitration body.
- `availabilityDeadline`: how long the original evidence must remain
  retrievable.
- `redactionPolicy`: public, redacted public, private to reviewers, sealed until
  appeal, or unavailable without legal/process approval.
- `chainOfCustody`: who submitted, accessed, redacted, or replaced evidence.

Rules:

- A hash without available underlying evidence should not be enough for a
  subjective penalty.
- If original evidence is lost before the response or appeal window closes, the
  case should downgrade, pause, or reopen evidence collection unless the
  remaining machine-verifiable evidence is sufficient.
- Privacy-sensitive evidence may be sealed from public view, but reviewers need
  enough access to verify the claim under a recorded access policy.
- Public summaries must identify which evidence they summarize and whether any
  evidence was redacted or unavailable.
- Evidence involving minors, private messages, voice transcripts, sensitive
  personal data, or commercial secrets should default to private/restricted
  review with redacted public summaries.
- Evidence retention must be long enough to cover appeal and settlement
  windows, but not become an indefinite public data leak.

### 7.2 Selective Log And Evidence Pollution Controls

External programs, node operators, challengers, and users may all submit incomplete
or misleading evidence.

Controls:

- App server logs should be signed, timestamped, and linked to a manifest or
  server key version.
- Node logs used for emergency actions should include an operator evidence
  receipt and, where practical, sampled raw event ids.
- Reviewers should treat app-only logs as weaker than logs that can be matched
  to Alcheme sessions, chain receipts, or signed user events.
- Screenshot-only evidence is never enough for automatic bond routing or slashing.
- Repeated selective submission, deletion, or refusal to provide logs can
  become an operational violation or fraud signal.
- Evidence replacement must preserve the old evidence hash and record why the
  replacement occurred.

AI may help summarize evidence, but it must not become the source of truth.

AI summary rules:

- every AI summary must cite the evidence package ids it used.
- no ruling may rely only on an AI summary.
- hallucination, contradiction, or unsupported inference flags must push the
  case back to human or governance review.
- prompts, model version, and summary output hash should be recorded when an AI
  summary affects case triage or reviewer workload.
- AI-generated labels should be advisory and reversible.

## 8. Bond Disposition Rules

### 8.1 Bond Disposition Priority

When a case is upheld, participant-posted bonds are handled in this order:

1. release or keep locked any bonds unaffected by the ruling.
2. forfeit the violating actor's bond only within active policy caps.
3. route forfeited bond according to active policy and receipts, such as bounded
   process-cost recovery, burn, protocol process reserve, or app-defined
   recipient where participants explicitly accepted that app policy.
4. update app-store, managed-node, risk, and case projections.
5. return or unlock remaining funds according to the ruling.

This flow is bond disposition, not Alcheme compensation, reimbursement,
insurance, guarantee, refund, principal protection, or make-whole coverage.

### 8.1.1 Evidence Classes For Bond Disposition

Recommended evidence classes:

| Class | Bond-Disposition Eligible By Default | Notes |
| --- | --- | --- |
| direct on-chain violation | yes | requires transaction or signed receipt evidence |
| paid Alcheme/API/service fee incident | maybe | may justify process correction or limited bond routing only under active policy |
| official managed-node incident | maybe | requires node receipt, operator evidence, or ruling; does not create Alcheme liability |
| verified app-mediated asset incident | maybe | requires app server signed report plus Alcheme usage evidence and explicit app policy |
| external program-internal virtual value | no by default | review-only unless app signed the asset state and policy opted in |
| expected yield or future reward | no | avoid financialization and speculative claims |
| opportunity cost, emotional harm, reputational harm | no by default | may affect penalties, not automatic compensation |
| Independent Support Signal loss | separate | handled only by explicit bond-disposition policy, not Alcheme compensation |

### 8.1.2 Evidence Tiers

Bond disposition and high-impact risk actions need evidence tiers:

| Tier | Evidence | Default Treatment |
| --- | --- | --- |
| Tier 1 | chain transaction, signed receipt, or Alcheme session plus signed app event | may support deterministic or semi-automatic bond disposition when policy permits |
| Tier 2 | Alcheme usage record plus app server signed incident report | eligible only after app/server evidence validation |
| Tier 3 | user-submitted screenshots, chat logs, support tickets, or third-party records | review required; no automatic bond disposition |
| Tier 4 | weak or unverifiable evidence | risk-score signal only |

Alcheme can prove Alcheme usage, sessions, messages, voice sessions, registry
state, and node receipts. It cannot automatically prove every game-internal
asset or off-platform promise unless the external program signs those facts or they
are otherwise verifiable.

### 8.1.3 Actor Role Deduplication

For one case, the same wallet, verified identity, or related-wallet cluster
should not evade caps, conflicts, or related-party exclusions across multiple
roles.

Rules:

- An actor can have multiple roles, such as challenger, user, supporter, and
  affiliate, but case routing must deduplicate by identity cluster.
- If several bond-routing categories apply, the actor receives only the
  highest-priority eligible route or a policy-defined capped combination.
- Challenger process-cost recovery and owner-bond forfeiture can both exist, but
  they must be justified by separate evidence and active policy.
- Support-signal losses are handled, if at all, through explicit bond-disposition
  policy, not through Alcheme compensation.
- Owner, team, affiliate, paid KOL, sponsor, or related-party wallets are
  excluded from independent-public-signal weight by default unless they
  separately prove a real independent role.

### 8.1.4 Bond Disposition Caps And Exposure Guard

V3 must protect bond custody and process reserves from being drained or
financialized by one incident or by many tiny claims.

Recommended caps:

- per-actor cap.
- per-case cap.
- per-evidence-class cap.
- per-policy-epoch bond-routing cap.
- lower automatic caps for Tier 2 evidence than Tier 1 evidence.
- no automatic bond disposition for Tier 3 or Tier 4 evidence.

If eligible bond-routing requests exceed the per-case cap, routing should follow
the active policy's priority and cap rules. It must not become an Alcheme payout
queue or recovery promise.

### 8.1.5 Small Incident Batch Path

Small incident signals should not require expensive individual governance review,
but they also must not become automatic microclaim payouts.

Allowed paths:

- batch risk-score updates for highly uniform Tier 1 or Tier 2 incident records.
- Merkle evidence lists produced from deterministic eligibility records.
- sampling or audit review for low-value Tier 3 reports before any public label.
- converting low-evidence reports into risk-score signals instead of bond
  disposition.

Batch actions still need a receipt and should be contestable during a short
review window.

### 8.1.6 External Program Loss Oracle Boundary

External program-internal incident assertions require stronger boundaries.

An app-mediated asset incident is eligible for bond-disposition review only when
the policy accepts the asset class and the evidence package includes:

- Alcheme usage record proving the claimant interacted with the app during the
  relevant window.
- app server signed incident report or signed game-state event.
- user incident statement or receipt.
- case id and evidence hash.

If the external program refuses to sign the incident report, or if the program server
itself is accused of fraud, the case must go to governance/arbitration. It must
not be automatically routed as an Alcheme payment or reserve claim.

### 8.2 Bond Source Order

Default source order:

1. Challenge Bond for challenger misconduct or approved process-cost recovery.
2. Owner Bond for upheld owner/operator misconduct.
3. Sponsor or affiliate support marked as owner-related, only if explicitly
   policy-bound.
4. high-risk participant-posted bond exposure, if explicitly opted in.
5. ordinary independent support signal is not slashed by default.

### 8.3 Suggested Bond-Disposition Caps

These are initial policy recommendations, not hardcoded constants:

| Case Result | Owner Bond | Independent Support Signal | Challenge Bond |
| --- | --- | --- | --- |
| failed complaint | no slash | no slash | partial forfeiture |
| partially upheld | small slash or no slash | no slash | partial return plus bounded process-cost routing |
| upheld operational issue | small to medium slash | no slash by default | capped reward |
| upheld severe owner misconduct | medium to high slash | only explicit high-risk policy exposure | capped process-cost routing |
| malicious or fraudulent complaint | no slash | no slash | high forfeiture, challenger reputation penalty |
| abusive, frivolous, or extortionary challenge | no slash | no slash | forfeiture; target response cost first |

Participant-posted bond exposure should have both per-case and time-window caps,
for example:

- per-case cap: policy-configured percentage of risk-tier exposure.
- rolling window cap: policy-configured percentage per 90 days.
- supporter tier: zero principal slashing by default.

Exact percentages should be finalized only after token economics and legal
review, but the product model must keep the cap principle.

### 8.4 Response Cost Guard

V3 should not let complaint abuse become a way to drain small teams through
process costs.

Rules:

- A target app can request response-cost protection when a complaint is
  dismissed as frivolous, abusive, coordinated, or extortionary.
- Eligible costs should be capped and rule-defined, not open-ended invoices.
- Process-cost recovery comes from forfeited Challenge Bond only when active
  policy and receipts allow it.
- Repeat abusive challengers should face rising bond requirements and possible
  temporary loss of funded complaint privileges.
- Cost protection should not punish good-faith challengers whose complaints fail
  because evidence is incomplete or facts are ambiguous.

### 8.5 Bond Exposure And Extreme Market Controls

V3 must never promise compensation, recovery, or coverage. It should bound new
exposure when asset, bond, or correlated-risk conditions become unsafe.

Stress scenarios:

- several high-usage apps enter severe disputes at the same time.
- a settlement asset loses value or depegs.
- SOL price volatility changes real bond value.
- many supporters request withdrawal after a market shock.
- one app ecosystem has correlated failures across multiple registered apps.
- official managed-node incident creates many small incident reports at once.

Controls:

- Maintain exposure accounting per asset, policy epoch, and bond class.
- Publish available bond capacity, reserved exposure, pending cases, and maximum
  possible exposure for each policy class.
- Reserve funds for already-open cases before accepting new discretionary
  exposure.
- Pause or cap new exposure when eligible bond routing would exceed case,
  policy, or asset bounds.
- Do not use payout queues.
- Disable new full bond-disposition exposure when exposure ratio falls below policy
  threshold.
- Do not treat assets as interchangeable unless the active policy defines a
  conversion oracle, haircut, and depeg response.
- Stablecoin or token depeg should trigger funding pause review for that asset.
- Correlated apps under the same owner, publisher, guild, or infrastructure
  provider should share exposure limits.

Suggested bond-exposure states:

| State | Meaning | Action |
| --- | --- | --- |
| `healthy` | exposure within policy target | normal operation |
| `watch` | exposure pressure rising | warn, slow new exposure |
| `constrained` | exposure above target | cap new support/challenges, prioritize open cases |
| `exposure_pause` | asset or exposure risk is unsafe | pause new exposure, preserve withdrawals and appeals |

The app store and developer dashboard should not hide exposure constraints.
Users need to know when a policy class is constrained before taking new risk.

## 9. State Transitions

### 9.1 Registry Status

V2 protocol registry status remains the chain-level identity status:

```text
pending -> active -> suspended -> revoked
```

This matches the current SVM/shared/SDK/indexer contract. Do not add or
reinterpret a `Disputed` variant in the V2 registry enum without a separate
versioned migration.

V3 dispute state is a separate economic case and read-model projection:

```text
none -> private_watch -> public_watch -> review -> dispute -> resolved
```

`dispute` or `disputed` may be exposed by query APIs, app-store views, and
runtime policy projections, but it is not the V2 chain registry enum. Use
`revoked` only after final adjudication or clear machine-verifiable severe
violation under an existing policy.

### 9.2 Discovery Status

Official app store and discovery:

```text
unlisted -> listed -> limited -> hidden -> delisted
```

`delisted` means Alcheme official discovery stops distributing the app. It does
not destroy the app identity or app-operated external-route use.

### 9.3 Managed Node Policy

Official managed-node resource treatment:

```text
normal -> throttled -> restricted -> emergency_hold -> denied
```

`emergency_hold` blocks new official managed-node sessions, token refreshes, or
specific high-risk capability calls. It should be temporary and recorded.

Emergency hold is not protocol revocation. It is an official managed-node
control. It must not imply that app-operated external-route nodes, direct app entry points, or
the underlying ExternalApp registry identity are shut down unless a separate
governance or protocol ruling says so.

### 9.4 Capability Policy

Capability-level enforcement:

```text
normal -> limited -> disabled_on_managed_node
```

Prefer capability-specific action before whole-app penalties:

- voice abuse: limit `voice.publish`, speaker slots, or room quota.
- message spam: limit `communication.messages.write`.
- AI abuse: limit AI jobs or summary capability.
- discovery risk: limit featured placement or search listing.

This is a hard product rule, not only a preference:

- if a single capability limit can stop the harm, do not hold the whole app.
- if new-session blocking can stop the harm, do not invalidate existing
  sessions.
- if rate limiting can stop the harm, do not deny all access.
- if official managed-node restriction can stop the harm, do not describe it as
  protocol-level suspension.
- if a app-operated external-route or direct route remains safe, do not hide that continuity
  from users.

### 9.5 Emergency Hold Authority Matrix

Emergency authority must be scoped by blast radius.

| Action | Allowed Trigger | Confirmation | Max Duration | Notes |
| --- | --- | --- | --- | --- |
| Capability temporary limit | on-call node/security operator | post-action receipt | 24 hours | for one capability such as voice publish or AI jobs |
| Managed-node emergency hold | 2-of-3 operator/multisig or review council fast path | receipt plus owner notice | 24 hours default, 72 hours max | blocks new official managed-node sessions or high-risk calls |
| Cross-node recommended hold | governance fast-track or designated emergency committee | governance request required | policy-defined | recommendation to compatible nodes, not automatic protocol ban |
| Registry `suspended` | accepted governance decision | execution receipt required | until remediation or appeal | protocol identity state changes |
| Registry `revoked` | final ruling or machine-verifiable severe rule | final settlement receipt | permanent unless later restore policy | should be rare |

Every emergency action must include:

- trigger reason.
- affected scope and capabilities.
- operator or committee identity.
- evidence hash.
- start time and expiry time.
- whether existing sessions are affected.
- owner notification status.
- appeal or counter-review route.

### 9.6 Wrongful Hold Remedy

If an emergency hold is later ruled incorrect, excessive, or abusive, V3 must
repair the damage as much as possible.

Required remedies:

- clear or downgrade public warnings.
- record a correction receipt.
- restore discovery rank or featured eligibility affected by the hold.
- mark the hold as wrongful in the app's status history.
- route bounded response-cost recovery when the policy allows it.
- penalize the responsible operator, node, or committee path if abuse or gross
  negligence is upheld.

Bond-routing source should follow fault:

- operator or node bond first when the node/operator caused the wrongful hold.
- Process Reserve only when fault is systemic or no accountable operator is
  available.
- challenger bond when a false or extortionary complaint caused the wrongful
  hold.

## 10. Stable Policy Epochs

V3 rules must be stable enough that backers, app owners, and challengers know
their risk before locking funds.

Policy epochs are the main simplification tool for V3. Instead of adding a new
manual rule every time app count, complaint volume, or node cost changes, V3
should publish bounded formulas and update them at predictable epochs. This
keeps early participation cheap while allowing the system to raise friction as
usage and abuse pressure grow.

Policy epoch rules:

- Every locked position stores `policyEpoch`.
- Every challenge case stores `policyEpoch`.
- Slashing caps, challenge windows, and appeal windows cannot be changed
  retroactively for existing positions or open cases.
- Material risk-rule changes require:
  - governance decision.
  - public notice.
  - migration or opt-in.
  - exit window for affected backers and app owners, unless active cases or
    exposure floors prevent immediate exit.
- Apps cannot reduce Owner Bond below active exposure floors.
- Backers cannot escape already-opened cases by requesting withdrawal after the
  case opens.
- Related-party backing and high-risk backing cannot avoid likely exposure by
  exiting during a risk notice window tied to the same fact pattern.
- Positions in exit delay stop taking new future-case exposure after
  `exitEffectiveAt`, unless they opt back in.

This follows the Chainlink-style principle that material slashing changes should
not silently change the risk profile of already-locked participants.

### 10.1 Parameter Risk Tiers

Not all parameters should use the same governance threshold.

| Tier | Examples | Governance Requirement |
| --- | --- | --- |
| `display` | labels, explanatory copy, non-economic UI ordering | ordinary governance or admin-with-receipt |
| `runtime` | rate limits, quota weights, discovery weights | governance decision, execution receipt, short notice |
| `economic_minor` | small bond multipliers, ordinary windows, low-risk thresholds | higher quorum, timelock, simulation summary |
| `economic_major` | slash caps, process-cost routing caps, asset policy, bond-disposition caps, risk-tier semantics | supermajority or review council plus timelock, simulation report, exit window |
| `emergency` | pause new funds, pause new challenge cases, freeze new exposure | emergency authority matrix, auto-expiry, governance escalation |

The policy must define who can change each tier, required quorum, timelock,
notice period, simulation requirement, and rollback path.

### 10.2 Hard Parameter Bounds

Governance can update parameters only inside protocol-defined bounds.

Recommended bounded parameters:

- minimum and maximum Challenge Bond.
- minimum and maximum Owner Bond by environment and quota tier.
- maximum per-case Owner Bond slash percentage.
- maximum Independent Support Signal forfeiture or routing cap by risk tier.
- maximum Challenger process-cost routing.
- minimum evidence window.
- minimum owner response window.
- minimum appeal window.
- maximum emergency hold duration.
- maximum Process Reserve drain per case and per epoch.
- maximum discovery/ranking boost from backing.

If governance tries to set a parameter outside its bounds, the change must fail
instead of relying on social review.

### 10.3 Immutable Position Terms

Every funded position must store the terms the participant accepted.

For Owner Bond, Independent Support Signal, Challenge Bond, and similar positions, store:

- `policyEpoch`.
- settlement asset.
- risk tier.
- max forfeiture or disposition cap.
- lockup.
- withdrawal delay.
- challenge window.
- evidence window.
- response window.
- appeal window.
- reward cap, if applicable.
- formula version, if dynamic formulas apply.

New policy epochs cannot retroactively increase these risk terms. A migration to
higher risk requires opt-in consent.

### 10.4 Upgrade Lifecycle

Economic parameter changes should follow:

```text
draft
  -> simulation
  -> pending timelock
  -> active for new positions
  -> optional migration
  -> legacy sunset
```

Rules:

- Simulation should show how the new parameters would have affected recent
  cases, backing levels, challenge pressure, quota, and risk-pool exposure.
- New positions use the new epoch after activation.
- Existing positions keep their old epoch unless they opt in.
- Legacy positions can have a sunset path, but they must retain withdrawal,
  appeal, evidence, and claim rights.
- High-risk migrations cannot silently convert `supporter` into
  `standard_risk`, or a 5% disposition cap into a 30% disposition cap.

### 10.5 Funding Pause Mode

When the V3 economic model, contract, oracle path, or parameter set may be
unsafe, the protocol needs a narrow pause mode.

Allowed:

- pause new Independent Support positions.
- pause new Challenge Bond cases.
- pause increased Owner Bond exposure.
- pause new high-risk risk-tier opt-ins.

Not allowed by default:

- blocking withdrawals that are already eligible.
- blocking evidence submission.
- blocking appeals.
- blocking case participation or bond-disposition appeals.
- changing existing bond-disposition caps.
- converting pending exits back into active exposure.

Open cases should move into a protected mode that preserves evidence,
responses, appeals, and final settlement rights while preventing new exposure
from accumulating.

### 10.6 Dynamic Policy Formula Engine

Some parameters should adjust as participation grows, similar in spirit to
difficulty adjustment in mining: early networks need lower barriers, while large
or high-volume systems need stronger spam resistance and risk controls.

V3 should treat repeated, scale-sensitive rules as entries in a Dynamic Policy
Formula Engine. The engine calculates parameter values, not subjective rulings.

The abstract shape:

```text
observed_metrics
  -> normalize_against_baseline
  -> smooth_over_time
  -> compute_pressure_score
  -> apply_growth_curve
  -> clamp_to_hard_bounds
  -> apply_hysteresis_and_step_limits
  -> publish_as_next_policy_epoch_value
```

Generic formula:

```text
normalized_signal_i =
  clamp(
    (smoothed_metric_i - baseline_i) / scale_i,
    min_signal_i,
    max_signal_i
  )

pressure_score =
  clamp(
    sum(weight_i * normalized_signal_i),
    min_pressure,
    max_pressure
  )

raw_value =
  base_value
  * ecosystem_growth_curve(active_apps, usage_volume)
  * risk_curve(pressure_score)
  * actor_multiplier(actor_reputation, sybil_risk, relation_class)
  * capability_multiplier(capability_risk_class)

bounded_value =
  clamp(raw_value, hard_min, hard_max)

epoch_value =
  hysteresis(
    round_to_step(bounded_value, step_size),
    previous_epoch_value,
    deadband,
    max_up_step,
    max_down_step
  )
```

The intuition:

- `ecosystem_growth_curve` handles the "early network versus large network"
  problem.
- `risk_curve` handles changing abuse, complaint, dispute, or node-cost
  pressure.
- `actor_multiplier` handles the difference between a proven user, a new wallet,
  an owner-affiliate account, or a suspicious cluster.
- `capability_multiplier` handles the difference between low-risk discovery,
  voice publishing, AI jobs, node quota, or fund-related actions.
- `hysteresis` prevents values from bouncing up and down every epoch.
- `hard_min` and `hard_max` keep governance-approved bounds stronger than the
  formula.

Dynamic formulas are allowed only when they are predictable, bounded, and
explainable.

Formula requirements:

- The formula version is part of `policyEpoch`.
- Inputs must be observable, auditable, and sybil-resistant enough for the
  parameter being changed. Examples include active app count, funded complaint
  rate, dispute uphold rate, total independent support, official node resource
  usage, and recent abuse pressure.
- Inputs must use smoothing, caps, and independence checks. Do not let one burst
  of fake usage, fake support, or coordinated complaints sharply change costs.
- Outputs must stay inside hard parameter bounds.
- Formula updates are policy changes and cannot retroactively change existing
  funded positions.
- Every epoch should publish the current computed values and the input window
  used to compute them.
- Every formula must declare a fallback value for oracle/indexer failure and a
  manual pause path for obviously unsafe computed outputs.
- Every formula must declare whether higher output means more friction, more
  exposure, more quota, or a stricter review threshold.
- Every formula must publish the input quality grade. Low data quality should
  freeze or slow changes instead of producing aggressive new values.

Example shape:

```text
effective_challenge_bond =
  clamp(
    base_bond
    * sqrt(1 + active_apps / app_scale)
    * (1 + abuse_pressure_30d * abuse_multiplier),
    min_challenge_bond,
    max_challenge_bond
  )
```

This lets the system start simple when there are few apps, then automatically
raise friction when app count, complaint volume, or abuse pressure grows. The
formula must not change disposition caps for already locked positions.

Formula outputs should be treated as parameter suggestions that become active
only through the epoch activation path. They should not directly execute
punishment, delisting, revocation, or subjective settlement.

Formula registry:

| Dynamic Rule | Formula Output | Main Inputs | Direction | Must Not Do |
| --- | --- | --- | --- | --- |
| Challenge Bond | `effective_challenge_bond` | active apps, complaint spam pressure, challenger reputation, sybil risk, usage history | raises complaint cost when abuse grows | decide whether complaint is true |
| Owner Bond Floor | `required_owner_bond_floor` | app environment, official-node quota, active users, managed-node cost, risk tier | raises owner accountability as exposure grows | guarantee safety or buy trust |
| Grey Rollout Exposure | `exposure_basis_points` | review status, healthy days, retention, risk score, complaint pressure, official managed-node health | grows or freezes discovery exposure | hide risk notices or revoke identity |
| Managed Node Quota | `managed_node_quota_units` | node cost, app usage, backing cap, incident rate, capability risk | expands or limits official-node usage | rank app-operated external routes or imply control over them |
| Risk Notice Threshold | `risk_notice_threshold` | complaint rate, severity mix, evidence quality, challenge abuse pressure | determines when public caution appears | show `Under Challenge` for every complaint |
| Review Escalation Threshold | `review_escalation_threshold` | risk pressure, disputed evidence, projected harm, unresolved cases | determines when manual review is required | auto-slash subjective cases |
| Response Cost Cap | `response_cost_cap` | complaint volume, owner size tier, repeated weak challenges | protects small teams from process drain | create Alcheme compensation or payout promises |
| Funding Pause Trigger | `funding_pause_pressure` | bond exposure ratio, asset allowlist state, correlated exposure, oracle data quality | pauses new bond exposure when unsafe | block eligible withdrawals or appeals |

Rules that should not be controlled directly by formulas:

- whether an app committed fraud.
- whether a user is malicious in a specific subjective dispute.
- whether a disputed incident warrants bond disposition.
- whether a registered app should be finally revoked.
- whether a reviewer or governance participant is corrupt.

Formulas may trigger limits, review, freezes, or escalation. Final subjective
judgment still needs governance, arbitration, or manual emergency review.

### 10.7 Legacy Epoch Display

App Store, developer dashboard, and backing/challenge flows must show:

- current app policy epoch.
- whether the app has legacy positions.
- which rule applies to a new action.
- whether existing positions can migrate.
- withdrawal or migration path for old positions.
- if the app has mixed epochs, which exposure belongs to which epoch.

Users should not need to read raw policy JSON to understand the risk they are
accepting.

### 10.8 Parameter Attack Monitoring

Governance changes to economic parameters need their own risk controls:

- extreme changes trigger extended timelock.
- conflicted voters or reviewers must disclose relevant exposure.
- simulation report is required before major economic changes.
- post-change monitoring checks complaint rate, withdrawal rate, dispute rate,
  and risk-pool exposure.
- rollback or correction path must exist for parameter mistakes.
- emergency parameter changes auto-expire unless confirmed through normal
  governance.

## 11. On-Chain / Off-Chain Boundary

The onion model only works if each layer has a narrow job. V3 should push
mechanical enforcement into contracts, but it should not push subjective product
judgment into contracts.

Boundary doctrine:

- On-chain handles custody, lockups, policy epoch references, liveness windows,
  case state, evidence hashes, authorized receipts, bounded release/slash logic,
  and settlement accounting.
- Query API and indexer handle projections, derived scores, labels, node policy,
  signed operational facts, and user-facing explanations.
- Governance handles subjective decisions, conflict review, exceptional
  correction, capture review, and high-impact intervention.
- Emergency operators may only trigger narrow, time-limited, receipt-bound
  controls that preserve evidence, appeals, and eligible withdrawals.

### 11.1 V3 On-Chain Responsibilities

V3 should add a separate economic/dispute program or account family keyed by
`appIdHash`. It should reference V2 records rather than mutating V2 into a large
fund-custody program.

The V3 program should remain a compact state machine. If a proposed contract
feature needs to judge intent, truthfulness, market quality, user sentiment, or
community norms, it belongs in signed evidence, governance, or arbitration, not
as hard-coded settlement logic.

On-chain should own:

- Owner Bond custody.
- Independent Support Signal positions and lockups.
- Challenge Bond escrow.
- Process Reserve accounting.
- policy epoch references.
- case id, evidence hash, dispute class, liveness, response, appeal, and final
  ruling digest.
- deterministic slash, release, and bond-disposition execution only after a
  pre-existing machine-verifiable rule or an accepted governance/arbitration
  receipt.

Potential accounts:

- `ExternalAppEconomicsConfig`
- `ExternalAppBondVault`
- `ExternalAppBackingPosition`
- `ExternalAppChallengeCase`
- `ExternalAppRuling`
- `ExternalAppSettlementReceipt`
- `ProtocolRiskPool`

### 11.2 Governance Responsibilities

Governance owns subjective decision formation:

- review council membership through Circle/CircleMember.
- policy versions through GovernancePolicy/GovernancePolicyVersion.
- challenge and appeal requests through GovernanceRequest.
- votes, approvals, vetoes, or arbitration signals through GovernanceSignal.
- final decisions through GovernanceDecision.
- execution receipts through GovernanceExecutionReceipt.

The V3 program should execute settlement only after receiving an accepted,
digest-bound governance or arbitration result, unless the case is
machine-verifiable under a pre-existing automatic rule.

Governance must include conflict disclosure and recusal rules for ExternalApp
cases. A reviewer, voter, or arbitrator should be excluded or down-weighted when
they have a material relationship with:

- the app owner, team, publisher, or investors.
- the challenger or challenger funders.
- a direct competitor in the same market category.
- a paid KOL, guild, agency, or commercial partner involved in the dispute.
- a node operator materially affected by the outcome.

If conflict status is disputed, that dispute should be handled before final
ruling or escalated to a higher-review policy. Decisions must record conflict
disclosures and recusal outcomes in the governance evidence.

### 11.2.1 Governance Capture And Sybil Resistance

ExternalApp disputes can become economically valuable. V3 must assume attempts
to capture reviewers, create fake independent identities, or buy governance
outcomes.

Controls:

- Reviewer eligibility should not rely on one signal. Use role, tenure,
  participation history, disclosure record, dispute accuracy, and conflict
  screening.
- Review panels should have diversity requirements where possible, such as
  independent reviewers, node/operator representation, user/community
  representation, and technical reviewer presence for technical cases.
- No single wallet, organization, app ecosystem, guild, investor group, or node
  operator should control a decisive share of a review panel.
- Voting power for ExternalApp disputes should use caps and quadratic or
  reputation-weighted limits when appropriate; do not let raw capital decide
  subjective cases.
- Reviewer reputation should include accuracy, timeliness, overturned rulings,
  conflict disclosures, and abuse findings.
- Reviewer reputation can decay over time or be scoped by domain so old
  participation cannot permanently dominate future cases.
- Bribery, paid voting, undisclosed sponsored review, or vote coordination with
  a party to the dispute should be its own governance violation.
- High-value or conflicted cases need an escalation path to a higher-review
  policy, larger panel, or external arbitration adapter.

Sybil controls should treat identity as probabilistic:

- wallet age and Alcheme usage history.
- relationship graph to app owner, challenger, reviewers, and known affiliates.
- repeated funding source or withdrawal destination.
- shared device, IP, or session signals where legally and operationally allowed.
- matching promotion, guild, or KOL campaign metadata.
- prior successful or failed challenges and review participation.

Sybil suspicion should reduce weight or require higher bonds, but it should not
automatically punish a user without evidence and appeal. False sybil labels need
a correction path.

If governance capture is suspected:

```text
capture signal
  -> freeze high-impact execution if not final
  -> open capture review
  -> expand or replace reviewer panel
  -> disclose suspected conflict classes
  -> decide whether to uphold, correct, or rerun the decision
```

Final settlement should not execute when a capture review is open against the
decisive governance process unless emergency safety requires temporary
capability limits.

### 11.3 Query API Responsibilities

Query API owns runtime projection and product UX:

- compute display scores.
- expose app store labels with explicit status provenance.
- enforce discovery, managed-node, and capability policies.
- verify app-room claims and user sessions.
- expose case status, evidence metadata, and ruling summaries.
- index V2/V3 chain events into Prisma read models.

Query API must not become the hidden source of final capital settlement.

For every visible status that can materially affect app reputation or access,
Query API and app store surfaces should be able to show:

- chain registry status.
- governance decision or execution receipt id.
- managed-node local policy, if the state is node-local.
- emergency operator action id, if applicable.
- evidence receipt hash.
- projection source and last indexed slot or timestamp.
- finality status.

Projection errors must have a correction path. If Query API or app store shows a
state that conflicts with the chain registry or governance receipt, the UI
should prefer a conservative "status sync pending" or "projection disputed"
label over silently presenting stale local state as final truth.

### 11.4 Projection And Oracle Integrity

V3 will depend on several off-chain or projected signals. They must not collapse
into one opaque truth source.

Source hierarchy:

1. finalized or confirmed SVM registry/economic program state.
2. governance decisions and execution receipts with digest linkage.
3. indexed projections from known slots/signatures.
4. signed node/operator evidence receipts.
5. app server signed reports.
6. user-submitted evidence.
7. UI labels, scores, and summaries.

Rules:

- Lower layers can explain or annotate higher layers, but cannot silently
  override them.
- Every projection row should keep source signature, slot, finality, program id,
  parser version, and last reconciliation time where applicable.
- If the indexer rewinds, reparses, or detects a conflicting event, Query API
  must mark affected app/store states as `projection_disputed` or
  `status_sync_pending` until reconciliation finishes.
- App store ranking must not use unfinalized high-impact events as final truth.
- Node/operator reports used as oracle inputs must be signed and include
  measurement window, route/capability scope, sample size, and evidence hash.
- App server reports used for bond-disposition or incident review must be signed by the
  registered server key version and bound to app id, case id, user, and time
  window.
- Parser upgrades that change V3 event interpretation are policy-relevant
  operational changes and need regression tests plus a reconciliation run.

### 11.5 Projection Dispute And Reconciliation

Any material mismatch among chain state, governance receipt, indexer projection,
Query API state, or app store display needs a repair path.

Reconciliation process:

```text
detect mismatch
  -> mark affected state as projection_disputed or status_sync_pending
  -> freeze harmful automatic actions based on the disputed projection
  -> replay source events / refetch receipts / verify signatures
  -> produce reconciliation receipt
  -> correct projection or escalate to governance if facts remain disputed
```

During projection disputes:

- do not slash funds based only on the disputed projection.
- do not newly delist or revoke based only on the disputed projection.
- allow low-risk user flows to continue where safe.
- display provenance and uncertainty instead of hiding the mismatch.

Repeated projection faults should affect node/operator trust, indexer release
quality, or operational readiness, but they should not directly punish an
ExternalApp unless the app caused the fault.

## 12. Governance Action Expansion

Existing ExternalApp governance actions are enough for V2 registration and basic
runtime control. V3 should add action types such as:

- `external_app_challenge_open`
- `external_app_challenge_abuse_countercase`
- `external_app_challenge_accept_remediation`
- `external_app_dispute_escalate`
- `external_app_dispute_rule`
- `external_app_appeal_open`
- `external_app_settlement_execute`
- `external_app_owner_bond_slash`
- `external_app_bond_disposition_execute`
- `external_app_bond_forfeiture_route`
- `external_app_policy_epoch_update`
- `external_app_parameter_bounds_update`
- `external_app_funding_pause`
- `external_app_policy_epoch_migration`
- `external_app_bond_exposure_guard_update`
- `external_app_projection_dispute_open`
- `external_app_projection_reconcile`
- `external_app_governance_capture_review`
- `external_app_emergency_hold_extend`
- `external_app_emergency_hold_correct`
- `external_app_registry_revoke`

These action types should reuse the existing Governance trunk. Do not add
`ReviewVote`, `ChallengeVote`, or `AppCourtDecision` as parallel concepts.

## 12.1 Compliance Modes And Asset Policy

V3 funding features must be switchable by policy, environment, jurisdiction, and
asset type. Do not assume every deployment can expose every economic feature.

Recommended modes:

| Mode | Allowed Features | Use |
| --- | --- | --- |
| `no_custody` | no Owner Bond custody, Independent Support, Challenge Bond, or bond disposition | local/dev, restricted jurisdictions, early product tests |
| `owner_bond_only` | Owner Bond only; no Independent Support or Challenger process-cost routing | production accountability with lower compliance surface |
| `bond_disposition_limited` | Owner Bond, Challenge Bond, and narrow process-cost routing | conservative mainnet mode |
| `bond_disposition_full` | Owner Bond, Independent Support, Challenge Bond, capped routing, and settlement receipts | only after policy, legal, and operational readiness |

Asset policy must be explicit:

- Each policy epoch declares allowed settlement assets.
- Assets may have different caps, modes, and jurisdiction rules.
- Stablecoins, SOL, and any future Alcheme token must be evaluated separately.
- Unsupported assets cannot be accepted through V3 custody or settlement paths.
- Changing allowed assets is a material policy change and requires notice plus
  migration or exit rules where locked positions are affected.

Funding participation may need geographic or eligibility restrictions. The
protocol should support disabling Independent Support, challenge routing, or
bond-disposition paths for environments or jurisdictions where the product meaning
would create unacceptable legal or operational risk.

## 13. App Store Behavior

The store should stay simple in V3.

Minimum behavior:

- list reviewed or production external programs.
- show status labels and risk notices.
- show status provenance for material warning, hold, suspension, and revocation
  states.
- show Owner Bond, independent support signals, and sponsor/affiliate support
  separately.
- show support signals without implying investment yield, compensation, coverage,
  or Alcheme guarantee.
- show challenge/dispute status only after the credibility gate decides the
  public label level.
- show whether the app uses official managed nodes or declares app-operated
  external routes.
- allow search, categories, latest, trending, and featured.

Ranking inputs:

- review status.
- appTrustScore.
- riskScore.
- real usage and retention.
- dispute history.
- capped support level.
- official managed-node health when the app uses official managed nodes.

Ranking must not be raw money ranking. Backing can help eligibility and quota,
but cannot dominate discovery.

### 13.1 Graduated Exposure And Grey Rollout

Optimistic acceptance should not mean immediate full exposure. New or newly
changed external programs should move through deterministic exposure buckets before
they become visible to the full audience.

Recommended exposure states:

```text
listed_internal
  -> listed_limited
  -> listed_sampled
  -> listed_broad
  -> listed_full
```

The app store can use a fixed formula to decide whether a viewer or context is
inside the current exposure bucket:

```text
exposure_bucket =
  hash(app_id || viewer_cohort || policy_epoch || rollout_salt) % 10_000

visible_when =
  exposure_bucket < exposure_basis_points
```

Rules:

- The formula version and `exposure_basis_points` belong to the policy epoch or
  app rollout record.
- `rollout_salt` should be stable within an epoch so exposure does not flicker
  on every request.
- `viewer_cohort` should avoid private personal targeting by default; prefer
  coarse context such as environment, app category, circle context, region class
  where lawful, or anonymous bucket.
- Rollout growth should depend on review status, risk score, official managed-node health,
  complaint rate, retention, and absence of severe signals.
- If severe signals appear, the system can freeze rollout growth, move the app
  back to a lower exposure state, or require manual review before expansion.
- Grey rollout is a discovery and traffic-control mechanism. It is not protocol
  revocation, and it should not hide provenance or risk notices.

This reduces the optimistic-mechanism time gap: a bad app can still be
challenged after launch, but it should not receive full ecosystem exposure
before enough low-risk operation has been observed.

Public labels for complaints should be graduated:

| Internal State | Public Label |
| --- | --- |
| `private_watch` | none or neutral developer-only notice |
| `public_watch` | `Risk Notice` |
| `review` | `Under Review` |
| `dispute` | `Under Challenge` |
| `severe_fast_track` | `Emergency Review` or capability-specific warning |

Do not show `Under Challenge` for every funded complaint. That label is too
powerful and can be weaponized.

When official managed-node access is limited, app surfaces should distinguish:

- `Official Managed Node Limited`: Alcheme official node policy is restricted.
- `External Route Declared`: compatible app-operated external-route route exists.
- `Direct Program Entry Available`: external program can still be reached directly.
- `Protocol Registry Not Revoked`: chain registry identity remains non-revoked;
  any active dispute is a V3 case or projection state, not a V2 registry enum.

This keeps node-local emergency controls from becoming an implicit protocol ban.

Cold-start apps should have a visible path to discovery through reviewed status,
low-risk operation, and real usage, even when they do not yet have meaningful
Independent Support Signal. This prevents the store from becoming pay-to-rank.

## 14. Attack Scenarios And Controls

| Attack | Control |
| --- | --- |
| Rich app buys all trust | backing caps, owner-affiliate detection, money not enough for trust |
| Competitor funds challenge attack | challenge bond, evidence requirement, usage weighting, false-complaint penalty |
| Competitor uses challenge only to create public FUD | challenge credibility gate, graduated labels, private_watch before public label |
| Challenger privately demands payment to withdraw | anti-extortion challenge-abuse class and counter-case |
| Rich attacker treats challenge bonds as marketing cost | dynamic bonds, challengerReputation, capped response-cost routing |
| Small team is drained by repeated weak complaints | response cost protection and repeat-abuse bond escalation |
| Fake victims try to trigger bond routing | evidence tiers, related-party exclusion, actor deduplication |
| App owner creates fake victims | related-party exclusion and signed evidence requirements |
| Same actor acts as challenger, affected user, and supporter | actor role deduplication and capped combinations |
| Process Reserve is drained by one incident | per-case, per-actor, evidence-class, and per-epoch caps |
| Program-internal loss cannot be verified | external program loss oracle boundary and governance fallback |
| Small incident reports cost more to review than to process | Merkle/evidence batch path and weak-evidence risk-score-only path |
| New wallets spam complaints | low new-account weight, sybil clustering, usage-record multiplier |
| App owner masquerades as community | related-wallet marking, owner-affiliate tier |
| Paid KOL or guild backing masquerades as organic support | related-party classification, backingIndependenceScore, disclosure requirements |
| Backed label is marketed as official guarantee | safer labels, detail-page separation, misleading-promotion complaint type |
| Owner Bond is marketed as insurance | explicit owner-accountability wording and misleading-promotion enforcement |
| Process Reserve is marketed as platform guarantee | process-reserve wording, no-coverage disclaimer, and non-insurance disclosure |
| Challenger rewards become bounty arbitrage | process-cost routing framing, capped routing, dynamic bonds |
| Jurisdiction restricts funding participation | compliance modes and asset allowlists |
| Governance lowers challenge bond to enable spam | hard parameter bounds and parameter attack monitoring |
| Governance raises disposition caps for old supporters | immutable position terms and opt-in migration |
| Economic bug requires pause | funding pause mode preserving withdrawals, appeals, evidence, and case rights |
| Dynamic formula reacts too sharply to attack burst | bounded formula with smoothing and published input window |
| Users cannot tell which rules apply | legacy epoch display and position terms |
| Multiple severe cases strain bond liquidity | exposure states, reserve accounting, and new-exposure pause |
| Stablecoin or token depegs | asset-specific funding pause and haircut/conversion policy |
| SOL volatility makes bonds undercollateralized | asset-specific reserve ratios and dynamic bond formulas |
| Correlated apps fail together | shared exposure limits by owner, publisher, guild, or infrastructure |
| Process reserve hides constraints from users | public exposure status and dashboard disclosure |
| Optimistic launch exposes too many users before challenge catches up | deterministic grey rollout, exposure caps, severe-signal freeze, and manual review before expansion |
| Evidence hash exists but raw evidence is gone | evidence availability deadline and downgrade/reopen rule |
| Private evidence leaks user data | redaction policy, sealed review, retention limits |
| App owner submits selective logs | signed log requirements, cross-check with sessions and chain receipts |
| Fake screenshots drive rulings | screenshot-only evidence cannot trigger automatic bond disposition or slash |
| AI summary contaminates governance | AI summaries are advisory, cited, hash-recorded, and never sole evidence |
| Indexer lag changes app store status | finality/provenance display and status_sync_pending state |
| Parser bug creates false dispute | parser versioning, reconciliation receipt, and projection_disputed state |
| Node report acts like unchecked oracle | signed report schema, measurement window, and evidence hash |
| App server fabricates incident reports | registered key version binding and cross-check with Alcheme usage records |
| Projection mismatch triggers slashing | freeze harmful automatic actions during reconciliation |
| Review council is captured by one faction | panel diversity, voting caps, escalation path |
| Fake independent identities gain influence | probabilistic sybil controls and identity cluster weighting |
| Reviewers are bribed or sponsored | bribery/paid voting violation and conflict disclosure |
| Old reputation permanently dominates | reputation decay and domain-scoped reviewer reputation |
| Final settlement executes during capture dispute | freeze high-impact execution during capture review |
| Backers exit before bad news finalizes | unbonding delay, open-case exposure freeze |
| Related parties exit during pre-dispute rumors | risk notice window and delayed related-party withdrawals |
| Small legitimate team cannot compete with capital-heavy apps | Low Quota Production and Owner Bond Only cold-start path |
| Reviewer conflict of interest | disclosure, recusal, governance eligibility filters, conflict records |
| Official node becomes de facto centralized ban point | status provenance, app-operated external-route/direct continuity labels, node-local scope |
| Emergency hold is used too broadly | authority matrix, auto-expiry, least restrictive enforcement |
| Projection shows stale or wrong state | finality/provenance display and correction receipts |
| Wrongful emergency hold damages app reputation | wrongful hold remedy, correction receipt, discovery restoration, operator accountability |
| Node operator abuses emergency hold | max duration, reason logging, appeal path, separate final ruling |
| Subjective case gets auto-slashed | require governance/arbitration for subjective classes |
| Backing becomes yield product | no yield promise, risk disclosure, capped rewards |
| App store delisting mistaken for shutdown | separate discovery, node, capability, and registry states |

### 14.1 Security Risk Control Matrix

The risks above should not be handled by a new parallel security system. Each
risk must be routed back into the onion model so the implementation remains
small enough to audit.

| Risk Area | Onion Layer | Control In Current Framework | Hard Rule |
| --- | --- | --- | --- |
| app identity spoofing | identity | V2 registry, manifest hash, owner wallet, server key hash, `appRoomClaim`, nonce, expiry, audience binding | browser client never proves app authority by itself |
| CORS or domain spoofing | identity / capability | allowed origins as UX filter, registry and server claim as authority, wallet session for user action | CORS is not an authentication root |
| server key compromise | identity | key rotation, manifest update, registry status, owner notice, high-risk capability freeze | leaked keys trigger scoped key rotation before broad app punishment |
| formula manipulation | formula / capability | smoothing, hard bounds, hysteresis, input quality grade, sybil/relationship weighting, manual freeze | formulas adjust parameters; formulas do not decide guilt |
| complaint extortion | optimistic challenge | Challenge Bond, private watch, credibility gate, abuse counter-case, response-cost protection | public `Under Challenge` requires credibility gate |
| economic pool drain | economic | per-case caps, per-actor caps, exposure ratio, exposure state, and new-exposure pause | bond routing cannot bypass exposure and cap policy |
| Independent Support financialization | economic / app store | no-yield wording, risk-tier opt-in, supporter zero-principal-slash default, label separation | support is not investment, insurance, or Alcheme guarantee |
| official node overreach | capability | separate `DiscoveryStatus`, `ManagedNodePolicy`, `CapabilityPolicy`, `RegistryStatus`, continuity labels | node-local restriction must not be described as protocol ban |
| projection or indexer error | projection | finality, source signature, parser version, `projection_disputed`, reconciliation receipt | no slashing, delisting, or revocation based only on disputed projection |
| governance capture | governance | disclosure, recusal, voting caps, reviewer reputation, panel diversity, capture review, escalation | high-impact settlement pauses during capture review |
| emergency operator abuse | capability / governance | authority matrix, max duration, reason log, owner notice, appeal path, correction receipt | emergency controls are temporary and receipt-bound |
| contract custody bug | economic | V3A no-custody first, V3B narrow escrow, audit, tests, pause new exposure, preserve withdrawals | do not launch broad Independent Support before smaller bond custody is proven |

Implementation implication:

- V3A must implement read-model security provenance, formula simulation, grey
  rollout, and manual-freeze receipts before any custody.
- V3B must keep Owner Bond and Challenge Bond narrow, bounded, and
  machine-verifiable or receipt-bound.
- V3C must not launch Independent Support until exposure, wording, disposition caps, and
  withdrawal rules are visible to users.
- V3D hardens governance after the ordinary path is already observable.

## 15. V3 Readiness Gates

Do not implement V3 custody or settlement until these are decided. If a gate is
not ready, keep the feature in read-model, simulation, or no-custody mode.

1. Automation and intervention boundary:
   - which actions are fully automatic, which actions are reversible limits,
     which actions require governance, and which emergency controls can be used
     before final ruling. Every emergency path needs max duration, receipt
     fields, appeal path, and correction remedy.
   - how each major security risk maps to the onion layer, control owner, and
     hard rule in the Security Risk Control Matrix.
2. Settlement asset:
   - SOL, stablecoin, future Alcheme token, or a configurable SPL mint. V3 must
     use an explicit asset allowlist per policy epoch and environment; no asset
     should be accepted merely because it is technically transferable.
3. Legal/product wording:
   - Independent Support Signal cannot be presented as investment yield. Owner Bond must
     not be marketed as insurance or principal protection. Process Reserve
     must not be marketed as a platform guarantee.
4. Review council bootstrap:
   - which Circle is the first Alcheme Review Council.
   - how `external_app_review_primary`, `external_app_risk_emergency`,
     `external_app_appeal`, and `external_app_parameter_governance` role
     bindings resolve to `circleId`, `policyId`, and active policy version.
   - production registration must use the active role binding rather than an
     arbitrary caller-supplied `reviewCircleId`.
5. Policy epoch schema:
   - how rule versions are approved, noticed, and migrated.
6. Parameter governance:
   - risk tiers, hard bounds, Dynamic Policy Formula Engine, formula registry,
     input quality grades, simulation report format, timelocks, rollback path,
     and funding pause scope.
7. Evidence policy:
   - evidence availability, redaction tiers, chain of custody, privacy-sensitive
     evidence handling, AI summary constraints, and retention period.
8. Dispute classes:
   - exact machine-verifiable, operational, user-harm, and community-policy
     classes.
9. Slashing caps:
   - concrete caps by participant tier and case severity.
10. Exposure policy:
   - exposure ratios, exposure accounting, asset depeg handling, new-exposure
     pause, correlated exposure limits, and public policy states.
11. Bond-disposition policy:
   - eligible evidence classes, evidence tiers, actor deduplication,
     related-party exclusion, routing caps, and small-incident batch path.
12. Emergency hold authority:
   - who can trigger it, max duration, and required receipt fields.
13. Related-party and disclosure policy:
   - owner/team/investor/KOL/guild/sponsor classification, required
     disclosures, and appeal path for misclassification.
14. Public label policy:
   - exact wording for Owner Bond, Independent Support Declared,
     Sponsor/Affiliate Support, risk notices, and non-endorsement language.
15. Cold-start quotas:
   - default Low Quota Production limits, deterministic grey rollout formula,
     initial exposure percentage, expansion criteria, severe-signal freeze, and
     growth path.
16. Risk notice window:
   - signal thresholds, duration, withdrawal delay scope, owner notice, and
     whether rollout growth should freeze during the window.
17. Challenge abuse controls:
   - challenger reputation, dynamic bond escalation, graduated public labels,
     anti-extortion rules, and response-cost caps.
18. Compliance modes:
   - `no_custody`, `owner_bond_only`, `bond_disposition_limited`, and
     `bond_disposition_full` availability by environment, jurisdiction, asset,
     and app risk class.
19. Governance conflict policy:
   - disclosure, recusal, disputed-conflict handling, and evidence recording.
20. Governance capture resistance:
   - reviewer eligibility, panel diversity, voting caps, bribery rules, sybil
     controls, reputation decay, capture review, and rerun/escalation path.
21. Status provenance:
   - chain status, governance receipt, node-local policy, emergency action,
     evidence receipt, finality, and projection timestamp display rules.
22. Projection integrity:
   - source hierarchy, parser version, finality, reconciliation receipt,
     projection dispute state, and node/app report signature schema.
23. Wrongful hold remedy:
   - correction receipts, discovery restoration, bounded response-cost routing
     where active policy allows it, and operator or node accountability.
24. Indexer projection:
   - V3 events and Prisma read models.

## 16. Recommended V3 Build Order

Build V3 in onion layers. Do not jump directly to a full economic court.

### 16.1 V3A: No-Custody Model And Projection

Goal: make the product model visible and testable without holding user funds.

Scope:

1. Write the implementation plan from this stability model.
2. Add V3 domain types, policy epoch model, dispute/case state, public label
   policy, and status provenance in Query API without custody.
3. Add parameter risk tiers, hard bounds, Dynamic Policy Formula Engine,
   formula registry, upgrade lifecycle, funding pause, legacy epoch display, and
   simulation output without custody.
4. Add cold-start quota, backing independence, related-party classification,
   challenger reputation, challenge abuse, and risk notice models without
   custody.
5. Add deterministic grey rollout formula, exposure bucket projection, rollout
   freeze, and expansion criteria without custody.
6. Add projection integrity, source hierarchy, signed report schema,
   reconciliation receipt, and projection dispute models without custody.
7. Add app store/status projection and developer dashboard for the no-custody
   model.

Exit criteria:

- developers and users can see the onion-layer state clearly.
- no user funds are locked.
- dynamic parameter outputs are simulated and bounded.
- formula inputs, pressure scores, bounds, and epoch outputs are inspectable.
- exposure buckets are reproducible, explainable, and reversible.
- emergency and manual intervention paths are visible but not settlement-active.

### 16.2 V3B: Bounded Owner Bond And Challenge Bond

Goal: introduce the smallest useful custody surface.

Scope:

1. Add compliance mode, asset allowlist, funding eligibility, and product wording
   guardrails.
2. Add V3 Anchor/SVM program for Owner Bond and Challenge Bond escrow first.
3. Add case lifecycle, evidence hash anchoring, response/appeal windows, and
   liveness rules.
4. Add settlement execution only for pre-defined machine-verifiable cases.
5. Keep subjective cases governance-bound and non-automatic.

Exit criteria:

- every fund movement is tied to a policy epoch, case id, and receipt.
- Challenge Bond forfeiture/release is bounded and test-covered.
- Owner Bond cannot be slashed for subjective cases without accepted governance
  or arbitration receipt.

### 16.3 V3C: Risk Disclaimer And Participant Bond Disposition

Goal: add the narrowest optional participant-posted bond-disposition layer only
after the smaller owner/challenge bond system has operational history.

Scope:

1. Add risk-disclaimer acceptance before external-app entry or bond-affecting
   actions.
2. Add participant-posted bond positions with explicit policy scope, lockups,
   withdrawal delays, and disposition caps.
3. Add bond-exposure state, asset allowlist state, correlated exposure checks,
   and new-exposure pause enforcement.
4. Add bond-disposition evidence tiers, related-party exclusion, and receipt
   linkage.
5. Add wrongful hold correction, discovery restoration, and audit receipts
   without compensation or liability wording.

Exit criteria:

- V3C is not marketed as yield, insurance, guarantee, compensation,
  reimbursement, refund, principal protection, or make-whole coverage.
- bond-disposition caps, lockups, and settlement asset behavior are visible
  before users opt in.
- correlated exposure and asset-risk limits can pause new exposure before
  unsafe concentration.

### 16.4 V3D: Governance Hardening And Exceptional Cases

Goal: improve judgment quality without turning V3 into a general-purpose court.

Scope:

1. Expand Governance action types and execution receipts for challenge and
   dispute lifecycle.
2. Add governance capture, sybil cluster, reviewer reputation, panel diversity,
   disclosure, recusal, rerun, and escalation models.
3. Add optional arbitration adapter only for case types that outgrow internal
   review.
4. Add end-to-end smoke tests covering registration, projection, backing,
   challenge, dispute, settlement, emergency hold, correction, and runtime
   policy projection.

Exit criteria:

- subjective cases have evidence, response, appeal, conflict review, and final
  receipt paths.
- high-impact execution pauses when capture review or projection dispute is
  open.
- exceptional-case handling remains narrow and receipt-bound.

## 17. Non-Goals For V3

- Full app-operated external-route public service node staking. That is V4.
- A general-purpose court unrelated to Alcheme app policy.
- App store as a service kill switch.
- Pure token-weighted listing control.
- Yield-bearing community backing.
- Retroactive slashing rule changes.
- Automatic confiscation because complaint amount exceeds backing amount.
