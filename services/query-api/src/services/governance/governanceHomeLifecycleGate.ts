const RECOVERY_ACTION_TYPE = 'circle.governance_binding.policy_version.update';

export async function assertGovernanceHomeAllowsNewIntake(
  prisma: any,
  input: {
    circleId: number;
    actionType: string | null;
    payload: Record<string, unknown> | null;
    authoritySourceType?: string | null;
  },
): Promise<void> {
  if (!prisma?.circle || typeof prisma.circle.findUnique !== 'function') {
    throw new Error('governance_home_lifecycle_owner_required');
  }
  const circle = await prisma.circle.findUnique({
    where: { id: input.circleId },
    select: { id: true, lifecycleStatus: true },
  });
  if (!circle) throw new Error('circle_not_found');
  if (circle.lifecycleStatus === 'Active') return;
  if (circle.lifecycleStatus === 'DissolutionPending') {
    if (isCanonicalRecoveryIntake(
      input.actionType,
      input.payload,
      input.authoritySourceType ?? null,
    )) return;
    if (isDissolutionDispositionAction(input.actionType)) return;
    throw new Error('governance_home_dissolution_pending_new_governance_intake_blocked');
  }
  if (circle.lifecycleStatus === 'ForkPending') {
    if (isTerminalRetainedAction(input.actionType)) return;
    throw new Error('governance_home_fork_pending_new_governance_intake_blocked');
  }
  if (circle.lifecycleStatus === 'MergePending') {
    if (isTerminalRetainedAction(input.actionType)) return;
    throw new Error('governance_home_merge_pending_new_governance_intake_blocked');
  }
  if (circle.lifecycleStatus === 'Merged') {
    if (isTerminalRetainedAction(input.actionType)) return;
    throw new Error('governance_home_merged_new_governance_intake_blocked');
  }
  if (circle.lifecycleStatus !== 'Archived') {
    throw new Error('governance_home_lifecycle_status_unsupported');
  }
  if (input.actionType === 'circle.lifecycle.restore') return;
  if (isTerminalRetainedAction(input.actionType)) return;
  if (isCanonicalRecoveryIntake(
    input.actionType,
    input.payload,
    input.authoritySourceType ?? null,
  )) return;
  throw new Error('governance_home_archived_new_governance_intake_blocked');
}

function isTerminalRetainedAction(actionType: string | null): boolean {
  return isDissolutionDispositionAction(actionType);
}

function isDissolutionDispositionAction(actionType: string | null): boolean {
  const normalized = String(actionType || '').trim().toLowerCase();
  return new Set([
    'governed_action.appeal.open',
    'external_app_appeal_resolution',
    'external_app_projection_reconcile',
    'source_material.revoke',
    'external_app_server_key_revoke',
    'external_app_provisioning_revoke',
    'external_app_attached_circle_revoke',
  ]).has(normalized);
}

function isCanonicalRecoveryIntake(
  actionType: string | null,
  payload: Record<string, unknown> | null,
  authoritySourceType: string | null,
): boolean {
  if (
    actionType !== RECOVERY_ACTION_TYPE
    || authoritySourceType !== 'governance_recovery_policy'
    || !payload
  ) return false;
  const ratification = record(payload.governanceRecoveryRatification);
  return ratification.currentContract === 'governance_recovery_policy'
    && ratification.reviewRequired === true
    && ratification.onRejectOrTimeout === 'high_critical_fail_closed';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
