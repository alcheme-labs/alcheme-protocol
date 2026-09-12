import type { GovernanceProviderIndexerObservation } from './governanceCaseInbox';

export function providerResourceBindingIdFromRequest(request: any): string | null {
  const receipts = Array.isArray(request?.receipts) ? request.receipts : [];
  const terminal = [...receipts].reverse().find((receipt: any) => {
    const evidence = receipt?.executionEvidence;
    return ['realms_provider_binding', 'squads_provider_binding'].includes(String(receipt?.executorModule))
      && receipt?.executionStatus === 'executed'
      && evidence
      && typeof evidence === 'object'
      && !Array.isArray(evidence)
      && [
        'realms_devnet_no_asset_vertical_finalized',
        'realms_devnet_delegation_conformance_finalized',
        'realms_voting_power_challenge_reopened',
        'squads_existing_no_asset_resource_adopted_finalized',
        'squads_devnet_grant_payout_finalized',
      ].includes(String(evidence.effect))
      && (
        typeof evidence.resourceBindingId === 'string'
        || typeof evidence.grantResourceBindingId === 'string'
      );
  });
  const payload = request?.payload && typeof request.payload === 'object'
    && !Array.isArray(request.payload)
    ? request.payload
    : null;
  const settlementAttempt = payload?.settlementAttempt
    && typeof payload.settlementAttempt === 'object'
    && !Array.isArray(payload.settlementAttempt)
    ? payload.settlementAttempt
    : null;
  const failedGrantResourceBindingId = request?.actionType === 'circle.grant.payout.execute'
    && typeof settlementAttempt?.resourceBindingId === 'string'
    ? settlementAttempt.resourceBindingId
    : null;
  const payloadResourceBinding = payload?.resourceBinding
    && typeof payload.resourceBinding === 'object'
    && !Array.isArray(payload.resourceBinding)
    ? payload.resourceBinding
    : null;
  return terminal?.executionEvidence?.resourceBindingId
    ?? terminal?.executionEvidence?.grantResourceBindingId
    ?? (typeof payloadResourceBinding?.id === 'string' ? payloadResourceBinding.id : null)
    ?? failedGrantResourceBindingId
    ?? null;
}

export async function loadGovernanceProviderIndexerObservations(
  prisma: any,
  programIdsInput: string[],
): Promise<Map<string, GovernanceProviderIndexerObservation>> {
  const programIds = [...new Set(programIdsInput.map((value) => value.trim()).filter(Boolean))];
  const observations = new Map<string, GovernanceProviderIndexerObservation>();
  if (programIds.length === 0) return observations;
  try {
    const [checkpoints, runtime, unresolvedFailures] = await Promise.all([
      prisma.syncCheckpoint.findMany({
        where: { programId: { in: programIds } },
        select: {
          programId: true,
          lastProcessedSlot: true,
          lastSuccessfulSync: true,
          syncErrorsCount: true,
        },
      }),
      prisma.indexerRuntimeState.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: {
          phase: true,
          currentSlot: true,
          lastProgressAt: true,
          lastError: true,
        },
      }),
      prisma.indexerFailedSlot.findMany({
        where: { programId: { in: programIds }, resolved: false },
        select: {
          programId: true,
          slot: true,
          lastFailedAt: true,
          lastError: true,
        },
        orderBy: [{ lastFailedAt: 'desc' }, { slot: 'desc' }],
      }),
    ]);
    const checkpointByProgramId = new Map(
      checkpoints.map((checkpoint: any) => [checkpoint.programId, checkpoint]),
    );
    const failureByProgramId = new Map<string, any>();
    unresolvedFailures.forEach((failure: any) => {
      if (!failureByProgramId.has(failure.programId)) {
        failureByProgramId.set(failure.programId, failure);
      }
    });
    programIds.forEach((programId) => {
      const checkpoint: any = checkpointByProgramId.get(programId) ?? null;
      const failure = failureByProgramId.get(programId) ?? null;
      observations.set(programId, {
        loadState: 'loaded',
        programId,
        checkpoint: checkpoint ? {
          lastProcessedSlot: Number(checkpoint.lastProcessedSlot),
          lastSuccessfulSync: checkpoint.lastSuccessfulSync,
          syncErrorsCount: checkpoint.syncErrorsCount,
        } : null,
        runtime: runtime ? {
          phase: runtime.phase,
          currentSlot: runtime.currentSlot === null ? null : Number(runtime.currentSlot),
          lastProgressAt: runtime.lastProgressAt,
          lastError: runtime.lastError,
        } : null,
        unresolvedFailure: failure ? {
          slot: Number(failure.slot),
          lastFailedAt: failure.lastFailedAt,
          lastError: failure.lastError,
        } : null,
      });
    });
  } catch {
    programIds.forEach((programId) => {
      observations.set(programId, {
        loadState: 'unavailable',
        programId,
        checkpoint: null,
        runtime: null,
        unresolvedFailure: null,
      });
    });
  }
  return observations;
}
