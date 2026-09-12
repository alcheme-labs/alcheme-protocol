import { z } from 'zod';
import profileDocument from './providerTrustProfiles/kora-solana-devnet-v1.json';
import { hashCanonicalGovernanceValue } from './canonicalCodec';

const koraProviderTrustProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileRef: z.string().min(1),
  version: z.number().int().positive(),
  provider: z.literal('kora'),
  readinessState: z.literal('ready'),
  riskMaturity: z.literal('experimental'),
  capabilityRole: z.literal('fee_abstraction'),
  chain: z.object({
    chainId: z.literal('solana:devnet'),
    cluster: z.literal('devnet'),
    genesisHash: z.string().min(1),
  }).strict(),
  nodeContract: z.object({
    nodeRef: z.string().min(1),
    sdkPackageName: z.string().min(1),
    sdkVersion: z.string().min(1),
    npmShasum: z.string().min(1),
    operatorRef: z.string().min(1),
    liveOperatorBinding: z.literal('unavailable'),
    liveFeeTransaction: z.literal('forbidden_until_operator_approved'),
  }).strict(),
  authoritySeparation: z.object({
    koraIsNotDecisionAuthority: z.literal(true),
    koraIsNotExecutionAuthority: z.literal(true),
    feeSponsorSignerCannotMutateGovernedAction: z.literal(true),
    feePayerIsNotActionIssuerAssetOrProgramAuthority: z.literal(true),
  }).strict(),
  requiredPlanFields: z.array(z.string().min(1)).nonempty(),
  readback: z.object({
    commitment: z.literal('finalized'),
    timeoutMs: z.literal(12000),
    purpose: z.literal('fee_abstraction_plan_contract_and_cost_preflight_projection'),
  }).strict(),
  environmentBoundary: z.object({
    activationScope: z.literal('cost_preflight_quote_context'),
    inPlaceClusterSwitch: z.literal('forbidden'),
    mainnet: z.literal('unavailable'),
    nativeOffchainVote: z.literal('must_not_invoke'),
  }).strict(),
}).strict();

export type KoraProviderTrustProfile = z.infer<typeof koraProviderTrustProfileSchema>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const parsedProfile = deepFreeze(koraProviderTrustProfileSchema.parse(profileDocument));
const profileDigest = hashCanonicalGovernanceValue(
  'alcheme.governance.provider-trust-profile',
  parsedProfile,
);

export function getKoraProviderTrustProfile(): Readonly<KoraProviderTrustProfile> {
  return parsedProfile;
}

export function getKoraProviderTrustProfileDigest(): string {
  return profileDigest;
}

export function resolveKoraProviderTrustReadiness() {
  return {
    profileRef: parsedProfile.profileRef,
    profileVersion: parsedProfile.version,
    profileDigest,
    chainId: parsedProfile.chain.chainId,
    readinessState: parsedProfile.readinessState,
    riskMaturity: parsedProfile.riskMaturity,
    capabilityRole: parsedProfile.capabilityRole,
    liveOperatorBinding: parsedProfile.nodeContract.liveOperatorBinding,
    liveFeeTransaction: parsedProfile.nodeContract.liveFeeTransaction,
    sdkPackageRef: `${parsedProfile.nodeContract.sdkPackageName}@${parsedProfile.nodeContract.sdkVersion}`,
    authoritySeparation: parsedProfile.authoritySeparation,
    stageExecute: 'blocked' as const,
    activation: 'fee_abstraction_plan_contract_only' as const,
  };
}
