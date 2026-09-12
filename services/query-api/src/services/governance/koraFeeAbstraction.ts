import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  getKoraProviderTrustProfile,
  getKoraProviderTrustProfileDigest,
  resolveKoraProviderTrustReadiness,
} from './koraProviderTrustProfile';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const feeAbstractionPlanSchema = z.object({
  schemaVersion: z.literal(1),
  profileRef: z.string().min(1),
  profileDigest: sha256Schema,
  economicBearer: z.string().min(1),
  nodeRef: z.string().min(1),
  nodeVersion: z.string().min(1),
  operatorRef: z.string().min(1),
  feePayerSignerRef: z.string().min(1),
  userTokenPayment: z.object({
    mint: z.string().min(1),
    amountAtomic: z.string().regex(/^[0-9]+$/),
    payerPubkey: z.string().min(1),
  }).strict(),
  solCostLamports: z.number().int().nonnegative(),
  rentLamports: z.number().int().nonnegative(),
  outflowLamports: z.number().int().nonnegative(),
  paymentInstructionDigest: sha256Schema,
  providerMarginLamports: z.number().int().nonnegative(),
  quoteExpiresAt: z.string().datetime(),
  transactionDigest: sha256Schema,
  quota: z.object({
    window: z.enum(['per_transaction', 'hourly', 'daily']),
    maxFeeLamports: z.number().int().positive(),
    remainingLamports: z.number().int().nonnegative(),
  }).strict(),
  receiptRef: z.string().min(1),
  authoritySeparation: z.object({
    koraIsNotDecisionAuthority: z.literal(true),
    koraIsNotExecutionAuthority: z.literal(true),
    feeSponsorSignerCannotMutateGovernedAction: z.literal(true),
    feePayerIsNotActionIssuerAssetOrProgramAuthority: z.literal(true),
  }).strict(),
  liveFeeTransactionAllowed: z.literal(false),
  selfProvesQuote: z.literal(false),
}).strict();

export type FeeAbstractionPlan = z.infer<typeof feeAbstractionPlanSchema>;

export type KoraQuoteReader = {
  readFeeAbstractionQuote(input: {
    economicBearer: string;
    feePayerSignerRef: string;
    actionIntentDigest: string;
  }): Promise<Omit<FeeAbstractionPlan,
    | 'schemaVersion'
    | 'profileRef'
    | 'profileDigest'
    | 'authoritySeparation'
    | 'liveFeeTransactionAllowed'
    | 'selfProvesQuote'
  >>;
};

let koraQuoteReader: KoraQuoteReader | null = null;

export function setKoraQuoteReader(reader: KoraQuoteReader | null): void {
  koraQuoteReader = reader;
}

export function getKoraQuoteReader(): KoraQuoteReader | null {
  return koraQuoteReader;
}

export function normalizeFeeAbstractionPlan(value: unknown): FeeAbstractionPlan {
  const profile = getKoraProviderTrustProfile();
  const parsed = feeAbstractionPlanSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('fee_abstraction_plan_invalid');
  }
  const plan = parsed.data;
  for (const field of profile.requiredPlanFields) {
    if ((plan as Record<string, unknown>)[field] == null) {
      throw new Error(`fee_abstraction_plan_missing_${field}`);
    }
  }
  if (
    plan.profileRef !== profile.profileRef
    || plan.profileDigest !== getKoraProviderTrustProfileDigest()
    || plan.liveFeeTransactionAllowed !== false
    || plan.selfProvesQuote !== false
    || !plan.authoritySeparation.koraIsNotDecisionAuthority
    || !plan.authoritySeparation.koraIsNotExecutionAuthority
    || !plan.authoritySeparation.feeSponsorSignerCannotMutateGovernedAction
    || !plan.authoritySeparation.feePayerIsNotActionIssuerAssetOrProgramAuthority
  ) {
    throw new Error('fee_abstraction_plan_authority_or_profile_invalid');
  }
  if (plan.outflowLamports > plan.quota.maxFeeLamports) {
    throw new Error('fee_abstraction_plan_outflow_exceeds_quota');
  }
  if (Date.parse(plan.quoteExpiresAt) <= Date.now()) {
    throw new Error('fee_abstraction_plan_quote_expired');
  }
  return plan;
}

export async function resolveFeeAbstractionPlan(input: {
  economicBearer: string;
  feePayerSignerRef: string;
  actionIntentDigest: string;
}): Promise<FeeAbstractionPlan> {
  const readiness = resolveKoraProviderTrustReadiness();
  if (readiness.liveFeeTransaction !== 'forbidden_until_operator_approved') {
    throw new Error('fee_abstraction_live_policy_invalid');
  }
  const reader = koraQuoteReader;
  if (!reader) {
    throw new Error('kora_quote_reader_unavailable');
  }
  if (!input.economicBearer.trim() || !input.feePayerSignerRef.trim()) {
    throw new Error('fee_abstraction_bearer_or_fee_payer_required');
  }
  if (!/^[a-f0-9]{64}$/.test(input.actionIntentDigest)) {
    throw new Error('fee_abstraction_action_intent_digest_invalid');
  }
  const quote = await reader.readFeeAbstractionQuote(input);
  return normalizeFeeAbstractionPlan({
    schemaVersion: 1,
    profileRef: readiness.profileRef,
    profileDigest: readiness.profileDigest,
    ...quote,
    authoritySeparation: readiness.authoritySeparation,
    liveFeeTransactionAllowed: false,
    selfProvesQuote: false,
  });
}

export function attachFeeAbstractionPlanToCostPreflightQuoteContext(input: {
  quoteContext: Record<string, unknown> | null | undefined;
  plan: FeeAbstractionPlan;
  payerPolicyId: string;
  economicBearer: string;
}): Record<string, unknown> {
  if (input.plan.economicBearer !== input.economicBearer) {
    throw new Error('fee_abstraction_economic_bearer_mismatch');
  }
  const base = input.quoteContext && typeof input.quoteContext === 'object'
    ? { ...input.quoteContext }
    : {};
  return {
    ...base,
    feeAbstractionPlan: input.plan,
    feeAbstractionPlanDigest: hashFeeAbstractionPlan(input.plan),
    payerPolicyId: input.payerPolicyId,
    economicBearer: input.economicBearer,
  };
}

export function projectFeeAbstractionPlanReadback(input: {
  quoteContext: unknown;
  payerPolicyId: string;
  economicBearer: string;
}): {
  state: 'ready' | 'blocked';
  plan: FeeAbstractionPlan;
  planDigest: string;
  liveFeeTransactionAllowed: false;
  authoritySeparation: FeeAbstractionPlan['authoritySeparation'];
} | null {
  const context = input.quoteContext && typeof input.quoteContext === 'object'
    ? input.quoteContext as Record<string, unknown>
    : null;
  if (!context?.feeAbstractionPlan) return null;
  try {
    const plan = normalizeFeeAbstractionPlan(context.feeAbstractionPlan);
    if (
      plan.economicBearer !== input.economicBearer
      || context.payerPolicyId !== input.payerPolicyId
    ) {
      return null;
    }
    return {
      state: 'ready',
      plan,
      planDigest: hashFeeAbstractionPlan(plan),
      liveFeeTransactionAllowed: false,
      authoritySeparation: plan.authoritySeparation,
    };
  } catch {
    return null;
  }
}

export function hashFeeAbstractionPlan(plan: FeeAbstractionPlan): string {
  return createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex');
}

export function assertKoraSignerHasNoGovernedAuthority(input: {
  feePayerSignerRef: string;
  actionAuthorityRef?: string | null;
  issuerAuthorityRef?: string | null;
  assetAuthorityRef?: string | null;
  programAuthorityRef?: string | null;
}): void {
  const fee = input.feePayerSignerRef.trim();
  for (const [label, value] of [
    ['action', input.actionAuthorityRef],
    ['issuer', input.issuerAuthorityRef],
    ['asset', input.assetAuthorityRef],
    ['program', input.programAuthorityRef],
  ] as const) {
    if (typeof value === 'string' && value.trim() && value.trim() === fee) {
      throw new Error(`kora_fee_payer_cannot_be_${label}_authority`);
    }
  }
}
