import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import profileDocument from './providerTrustProfiles/sns-solana-devnet-v1.json';
import { hashCanonicalGovernanceValue } from './canonicalCodec';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const publicKeySchema = z.string().superRefine((value, context) => {
  try {
    new PublicKey(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'invalid_solana_public_key' });
  }
});

const snsProviderTrustProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileRef: z.string().min(1),
  version: z.number().int().positive(),
  provider: z.literal('solana_name_service'),
  readinessState: z.literal('ready'),
  riskMaturity: z.literal('stable'),
  capabilityRole: z.literal('name_resolution_display_input'),
  chain: z.object({
    chainId: z.literal('solana:devnet'),
    cluster: z.literal('devnet'),
    genesisHash: publicKeySchema,
  }).strict(),
  deployment: z.object({
    programId: publicKeySchema,
    loaderProgramId: publicKeySchema,
    programDataAddress: publicKeySchema,
    upgradeAuthority: publicKeySchema,
    lastDeployedSlot: z.number().int().nonnegative(),
    deployedProgramBytesLength: z.number().int().positive(),
    deployedProgramBytesSha256: sha256Schema,
    observation: z.object({
      commitment: z.literal('finalized'),
      slot: z.number().int().positive(),
      observedAt: z.string().datetime(),
    }).strict(),
  }).strict(),
  clientDecoder: z.object({
    packageName: z.string().min(1),
    version: z.string().min(1),
    npmShasum: z.string().regex(/^[a-f0-9]{40}$/),
    npmIntegrity: z.string().startsWith('sha512-'),
    tarballSha256: sha256Schema,
    gitHead: z.string().regex(/^[a-f0-9]{40}$/),
    publishedManifestSha256: sha256Schema,
  }).strict(),
  resolutionPolicy: z.object({
    mode: z.literal('primary_domain_only'),
    tld: z.literal('.sol'),
    arbitraryDomainPick: z.literal('forbidden'),
    noPrimaryDisposition: z.literal('hide_sns_label'),
    displayCacheTtlSeconds: z.literal(300),
    highRiskFreshResolve: z.literal('required_before_transfer_invite_allowlist_authority_input'),
    staleRecordDisposition: z.literal('fail_closed_display_fallback'),
    tokenizedDomainDisposition: z.literal('require_current_owner_record_authority'),
    outageFallback: z.literal('alcheme_profile_or_generic_member'),
    unverifiedSolText: z.literal('forbidden'),
  }).strict(),
  authoritySeparation: z.object({
    snsDisplayIsNotEligibility: z.literal(true),
    snsDisplayIsNotAuthority: z.literal(true),
    snsDisplayIsNotActorIdentity: z.literal(true),
    canonicalActorKey: z.literal('solana_pubkey'),
    officialAlchemeCertification: z.literal(false),
  }).strict(),
  readback: z.object({
    rpc: z.object({
      endpoint: z.string().url().startsWith('https://'),
      access: z.literal('public_no_credentials'),
      purpose: z.literal('name_service_program_presence_and_display_resolve'),
    }).strict(),
    commitment: z.literal('finalized'),
    timeoutMs: z.literal(12000),
    maximumAttempts: z.literal(3),
    programPresenceRequired: z.literal(true),
    domainResolveClusterNote: z.string().min(1),
  }).strict(),
  privacyBoundary: z.object({
    defaultCircleSurfaces: z.literal('circle_alias_only'),
    autoExposePrimarySol: z.literal(false),
    optInDisclosureRequired: z.literal(true),
    crossCircleWalletLinkageRisk: z.literal('disclosed_before_enable'),
  }).strict(),
  environmentBoundary: z.object({
    activationScope: z.literal('display_input_profile_version'),
    inPlaceClusterSwitch: z.literal('forbidden'),
    mainnet: z.literal('unavailable'),
    registrationRenewalPrimaryUpdate: z.literal('external_optional_action'),
  }).strict(),
}).strict();

export type SnsProviderTrustProfile = z.infer<typeof snsProviderTrustProfileSchema>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const parsedProfile = deepFreeze(snsProviderTrustProfileSchema.parse(profileDocument));
const profileDigest = hashCanonicalGovernanceValue(
  'alcheme.governance.provider-trust-profile',
  parsedProfile,
);

export function getSnsProviderTrustProfile(): Readonly<SnsProviderTrustProfile> {
  return parsedProfile;
}

export function getSnsProviderTrustProfileDigest(): string {
  return profileDigest;
}

export function resolveSnsProviderTrustReadiness() {
  return {
    profileRef: parsedProfile.profileRef,
    profileVersion: parsedProfile.version,
    profileDigest,
    chainId: parsedProfile.chain.chainId,
    programId: parsedProfile.deployment.programId,
    readinessState: parsedProfile.readinessState,
    riskMaturity: parsedProfile.riskMaturity,
    capabilityRole: parsedProfile.capabilityRole,
    deploymentVerification: 'snapshot_verified_read_only' as const,
    observedAtSlot: parsedProfile.deployment.observation.slot,
    sdkPackageRef: `${parsedProfile.clientDecoder.packageName}@${parsedProfile.clientDecoder.version}`,
    sdkDigest: parsedProfile.clientDecoder.tarballSha256,
    resolutionMode: parsedProfile.resolutionPolicy.mode,
    authoritySeparation: parsedProfile.authoritySeparation,
    privacyBoundary: parsedProfile.privacyBoundary,
    activation: 'display_input_only' as const,
    stageExecute: 'blocked' as const,
  };
}
