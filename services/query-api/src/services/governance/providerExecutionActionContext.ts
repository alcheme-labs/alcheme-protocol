import { hashCanonicalGovernanceValue } from './canonicalCodec';

export interface ProviderExecutionActionContext<StepId extends string = string> {
  schemaVersion: 1;
  authority: 'provider_plan_and_attempt_checkpoint';
  order: number;
  dependsOnStepIds: StepId[];
  atomicGroupId: string;
  atomicity: 'single_provider_transaction';
  expectedStateChange: string;
  idempotencyKey: string;
  deadline: {
    kind: 'last_valid_block_height';
    value: number;
  };
  aggregateRule: 'all_ordered_steps_finalized';
}

export function buildProviderExecutionActionContext<StepId extends string>(input: {
  actionIntentDigest: string;
  planDigest: string;
  steps: Array<{ id: StepId }>;
  step: { id: StepId; manifestDigest: string; lastValidBlockHeight: number };
  expectedStateChange: string;
}): ProviderExecutionActionContext<StepId> {
  const order = input.steps.findIndex((candidate) => candidate.id === input.step.id);
  if (order < 0 || !Number.isSafeInteger(input.step.lastValidBlockHeight)) {
    throw new Error('provider_execution_action_context_invalid');
  }
  const identity = {
    actionIntentDigest: input.actionIntentDigest,
    planDigest: input.planDigest,
    stepId: input.step.id,
    manifestDigest: input.step.manifestDigest,
  };
  return {
    schemaVersion: 1,
    authority: 'provider_plan_and_attempt_checkpoint',
    order: order + 1,
    dependsOnStepIds: order === 0 ? [] : [input.steps[order - 1]!.id],
    atomicGroupId: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-execution-atomic-group-v1',
      identity,
    ),
    atomicity: 'single_provider_transaction',
    expectedStateChange: input.expectedStateChange,
    idempotencyKey: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-execution-action-idempotency-v1',
      identity,
    ),
    deadline: {
      kind: 'last_valid_block_height',
      value: input.step.lastValidBlockHeight,
    },
    aggregateRule: 'all_ordered_steps_finalized',
  };
}
