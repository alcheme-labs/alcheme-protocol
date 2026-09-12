import { isDeepStrictEqual } from 'node:util';

const LEGACY_GOVERNANCE_ACTIVATION_STATES = new Set([
  'disabled',
  'preparing',
  'recovery',
  'suspended',
]);

export interface GovernanceHomeIdentityBindingWrite {
  id: string;
  homeType: string;
  homeRef: string;
  identityVersion: number;
  chainAccountRef: string | null;
  sourceType: string;
  sourceRef: string;
  sourceVersion: string | null;
  bindingDigest: string;
  status: string;
  effectiveFrom: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceActivationStateWrite {
  id: string;
  homeIdentityBindingId: string;
  state: 'legacy_unmigrated' | 'bootstrap_pending';
  bootstrapBundleVersion: string | null;
  bootstrapBundleDigest: string | null;
  policyBundleDigest: string | null;
  payerPolicyRef: string | null;
  assetAuthorityPolicyRef: string | null;
  bootstrapActorPubkey: string | null;
  bootstrapBypassStatus: string;
  bootstrapBypassExpiresAt: Date | null;
  activationRequestId: string | null;
  activationDecisionDigest: string | null;
  activationReceiptId: string | null;
  lastVerifiedAt: Date | null;
  activatedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceHomeFoundationStore {
  openInactiveHome(input: {
    identity: GovernanceHomeIdentityBindingWrite;
    activation: GovernanceActivationStateWrite;
  }): Promise<{
    identity: GovernanceHomeIdentityBindingWrite;
    activation: GovernanceActivationStateWrite;
  }>;
}

interface GovernanceHomePersistenceClient {
  governanceHomeIdentityBinding: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
  };
  governanceActivationState: {
    create(input: unknown): Promise<any>;
  };
}

type GovernanceHomePersistencePrisma = GovernanceHomePersistenceClient & {
  $transaction<T>(operation: (tx: GovernanceHomePersistenceClient) => Promise<T>): Promise<T>;
};

export interface ExternalGovernanceHomeIdentityReadback {
  homeIdentityBindingId: string;
  homeType: 'realm' | 'grant' | 'protocol' | 'external_institution';
  homeRef: string;
  network: string;
  canonicalOrganizationRef: string;
  controllingAuthorityRef: string;
  verificationDigest: string;
  observedAt: Date;
  expiresAt: Date;
}

interface ExternalGovernanceHomeIdentityPrisma {
  governanceHomeIdentityBinding: {
    findUnique(input: unknown): Promise<any>;
    findMany(input: unknown): Promise<any[]>;
  };
  governanceActivationState: {
    updateMany(input: unknown): Promise<{ count: number }>;
  };
}

export async function verifyExternalGovernanceHomeForWrite(
  prisma: ExternalGovernanceHomeIdentityPrisma,
  readback: ExternalGovernanceHomeIdentityReadback,
  now: Date,
): Promise<any> {
  assertExternalIdentityReadback(readback, now);
  const identity = await prisma.governanceHomeIdentityBinding.findUnique({
    where: { id: readback.homeIdentityBindingId },
    include: { activationState: true },
  });
  if (!identity) throw new Error('external_governance_home_identity_missing');

  const duplicates = await prisma.governanceHomeIdentityBinding.findMany({
    where: {
      id: { not: identity.id },
      externalNetwork: readback.network,
      canonicalOrganizationRef: readback.canonicalOrganizationRef,
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
    take: 1,
  });
  if (duplicates.length > 0) {
    await enterExternalIdentityRecovery(
      prisma, identity.id, 'external_governance_home_duplicate_organization_claim', now,
    );
  }
  if (identity.controllingAuthorityRef !== readback.controllingAuthorityRef) {
    await enterExternalIdentityRecovery(
      prisma, identity.id, 'external_governance_home_authority_drift', now,
    );
  }
  if (new Date(identity.verificationExpiresAt ?? 0).getTime() <= now.getTime()) {
    await enterExternalIdentityRecovery(
      prisma, identity.id, 'external_governance_home_verification_expired', now,
    );
  }
  const identityMismatch = identity.homeType !== readback.homeType
    || identity.homeRef !== readback.homeRef
    || identity.externalNetwork !== readback.network
    || identity.canonicalOrganizationRef !== readback.canonicalOrganizationRef
    || identity.verificationDigest !== readback.verificationDigest
    || new Date(identity.verifiedAt ?? 0).getTime() !== readback.observedAt.getTime()
    || new Date(identity.verificationExpiresAt ?? 0).getTime() !== readback.expiresAt.getTime();
  if (identityMismatch) {
    await enterExternalIdentityRecovery(
      prisma, identity.id, 'external_governance_home_identity_drift', now,
    );
  }
  if (identity.status !== 'active'
    || identity.supersededAt != null
    || new Date(identity.effectiveFrom ?? 0).getTime() > now.getTime()
    || identity.activationState?.state !== 'active') {
    await enterExternalIdentityRecovery(
      prisma, identity.id, 'external_governance_home_not_active', now,
    );
  }
  return identity;
}

function assertExternalIdentityReadback(
  readback: ExternalGovernanceHomeIdentityReadback,
  now: Date,
): void {
  for (const value of [
    readback.homeIdentityBindingId,
    readback.homeType,
    readback.homeRef,
    readback.network,
    readback.canonicalOrganizationRef,
    readback.controllingAuthorityRef,
  ]) {
    if (!value.trim() || value !== value.trim()) {
      throw new Error('external_governance_home_identity_readback_invalid');
    }
  }
  if (!/^[a-f0-9]{64}$/.test(readback.verificationDigest)
    || !Number.isFinite(readback.observedAt.getTime())
    || !Number.isFinite(readback.expiresAt.getTime())
    || readback.observedAt.getTime() > now.getTime()
    || readback.expiresAt.getTime() <= readback.observedAt.getTime()) {
    throw new Error('external_governance_home_identity_readback_invalid');
  }
}

async function enterExternalIdentityRecovery(
  prisma: ExternalGovernanceHomeIdentityPrisma,
  homeIdentityBindingId: string,
  failureCode: string,
  now: Date,
): Promise<never> {
  const changed = await prisma.governanceActivationState.updateMany({
    where: {
      homeIdentityBindingId,
      state: { not: 'recovery_required' },
    },
    data: {
      state: 'recovery_required',
      lastVerifiedAt: now,
      failureCode,
      updatedAt: now,
    },
  });
  if (changed.count !== 1) {
    throw new Error('external_governance_home_recovery_transition_failed');
  }
  throw new Error(failureCode);
}

export function createPrismaGovernanceHomeFoundationStore(
  prisma: GovernanceHomePersistencePrisma,
  options: { transactionClient?: boolean } = {},
): GovernanceHomeFoundationStore {
  return {
    async openInactiveHome(input) {
      assertFoundationPair(input.identity, input.activation);
      assertInactiveIdentity(input.identity);
      assertFoundationActivation(input.activation);
      const persist = async (client: GovernanceHomePersistenceClient) => {
        const existing = await readHomePair(client, input.identity.id);
        if (existing) {
          return exactExistingPair(existing, input);
        }
        const identity = await client.governanceHomeIdentityBinding.create({
          data: input.identity,
        });
        const activation = await client.governanceActivationState.create({
          data: input.activation,
        });
        return {
          identity: pickIdentity(identity),
          activation: pickActivation(activation),
        };
      };
      if (options.transactionClient) {
        return persist(prisma);
      }
      try {
        return await prisma.$transaction(persist);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const raced = await readHomePair(prisma, input.identity.id);
        if (!raced) throw error;
        return exactExistingPair(raced, input);
      }
    },
  };
}

function assertFoundationPair(
  identity: GovernanceHomeIdentityBindingWrite,
  activation: GovernanceActivationStateWrite,
): void {
  for (const value of [
    identity.id,
    identity.homeType,
    identity.homeRef,
    identity.sourceType,
    identity.sourceRef,
    identity.bindingDigest,
    activation.id,
    activation.homeIdentityBindingId,
    activation.bootstrapBypassStatus,
  ]) {
    if (!value.trim()) {
      throw new Error('governance_home_foundation_required_fact_missing');
    }
  }
  if (activation.homeIdentityBindingId !== identity.id) {
    throw new Error('governance_home_foundation_activation_link_mismatch');
  }
}

function readHomePair(
  client: GovernanceHomePersistenceClient,
  identityId: string,
): Promise<any> {
  return client.governanceHomeIdentityBinding.findUnique({
    where: { id: identityId },
    include: { activationState: true },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002'
  );
}

function exactExistingPair(
  existing: any,
  input: {
    identity: GovernanceHomeIdentityBindingWrite;
    activation: GovernanceActivationStateWrite;
  },
): {
  identity: GovernanceHomeIdentityBindingWrite;
  activation: GovernanceActivationStateWrite;
} {
  if (!existing.activationState) {
    throw new Error('governance_home_activation_state_missing');
  }
  if (LEGACY_GOVERNANCE_ACTIVATION_STATES.has(String(existing.activationState.state))) {
    throw new Error('governance_home_activation_legacy_state_requires_migration');
  }
  const pair = {
    identity: pickIdentity(existing),
    activation: pickActivation(existing.activationState),
  };
  if (
    !isDeepStrictEqual(pair.identity, input.identity)
    || !isDeepStrictEqual(pair.activation, input.activation)
  ) {
    throw new Error('governance_home_foundation_immutable_mismatch');
  }
  return pair;
}

function assertInactiveIdentity(identity: GovernanceHomeIdentityBindingWrite): void {
  if (identity.status !== 'inactive') {
    throw new Error('governance_home_foundation_requires_inactive_identity');
  }
  if (!/^[a-f0-9]{64}$/.test(identity.bindingDigest)) {
    throw new Error('invalid_governance_home_binding_digest');
  }
  if (!Number.isInteger(identity.identityVersion) || identity.identityVersion < 1) {
    throw new Error('invalid_governance_home_identity_version');
  }
  if (identity.effectiveFrom !== null || identity.supersededAt !== null) {
    throw new Error('governance_home_foundation_identity_lifecycle_not_empty');
  }
}

function assertFoundationActivation(activation: GovernanceActivationStateWrite): void {
  if (!['legacy_unmigrated', 'bootstrap_pending'].includes(activation.state)) {
    throw new Error('governance_home_foundation_requires_inactive_activation');
  }
  if (
    activation.bootstrapBypassStatus !== 'disabled'
    || [
      activation.bootstrapBundleVersion,
      activation.bootstrapBundleDigest,
      activation.policyBundleDigest,
      activation.payerPolicyRef,
      activation.assetAuthorityPolicyRef,
      activation.bootstrapActorPubkey,
      activation.bootstrapBypassExpiresAt,
      activation.activationRequestId,
      activation.activationDecisionDigest,
      activation.activationReceiptId,
      activation.lastVerifiedAt,
      activation.activatedAt,
      activation.failureCode,
    ].some((value) => value !== null)
  ) {
    throw new Error('governance_home_foundation_activation_provenance_not_empty');
  }
}

function pickIdentity(value: any): GovernanceHomeIdentityBindingWrite {
  return {
    id: value.id,
    homeType: value.homeType,
    homeRef: value.homeRef,
    identityVersion: value.identityVersion,
    chainAccountRef: value.chainAccountRef ?? null,
    sourceType: value.sourceType,
    sourceRef: value.sourceRef,
    sourceVersion: value.sourceVersion ?? null,
    bindingDigest: value.bindingDigest,
    status: value.status,
    effectiveFrom: value.effectiveFrom ?? null,
    supersededAt: value.supersededAt ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function pickActivation(value: any): GovernanceActivationStateWrite {
  return {
    id: value.id,
    homeIdentityBindingId: value.homeIdentityBindingId,
    state: value.state,
    bootstrapBundleVersion: value.bootstrapBundleVersion ?? null,
    bootstrapBundleDigest: value.bootstrapBundleDigest ?? null,
    policyBundleDigest: value.policyBundleDigest ?? null,
    payerPolicyRef: value.payerPolicyRef ?? null,
    assetAuthorityPolicyRef: value.assetAuthorityPolicyRef ?? null,
    bootstrapActorPubkey: value.bootstrapActorPubkey ?? null,
    bootstrapBypassStatus: value.bootstrapBypassStatus,
    bootstrapBypassExpiresAt: value.bootstrapBypassExpiresAt ?? null,
    activationRequestId: value.activationRequestId ?? null,
    activationDecisionDigest: value.activationDecisionDigest ?? null,
    activationReceiptId: value.activationReceiptId ?? null,
    lastVerifiedAt: value.lastVerifiedAt ?? null,
    activatedAt: value.activatedAt ?? null,
    failureCode: value.failureCode ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
