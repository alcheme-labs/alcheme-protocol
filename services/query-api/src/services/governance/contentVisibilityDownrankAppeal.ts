import { CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE } from './actionRegistry';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';

export const CONTENT_VISIBILITY_DOWNRANK_APPEAL_KIND =
  'content_visibility_downrank_appeal_resolution';

export interface ContentVisibilityDownrankAppealPayload {
  kind: typeof CONTENT_VISIBILITY_DOWNRANK_APPEAL_KIND;
  currentContract: 'content-visibility-downrank-current';
  appealId: string;
  circleId: number;
  contentId: string;
  subjectRef: string;
  appealInvocationId: string;
  originalInvocationId: string;
  originalReceiptId: string;
  originalReceiptDigest: string;
  operationEffectId: string;
  originalEffectDigest: string;
  originalOperatorPubkey: string;
  appellantPubkey: string;
  evidenceDigest: string;
  appealWindowEndsAt: string;
  requestedOutcome: 'revoke';
  conflictRule: 'original_executor_and_appellant_excluded';
}

export function contentVisibilityDownrankAppealPayload(
  value: unknown,
): ContentVisibilityDownrankAppealPayload | null {
  const container = record(value);
  const candidate = record(container.contentVisibilityDownrankAppeal);
  const deadline = new Date(String(candidate.appealWindowEndsAt ?? 'invalid'));
  if (
    candidate.kind !== CONTENT_VISIBILITY_DOWNRANK_APPEAL_KIND
    || candidate.currentContract !== 'content-visibility-downrank-current'
    || !Number.isSafeInteger(Number(candidate.circleId))
    || Number(candidate.circleId) <= 0
    || typeof candidate.contentId !== 'string'
    || !candidate.contentId
    || candidate.subjectRef !== `${candidate.circleId}:${candidate.contentId}`
    || typeof candidate.appealId !== 'string'
    || !candidate.appealId.startsWith('governed-action-appeal:')
    || typeof candidate.appealInvocationId !== 'string'
    || !candidate.appealInvocationId.startsWith('governed-invocation:')
    || typeof candidate.originalInvocationId !== 'string'
    || !candidate.originalInvocationId
    || typeof candidate.originalReceiptId !== 'string'
    || !candidate.originalReceiptId
    || !/^[a-f0-9]{64}$/.test(String(candidate.originalReceiptDigest ?? ''))
    || typeof candidate.operationEffectId !== 'string'
    || !candidate.operationEffectId
    || !/^[a-f0-9]{64}$/.test(String(candidate.originalEffectDigest ?? ''))
    || typeof candidate.originalOperatorPubkey !== 'string'
    || !candidate.originalOperatorPubkey
    || typeof candidate.appellantPubkey !== 'string'
    || !candidate.appellantPubkey
    || candidate.appellantPubkey === candidate.originalOperatorPubkey
    || !/^[a-f0-9]{64}$/.test(String(candidate.evidenceDigest ?? ''))
    || Number.isNaN(deadline.getTime())
    || candidate.requestedOutcome !== 'revoke'
    || candidate.conflictRule !== 'original_executor_and_appellant_excluded'
  ) return null;
  return {
    kind: CONTENT_VISIBILITY_DOWNRANK_APPEAL_KIND,
    currentContract: 'content-visibility-downrank-current',
    appealId: candidate.appealId,
    circleId: Number(candidate.circleId),
    contentId: candidate.contentId,
    subjectRef: candidate.subjectRef,
    appealInvocationId: candidate.appealInvocationId,
    originalInvocationId: candidate.originalInvocationId,
    originalReceiptId: candidate.originalReceiptId,
    originalReceiptDigest: String(candidate.originalReceiptDigest),
    operationEffectId: candidate.operationEffectId,
    originalEffectDigest: String(candidate.originalEffectDigest),
    originalOperatorPubkey: candidate.originalOperatorPubkey,
    appellantPubkey: candidate.appellantPubkey,
    evidenceDigest: String(candidate.evidenceDigest),
    appealWindowEndsAt: deadline.toISOString(),
    requestedOutcome: 'revoke',
    conflictRule: 'original_executor_and_appellant_excluded',
  };
}

export interface ContentVisibilityDownrankAppealEffectResult {
  artifactId: string;
  resultingEffectState: string;
  effectApplied: boolean;
}

export async function resolveContentVisibilityDownrankAppealInTransaction(
  tx: any,
  input: {
    governanceCase: any;
    request: any;
    decision: { decision: string; decisionDigest: string };
    now: Date;
  },
): Promise<ContentVisibilityDownrankAppealEffectResult> {
  const payload = contentVisibilityDownrankAppealPayload(input.request.payload);
  if (!payload) throw appealError('content_visibility_downrank_appeal_payload_invalid');
  if (
    input.governanceCase.originKind !== 'native_invocation'
    || input.governanceCase.originRef !== `operation_receipt:${payload.originalReceiptId}`
    || input.governanceCase.invocationId !== payload.originalInvocationId
    || input.governanceCase.subjectType !== 'feed_post'
    || input.governanceCase.subjectRef !== payload.subjectRef
    || input.request.actionType !== CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE
    || input.request.targetType !== 'feed_post'
    || input.request.targetRef !== payload.subjectRef
    || !['accepted', 'rejected', 'expired', 'cancelled'].includes(input.decision.decision)
  ) throw appealError('content_visibility_downrank_appeal_case_mismatch');
  const [appeal, receipt, effect, post] = await Promise.all([
    tx.governedActionAppeal.findUnique({ where: { id: payload.appealId } }),
    tx.operationReceipt.findUnique({ where: { id: payload.originalReceiptId } }),
    tx.operationEffect.findUnique({ where: { id: payload.operationEffectId } }),
    tx.post.findUnique({ where: { contentId: payload.contentId } }),
  ]);
  if (
    !appeal
    || appeal.appealInvocationId !== payload.appealInvocationId
    || appeal.originalInvocationId !== payload.originalInvocationId
    || appeal.originalReceiptId !== payload.originalReceiptId
    || appeal.appellantPubkey !== payload.appellantPubkey
    || appeal.evidenceDigest !== payload.evidenceDigest
    || appeal.resolutionPath !== 'governance_case_appeal_resolution'
    || appeal.governanceCaseRef !== input.governanceCase.id
    || !receipt
    || receipt.invocationId !== payload.originalInvocationId
    || receipt.actorPubkey !== payload.originalOperatorPubkey
    || receipt.receiptDigest !== payload.originalReceiptDigest
    || !effect
    || effect.invocationId !== payload.originalInvocationId
    || effect.initialReceiptId !== payload.originalReceiptId
    || effect.effectDigest !== payload.originalEffectDigest
    || !post
    || post.circleId !== payload.circleId
    || post.downrankOperationReceiptId !== payload.originalReceiptId
    || post.downrankOperationEffectId !== payload.operationEffectId
  ) throw appealError('content_visibility_downrank_appeal_owner_mismatch');
  const artifactId = `decision-output:${input.decision.decisionDigest}`;
  if (appeal.state === 'resolved') {
    if (appeal.appealResolutionArtifactRef !== artifactId || !(appeal.resolvedAt instanceof Date)) {
      throw appealError('content_visibility_downrank_appeal_replay_mismatch');
    }
    const artifact = await tx.decisionOutputArtifact.findUnique({ where: { id: artifactId } });
    const resolution = artifact?.constraints?.appealResolution;
    if (
      artifact?.kind !== 'appeal_resolution'
      || resolution?.domain !== 'content_visibility_downrank'
      || !['active', 'expired', 'revoked', 'superseded'].includes(
        String(resolution.resultingEffectState),
      )
      || !['applied', 'preserved'].includes(String(resolution.effectStatus))
    ) throw appealError('content_visibility_downrank_appeal_replay_artifact_invalid');
    return {
      artifactId,
      resultingEffectState: String(resolution.resultingEffectState),
      effectApplied: resolution.effectStatus === 'applied',
    };
  }
  const accepted = input.decision.decision === 'accepted';
  if (accepted && !['active', 'expired', 'revoked', 'superseded'].includes(effect.state)) {
    throw appealError('content_visibility_downrank_appeal_effect_unavailable');
  }
  let effectApplied = false;
  let resultingEffectState = String(effect.state);
  if (accepted && effect.state === 'active') {
    await transitionOperationEffectInTransaction(tx, {
      effectId: effect.id,
      nextState: 'revoked',
      reasonCode: 'governance_appeal_revoke',
      actorPubkey: null,
      sourceReceiptId: null,
      occurredAt: input.now,
    });
    const released = await tx.post.updateMany({
      where: {
        contentId: payload.contentId,
        circleId: payload.circleId,
        downranked: true,
        downrankOperationReceiptId: payload.originalReceiptId,
        downrankOperationEffectId: payload.operationEffectId,
      },
      data: { downranked: false },
    });
    if (released.count !== 1) {
      throw appealError('content_visibility_downrank_appeal_release_failed');
    }
    effectApplied = true;
    resultingEffectState = 'revoked';
  } else if (accepted && post.downranked === true) {
    throw appealError('content_visibility_downrank_appeal_replay_mismatch');
  }
  const updated = await tx.governedActionAppeal.updateMany({
    where: {
      id: appeal.id,
      state: 'governance_case_pending',
      governanceCaseRef: input.governanceCase.id,
      resolvedAt: null,
    },
    data: {
      state: 'resolved',
      appealResolutionArtifactRef: artifactId,
      resolvedAt: input.now,
    },
  });
  if (updated.count !== 1) {
    throw appealError('content_visibility_downrank_appeal_resolution_cas_failed');
  }
  return { artifactId, resultingEffectState, effectApplied };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function appealError(code: string): Error {
  return Object.assign(new Error(code), { statusCode: 409 });
}
