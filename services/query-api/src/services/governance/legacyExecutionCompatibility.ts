import type { GovernedActionDefinition } from './actionRegistry';

export interface GovernanceLegacyExecutionCompatibilityDescriptor {
  status: 'legacy';
  adapter: string;
  risk: GovernedActionDefinition['impact'];
  migrationTarget: 'stage_decision_only_execution_action';
}

export interface GovernanceLegacyAutoExecutionCutoverFacts {
  requestId: string;
  homeIdentityBindingId: string | null;
  compatibilityBundleVersion: string;
}

export type GovernanceLegacyAutoExecutionCutoverResolver = (
  input: GovernanceLegacyAutoExecutionCutoverFacts,
) => Promise<string | null>;

export function describeLegacyExecutionCompatibility(
  request: { executionMode?: string | null },
  definition: Pick<GovernedActionDefinition, 'executionAdapter' | 'impact'> | null,
): GovernanceLegacyExecutionCompatibilityDescriptor | null {
  if (request.executionMode !== 'legacy_action_checkpoint' || !definition) return null;
  return {
    status: 'legacy',
    adapter: definition.executionAdapter,
    risk: definition.impact,
    migrationTarget: 'stage_decision_only_execution_action',
  };
}

export async function resolveLegacyAutoExecutionCutoverError(
  prisma: Record<string, any>,
  request: {
    id: string;
    homeIdentityBindingId?: string | null;
    compatibilityBundleVersion?: string | null;
  },
): Promise<string | null> {
  const delegate = prisma.governanceCompatibilityBundle;
  if (!delegate?.findUnique) {
    return 'legacy_auto_execution_cutover_readback_unavailable';
  }
  const parsed = parseCompatibilityBundleVersion(request.compatibilityBundleVersion);
  if (!parsed || !request.homeIdentityBindingId) {
    return 'legacy_auto_execution_compatibility_mismatch';
  }
  const bundle = await delegate.findUnique({
    where: { id: parsed.id },
    include: { actionCutover: { select: { state: true } } },
  });
  if (
    !bundle
    || bundle.id !== parsed.id
    || bundle.version !== parsed.version
    || bundle.homeIdentityBindingId !== request.homeIdentityBindingId
  ) return 'legacy_auto_execution_compatibility_mismatch';
  if (!bundle.actionCutover) return null;
  if (bundle.actionCutover.state === 'cutover_active') {
    return 'legacy_auto_execution_cutover_active';
  }
  if (bundle.actionCutover.state === 'recovery_required') {
    return 'legacy_auto_execution_cutover_recovery_required';
  }
  // Rollback may restore routing for future work, but it must never make a
  // historical request pinned to this cutover bundle executable again.
  if (bundle.actionCutover.state === 'rolled_back') {
    return 'legacy_auto_execution_cutover_rolled_back_history_read_only';
  }
  return 'legacy_auto_execution_cutover_state_invalid';
}

function parseCompatibilityBundleVersion(
  value: string | null | undefined,
): { id: string; version: number } | null {
  if (!value) return null;
  const separator = value.lastIndexOf(':');
  if (separator <= 0) return null;
  const id = value.slice(0, separator);
  const versionText = value.slice(separator + 1);
  const version = Number(versionText);
  if (!id || !/^\d+$/.test(versionText) || !Number.isSafeInteger(version) || version <= 0) {
    return null;
  }
  return { id, version };
}
