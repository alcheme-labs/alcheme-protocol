import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

import {
  canonicalGovernanceJson,
  hashCanonicalGovernanceValue,
} from '../governance/canonicalCodec';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { readContributionAssessmentArtifactSnapshots } from './artifact';

const CLAIM_ENVELOPE_DOMAIN = 'alcheme.contribution-credential-claim-envelope';
const CLAIM_RECORD_DOMAIN = 'alcheme.contribution-credential-claim-record';
const LOCAL_CHAIN_ID = 'solana:localnet';
const CONSENT_VERSION = 'p04-personal-receipt-consent:v1';
const MAX_CONSENT_TTL_MS = 300_000;
const CLAIM_FACT_KEYS = [
  'schemaVersion', 'action', 'chainId', 'idempotencyKey', 'credentialKind',
  'knowledgeRowId', 'knowledgePublicId', 'governanceHomeRef', 'entitlementId',
  'assessmentId', 'proofPackageHash', 'contributorsRoot', 'claimantPubkey',
  'payerMode', 'payerRef', 'payerPolicyRef', 'payerPolicyDigest', 'visibility',
  'consentVersion', 'consentIssuedAt', 'consentExpiresAt', 'automaticEnqueue',
  'permissionFactSource', 'issuanceStatus',
] as const;

export type ContributionCredentialVisibility = 'private' | 'circle' | 'public';
export type ContributionCredentialPayerMode = 'requester' | 'circle_sponsor';

export interface ContributionCredentialClaimFacts {
  schemaVersion: 1;
  action: 'contribution_credential_claim.request';
  chainId: 'solana:localnet';
  idempotencyKey: string;
  credentialKind: 'personal_receipt';
  knowledgeRowId: number;
  knowledgePublicId: string;
  governanceHomeRef: string;
  entitlementId: number;
  assessmentId: string;
  proofPackageHash: string;
  contributorsRoot: string;
  claimantPubkey: string;
  payerMode: 'requester';
  payerRef: string;
  payerPolicyRef: null;
  payerPolicyDigest: null;
  visibility: ContributionCredentialVisibility;
  consentVersion: typeof CONSENT_VERSION;
  consentIssuedAt: string;
  consentExpiresAt: string;
  automaticEnqueue: false;
  permissionFactSource: false;
  issuanceStatus: 'unfunded/pending_settlement';
}

export interface ContributionCredentialClaimReadback {
  eligible: boolean;
  blockerCode: string | null;
  publicDemoAssetPolicy: {
    scope: 'public_us_adult_demo';
    network: 'solana:devnet';
    realAssetIssuance: 'disabled';
    nftMinting: 'disabled';
    personalCredential: 'off_chain_optional_receipt_only';
    permissionFactSource: false;
    externalAssetAuthorities: 'not_applicable';
  };
  payerOptions: {
    requester: 'available';
    circleSponsor: 'not_configured';
  };
  settlementReadiness: ContributionCredentialSettlementReadiness;
  claim: ReturnType<typeof serializeClaim> | null;
}

export interface ContributionCredentialSettlementReadiness {
  state: 'setup_required';
  network: 'solana:localnet';
  homeIdentityBinding: 'active' | 'not_configured';
  homeIdentityBindingRef: string | null;
  resourceBinding: 'not_configured';
  requesterFunding: 'declared_not_preflighted';
  circleSponsorPolicy: 'not_configured' | 'present_unverified';
  activePayerPolicyCount: number;
  assetAuthorityPolicy: 'not_configured' | 'present_unverified';
  activeAssetAuthorityPolicyCount: number;
  providerExecution: 'unavailable';
  issuance: 'not_authorized';
  acceptedOutcomePreserved: true;
  identityEvidenceIssuancePlan: IdentityEvidenceIssuancePlan;
  blockerCodes: string[];
}

export interface IdentityEvidenceIssuancePlan {
  schemaVersion: 1;
  planKind: 'identity_evidence_issuance_plan';
  state: 'free_alternative_available';
  activationAllowed: false;
  provider: {
    mode: 'none_off_chain_optional_receipt';
    network: 'solana:localnet';
    providerRef: null;
  };
  costs: {
    currency: 'devnet_test_asset_units';
    providerCost: 0;
    issuanceCost: 0;
    renewalCost: 0;
    transactionCost: 0;
    rentCost: 0;
    feePayer: 'none_required_for_free_alternative';
    rentRefund: 'not_applicable';
  };
  issuer: {
    requiredForFreeAlternative: false;
    issuerRef: null;
    credentialAuthorizedSigner: null;
    sponsorMayBecomeIssuer: false;
  };
  holderConsent: {
    required: true;
    source: 'wallet_signed_contribution_credential_claim';
    consentVersion: typeof CONSENT_VERSION;
    status: 'missing' | 'captured';
    consentPayloadDigest: string | null;
    consentExpiresAt: string | null;
  };
  transaction: {
    digest: null;
    quota: {
      paidIssuancePerClaim: 0;
      freeAlternativePerClaim: 1;
    };
    automaticEnqueue: false;
  };
  forcedNewIssuance: {
    allowedBeforeFrozenPaidPlan: false;
    freeAlternative: 'off_chain_optional_receipt_only';
  };
}

export class ContributionCredentialClaimError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ContributionCredentialClaimError';
  }

  toResponseBody() {
    return { error: this.code, message: this.message };
  }
}

export async function loadContributionCredentialClaimReadback(input: {
  prisma: any;
  knowledgeId: string;
  actorPubkey: string;
  now?: Date;
}): Promise<ContributionCredentialClaimReadback> {
  const claimantPubkey = publicKey(input.actorPubkey);
  const latestClaim = await input.prisma.contributionCredentialClaim.findFirst({
    where: {
      knowledgePublicId: requiredText(input.knowledgeId, 'contribution_claim_knowledge_required'),
      claimantPubkey,
    },
    orderBy: [{ createdAt: 'desc' }],
  });
  let source: Awaited<ReturnType<typeof resolveCurrentClaimSource>> | null = null;
  let eligibilityError: ContributionCredentialClaimError | null = null;
  try {
    source = await resolveCurrentClaimSource(input.prisma, input.knowledgeId, claimantPubkey);
  } catch (error) {
    if (!(error instanceof ContributionCredentialClaimError)) throw error;
    eligibilityError = error;
  }
  const governanceHomeRef = source
    ? String(source.knowledge.circleId)
    : latestClaim?.governanceHomeRef ?? null;
  return {
    eligible: eligibilityError === null,
    blockerCode: eligibilityError?.code ?? null,
    publicDemoAssetPolicy: {
      scope: 'public_us_adult_demo',
      network: 'solana:devnet',
      realAssetIssuance: 'disabled',
      nftMinting: 'disabled',
      personalCredential: 'off_chain_optional_receipt_only',
      permissionFactSource: false,
      externalAssetAuthorities: 'not_applicable',
    },
    payerOptions: { requester: 'available', circleSponsor: 'not_configured' },
    settlementReadiness: await loadContributionCredentialSettlementReadiness({
      prisma: input.prisma,
      governanceHomeRef,
      latestClaim,
      now: input.now,
    }),
    claim: latestClaim ? serializeClaim(latestClaim) : null,
  };
}

async function loadContributionCredentialSettlementReadiness(input: {
  prisma: any;
  governanceHomeRef: string | null;
  latestClaim: any | null;
  now?: Date;
}): Promise<ContributionCredentialSettlementReadiness> {
  const now = validDate(input.now ?? new Date(), 'contribution_claim_now_invalid');
  const identityBinding = input.governanceHomeRef
    ? await input.prisma.governanceHomeIdentityBinding.findFirst({
      where: {
        homeType: 'circle',
        homeRef: input.governanceHomeRef,
        status: 'active',
        supersededAt: null,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
      },
      orderBy: [{ identityVersion: 'desc' }],
      select: { id: true },
    })
    : null;
  const [activePayerPolicyCount, activeAssetAuthorityPolicyCount] = identityBinding
    ? await Promise.all([
      input.prisma.payerPolicy.count({
        where: {
          homeIdentityBindingId: identityBinding.id,
          network: LOCAL_CHAIN_ID,
          status: 'active',
          supersededAt: null,
          AND: [
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
            { OR: [{ expiry: null }, { expiry: { gt: now } }] },
          ],
        },
      }),
      input.prisma.assetAuthorityPolicy.count({
        where: {
          homeIdentityBindingId: identityBinding.id,
          network: LOCAL_CHAIN_ID,
          status: 'active',
          supersededAt: null,
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
        },
      }),
    ])
    : [0, 0];
  const blockerCodes = [
    ...(identityBinding ? [] : ['contribution_credential_home_identity_not_configured']),
    'contribution_credential_resource_binding_not_configured',
    'contribution_credential_fee_payer_not_preflighted',
    activeAssetAuthorityPolicyCount > 0
      ? 'contribution_credential_asset_authority_scope_unverified'
      : 'contribution_credential_asset_authority_not_configured',
    'contribution_credential_provider_execution_unavailable',
  ];
  return {
    state: 'setup_required',
    network: LOCAL_CHAIN_ID,
    homeIdentityBinding: identityBinding ? 'active' : 'not_configured',
    homeIdentityBindingRef: identityBinding?.id ?? null,
    resourceBinding: 'not_configured',
    requesterFunding: 'declared_not_preflighted',
    circleSponsorPolicy: activePayerPolicyCount > 0 ? 'present_unverified' : 'not_configured',
    activePayerPolicyCount,
    assetAuthorityPolicy: activeAssetAuthorityPolicyCount > 0 ? 'present_unverified' : 'not_configured',
    activeAssetAuthorityPolicyCount,
    providerExecution: 'unavailable',
    issuance: 'not_authorized',
    acceptedOutcomePreserved: true,
    identityEvidenceIssuancePlan: buildIdentityEvidenceIssuancePlan(input.latestClaim),
    blockerCodes,
  };
}

function buildIdentityEvidenceIssuancePlan(claim: any | null): IdentityEvidenceIssuancePlan {
  const consentPayloadDigest = typeof claim?.consentPayloadDigest === 'string'
    && /^[a-f0-9]{64}$/.test(claim.consentPayloadDigest)
    ? claim.consentPayloadDigest
    : null;
  const consentExpiresAt = claim?.consentExpiresAt
    ? validDate(claim.consentExpiresAt, 'contribution_claim_consent_expiry_invalid').toISOString()
    : null;
  return {
    schemaVersion: 1,
    planKind: 'identity_evidence_issuance_plan',
    state: 'free_alternative_available',
    activationAllowed: false,
    provider: {
      mode: 'none_off_chain_optional_receipt',
      network: LOCAL_CHAIN_ID,
      providerRef: null,
    },
    costs: {
      currency: 'devnet_test_asset_units',
      providerCost: 0,
      issuanceCost: 0,
      renewalCost: 0,
      transactionCost: 0,
      rentCost: 0,
      feePayer: 'none_required_for_free_alternative',
      rentRefund: 'not_applicable',
    },
    issuer: {
      requiredForFreeAlternative: false,
      issuerRef: null,
      credentialAuthorizedSigner: null,
      sponsorMayBecomeIssuer: false,
    },
    holderConsent: {
      required: true,
      source: 'wallet_signed_contribution_credential_claim',
      consentVersion: CONSENT_VERSION,
      status: consentPayloadDigest ? 'captured' : 'missing',
      consentPayloadDigest,
      consentExpiresAt,
    },
    transaction: {
      digest: null,
      quota: {
        paidIssuancePerClaim: 0,
        freeAlternativePerClaim: 1,
      },
      automaticEnqueue: false,
    },
    forcedNewIssuance: {
      allowedBeforeFrozenPaidPlan: false,
      freeAlternative: 'off_chain_optional_receipt_only',
    },
  };
}

export async function prepareContributionCredentialClaim(input: {
  prisma: any;
  knowledgeId: string;
  actorPubkey: string;
  payerMode: ContributionCredentialPayerMode;
  visibility: ContributionCredentialVisibility;
  now?: Date;
}) {
  const claimantPubkey = publicKey(input.actorPubkey);
  if (input.payerMode !== 'requester') {
    throw new ContributionCredentialClaimError(
      'contribution_claim_circle_sponsor_not_configured',
      409,
      'Circle sponsorship requires an active scoped PayerPolicy and is not configured',
    );
  }
  const visibility = enumValue(input.visibility, ['private', 'circle', 'public'], 'contribution_claim_visibility_invalid');
  const source = await resolveCurrentClaimSource(input.prisma, input.knowledgeId, claimantPubkey);
  const consentIssuedAt = validDate(input.now ?? new Date(), 'contribution_claim_now_invalid');
  const consentExpiresAt = new Date(consentIssuedAt.getTime() + MAX_CONSENT_TTL_MS);
  const facts: ContributionCredentialClaimFacts = {
    schemaVersion: 1,
    action: 'contribution_credential_claim.request',
    chainId: LOCAL_CHAIN_ID,
    idempotencyKey: randomUUID(),
    credentialKind: 'personal_receipt',
    knowledgeRowId: source.knowledge.id,
    knowledgePublicId: source.knowledge.knowledgeId,
    governanceHomeRef: String(source.knowledge.circleId),
    entitlementId: source.entitlement.id,
    assessmentId: source.assessment.id.toString(),
    proofPackageHash: source.knowledge.binding.proofPackageHash,
    contributorsRoot: source.knowledge.binding.contributorsRoot,
    claimantPubkey,
    payerMode: 'requester',
    payerRef: claimantPubkey,
    payerPolicyRef: null,
    payerPolicyDigest: null,
    visibility,
    consentVersion: CONSENT_VERSION,
    consentIssuedAt: consentIssuedAt.toISOString(),
    consentExpiresAt: consentExpiresAt.toISOString(),
    automaticEnqueue: false,
    permissionFactSource: false,
    issuanceStatus: 'unfunded/pending_settlement',
  };
  return {
    facts,
    signedMessage: buildContributionCredentialClaimSigningMessage(facts),
  };
}

export async function acceptContributionCredentialClaim(input: {
  prisma: any;
  knowledgeId: string;
  actorPubkey: string;
  signedMessage: string;
  signature: string;
  now?: Date;
}) {
  const claimantPubkey = publicKey(input.actorPubkey);
  const facts = parseContributionCredentialClaimSigningMessage(input.signedMessage);
  if (facts.claimantPubkey !== claimantPubkey || facts.knowledgePublicId !== input.knowledgeId) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_actor_or_knowledge_mismatch',
      403,
      'The signed claim does not belong to the authenticated actor and Knowledge record',
    );
  }
  const now = validDate(input.now ?? new Date(), 'contribution_claim_now_invalid');
  const issuedAt = validDate(new Date(facts.consentIssuedAt), 'contribution_claim_consent_time_invalid');
  const expiresAt = validDate(new Date(facts.consentExpiresAt), 'contribution_claim_consent_expiry_invalid');
  if (
    expiresAt.getTime() <= issuedAt.getTime()
    || expiresAt.getTime() - issuedAt.getTime() !== MAX_CONSENT_TTL_MS
    || now.getTime() < issuedAt.getTime()
    || now.getTime() >= expiresAt.getTime()
  ) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_consent_expired',
      409,
      'The contribution credential consent envelope is expired or invalid',
    );
  }
  verifySignature(claimantPubkey, input.signedMessage, input.signature);

  const source = await resolveCurrentClaimSource(input.prisma, input.knowledgeId, claimantPubkey);
  const expectedFacts: ContributionCredentialClaimFacts = {
    ...facts,
    schemaVersion: 1,
    action: 'contribution_credential_claim.request',
    chainId: LOCAL_CHAIN_ID,
    credentialKind: 'personal_receipt',
    knowledgeRowId: source.knowledge.id,
    knowledgePublicId: source.knowledge.knowledgeId,
    governanceHomeRef: String(source.knowledge.circleId),
    entitlementId: source.entitlement.id,
    assessmentId: source.assessment.id.toString(),
    proofPackageHash: source.knowledge.binding.proofPackageHash,
    contributorsRoot: source.knowledge.binding.contributorsRoot,
    claimantPubkey,
    payerMode: 'requester',
    payerRef: claimantPubkey,
    payerPolicyRef: null,
    payerPolicyDigest: null,
    consentVersion: CONSENT_VERSION,
    automaticEnqueue: false,
    permissionFactSource: false,
    issuanceStatus: 'unfunded/pending_settlement',
  };
  const expectedMessage = buildContributionCredentialClaimSigningMessage(expectedFacts);
  if (expectedMessage !== input.signedMessage) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_current_source_mismatch',
      409,
      'The signed claim no longer matches the current entitlement and assessment owners',
    );
  }

  const consentPayloadDigest = hashCanonicalGovernanceValue(CLAIM_ENVELOPE_DOMAIN, facts);
  const signature = normalizeSignature(input.signature);
  const claimDigest = hashCanonicalGovernanceValue(CLAIM_RECORD_DOMAIN, {
    consentPayloadDigest,
    signature,
  });
  const claimData = {
    id: `contribution-credential-claim:${claimDigest}`,
    claimDigest,
    idempotencyKey: facts.idempotencyKey,
    credentialKind: facts.credentialKind,
    entitlementId: facts.entitlementId,
    assessmentId: BigInt(facts.assessmentId),
    knowledgeRowId: facts.knowledgeRowId,
    knowledgePublicId: facts.knowledgePublicId,
    governanceHomeRef: facts.governanceHomeRef,
    proofPackageHash: facts.proofPackageHash,
    contributorsRoot: facts.contributorsRoot,
    claimantPubkey,
    payerMode: facts.payerMode,
    payerRef: facts.payerRef,
    payerPolicyRef: null,
    payerPolicyDigest: null,
    chainId: facts.chainId,
    consentVersion: facts.consentVersion,
    consentPayloadDigest,
    consentSignature: signature,
    consentIssuedAt: issuedAt,
    consentExpiresAt: expiresAt,
    visibility: facts.visibility,
    lifecyclePolicyJson: lifecyclePolicy(),
    status: 'pending_settlement',
    createdAt: now,
  };

  try {
    const claim = await input.prisma.$transaction(async (tx: any) => {
      const existing = await tx.contributionCredentialClaim.findUnique({
        where: { idempotencyKey: facts.idempotencyKey },
      });
      if (existing) {
        assertExistingClaim(existing, claimData);
        return existing;
      }
      return tx.contributionCredentialClaim.create({ data: claimData });
    });
    return { claim: serializeClaim(claim), enqueued: false, productionActionTaken: false };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await input.prisma.contributionCredentialClaim.findUnique({
      where: { idempotencyKey: facts.idempotencyKey },
    });
    assertExistingClaim(existing, claimData);
    return { claim: serializeClaim(existing), enqueued: false, productionActionTaken: false };
  }
}

export function buildContributionCredentialClaimSigningMessage(
  facts: ContributionCredentialClaimFacts,
): string {
  validateFacts(facts);
  return canonicalGovernanceJson(CLAIM_ENVELOPE_DOMAIN, facts);
}

export function parseContributionCredentialClaimSigningMessage(
  signedMessage: string,
): ContributionCredentialClaimFacts {
  const normalized = requiredText(signedMessage, 'contribution_claim_signed_message_required');
  let decoded: any;
  try {
    decoded = JSON.parse(normalized);
  } catch {
    throw new ContributionCredentialClaimError(
      'contribution_claim_signed_message_invalid',
      400,
      'The signed contribution credential message is invalid',
    );
  }
  if (decoded?.domain !== CLAIM_ENVELOPE_DOMAIN || decoded?.version !== 1 || !decoded?.payload) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_signed_message_invalid',
      400,
      'The signed contribution credential message is invalid',
    );
  }
  const facts = decoded.payload as ContributionCredentialClaimFacts;
  validateFacts(facts);
  if (buildContributionCredentialClaimSigningMessage(facts) !== normalized) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_signed_message_noncanonical',
      400,
      'The signed contribution credential message is not canonical',
    );
  }
  return facts;
}

async function resolveCurrentClaimSource(prisma: any, knowledgeId: string, claimantPubkey: string) {
  const knowledge = await prisma.knowledge.findUnique({
    where: { knowledgeId: requiredText(knowledgeId, 'contribution_claim_knowledge_required') },
    select: {
      id: true,
      knowledgeId: true,
      circleId: true,
      binding: {
        select: {
          proofPackageHash: true,
          contributorsRoot: true,
          contributorsCount: true,
        },
      },
      contributions: {
        where: { contributorPubkey: claimantPubkey },
        select: {
          contributionWeightBps: true,
          sourceDraftPostId: true,
          sourceAnchorId: true,
          contributorsRoot: true,
        },
      },
    },
  });
  if (!knowledge?.binding) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_knowledge_incomplete',
      409,
      'A bound Knowledge proof package is required before requesting a credential',
    );
  }
  const entitlement = await prisma.crystalEntitlement.findUnique({
    where: {
      knowledgeRowId_ownerPubkey: {
        knowledgeRowId: knowledge.id,
        ownerPubkey: claimantPubkey,
      },
    },
  });
  if (
    !entitlement
    || entitlement.status !== 'active'
    || entitlement.proofPackageHash !== knowledge.binding.proofPackageHash
    || entitlement.contributorsRoot !== knowledge.binding.contributorsRoot
  ) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_active_entitlement_required',
      409,
      'An active proof-bound contribution entitlement is required',
    );
  }
  const contribution = knowledge.contributions.find((row: any) => (
    Number(row.contributionWeightBps) > 0
    && Number.isInteger(Number(row.sourceDraftPostId))
    && Number(row.sourceDraftPostId) > 0
    && row.contributorsRoot === knowledge.binding.contributorsRoot
  ));
  if (!contribution) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_verified_contributor_required',
      409,
      'A verified positive-weight Knowledge contribution is required',
    );
  }
  const assessment = await prisma.contributionAssessment.findFirst({
    where: {
      draftPostId: Number(contribution.sourceDraftPostId),
      proofPackageHash: knowledge.binding.proofPackageHash,
      canonicalContributorsRoot: knowledge.binding.contributorsRoot,
      status: 'bound',
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
  if (!assessment) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_bound_assessment_required',
      409,
      'A current bound ContributionAssessment is required',
    );
  }
  let snapshots;
  try {
    snapshots = readContributionAssessmentArtifactSnapshots({
      signedArtifact: assessment.signedArtifact,
      inputHash: assessment.inputHash,
      outputHash: assessment.outputHash,
      canonicalAllocationHash: assessment.canonicalAllocationHash,
      signerKeyId: assessment.signerKeyId,
      signature: assessment.signature,
    });
  } catch {
    snapshots = null;
  }
  const canonicalContributor = snapshots?.canonicalAllocation.contributors.find((row) => (
    row.pubkey === claimantPubkey && Number(row.weightBps) > 0
  ));
  if (!snapshots || !canonicalContributor) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_verified_assessment_required',
      409,
      'The current signed contribution assessment could not verify the claimant',
    );
  }
  return { knowledge, entitlement, contribution, assessment };
}

function validateFacts(facts: ContributionCredentialClaimFacts): void {
  if (
    facts?.schemaVersion !== 1
    || !hasExactKeys(facts, CLAIM_FACT_KEYS)
    || facts.action !== 'contribution_credential_claim.request'
    || facts.chainId !== LOCAL_CHAIN_ID
    || facts.credentialKind !== 'personal_receipt'
    || !Number.isInteger(facts.knowledgeRowId)
    || facts.knowledgeRowId <= 0
    || !Number.isInteger(facts.entitlementId)
    || facts.entitlementId <= 0
    || !/^[1-9][0-9]*$/.test(String(facts.assessmentId || ''))
    || !/^[a-f0-9]{64}$/.test(String(facts.proofPackageHash || ''))
    || !/^[a-f0-9]{64}$/.test(String(facts.contributorsRoot || ''))
    || facts.claimantPubkey !== publicKey(facts.claimantPubkey)
    || facts.payerMode !== 'requester'
    || facts.payerRef !== facts.claimantPubkey
    || facts.payerPolicyRef !== null
    || facts.payerPolicyDigest !== null
    || !['private', 'circle', 'public'].includes(facts.visibility)
    || facts.consentVersion !== CONSENT_VERSION
    || facts.automaticEnqueue !== false
    || facts.permissionFactSource !== false
    || facts.issuanceStatus !== 'unfunded/pending_settlement'
  ) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_facts_invalid',
      400,
      'The contribution credential claim facts are invalid',
    );
  }
  const idempotencyKey = requiredText(facts.idempotencyKey, 'contribution_claim_idempotency_key_required');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(idempotencyKey)) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_idempotency_key_invalid',
      400,
      'The contribution credential idempotency key is invalid',
    );
  }
  boundedText(facts.knowledgePublicId, 64, 'contribution_claim_knowledge_required');
  boundedText(facts.governanceHomeRef, 128, 'contribution_claim_home_required');
  const issuedAt = validDate(new Date(facts.consentIssuedAt), 'contribution_claim_consent_time_invalid');
  const expiresAt = validDate(new Date(facts.consentExpiresAt), 'contribution_claim_consent_expiry_invalid');
  if (issuedAt.toISOString() !== facts.consentIssuedAt || expiresAt.toISOString() !== facts.consentExpiresAt) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_consent_time_noncanonical',
      400,
      'Contribution credential timestamps must use canonical ISO format',
    );
  }
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length && actual.every((key, index) => key === canonical[index]);
}

function lifecyclePolicy() {
  return {
    schemaVersion: 1,
    transferMode: 'non_transferable',
    revocable: true,
    burnable: true,
    permissionFactSource: false,
    identitySemantics: 'display_credential_not_permanent_identity',
    settlementState: 'unfunded/pending_settlement',
  };
}

function serializeClaim(claim: any) {
  return {
    id: claim.id,
    credentialKind: claim.credentialKind,
    knowledgePublicId: claim.knowledgePublicId,
    governanceHomeRef: claim.governanceHomeRef,
    claimantPubkey: claim.claimantPubkey,
    payerMode: claim.payerMode,
    payerRef: claim.payerRef,
    chainId: claim.chainId,
    visibility: claim.visibility,
    status: claim.status,
    lifecyclePolicy: claim.lifecyclePolicyJson,
    createdAt: validDate(claim.createdAt, 'contribution_claim_created_at_invalid').toISOString(),
    updatedAt: validDate(claim.updatedAt ?? claim.createdAt, 'contribution_claim_updated_at_invalid').toISOString(),
  };
}

function assertExistingClaim(existing: any, expected: any): void {
  if (!existing) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_idempotency_conflict',
      409,
      'The contribution credential claim idempotency key is already in use',
    );
  }
  const fields = [
    'claimDigest', 'idempotencyKey', 'credentialKind', 'entitlementId', 'assessmentId',
    'knowledgeRowId', 'knowledgePublicId', 'governanceHomeRef', 'proofPackageHash',
    'contributorsRoot', 'claimantPubkey', 'payerMode', 'payerRef', 'payerPolicyRef',
    'payerPolicyDigest', 'chainId', 'consentVersion', 'consentPayloadDigest',
    'consentSignature', 'visibility', 'lifecyclePolicyJson', 'status',
  ];
  const left = Object.fromEntries(fields.map((field) => [field, normalizeComparable(existing[field])]));
  const right = Object.fromEntries(fields.map((field) => [field, normalizeComparable(expected[field])]));
  if (
    !isDeepStrictEqual(left, right)
    || validDate(existing.consentIssuedAt, 'contribution_claim_consent_time_invalid').getTime()
      !== validDate(expected.consentIssuedAt, 'contribution_claim_consent_time_invalid').getTime()
    || validDate(existing.consentExpiresAt, 'contribution_claim_consent_expiry_invalid').getTime()
      !== validDate(expected.consentExpiresAt, 'contribution_claim_consent_expiry_invalid').getTime()
  ) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_idempotency_conflict',
      409,
      'The contribution credential claim idempotency key is already in use',
    );
  }
}

function normalizeComparable(value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function verifySignature(pubkey: string, message: string, encodedSignature: string): void {
  const signature = Buffer.from(normalizeSignature(encodedSignature), 'base64');
  const publicKeyBytes = canonicalSolanaPublicKeyString(pubkey);
  if (!publicKeyBytes || signature.length !== nacl.sign.signatureLength) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_signature_invalid',
      401,
      'The contribution credential consent signature is invalid',
    );
  }
  const verified = nacl.sign.detached.verify(
    Buffer.from(message, 'utf8'),
    signature,
    new PublicKey(publicKeyBytes).toBytes(),
  );
  if (!verified) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_signature_invalid',
      401,
      'The contribution credential consent signature is invalid',
    );
  }
}

function normalizeSignature(value: unknown): string {
  const normalized = requiredText(value, 'contribution_claim_signature_required');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(normalized, 'base64');
  } catch {
    bytes = Buffer.alloc(0);
  }
  if (bytes.length !== nacl.sign.signatureLength || bytes.toString('base64') !== normalized) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_signature_invalid',
      401,
      'The contribution credential consent signature is invalid',
    );
  }
  return normalized;
}

function publicKey(value: unknown): string {
  const normalized = canonicalSolanaPublicKeyString(value);
  if (!normalized) {
    throw new ContributionCredentialClaimError(
      'contribution_claim_wallet_invalid',
      400,
      'A canonical Solana wallet public key is required',
    );
  }
  return normalized;
}

function validDate(value: unknown, code: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ContributionCredentialClaimError(code, 400, 'A valid contribution credential timestamp is required');
  }
  return parsed;
}

function requiredText(value: unknown, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new ContributionCredentialClaimError(code, 400, 'A required contribution credential field is missing');
  }
  return normalized;
}

function boundedText(value: unknown, maxLength: number, code: string): string {
  const normalized = requiredText(value, code);
  if (normalized.length > maxLength) {
    throw new ContributionCredentialClaimError(code, 400, 'A contribution credential field exceeds its maximum length');
  }
  return normalized;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  const normalized = requiredText(value, code);
  if (!allowed.includes(normalized as T)) {
    throw new ContributionCredentialClaimError(code, 400, 'The contribution credential option is invalid');
  }
  return normalized as T;
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as any).code === 'P2002');
}
