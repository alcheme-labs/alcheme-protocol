import {
  projectGovernanceDecisionExecutionStatus,
  projectGovernanceProviderExecutionReadback,
  type GovernanceDecisionExecutionStatusProjection,
} from '../services/governance/readProjection';

type NotificationSource = {
  sourceType?: string | null;
  sourceId?: string | null;
};

export interface GovernanceNotificationStatusProjection
  extends GovernanceDecisionExecutionStatusProjection {
  governanceRecovery: {
    blocker: string;
    category: string | null;
    action: string | null;
    acceptedDecisionPreserved: true;
  } | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function notificationRecovery(
  providerExecution: Record<string, unknown> | null,
  decisionStatus: GovernanceDecisionExecutionStatusProjection['decisionStatus'],
):
GovernanceNotificationStatusProjection['governanceRecovery'] {
  const blocker = typeof providerExecution?.blocker === 'string'
    ? providerExecution.blocker.trim()
    : '';
  if (!blocker || decisionStatus !== 'accepted') return null;
  const recovery = record(providerExecution?.recovery);
  const category = typeof recovery?.category === 'string' && recovery.category.trim()
    ? recovery.category.trim()
    : null;
  const action = typeof recovery?.action === 'string' && recovery.action.trim()
    ? recovery.action.trim()
    : null;
  return {
    blocker,
    category,
    action,
    acceptedDecisionPreserved: true,
  };
}

function explicitResourceBindingId(request: any): string | null {
  const receipts = Array.isArray(request?.receipts) ? request.receipts : [];
  const receiptBindingId = [...receipts].reverse().find((receipt: any) => (
    typeof receipt?.executionEvidence?.resourceBindingId === 'string'
    || typeof receipt?.executionEvidence?.grantResourceBindingId === 'string'
  ));
  const payload = request?.payload && typeof request.payload === 'object'
    && !Array.isArray(request.payload)
    ? request.payload
    : null;
  return receiptBindingId?.executionEvidence?.resourceBindingId
    ?? receiptBindingId?.executionEvidence?.grantResourceBindingId
    ?? (typeof payload?.resourceBinding?.id === 'string' ? payload.resourceBinding.id : null)
    ?? (typeof payload?.settlementAttempt?.resourceBindingId === 'string'
      ? payload.settlementAttempt.resourceBindingId
      : null)
    ?? null;
}

export async function loadGovernanceNotificationStatuses(
  prisma: any,
  notifications: NotificationSource[],
): Promise<Map<string, GovernanceNotificationStatusProjection>> {
  const caseIds = [...new Set(notifications.flatMap((notification) => (
    notification.sourceType === 'governance_case'
      && typeof notification.sourceId === 'string'
      && notification.sourceId.trim()
      ? [notification.sourceId]
      : []
  )))];
  if (caseIds.length === 0) return new Map();
  const cases = await prisma.governanceCase.findMany({
    where: { id: { in: caseIds } },
    include: {
      primaryRequest: {
        include: {
          decision: true,
          receipts: { orderBy: { executedAt: 'asc' } },
        },
      },
      decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
    },
  });
  const requests = cases.flatMap((governanceCase: any) => (
    governanceCase.primaryRequest ? [governanceCase.primaryRequest] : []
  ));
  const requestIds = requests.map((request: any) => String(request.id));
  const explicitBindingIds = requests.flatMap((request: any) => {
    const bindingId = explicitResourceBindingId(request);
    return bindingId ? [bindingId] : [];
  });
  const bindingDelegate = prisma.governedResourceBinding;
  const bindings = bindingDelegate?.findMany && (requestIds.length > 0 || explicitBindingIds.length > 0)
    ? await bindingDelegate.findMany({
        where: {
          OR: [
            { sourceRequestId: { in: requestIds } },
            { id: { in: explicitBindingIds } },
          ],
        },
        include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      })
    : [];
  const bindingBySourceRequestId = new Map(
    bindings.map((binding: any) => [String(binding.sourceRequestId), binding]),
  );
  const bindingById = new Map(
    bindings.map((binding: any) => [String(binding.id), binding]),
  );
  return new Map(cases.flatMap((governanceCase: any) => {
    const request = governanceCase.primaryRequest;
    if (!request) return [];
    const bindingId = explicitResourceBindingId(request);
    const providerResourceBinding = bindingBySourceRequestId.get(String(request.id))
      ?? (bindingId ? bindingById.get(bindingId) : null)
      ?? null;
    const projectedRequest = {
      ...request,
      decisionOutputArtifacts: governanceCase.decisionOutputArtifacts,
      providerResourceBinding,
    };
    const providerExecution = projectGovernanceProviderExecutionReadback(projectedRequest);
    const decisionExecution = projectGovernanceDecisionExecutionStatus(projectedRequest);
    return [[String(governanceCase.id), {
      ...decisionExecution,
      governanceRecovery: notificationRecovery(providerExecution, decisionExecution.decisionStatus),
    }] as const];
  }));
}
