import { createHash } from 'node:crypto';

export class ExternalGovernedActionRecurrenceError extends Error {
  statusCode: number;
  code: string;
  existingCaseId?: string;

  constructor(statusCode: number, code: string, existingCaseId?: string) {
    super(code);
    this.name = 'ExternalGovernedActionRecurrenceError';
    this.statusCode = statusCode;
    this.code = code;
    this.existingCaseId = existingCaseId;
  }
}

export type ExternalGovernedActionRecurrenceReservationInput = {
  actionType: string;
  subjectType: string;
  subjectRef: string;
  recurrenceEpoch: number;
  intentDigest: string;
};

export function buildExternalGovernedActionIntentDigest(input: {
  expectedSnapshotVersion: string;
  expectedSnapshotDigest: string;
  requestedActionPayload?: unknown;
  statePrecondition?: unknown;
  rationaleDigest?: string | null;
}): string {
  return createHash('sha256')
    .update(stableJson({
      scope: 'external_governed_action_intent_v1',
      expectedSnapshotVersion: String(input.expectedSnapshotVersion || '').trim(),
      expectedSnapshotDigest: String(input.expectedSnapshotDigest || '').trim(),
      requestedActionPayload: input.requestedActionPayload ?? null,
      statePrecondition: input.statePrecondition ?? null,
      rationaleDigest: String(input.rationaleDigest || '').trim() || null,
    }), 'utf8')
    .digest('hex');
}

export function buildExternalGovernedActionRecurrenceKey(input: {
  circleId: number;
  actionType: string;
  candidateRef: string;
  recurrenceEpoch: number;
}): string {
  const epoch = Number(input.recurrenceEpoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new ExternalGovernedActionRecurrenceError(400, 'external_governed_action_recurrence_epoch_invalid');
  }
  const digest = createHash('sha256')
    .update(stableJson({
      scope: 'external_governed_action_recurrence_v3',
      circleId: input.circleId,
      actionType: input.actionType,
      candidateRef: String(input.candidateRef || '').trim(),
      recurrenceEpoch: epoch,
    }), 'utf8')
    .digest('hex');
  return `ext-recurrence:${digest}`;
}

/** Non-terminal for recurrence: phase not closed/cancelled AND outcome not rejected/expired/cancelled.
 *  `accepted` still occupies the epoch until the Case reaches a terminal phase. */
function nonTerminalGovernanceCaseWhere(): Record<string, unknown> {
  return {
    casePhase: { notIn: ['closed', 'cancelled', 'archived'] },
    OR: [
      { decisionOutcome: null },
      { decisionOutcome: 'pending' },
      { decisionOutcome: 'accepted' },
    ],
  };
}

export async function resolveExternalGovernedActionRecurrenceEpoch(
  prisma: any,
  input: {
    circleId: number;
    actionType: string;
    subjectType: string;
    subjectRef: string;
  },
): Promise<number> {
  const subjectRef = String(input.subjectRef || '').trim();
  if (!subjectRef) return 1;
  if (typeof prisma.externalGovernedActionRecurrenceReservation?.findMany !== 'function') {
    return 1;
  }
  const reservations = await prisma.externalGovernedActionRecurrenceReservation.findMany({
    where: {
      actionType: input.actionType,
      subjectType: input.subjectType,
      subjectRef,
      homeIdentityBinding: {
        homeType: 'circle',
        homeRef: String(input.circleId),
      },
    },
    select: {
      recurrenceEpoch: true,
      governanceCaseId: true,
    },
    orderBy: { recurrenceEpoch: 'desc' },
  });
  if (reservations.length === 0) {
    // Legacy Cases without reservation occupy epoch 1; only open N+1 after all are terminal.
    if (typeof prisma.governanceCase?.findFirst !== 'function') return 1;
    const openLegacy = await prisma.governanceCase.findFirst({
      where: {
        subjectType: input.subjectType,
        subjectRef,
        homeIdentityBinding: {
          homeType: 'circle',
          homeRef: String(input.circleId),
        },
        ...nonTerminalGovernanceCaseWhere(),
      },
      select: { id: true },
    });
    if (openLegacy) return 1;
    const anyLegacy = await prisma.governanceCase.findFirst({
      where: {
        subjectType: input.subjectType,
        subjectRef,
        homeIdentityBinding: {
          homeType: 'circle',
          homeRef: String(input.circleId),
        },
      },
      select: { id: true },
    });
    return anyLegacy ? 2 : 1;
  }
  const caseIds = reservations
    .map((row: { governanceCaseId: string | null }) => row.governanceCaseId)
    .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0);
  const openCases = caseIds.length > 0
    ? await prisma.governanceCase.findMany({
      where: {
        id: { in: caseIds },
        ...nonTerminalGovernanceCaseWhere(),
      },
      select: { id: true },
    })
    : [];
  const openIds = new Set(openCases.map((row: { id: string }) => row.id));
  for (const row of reservations) {
    if (!row.governanceCaseId) return row.recurrenceEpoch;
    if (openIds.has(row.governanceCaseId)) return row.recurrenceEpoch;
  }
  return Number(reservations[0].recurrenceEpoch) + 1;
}

export async function assertExternalGovernedActionRecurrenceAvailable(
  prisma: any,
  input: {
    circleId: number;
    actionType: string;
    subjectType: string;
    subjectRef: string;
    recurrenceKey: string;
    intentDigest: string;
    recurrenceEpoch: number;
  },
): Promise<void> {
  const subjectRef = String(input.subjectRef || '').trim();
  if (!subjectRef) return;
  if (typeof prisma.externalGovernedActionRecurrenceReservation?.findUnique === 'function') {
    const homes = await prisma.governanceHomeIdentityBinding?.findMany?.({
      where: {
        homeType: 'circle',
        homeRef: String(input.circleId),
        status: 'active',
      },
      select: { id: true },
      take: 8,
    }) ?? [];
    for (const home of homes) {
      const existing = await prisma.externalGovernedActionRecurrenceReservation.findUnique({
        where: {
          homeIdentityBindingId_actionType_subjectType_subjectRef_recurrenceEpoch: {
            homeIdentityBindingId: home.id,
            actionType: input.actionType,
            subjectType: input.subjectType,
            subjectRef,
            recurrenceEpoch: input.recurrenceEpoch,
          },
        },
        select: {
          intentDigest: true,
          governanceCaseId: true,
        },
      });
      if (!existing) continue;
      if (existing.intentDigest !== input.intentDigest) {
        throw new ExternalGovernedActionRecurrenceError(
          409,
          'external_governed_action_recurrence_conflict',
          existing.governanceCaseId ?? undefined,
        );
      }
      return;
    }
  }
  const openCases = await prisma.governanceCase.findMany({
    where: {
      subjectType: input.subjectType,
      subjectRef,
      ...nonTerminalGovernanceCaseWhere(),
    },
    select: {
      id: true,
      idempotencyKey: true,
      homeIdentityBinding: { select: { homeType: true, homeRef: true } },
      templateSelection: true,
    },
    orderBy: { openedAt: 'desc' },
  });
  for (const existing of openCases) {
    if (
      existing.homeIdentityBinding?.homeType !== 'circle'
      || String(existing.homeIdentityBinding.homeRef) !== String(input.circleId)
    ) {
      continue;
    }
    const existingAction = String(
      (existing.templateSelection as any)?.action?.type
      || (existing.templateSelection as any)?.actionType
      || '',
    ).trim();
    if (existingAction && existingAction !== input.actionType) continue;
    if (existing.idempotencyKey === input.recurrenceKey) continue;
    throw new ExternalGovernedActionRecurrenceError(
      409,
      'external_governed_action_recurrence_conflict',
      existing.id,
    );
  }
}

export async function reserveExternalGovernedActionRecurrenceInTransaction(
  tx: any,
  input: {
    homeIdentityBindingId: string;
    actionType: string;
    subjectType: string;
    subjectRef: string;
    recurrenceEpoch: number;
    intentDigest: string;
  },
): Promise<
  | { kind: 'acquired'; reservationId: string }
  | { kind: 'replay'; reservationId: string; governanceCaseId: string | null }
> {
  const intentDigest = String(input.intentDigest || '').trim();
  if (!/^[a-f0-9]{64}$/.test(intentDigest)) {
    throw new ExternalGovernedActionRecurrenceError(400, 'external_governed_action_intent_digest_invalid');
  }
  const epoch = Number(input.recurrenceEpoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new ExternalGovernedActionRecurrenceError(400, 'external_governed_action_recurrence_epoch_invalid');
  }
  const subjectRef = String(input.subjectRef || '').trim();
  const reservationId = `ext-recurrence-res:${createHash('sha256')
    .update(stableJson({
      homeIdentityBindingId: input.homeIdentityBindingId,
      actionType: input.actionType,
      subjectType: input.subjectType,
      subjectRef,
      recurrenceEpoch: epoch,
    }), 'utf8')
    .digest('hex')
    .slice(0, 48)}`;
  const queryRawUnsafe = tx.$queryRawUnsafe;
  if (typeof queryRawUnsafe === 'function') {
    // PostgreSQL unique conflicts abort the transaction; never create-then-catch P2002 here.
    const inserted = await queryRawUnsafe.call(
      tx,
      `INSERT INTO "external_governed_action_recurrence_reservations" (
         "id", "home_identity_binding_id", "action_type", "subject_type", "subject_ref",
         "recurrence_epoch", "intent_digest", "governance_case_id", "created_at", "updated_at"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      reservationId,
      input.homeIdentityBindingId,
      input.actionType,
      input.subjectType,
      subjectRef,
      epoch,
      intentDigest,
    ) as Array<{ id: string }>;
    if (Array.isArray(inserted) && inserted.length > 0) {
      return { kind: 'acquired', reservationId: String(inserted[0]!.id) };
    }
    return readExternalGovernedActionRecurrenceWinner(tx, {
      homeIdentityBindingId: input.homeIdentityBindingId,
      actionType: input.actionType,
      subjectType: input.subjectType,
      subjectRef,
      recurrenceEpoch: epoch,
      intentDigest,
    });
  }

  // In-memory / unit-test fallback without SQL (must not be used against real PostgreSQL).
  if (typeof tx.externalGovernedActionRecurrenceReservation?.create !== 'function') {
    return { kind: 'acquired', reservationId };
  }
  try {
    await tx.externalGovernedActionRecurrenceReservation.create({
      data: {
        id: reservationId,
        homeIdentityBindingId: input.homeIdentityBindingId,
        actionType: input.actionType,
        subjectType: input.subjectType,
        subjectRef,
        recurrenceEpoch: epoch,
        intentDigest,
        governanceCaseId: null,
      },
    });
    return { kind: 'acquired', reservationId };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return readExternalGovernedActionRecurrenceWinner(tx, {
      homeIdentityBindingId: input.homeIdentityBindingId,
      actionType: input.actionType,
      subjectType: input.subjectType,
      subjectRef,
      recurrenceEpoch: epoch,
      intentDigest,
    });
  }
}

async function readExternalGovernedActionRecurrenceWinner(
  tx: any,
  input: {
    homeIdentityBindingId: string;
    actionType: string;
    subjectType: string;
    subjectRef: string;
    recurrenceEpoch: number;
    intentDigest: string;
  },
): Promise<{ kind: 'replay'; reservationId: string; governanceCaseId: string | null }> {
  const existing = await tx.externalGovernedActionRecurrenceReservation.findUnique({
    where: {
      homeIdentityBindingId_actionType_subjectType_subjectRef_recurrenceEpoch: {
        homeIdentityBindingId: input.homeIdentityBindingId,
        actionType: input.actionType,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef,
        recurrenceEpoch: input.recurrenceEpoch,
      },
    },
    select: {
      id: true,
      intentDigest: true,
      governanceCaseId: true,
    },
  });
  if (!existing) {
    throw new ExternalGovernedActionRecurrenceError(409, 'external_governed_action_recurrence_conflict');
  }
  if (existing.intentDigest !== input.intentDigest) {
    throw new ExternalGovernedActionRecurrenceError(
      409,
      'external_governed_action_recurrence_conflict',
      existing.governanceCaseId ?? undefined,
    );
  }
  return {
    kind: 'replay',
    reservationId: existing.id,
    governanceCaseId: existing.governanceCaseId ?? null,
  };
}

export async function bindExternalGovernedActionRecurrenceReservationCase(
  tx: any,
  input: {
    reservationId: string;
    governanceCaseId: string;
  },
): Promise<void> {
  if (typeof tx.externalGovernedActionRecurrenceReservation?.updateMany === 'function') {
    const updated = await tx.externalGovernedActionRecurrenceReservation.updateMany({
      where: {
        id: input.reservationId,
        OR: [
          { governanceCaseId: null },
          { governanceCaseId: input.governanceCaseId },
        ],
      },
      data: { governanceCaseId: input.governanceCaseId },
    });
    if (typeof updated?.count === 'number' && updated.count === 1) return;
    const existing = await tx.externalGovernedActionRecurrenceReservation.findUnique?.({
      where: { id: input.reservationId },
      select: { governanceCaseId: true },
    });
    if (existing?.governanceCaseId === input.governanceCaseId) return;
    throw new ExternalGovernedActionRecurrenceError(
      409,
      'external_governed_action_recurrence_conflict',
      typeof existing?.governanceCaseId === 'string' ? existing.governanceCaseId : undefined,
    );
  }
  if (typeof tx.externalGovernedActionRecurrenceReservation?.update !== 'function') return;
  const existing = await tx.externalGovernedActionRecurrenceReservation.findUnique?.({
    where: { id: input.reservationId },
    select: { governanceCaseId: true },
  });
  if (
    existing?.governanceCaseId
    && existing.governanceCaseId !== input.governanceCaseId
  ) {
    throw new ExternalGovernedActionRecurrenceError(
      409,
      'external_governed_action_recurrence_conflict',
      existing.governanceCaseId,
    );
  }
  await tx.externalGovernedActionRecurrenceReservation.update({
    where: { id: input.reservationId },
    data: { governanceCaseId: input.governanceCaseId },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  return code === 'P2002' || /unique constraint/i.test(String((error as any)?.message || ''));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
