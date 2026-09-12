import type {
  GovernanceMandateEffectPolicy,
  GovernanceMandateTerms,
} from './circleGovernanceBindings';
import {
  transitionOperationEffectInTransaction,
  type OperationEffectState,
} from './operationEffectLifecycle';
import { releaseCommunicationMuteForTerminalEffectInTransaction } from './communicationMemberMuteLifecycle';

export type GovernanceMandateTerminationKind = 'natural_expiry' | 'revoke' | 'transfer';

export interface GovernanceMandateEffectTerminationResult {
  mandateId: string;
  terminationKind: GovernanceMandateTerminationKind;
  transitionedEffectIds: string[];
}

export function governanceMandateAuthoritySourceVersion(
  version: number,
  termsDigest: string,
): string {
  if (!Number.isInteger(version) || version <= 0 || !/^[a-f0-9]{64}$/.test(termsDigest)) {
    throw new Error('governance_mandate_authority_source_version_invalid');
  }
  return `v${version}:${termsDigest.slice(0, 48)}`;
}

export function resolveGovernanceMandateTerminationState(
  terms: GovernanceMandateTerms,
  terminationKind: GovernanceMandateTerminationKind,
): OperationEffectState | null {
  const operational = terms.purposeBindings.some(
    (binding) => binding.purpose === 'operational_execution',
  );
  if (!operational) {
    if (terms.effectPolicy !== null) {
      throw new Error('governance_mandate_effect_policy_unconsumed');
    }
    return null;
  }
  const policy = terms.effectPolicy as GovernanceMandateEffectPolicy | null;
  if (
    !policy
    || policy.naturalExpiry !== 'expire_at_mandate_end'
    || policy.revoke !== 'revoke_immediately'
    || policy.transfer !== 'supersede_immediately'
    || policy.appealSurvival !== 'survives_until_resolved'
    || policy.fallbackAuthority.type !== terms.delegatorGovernanceHome.type
    || policy.fallbackAuthority.ref !== terms.delegatorGovernanceHome.ref
  ) {
    throw new Error('governance_mandate_effect_policy_unconsumed');
  }
  if (terminationKind === 'natural_expiry' && policy.naturalExpiry === 'expire_at_mandate_end') {
    return 'expired';
  }
  if (terminationKind === 'revoke' && policy.revoke === 'revoke_immediately') {
    return 'revoked';
  }
  if (terminationKind === 'transfer' && policy.transfer === 'supersede_immediately') {
    return 'superseded';
  }
  throw new Error('governance_mandate_effect_policy_unconsumed');
}

export async function terminateGovernanceMandateEffectsInTransaction(
  tx: any,
  input: {
    mandateId: string;
    mandateSourceVersion?: string | null;
    terms: GovernanceMandateTerms;
    terminationKind: GovernanceMandateTerminationKind;
    actorPubkey: string | null;
    occurredAt: Date;
  },
): Promise<GovernanceMandateEffectTerminationResult> {
  const requestedState = resolveGovernanceMandateTerminationState(
    input.terms,
    input.terminationKind,
  );
  const effects = tx.operationEffect?.findMany
    ? await tx.operationEffect.findMany({
        where: {
          state: { in: ['active', 'ratification_required', 'rollback_failed'] },
          invocation: {
            authoritySnapshot: {
              is: {
                authoritySourceRef: input.mandateId,
                ...(input.mandateSourceVersion
                  ? { authoritySourceVersion: input.mandateSourceVersion }
                  : {}),
              },
            },
          },
        },
        select: {
          id: true,
          state: true,
          invocation: { select: { contractVersion: { select: { actionType: true } } } },
        },
        orderBy: { id: 'asc' },
      })
    : [];
  if (!tx.operationEffect?.findMany && requestedState !== null) {
    throw new Error('governance_mandate_effect_writer_required');
  }
  if (requestedState === null && effects.length > 0) {
    throw new Error('governance_mandate_effect_policy_missing');
  }
  const transitionedEffectIds: string[] = [];
  for (const effect of effects) {
    const nextState = effect.state === 'rollback_failed' && requestedState === 'expired'
      ? 'revoked'
      : requestedState;
    if (!nextState) continue;
    await transitionOperationEffectInTransaction(tx, {
      effectId: effect.id,
      nextState,
      reasonCode: `governance_mandate_${input.terminationKind}`,
      actorPubkey: input.actorPubkey,
      sourceReceiptId: null,
      occurredAt: input.occurredAt,
    });
    if (effect.invocation?.contractVersion?.actionType === 'communication.member.mute') {
      await releaseCommunicationMuteForTerminalEffectInTransaction(tx, {
        effectId: effect.id,
      });
    }
    transitionedEffectIds.push(effect.id);
  }
  if (!tx.actionAuthorityPolicyBinding?.updateMany) {
    throw new Error('governance_mandate_authority_writer_required');
  }
  await tx.actionAuthorityPolicyBinding.updateMany({
    where: {
      sourceRef: input.mandateId,
      ...(input.mandateSourceVersion
        ? { sourceVersion: input.mandateSourceVersion }
        : {}),
      status: 'active',
    },
    data: { status: 'superseded', supersededAt: input.occurredAt },
  });
  return {
    mandateId: input.mandateId,
    terminationKind: input.terminationKind,
    transitionedEffectIds,
  };
}

export async function reconcileExpiredGovernanceMandates(
  prisma: any,
  input: { now?: Date; limit?: number } = {},
): Promise<{
  scannedMandateIds: string[];
  expired: GovernanceMandateEffectTerminationResult[];
  skippedMandateIds: string[];
  failures: Array<{ mandateId: string; error: string }>;
}> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const candidates: any[] = [];
  let cursor: string | null = null;
  while (candidates.length < limit) {
    const page: any[] = await prisma.governanceMandate.findMany({
      where: {
        status: 'active',
        targetAuthorizationStatus: 'accepted',
        committeeAcceptanceStatus: 'accepted',
        versions: { some: { effectiveUntil: { lte: now } } },
      },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        binding: true,
      },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const mandate of page) {
      const current = mandate.versions?.[0];
      const effectiveUntil = new Date(current?.effectiveUntil ?? 'invalid');
      if (
        mandate.currentVersion === current?.version
        && mandate.currentTermsDigest === current?.termsDigest
        && !Number.isNaN(effectiveUntil.getTime())
        && effectiveUntil <= now
      ) {
        candidates.push(mandate);
        if (candidates.length === limit) break;
      }
    }
    if (page.length < 500 || candidates.length === limit) break;
    cursor = page.at(-1)?.id ?? null;
    if (!cursor) break;
  }
  const result = {
    scannedMandateIds: candidates.map((candidate: any) => candidate.id),
    expired: [] as GovernanceMandateEffectTerminationResult[],
    skippedMandateIds: [] as string[],
    failures: [] as Array<{ mandateId: string; error: string }>,
  };
  for (const candidate of candidates) {
    try {
      const termination = await prisma.$transaction(async (tx: any) => {
        const mandate = await tx.governanceMandate.findUnique({
          where: { id: candidate.id },
          include: {
            versions: { orderBy: { version: 'desc' }, take: 1 },
            binding: true,
          },
        });
        const version = mandate?.versions?.[0];
        const effectiveUntil = new Date(version?.effectiveUntil ?? 'invalid');
        if (
          !mandate
          || mandate.status !== 'active'
          || mandate.currentVersion !== version?.version
          || mandate.currentTermsDigest !== version?.termsDigest
          || Number.isNaN(effectiveUntil.getTime())
          || effectiveUntil > now
        ) {
          throw new Error('governance_mandate_expiry_not_due');
        }
        const terminated = await terminateGovernanceMandateEffectsInTransaction(tx, {
          mandateId: mandate.id,
          mandateSourceVersion: governanceMandateAuthoritySourceVersion(
            version.version,
            version.termsDigest,
          ),
          terms: version.terms,
          terminationKind: 'natural_expiry',
          actorPubkey: null,
          occurredAt: now,
        });
        const mandateUpdated = await tx.governanceMandate.updateMany({
          where: {
            id: mandate.id,
            status: 'active',
            currentVersion: version.version,
            currentTermsDigest: version.termsDigest,
          },
          data: { status: 'expired', expiredAt: now },
        });
        if (mandateUpdated.count !== 1) {
          throw new Error('governance_mandate_expiry_stale_write');
        }
        if (mandate.binding) {
          const bindingUpdated = await tx.circleGovernanceBinding.updateMany({
            where: { id: mandate.binding.id, mandateId: mandate.id, status: 'active' },
            data: {
              status: 'deactivated',
              supersededAt: now,
              authorityRetiredAt: now,
            },
          });
          if (bindingUpdated.count !== 1) {
            throw new Error('governance_mandate_expiry_binding_stale_write');
          }
        }
        return terminated;
      });
      result.expired.push(termination);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'governance_mandate_expiry_failed';
      if (message === 'governance_mandate_expiry_not_due') {
        result.skippedMandateIds.push(candidate.id);
      } else {
        result.failures.push({ mandateId: candidate.id, error: message });
      }
    }
  }
  return result;
}
