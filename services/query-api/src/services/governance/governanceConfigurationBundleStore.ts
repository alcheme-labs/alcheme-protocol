import { isDeepStrictEqual } from 'node:util';

import {
  createGovernanceBootstrapBundle,
  type GovernanceBootstrapBundle,
  type GovernanceBootstrapBundleInput,
} from './governanceBootstrapContract';

export interface GovernanceConfigurationBundleRecord {
  id: string;
  homeIdentityBindingId: string;
  version: number;
  schemaVersion: number;
  canonicalCodecVersion: number;
  bundle: GovernanceBootstrapBundle;
  bundleDigest: string;
  createdAt: Date;
}

export interface GovernanceConfigurationBundleStore {
  persistGovernanceConfigurationBundle(input: {
    id: string;
    homeIdentityBindingId: string;
    version: number;
    bundle: GovernanceBootstrapBundleInput;
    createdAt: Date;
  }): Promise<GovernanceConfigurationBundleRecord>;
}

interface GovernanceConfigurationBundlePersistenceClient {
  governanceHomeIdentityBinding: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceConfigurationBundle: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
  };
}

type GovernanceConfigurationBundlePersistencePrisma =
  GovernanceConfigurationBundlePersistenceClient & {
    $transaction<T>(
      operation: (tx: GovernanceConfigurationBundlePersistenceClient) => Promise<T>,
    ): Promise<T>;
  };

export function createPrismaGovernanceConfigurationBundleStore(
  prisma: GovernanceConfigurationBundlePersistencePrisma,
): GovernanceConfigurationBundleStore {
  return {
    async persistGovernanceConfigurationBundle(input) {
      if (
        !input.id.trim()
        || input.id !== input.id.trim()
        || !input.homeIdentityBindingId.trim()
        || input.homeIdentityBindingId !== input.homeIdentityBindingId.trim()
      ) {
        throw new Error('governance_configuration_bundle_required_fact_missing');
      }
      if (!Number.isSafeInteger(input.version) || input.version < 1) {
        throw new Error('invalid_governance_configuration_bundle_version');
      }
      const canonical = createGovernanceBootstrapBundle(input.bundle);
      if (input.homeIdentityBindingId !== canonical.bundle.homeIdentity.ref) {
        throw new Error('governance_configuration_bundle_home_identity_mismatch');
      }
      const desired: GovernanceConfigurationBundleRecord = {
        id: input.id,
        homeIdentityBindingId: input.homeIdentityBindingId,
        version: input.version,
        schemaVersion: canonical.bundle.schemaVersion,
        canonicalCodecVersion: canonical.bundle.canonicalCodecVersion,
        bundle: canonical.bundle,
        bundleDigest: canonical.digest,
        createdAt: input.createdAt,
      };
      try {
        return await prisma.$transaction(async (tx) => {
          const identity = await tx.governanceHomeIdentityBinding.findUnique({
            where: { id: input.homeIdentityBindingId },
          });
          if (!identity) {
            throw new Error('governance_configuration_bundle_home_identity_missing');
          }
          if (
            identity.bindingDigest !== canonical.bundle.homeIdentity.digest
            || identity.identityVersion !== canonical.bundle.homeIdentity.version
          ) {
            throw new Error('governance_configuration_bundle_home_identity_mismatch');
          }
          const existing = await tx.governanceConfigurationBundle.findUnique({
            where: { id: input.id },
          });
          if (existing) {
            return exactExistingRecord(existing, desired);
          }
          if (identity.status !== 'inactive') {
            throw new Error('governance_configuration_bundle_requires_inactive_home');
          }
          const record = await tx.governanceConfigurationBundle.create({
            data: desired,
          });
          return pickRecord(record);
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const raced = await prisma.governanceConfigurationBundle.findUnique({
          where: { id: input.id },
        });
        if (!raced) throw error;
        return exactExistingRecord(raced, desired);
      }
    },
  };
}

export async function persistGovernanceConfigurationTransitionTarget(
  prisma: GovernanceConfigurationBundlePersistenceClient,
  input: {
    id: string;
    homeIdentityBindingId: string;
    currentBundleId: string;
    currentBundleDigest: string;
    version: number;
    bundle: GovernanceBootstrapBundleInput;
    createdAt: Date;
  },
): Promise<GovernanceConfigurationBundleRecord> {
  if (
    !input.id.trim()
    || input.id !== input.id.trim()
    || !input.homeIdentityBindingId.trim()
    || input.homeIdentityBindingId !== input.homeIdentityBindingId.trim()
    || !input.currentBundleId.trim()
    || input.currentBundleId !== input.currentBundleId.trim()
    || !/^[a-f0-9]{64}$/.test(input.currentBundleDigest)
  ) {
    throw new Error('governance_configuration_transition_required_fact_missing');
  }
  const home = await prisma.governanceHomeIdentityBinding.findUnique({
    where: { id: input.homeIdentityBindingId },
    include: { activationState: true },
  });
  if (
    !home
    || home.status !== 'active'
    || home.activationState?.state !== 'active'
    || home.activationState.bootstrapConfigurationBundleId !== input.currentBundleId
    || home.activationState.bootstrapBundleDigest !== input.currentBundleDigest
  ) {
    throw new Error('governance_configuration_transition_active_bundle_mismatch');
  }
  const current = await prisma.governanceConfigurationBundle.findUnique({
    where: { id: input.currentBundleId },
  });
  if (
    !current
    || current.homeIdentityBindingId !== input.homeIdentityBindingId
    || current.bundleDigest !== input.currentBundleDigest
    || current.version + 1 !== input.version
  ) {
    throw new Error('governance_configuration_transition_active_bundle_mismatch');
  }
  const canonicalCurrent = createGovernanceBootstrapBundle(
    stripBundleMetadata(current.bundle as GovernanceBootstrapBundle),
  );
  if (canonicalCurrent.digest !== current.bundleDigest) {
    throw new Error('governance_configuration_transition_active_bundle_digest_mismatch');
  }
  const canonical = createGovernanceBootstrapBundle(input.bundle);
  if (canonical.bundle.homeIdentity.ref !== input.homeIdentityBindingId) {
    throw new Error('governance_configuration_bundle_home_identity_mismatch');
  }
  const desired: GovernanceConfigurationBundleRecord = {
    id: input.id,
    homeIdentityBindingId: input.homeIdentityBindingId,
    version: input.version,
    schemaVersion: canonical.bundle.schemaVersion,
    canonicalCodecVersion: canonical.bundle.canonicalCodecVersion,
    bundle: canonical.bundle,
    bundleDigest: canonical.digest,
    createdAt: input.createdAt,
  };
  const existingById = await prisma.governanceConfigurationBundle.findUnique({
    where: { id: input.id },
  });
  if (existingById) return exactExistingRecord(existingById, desired);
  const existingByVersion = await prisma.governanceConfigurationBundle.findUnique({
    where: {
      homeIdentityBindingId_version: {
        homeIdentityBindingId: input.homeIdentityBindingId,
        version: input.version,
      },
    },
  });
  if (existingByVersion) return exactExistingRecord(existingByVersion, desired);
  return pickRecord(await prisma.governanceConfigurationBundle.create({ data: desired }));
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002'
  );
}

function exactExistingRecord(
  existing: any,
  desired: GovernanceConfigurationBundleRecord,
): GovernanceConfigurationBundleRecord {
  const record = pickRecord(existing);
  if (!isDeepStrictEqual(record, desired)) {
    throw new Error('governance_configuration_bundle_immutable_mismatch');
  }
  return record;
}

function pickRecord(value: any): GovernanceConfigurationBundleRecord {
  return deepFreeze({
    id: value.id,
    homeIdentityBindingId: value.homeIdentityBindingId,
    version: value.version,
    schemaVersion: value.schemaVersion,
    canonicalCodecVersion: value.canonicalCodecVersion,
    bundle: JSON.parse(JSON.stringify(value.bundle)) as GovernanceBootstrapBundle,
    bundleDigest: value.bundleDigest,
    createdAt: new Date(value.createdAt),
  });
}

function stripBundleMetadata(bundle: GovernanceBootstrapBundle): GovernanceBootstrapBundleInput {
  const {
    schemaVersion: _schemaVersion,
    canonicalCodecVersion: _canonicalCodecVersion,
    ...input
  } = bundle;
  return input;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
