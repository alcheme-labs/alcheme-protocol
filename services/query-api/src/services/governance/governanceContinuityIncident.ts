import { hashCanonicalGovernanceValue } from './canonicalCodec';

const SUCCESSOR_ACTOR_SNAPSHOT_DOMAIN = 'alcheme.governance.continuity-successor-actors';

export interface GovernanceContinuityIncidentResolution {
  kind: 'compromised_key_binding_replacement';
  previousBindingId: string;
  previousEvidenceDigest: string;
  faultEvidenceRef: string;
  affectedActorPubkey: string;
  replacementActorPubkey: string;
  incidentReviewRef: string;
  incidentReviewSummary: string;
  successorActorSnapshot: Array<{
    pubkey: string;
    role: string | null;
    weight: string;
    source: string;
  }>;
  successorActorSnapshotDigest: string;
  internalCapabilityRevoke: 'supersede_previous_binding_atomically';
  ratificationRequirement: 'accepted_binding_replacement_decision';
  resourcePause: 'not_claimed_p06_authority_required';
  externalSignerRevoke: 'p06_provider_readback_required';
}

export function buildGovernanceContinuitySuccessorActorSnapshot(
  actors: Array<{
    pubkey?: unknown;
    role?: unknown;
    weight?: unknown;
    source?: unknown;
  }>,
): GovernanceContinuityIncidentResolution['successorActorSnapshot'] {
  return actors.map((actor) => ({
    pubkey: String(actor.pubkey ?? '').trim(),
    role: actor.role == null ? null : String(actor.role),
    weight: String(actor.weight ?? '1'),
    source: String(actor.source ?? 'committee_member'),
  })).sort((left, right) => left.pubkey.localeCompare(right.pubkey));
}

export function governanceContinuitySuccessorActorSnapshotDigest(
  snapshot: GovernanceContinuityIncidentResolution['successorActorSnapshot'],
): string {
  return hashCanonicalGovernanceValue(SUCCESSOR_ACTOR_SNAPSHOT_DOMAIN, snapshot);
}

export function normalizeGovernanceContinuityIncidentResolution(
  value: unknown,
): GovernanceContinuityIncidentResolution | null {
  if (value == null) return null;
  const record = asRecord(value);
  const snapshot = Array.isArray(record.successorActorSnapshot)
    ? buildGovernanceContinuitySuccessorActorSnapshot(
        record.successorActorSnapshot.map((actor) => asRecord(actor)),
      )
    : [];
  const normalized: GovernanceContinuityIncidentResolution = {
    kind: record.kind === 'compromised_key_binding_replacement'
      ? record.kind
      : 'compromised_key_binding_replacement',
    previousBindingId: text(record.previousBindingId),
    previousEvidenceDigest: text(record.previousEvidenceDigest),
    faultEvidenceRef: text(record.faultEvidenceRef),
    affectedActorPubkey: text(record.affectedActorPubkey),
    replacementActorPubkey: text(record.replacementActorPubkey),
    incidentReviewRef: text(record.incidentReviewRef),
    incidentReviewSummary: text(record.incidentReviewSummary),
    successorActorSnapshot: snapshot,
    successorActorSnapshotDigest: text(record.successorActorSnapshotDigest),
    internalCapabilityRevoke: 'supersede_previous_binding_atomically',
    ratificationRequirement: 'accepted_binding_replacement_decision',
    resourcePause: 'not_claimed_p06_authority_required',
    externalSignerRevoke: 'p06_provider_readback_required',
  };
  if (
    record.kind !== normalized.kind
    || !normalized.previousBindingId
    || !/^[a-f0-9]{64}$/.test(normalized.previousEvidenceDigest)
    || !normalized.faultEvidenceRef
    || normalized.faultEvidenceRef.length > 512
    || !normalized.affectedActorPubkey
    || !normalized.replacementActorPubkey
    || normalized.affectedActorPubkey === normalized.replacementActorPubkey
    || !normalized.incidentReviewRef
    || normalized.incidentReviewRef.length > 512
    || !normalized.incidentReviewSummary
    || normalized.incidentReviewSummary.length > 2_000
    || snapshot.length === 0
    || snapshot.some((actor) => !actor.pubkey)
    || new Set(snapshot.map((actor) => actor.pubkey)).size !== snapshot.length
    || snapshot.some((actor) => actor.pubkey === normalized.affectedActorPubkey)
    || !snapshot.some((actor) => actor.pubkey === normalized.replacementActorPubkey)
    || governanceContinuitySuccessorActorSnapshotDigest(snapshot)
      !== normalized.successorActorSnapshotDigest
    || record.internalCapabilityRevoke !== normalized.internalCapabilityRevoke
    || record.ratificationRequirement !== normalized.ratificationRequirement
    || record.resourcePause !== normalized.resourcePause
    || record.externalSignerRevoke !== normalized.externalSignerRevoke
  ) throw new Error('governance_continuity_incident_resolution_invalid');
  return normalized;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
