import { isDeepStrictEqual } from 'node:util';

import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { GOVERNED_ACTION_INVOCATION_STATES } from './operationEffectLifecycle';
import { GOVERNED_ACTION_IDEMPOTENCY_SCOPE } from './governedActionInvocationLineage';

export interface GovernedActionInvocationWrite {
  id: string;
  contractVersionId: string;
  profileBindingId: string;
  governanceHomeType: string;
  governanceHomeRef: string;
  actorPubkey: string | null;
  subjectType: string;
  subjectRef: string;
  payloadSchemaVersion: string;
  payloadDigest: string;
  reasonDigest: string | null;
  requestedEffect: Record<string, unknown>;
  collectiveCommitmentRequired: boolean;
  idempotencyKey: string;
  idempotencyScope: string;
  idempotencyWindowStart: Date | null;
  idempotencyWindowEnd: Date | null;
  attemptKey: string;
  recurrenceKey: string | null;
  previousReceiptRef: string | null;
  preflightStatus: string;
  preflightDigest: string | null;
  state: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedActionAuthoritySnapshotWrite {
  id: string;
  invocationId: string;
  bindingId: string | null;
  authoritySourceType: string;
  authoritySourceRef: string;
  authoritySourceVersion: string | null;
  profileBindingId: string;
  profileVersionRef: string | null;
  providerVersionRef: string | null;
  selectorDigest: string;
  capabilityDigest: string;
  resolvedSubjectDigest: string;
  resolvedPayloadDigest: string;
  liveConfigDigest: string;
  decisionPath: string;
  riskFloor: string;
  resolverVersion: string;
  validFrom: Date;
  validUntil: Date | null;
  snapshotDigest: string;
  createdAt: Date;
}

export interface GovernedActionInvocationStore {
  openInvocationWithAuthoritySnapshot(input: {
    invocation: GovernedActionInvocationWrite;
    authoritySnapshot: ResolvedActionAuthoritySnapshotWrite;
  }): Promise<{
    invocation: GovernedActionInvocationWrite;
    authoritySnapshot: ResolvedActionAuthoritySnapshotWrite;
  }>;
}

interface InvocationPersistenceClient {
  governedActionInvocation: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
  };
  resolvedActionAuthoritySnapshot: {
    create(input: unknown): Promise<any>;
  };
}

type InvocationPersistencePrisma = InvocationPersistenceClient & {
  $transaction<T>(operation: (tx: InvocationPersistenceClient) => Promise<T>): Promise<T>;
};

export function createPrismaGovernedActionInvocationStore(
  prisma: InvocationPersistencePrisma,
  options: { transactionClient?: boolean } = {},
): GovernedActionInvocationStore {
  return {
    async openInvocationWithAuthoritySnapshot(input) {
      assertInvocationPair(input.invocation, input.authoritySnapshot);
      try {
        const persist = async (tx: InvocationPersistenceClient) => {
          const existing = await readInvocationPair(tx, input.invocation.id);
          if (existing) {
            return exactExistingPair(existing, input);
          }
          const invocation = await tx.governedActionInvocation.create({
            data: input.invocation,
          });
          const authoritySnapshot = await tx.resolvedActionAuthoritySnapshot.create({
            data: input.authoritySnapshot,
          });
          return {
            invocation: pickInvocation(invocation),
            authoritySnapshot: pickAuthoritySnapshot(authoritySnapshot),
          };
        };
        return options.transactionClient
          ? await persist(prisma)
          : await prisma.$transaction(persist);
      } catch (error) {
        if (options.transactionClient) throw error;
        if (!isUniqueConstraintError(error)) throw error;
        const raced = await readInvocationPair(prisma, input.invocation.id);
        if (!raced) throw error;
        return exactExistingPair(raced, input);
      }
    },
  };
}

function readInvocationPair(
  client: InvocationPersistenceClient,
  invocationId: string,
): Promise<any> {
  return client.governedActionInvocation.findUnique({
    where: { id: invocationId },
    include: { authoritySnapshot: true },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002'
  );
}

function exactExistingPair(
  existing: any,
  input: {
    invocation: GovernedActionInvocationWrite;
    authoritySnapshot: ResolvedActionAuthoritySnapshotWrite;
  },
): {
  invocation: GovernedActionInvocationWrite;
  authoritySnapshot: ResolvedActionAuthoritySnapshotWrite;
} {
  if (!existing.authoritySnapshot) {
    throw new Error('governed_action_invocation_authority_snapshot_missing');
  }
  const pair = {
    invocation: pickInvocation(existing),
    authoritySnapshot: pickAuthoritySnapshot(existing.authoritySnapshot),
  };
  if (
    !isDeepStrictEqual(immutableInvocationFacts(pair.invocation), immutableInvocationFacts(input.invocation))
    || !isDeepStrictEqual(
      immutableAuthoritySnapshotFacts(pair.authoritySnapshot),
      immutableAuthoritySnapshotFacts(input.authoritySnapshot),
    )
  ) {
    throw new Error('governed_action_invocation_immutable_mismatch');
  }
  return pair;
}

function immutableInvocationFacts(value: GovernedActionInvocationWrite) {
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    state: _state,
    ...facts
  } = value;
  return facts;
}

function immutableAuthoritySnapshotFacts(value: ResolvedActionAuthoritySnapshotWrite) {
  const { createdAt: _createdAt, validFrom: _validFrom, ...facts } = value;
  return facts;
}

function assertInvocationPair(
  invocation: GovernedActionInvocationWrite,
  snapshot: ResolvedActionAuthoritySnapshotWrite,
): void {
  if (snapshot.invocationId !== invocation.id) {
    throw new Error('governed_action_invocation_authority_snapshot_link_mismatch');
  }
  if (!(GOVERNED_ACTION_INVOCATION_STATES as readonly string[]).includes(invocation.state)) {
    throw new Error('governed_action_invocation_state_invalid');
  }
  for (const value of [
    invocation.id,
    invocation.contractVersionId,
    invocation.profileBindingId,
    invocation.governanceHomeType,
    invocation.governanceHomeRef,
    invocation.subjectType,
    invocation.subjectRef,
    invocation.payloadSchemaVersion,
    invocation.idempotencyKey,
    invocation.idempotencyScope,
    invocation.attemptKey,
    invocation.recurrenceKey,
    invocation.preflightStatus,
    invocation.state,
    snapshot.id,
    snapshot.authoritySourceType,
    snapshot.authoritySourceRef,
    snapshot.profileBindingId,
    snapshot.decisionPath,
    snapshot.riskFloor,
    snapshot.resolverVersion,
  ]) {
    if (!value?.trim()) {
      throw new Error('governed_action_invocation_required_fact_missing');
    }
  }
  if (invocation.actorPubkey !== null) {
    const actor = canonicalSolanaPublicKeyString(invocation.actorPubkey);
    if (!actor || actor !== invocation.actorPubkey) {
      throw new Error('invalid_governed_action_invocation_actor_pubkey');
    }
  }
  for (const digest of [
    invocation.payloadDigest,
    invocation.reasonDigest,
    invocation.preflightDigest,
    snapshot.selectorDigest,
    snapshot.capabilityDigest,
    snapshot.resolvedSubjectDigest,
    snapshot.resolvedPayloadDigest,
    snapshot.liveConfigDigest,
    snapshot.snapshotDigest,
  ]) {
    if (digest !== null && !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('invalid_governed_action_invocation_digest');
    }
  }
  if (snapshot.resolvedPayloadDigest !== invocation.payloadDigest) {
    throw new Error('governed_action_invocation_payload_authority_mismatch');
  }
  if (snapshot.profileBindingId !== invocation.profileBindingId) {
    throw new Error('governed_action_invocation_profile_binding_mismatch');
  }
  if (
    (invocation.idempotencyWindowStart === null)
    !== (invocation.idempotencyWindowEnd === null)
  ) {
    throw new Error('invalid_governed_action_invocation_idempotency_window');
  }
  if (
    invocation.idempotencyWindowStart
    && invocation.idempotencyWindowEnd
    && invocation.idempotencyWindowEnd.getTime() <= invocation.idempotencyWindowStart.getTime()
  ) {
    throw new Error('invalid_governed_action_invocation_idempotency_window');
  }
  const attemptPrefix = `${invocation.id}:attempt:`;
  if (invocation.idempotencyScope !== GOVERNED_ACTION_IDEMPOTENCY_SCOPE
    || !/^[1-9][0-9]*$/.test(invocation.attemptKey.slice(attemptPrefix.length))
    || !invocation.attemptKey.startsWith(attemptPrefix)
    || !/^governed-recurrence:[a-f0-9]{64}$/.test(invocation.recurrenceKey ?? '')) {
    throw new Error('invalid_governed_action_invocation_lineage');
  }
  if (
    snapshot.validUntil
    && snapshot.validUntil.getTime() <= snapshot.validFrom.getTime()
  ) {
    throw new Error('invalid_governed_action_authority_snapshot_window');
  }
}

function pickInvocation(value: any): GovernedActionInvocationWrite {
  return {
    id: value.id,
    contractVersionId: value.contractVersionId,
    profileBindingId: value.profileBindingId,
    governanceHomeType: value.governanceHomeType,
    governanceHomeRef: value.governanceHomeRef,
    actorPubkey: value.actorPubkey ?? null,
    subjectType: value.subjectType,
    subjectRef: value.subjectRef,
    payloadSchemaVersion: value.payloadSchemaVersion,
    payloadDigest: value.payloadDigest,
    reasonDigest: value.reasonDigest ?? null,
    requestedEffect: value.requestedEffect,
    collectiveCommitmentRequired: value.collectiveCommitmentRequired,
    idempotencyKey: value.idempotencyKey,
    idempotencyScope: value.idempotencyScope,
    idempotencyWindowStart: value.idempotencyWindowStart ?? null,
    idempotencyWindowEnd: value.idempotencyWindowEnd ?? null,
    attemptKey: value.attemptKey,
    recurrenceKey: value.recurrenceKey ?? null,
    previousReceiptRef: value.previousReceiptRef ?? null,
    preflightStatus: value.preflightStatus,
    preflightDigest: value.preflightDigest ?? null,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function pickAuthoritySnapshot(value: any): ResolvedActionAuthoritySnapshotWrite {
  return {
    id: value.id,
    invocationId: value.invocationId,
    bindingId: value.bindingId ?? null,
    authoritySourceType: value.authoritySourceType,
    authoritySourceRef: value.authoritySourceRef,
    authoritySourceVersion: value.authoritySourceVersion ?? null,
    profileBindingId: value.profileBindingId,
    profileVersionRef: value.profileVersionRef ?? null,
    providerVersionRef: value.providerVersionRef ?? null,
    selectorDigest: value.selectorDigest,
    capabilityDigest: value.capabilityDigest,
    resolvedSubjectDigest: value.resolvedSubjectDigest,
    resolvedPayloadDigest: value.resolvedPayloadDigest,
    liveConfigDigest: value.liveConfigDigest,
    decisionPath: value.decisionPath,
    riskFloor: value.riskFloor,
    resolverVersion: value.resolverVersion,
    validFrom: value.validFrom,
    validUntil: value.validUntil ?? null,
    snapshotDigest: value.snapshotDigest,
    createdAt: value.createdAt,
  };
}
