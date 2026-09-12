import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  buildGovernanceInternalExecutionPlanArtifact,
  buildGovernanceManualExecutionPlanArtifact,
  buildNativeDecisionOutputArtifact,
  classifyAcceptedDecisionExecutionContract,
  decisionOutputArtifactMatches,
} from './decisionOutputArtifact';
import type { GovernedActionDefinition } from './actionRegistry';
import { resolveFrozenGovernedActionContractVersion } from './governedActionGatewayRuntime';
import {
  buildGovernanceMandateTerms,
  computeGovernanceMandateTermsDigest,
} from './circleGovernanceBindings';
import { computeGovernanceDecisionDigest } from './policyEngine';
import {
  extractGovernanceBriefClaims,
  resolveGovernanceBriefReadiness,
  type GovernanceBriefSectionKey,
} from './governanceBrief';
import { SOURCE_MATERIAL_GROUNDING_STATUSES } from '../sourceMaterials/lifecycle';
import { persistGovernanceCaseActionRequiredNotifications } from './governanceCaseActionNotifications';
import { buildExternalAppCircleBindingEffectDigest } from '../externalApps/circleBindings';
import { resolveDraftTitle } from '../draftLifecycle/draftTitle';
import { lockDraftWorkingCopyForSnapshot } from '../draftLifecycle/paragraphStructure';

export type GovernanceCasePhase =
  | 'intake'
  | 'proposal_drafting'
  | 'evidence_review'
  | 'ready_for_decision'
  | 'decision_in_progress'
  | 'execution_preparation'
  | 'execution_in_progress'
  | 'outcome_review'
  | 'closed'
  | 'archived';

export type GovernanceCaseResponsibilityKind =
  | 'coordinator'
  | 'review'
  | 'execution'
  | 'outcome';

export type GovernanceCaseResponsibilityStatus =
  | 'assigned'
  | 'accepted'
  | 'declined'
  | 'escalated'
  | 'absent';

export type GovernanceCaseResponsibilityAction =
  | 'accept'
  | 'decline'
  | 'reassign'
  | 'escalate'
  | 'absence'
  | 'extend_deadline'
  | 'cancel_deadline';

export type GovernanceCaseReviewConclusion =
  | 'changes_required'
  | 'signoff_granted'
  | 'signoff_denied'
  | 'abstained'
  | 'conflict_declared';

export type GovernanceCaseReviewRelationshipActorRole = 'reviewer' | 'proposer';
export type GovernanceCaseReviewRelationship =
  | 'none'
  | 'personal'
  | 'professional'
  | 'financial'
  | 'organizational'
  | 'other';

export interface GovernanceCaseActualOutcome {
  summary: string;
  quantitativeImpact: string[];
  deviations: string[];
  failures: string[];
  outstandingObligations: string[];
  observationPeriod: {
    startedAt: string;
    endedAt: string;
  };
  externalExecution?: GovernanceCaseExternalExecutionOutcome;
}

export interface GovernanceCaseExternalExecutionOutcome {
  factSource: 'authoritative_external_execution_projection';
  businessExecutionOwner: 'storage_fabric';
  actionType: 'storage_fabric.authorize_provider_admission';
  providerResourceRef: string;
  providerAdmissionReceiptRef: string;
  providerAdmissionReceiptDigest: string;
  providerStatus: 'experimental';
  settlementState: 'holdback_only';
  network: 'solana:devnet';
  projectionDigest: string;
  executedAt: string;
}

const STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE =
  'storage_fabric.authorize_provider_admission' as const;

export class GovernanceCaseWorkflowError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.name = 'GovernanceCaseWorkflowError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface GovernanceCaseBriefCandidate {
  draftPostId: number;
  title: string;
  documentStatus: string;
  draftVersion: number;
  snapshotDigest: string;
  snapshotCreatedAt: string;
  updatedAt: string;
  sectionReady: boolean;
  missingSectionKeys: GovernanceBriefSectionKey[];
}

export function initialGovernanceCaseWorkflowData(input: {
  caseId: string;
  phase: GovernanceCasePhase;
  coordinatorPubkey: string;
  openedAt: Date;
}): Record<string, unknown> {
  const coordinatorPubkey = requiredPubkey(input.coordinatorPubkey);
  const eventKey = workflowKey('case-opened', input.caseId, coordinatorPubkey);
  return {
    casePhase: input.phase,
    caseVersion: 1,
    responsibilities: {
      create: [{
        id: responsibilityId(input.caseId, 'coordinator'),
        kind: 'coordinator',
        assigneePubkey: coordinatorPubkey,
        status: 'accepted',
        version: 1,
        assignedByPubkey: coordinatorPubkey,
        assignedAt: input.openedAt,
        respondedAt: input.openedAt,
      }],
    },
    timelineEvents: {
      create: [{
        id: eventId(input.caseId, eventKey),
        eventType: 'case_opened',
        responsibilityKind: 'coordinator',
        actorPubkey: coordinatorPubkey,
        subjectPubkey: coordinatorPubkey,
        fromState: null,
        toState: input.phase,
        reason: null,
        idempotencyKey: eventKey,
        caseVersion: 1,
        responsibilityVersion: 1,
        createdAt: input.openedAt,
      }],
    },
  };
}

export async function listGovernanceCaseResponsibilityCandidates(
  prisma: any,
  circleId: number,
  executionScope?: { scopeType?: unknown; scopeRef?: unknown } | null,
): Promise<Array<{
  pubkey: string;
  handle: string;
  displayName: string | null;
  role: string;
  eligibleResponsibilityKinds: GovernanceCaseResponsibilityKind[];
}>> {
  const circleSelect = {
    creator: { select: { id: true, pubkey: true, handle: true, displayName: true } },
    members: {
      where: { status: 'Active' },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      select: {
        role: true,
        user: { select: { pubkey: true, handle: true, displayName: true } },
      },
    },
  };
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: circleSelect,
  });
  if (!circle) throw new GovernanceCaseWorkflowError(404, 'governance_case_home_not_found');
  const allKinds: GovernanceCaseResponsibilityKind[] = [
    'coordinator', 'review', 'execution', 'outcome',
  ];
  const candidates = new Map<string, {
    pubkey: string;
    handle: string;
    displayName: string | null;
    role: string;
    eligibleResponsibilityKinds: GovernanceCaseResponsibilityKind[];
  }>();
  candidates.set(circle.creator.pubkey, {
    pubkey: circle.creator.pubkey,
    handle: circle.creator.handle,
    displayName: circle.creator.displayName,
    role: 'Owner',
    eligibleResponsibilityKinds: allKinds,
  });
  for (const member of circle.members) {
    candidates.set(member.user.pubkey, {
      pubkey: member.user.pubkey,
      handle: member.user.handle,
      displayName: member.user.displayName,
      role: String(member.role),
      eligibleResponsibilityKinds: allKinds,
    });
  }
  const executionScopeCircleId = executionParticipantScopeCircleId(executionScope);
  if (executionScopeCircleId && executionScopeCircleId !== circleId) {
    const executionCircle = await prisma.circle.findUnique({
      where: { id: executionScopeCircleId },
      select: circleSelect,
    });
    if (executionCircle) {
      const addExecutionCandidate = (candidate: {
        pubkey: string;
        handle: string;
        displayName: string | null;
        role: string;
      }) => {
        if (candidates.has(candidate.pubkey)) return;
        candidates.set(candidate.pubkey, {
          ...candidate,
          role: `External execution · ${candidate.role}`,
          eligibleResponsibilityKinds: ['execution'],
        });
      };
      addExecutionCandidate({
        pubkey: executionCircle.creator.pubkey,
        handle: executionCircle.creator.handle,
        displayName: executionCircle.creator.displayName,
        role: 'Owner',
      });
      for (const member of executionCircle.members) {
        addExecutionCandidate({
          pubkey: member.user.pubkey,
          handle: member.user.handle,
          displayName: member.user.displayName,
          role: String(member.role),
        });
      }
    }
  }
  return Array.from(candidates.values());
}

export async function listGovernanceCaseBriefCandidates(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    canManage: boolean;
  },
): Promise<GovernanceCaseBriefCandidate[]> {
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const governanceCase = await prisma.governanceCase.findUnique({
    where: { id: input.caseId },
    include: {
      homeIdentityBinding: { select: { homeType: true, homeRef: true } },
      responsibilities: true,
    },
  });
  if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
  assertModernWorkflow(governanceCase);
  assertCanBindBrief(governanceCase, actorPubkey, input.canManage);
  const circleId = caseCircleId(governanceCase);
  const drafts = await prisma.post.findMany({
    where: { circleId, status: 'Draft' },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: { id: true, text: true, draftTitle: true, updatedAt: true },
  });
  if (drafts.length === 0) return [];
  const draftPostIds = drafts.map((draft: any) => Number(draft.id));
  const workflowStates = await prisma.draftWorkflowState.findMany({
    where: { draftPostId: { in: draftPostIds } },
    select: { draftPostId: true, currentSnapshotVersion: true, documentStatus: true },
  });
  const workflowByDraft = new Map<number, any>(
    workflowStates.map((state: any) => [Number(state.draftPostId), state]),
  );
  const currentSnapshotKeys = workflowStates
    .filter((state: any) => (
      Number.isInteger(state.currentSnapshotVersion) && state.currentSnapshotVersion > 0
    ))
    .map((state: any) => ({
      draftPostId: Number(state.draftPostId),
      draftVersion: Number(state.currentSnapshotVersion),
    }));
  if (currentSnapshotKeys.length === 0) return [];
  const snapshots = await prisma.draftVersionSnapshot.findMany({
    where: { OR: currentSnapshotKeys },
    select: {
      draftPostId: true,
      draftVersion: true,
      contentHash: true,
      contentSnapshot: true,
      createdAt: true,
    },
  });
  const snapshotByKey = new Map<string, any>(
    snapshots.map((snapshot: any) => [
      briefSnapshotKey(Number(snapshot.draftPostId), Number(snapshot.draftVersion)),
      snapshot,
    ]),
  );
  return drafts.flatMap((draft: any) => {
    const state = workflowByDraft.get(Number(draft.id));
    if (!state || !Number.isInteger(state.currentSnapshotVersion) || state.currentSnapshotVersion <= 0) {
      return [];
    }
    const snapshot = snapshotByKey.get(briefSnapshotKey(Number(draft.id), state.currentSnapshotVersion));
    if (!snapshot || !isDigest(snapshot.contentHash)) return [];
    const readiness = resolveGovernanceBriefReadiness({
      contentSnapshot: String(snapshot.contentSnapshot || ''),
    });
    return [{
      draftPostId: Number(draft.id),
      title: resolveDraftTitle({
        draftTitle: draft.draftTitle,
        text: draft.text,
        draftPostId: Number(draft.id),
      }),
      documentStatus: String(state.documentStatus ?? 'drafting'),
      draftVersion: Number(snapshot.draftVersion),
      snapshotDigest: String(snapshot.contentHash),
      snapshotCreatedAt: new Date(snapshot.createdAt).toISOString(),
      updatedAt: new Date(draft.updatedAt).toISOString(),
      sectionReady: readiness.sectionReady,
      missingSectionKeys: readiness.missingSectionKeys,
    }];
  });
}

export async function bindGovernanceCaseBrief(
  prisma: any,
  input: {
    caseId: string;
    draftPostId: number;
    actorPubkey: string;
    canManage: boolean;
    idempotencyKey: string;
    expectedCaseVersion: number;
    nativeRequestId?: string | null;
    expectedDraftVersion?: number | null;
    expectedSnapshotDigest?: string | null;
    now?: Date;
  },
): Promise<{
  governanceCase: any;
  binding: {
    draftPostId: number;
    draftVersion: number;
    snapshotDigest: string;
    boundByPubkey: string;
    boundAt: Date;
  };
  replayed: boolean;
}> {
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_case_idempotency_key_required');
  if (!Number.isSafeInteger(input.draftPostId) || input.draftPostId <= 0) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_brief_draft_invalid');
  }
  const expectedDraftVersionSupplied = input.expectedDraftVersion != null;
  const expectedSnapshotDigestSupplied = input.expectedSnapshotDigest != null;
  const exactCandidateBinding = expectedDraftVersionSupplied && expectedSnapshotDigestSupplied;
  if (
    expectedDraftVersionSupplied !== expectedSnapshotDigestSupplied
    || (exactCandidateBinding && (
      !Number.isSafeInteger(input.expectedDraftVersion)
      || Number(input.expectedDraftVersion) <= 0
      || !isDigest(input.expectedSnapshotDigest)
    ))
  ) {
    throw new GovernanceCaseWorkflowError(
      input.nativeRequestId != null ? 409 : 400,
      input.nativeRequestId != null
        ? 'governance_case_native_draft_origin_mismatch'
        : 'governance_case_brief_candidate_invalid',
    );
  }
  const now = input.now ?? new Date();
  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: {
        homeIdentityBinding: { select: { homeType: true, homeRef: true } },
        primaryRequest: true,
        responsibilities: true,
      },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    assertModernWorkflow(governanceCase);
    assertCanBindBrief(governanceCase, actorPubkey, input.canManage);
    const nativeRequestBinding = input.nativeRequestId != null;
    if (nativeRequestBinding) {
      const payload = governanceCase.primaryRequest?.payload;
      if (
        !input.nativeRequestId
        || !Number.isSafeInteger(input.expectedDraftVersion)
        || !isDigest(input.expectedSnapshotDigest)
        || governanceCase.originKind !== 'native_invocation'
        || governanceCase.primaryRequestId !== input.nativeRequestId
        || governanceCase.primaryRequest?.id !== input.nativeRequestId
        || Number(payload?.draftPostId) !== input.draftPostId
        || Number(payload?.draftVersion) !== input.expectedDraftVersion
      ) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_native_draft_origin_mismatch');
      }
    }
    const replay = await tx.governanceCaseTimelineEvent.findFirst({
      where: { caseId: input.caseId, idempotencyKey },
    });
    if (replay) {
      if (
        replay.eventType !== 'brief_snapshot_bound'
        || replay.actorPubkey !== actorPubkey
        || Number(replay.briefDraftPostId) !== input.draftPostId
        || !Number.isInteger(replay.briefDraftVersion)
        || !isDigest(replay.briefSnapshotDigest)
        || (exactCandidateBinding && (
          Number(replay.briefDraftVersion) !== input.expectedDraftVersion
          || replay.briefSnapshotDigest !== input.expectedSnapshotDigest
        ))
      ) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
      }
      return {
        governanceCase: {
          ...governanceCase,
          caseVersion: replay.caseVersion,
        },
        binding: {
          draftPostId: Number(replay.briefDraftPostId),
          draftVersion: Number(replay.briefDraftVersion),
          snapshotDigest: String(replay.briefSnapshotDigest),
          boundByPubkey: actorPubkey,
          boundAt: new Date(replay.createdAt),
        },
        replayed: true,
      };
    }
    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    if (
      !['intake', 'proposal_drafting', 'evidence_review'].includes(governanceCase.casePhase)
      && !(nativeRequestBinding
        && governanceCase.casePhase === 'decision_in_progress'
        && governanceCase.briefDraftPostId == null
        && governanceCase.briefDraftVersion == null
        && governanceCase.briefSnapshotDigest == null)
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_binding_unavailable');
    }
    const circleId = caseCircleId(governanceCase);
    // Review snapshot materialization takes the same Post row lock. This makes
    // the exact candidate check and Case CAS observe one ordered Draft version.
    await lockDraftWorkingCopyForSnapshot(tx, input.draftPostId);
    const draft = await tx.post.findUnique({
      where: { id: input.draftPostId },
      select: { id: true, circleId: true, status: true },
    });
    if (!draft || draft.circleId !== circleId || draft.status !== 'Draft') {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_draft_invalid');
    }
    const workflow = await tx.draftWorkflowState.findUnique({
      where: { draftPostId: input.draftPostId },
      select: { currentSnapshotVersion: true, documentStatus: true },
    });
    if (workflow?.documentStatus !== 'review') {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_draft_not_in_review');
    }
    const draftVersion = Number(workflow?.currentSnapshotVersion ?? 0);
    if (!Number.isInteger(draftVersion) || draftVersion <= 0) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_required');
    }
    const snapshot = await tx.draftVersionSnapshot.findUnique({
      where: {
        draftPostId_draftVersion: {
          draftPostId: input.draftPostId,
          draftVersion,
        },
      },
      select: { contentHash: true },
    });
    if (!snapshot || !isDigest(snapshot.contentHash)) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_required');
    }
    if (
      nativeRequestBinding
      && (draftVersion !== input.expectedDraftVersion
        || snapshot.contentHash !== input.expectedSnapshotDigest)
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_native_draft_origin_mismatch');
    }
    if (
      exactCandidateBinding
      && (draftVersion !== input.expectedDraftVersion
        || snapshot.contentHash !== input.expectedSnapshotDigest)
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_candidate_stale');
    }
    if (
      governanceCase.briefDraftPostId === input.draftPostId
      && governanceCase.briefDraftVersion === draftVersion
      && governanceCase.briefSnapshotDigest === snapshot.contentHash
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_already_bound');
    }
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const returnsToDrafting = governanceCase.casePhase === 'evidence_review';
    const updated = await tx.governanceCase.updateMany({
      where: { id: input.caseId, caseVersion: input.expectedCaseVersion },
      data: {
        briefDraftPostId: input.draftPostId,
        briefDraftVersion: draftVersion,
        briefSnapshotDigest: snapshot.contentHash,
        briefBoundByPubkey: actorPubkey,
        briefBoundAt: now,
        ...(returnsToDrafting ? { casePhase: 'proposal_drafting' } : {}),
        caseVersion: nextCaseVersion,
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    await tx.governanceCaseTimelineEvent.create({
      data: {
        id: eventId(input.caseId, idempotencyKey),
        caseId: input.caseId,
        eventType: 'brief_snapshot_bound',
        responsibilityKind: null,
        actorPubkey,
        subjectPubkey: null,
        fromState: returnsToDrafting ? 'evidence_review' : null,
        toState: returnsToDrafting ? 'proposal_drafting' : null,
        reason: returnsToDrafting ? 'brief_snapshot_changed' : null,
        idempotencyKey,
        caseVersion: nextCaseVersion,
        responsibilityVersion: null,
        briefDraftPostId: input.draftPostId,
        briefDraftVersion: draftVersion,
        briefSnapshotDigest: snapshot.contentHash,
        createdAt: now,
      },
    });
    return {
      governanceCase: {
        ...governanceCase,
        briefDraftPostId: input.draftPostId,
        briefDraftVersion: draftVersion,
        briefSnapshotDigest: snapshot.contentHash,
        briefBoundByPubkey: actorPubkey,
        briefBoundAt: now,
        casePhase: returnsToDrafting ? 'proposal_drafting' : governanceCase.casePhase,
        caseVersion: nextCaseVersion,
      },
      binding: {
        draftPostId: input.draftPostId,
        draftVersion,
        snapshotDigest: snapshot.contentHash,
        boundByPubkey: actorPubkey,
        boundAt: now,
      },
      replayed: false,
    };
  });
}

export async function bindGovernanceCaseBriefClaimEvidence(
  prisma: any,
  input: {
    caseId: string;
    claimId: string;
    sourceMaterialId: number;
    sourceMaterialChunkId: number;
    actorPubkey: string;
    canManage: boolean;
    idempotencyKey: string;
    expectedCaseVersion: number;
    now?: Date;
  },
): Promise<{ governanceCase: any; binding: Record<string, unknown>; replayed: boolean }> {
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const claimId = requiredText(input.claimId, 16, 96, 'governance_case_brief_claim_id_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_case_idempotency_key_required');
  if (!Number.isSafeInteger(input.sourceMaterialId) || input.sourceMaterialId <= 0
    || !Number.isSafeInteger(input.sourceMaterialChunkId) || input.sourceMaterialChunkId <= 0) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_brief_evidence_source_invalid');
  }
  const now = input.now ?? new Date();
  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: {
        homeIdentityBinding: { select: { homeType: true, homeRef: true } },
        responsibilities: true,
      },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    assertModernWorkflow(governanceCase);
    assertCanBindBrief(governanceCase, actorPubkey, input.canManage);
    if (governanceCase.casePhase !== 'proposal_drafting') {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_evidence_binding_unavailable');
    }
    if (
      !Number.isSafeInteger(governanceCase.briefDraftPostId)
      || !Number.isSafeInteger(governanceCase.briefDraftVersion)
      || !isDigest(governanceCase.briefSnapshotDigest)
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_required');
    }
    const replay = await tx.governanceCaseTimelineEvent.findFirst({
      where: { caseId: input.caseId, idempotencyKey },
    });
    if (replay) {
      if (
        replay.eventType !== 'brief_claim_evidence_bound'
        || replay.actorPubkey !== actorPubkey
        || replay.briefDraftPostId !== governanceCase.briefDraftPostId
        || replay.briefDraftVersion !== governanceCase.briefDraftVersion
        || replay.briefSnapshotDigest !== governanceCase.briefSnapshotDigest
        || replay.claimId !== claimId
        || replay.sourceMaterialId !== input.sourceMaterialId
        || replay.sourceMaterialChunkId !== input.sourceMaterialChunkId
      ) throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
      return { governanceCase: { ...governanceCase, caseVersion: replay.caseVersion }, binding: replay, replayed: true };
    }
    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    const snapshot = await tx.draftVersionSnapshot.findUnique({
      where: {
        draftPostId_draftVersion: {
          draftPostId: governanceCase.briefDraftPostId,
          draftVersion: governanceCase.briefDraftVersion,
        },
      },
      select: { contentSnapshot: true, contentHash: true, createdAt: true },
    });
    if (!snapshot || snapshot.contentHash !== governanceCase.briefSnapshotDigest) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_mismatch');
    }
    const claim = extractGovernanceBriefClaims({
      snapshotDigest: snapshot.contentHash,
      contentSnapshot: snapshot.contentSnapshot,
    }).find((candidate) => candidate.id === claimId);
    if (!claim) throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_claim_not_found');
    const circleId = caseCircleId(governanceCase);
    const sourceMaterial = await tx.sourceMaterial.findFirst({
      where: {
        id: input.sourceMaterialId,
        circleId,
        draftPostId: governanceCase.briefDraftPostId,
        createdAt: { lte: snapshot.createdAt },
        lifecycleStatus: { in: SOURCE_MATERIAL_GROUNDING_STATUSES },
        evidencePrivacyClass: input.canManage
          ? { notIn: ['sealed', 'redacted'] }
          : { notIn: ['reviewer_only', 'sealed', 'redacted'] },
      },
      select: {
        id: true,
        contentDigest: true,
        chunks: {
          where: { id: input.sourceMaterialChunkId },
          select: { id: true, textDigest: true },
        },
      },
    });
    const chunk = sourceMaterial?.chunks?.[0];
    if (!sourceMaterial || !chunk || !isDigest(sourceMaterial.contentDigest) || !isDigest(chunk.textDigest)) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_evidence_source_unavailable');
    }
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const updated = await tx.governanceCase.updateMany({
      where: { id: input.caseId, caseVersion: input.expectedCaseVersion },
      data: { caseVersion: nextCaseVersion },
    });
    if (updated.count !== 1) throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    const binding = await tx.governanceCaseTimelineEvent.create({
      data: {
        id: eventId(input.caseId, idempotencyKey),
        caseId: input.caseId,
        eventType: 'brief_claim_evidence_bound',
        responsibilityKind: null,
        actorPubkey,
        subjectPubkey: null,
        fromState: 'proposal_drafting',
        toState: 'proposal_drafting',
        reason: null,
        idempotencyKey,
        caseVersion: nextCaseVersion,
        responsibilityVersion: null,
        briefDraftPostId: governanceCase.briefDraftPostId,
        briefDraftVersion: governanceCase.briefDraftVersion,
        briefSnapshotDigest: governanceCase.briefSnapshotDigest,
        reviewPublicBasis: null,
        claimId: claim.id,
        claimSection: claim.sectionKey,
        claimDigest: claim.digest,
        sourceMaterialId: sourceMaterial.id,
        sourceMaterialDigest: sourceMaterial.contentDigest,
        sourceMaterialChunkId: chunk.id,
        sourceMaterialChunkDigest: chunk.textDigest,
        createdAt: now,
      },
    });
    return {
      governanceCase: { ...governanceCase, caseVersion: nextCaseVersion },
      binding,
      replayed: false,
    };
  });
}

export async function changeGovernanceCaseResponsibility(
  prisma: any,
  input: {
    caseId: string;
    kind: GovernanceCaseResponsibilityKind;
    action: GovernanceCaseResponsibilityAction;
    actorPubkey: string;
    targetPubkey?: string | null;
    reason?: string | null;
    deadlineAt?: string | null;
    idempotencyKey: string;
    expectedCaseVersion: number;
    expectedResponsibilityVersion: number;
    canManage: boolean;
    now?: Date;
  },
): Promise<{ governanceCase: any; responsibility: any; replayed: boolean }> {
  assertResponsibilityKind(input.kind);
  assertResponsibilityAction(input.action);
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_case_idempotency_key_required');
  const reason = optionalReason(input.reason, input.action);
  const targetPubkey = input.action === 'reassign'
    ? requiredPubkey(input.targetPubkey)
    : null;
  const now = input.now ?? new Date();

  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: {
        homeIdentityBinding: { select: { homeType: true, homeRef: true } },
        primaryRequest: { select: { scopeType: true, scopeRef: true } },
        responsibilities: true,
      },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    assertModernWorkflow(governanceCase);

    const eventType = `responsibility_${input.action === 'absence' ? 'absent' : input.action}`;
    const replay = await tx.governanceCaseTimelineEvent.findFirst({
      where: { caseId: input.caseId, idempotencyKey },
    });
    const current = governanceCase.responsibilities.find((item: any) => item.kind === input.kind) ?? null;
    if (replay) {
      assertMatchingReplay(replay, {
        eventType,
        kind: input.kind,
        actorPubkey,
        subjectPubkey: targetPubkey ?? replay.subjectPubkey ?? null,
        reason,
      });
      assertResponsibilityReplayDeadline(
        input.deadlineAt,
        input.action,
        replay.responsibilityDeadlineAt,
      );
      if (!current) throw new GovernanceCaseWorkflowError(409, 'governance_case_workflow_replay_corrupt');
      return { governanceCase, responsibility: current, replayed: true };
    }
    if (governanceCase.casePhase === 'closed' || governanceCase.casePhase === 'archived') {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_case_terminal');
    }
    const responsibilityDeadlineAt = resolveResponsibilityDeadline(
      input.deadlineAt,
      input.action,
      current?.deadlineAt ?? null,
      now,
    );

    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    if ((current?.version ?? 0) !== input.expectedResponsibilityVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_version_conflict');
    }
    if (input.kind === 'review') assertReviewPolicy(governanceCase);

    let nextAssignee = current?.assigneePubkey ?? actorPubkey;
    let nextStatus: GovernanceCaseResponsibilityStatus;
    if (input.action === 'reassign') {
      if (!input.canManage && current?.assigneePubkey !== actorPubkey) {
        throw new GovernanceCaseWorkflowError(403, 'governance_case_responsibility_manage_denied');
      }
      await assertActiveResponsibilityCandidate(tx, governanceCase, input.kind, targetPubkey!);
      nextAssignee = targetPubkey!;
      nextStatus = targetPubkey === actorPubkey ? 'accepted' : 'assigned';
    } else if (input.action === 'extend_deadline' || input.action === 'cancel_deadline') {
      if (!current) throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_required');
      if (!input.canManage) {
        throw new GovernanceCaseWorkflowError(403, 'governance_case_responsibility_deadline_manage_denied');
      }
      nextStatus = current.status as GovernanceCaseResponsibilityStatus;
    } else {
      if (!current) throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_required');
      if (current.assigneePubkey !== actorPubkey) {
        throw new GovernanceCaseWorkflowError(403, 'governance_case_responsibility_actor_denied');
      }
      nextStatus = nextStatusForAction(input.action, current.status);
    }

    const nextCaseVersion = governanceCase.caseVersion + 1;
    const nextResponsibilityVersion = (current?.version ?? 0) + 1;
    const priorResponsibilityStatus = current?.status ?? null;
    const priorResponsibilityDeadlineAt = current?.deadlineAt == null
      ? null
      : new Date(requiredIsoTimestamp(
          current.deadlineAt instanceof Date
            ? current.deadlineAt.toISOString()
            : String(current.deadlineAt),
          'governance_case_responsibility_deadline_invalid',
        ));
    const caseUpdated = await tx.governanceCase.updateMany({
      where: { id: input.caseId, caseVersion: input.expectedCaseVersion },
      data: { caseVersion: nextCaseVersion },
    });
    if (caseUpdated.count !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }

    const responsibility = current
      ? await updateResponsibility(tx, current, {
          expectedVersion: input.expectedResponsibilityVersion,
          assigneePubkey: nextAssignee,
          status: nextStatus,
          actorPubkey,
          reason,
          deadlineAt: responsibilityDeadlineAt,
          now,
          resetAssignment: input.action === 'reassign',
        })
      : await tx.governanceCaseResponsibility.create({
          data: {
            id: responsibilityId(input.caseId, input.kind),
            caseId: input.caseId,
            kind: input.kind,
            assigneePubkey: nextAssignee,
            status: nextStatus,
            version: nextResponsibilityVersion,
            assignedByPubkey: actorPubkey,
            assignedAt: now,
            deadlineAt: responsibilityDeadlineAt,
            respondedAt: nextStatus === 'accepted' ? now : null,
            reason,
          },
        });

    const deadlineAction = input.action === 'extend_deadline' || input.action === 'cancel_deadline';
    await tx.governanceCaseTimelineEvent.create({
      data: {
        id: eventId(input.caseId, idempotencyKey),
        caseId: input.caseId,
        eventType,
        responsibilityKind: input.kind,
        actorPubkey,
        subjectPubkey: nextAssignee,
        fromState: deadlineAction
          ? priorResponsibilityDeadlineAt?.toISOString() ?? null
          : priorResponsibilityStatus,
        toState: input.action === 'cancel_deadline'
          ? 'cancelled'
          : input.action === 'extend_deadline'
            ? responsibilityDeadlineAt?.toISOString() ?? null
            : nextStatus,
        reason,
        idempotencyKey,
        caseVersion: nextCaseVersion,
        responsibilityVersion: nextResponsibilityVersion,
        responsibilityDeadlineAt,
        createdAt: now,
      },
    });
    const notificationAction = input.kind === 'review'
      ? 'review' as const
      : input.kind === 'execution'
        ? 'sign' as const
        : input.kind === 'outcome'
          ? 'record_outcome' as const
          : null;
    if (input.action === 'reassign' && notificationAction) {
      await persistGovernanceCaseActionRequiredNotifications(tx, {
        caseId: governanceCase.id,
        circleId: Number(governanceCase.homeIdentityBinding.homeRef),
        action: notificationAction,
        recipientPubkeys: [nextAssignee],
        sourceVersion: `responsibility:${input.kind}:v${nextResponsibilityVersion}`,
        createdAt: now,
      });
    }
    return {
      governanceCase: { ...governanceCase, caseVersion: nextCaseVersion },
      responsibility,
      replayed: false,
    };
  });
}

export async function transitionGovernanceCasePhase(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    toPhase: 'proposal_drafting' | 'evidence_review' | 'closed';
    idempotencyKey: string;
    expectedCaseVersion: number;
    actualOutcome?: unknown;
    now?: Date;
  },
): Promise<{ governanceCase: any; replayed: boolean }> {
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_case_idempotency_key_required');
  if (
    input.toPhase !== 'proposal_drafting'
    && input.toPhase !== 'evidence_review'
    && input.toPhase !== 'closed'
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_transition_unavailable');
  }
  const now = input.now ?? new Date();
  if (input.toPhase !== 'closed' && input.actualOutcome != null) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_actual_outcome_close_only');
  }
  const submittedActualOutcome = input.toPhase === 'closed'
    ? normalizeGovernanceCaseActualOutcome(input.actualOutcome, { allowExternalExecution: false })
    : null;
  if (
    submittedActualOutcome
    && new Date(submittedActualOutcome.observationPeriod.endedAt).getTime() > now.getTime()
  ) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_actual_outcome_period_in_future');
  }
  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: {
        responsibilities: true,
        briefSnapshot: true,
        primaryRequest: { include: { decision: true, receipts: true } },
        manualExecutionCompletion: true,
        actionContractVersion: true,
        decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
      },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    assertModernWorkflow(governanceCase);
    const eventType = input.toPhase === 'closed' ? 'case_closed' : 'case_phase_changed';
    const responsibilityKind = input.toPhase === 'closed' ? 'outcome' : null;
    const eventReason = input.toPhase === 'closed' ? 'knowledge_publication_not_requested' : null;
    const externalExecution = input.toPhase === 'closed'
      ? deriveProviderAdmissionExternalExecution(governanceCase)
      : null;
    const actualOutcome = submittedActualOutcome
      ? Object.freeze({
          ...submittedActualOutcome,
          ...(externalExecution ? { externalExecution } : {}),
        })
      : null;
    const actualOutcomeDigest = actualOutcome
      ? governanceCaseActualOutcomeDigest(actualOutcome)
      : null;
    const replay = await tx.governanceCaseTimelineEvent.findFirst({
      where: { caseId: input.caseId, idempotencyKey },
    });
    if (replay) {
      assertMatchingReplay(replay, {
        eventType,
        kind: responsibilityKind,
        actorPubkey,
        subjectPubkey: null,
        reason: eventReason,
      });
      if (replay.toState !== input.toPhase) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
      }
      if (actualOutcome) {
        assertPersistedGovernanceCaseActualOutcome(
          governanceCase,
          actualOutcomeDigest!,
          actorPubkey,
        );
      }
      return { governanceCase, replayed: true };
    }
    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    const expectedFromPhase = input.toPhase === 'proposal_drafting'
      ? 'intake'
      : input.toPhase === 'evidence_review'
        ? 'proposal_drafting'
        : 'outcome_review';
    if (governanceCase.casePhase !== expectedFromPhase) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_transition_invalid');
    }
    if (
      input.toPhase === 'proposal_drafting'
      && governanceCase.templateSelection?.readinessState !== 'ready'
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_template_not_ready');
    }
    const coordinator = governanceCase.responsibilities.find((item: any) => item.kind === 'coordinator');
    if (input.toPhase === 'closed') {
      await assertGovernanceCaseCloseReady(tx, governanceCase, actorPubkey, now);
    } else {
      if (!coordinator || coordinator.status !== 'accepted') {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_coordinator_not_ready');
      }
      if (coordinator.assigneePubkey !== actorPubkey) {
        throw new GovernanceCaseWorkflowError(403, 'governance_case_coordinator_required');
      }
    }
    if (input.toPhase === 'evidence_review') {
      const briefSnapshot = governanceCase.briefSnapshot;
      if (
        !briefSnapshot
        || Number(briefSnapshot.draftPostId) !== Number(governanceCase.briefDraftPostId)
        || Number(briefSnapshot.draftVersion) !== Number(governanceCase.briefDraftVersion)
        || String(briefSnapshot.contentHash) !== String(governanceCase.briefSnapshotDigest)
      ) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_required');
      }
      const readiness = resolveGovernanceBriefReadiness({
        contentSnapshot: String(briefSnapshot.contentSnapshot || ''),
        ownerPubkey: coordinator.assigneePubkey,
      });
      if (!readiness.sectionReady) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_sections_incomplete');
      }
      const draftWorkflow = await tx.draftWorkflowState.findUnique({
        where: { draftPostId: Number(governanceCase.briefDraftPostId) },
        select: { documentStatus: true, currentSnapshotVersion: true },
      });
      if (
        draftWorkflow?.documentStatus !== 'review'
        || Number(draftWorkflow.currentSnapshotVersion) !== Number(governanceCase.briefDraftVersion)
      ) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_review_snapshot_not_current');
      }
    }
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const updated = await tx.governanceCase.updateMany({
      where: {
        id: input.caseId,
        caseVersion: input.expectedCaseVersion,
        casePhase: expectedFromPhase,
      },
      data: {
        casePhase: input.toPhase,
        caseVersion: nextCaseVersion,
        ...(actualOutcome ? {
          actualOutcome,
          actualOutcomeDigest,
          outcomeRecordedByPubkey: actorPubkey,
          outcomeRecordedAt: now,
        } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    await tx.governanceCaseTimelineEvent.create({
      data: {
        id: eventId(input.caseId, idempotencyKey),
        caseId: input.caseId,
        eventType,
        responsibilityKind,
        actorPubkey,
        subjectPubkey: null,
        fromState: expectedFromPhase,
        toState: input.toPhase,
        reason: eventReason,
        idempotencyKey,
        caseVersion: nextCaseVersion,
        responsibilityVersion: input.toPhase === 'closed'
          ? governanceCase.responsibilities.find((item: any) => item.kind === 'outcome')?.version ?? null
          : null,
        createdAt: now,
      },
    });
    return {
      governanceCase: {
        ...governanceCase,
        casePhase: input.toPhase,
        caseVersion: nextCaseVersion,
        ...(actualOutcome ? {
          actualOutcome,
          actualOutcomeDigest,
          outcomeRecordedByPubkey: actorPubkey,
          outcomeRecordedAt: now,
        } : {}),
      },
      replayed: false,
    };
  });
}

export function normalizeGovernanceCaseActualOutcome(
  value: unknown,
  options: { allowExternalExecution?: boolean } = {},
): GovernanceCaseActualOutcome {
  const hasExternalExecution = Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'externalExecution'),
  );
  if (hasExternalExecution && options.allowExternalExecution === false) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_external_execution_server_owned');
  }
  assertExactObjectKeys(value, [
    'deviations',
    ...(hasExternalExecution ? ['externalExecution'] : []),
    'failures',
    'observationPeriod',
    'outstandingObligations',
    'quantitativeImpact',
    'summary',
  ], 'governance_case_actual_outcome_invalid');
  const record = value as Record<string, unknown>;
  assertExactObjectKeys(record.observationPeriod, ['endedAt', 'startedAt'], 'governance_case_actual_outcome_period_invalid');
  const period = record.observationPeriod as Record<string, unknown>;
  const startedAt = requiredIsoTimestamp(period.startedAt, 'governance_case_actual_outcome_period_invalid');
  const endedAt = requiredIsoTimestamp(period.endedAt, 'governance_case_actual_outcome_period_invalid');
  if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_actual_outcome_period_invalid');
  }
  const externalExecution = hasExternalExecution
    ? normalizeGovernanceCaseExternalExecution(record.externalExecution)
    : null;
  return Object.freeze({
    summary: requiredText(record.summary, 3, 2000, 'governance_case_actual_outcome_summary_required'),
    quantitativeImpact: normalizedOutcomeList(record.quantitativeImpact, 'quantitative_impact'),
    deviations: normalizedOutcomeList(record.deviations, 'deviations'),
    failures: normalizedOutcomeList(record.failures, 'failures'),
    outstandingObligations: normalizedOutcomeList(record.outstandingObligations, 'outstanding_obligations'),
    observationPeriod: Object.freeze({ startedAt, endedAt }),
    ...(externalExecution ? { externalExecution } : {}),
  });
}

function normalizeGovernanceCaseExternalExecution(
  value: unknown,
): GovernanceCaseExternalExecutionOutcome {
  assertExactObjectKeys(value, [
    'actionType',
    'businessExecutionOwner',
    'executedAt',
    'factSource',
    'network',
    'projectionDigest',
    'providerAdmissionReceiptDigest',
    'providerAdmissionReceiptRef',
    'providerResourceRef',
    'providerStatus',
    'settlementState',
  ], 'governance_case_external_execution_invalid');
  const record = value as Record<string, unknown>;
  if (
    record.factSource !== 'authoritative_external_execution_projection'
    || record.businessExecutionOwner !== 'storage_fabric'
    || record.actionType !== STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
    || record.providerStatus !== 'experimental'
    || record.settlementState !== 'holdback_only'
    || record.network !== 'solana:devnet'
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_external_execution_invalid');
  }
  return Object.freeze({
    factSource: 'authoritative_external_execution_projection',
    businessExecutionOwner: 'storage_fabric',
    actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
    providerResourceRef: requiredText(
      record.providerResourceRef,
      1,
      256,
      'governance_case_external_execution_invalid',
    ),
    providerAdmissionReceiptRef: requiredText(
      record.providerAdmissionReceiptRef,
      1,
      256,
      'governance_case_external_execution_invalid',
    ),
    providerAdmissionReceiptDigest: requiredExternalExecutionDigest(
      record.providerAdmissionReceiptDigest,
    ),
    providerStatus: 'experimental',
    settlementState: 'holdback_only',
    network: 'solana:devnet',
    projectionDigest: requiredExternalExecutionDigest(record.projectionDigest),
    executedAt: requiredIsoTimestamp(
      record.executedAt,
      'governance_case_external_execution_invalid',
    ),
  });
}

function requiredExternalExecutionDigest(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_external_execution_invalid');
  }
  return normalized;
}

export function governanceCaseActualOutcomeDigest(value: GovernanceCaseActualOutcome): string {
  return hashCanonicalGovernanceValue('alcheme.governance.case-actual-outcome', value);
}

function assertPersistedGovernanceCaseActualOutcome(
  governanceCase: any,
  expectedDigest: string,
  actorPubkey: string,
): void {
  let persisted: GovernanceCaseActualOutcome;
  try {
    persisted = normalizeGovernanceCaseActualOutcome(governanceCase.actualOutcome);
  } catch {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_actual_outcome_record_mismatch');
  }
  if (
    governanceCaseActualOutcomeDigest(persisted) !== expectedDigest
    || governanceCase.actualOutcomeDigest !== expectedDigest
    || governanceCase.outcomeRecordedByPubkey !== actorPubkey
    || !governanceCase.outcomeRecordedAt
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_actual_outcome_record_mismatch');
  }
}

async function assertGovernanceCaseCloseReady(
  prisma: any,
  governanceCase: any,
  actorPubkey: string,
  now: Date,
): Promise<void> {
  const outcome = governanceCase.responsibilities.find((item: any) => item.kind === 'outcome');
  if (!outcome || outcome.status !== 'accepted') {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_outcome_reviewer_not_ready');
  }
  if (outcome.assigneePubkey !== actorPubkey) {
    throw new GovernanceCaseWorkflowError(403, 'governance_case_outcome_reviewer_required');
  }
  assertGovernanceCaseOutcomeSignoffPolicy(governanceCase, actorPubkey);
  const request = governanceCase.primaryRequest;
  const decision = request?.decision;
  if (
    !request
    || request.id !== governanceCase.primaryRequestId
    || request.executionMode !== 'stage_decision_only'
    || !decision
    || decision.requestId !== request.id
    || !['accepted', 'rejected', 'expired', 'cancelled'].includes(decision.decision)
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_durable_decision_record_required');
  }
  const approvalStage = governanceCase.decisionStagePlan?.stages?.find(
    (stage: any) => stage.purpose === 'approval',
  );
  const expectedOutcome = decision.decision === 'expired' && approvalStage?.onExpire === 'reject_case'
    ? 'rejected'
    : decision.decision;
  if (governanceCase.decisionOutcome !== expectedOutcome || request.state !== decision.decision) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_durable_decision_record_mismatch');
  }
  const artifacts = Array.isArray(governanceCase.decisionOutputArtifacts)
    ? governanceCase.decisionOutputArtifacts
    : [];
  const frozenDefinition = await resolveGovernanceCaseCloseActionDefinition(
    prisma,
    governanceCase,
    request,
  );
  const isProviderAdmission = request.actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
    && frozenDefinition?.actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE;
  const artifact = artifacts.length === 1 ? artifacts[0] : null;
  const executionContract = classifyAcceptedDecisionExecutionContract({
    decision: decision.decision,
    decisionRequestId: request.id,
    decisionDigest: decision.decisionDigest,
    artifacts,
  });
  const isManualExecutionArtifact = expectedOutcome === 'accepted'
    && executionContract === 'manual';
  const isInternalExecutionArtifact = expectedOutcome === 'accepted'
    && artifact?.kind === 'internal_execution_plan'
    && artifact?.schemaRef === 'alcheme.governance.output.internal_execution_plan';
  const requiresInternalBindingEffect = expectedOutcome === 'accepted'
    && (
      frozenDefinition?.actionType === 'circle.governance_binding.create'
      || frozenDefinition?.actionType === 'external_app_primary_circle_bind'
    );
  let internalDefinition: GovernedActionDefinition | null = null;
  let internalReceipt: any | null = null;
  if (requiresInternalBindingEffect) {
    if (!isInternalExecutionArtifact) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_artifact_required');
    }
    internalDefinition = frozenDefinition!;
    internalReceipt = frozenDefinition!.actionType === 'external_app_primary_circle_bind'
      ? await assertExternalAppPrimaryCircleBindExecutionReady(
        prisma,
        governanceCase,
        internalDefinition,
      )
      : await assertGovernanceCaseInternalExecutionReady(
        prisma,
        governanceCase,
        internalDefinition,
        now,
      );
  } else if (isInternalExecutionArtifact) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_internal_execution_effect_readback_required',
    );
  }
  if (expectedOutcome === 'accepted') {
    if (artifacts.length !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_durable_artifact_record_required');
    }
    if (isManualExecutionArtifact) {
      assertGovernanceCaseControlledManualExecutionReady(
        governanceCase,
        request,
        artifact,
      );
    } else {
      let expectedArtifact;
      try {
        if (internalReceipt) {
          expectedArtifact = buildGovernanceInternalExecutionPlanArtifact({
            caseId: governanceCase.id,
            subjectType: governanceCase.subjectType,
            subjectRef: governanceCase.subjectRef,
            decisionRequestId: request.id,
            decisionDigest: decision.decisionDigest,
            actionType: request.actionType,
            targetType: request.targetType,
            targetRef: request.targetRef,
            actionPayload: request.payload,
            executorModule: internalDefinition!.executionAdapter,
            receipt: internalReceipt,
            createdAt: artifact!.createdAt,
          });
        } else {
          expectedArtifact = buildNativeDecisionOutputArtifact({
            caseId: governanceCase.id,
            caseType: governanceCase.caseType,
            subjectType: governanceCase.subjectType,
            subjectRef: governanceCase.subjectRef,
            decisionRequestId: request.id,
            decision: decision.decision,
            decisionDigest: decision.decisionDigest,
            briefDraftPostId: governanceCase.briefDraftPostId,
            briefDraftVersion: governanceCase.briefDraftVersion,
            briefSnapshotDigest: governanceCase.briefSnapshotDigest,
            mechanismKind: governanceCase.templateSelection?.decisionMechanism?.kind,
            decisionTally: decision.tally,
            selectionRanking: governanceCase.templateSelection?.selectionRanking,
            createdAt: artifact!.createdAt,
          });
        }
      } catch {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_durable_artifact_record_mismatch');
      }
      if (!decisionOutputArtifactMatches(artifact, expectedArtifact)) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_durable_artifact_record_mismatch');
      }
    }
  } else if (artifacts.length > 0) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_durable_artifact_terminal_conflict');
  }
  if (expectedOutcome === 'accepted' && isProviderAdmission) {
    deriveProviderAdmissionExternalExecution(governanceCase);
  } else if (
    !internalDefinition
    && !isManualExecutionArtifact
    && Array.isArray(request.receipts)
    && request.receipts.length > 0
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_no_op_receipt_conflict');
  }
}

function assertGovernanceCaseControlledManualExecutionReady(
  governanceCase: any,
  request: any,
  artifact: any,
): void {
  const execution = governanceCase.responsibilities.find(
    (item: any) => item.kind === 'execution',
  );
  const outcome = governanceCase.responsibilities.find(
    (item: any) => item.kind === 'outcome',
  );
  const deadlineAt = execution?.deadlineAt instanceof Date
    ? execution.deadlineAt
    : new Date(String(execution?.deadlineAt || ''));
  if (
    request.executionMode !== 'stage_decision_only'
    || execution?.status !== 'accepted'
    || outcome?.status !== 'accepted'
    || execution.assigneePubkey === outcome.assigneePubkey
    || !Number.isInteger(execution.version)
    || !Number.isInteger(outcome.version)
    || Number.isNaN(deadlineAt.getTime())
  ) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_manual_execution_responsibility_mismatch',
    );
  }
  let expectedArtifact;
  try {
    expectedArtifact = buildGovernanceManualExecutionPlanArtifact({
      caseId: governanceCase.id,
      subjectType: governanceCase.subjectType,
      subjectRef: governanceCase.subjectRef,
      decisionRequestId: request.id,
      decisionDigest: request.decision.decisionDigest,
      actionType: request.actionType,
      targetType: request.targetType,
      targetRef: request.targetRef,
      actionPayload: request.payload,
      assignee: {
        pubkey: execution.assigneePubkey,
        responsibilityVersion: execution.version,
        deadlineAt,
      },
      reviewer: {
        pubkey: outcome.assigneePubkey,
        responsibilityVersion: outcome.version,
      },
      createdAt: artifact.createdAt,
    });
  } catch {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_durable_artifact_record_mismatch',
    );
  }
  if (!decisionOutputArtifactMatches(artifact, expectedArtifact)) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_durable_artifact_record_mismatch',
    );
  }
  const completion = governanceCase.manualExecutionCompletion;
  const receipts = Array.isArray(request.receipts) ? request.receipts : [];
  if (
    completion?.status !== 'approved'
    || !completion.receiptId
    || receipts.length !== 1
  ) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_manual_execution_receipt_required',
    );
  }
  const evidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.manual-execution-completion-evidence',
    completion.evidence,
  );
  const receipt = receipts[0];
  const receiptEvidence = receipt?.executionEvidence;
  const receiptEvidenceDigest = receiptEvidence && typeof receiptEvidence === 'object'
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.execution-receipt-evidence',
        receiptEvidence,
      )
    : null;
  const receiptCompletionEvidenceDigest = Array.isArray(receiptEvidence?.evidence)
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.manual-execution-completion-evidence',
        receiptEvidence.evidence,
      )
    : null;
  const submittedAt = governanceCaseCanonicalDateTime(completion.submittedAt);
  const reviewedAt = governanceCaseCanonicalDateTime(completion.reviewedAt);
  if (
    completion.requestId !== request.id
    || completion.evidenceDigest !== evidenceDigest
    || completion.assigneePubkey !== execution.assigneePubkey
    || completion.assigneeResponsibilityVersion !== execution.version
    || governanceCaseCanonicalDateTime(completion.deadlineAt) !== deadlineAt.toISOString()
    || completion.reviewerPubkey !== outcome.assigneePubkey
    || completion.reviewerResponsibilityVersion !== outcome.version
    || !submittedAt
    || !reviewedAt
    || receipt.id !== completion.receiptId
    || receipt.requestId !== request.id
    || receipt.actionType !== request.actionType
    || receipt.executorModule !== 'manual_case_execution'
    || receipt.executionStatus !== 'executed'
    || receipt.errorCode != null
    || receipt.decisionDigest !== request.decision.decisionDigest
    || receipt.idempotencyKey !== `manual-case:${governanceCase.id}:v${completion.version - 1}`
    || receipt.executionMode !== request.executionMode
    || (receipt.executionModeDigest ?? null) !== (request.executionModeDigest ?? null)
    || (receipt.compatibilityBundleVersion ?? null) !== (request.compatibilityBundleVersion ?? null)
    || receiptEvidence?.schemaVersion !== 1
    || receiptEvidence?.mode !== 'controlled_manual_execution'
    || receiptEvidence?.caseId !== governanceCase.id
    || receiptEvidence?.completionVersion !== completion.version - 1
    || receiptEvidence?.assignee?.pubkey !== completion.assigneePubkey
    || receiptEvidence?.assignee?.responsibilityVersion
      !== completion.assigneeResponsibilityVersion
    || receiptEvidence?.assignee?.deadlineAt !== deadlineAt.toISOString()
    || receiptEvidence?.assignee?.submittedAt !== submittedAt
    || receiptEvidence?.reviewer?.pubkey !== completion.reviewerPubkey
    || receiptEvidence?.reviewer?.responsibilityVersion
      !== completion.reviewerResponsibilityVersion
    || receiptEvidence?.reviewer?.reviewedAt !== reviewedAt
    || receiptCompletionEvidenceDigest !== evidenceDigest
    || receiptEvidence?.evidenceDigest !== evidenceDigest
    || receiptEvidence?.assignmentGrantsSignerAuthority !== false
    || receipt.executionEvidenceDigest !== receiptEvidenceDigest
  ) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_manual_execution_receipt_mismatch',
    );
  }
  if (
    request.actionType !== STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
    && receipt.executionRef !== evidenceDigest
  ) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_manual_execution_receipt_mismatch',
    );
  }
}

async function resolveGovernanceCaseCloseActionDefinition(
  prisma: any,
  governanceCase: any,
  request: any,
): Promise<GovernedActionDefinition | null> {
  const selectedContract = governanceCase?.templateSelection?.actionContract ?? null;
  const persistedContract = governanceCase?.actionContractVersion ?? null;
  if (selectedContract == null && persistedContract == null) return null;
  if (!selectedContract || !persistedContract) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_action_contract_snapshot_mismatch');
  }
  let resolved;
  try {
    resolved = await resolveFrozenGovernedActionContractVersion(prisma, {
      selected: selectedContract,
      authority: governanceCase?.templateSelection?.actionAuthority ?? null,
    });
  } catch {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_action_contract_snapshot_mismatch');
  }
  if (
    resolved.definition.actionType !== request?.actionType
    || resolved.definition.targetType !== request?.targetType
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_action_contract_snapshot_mismatch');
  }
  return resolved.definition;
}

async function assertExternalAppPrimaryCircleBindExecutionReady(
  prisma: any,
  governanceCase: any,
  frozenDefinition: {
    actionType: string;
    targetType: string;
    executionAdapter: string;
    receiptRequired: boolean;
  },
): Promise<any> {
  const request = governanceCase.primaryRequest;
  const decision = request?.decision;
  const receipts = Array.isArray(request?.receipts) ? request.receipts : [];
  if (
    !decision
    || String(decision.decision || '') !== 'accepted'
    || !frozenDefinition.receiptRequired
    || frozenDefinition.actionType !== 'external_app_primary_circle_bind'
    || frozenDefinition.actionType !== request.actionType
    || frozenDefinition.targetType !== request.targetType
    || String(request.caseRef || '') !== String(governanceCase.id || '')
    || receipts.length !== 1
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_receipt_required');
  }
  const receipt = receipts[0];
  if (
    receipt?.requestId !== request.id
    || receipt?.actionType !== request.actionType
    || receipt?.executorModule !== 'external_app_circle_binding'
    || receipt?.executorModule !== frozenDefinition.executionAdapter
    || receipt?.executionStatus !== 'executed'
    || receipt?.errorCode != null
    || typeof receipt?.executionRef !== 'string'
    || !receipt.executionRef.trim()
    || receipt?.decisionDigest !== decision.decisionDigest
    || receipt.executionRef !== request.targetRef
    || receipt.executionRef !== governanceCase.subjectRef
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_receipt_mismatch');
  }
  const binding = await prisma.externalAppCircleBinding.findUnique({
    where: { id: receipt.executionRef },
  });
  if (
    !binding
    || binding.id !== receipt.executionRef
    || String(binding.bindingKind || '') !== 'primary'
    || String(binding.status || '') !== 'active'
    || binding.governanceRequestId !== request.id
    || binding.governanceDecisionDigest !== decision.decisionDigest
    || binding.executionReceiptId !== receipt.id
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_effect_mismatch');
  }
  const application = binding.metadata
    && typeof binding.metadata === 'object'
    && !Array.isArray(binding.metadata)
    && (binding.metadata as any).application
    && typeof (binding.metadata as any).application === 'object'
    ? (binding.metadata as any).application as Record<string, unknown>
    : null;
  const casePayload = governanceCase.requestedActionPayload
    && typeof governanceCase.requestedActionPayload === 'object'
    && !Array.isArray(governanceCase.requestedActionPayload)
    ? governanceCase.requestedActionPayload as Record<string, unknown>
    : null;
  const provenance = casePayload?.candidateProvenance
    && typeof casePayload.candidateProvenance === 'object'
    && !Array.isArray(casePayload.candidateProvenance)
    ? casePayload.candidateProvenance as Record<string, unknown>
    : null;
  const expectedEvidence = {
    kind: 'external_app_circle_binding_effect_v1',
    operation: 'activate',
    bindingDigest: String(binding.bindingDigest || ''),
    bindingEffectDigest: buildExternalAppCircleBindingEffectDigest({
      bindingDigest: String(binding.bindingDigest || ''),
      governanceRequestId: request.id,
      governanceDecisionDigest: decision.decisionDigest,
      operation: 'activate',
    }),
    governanceCaseId: governanceCase.id,
    applicationEpoch: Number(application?.applicationEpoch),
    rationaleDigest: String(application?.rationaleDigest || '').trim().toLowerCase(),
    candidateRef: String(application?.candidateRef || ''),
    intentDigest: String(provenance?.intentDigest || '').trim().toLowerCase(),
    requestedByPubkey: String(application?.requestedByPubkey || ''),
    requestedAt: String(application?.requestedAt || ''),
  };
  const expectedEvidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.execution-receipt-evidence',
    expectedEvidence,
  );
  const actualEvidenceDigest = receipt?.executionEvidence
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.execution-receipt-evidence',
        receipt.executionEvidence,
      )
    : null;
  if (
    actualEvidenceDigest !== expectedEvidenceDigest
    || receipt?.executionEvidenceDigest !== expectedEvidenceDigest
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_receipt_mismatch');
  }
  return receipt;
}

async function assertGovernanceCaseInternalExecutionReady(
  prisma: any,
  governanceCase: any,
  frozenDefinition: {
    actionType: string;
    targetType: string;
    executionAdapter: string;
    receiptRequired: boolean;
  },
  now: Date,
): Promise<any> {
  const request = governanceCase.primaryRequest;
  const decision = request?.decision;
  const receipts = Array.isArray(request?.receipts) ? request.receipts : [];
  if (
    !decision
    || !frozenDefinition.receiptRequired
    || frozenDefinition.actionType !== request.actionType
    || frozenDefinition.targetType !== request.targetType
    || receipts.length !== 1
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_receipt_required');
  }
  const receipt = receipts[0];
  const expectedEvidence = {
    kind: 'canonical_internal_action',
    actionType: request.actionType,
    targetType: request.targetType,
    targetRef: request.targetRef,
  };
  const expectedEvidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.execution-receipt-evidence',
    expectedEvidence,
  );
  const actualEvidenceDigest = receipt?.executionEvidence
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.execution-receipt-evidence',
        receipt.executionEvidence,
      )
    : null;
  if (
    receipt?.id !== `execution:${decision.decisionDigest}`
    || receipt?.requestId !== request.id
    || receipt?.actionType !== request.actionType
    || receipt?.executorModule !== frozenDefinition.executionAdapter
    || receipt?.executionStatus !== 'executed'
    || receipt?.errorCode != null
    || typeof receipt?.executionRef !== 'string'
    || !receipt.executionRef.trim()
    || receipt?.decisionDigest !== decision.decisionDigest
    || receipt?.idempotencyKey !== `stage-decision:${decision.decisionDigest}`
    || receipt?.executionMode !== request.executionMode
    || (receipt?.executionModeDigest ?? null) !== (request.executionModeDigest ?? null)
    || (receipt?.compatibilityBundleVersion ?? null)
      !== (request.compatibilityBundleVersion ?? null)
    || actualEvidenceDigest !== expectedEvidenceDigest
    || receipt?.executionEvidenceDigest !== expectedEvidenceDigest
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_receipt_mismatch');
  }
  if (request.actionType === 'circle.governance_binding.create') {
    const binding = await prisma.circleGovernanceBinding.findUnique({
      where: { id: receipt.executionRef },
    });
    const payload = request.payload && typeof request.payload === 'object'
      && !Array.isArray(request.payload)
      ? request.payload as Record<string, unknown>
      : null;
    const bindingType = typeof payload?.bindingType === 'string'
      ? payload.bindingType.trim()
      : '';
    const targetCircleId = Number(payload?.targetCircleId);
    const committeeCircleId = Number(payload?.committeeCircleId);
    const actionType = typeof payload?.actionType === 'string' && payload.actionType.trim()
      ? payload.actionType.trim()
      : null;
    const actionPrefix = typeof payload?.actionPrefix === 'string' && payload.actionPrefix.trim()
      ? payload.actionPrefix.trim()
      : null;
    const actorPubkey = typeof payload?.actorPubkey === 'string'
      ? payload.actorPubkey.trim()
      : '';
    const actionScope = actionType ?? actionPrefix;
    const statusMatches = bindingType === 'shared_committee'
      ? binding?.status === 'pending_mandate' || binding?.status === 'active'
      : binding?.status === 'active';
    const mandateStateMatches = bindingType === 'shared_committee'
      ? binding?.targetAuthorizationStatus === 'accepted'
        && (
          (binding.status === 'pending_mandate' && binding.committeeMandateStatus === 'pending')
          || (binding.status === 'active' && binding.committeeMandateStatus === 'accepted')
        )
        && typeof binding.mandateId === 'string'
        && binding.mandateId.length > 0
      : binding?.targetAuthorizationStatus === 'accepted'
        && binding?.committeeMandateStatus === 'accepted';
    if (
      !binding
      || binding.id !== receipt.executionRef
      || !['local_auxiliary', 'shared_committee', 'self_governed'].includes(bindingType)
      || !Number.isSafeInteger(targetCircleId)
      || targetCircleId <= 0
      || targetCircleId !== Number(request.targetRef)
      || !Number.isSafeInteger(committeeCircleId)
      || committeeCircleId <= 0
      || (actionType === null) === (actionPrefix === null)
      || !actorPubkey
      || binding.bindingType !== bindingType
      || Number(binding.targetCircleId) !== targetCircleId
      || Number(binding.committeeCircleId) !== committeeCircleId
      || (binding.actionType ?? null) !== actionType
      || (binding.actionPrefix ?? null) !== actionPrefix
      || binding.createdByPubkey !== actorPubkey
      || binding.metadata?.actionScope !== actionScope
      || !statusMatches
      || !mandateStateMatches
      || (bindingType !== 'shared_committee' && (
        binding.sourceRequestId !== request.id
        || binding.sourceDecisionDigest !== decision.decisionDigest
      ))
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_effect_mismatch');
    }
    if (bindingType === 'shared_committee') {
      await assertGovernanceCaseSharedMandateEffectReady(prisma, {
        binding,
        request,
        decision,
        payload: payload!,
        actorPubkey,
        actionScope: actionScope!,
        now,
      });
    }
  }
  return receipt;
}

async function assertGovernanceCaseSharedMandateEffectReady(
  prisma: any,
  input: {
    binding: any;
    request: any;
    decision: any;
    payload: Record<string, unknown>;
    actorPubkey: string;
    actionScope: string;
    now: Date;
  },
): Promise<void> {
  const mandateId = typeof input.binding?.mandateId === 'string'
    ? input.binding.mandateId
    : '';
  const acceptanceRequestId = typeof input.binding?.committeeMandateRequestId === 'string'
    ? input.binding.committeeMandateRequestId
    : '';
  const mandate = mandateId
    ? await prisma.governanceMandate.findUnique({ where: { id: mandateId } })
    : null;
  const version = mandateId
    ? await prisma.governanceMandateVersion.findUnique({
        where: { mandateId_version: { mandateId, version: 1 } },
      })
    : null;
  const acceptanceRequest = acceptanceRequestId
    ? await prisma.governanceRequest.findUnique({
        where: { id: acceptanceRequestId },
        include: { decision: true },
      })
    : null;
  const terms = version?.terms && typeof version.terms === 'object' && !Array.isArray(version.terms)
    ? version.terms as Record<string, any>
    : null;
  const acceptancePayload = acceptanceRequest?.payload
    && typeof acceptanceRequest.payload === 'object'
    && !Array.isArray(acceptanceRequest.payload)
    ? acceptanceRequest.payload as Record<string, any>
    : null;
  const expectedPending = input.binding.status === 'pending_mandate';
  const expectedCommitteeStatus = expectedPending ? 'pending' : 'accepted';
  const expectedMandateStatus = expectedPending ? 'offered' : 'active';
  const expectedRequestState = expectedPending ? 'active' : 'accepted';
  const acceptanceExpiresAt = mandate?.acceptanceExpiresAt instanceof Date
    ? mandate.acceptanceExpiresAt
    : new Date(mandate?.acceptanceExpiresAt ?? Number.NaN);
  const effectiveFrom = input.payload.effectiveFrom instanceof Date
    ? input.payload.effectiveFrom
    : new Date(String(input.payload.effectiveFrom ?? ''));
  const effectiveUntil = input.payload.effectiveUntil instanceof Date
    ? input.payload.effectiveUntil
    : new Date(String(input.payload.effectiveUntil ?? ''));
  const requestExpiresAt = acceptanceRequest?.expiresAt instanceof Date
    ? acceptanceRequest.expiresAt
    : new Date(acceptanceRequest?.expiresAt ?? Number.NaN);
  const payloadAcceptanceExpiresAt = input.payload.acceptanceExpiresAt instanceof Date
    ? input.payload.acceptanceExpiresAt
    : new Date(String(input.payload.acceptanceExpiresAt ?? ''));
  const termsDigest = terms
    ? hashCanonicalGovernanceValue('alcheme.governance.mandate-terms', terms)
    : null;
  const acceptancePayloadTermsDigest = acceptancePayload?.mandateTerms
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.mandate-terms',
        acceptancePayload.mandateTerms,
      )
    : null;
  const termsPurposeBindingsDigest = Array.isArray(terms?.purposeBindings)
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.mandate-purpose-bindings',
        terms.purposeBindings,
      )
    : null;
  let payloadDerivedTermsDigest: string | null = null;
  try {
    const frozenOperatorActors = Array.isArray(terms?.purposeBindings)
      ? terms.purposeBindings.flatMap((binding: any) => (
          binding?.purpose === 'operational_execution'
          && Array.isArray(binding?.operatorPolicy?.selector?.frozenActors)
            ? binding.operatorPolicy.selector.frozenActors
            : []
        ))
      : [];
    payloadDerivedTermsDigest = computeGovernanceMandateTermsDigest(
      buildGovernanceMandateTerms({
        delegatorGovernanceHome: {
          type: 'circle',
          ref: String(input.payload.targetCircleId),
        },
        delegateAuthority: {
          type: 'circle_governance_committee',
          ref: String(input.payload.committeeCircleId),
        },
        subject: input.payload.subject as { type: string; ref: string },
        purposeBindings: input.payload.purposeBindings as any,
        actionType: input.payload.actionType as string | null,
        actionPrefix: input.payload.actionPrefix as string | null,
        operatorActors: frozenOperatorActors.length > 0 ? frozenOperatorActors : undefined,
        operatorPolicyConstraints: input.payload.operatorPolicyConstraints as any,
        effectiveFrom,
        effectiveUntil,
        network: input.payload.network as any,
        minimumConstraints: input.payload.minimumConstraints as any,
        feePolicy: input.payload.feePolicy as any,
        effectPolicy: (input.payload.effectPolicy ?? null) as any,
        crossInstitutionDisclosureImpact:
          (input.payload.crossInstitutionDisclosureImpact ?? null) as any,
      }),
    );
  } catch {
    payloadDerivedTermsDigest = null;
  }
  const pendingCreateLineageMatches = expectedPending
    && input.binding.sourceRequestId === input.request.id
    && input.binding.sourceDecisionDigest === input.decision.decisionDigest;
  let canonicalAcceptanceDecisionDigest: string | null = null;
  if (!expectedPending && acceptanceRequest?.decision) {
    const persistedDecision = acceptanceRequest.decision;
    const decidedAt = governanceCaseCanonicalDateTime(persistedDecision.decidedAt);
    const executableFrom = governanceCaseCanonicalDateTime(persistedDecision.executableFrom);
    const executableUntil = governanceCaseCanonicalDateTime(persistedDecision.executableUntil);
    if (decidedAt) {
      const canonicalInput: any = {
        requestId: persistedDecision.requestId,
        envelopeVersion: persistedDecision.envelopeVersion ?? null,
        requestDigest: persistedDecision.requestDigest ?? null,
        payloadDigest: persistedDecision.payloadDigest ?? null,
        policyDigest: persistedDecision.policyDigest ?? null,
        snapshotDigest: persistedDecision.snapshotDigest ?? null,
        decision: persistedDecision.decision,
        reason: persistedDecision.reason,
        tally: persistedDecision.tally,
        decidedAt,
        executableFrom,
        executableUntil,
        ...(persistedDecision.executionMode ? {
          executionMode: persistedDecision.executionMode,
          executionModeDigest: persistedDecision.executionModeDigest ?? null,
          compatibilityBundleVersion: persistedDecision.compatibilityBundleVersion ?? null,
        } : {}),
      };
      canonicalAcceptanceDecisionDigest = computeGovernanceDecisionDigest(canonicalInput);
    }
  }
  const activeAcceptanceLineageMatches = !expectedPending
    && acceptanceRequest?.decision?.requestId === acceptanceRequestId
    && acceptanceRequest?.decision?.decision === 'accepted'
    && /^[a-f0-9]{64}$/.test(String(acceptanceRequest?.decision?.decisionDigest ?? ''))
    && canonicalAcceptanceDecisionDigest === acceptanceRequest.decision.decisionDigest
    && input.binding.sourceRequestId === acceptanceRequestId
    && input.binding.sourceDecisionDigest === acceptanceRequest.decision.decisionDigest
    && version?.sourceRequestId === acceptanceRequestId
    && version?.sourceDecisionDigest === acceptanceRequest.decision.decisionDigest
    && version?.committeeAcceptedTermsDigest === version?.termsDigest
    && version?.committeeAcceptedAt != null;
  const versionPurposeBindingsDigest = Array.isArray(version?.purposeBindings)
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.mandate-purpose-bindings',
        version.purposeBindings,
      )
    : null;
  if (
    !mandateId
    || !acceptanceRequestId
    || !mandate
    || !version
    || !terms
    || !acceptancePayload
    || mandate.id !== mandateId
    || mandate.delegatorGovernanceHomeType !== 'circle'
    || mandate.delegatorGovernanceHomeRef !== String(input.payload.targetCircleId)
    || mandate.delegateAuthorityType !== 'circle_governance_committee'
    || mandate.delegateAuthorityRef !== String(input.payload.committeeCircleId)
    || mandate.bindingType !== 'shared_committee'
    || mandate.status !== expectedMandateStatus
    || mandate.currentVersion !== 1
    || mandate.targetAuthorizationStatus !== 'accepted'
    || mandate.committeeAcceptanceStatus !== expectedCommitteeStatus
    || mandate.createdByPubkey !== input.actorPubkey
    || Number.isNaN(acceptanceExpiresAt.getTime())
    || Number.isNaN(payloadAcceptanceExpiresAt.getTime())
    || acceptanceExpiresAt.getTime() !== payloadAcceptanceExpiresAt.getTime()
    || (expectedPending && acceptanceExpiresAt <= input.now)
    || version.id !== `${mandateId}:v1`
    || version.mandateId !== mandateId
    || version.version !== 1
    || version.termsDigest !== mandate.currentTermsDigest
    || termsDigest !== version.termsDigest
    || payloadDerivedTermsDigest !== version.termsDigest
    || input.binding.metadata?.mandateVersion !== 1
    || input.binding.metadata?.mandateTermsDigest !== version.termsDigest
    || version.targetAcceptedTermsDigest !== version.termsDigest
    || version.targetAcceptedByPubkey !== input.actorPubkey
    || version.createdByPubkey !== input.actorPubkey
    || terms.schemaVersion !== 1
    || terms.delegatorGovernanceHome?.type !== 'circle'
    || terms.delegatorGovernanceHome?.ref !== String(input.payload.targetCircleId)
    || terms.delegateAuthority?.type !== 'circle_governance_committee'
    || terms.delegateAuthority?.ref !== String(input.payload.committeeCircleId)
    || version.subjectType !== String((input.payload.subject as any)?.type ?? '')
    || version.subjectRef !== String((input.payload.subject as any)?.ref ?? '')
    || terms.subject?.type !== version.subjectType
    || terms.subject?.ref !== version.subjectRef
    || (version.actionType ?? null) !== (input.payload.actionType ?? null)
    || (version.actionPrefix ?? null) !== (input.payload.actionPrefix ?? null)
    || (terms.actionSelector?.actionType ?? null) !== (version.actionType ?? null)
    || (terms.actionSelector?.actionPrefix ?? null) !== (version.actionPrefix ?? null)
    || termsPurposeBindingsDigest !== versionPurposeBindingsDigest
    || version.network !== input.payload.network
    || terms.network !== version.network
    || version.environment !== terms.environment
    || Number.isNaN(effectiveFrom.getTime())
    || Number.isNaN(effectiveUntil.getTime())
    || new Date(version.effectiveFrom).getTime() !== effectiveFrom.getTime()
    || new Date(version.effectiveUntil).getTime() !== effectiveUntil.getTime()
    || new Date(terms.effectiveFrom).getTime() !== effectiveFrom.getTime()
    || new Date(terms.effectiveUntil).getTime() !== effectiveUntil.getTime()
    || acceptanceRequest.id !== acceptanceRequestId
    || acceptanceRequest.actionType !== 'circle.governance_binding.accept_mandate'
    || acceptanceRequest.targetType !== 'circle_governance_binding'
    || acceptanceRequest.targetRef !== input.binding.id
    || acceptanceRequest.scopeType !== 'circle_governance_committee'
    || acceptanceRequest.scopeRef !== String(input.payload.committeeCircleId)
    || acceptanceRequest.proposerPubkey !== input.actorPubkey
    || acceptanceRequest.idempotencyKey !== `circle-governance-mandate:${input.binding.id}`
    || acceptanceRequest.state !== expectedRequestState
    || Number.isNaN(requestExpiresAt.getTime())
    || requestExpiresAt.getTime() !== acceptanceExpiresAt.getTime()
    || acceptancePayload.bindingId !== input.binding.id
    || acceptancePayload.mandateId !== mandateId
    || acceptancePayload.mandateVersion !== 1
    || acceptancePayload.mandateTermsDigest !== version.termsDigest
    || acceptancePayload.targetCircleId !== input.payload.targetCircleId
    || acceptancePayload.committeeCircleId !== input.payload.committeeCircleId
    || acceptancePayload.actionScope !== input.actionScope
    || acceptancePayloadTermsDigest !== version.termsDigest
    || (expectedPending && acceptanceRequest.decision != null)
    || (!pendingCreateLineageMatches && !activeAcceptanceLineageMatches)
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_mandate_effect_mismatch');
  }
}

function governanceCaseCanonicalDateTime(value: unknown): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function deriveProviderAdmissionExternalExecution(
  governanceCase: any,
): GovernanceCaseExternalExecutionOutcome | null {
  const request = governanceCase?.primaryRequest;
  if (
    request?.actionType !== STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
    || request?.decision?.decision !== 'accepted'
  ) return null;
  const completion = governanceCase.manualExecutionCompletion;
  const receipts = Array.isArray(request.receipts) ? request.receipts : [];
  if (
    !completion
    || completion.status !== 'approved'
    || !completion.receiptId
    || receipts.length !== 1
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_external_execution_receipt_required');
  }
  const receipt = receipts[0];
  const readback = receipt?.executionEvidence?.authoritativeReadback;
  if (
    receipt?.id !== completion.receiptId
    || receipt?.requestId !== request.id
    || receipt?.actionType !== STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
    || receipt?.executionStatus !== 'executed'
    || receipt?.decisionDigest !== request.decision.decisionDigest
    || receipt?.executionRef !== readback?.providerAdmissionReceiptDigest
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_external_execution_receipt_mismatch');
  }
  const projection = normalizeGovernanceCaseExternalExecution({
    factSource: 'authoritative_external_execution_projection',
    businessExecutionOwner: 'storage_fabric',
    actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
    providerResourceRef: readback?.providerResourceRef,
    providerAdmissionReceiptRef: readback?.providerAdmissionReceiptRef,
    providerAdmissionReceiptDigest: readback?.providerAdmissionReceiptDigest,
    providerStatus: readback?.providerStatus,
    settlementState: readback?.settlementState,
    network: readback?.network,
    projectionDigest: readback?.projectionDigest,
    executedAt: readback?.executedAt,
  });
  if (
    receipt.executionEvidence?.authoritativeExecutionProjection?.factSource
      !== 'authoritative_external_execution_projection'
    || receipt.executionEvidence?.authoritativeExecutionProjection?.businessExecutionOwner
      !== 'storage_fabric'
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_external_execution_receipt_mismatch');
  }
  return projection;
}

function assertGovernanceCaseOutcomeSignoffPolicy(governanceCase: any, actorPubkey: string): void {
  const selection = governanceCase?.templateSelection;
  const policy = selection?.outcomePolicy;
  if (
    selection?.schemaVersion !== 2
    || policy?.closeSignoff !== 'accepted_outcome_reviewer'
    || policy?.highImpactThreshold !== 'high'
    || policy?.executorSeparation !== 'required'
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_outcome_signoff_policy_required');
  }
  const selectedContract = selection.actionContract;
  const persistedContract = governanceCase.actionContractVersion;
  if (selectedContract == null && persistedContract == null) return;
  if (
    !selectedContract
    || !persistedContract
    || governanceCase.actionContractVersionId !== selectedContract.contractVersionId
    || persistedContract.id !== selectedContract.contractVersionId
    || persistedContract.actionType !== selectedContract.actionType
    || persistedContract.definitionDigest !== selectedContract.definitionDigest
    || persistedContract.riskFloor !== selectedContract.riskFloor
    || !['low', 'medium', 'high', 'critical'].includes(persistedContract.riskFloor)
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_outcome_signoff_policy_required');
  }
  if (!['high', 'critical'].includes(persistedContract.riskFloor)) return;
  const executor = governanceCase.responsibilities.find((item: any) => item.kind === 'execution');
  if (executor?.status === 'accepted' && executor.assigneePubkey === actorPubkey) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_independent_outcome_signoff_required');
  }
}

export async function recordGovernanceCaseReviewConclusion(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    conclusion: GovernanceCaseReviewConclusion;
    reason: string;
    publicBasis?: string | null;
    idempotencyKey: string;
    expectedCaseVersion: number;
    now?: Date;
  },
): Promise<{ governanceCase: any; event: any; replayed: boolean }> {
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const conclusion = input.conclusion;
  if (![
    'changes_required', 'signoff_granted', 'signoff_denied', 'abstained', 'conflict_declared',
  ].includes(conclusion)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_review_conclusion_invalid');
  }
  const reason = requiredText(input.reason, 3, 500, 'governance_case_review_reason_required');
  const publicBasis = conclusion === 'signoff_granted'
    ? null
    : requiredText(
        input.publicBasis,
        3,
        240,
        'governance_case_review_public_basis_required',
      );
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_case_idempotency_key_required');
  const now = input.now ?? new Date();
  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: {
        responsibilities: true,
        briefSnapshot: true,
        timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        actionContractVersion: true,
      },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    assertModernWorkflow(governanceCase);
    const reviewer = governanceCase.responsibilities.find((item: any) => item.kind === 'review');
    const replay = await tx.governanceCaseTimelineEvent.findFirst({
      where: { caseId: input.caseId, idempotencyKey },
    });
    if (replay) {
      assertMatchingReplay(replay, {
        eventType: 'review_conclusion_recorded',
        kind: 'review',
        actorPubkey,
        subjectPubkey: actorPubkey,
        reason,
      });
      if (
        replay.toState !== conclusion
        || Number(replay.briefDraftPostId) !== Number(governanceCase.briefDraftPostId)
        || Number(replay.briefDraftVersion) !== Number(governanceCase.briefDraftVersion)
        || replay.briefSnapshotDigest !== governanceCase.briefSnapshotDigest
        || (replay.reviewPublicBasis ?? null) !== publicBasis
        || Number(replay.responsibilityVersion) !== Number(reviewer?.version)
      ) throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
      return { governanceCase, event: replay, replayed: true };
    }
    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    if (governanceCase.casePhase !== 'evidence_review') {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_review_unavailable');
    }
    assertReviewPolicy(governanceCase);
    if (reviewer?.status !== 'accepted' || reviewer.assigneePubkey !== actorPubkey) {
      throw new GovernanceCaseWorkflowError(403, 'governance_case_reviewer_required');
    }
    const snapshot = governanceCase.briefSnapshot;
    if (
      !snapshot
      || Number(snapshot.draftPostId) !== Number(governanceCase.briefDraftPostId)
      || Number(snapshot.draftVersion) !== Number(governanceCase.briefDraftVersion)
      || snapshot.contentHash !== governanceCase.briefSnapshotDigest
    ) throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_required');
    const workflow = await tx.draftWorkflowState.findUnique({
      where: { draftPostId: Number(governanceCase.briefDraftPostId) },
      select: { documentStatus: true, currentSnapshotVersion: true },
    });
    if (
      workflow?.documentStatus !== 'review'
      || Number(workflow.currentSnapshotVersion) !== Number(governanceCase.briefDraftVersion)
    ) throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_review_snapshot_not_current');
    assertGovernanceCaseReviewRelationshipSignoffGate(governanceCase, actorPubkey, conclusion);
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const updated = await tx.governanceCase.updateMany({
      where: { id: input.caseId, caseVersion: input.expectedCaseVersion, casePhase: 'evidence_review' },
      data: { caseVersion: nextCaseVersion },
    });
    if (updated.count !== 1) throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    const event = await tx.governanceCaseTimelineEvent.create({ data: {
      id: eventId(input.caseId, idempotencyKey),
      caseId: input.caseId,
      eventType: 'review_conclusion_recorded',
      responsibilityKind: 'review',
      actorPubkey,
      subjectPubkey: actorPubkey,
      fromState: null,
      toState: conclusion,
      reason,
      idempotencyKey,
      caseVersion: nextCaseVersion,
      responsibilityVersion: reviewer.version,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      reviewPublicBasis: publicBasis,
      createdAt: now,
    } });
    return {
      governanceCase: { ...governanceCase, caseVersion: nextCaseVersion },
      event,
      replayed: false,
    };
  });
}

export async function recordGovernanceCaseReviewRelationship(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    actorRole: GovernanceCaseReviewRelationshipActorRole;
    relationship: GovernanceCaseReviewRelationship;
    idempotencyKey: string;
    expectedCaseVersion: number;
    now?: Date;
  },
): Promise<{ governanceCase: any; event: any; replayed: boolean }> {
  const actorPubkey = requiredPubkey(input.actorPubkey);
  if (!['reviewer', 'proposer'].includes(input.actorRole)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_review_relationship_role_invalid');
  }
  if (!['none', 'personal', 'professional', 'financial', 'organizational', 'other'].includes(input.relationship)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_review_relationship_invalid');
  }
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_case_idempotency_key_required');
  const now = input.now ?? new Date();
  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: { responsibilities: true, briefSnapshot: true },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    assertModernWorkflow(governanceCase);
    const proposerPubkey = requiredPubkey(governanceCase.openedByPubkey);
    const reviewer = governanceCase.responsibilities.find((item: any) => item.kind === 'review');
    const actorAuthorized = input.actorRole === 'reviewer'
      ? reviewer?.status === 'accepted' && reviewer.assigneePubkey === actorPubkey
      : proposerPubkey === actorPubkey;
    if (!actorAuthorized) {
      throw new GovernanceCaseWorkflowError(403, 'governance_case_review_relationship_actor_required');
    }
    const replay = await tx.governanceCaseTimelineEvent.findFirst({
      where: { caseId: input.caseId, idempotencyKey },
    });
    if (replay) {
      if (
        replay.eventType !== 'review_relationship_declared'
        || replay.actorPubkey !== actorPubkey
        || replay.subjectPubkey !== proposerPubkey
        || replay.fromState !== input.actorRole
        || replay.toState !== input.relationship
        || (
          input.actorRole === 'reviewer'
          && Number(replay.responsibilityVersion) !== Number(reviewer?.version)
        )
        || Number(replay.briefDraftPostId) !== Number(governanceCase.briefDraftPostId)
        || Number(replay.briefDraftVersion) !== Number(governanceCase.briefDraftVersion)
        || replay.briefSnapshotDigest !== governanceCase.briefSnapshotDigest
      ) throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
      return { governanceCase, event: replay, replayed: true };
    }
    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    if (governanceCase.casePhase !== 'evidence_review') {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_review_unavailable');
    }
    const snapshot = governanceCase.briefSnapshot;
    if (
      !snapshot
      || Number(snapshot.draftPostId) !== Number(governanceCase.briefDraftPostId)
      || Number(snapshot.draftVersion) !== Number(governanceCase.briefDraftVersion)
      || snapshot.contentHash !== governanceCase.briefSnapshotDigest
    ) throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_required');
    const workflow = await tx.draftWorkflowState.findUnique({
      where: { draftPostId: Number(governanceCase.briefDraftPostId) },
      select: { documentStatus: true, currentSnapshotVersion: true },
    });
    if (
      workflow?.documentStatus !== 'review'
      || Number(workflow.currentSnapshotVersion) !== Number(governanceCase.briefDraftVersion)
    ) throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_review_snapshot_not_current');
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const updated = await tx.governanceCase.updateMany({
      where: { id: input.caseId, caseVersion: input.expectedCaseVersion, casePhase: 'evidence_review' },
      data: { caseVersion: nextCaseVersion },
    });
    if (updated.count !== 1) throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    const event = await tx.governanceCaseTimelineEvent.create({ data: {
      id: eventId(input.caseId, idempotencyKey),
      caseId: input.caseId,
      eventType: 'review_relationship_declared',
      responsibilityKind: 'review',
      actorPubkey,
      subjectPubkey: proposerPubkey,
      fromState: input.actorRole,
      toState: input.relationship,
      reason: null,
      idempotencyKey,
      caseVersion: nextCaseVersion,
      responsibilityVersion: input.actorRole === 'reviewer' ? reviewer.version : null,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      createdAt: now,
    } });
    return {
      governanceCase: { ...governanceCase, caseVersion: nextCaseVersion },
      event,
      replayed: false,
    };
  });
}

export function governanceCaseReviewRelationshipSignoffGateError(
  governanceCase: any,
  actorPubkey: string,
  conclusion: GovernanceCaseReviewConclusion,
): string | null {
  if (conclusion !== 'signoff_granted') return null;
  const selectedContract = governanceCase?.templateSelection?.actionContract;
  const persistedContract = governanceCase?.actionContractVersion;
  if (selectedContract == null && persistedContract == null) return null;
  if (
    !selectedContract
    || !persistedContract
    || governanceCase.actionContractVersionId !== selectedContract.contractVersionId
    || persistedContract.id !== selectedContract.contractVersionId
    || persistedContract.actionType !== selectedContract.actionType
    || persistedContract.definitionDigest !== selectedContract.definitionDigest
    || persistedContract.riskFloor !== selectedContract.riskFloor
  ) return 'governance_case_review_relationship_policy_required';
  if (!['high', 'critical'].includes(persistedContract.riskFloor)) return null;
  if (actorPubkey === governanceCase.openedByPubkey) {
    return 'governance_case_independent_review_signoff_required';
  }
  const reviewer = (governanceCase.responsibilities || []).find(
    (item: any) => item.kind === 'review',
  );
  const currentRelationships = (governanceCase.timelineEvents || []).filter((event: any) => (
    event.eventType === 'review_relationship_declared'
    && Number(event.briefDraftPostId) === Number(governanceCase.briefDraftPostId)
    && Number(event.briefDraftVersion) === Number(governanceCase.briefDraftVersion)
    && event.briefSnapshotDigest === governanceCase.briefSnapshotDigest
  ));
  const latestDeclaration = (predicate: (event: any) => boolean): any | null => (
    currentRelationships
      .filter(predicate)
      .reduce((latest: any | null, event: any) => (
        latest == null || Number(event.caseVersion) > Number(latest.caseVersion)
          ? event
          : latest
      ), null)
  );
  const reviewerDeclaration = latestDeclaration((event: any) => (
    event.fromState === 'reviewer'
    && event.actorPubkey === actorPubkey
    && Number(event.responsibilityVersion) === Number(reviewer?.version)
  ));
  if (!reviewerDeclaration) {
    return 'governance_case_review_relationship_declaration_required';
  }
  const proposerDeclaration = latestDeclaration((event: any) => (
    event.fromState === 'proposer' && event.actorPubkey === governanceCase.openedByPubkey
  ));
  if (
    reviewerDeclaration.toState !== 'none'
    || (proposerDeclaration && proposerDeclaration.toState !== 'none')
  ) return 'governance_case_independent_review_signoff_required';
  return null;
}

export function assertGovernanceCaseReviewRelationshipSignoffGate(
  governanceCase: any,
  actorPubkey: string,
  conclusion: GovernanceCaseReviewConclusion,
): void {
  const error = governanceCaseReviewRelationshipSignoffGateError(
    governanceCase,
    actorPubkey,
    conclusion,
  );
  if (error) throw new GovernanceCaseWorkflowError(409, error);
}

function assertReviewPolicy(governanceCase: any): void {
  const policy = governanceCase?.templateSelection?.reviewPolicy;
  if (
    governanceCase?.templateSelection?.schemaVersion !== 2
    || policy?.reviewerReplacement !== 'manager_or_current_reviewer'
    || policy?.appeal !== 'not_available'
    || policy?.higherReviewGate !== 'review_responsibility_escalation'
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_review_policy_required');
  }
}

function nextStatusForAction(
  action: Exclude<GovernanceCaseResponsibilityAction, 'reassign' | 'extend_deadline' | 'cancel_deadline'>,
  currentStatus: string,
): GovernanceCaseResponsibilityStatus {
  if (action === 'accept') {
    if (!['assigned', 'escalated', 'absent'].includes(currentStatus)) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_transition_invalid');
    }
    return 'accepted';
  }
  if (action === 'decline') {
    if (!['assigned', 'accepted'].includes(currentStatus)) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_transition_invalid');
    }
    return 'declined';
  }
  if (action === 'escalate') {
    if (!['assigned', 'accepted'].includes(currentStatus)) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_transition_invalid');
    }
    return 'escalated';
  }
  if (!['assigned', 'accepted', 'escalated'].includes(currentStatus)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_transition_invalid');
  }
  return 'absent';
}

async function updateResponsibility(
  tx: any,
  current: any,
  input: {
    expectedVersion: number;
    assigneePubkey: string;
    status: GovernanceCaseResponsibilityStatus;
    actorPubkey: string;
    reason: string | null;
    deadlineAt: Date | null;
    now: Date;
    resetAssignment: boolean;
  },
): Promise<any> {
  const nextVersion = current.version + 1;
  const updated = await tx.governanceCaseResponsibility.updateMany({
    where: { id: current.id, version: input.expectedVersion },
    data: {
      assigneePubkey: input.assigneePubkey,
      status: input.status,
      version: nextVersion,
      assignedByPubkey: input.resetAssignment ? input.actorPubkey : current.assignedByPubkey,
      assignedAt: input.resetAssignment ? input.now : current.assignedAt,
      deadlineAt: input.deadlineAt,
      respondedAt: input.status === 'assigned' ? null : input.now,
      reason: input.reason,
    },
  });
  if (updated.count !== 1) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_version_conflict');
  }
  return tx.governanceCaseResponsibility.findUnique({ where: { id: current.id } });
}

async function isActiveCircleParticipant(
  tx: any,
  circleId: number,
  pubkey: string,
): Promise<boolean> {
  const user = await tx.user.findUnique({ where: { pubkey }, select: { id: true } });
  if (!user) return false;
  const circle = await tx.circle.findUnique({ where: { id: circleId }, select: { creatorId: true } });
  if (!circle) return false;
  if (circle.creatorId === user.id) return true;
  const membership = await tx.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId: user.id } },
    select: { status: true },
  });
  return membership?.status === 'Active';
}

function executionParticipantScopeCircleId(
  value: { scopeType?: unknown; scopeRef?: unknown } | null | undefined,
): number | null {
  if (!['circle_governance_committee', 'external_app_review_circle'].includes(
    String(value?.scopeType ?? ''),
  )) return null;
  const circleId = Number(value?.scopeRef);
  return Number.isSafeInteger(circleId) && circleId > 0 ? circleId : null;
}

async function assertActiveResponsibilityCandidate(
  tx: any,
  governanceCase: any,
  kind: GovernanceCaseResponsibilityKind,
  pubkey: string,
): Promise<void> {
  const home = governanceCase.homeIdentityBinding;
  const circleId = home?.homeType === 'circle' ? Number(home.homeRef) : NaN;
  if (!Number.isSafeInteger(circleId) || circleId <= 0) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_circle_home_required');
  }
  if (await isActiveCircleParticipant(tx, circleId, pubkey)) return;
  const externalCircleId = kind === 'execution'
    ? executionParticipantScopeCircleId(governanceCase.primaryRequest)
    : null;
  if (
    externalCircleId
    && externalCircleId !== circleId
    && await isActiveCircleParticipant(tx, externalCircleId, pubkey)
  ) {
    return;
  }
  throw new GovernanceCaseWorkflowError(409, 'governance_case_assignee_not_member');
}

function assertModernWorkflow(governanceCase: any): void {
  if (!governanceCase.casePhase || !Number.isInteger(governanceCase.caseVersion)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_workflow_legacy_unavailable');
  }
}

function assertCanBindBrief(governanceCase: any, actorPubkey: string, canManage: boolean): void {
  const coordinator = Array.isArray(governanceCase.responsibilities)
    ? governanceCase.responsibilities.find((item: any) => item.kind === 'coordinator')
    : null;
  if (!canManage && (coordinator?.status !== 'accepted' || coordinator.assigneePubkey !== actorPubkey)) {
    throw new GovernanceCaseWorkflowError(403, 'governance_case_brief_binding_denied');
  }
}

function caseCircleId(governanceCase: any): number {
  const home = governanceCase.homeIdentityBinding;
  const circleId = home?.homeType === 'circle' ? Number(home.homeRef) : NaN;
  if (!Number.isSafeInteger(circleId) || circleId <= 0) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_circle_home_required');
  }
  return circleId;
}

function briefSnapshotKey(draftPostId: number, draftVersion: number): string {
  return `${draftPostId}:${draftVersion}`;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function assertMatchingReplay(
  event: any,
  expected: {
    eventType: string;
    kind: GovernanceCaseResponsibilityKind | null;
    actorPubkey: string;
    subjectPubkey: string | null;
    reason: string | null;
  },
): void {
  if (
    event.eventType !== expected.eventType
    || (event.responsibilityKind ?? null) !== expected.kind
    || (event.actorPubkey ?? null) !== expected.actorPubkey
    || (event.subjectPubkey ?? null) !== expected.subjectPubkey
    || (event.reason ?? null) !== expected.reason
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
  }
}

function responsibilityId(caseId: string, kind: GovernanceCaseResponsibilityKind): string {
  return `governance_case_responsibility:${hashCanonicalGovernanceValue('alcheme.governance.case-responsibility-id', { caseId, kind }).slice(0, 56)}`;
}

function workflowKey(kind: string, caseId: string, actorPubkey: string): string {
  return `${kind}:${hashCanonicalGovernanceValue('alcheme.governance.case-workflow-key', { caseId, actorPubkey }).slice(0, 64)}`;
}

function eventId(caseId: string, idempotencyKey: string): string {
  return `governance_case_event:${hashCanonicalGovernanceValue('alcheme.governance.case-event-id', { caseId, idempotencyKey }).slice(0, 64)}`;
}

function requiredPubkey(value: unknown): string {
  return requiredText(value, 1, 44, 'governance_case_actor_required');
}

function requiredText(value: unknown, min: number, max: number, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < min || normalized.length > max) {
    throw new GovernanceCaseWorkflowError(400, code);
  }
  return normalized;
}

function assertExactObjectKeys(value: unknown, keys: string[], code: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GovernanceCaseWorkflowError(400, code);
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new GovernanceCaseWorkflowError(400, code);
  }
}

function requiredIsoTimestamp(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GovernanceCaseWorkflowError(400, code);
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new GovernanceCaseWorkflowError(400, code);
  }
  return timestamp.toISOString();
}

function normalizedOutcomeList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new GovernanceCaseWorkflowError(400, `governance_case_actual_outcome_${field}_invalid`);
  }
  const normalized = value.map((item) => requiredText(
    item,
    2,
    500,
    `governance_case_actual_outcome_${field}_invalid`,
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new GovernanceCaseWorkflowError(400, `governance_case_actual_outcome_${field}_invalid`);
  }
  return Object.freeze(normalized) as unknown as string[];
}

function optionalReason(value: unknown, action: GovernanceCaseResponsibilityAction): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    action === 'decline'
    || action === 'escalate'
    || action === 'absence'
    || action === 'extend_deadline'
    || action === 'cancel_deadline'
  ) {
    return requiredText(normalized, 3, 500, 'governance_case_responsibility_reason_required');
  }
  if (normalized.length > 500) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_reason_invalid');
  }
  return normalized || null;
}

function resolveResponsibilityDeadline(
  value: unknown,
  action: GovernanceCaseResponsibilityAction,
  current: unknown,
  now: Date,
): Date | null {
  const requested = value == null || value === ''
    ? null
    : new Date(requiredIsoTimestamp(value, 'governance_case_responsibility_deadline_invalid'));
  const frozen = current == null ? null : new Date(requiredIsoTimestamp(
    current instanceof Date ? current.toISOString() : String(current),
    'governance_case_responsibility_deadline_invalid',
  ));
  if (action === 'extend_deadline') {
    if (!frozen) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_deadline_required');
    }
    if (
      !requested
      || requested.getTime() <= now.getTime()
      || requested.getTime() <= frozen.getTime()
    ) {
      throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_extension_invalid');
    }
    return requested;
  }
  if (action === 'cancel_deadline') {
    if (requested) {
      throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_action_invalid');
    }
    if (!frozen) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_deadline_required');
    }
    return null;
  }
  if (action !== 'reassign') {
    if (requested) {
      throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_action_invalid');
    }
    return frozen;
  }
  if (frozen) {
    if (requested && requested.getTime() !== frozen.getTime()) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_responsibility_deadline_immutable');
    }
    return frozen;
  }
  if (!requested) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_required');
  }
  if (requested.getTime() <= now.getTime()) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_invalid');
  }
  return requested;
}

function assertResponsibilityReplayDeadline(
  value: unknown,
  action: GovernanceCaseResponsibilityAction,
  recordedValue: unknown,
): void {
  const requested = value == null || value === ''
    ? null
    : new Date(requiredIsoTimestamp(value, 'governance_case_responsibility_deadline_invalid'));
  const recorded = recordedValue == null ? null : new Date(requiredIsoTimestamp(
    recordedValue instanceof Date ? recordedValue.toISOString() : String(recordedValue),
    'governance_case_responsibility_deadline_invalid',
  ));
  if (action === 'cancel_deadline') {
    if (requested) {
      throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_action_invalid');
    }
    if (recorded) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_workflow_replay_corrupt');
    }
    return;
  }
  if (action === 'extend_deadline') {
    if (!requested) {
      throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_extension_invalid');
    }
    if (!recorded || requested.getTime() !== recorded.getTime()) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_workflow_replay_mismatch');
    }
    return;
  }
  if (action === 'reassign') {
    if (!recorded) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_workflow_replay_corrupt');
    }
    if (requested && requested.getTime() !== recorded.getTime()) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_workflow_replay_mismatch');
    }
    return;
  }
  if (requested) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_deadline_action_invalid');
  }
}

function assertResponsibilityKind(value: string): asserts value is GovernanceCaseResponsibilityKind {
  if (!['coordinator', 'review', 'execution', 'outcome'].includes(value)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_kind_invalid');
  }
}

function assertResponsibilityAction(value: string): asserts value is GovernanceCaseResponsibilityAction {
  if (![
    'accept',
    'decline',
    'reassign',
    'escalate',
    'absence',
    'extend_deadline',
    'cancel_deadline',
  ].includes(value)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_responsibility_action_invalid');
  }
}

async function inTransaction<T>(prisma: any, action: (tx: any) => Promise<T>): Promise<T> {
  return typeof prisma.$transaction === 'function'
    ? prisma.$transaction((tx: any) => action(tx))
    : action(prisma);
}
