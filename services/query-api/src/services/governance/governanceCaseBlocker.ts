export interface GovernanceCaseBlockerReadback {
  id: string;
  code: GovernanceCaseBlockerCode;
  scope: 'execution';
  scopeRef: string;
  status: 'open' | 'resolved';
  owner: 'original_decision_authority';
  sla: 'governed_resolution_required_no_implicit_deadline';
  resumeState: GovernanceCaseBlockerResumeState;
  resolutionRequirement: GovernanceCaseBlockerResolutionRequirement;
  evidenceReceiptId: string;
  openedAt: string;
  closedAt: string | null;
  retryEligibility: 'blocked_pending_governed_resolution' | 'manual_same_intent_retry_ready';
  automaticRetry: false;
}

export type GovernanceCaseBlockerCode =
  | 'funding_required'
  | 'funding_amendment_required';

export type GovernanceCaseBlockerResumeState =
  | 'accepted_pending_execution'
  | 'accepted_pending_funding_amendment';

export type GovernanceCaseBlockerResolutionRequirement =
  | 'verified_payer_budget_or_reimbursement'
  | 'original_decision_authority_accepted_cost_amendment';

export interface GovernanceCaseBlockerContract {
  code: GovernanceCaseBlockerCode;
  resumeState: GovernanceCaseBlockerResumeState;
  resolutionRequirement: GovernanceCaseBlockerResolutionRequirement;
}

export function isFundingRequiredExecutionErrorCode(value: unknown): boolean {
  const code = String(value ?? '').trim().toLowerCase();
  return code.startsWith('airdrop_') || code.includes('funding_unavailable');
}

export function isFundingAmendmentRequiredExecutionErrorCode(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase().includes('cost_cap_exceeded');
}

export function resolveGovernanceCaseBlockerContract(
  code: unknown,
  errorCode: unknown,
): GovernanceCaseBlockerContract | null {
  if (code === 'funding_required' && isFundingRequiredExecutionErrorCode(errorCode)) {
    return {
      code: 'funding_required',
      resumeState: 'accepted_pending_execution',
      resolutionRequirement: 'verified_payer_budget_or_reimbursement',
    };
  }
  if (
    code === 'funding_amendment_required'
    && isFundingAmendmentRequiredExecutionErrorCode(errorCode)
  ) {
    return {
      code: 'funding_amendment_required',
      resumeState: 'accepted_pending_funding_amendment',
      resolutionRequirement: 'original_decision_authority_accepted_cost_amendment',
    };
  }
  return null;
}

export function projectGovernanceCaseBlockers(value: any): GovernanceCaseBlockerReadback[] {
  if (
    value?.primaryRequest?.state !== 'accepted'
    || value?.primaryRequest?.decision?.decision !== 'accepted'
    || !Array.isArray(value?.primaryRequest?.receipts)
    || !Array.isArray(value?.blockers)
  ) return [];
  const decisionDigest = String(value.primaryRequest.decision.decisionDigest ?? '');
  return value.blockers.flatMap((blocker: any) => {
    const evidenceReceiptId = String(blocker?.evidenceReceiptId ?? '');
    const receipt = value.primaryRequest.receipts.find((candidate: any) => (
      candidate?.id === evidenceReceiptId
    ));
    const contract = resolveGovernanceCaseBlockerContract(blocker?.code, receipt?.errorCode);
    const openedAt = dateTime(blocker?.openedAt);
    const closedAt = dateTime(blocker?.closedAt);
    const status = blocker?.status === 'open' && blocker?.closedAt == null
      ? 'open'
      : blocker?.status === 'resolved' && closedAt
        ? 'resolved'
        : null;
    if (
      !receipt
      || !contract
      || receipt.requestId !== value.primaryRequest.id
      || receipt.executionStatus !== 'failed'
      || receipt.decisionDigest !== decisionDigest
      || blocker?.code !== contract.code
      || blocker?.scope !== 'execution'
      || blocker?.scopeRef !== `execution-receipt:${evidenceReceiptId}`
      || !status
      || blocker?.owner !== 'original_decision_authority'
      || blocker?.sla !== 'governed_resolution_required_no_implicit_deadline'
      || blocker?.resumeState !== contract.resumeState
      || blocker?.resolutionRequirement !== contract.resolutionRequirement
      || !openedAt
      || new Date(openedAt).getTime() !== new Date(receipt.executedAt).getTime()
    ) return [];
    return [{
      id: String(blocker.id),
      code: contract.code,
      scope: 'execution' as const,
      scopeRef: String(blocker.scopeRef),
      status,
      owner: 'original_decision_authority' as const,
      sla: 'governed_resolution_required_no_implicit_deadline' as const,
      resumeState: contract.resumeState,
      resolutionRequirement: contract.resolutionRequirement,
      evidenceReceiptId,
      openedAt,
      closedAt: status === 'resolved' ? closedAt : null,
      retryEligibility: status === 'resolved'
        ? 'manual_same_intent_retry_ready' as const
        : 'blocked_pending_governed_resolution' as const,
      automaticRetry: false as const,
    }];
  });
}

function dateTime(value: unknown): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
