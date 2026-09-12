import { isDeepStrictEqual } from 'node:util';

import {
  createGovernanceLegacyCompatibilityBundle,
  type GovernanceLegacyCompatibilityBundle,
  type GovernanceLegacyCompatibilityBundleInput,
} from './governanceLegacyCompatibilityBundle';

export interface GovernanceLegacyCompatibilityBundleRecord {
  id: string;
  homeIdentityBindingId: string;
  circleId: number;
  version: number;
  schemaVersion: number;
  canonicalCodecVersion: number;
  network: string;
  sourceSlot: bigint;
  chainStateDigest: string;
  projectionStateDigest: string;
  bundle: GovernanceLegacyCompatibilityBundle;
  bundleDigest: string;
  createdAt: Date;
}

export interface GovernanceLegacyCompatibilityBundleStore {
  persistGovernanceLegacyCompatibilityBundle(input: {
    id: string;
    homeIdentityBindingId: string;
    circleId: number;
    version: number;
    bundle: GovernanceLegacyCompatibilityBundleInput;
    createdAt: Date;
  }): Promise<GovernanceLegacyCompatibilityBundleRecord>;
}

interface PersistenceClient {
  governanceHomeIdentityBinding: { findUnique(input: unknown): Promise<any> };
  governanceActivationState: { findUnique(input: unknown): Promise<any> };
  circle: { findUnique(input: unknown): Promise<any> };
  governanceCompatibilityBundle: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
  };
}

type PersistencePrisma = PersistenceClient & {
  $transaction<T>(operation: (tx: PersistenceClient) => Promise<T>): Promise<T>;
};

export function createPrismaGovernanceLegacyCompatibilityBundleStore(
  prisma: PersistencePrisma,
): GovernanceLegacyCompatibilityBundleStore {
  return {
    async persistGovernanceLegacyCompatibilityBundle(input) {
      requireCanonicalId(input.id);
      requireCanonicalId(input.homeIdentityBindingId);
      if (!Number.isSafeInteger(input.circleId) || input.circleId < 1 || input.circleId > 255) {
        throw new Error('invalid_governance_compatibility_circle_id');
      }
      if (!Number.isSafeInteger(input.version) || input.version < 1) {
        throw new Error('invalid_governance_compatibility_bundle_version');
      }
      const canonical = createGovernanceLegacyCompatibilityBundle(input.bundle);
      if (
        canonical.bundle.homeIdentity.ref !== input.homeIdentityBindingId
        || canonical.bundle.circleProjection.circleId !== input.circleId
        || canonical.bundle.chainReadback.circleId !== input.circleId
      ) {
        throw new Error('governance_compatibility_bundle_subject_mismatch');
      }
      const desired: GovernanceLegacyCompatibilityBundleRecord = {
        id: input.id,
        homeIdentityBindingId: input.homeIdentityBindingId,
        circleId: input.circleId,
        version: input.version,
        schemaVersion: canonical.bundle.schemaVersion,
        canonicalCodecVersion: canonical.bundle.canonicalCodecVersion,
        network: canonical.bundle.network,
        sourceSlot: BigInt(canonical.bundle.chainReadback.observedSlot),
        chainStateDigest: canonical.bundle.chainReadback.stateDigest,
        projectionStateDigest: canonical.bundle.circleProjection.stateDigest,
        bundle: canonical.bundle,
        bundleDigest: canonical.digest,
        createdAt: input.createdAt,
      };

      try {
        return await prisma.$transaction(async (tx) => {
          const identity = await tx.governanceHomeIdentityBinding.findUnique({
            where: { id: input.homeIdentityBindingId },
          });
          if (!identity) throw new Error('governance_compatibility_home_identity_missing');
          if (
            identity.identityVersion !== canonical.bundle.homeIdentity.version
            || identity.bindingDigest !== canonical.bundle.homeIdentity.digest
          ) {
            throw new Error('governance_compatibility_home_identity_mismatch');
          }

          const circle = await tx.circle.findUnique({ where: { id: input.circleId } });
          if (!circle) throw new Error('governance_compatibility_circle_missing');
          if (circle.onChainAddress !== canonical.bundle.circleProjection.onChainAddress) {
            throw new Error('governance_compatibility_circle_projection_mismatch');
          }

          const existing = await tx.governanceCompatibilityBundle.findUnique({
            where: { id: input.id },
          });
          if (existing) return exactExistingRecord(existing, desired);

          if (identity.status !== 'inactive') {
            throw new Error('governance_compatibility_requires_inactive_home');
          }

          const activation = await tx.governanceActivationState.findUnique({
            where: { homeIdentityBindingId: input.homeIdentityBindingId },
          });
          if (!activation || activation.state !== 'legacy_unmigrated') {
            throw new Error('governance_compatibility_requires_legacy_unmigrated');
          }
          return pickRecord(await tx.governanceCompatibilityBundle.create({ data: desired }));
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const raced = await prisma.governanceCompatibilityBundle.findUnique({
          where: { id: input.id },
        });
        if (!raced) throw error;
        return exactExistingRecord(raced, desired);
      }
    },
  };
}

function exactExistingRecord(
  existing: any,
  desired: GovernanceLegacyCompatibilityBundleRecord,
): GovernanceLegacyCompatibilityBundleRecord {
  const record = pickRecord(existing);
  if (!isDeepStrictEqual(record, deepFreeze(cloneRecord(desired)))) {
    throw new Error('governance_compatibility_bundle_immutable_mismatch');
  }
  return record;
}

function pickRecord(value: any): GovernanceLegacyCompatibilityBundleRecord {
  return deepFreeze({
    id: value.id,
    homeIdentityBindingId: value.homeIdentityBindingId,
    circleId: value.circleId,
    version: value.version,
    schemaVersion: value.schemaVersion,
    canonicalCodecVersion: value.canonicalCodecVersion,
    network: value.network,
    sourceSlot: BigInt(value.sourceSlot),
    chainStateDigest: value.chainStateDigest,
    projectionStateDigest: value.projectionStateDigest,
    bundle: JSON.parse(JSON.stringify(value.bundle)) as GovernanceLegacyCompatibilityBundle,
    bundleDigest: value.bundleDigest,
    createdAt: new Date(value.createdAt),
  });
}

function cloneRecord(
  value: GovernanceLegacyCompatibilityBundleRecord,
): GovernanceLegacyCompatibilityBundleRecord {
  return {
    ...value,
    bundle: JSON.parse(JSON.stringify(value.bundle)) as GovernanceLegacyCompatibilityBundle,
    createdAt: new Date(value.createdAt),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002'
  );
}

function requireCanonicalId(value: string): void {
  if (!value || value !== value.trim()) {
    throw new Error('governance_compatibility_bundle_required_fact_missing');
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
