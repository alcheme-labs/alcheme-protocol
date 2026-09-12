export interface RealmsProviderFinalityTransition {
  state: 'submitted' | 'confirmed' | 'finalized';
  authority:
    | 'provider_signature_readback'
    | 'solana_rpc_signature_status'
    | 'solana_rpc_finalized_transaction';
  slot?: number;
}

export function validRealmsProviderFinalityTransitions(
  value: unknown,
  expectedFinalizedSlot?: number,
): value is RealmsProviderFinalityTransition[] {
  if (!Array.isArray(value)) return false;
  const expectedAuthority = {
    submitted: 'provider_signature_readback',
    confirmed: 'solana_rpc_signature_status',
    finalized: 'solana_rpc_finalized_transaction',
  } as const;
  const order = { submitted: 1, confirmed: 2, finalized: 3 } as const;
  let prior = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const transition = raw as Record<string, unknown>;
    const state = String(transition.state ?? '') as keyof typeof order;
    if (
      !Object.hasOwn(order, state)
      || expectedAuthority[state] !== transition.authority
      || order[state] <= prior
      || (state === 'finalized'
        ? !Number.isSafeInteger(transition.slot)
          || Number(transition.slot) <= 0
          || (expectedFinalizedSlot !== undefined && transition.slot !== expectedFinalizedSlot)
        : transition.slot !== undefined)
    ) return false;
    prior = order[state];
  }
  return true;
}
