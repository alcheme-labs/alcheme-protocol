import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import profileDocument from './providerTrustProfiles/sas-solana-devnet-v1.json';
import { hashCanonicalGovernanceValue } from './canonicalCodec';

const publicKeySchema = z.string().superRefine((value, context) => {
  try {
    new PublicKey(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'invalid_solana_public_key' });
  }
});

const sasProviderTrustProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileRef: z.string().min(1),
  version: z.number().int().positive(),
  provider: z.literal('solana_attestation_service'),
  readinessState: z.literal('ready'),
  riskMaturity: z.literal('experimental'),
  capabilityRole: z.literal('attestation_transport'),
  chain: z.object({
    chainId: z.literal('solana:devnet'),
    cluster: z.literal('devnet'),
    genesisHash: publicKeySchema,
  }).strict(),
  deployment: z.object({
    programId: publicKeySchema,
    credentialAccountRef: z.string().min(1),
    schemaAccountRef: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    authorizedSignerRef: z.string().min(1),
    liveAttestationBinding: z.literal('unavailable'),
  }).strict(),
  clientDecoder: z.object({
    packageName: z.string().min(1),
    version: z.string().min(1),
  }).strict(),
  transportRole: z.literal('attestation_transport_not_sybil_detector'),
  authoritySeparation: z.object({
    sasIsNotSybilDetector: z.literal(true),
    contributionIsNotUniqueness: z.literal(true),
    eligibilityIsNotVotingPower: z.literal(true),
  }).strict(),
  environmentBoundary: z.object({
    activationScope: z.literal('sybil_evidence_policy_version'),
    inPlaceClusterSwitch: z.literal('forbidden'),
    mainnet: z.literal('unavailable'),
    civicPassLegacy: z.literal('deprecated_unavailable'),
  }).strict(),
}).strict();

export type SasProviderTrustProfile = z.infer<typeof sasProviderTrustProfileSchema>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const parsedProfile = deepFreeze(sasProviderTrustProfileSchema.parse(profileDocument));
const profileDigest = hashCanonicalGovernanceValue(
  'alcheme.governance.provider-trust-profile',
  parsedProfile,
);

export function getSasProviderTrustProfile(): Readonly<SasProviderTrustProfile> {
  return parsedProfile;
}

export function getSasProviderTrustProfileDigest(): string {
  return profileDigest;
}

export function resolveSasProviderTrustReadiness() {
  return {
    profileRef: parsedProfile.profileRef,
    profileVersion: parsedProfile.version,
    profileDigest,
    chainId: parsedProfile.chain.chainId,
    programId: parsedProfile.deployment.programId,
    readinessState: parsedProfile.readinessState,
    riskMaturity: parsedProfile.riskMaturity,
    capabilityRole: parsedProfile.capabilityRole,
    liveAttestationBinding: parsedProfile.deployment.liveAttestationBinding,
    transportRole: parsedProfile.transportRole,
    authoritySeparation: parsedProfile.authoritySeparation,
    civicPassLegacy: parsedProfile.environmentBoundary.civicPassLegacy,
    stageExecute: 'blocked' as const,
    activation: 'sybil_evidence_policy_contract_only' as const,
  };
}
