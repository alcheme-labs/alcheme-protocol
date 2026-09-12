import type { PrismaClient } from '@prisma/client';

import { resolveActiveCircleGovernanceBinding } from './circleGovernanceBindings';
import {
  evaluateRegisteredGovernedActionRouting,
  projectGovernedDirectOperationReceipt,
} from './governedActionGateway';
import { createDefaultGovernanceExecutionRegistry } from './requestExecution';
import { LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE } from './actionRegistry';
import { communicationMemberMuteAppealPayload } from './communicationMemberMuteLifecycle';
import { communicationOperationRecurrenceReviewPayload } from './communicationOperationEscalation';
import {
  GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
  projectGovernedActionAppealRouting,
  type GovernedActionAppealRoutingReadback,
} from './governedActionAppeal';

export type GovernedActionRoutingPath =
  | 'direct_operation'
  | 'governance_review'
  | 'blocked';

export interface GovernedActionRoutingMatrixEntry {
  actionType: string;
  targetType: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  governanceMode: 'optional' | 'required_when_bound' | 'always_required';
  defaultPath: GovernedActionRoutingPath;
  currentPath: GovernedActionRoutingPath;
  reason: string;
  routingPolicy: {
    bindingId: string;
    actionType: string;
    subjectType: 'circle';
    subjectRef: string;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    effectiveAt: string;
  } | null;
}

export interface GovernedActionRoutingReadback {
  schemaVersion: 1;
  circleId: number;
  matrix: GovernedActionRoutingMatrixEntry[];
  recentDirectOperations: Array<{
    actionType: string;
    receipt: ReturnType<typeof projectGovernedDirectOperationReceipt>;
    effect: {
      state: string;
      stateVersion: number;
      effectDigest: string;
      activatedAt: string;
    };
  }>;
}

export interface GovernedActionOperationReadScope {
  role: 'governance_home_manager' | 'delegated_authority_participant';
  targetCircleId: number;
  committeeCircleId: number | null;
  domainBindingId: string | null;
  mandateId: string | null;
  mandateSourceVersion: string | null;
  policyId: string | null;
  policyVersionId: string | null;
  policyVersion: number | null;
}

export interface GovernedActionOperationInboxItem {
  id: string;
  circleId: number;
  actionType: string;
  occurredAt: string;
  subject: { type: string; ref: string };
  risk: 'low' | 'medium' | 'high' | 'critical';
  provider: {
    type: 'execution_adapter';
    ref: string;
    authoritativeFinality: 'not_asserted';
  };
  invocation: { id: string; state: string };
  effect: { id: string; state: string; stateVersion: number };
  group: 'awaiting_action' | 'active' | 'expiring' | 'appealed' | 'closed';
  lifecycle: { expiresAt: string | null };
  identities: Array<{
    role: 'operational_assignee' | 'respondent_appellant' | 'appeal_reviewer';
    status: 'available' | 'waiting' | 'blocked' | 'completed';
    deadline: string | null;
    disabledReason: string | null;
    canonicalUrl: string;
  }>;
  authority: {
    role: GovernedActionOperationReadScope['role'] | null;
    identities: Array<{
      role: GovernedActionOperationReadScope['role'];
      targetCircleId: number;
      domainBindingId: string | null;
      mandateId: string | null;
      committeeCircleId: number | null;
    }>;
    sourceType: string;
    sourceRef: string;
    sourceVersion: string | null;
    domainBindingId: string | null;
    mandateId: string | null;
    committeeCircleId: number | null;
  };
  task: {
    kind: 'ratification' | 'appeal' | 'escalation' | 'reconciliation';
    status: 'available' | 'waiting' | 'blocked' | 'completed';
    deadline: string | null;
    disabledReason: string | null;
    canonicalUrl: string;
  };
  appeal: {
    status: 'available' | 'opened' | 'resolved' | 'expired' | 'unavailable';
    windowEndsAt: string | null;
    currentActorAppealId: string | null;
  };
}

export interface GovernedActionOperationDetailReadback {
  schemaVersion: 1;
  canonicalUrl: string;
  circleId: number;
  actionType: string;
  invocation: {
    id: string;
    state: string;
    subjectType: string;
    subjectRef: string;
    createdAt: string;
    updatedAt: string;
    previousReceiptRef: string | null;
  };
  contract: {
    id: string;
    version: number;
    executionAdapter: string;
    executionDomain: string;
    riskFloor: string;
    reviewTiming: string;
    idempotencyScope: string;
    definitionDigest: string;
  };
  authority: {
    snapshotId: string;
    snapshotDigest: string;
    sourceType: string;
    sourceRef: string;
    sourceVersion: string | null;
    decisionPath: string;
    resolverVersion: string;
    validFrom: string;
    validUntil: string | null;
    binding: {
      id: string;
      purpose: string;
      status: string;
      bindingDigest: string;
      effectiveFrom: string;
      effectiveUntil: string | null;
    };
  };
  executionBoundary: {
    operationAuthority: 'exact_invocation_snapshot_only';
    votingAuthority: 'not_granted_by_operation';
    proposalMutationAuthority: 'not_granted_by_operation';
    authorshipAuthority: 'not_granted_by_operation';
    circleAuthority: 'not_granted_by_operation';
    payerAuthority: 'separate_not_granted_by_operation';
    serviceRoleAuthority: 'limited_task_only_not_circle_authority';
    provider: {
      adapter: string;
      authority: 'exact_execution_only';
      authoritativeFinality: 'not_asserted';
    };
  };
  receipt: ReturnType<typeof projectGovernedDirectOperationReceipt> & {
    startedAt: string;
    completedAt: string;
  };
  effect: {
    id: string;
    state: string;
    stateVersion: number;
    effectDigest: string;
    activatedAt: string;
    updatedAt: string;
    expiry: { status: 'not_configured' | 'expired'; at: string | null };
    revocation: { status: 'not_revoked' | 'revoked'; at: string | null };
    ratification: { status: 'not_required' | 'required' };
    events: Array<{
      id: string;
      sequence: number;
      fromState: string | null;
      toState: string;
      reasonCode: string;
      actorPubkey: string | null;
      sourceReceiptId: string | null;
      occurredAt: string;
      transitionDigest: string;
    }>;
  };
  appeal: {
    status: 'available' | 'expired' | 'opened' | 'resolved' | 'unavailable';
    windowEndsAt: string | null;
    routing: GovernedActionAppealRoutingReadback;
    resolutionBoundary: typeof GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY;
    currentActorAppeal: null | {
      id: string;
      state: string;
      resolutionPath: string;
      governanceCaseRef: string | null;
      appealResolutionArtifactRef: string | null;
      openedAt: string;
      resolvedAt: string | null;
      resolution: null | {
        id: string;
        outcome: string;
        reasonCode: string;
        effectUpdateRef: string | null;
        resolvedAt: string;
        resolutionDigest: string;
      };
    };
  };
  recurrence: Array<{
    receiptId: string;
    actionType: string;
    executionStatus: string;
    effectState: string | null;
    completedAt: string;
    canonicalUrl: string;
  }>;
  escalation: {
    ref: string;
    trigger: 'disputed' | 'repeated' | null;
    caseUrl: string | null;
  };
}

function isoDate(value: unknown, errorCode: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(errorCode);
  return date.toISOString();
}

function optionalIsoDate(value: unknown, errorCode: string): string | null {
  return value == null ? null : isoDate(value, errorCode);
}

function operationCanonicalUrl(circleId: number, receiptId: string): string {
  return `/governance/operations/${circleId}/${encodeURIComponent(receiptId)}`;
}

function readbackRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readbackString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isExactGovernedOperationRespondent(value: any, actorPubkey: string): boolean {
  const invocation = value?.invocation;
  const actionType = readbackString(invocation?.contractVersion?.actionType);
  if (!['communication.member.mute', 'communication.message.hide'].includes(actionType)) {
    return false;
  }
  const circleId = readbackInteger(invocation?.governanceHomeRef);
  const requestedEffect = readbackRecord(invocation?.requestedEffect);
  if (circleId == null
    || invocation?.governanceHomeType !== 'circle'
    || requestedEffect.targetMemberPubkey !== actorPubkey
    || requestedEffect.roomKey !== `circle:${circleId}`) return false;
  if (actionType === 'communication.member.mute') {
    return invocation.subjectType === 'communication_room_member'
      && invocation.subjectRef === `${circleId}:${actorPubkey}`;
  }
  const envelopeId = readbackString(requestedEffect.envelopeId);
  return Boolean(envelopeId)
    && invocation.subjectType === 'communication_message'
    && invocation.subjectRef === `${circleId}:${envelopeId}`;
}

function isExactAppealCaseReviewer(
  value: any,
  appeal: any,
  governanceCase: any,
  actorPubkey: string,
): boolean {
  if (!governanceCase
    || appeal?.state !== 'governance_case_pending'
    || readbackString(appeal.governanceCaseRef) !== readbackString(governanceCase.id)
    || readbackString(appeal.originalReceiptId) !== readbackString(value?.id)
    || governanceCase.originKind !== 'native_invocation'
    || governanceCase.originRef !== `operation_receipt:${value?.id}`
    || governanceCase.invocationId !== value?.invocation?.id) return false;
  const payload = communicationMemberMuteAppealPayload(governanceCase.requestedActionPayload);
  if (!payload
    || payload.appealId !== appeal.id
    || payload.originalReceiptId !== value.id
    || payload.originalInvocationId !== value.invocation.id
    || payload.appellantPubkey !== appeal.appellantPubkey) return false;
  const eligibleActors = Array.isArray(governanceCase.primaryRequest?.snapshot?.eligibleActors)
    ? governanceCase.primaryRequest.snapshot.eligibleActors
    : [];
  return eligibleActors.some((candidate: any) => readbackString(candidate?.pubkey) === actorPubkey);
}

function readbackInteger(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function resolveGovernedActionOperationReadScopes(
  value: any,
  scopes: readonly GovernedActionOperationReadScope[],
): GovernedActionOperationReadScope[] {
  const invocation = value?.invocation;
  const snapshot = invocation?.authoritySnapshot;
  const binding = snapshot?.binding;
  const contract = invocation?.contractVersion;
  const circleId = readbackInteger(invocation?.governanceHomeRef);
  if (invocation?.governanceHomeType !== 'circle'
    || circleId == null
    || !snapshot
    || !binding
    || !contract) return [];
  const limits = readbackRecord(binding.limits);
  const selector = readbackRecord(binding.selector);
  const domainBindingId = readbackString(limits.domainBindingId);
  const committeeCircleId = readbackInteger(limits.committeeCircleId);
  const policyVersion = readbackInteger(limits.policyVersion);
  const managerScopes = scopes.filter((scope) => (
    scope.role === 'governance_home_manager' && scope.targetCircleId === circleId
  ));
  const delegatedScopes = scopes.filter((scope) => (
    scope.role === 'delegated_authority_participant'
    && scope.targetCircleId === circleId
    && scope.committeeCircleId === committeeCircleId
    && scope.domainBindingId === domainBindingId
    && snapshot.authoritySourceType === 'governance_mandate'
    && snapshot.authoritySourceRef === scope.mandateId
    && (snapshot.authoritySourceVersion ?? null) === scope.mandateSourceVersion
    && readbackString(limits.policyId) === scope.policyId
    && readbackString(limits.policyVersionId) === scope.policyVersionId
    && policyVersion === scope.policyVersion
    && readbackInteger(selector.targetCircleId) === circleId
  ));
  return [...managerScopes, ...delegatedScopes];
}

export function resolveGovernedActionOperationReadScope(
  value: any,
  scopes: readonly GovernedActionOperationReadScope[],
): GovernedActionOperationReadScope | null {
  const matches = resolveGovernedActionOperationReadScopes(value, scopes);
  return matches.find((scope) => scope.role === 'delegated_authority_participant')
    ?? matches[0]
    ?? null;
}

export async function resolveGovernedActionOperationInboxReadback(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    scopes: readonly GovernedActionOperationReadScope[];
    independentAppealReviewerCircleIds?: readonly number[];
    now?: Date;
  },
): Promise<GovernedActionOperationInboxItem[]> {
  const homeRefs = [...new Set(input.scopes.map((scope) => String(scope.targetCircleId)))];
  const now = input.now ?? new Date();
  const values = await (prisma as any).operationReceipt.findMany({
    where: {
      OR: [
        ...(homeRefs.length > 0 ? [{
          invocation: {
            governanceHomeType: 'circle',
            governanceHomeRef: { in: homeRefs },
          },
        }] : []),
        { appeals: { some: { appellantPubkey: input.actorPubkey } } },
        {
          invocation: {
            governanceHomeType: 'circle',
            contractVersion: {
              actionType: { in: ['communication.member.mute', 'communication.message.hide'] },
            },
            requestedEffect: { path: ['targetMemberPubkey'], equals: input.actorPubkey },
          },
        },
      ],
    },
    include: {
      invocation: {
        include: {
          contractVersion: true,
          authoritySnapshot: { include: { binding: true } },
        },
      },
      initialEffect: { include: { events: { orderBy: { sequence: 'asc' } } } },
      appeals: {
        select: {
          id: true,
          appellantPubkey: true,
          state: true,
          resolutionPath: true,
          governanceCaseRef: true,
          originalReceiptId: true,
          openedAt: true,
          resolvedAt: true,
        },
        orderBy: { openedAt: 'desc' },
      },
    },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  const appealCaseRefs = [...new Set(values.flatMap((value: any) => (
    (Array.isArray(value.appeals) ? value.appeals : [])
      .map((appeal: any) => readbackString(appeal.governanceCaseRef))
      .filter(Boolean)
  )))];
  const appealCases = appealCaseRefs.length === 0
    ? []
    : await (prisma as any).governanceCase.findMany({
        where: { id: { in: appealCaseRefs } },
        select: {
          id: true,
          invocationId: true,
          originKind: true,
          originRef: true,
          requestedActionPayload: true,
          primaryRequest: { select: { snapshot: true } },
        },
      });
  const appealCaseById = new Map(
    appealCases.map((governanceCase: any) => [String(governanceCase.id), governanceCase]),
  );
  const independentReviewerCircleIds = new Set(
    input.independentAppealReviewerCircleIds ?? [],
  );
  return values.flatMap((value: any) => {
    const matchedScopes = resolveGovernedActionOperationReadScopes(value, input.scopes);
    const scope = matchedScopes.find(
      (candidate) => candidate.role === 'delegated_authority_participant',
    ) ?? matchedScopes[0] ?? null;
    const invocation = value.invocation;
    const snapshot = invocation.authoritySnapshot;
    const binding = snapshot.binding;
    const contract = invocation.contractVersion;
    const effect = value.initialEffect;
    const events = Array.isArray(effect?.events) ? effect.events : [];
    if (!effect
      || effect.invocationId !== invocation.id
      || effect.initialReceiptId !== value.id
      || events.length === 0
      || events.some((event: any, index: number) => (
        event.effectId !== effect.id || Number(event.sequence) !== index
      ))
      || Number(effect.stateVersion) !== events.length - 1
      || String(effect.state) !== String(events.at(-1)?.toState || '')) {
      throw new Error('governed_action_operation_inbox_effect_mismatch');
    }
    projectGovernedDirectOperationReceipt(value);
    const risk = readbackString(contract.riskFloor);
    if (!['low', 'medium', 'high', 'critical'].includes(risk)) {
      throw new Error('governed_action_operation_inbox_risk_invalid');
    }
    const appeals = Array.isArray(value.appeals) ? value.appeals : [];
    const currentActorAppeal = appeals.find(
      (appeal: any) => appeal.appellantPubkey === input.actorPubkey,
    ) ?? null;
    const openAppeal = appeals.find((appeal: any) => appeal.state !== 'resolved') ?? null;
    const respondent = isExactGovernedOperationRespondent(value, input.actorPubkey);
    const appealReviewer = Boolean(openAppeal && (
      (openAppeal.resolutionPath === 'independent_review'
        && independentReviewerCircleIds.has(Number(invocation.governanceHomeRef)))
      || isExactAppealCaseReviewer(
        value,
        openAppeal,
        appealCaseById.get(readbackString(openAppeal.governanceCaseRef)),
        input.actorPubkey,
      )
    ));
    if (!scope && !respondent && !currentActorAppeal && !appealReviewer) return [];
    const appealWindowEndsAt = optionalIsoDate(
      value.appealWindowEndsAt,
      'governed_action_operation_appeal_deadline_invalid',
    );
    const appealStatus = openAppeal
      ? 'opened'
      : appeals.length > 0
        ? 'resolved'
        : !appealWindowEndsAt
          ? 'unavailable'
          : now.getTime() <= new Date(appealWindowEndsAt).getTime()
            ? 'available'
            : 'expired';
    const requestedEffect = readbackRecord(invocation.requestedEffect);
    const effectExpiresAt = requestedEffect.expiresAt == null
      ? null
      : optionalIsoDate(
          requestedEffect.expiresAt,
          'governed_action_operation_effect_expiry_invalid',
        );
    const terminalEffect = ['expired', 'revoked', 'superseded'].includes(String(effect.state));
    const actionTask = openAppeal
      ? {
          kind: 'appeal' as const,
          status: 'waiting' as const,
          deadline: appealWindowEndsAt,
          disabledReason: 'appeal_resolution_pending',
        }
      : effect.state === 'ratification_required'
        ? {
            kind: 'ratification' as const,
            status: 'available' as const,
            deadline: null,
            disabledReason: null,
          }
        : effect.state === 'rollback_failed'
          || readbackString(value.escalationRef).startsWith('governance-case:')
          ? {
              kind: 'escalation' as const,
              status: 'blocked' as const,
              deadline: null,
              disabledReason: 'operation_escalation_required',
            }
          : appealStatus === 'available'
            ? {
                kind: 'appeal' as const,
                status: 'available' as const,
                deadline: appealWindowEndsAt,
                disabledReason: null,
              }
            : null;
    const task = actionTask ?? {
      kind: 'reconciliation' as const,
      status: terminalEffect ? 'completed' as const : 'waiting' as const,
      deadline: effectExpiresAt,
      disabledReason: null,
    };
    const group = openAppeal
      ? 'appealed' as const
      : terminalEffect
        ? 'closed' as const
        : actionTask?.kind === 'ratification' || actionTask?.kind === 'escalation'
          ? 'awaiting_action' as const
          : effectExpiresAt
            && new Date(effectExpiresAt).getTime() <= now.getTime() + 24 * 60 * 60 * 1000
            ? 'expiring' as const
            : 'active' as const;
    const limits = readbackRecord(binding.limits);
    const canonicalUrl = operationCanonicalUrl(Number(invocation.governanceHomeRef), value.id);
    const identities: GovernedActionOperationInboxItem['identities'] = [];
    if (scope && task.kind !== 'appeal' && task.status !== 'completed') {
      identities.push({
        role: 'operational_assignee',
        status: task.status,
        deadline: task.deadline,
        disabledReason: task.disabledReason,
        canonicalUrl,
      });
    }
    if (respondent || currentActorAppeal) {
      identities.push({
        role: 'respondent_appellant',
        status: currentActorAppeal
          ? (currentActorAppeal.state === 'resolved' ? 'completed' : 'waiting')
          : appealStatus === 'available' ? 'available' : 'blocked',
        deadline: appealWindowEndsAt,
        disabledReason: currentActorAppeal
          ? (currentActorAppeal.state === 'resolved' ? 'appeal_resolved' : 'appeal_resolution_pending')
          : appealStatus === 'available' ? null : 'appeal_unavailable',
        canonicalUrl,
      });
    }
    if (appealReviewer) {
      identities.push({
        role: 'appeal_reviewer',
        status: 'available',
        deadline: appealWindowEndsAt,
        disabledReason: null,
        canonicalUrl: openAppeal?.governanceCaseRef
          ? `/governance/cases/${encodeURIComponent(String(openAppeal.governanceCaseRef))}`
          : canonicalUrl,
      });
    }
    return [{
      id: String(value.id),
      circleId: Number(invocation.governanceHomeRef),
      actionType: String(contract.actionType),
      occurredAt: isoDate(
        value.completedAt,
        'governed_action_operation_inbox_completed_at_invalid',
      ),
      subject: { type: String(invocation.subjectType), ref: String(invocation.subjectRef) },
      risk: risk as GovernedActionOperationInboxItem['risk'],
      provider: {
        type: 'execution_adapter',
        ref: String(contract.executionAdapter),
        authoritativeFinality: 'not_asserted',
      },
      invocation: { id: String(invocation.id), state: String(invocation.state) },
      effect: {
        id: String(effect.id),
        state: String(effect.state),
        stateVersion: Number(effect.stateVersion),
      },
      group,
      lifecycle: { expiresAt: effectExpiresAt },
      identities,
      authority: {
        role: scope?.role ?? null,
        identities: matchedScopes.map((identity) => ({
          role: identity.role,
          targetCircleId: identity.targetCircleId,
          domainBindingId: identity.domainBindingId,
          mandateId: identity.mandateId,
          committeeCircleId: identity.committeeCircleId,
        })),
        sourceType: String(snapshot.authoritySourceType),
        sourceRef: String(snapshot.authoritySourceRef),
        sourceVersion: snapshot.authoritySourceVersion == null
          ? null
          : String(snapshot.authoritySourceVersion),
        domainBindingId: readbackString(limits.domainBindingId) || null,
        mandateId: scope?.mandateId ?? null,
        committeeCircleId: scope?.committeeCircleId ?? null,
      },
      task: {
        ...task,
        canonicalUrl,
      },
      appeal: {
        status: appealStatus,
        windowEndsAt: appealWindowEndsAt,
        currentActorAppealId: currentActorAppeal ? String(currentActorAppeal.id) : null,
      },
    }];
  });
}

export async function resolveGovernedActionOperationDetailReadback(
  prisma: PrismaClient,
  input: {
    circleId: number;
    receiptId: string;
    viewerPubkey: string;
    readScopes?: readonly GovernedActionOperationReadScope[];
    independentAppealReviewerCircleIds?: readonly number[];
    now?: Date;
  },
): Promise<GovernedActionOperationDetailReadback> {
  const receiptId = input.receiptId.trim();
  if (!receiptId) throw new Error('governed_action_operation_receipt_id_required');
  const value = await (prisma as any).operationReceipt.findUnique({
    where: { id: receiptId },
    include: {
      invocation: {
        include: {
          contractVersion: true,
          authoritySnapshot: { include: { binding: true } },
        },
      },
      initialEffect: { include: { events: { orderBy: { sequence: 'asc' } } } },
      appeals: {
        select: {
          id: true,
          appellantPubkey: true,
          state: true,
          resolutionPath: true,
          governanceCaseRef: true,
          appealResolutionArtifactRef: true,
          originalReceiptId: true,
          openedAt: true,
          resolvedAt: true,
          resolutionReceipt: {
            select: {
              id: true,
              outcome: true,
              reasonCode: true,
              effectUpdateRef: true,
              resolvedAt: true,
              resolutionDigest: true,
            },
          },
        },
        orderBy: { openedAt: 'desc' },
      },
    },
  });
  const invocation = value?.invocation;
  const contract = invocation?.contractVersion;
  const snapshot = invocation?.authoritySnapshot;
  const binding = snapshot?.binding;
  const effect = value?.initialEffect;
  if (!value
    || invocation?.governanceHomeType !== 'circle'
    || invocation.governanceHomeRef !== String(input.circleId)
    || !contract
    || !snapshot
    || !binding
    || !effect
    || effect.invocationId !== invocation.id
    || effect.initialReceiptId !== value.id) {
    throw new Error('governed_action_operation_detail_missing');
  }
  const readScope = input.readScopes
    ? resolveGovernedActionOperationReadScope(value, input.readScopes)
    : null;
  const openAppeal = (Array.isArray(value.appeals) ? value.appeals : [])
    .find((appeal: any) => appeal.state !== 'resolved') ?? null;
  const appealCase = openAppeal?.governanceCaseRef
    ? await (prisma as any).governanceCase.findUnique({
        where: { id: String(openAppeal.governanceCaseRef) },
        select: {
          id: true,
          invocationId: true,
          originKind: true,
          originRef: true,
          requestedActionPayload: true,
          primaryRequest: { select: { snapshot: true } },
        },
      })
    : null;
  const currentActorAppeal = (Array.isArray(value.appeals) ? value.appeals : [])
    .find((appeal: any) => appeal.appellantPubkey === input.viewerPubkey) ?? null;
  const appealReviewer = Boolean(openAppeal && (
    (openAppeal.resolutionPath === 'independent_review'
      && new Set(input.independentAppealReviewerCircleIds ?? []).has(input.circleId))
    || isExactAppealCaseReviewer(
      value,
      openAppeal,
      appealCase,
      input.viewerPubkey,
    )
  ));
  if (input.readScopes
    && !readScope
    && !isExactGovernedOperationRespondent(value, input.viewerPubkey)
    && !currentActorAppeal
    && !appealReviewer) {
    throw new Error('governed_action_operation_detail_missing');
  }
  const projectedReceipt = projectGovernedDirectOperationReceipt(value);
  const events = Array.isArray(effect.events) ? effect.events : [];
  if (events.length === 0
    || events.some((event: any, index: number) => (
      event.effectId !== effect.id || Number(event.sequence) !== index
    ))
    || Number(effect.stateVersion) !== events.length - 1
    || String(effect.state) !== String(events.at(-1)?.toState || '')) {
    throw new Error('governed_action_operation_effect_history_mismatch');
  }
  const expiryEvent = events.findLast((event: any) => event.toState === 'expired') ?? null;
  const revocationEvent = events.findLast((event: any) => event.toState === 'revoked') ?? null;
  const appealWindowEndsAt = optionalIsoDate(
    value.appealWindowEndsAt,
    'governed_action_operation_appeal_deadline_invalid',
  );
  const now = input.now ?? new Date();
  const appealStatus = currentActorAppeal
    ? (currentActorAppeal.state === 'resolved' ? 'resolved' : 'opened')
    : !appealWindowEndsAt
      ? 'unavailable'
      : now.getTime() <= new Date(appealWindowEndsAt).getTime() ? 'available' : 'expired';

  const recurrenceRelations = [
    ...(invocation.recurrenceKey ? [{ invocation: { recurrenceKey: invocation.recurrenceKey } }] : []),
    ...(invocation.previousReceiptRef ? [{ id: invocation.previousReceiptRef }] : []),
    { invocation: { previousReceiptRef: value.id } },
  ];
  const relatedReceipts = recurrenceRelations.length > 0
    ? await (prisma as any).operationReceipt.findMany({
        where: {
          id: { not: value.id },
          invocation: {
            governanceHomeType: 'circle',
            governanceHomeRef: String(input.circleId),
          },
          OR: recurrenceRelations,
        },
        include: {
          invocation: { include: { contractVersion: { select: { actionType: true } } } },
          initialEffect: { select: { state: true } },
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        take: 20,
      })
    : [];
  const originCases = await (prisma as any).governanceCase.findMany({
    where: {
      originKind: 'native_invocation',
      originRef: `operation_receipt:${value.id}`,
    },
    orderBy: { openedAt: 'desc' },
    take: 8,
  });
  const recurrenceCases = originCases.filter((candidate: any) => (
    communicationOperationRecurrenceReviewPayload(candidate.requestedActionPayload)
  ));
  const disputeCases = originCases.filter((candidate: any) => (
    communicationMemberMuteAppealPayload(candidate.requestedActionPayload)
  ));
  if (recurrenceCases.length > 1 || disputeCases.length > 1) {
    throw new Error('governed_action_operation_escalation_ambiguous');
  }
  const escalationCase = recurrenceCases[0] ?? disputeCases[0] ?? null;
  const recurrencePayload = escalationCase
    ? communicationOperationRecurrenceReviewPayload(escalationCase.requestedActionPayload)
    : null;
  const disputePayload = escalationCase
    ? communicationMemberMuteAppealPayload(escalationCase.requestedActionPayload)
    : null;
  if (escalationCase && (
    escalationCase.invocationId !== invocation.id
    || escalationCase.subjectType !== invocation.subjectType
    || escalationCase.subjectRef !== invocation.subjectRef
    || (recurrencePayload && recurrencePayload.currentReceiptId !== value.id)
    || (disputePayload && disputePayload.originalReceiptId !== value.id)
  )) throw new Error('governed_action_operation_escalation_mismatch');

  return {
    schemaVersion: 1,
    canonicalUrl: operationCanonicalUrl(input.circleId, value.id),
    circleId: input.circleId,
    actionType: String(contract.actionType),
    invocation: {
      id: String(invocation.id),
      state: String(invocation.state),
      subjectType: String(invocation.subjectType),
      subjectRef: String(invocation.subjectRef),
      createdAt: isoDate(invocation.createdAt, 'governed_action_operation_created_at_invalid'),
      updatedAt: isoDate(invocation.updatedAt, 'governed_action_operation_updated_at_invalid'),
      previousReceiptRef: invocation.previousReceiptRef == null
        ? null
        : String(invocation.previousReceiptRef),
    },
    contract: {
      id: String(contract.id),
      version: Number(contract.version),
      executionAdapter: String(contract.executionAdapter),
      executionDomain: String(contract.executionDomain),
      riskFloor: String(contract.riskFloor),
      reviewTiming: String(contract.reviewTiming),
      idempotencyScope: String(contract.idempotencyScope),
      definitionDigest: String(contract.definitionDigest),
    },
    authority: {
      snapshotId: String(snapshot.id),
      snapshotDigest: String(snapshot.snapshotDigest),
      sourceType: String(snapshot.authoritySourceType),
      sourceRef: String(snapshot.authoritySourceRef),
      sourceVersion: snapshot.authoritySourceVersion == null
        ? null
        : String(snapshot.authoritySourceVersion),
      decisionPath: String(snapshot.decisionPath),
      resolverVersion: String(snapshot.resolverVersion),
      validFrom: isoDate(snapshot.validFrom, 'governed_action_operation_authority_valid_from_invalid'),
      validUntil: optionalIsoDate(
        snapshot.validUntil,
        'governed_action_operation_authority_valid_until_invalid',
      ),
      binding: {
        id: String(binding.id),
        purpose: String(binding.purpose),
        status: String(binding.status),
        bindingDigest: String(binding.bindingDigest),
        effectiveFrom: isoDate(
          binding.effectiveFrom,
          'governed_action_operation_binding_effective_from_invalid',
        ),
        effectiveUntil: optionalIsoDate(
          binding.effectiveUntil,
          'governed_action_operation_binding_effective_until_invalid',
        ),
      },
    },
    executionBoundary: {
      operationAuthority: 'exact_invocation_snapshot_only',
      votingAuthority: 'not_granted_by_operation',
      proposalMutationAuthority: 'not_granted_by_operation',
      authorshipAuthority: 'not_granted_by_operation',
      circleAuthority: 'not_granted_by_operation',
      payerAuthority: 'separate_not_granted_by_operation',
      serviceRoleAuthority: 'limited_task_only_not_circle_authority',
      provider: {
        adapter: String(contract.executionAdapter),
        authority: 'exact_execution_only',
        authoritativeFinality: 'not_asserted',
      },
    },
    receipt: {
      ...projectedReceipt,
      startedAt: isoDate(value.startedAt, 'governed_action_operation_started_at_invalid'),
      completedAt: isoDate(value.completedAt, 'governed_action_operation_completed_at_invalid'),
    },
    effect: {
      id: String(effect.id),
      state: String(effect.state),
      stateVersion: Number(effect.stateVersion),
      effectDigest: String(effect.effectDigest),
      activatedAt: isoDate(effect.activatedAt, 'governed_action_operation_effect_activated_at_invalid'),
      updatedAt: isoDate(effect.updatedAt, 'governed_action_operation_effect_updated_at_invalid'),
      expiry: expiryEvent
        ? { status: 'expired', at: isoDate(expiryEvent.occurredAt, 'governed_action_operation_effect_event_at_invalid') }
        : { status: 'not_configured', at: null },
      revocation: revocationEvent
        ? { status: 'revoked', at: isoDate(revocationEvent.occurredAt, 'governed_action_operation_effect_event_at_invalid') }
        : { status: 'not_revoked', at: null },
      ratification: {
        status: effect.state === 'ratification_required' ? 'required' : 'not_required',
      },
      events: events.map((event: any) => ({
        id: String(event.id),
        sequence: Number(event.sequence),
        fromState: event.fromState == null ? null : String(event.fromState),
        toState: String(event.toState),
        reasonCode: String(event.reasonCode),
        actorPubkey: event.actorPubkey == null ? null : String(event.actorPubkey),
        sourceReceiptId: event.sourceReceiptId == null ? null : String(event.sourceReceiptId),
        occurredAt: isoDate(event.occurredAt, 'governed_action_operation_effect_event_at_invalid'),
        transitionDigest: String(event.transitionDigest),
      })),
    },
    appeal: {
      status: appealStatus,
      windowEndsAt: appealWindowEndsAt,
      routing: projectGovernedActionAppealRouting({
        actionType: String(contract.actionType),
        circleId: input.circleId,
        receiptId: value.id,
        deadline: appealWindowEndsAt,
      }),
      resolutionBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
      currentActorAppeal: currentActorAppeal ? {
        id: String(currentActorAppeal.id),
        state: String(currentActorAppeal.state),
        resolutionPath: String(currentActorAppeal.resolutionPath),
        governanceCaseRef: currentActorAppeal.governanceCaseRef == null
          ? null
          : String(currentActorAppeal.governanceCaseRef),
        appealResolutionArtifactRef: currentActorAppeal.appealResolutionArtifactRef == null
          ? null
          : String(currentActorAppeal.appealResolutionArtifactRef),
        openedAt: isoDate(currentActorAppeal.openedAt, 'governed_action_operation_appeal_opened_at_invalid'),
        resolvedAt: optionalIsoDate(
          currentActorAppeal.resolvedAt,
          'governed_action_operation_appeal_resolved_at_invalid',
        ),
        resolution: currentActorAppeal.resolutionReceipt ? {
          id: String(currentActorAppeal.resolutionReceipt.id),
          outcome: String(currentActorAppeal.resolutionReceipt.outcome),
          reasonCode: String(currentActorAppeal.resolutionReceipt.reasonCode),
          effectUpdateRef: currentActorAppeal.resolutionReceipt.effectUpdateRef == null
            ? null
            : String(currentActorAppeal.resolutionReceipt.effectUpdateRef),
          resolvedAt: isoDate(
            currentActorAppeal.resolutionReceipt.resolvedAt,
            'governed_action_operation_appeal_resolution_at_invalid',
          ),
          resolutionDigest: String(currentActorAppeal.resolutionReceipt.resolutionDigest),
        } : null,
      } : null,
    },
    recurrence: relatedReceipts.map((related: any) => ({
      receiptId: String(related.id),
      actionType: String(related.invocation?.contractVersion?.actionType || ''),
      executionStatus: String(related.executionStatus),
      effectState: related.initialEffect?.state == null ? null : String(related.initialEffect.state),
      completedAt: isoDate(related.completedAt, 'governed_action_operation_recurrence_at_invalid'),
      canonicalUrl: operationCanonicalUrl(input.circleId, related.id),
    })),
    escalation: {
      ref: escalationCase ? String(escalationCase.id) : String(value.escalationRef),
      trigger: recurrencePayload ? 'repeated' : disputePayload ? 'disputed' : null,
      caseUrl: escalationCase
        ? `/governance/cases/${encodeURIComponent(String(escalationCase.id))}`
        : null,
    },
  };
}

function defaultRoutingPath(definition: {
  impact: 'low' | 'medium' | 'high' | 'critical';
  governanceMode: 'optional' | 'required_when_bound' | 'always_required';
  runtimeAvailability?: 'enabled' | 'historical_read_only';
}): GovernedActionRoutingPath {
  if (
    definition.runtimeAvailability === 'historical_read_only'
    || definition.impact === 'high'
    || definition.impact === 'critical'
    || definition.governanceMode === 'always_required'
  ) return 'blocked';
  return 'direct_operation';
}

function currentRoutingPath(status: string): GovernedActionRoutingPath {
  if (status === 'direct_allowed') return 'direct_operation';
  if (status === 'requires_governance') return 'governance_review';
  return 'blocked';
}

export async function resolveGovernedActionRoutingReadback(
  prisma: PrismaClient,
  input: { circleId: number; now?: Date },
): Promise<GovernedActionRoutingReadback> {
  const now = input.now ?? new Date();
  const registry = createDefaultGovernanceExecutionRegistry();
  const activeSelectors = await (prisma as any).circleGovernanceBinding.findMany({
    where: {
      targetCircleId: input.circleId,
      status: 'active',
      targetAuthorizationStatus: 'accepted',
      committeeMandateStatus: 'accepted',
    },
    select: { actionType: true, actionPrefix: true },
  }) as Array<{ actionType: string | null; actionPrefix: string | null }>;
  const definitions = registry.list()
    .filter((definition) => definition.actionType !== LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE)
    .sort((left, right) => left.actionType.localeCompare(right.actionType));
  const matrix = await Promise.all(definitions.map(async (definition) => {
    let resolution: Awaited<ReturnType<typeof resolveActiveCircleGovernanceBinding>> = null;
    let resolutionError: string | null = null;
    const potentiallyCovered = activeSelectors.some((selector) => (
      selector.actionType === definition.actionType
      || Boolean(
        selector.actionPrefix
        && (
          definition.actionType === selector.actionPrefix
          || definition.actionType.startsWith(`${selector.actionPrefix}.`)
        )
      )
    ));
    if (potentiallyCovered) {
      try {
        resolution = await resolveActiveCircleGovernanceBinding(prisma as any, {
          actionType: definition.actionType,
          targetCircleId: input.circleId,
          now,
        });
      } catch (error) {
        resolutionError = error instanceof Error
          ? error.message
          : 'governed_action_routing_resolution_failed';
      }
    }
    const decision = resolutionError
      ? {
          status: 'denied' as const,
          actionType: definition.actionType,
          reason: resolutionError,
        }
      : evaluateRegisteredGovernedActionRouting({
          definition,
          binding: resolution,
          directAllowed: true,
          now,
        });
    const path = currentRoutingPath(decision.status);
    if (
      path === 'direct_operation'
      && (definition.impact === 'high' || definition.impact === 'critical')
    ) throw new Error('governed_action_routing_high_risk_direct_forbidden');
    const binding = resolution?.binding ?? null;
    const effectiveAt = binding?.activatedAt instanceof Date
      ? binding.activatedAt
      : binding?.activatedAt ? new Date(binding.activatedAt) : null;
    if (binding && (!effectiveAt || !Number.isFinite(effectiveAt.getTime()))) {
      throw new Error('governed_action_routing_policy_effective_at_invalid');
    }
    return {
      actionType: definition.actionType,
      targetType: definition.targetType,
      impact: definition.impact,
      governanceMode: definition.governanceMode,
      defaultPath: defaultRoutingPath(definition),
      currentPath: path,
      reason: decision.reason,
      routingPolicy: binding ? {
        bindingId: binding.id,
        actionType: definition.actionType,
        subjectType: 'circle',
        subjectRef: String(input.circleId),
        policyId: binding.policyId,
        policyVersionId: binding.policyVersionId,
        policyVersion: binding.policyVersion,
        effectiveAt: effectiveAt!.toISOString(),
      } : null,
    } satisfies GovernedActionRoutingMatrixEntry;
  }));

  const receipts = await (prisma as any).operationReceipt.findMany({
    where: {
      invocation: {
        governanceHomeType: 'circle',
        governanceHomeRef: String(input.circleId),
      },
    },
    include: {
      invocation: {
        include: {
          authoritySnapshot: { include: { binding: true } },
          contractVersion: { select: { actionType: true } },
        },
      },
      initialEffect: true,
    },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    take: 20,
  });
  const recentDirectOperations = receipts.map((value: any) => {
    if (
      !value.initialEffect
      || value.initialEffect.invocationId !== value.invocationId
      || value.initialEffect.initialReceiptId !== value.id
    ) throw new Error('governed_action_routing_effect_readback_mismatch');
    return {
      actionType: String(value.invocation?.contractVersion?.actionType || ''),
      receipt: projectGovernedDirectOperationReceipt(value),
      effect: {
        state: String(value.initialEffect.state),
        stateVersion: Number(value.initialEffect.stateVersion),
        effectDigest: String(value.initialEffect.effectDigest),
        activatedAt: new Date(value.initialEffect.activatedAt).toISOString(),
      },
    };
  });

  return {
    schemaVersion: 1,
    circleId: input.circleId,
    matrix,
    recentDirectOperations,
  };
}
