import { Prisma } from '@prisma/client';

import { digestJson } from './digest';
import { buildHostedAppGovernanceOperationRegistry } from './governanceOperations';
import { getGovernanceCaseActionRegistry } from '../governance/governanceCaseActionComposition';
import { GovernedActionGateway } from '../governance/governedActionGateway';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from '../governance/circleGovernanceBindings';
import { createPrismaGovernanceRequestStore } from '../governance/policyEngine';
import { governanceCaseIdForRequest } from '../governance/governanceCase';

export interface HostedAppGovernanceProposalInput {
  actionType: string;
  operationVersion: string;
  targetCircleId: number;
  payload: Record<string, unknown>;
  proposerPubkey: string;
  proposerRole: string;
  appId: string;
  releaseId: string;
  manifestHash: string;
  now: Date;
}

export interface HostedAppGovernanceProposalResult {
  requestId: string;
  caseId: string;
}

export type HostedAppGovernanceProposerRole = 'Owner' | 'Admin' | 'Moderator';

export async function resolveCurrentHostedAppGovernanceProposerRole(
  transactionClient: any,
  input: { targetCircleId: number; proposerUserId: number },
): Promise<HostedAppGovernanceProposerRole> {
  if (typeof transactionClient?.$queryRaw !== 'function') {
    throw new Error('hosted_app_governance_authority_lock_required');
  }
  const circleRows = await transactionClient.$queryRaw(Prisma.sql`
    SELECT id, creator_id AS "creatorId"
    FROM circles
    WHERE id = ${input.targetCircleId}
    FOR UPDATE
  `) as Array<{
    id: number;
    creatorId: number;
  }>;
  const [circle] = circleRows;
  if (!circle) throw new Error('hosted_app_governance_circle_not_found');
  if (circle.creatorId === input.proposerUserId) return 'Owner';

  const membershipRows = await transactionClient.$queryRaw(Prisma.sql`
    SELECT role::text AS role, status::text AS status
    FROM circle_members
    WHERE circle_id = ${input.targetCircleId}
      AND user_id = ${input.proposerUserId}
    FOR UPDATE
  `) as Array<{
    role: string;
    status: string;
  }>;
  const [membership] = membershipRows;
  if (
    membership?.status !== 'Active'
    || !['Owner', 'Admin', 'Moderator'].includes(String(membership.role ?? ''))
  ) {
    throw new Error('hosted_app_governance_proposer_role_required');
  }
  return membership.role as HostedAppGovernanceProposerRole;
}

export interface HostedAppGovernanceProposalDependencies {
  openGovernanceProposal(
    transactionClient: any,
    input: HostedAppGovernanceProposalInput,
  ): Promise<HostedAppGovernanceProposalResult>;
}

export function createHostedAppGovernanceProposalDependencies(): HostedAppGovernanceProposalDependencies {
  return { openGovernanceProposal };
}

export function resolveHostedAppGovernanceProposalTarget(input: {
  actionType: string;
  operationVersion: string;
  payload: Record<string, unknown>;
}): { targetType: string; targetRef: string } {
  const definition = getGovernanceCaseActionRegistry().get(input.actionType);
  if (!definition) {
    throw new Error('hosted_app_governed_action_not_registered');
  }
  const operation = buildHostedAppGovernanceOperationRegistry().find((candidate) =>
    candidate.operationId === input.actionType
    && candidate.operationVersion === input.operationVersion);
  const subjectRefField = operation?.subjectRefField?.trim() ?? '';
  const targetRef = subjectRefField
    ? String(input.payload[subjectRefField] ?? '').trim()
    : '';
  if (!subjectRefField || !targetRef) {
    throw new Error('hosted_app_governance_subject_ref_required');
  }
  return { targetType: definition.targetType, targetRef };
}

export async function openGovernanceProposal(
  transactionClient: any,
  input: HostedAppGovernanceProposalInput,
): Promise<HostedAppGovernanceProposalResult> {
  const registry = getGovernanceCaseActionRegistry();
  const target = resolveHostedAppGovernanceProposalTarget(input);

  const gateway = new GovernedActionGateway({
    registry,
    resolveBinding: (bindingInput) => resolveActiveCircleGovernanceBinding(
      transactionClient,
      bindingInput,
    ),
    listCommitteeEligibleActors: (eligibleInput) => listCommitteeEligibleActors(
      transactionClient,
      eligibleInput,
    ),
    requestStore: createPrismaGovernanceRequestStore(transactionClient),
    runtimePrisma: transactionClient,
    runtimeTransactionClient: true,
    now: () => input.now,
  });
  const request = await gateway.openDecisionStageRequest({
    actionType: input.actionType,
    targetCircleId: input.targetCircleId,
    targetType: target.targetType,
    targetRef: target.targetRef,
    payload: input.payload,
    idempotencyKey: `hosted-app-governance:${digestJson({
      appId: input.appId,
      releaseId: input.releaseId,
      manifestHash: input.manifestHash,
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
      operationVersion: input.operationVersion,
      targetType: target.targetType,
      targetRef: target.targetRef,
      payload: input.payload,
    })}`,
    proposerPubkey: input.proposerPubkey,
    proposerRole: input.proposerRole,
  });
  return {
    requestId: request.id,
    caseId: governanceCaseIdForRequest(request.id),
  };
}
