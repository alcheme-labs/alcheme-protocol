import { hashCanonicalGovernanceValue } from '../governance/canonicalCodec';
import { validateDraftContributorProofRecord, type DraftContributorProofRecord } from '../contributorProof';
import { hashContributionEvidencePackage } from './evidencePackage';
import type { ContributionEvidencePackage } from './types';

const DOMAIN = 'alcheme.governance.contribution-role-trace';
const ACTOR_ROLES = new Set([
  'external_author', 'submitter', 'proposal_author', 'reviewer', 'voter', 'executor', 'ai', 'worker', 'trigger',
]);
const FUNCTIONS = new Set([
  'material', 'claim', 'edit', 'review', 'execution', 'outcome', 'governance_decision', 'trigger',
]);
const PROOF_FUNCTIONS = new Set(['material', 'claim', 'edit', 'review', 'execution', 'outcome']);

export type ContributionTraceActorRole =
  | 'external_author' | 'submitter' | 'proposal_author' | 'reviewer' | 'voter' | 'executor'
  | 'ai' | 'worker' | 'trigger';
export type ContributionTraceFunction =
  | 'material' | 'claim' | 'edit' | 'review' | 'execution' | 'outcome'
  | 'governance_decision' | 'trigger';

export interface ContributionRoleTraceActorInput {
  actorRef: string;
  actorRole: ContributionTraceActorRole;
  contributionFunctions: ContributionTraceFunction[];
  evidenceRefs: string[];
  proofContribution: boolean;
  explicitGovernanceReward: boolean;
  governanceRewardPolicyRef?: string | null;
  requestedWeightBps: number;
}

export async function persistContributionRoleTrace(
  dependencies: { prisma: any },
  input: {
    governanceHomeRef: string;
    knowledgeRef: string;
    contributorProof: DraftContributorProofRecord;
    evidence: ContributionEvidencePackage;
    proofPackageHash: string;
    actors: ContributionRoleTraceActorInput[];
    now: Date;
  },
) {
  const now = validDate(input.now);
  const proof = validateDraftContributorProofRecord(input.contributorProof);
  assertEvidenceMatchesProof(input.evidence, proof);
  const proofByPubkey = new Map(proof.contributors.map((contributor) => [contributor.pubkey, contributor]));
  const evidenceByRef = new Map(input.evidence.evidenceRefs.map((ref) => [ref.refId, ref]));
  const actors = input.actors.map(normalizeActor).map((actor) => bindActorProof(actor, proofByPubkey, evidenceByRef)).sort((left, right) =>
    `${left.actorRef}:${left.actorRole}`.localeCompare(`${right.actorRef}:${right.actorRole}`)
  );
  if (actors.length === 0) throw new Error('contribution_role_trace_actors_required');
  const identities = actors.map((actor) => `${actor.actorRef}:${actor.actorRole}`);
  if (new Set(identities).size !== identities.length) throw new Error('contribution_role_trace_actor_duplicate');
  const blockers = actors
    .filter((actor) => actor.requestedWeightBps > 0 && actor.eligibleWeightBps === 0)
    .map((actor) => `ineligible_weight:${actor.actorRole}:${actor.actorRef}`);
  const eligibleTotal = actors.reduce((sum, actor) => sum + actor.eligibleWeightBps, 0);
  if (eligibleTotal !== 0 && eligibleTotal !== 10_000) blockers.push(`eligible_weight_total:${eligibleTotal}`);
  const facts = {
    schemaVersion: 1,
    governanceHomeRef: text(input.governanceHomeRef, 'contribution_role_trace_home_required'),
    knowledgeRef: text(input.knowledgeRef, 'contribution_role_trace_knowledge_required'),
    draftPostId: proof.draftPostId,
    proofPackageHash: hex(input.proofPackageHash, 'contribution_role_trace_proof_hash_invalid'),
    contributorsRoot: proof.rootHex,
    sourceAnchorId: proof.anchorId,
    evidenceDigest: hashContributionEvidencePackage(input.evidence),
    actors,
    blockers,
  };
  const traceDigest = hashCanonicalGovernanceValue(DOMAIN, facts);
  const bundleId = `contribution-role-trace:${traceDigest}`;
  const status = blockers.length === 0 ? 'verified' : 'blocked';
  const where = { traceDigest };
  let existing = await dependencies.prisma.contributionRoleTraceBundle.findUnique({
    where, include: { actors: { orderBy: [{ actorRef: 'asc' }, { actorRole: 'asc' }] } },
  });
  if (!existing) {
    try {
      existing = await dependencies.prisma.contributionRoleTraceBundle.create({
        data: {
          id: bundleId,
          governanceHomeRef: facts.governanceHomeRef,
          knowledgeRef: facts.knowledgeRef,
          draftPostId: facts.draftPostId,
          proofPackageHash: facts.proofPackageHash,
          contributorsRoot: facts.contributorsRoot,
          sourceAnchorId: facts.sourceAnchorId,
          evidenceDigest: facts.evidenceDigest,
          traceDigest,
          status,
          blockers,
          createdAt: now,
          actors: {
            create: actors.map((actor, index) => ({
              id: `${bundleId}:actor:${index}`,
              ...actor,
              createdAt: now,
            })),
          },
        },
        include: { actors: { orderBy: [{ actorRef: 'asc' }, { actorRole: 'asc' }] } },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      existing = await dependencies.prisma.contributionRoleTraceBundle.findUnique({
        where, include: { actors: { orderBy: [{ actorRef: 'asc' }, { actorRole: 'asc' }] } },
      });
      if (!existing) throw new Error('contribution_role_trace_retry_missing');
    }
  }
  assertStoredTrace(existing, { bundleId, traceDigest, status, facts });
  return existing;
}

function assertEvidenceMatchesProof(evidence: ContributionEvidencePackage, proof: DraftContributorProofRecord) {
  if (evidence.draftPostId !== proof.draftPostId || evidence.circleId !== proof.circleId) {
    throw new Error('contribution_role_trace_evidence_scope_mismatch');
  }
  const anchor = evidence.sourceAnchor;
  if (!anchor
    || anchor.anchorId !== proof.anchorId
    || anchor.payloadHash !== proof.payloadHash
    || anchor.summaryHash !== proof.summaryHash
    || anchor.sourceMessagesDigest !== proof.messagesDigest) {
    throw new Error('contribution_role_trace_evidence_anchor_mismatch');
  }
}

function bindActorProof(
  actor: ReturnType<typeof normalizeActor>,
  proofByPubkey: Map<string, DraftContributorProofRecord['contributors'][number]>,
  evidenceByRef: Map<string, ContributionEvidencePackage['evidenceRefs'][number]>,
) {
  if (!actor.proofContribution) return actor;
  const proof = proofByPubkey.get(actor.actorRef);
  const refsMatch = actor.evidenceRefs.length > 0 && actor.evidenceRefs.every((refId) => {
    const ref = evidenceByRef.get(refId);
    return ref?.contributorPubkey === actor.actorRef;
  });
  if (!proof || proof.weightBps !== actor.requestedWeightBps || !refsMatch) {
    return { ...actor, eligibleWeightBps: 0, eligibilityReason: 'proof_binding_mismatch' };
  }
  return actor;
}

function normalizeActor(input: ContributionRoleTraceActorInput) {
  const actorRef = text(input.actorRef, 'contribution_role_trace_actor_required');
  if (!ACTOR_ROLES.has(input.actorRole)) throw new Error('contribution_role_trace_actor_role_invalid');
  const contributionFunctions = uniqueStrings(input.contributionFunctions, FUNCTIONS, 'contribution_role_trace_function_invalid');
  const evidenceRefs = uniqueText(input.evidenceRefs, 'contribution_role_trace_evidence_ref_invalid');
  const requestedWeightBps = weight(input.requestedWeightBps);
  const rewardPolicyRef = input.explicitGovernanceReward
    ? text(input.governanceRewardPolicyRef, 'contribution_role_trace_reward_policy_required')
    : null;
  const proofEligible = input.proofContribution
    && evidenceRefs.length > 0
    && contributionFunctions.some((value) => PROOF_FUNCTIONS.has(value));
  const governanceRewardEligible = input.explicitGovernanceReward
    && contributionFunctions.includes('governance_decision');
  const eligible = proofEligible || governanceRewardEligible;
  let eligibilityReason = 'no_weight_requested';
  if (requestedWeightBps > 0 && proofEligible) eligibilityReason = 'proof_contribution';
  else if (requestedWeightBps > 0 && governanceRewardEligible) eligibilityReason = 'explicit_governance_reward';
  else if (requestedWeightBps > 0) eligibilityReason = 'proof_or_reward_required';
  return {
    actorRef,
    actorRole: input.actorRole,
    contributionFunctions,
    evidenceRefs,
    proofContribution: input.proofContribution === true,
    explicitGovernanceReward: input.explicitGovernanceReward === true,
    governanceRewardPolicyRef: rewardPolicyRef,
    requestedWeightBps,
    eligibleWeightBps: eligible ? requestedWeightBps : 0,
    eligibilityReason,
  };
}

function assertStoredTrace(stored: any, expected: { bundleId: string; traceDigest: string; status: string; facts: any }) {
  const scalars = {
    id: expected.bundleId, governanceHomeRef: expected.facts.governanceHomeRef,
    knowledgeRef: expected.facts.knowledgeRef, draftPostId: expected.facts.draftPostId,
    proofPackageHash: expected.facts.proofPackageHash, contributorsRoot: expected.facts.contributorsRoot,
    sourceAnchorId: expected.facts.sourceAnchorId, evidenceDigest: expected.facts.evidenceDigest,
    traceDigest: expected.traceDigest, status: expected.status,
  };
  for (const [key, value] of Object.entries(scalars)) if (stored[key] !== value) throw new Error('contribution_role_trace_existing_corrupt');
  if (JSON.stringify(stored.blockers) !== JSON.stringify(expected.facts.blockers)) throw new Error('contribution_role_trace_existing_corrupt');
  const storedActors = (stored.actors || []).map((actor: any) => ({
    actorRef: actor.actorRef, actorRole: actor.actorRole,
    contributionFunctions: actor.contributionFunctions, evidenceRefs: actor.evidenceRefs,
    proofContribution: actor.proofContribution, explicitGovernanceReward: actor.explicitGovernanceReward,
    governanceRewardPolicyRef: actor.governanceRewardPolicyRef,
    requestedWeightBps: actor.requestedWeightBps, eligibleWeightBps: actor.eligibleWeightBps,
    eligibilityReason: actor.eligibilityReason,
  }));
  if (hashCanonicalGovernanceValue(DOMAIN, { ...expected.facts, actors: storedActors }) !== expected.traceDigest) {
    throw new Error('contribution_role_trace_existing_corrupt');
  }
}

function isUniqueConflict(value: unknown) { return typeof value === 'object' && value !== null && (value as { code?: unknown }).code === 'P2002'; }
function validDate(value: unknown) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('contribution_role_trace_time_invalid'); return new Date(value); }
function text(value: unknown, code: string) { if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error(code); return value; }
function hex(value: unknown, code: string) { const result = text(value, code).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(code); return result; }
function weight(value: unknown) { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 10_000) throw new Error('contribution_role_trace_weight_invalid'); return Number(value); }
function uniqueText(values: unknown, code: string) { if (!Array.isArray(values)) throw new Error(code); return [...new Set(values.map((value) => text(value, code)))].sort(); }
function uniqueStrings(values: unknown, allowed: Set<string>, code: string) { const result = uniqueText(values, code); if (result.some((value) => !allowed.has(value))) throw new Error(code); return result; }
