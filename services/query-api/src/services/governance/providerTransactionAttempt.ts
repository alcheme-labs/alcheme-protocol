import { hashCanonicalGovernanceValue } from './canonicalCodec';

export interface ProviderTransactionAttemptInventory {
  schemaVersion: 1;
  authority: 'canonical_provider_checkpoint_and_payer_policy';
  providerModule: 'realms_provider_binding' | 'squads_provider_binding';
  actionIntentDigest: string;
  payerPolicyId: string;
  attempts: Array<{
    ordinal: number;
    stepId: string;
    messageDigest: string;
    manifestDigest: string;
    recentBlockhash: string;
    lastValidBlockHeight: number | null;
    quoteSlot: number | null;
    quotedAt: string | null;
    resimulationTrigger: 'blockhash_or_quote_expiry_before_any_resign';
    quotedFeeLamports: number;
    feePayerRole: 'separated_fee_payer_policy';
    priorityFeeLamports: 0;
    priorityFeeProof: 'current_pinned_provider_constructor_has_no_compute_budget_instruction';
    providerReference: string;
    status: 'signed' | 'submitted' | 'confirmed' | 'finalized' | 'expired';
    attemptDigest: string;
  }>;
  latestAttemptDigest: string | null;
  inventoryDigest: string;
}

export function buildProviderTransactionAttemptInventory(input: {
  providerModule: ProviderTransactionAttemptInventory['providerModule'];
  actionIntentDigest: string;
  payerPolicyId: string;
  attempts: Array<{
    stepId: string;
    messageDigest: string;
    manifestDigest: string;
    recentBlockhash: string;
    lastValidBlockHeight?: number | null;
    quoteSlot?: number | null;
    quotedAt?: string | null;
    feeLamports: number;
    signature?: string | null;
    status: string;
  }>;
}): ProviderTransactionAttemptInventory {
  if (
    !/^[a-f0-9]{64}$/.test(input.actionIntentDigest)
    || !input.payerPolicyId.trim()
  ) throw new Error('provider_transaction_attempt_inventory_owner_invalid');
  const attempts: ProviderTransactionAttemptInventory['attempts'] = [];
  for (const attempt of input.attempts) {
    const providerReference = attempt.signature?.trim() ?? '';
    if (!providerReference) continue;
    const status: ProviderTransactionAttemptInventory['attempts'][number]['status'] | null = attempt.status === 'expired'
      ? 'expired'
      : ['signed', 'submitted', 'confirmed', 'finalized'].includes(attempt.status)
        ? attempt.status as 'signed' | 'submitted' | 'confirmed' | 'finalized'
        : null;
    const lastValidBlockHeight = attempt.lastValidBlockHeight == null
      ? null
      : Number(attempt.lastValidBlockHeight);
    const quoteSlot = attempt.quoteSlot == null ? null : Number(attempt.quoteSlot);
    const quotedAt = attempt.quotedAt?.trim() || null;
    if (
      !status
      || !attempt.stepId.trim()
      || !/^[a-f0-9]{64}$/.test(attempt.messageDigest)
      || !/^[a-f0-9]{64}$/.test(attempt.manifestDigest)
      || !attempt.recentBlockhash.trim()
      || (lastValidBlockHeight !== null
        && (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0))
      || (quoteSlot !== null && (!Number.isSafeInteger(quoteSlot) || quoteSlot <= 0))
      || ((quoteSlot === null) !== (quotedAt === null))
      || (quotedAt !== null && !Number.isFinite(Date.parse(quotedAt)))
      || !Number.isSafeInteger(attempt.feeLamports)
      || attempt.feeLamports < 0
    ) throw new Error('provider_transaction_attempt_inventory_fact_invalid');
    const facts = {
      ordinal: attempts.length + 1,
      stepId: attempt.stepId,
      messageDigest: attempt.messageDigest,
      manifestDigest: attempt.manifestDigest,
      recentBlockhash: attempt.recentBlockhash,
      lastValidBlockHeight,
      quoteSlot,
      quotedAt,
      resimulationTrigger: 'blockhash_or_quote_expiry_before_any_resign' as const,
      quotedFeeLamports: attempt.feeLamports,
      feePayerRole: 'separated_fee_payer_policy' as const,
      priorityFeeLamports: 0 as const,
      priorityFeeProof: 'current_pinned_provider_constructor_has_no_compute_budget_instruction' as const,
      providerReference,
      status,
    };
    attempts.push({
      ...facts,
      attemptDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.provider-transaction-attempt-v1',
        {
          providerModule: input.providerModule,
          actionIntentDigest: input.actionIntentDigest,
          payerPolicyId: input.payerPolicyId,
          ...facts,
        },
      ),
    });
  }
  const inventoryFacts = {
    schemaVersion: 1 as const,
    authority: 'canonical_provider_checkpoint_and_payer_policy' as const,
    providerModule: input.providerModule,
    actionIntentDigest: input.actionIntentDigest,
    payerPolicyId: input.payerPolicyId,
    attempts,
    latestAttemptDigest: attempts.at(-1)?.attemptDigest ?? null,
  };
  return {
    ...inventoryFacts,
    inventoryDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-transaction-attempt-inventory-v1',
      inventoryFacts,
    ),
  };
}

export function verifyProviderTransactionAttemptInventory(
  value: unknown,
): ProviderTransactionAttemptInventory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const inventory = value as ProviderTransactionAttemptInventory;
  try {
    const rebuilt = buildProviderTransactionAttemptInventory({
      providerModule: inventory.providerModule,
      actionIntentDigest: inventory.actionIntentDigest,
      payerPolicyId: inventory.payerPolicyId,
      attempts: inventory.attempts.map((attempt) => ({
        stepId: attempt.stepId,
        messageDigest: attempt.messageDigest,
        manifestDigest: attempt.manifestDigest,
        recentBlockhash: attempt.recentBlockhash,
        lastValidBlockHeight: attempt.lastValidBlockHeight,
        quoteSlot: attempt.quoteSlot,
        quotedAt: attempt.quotedAt,
        feeLamports: attempt.quotedFeeLamports,
        signature: attempt.providerReference,
        status: attempt.status,
      })),
    });
    return JSON.stringify(rebuilt) === JSON.stringify(inventory) ? rebuilt : null;
  } catch {
    return null;
  }
}
