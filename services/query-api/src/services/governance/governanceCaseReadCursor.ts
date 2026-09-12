export type GovernanceCaseReadStatus = 'new' | 'changed' | 'unchanged';

export interface GovernanceCaseReadState {
  schemaVersion: 1;
  status: GovernanceCaseReadStatus;
  currentActivityCursor: string;
  version: number;
  lastReadAt: Date | null;
  resumeFragment: string | null;
  resumeUrl: string;
}

export class GovernanceCaseReadCursorError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'GovernanceCaseReadCursorError';
  }
}

const RESUME_FRAGMENTS = new Set([
  'governance-case-attention-title',
  'governance-case-authority-title',
  'governance-case-visibility-title',
  'configuration-transition-impact',
  'case-workflow-title',
  'case-member-rights-title',
  'case-actual-outcome-title',
  'case-responsibility-coordinator',
  'case-responsibility-review',
  'case-focus-action',
  'case-responsibility-execution',
  'case-responsibility-outcome',
  'case-manual-execution-control',
  'case-public-decision-summary-title',
  'case-ballot-disclosure-title',
  'case-decision-stages-title',
  'case-decision-output-title',
  'case-grant-agreement-title',
  'case-brief-title',
  'case-brief-actors-title',
  'case-brief-content-history-title',
  'case-brief-sources-title',
  'case-brief-claims-title',
  'case-brief-readiness-title',
]);

export function isGovernanceCaseResumeFragment(value: unknown): value is string {
  return typeof value === 'string' && RESUME_FRAGMENTS.has(value);
}

export function governanceCaseActivityCursor(value: any): string {
  const candidates: Array<{ at: string; kind: string; id: string }> = [];
  const add = (kind: string, id: unknown, dateValue: unknown) => {
    if (dateValue == null) return;
    const date = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
    if (Number.isNaN(date.getTime())) return;
    candidates.push({ at: date.toISOString(), kind, id: String(id ?? '') });
  };
  add('case', value?.id, value?.updatedAt ?? value?.openedAt ?? value?.createdAt);
  const request = value?.primaryRequest;
  add('request', request?.id, request?.updatedAt ?? request?.createdAt ?? request?.openedAt);
  add('snapshot', request?.snapshot?.id, request?.snapshot?.createdAt);
  for (const signal of Array.isArray(request?.signals) ? request.signals : []) {
    add('signal', signal?.id, signal?.createdAt);
  }
  add('decision', request?.decision?.requestId, request?.decision?.createdAt ?? request?.decision?.decidedAt);
  for (const receipt of Array.isArray(request?.receipts) ? request.receipts : []) {
    add('receipt', receipt?.id, receipt?.createdAt ?? receipt?.executedAt);
  }
  for (const responsibility of Array.isArray(value?.responsibilities) ? value.responsibilities : []) {
    add('responsibility', responsibility?.id ?? responsibility?.kind, responsibility?.updatedAt ?? responsibility?.createdAt);
  }
  for (const artifact of Array.isArray(value?.decisionOutputArtifacts) ? value.decisionOutputArtifacts : []) {
    add('artifact', artifact?.id, artifact?.createdAt);
  }
  for (const event of Array.isArray(value?.timelineEvents) ? value.timelineEvents : []) {
    add('timeline', event?.id, event?.createdAt);
  }
  candidates.sort((left, right) => (
    left.at.localeCompare(right.at)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)
  ));
  const latest = candidates.at(-1);
  if (!latest) throw new GovernanceCaseReadCursorError(409, 'governance_case_activity_unavailable');
  return `${latest.at}|${latest.kind}|${encodeURIComponent(latest.id)}`;
}

export async function readGovernanceCaseReadState(
  prisma: any,
  input: { caseId: string; userId: number; currentActivityCursor: string },
): Promise<GovernanceCaseReadState> {
  const cursor = await prisma.governanceCaseReadCursor.findUnique({
    where: { caseId_userId: { caseId: input.caseId, userId: input.userId } },
  });
  return projectGovernanceCaseReadState(input.caseId, input.currentActivityCursor, cursor);
}

export async function setGovernanceCaseReadCursor(
  prisma: any,
  input: {
    caseId: string;
    userId: number;
    activityCursor: string;
    observedActivityCursor: string;
    resumeFragment: string | null;
    visitId: string;
    expectedVersion: number;
    readAt: Date;
  },
): Promise<{ readState: GovernanceCaseReadState; replayed: boolean }> {
  if (!input.caseId.trim()
    || !Number.isSafeInteger(input.userId)
    || input.userId <= 0
    || !input.activityCursor.trim()
    || !input.visitId.trim()
    || input.visitId.length > 96
    || input.activityCursor !== input.observedActivityCursor
    || (input.resumeFragment != null && !isGovernanceCaseResumeFragment(input.resumeFragment))
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 0
    || Number.isNaN(input.readAt.getTime())) {
    throw new GovernanceCaseReadCursorError(
      input.activityCursor !== input.observedActivityCursor ? 409 : 400,
      input.activityCursor !== input.observedActivityCursor
        ? 'governance_case_read_cursor_activity_stale'
        : 'governance_case_read_cursor_invalid',
    );
  }
  return prisma.$transaction(async (tx: any) => {
    const where = { caseId_userId: { caseId: input.caseId, userId: input.userId } };
    const current = await tx.governanceCaseReadCursor.findUnique({ where });
    if (!current) {
      if (input.expectedVersion !== 0) {
        throw new GovernanceCaseReadCursorError(409, 'governance_case_read_cursor_stale');
      }
      try {
        const created = await tx.governanceCaseReadCursor.create({ data: {
          caseId: input.caseId,
          userId: input.userId,
          activityCursor: input.observedActivityCursor,
          resumeFragment: input.resumeFragment,
          visitId: input.visitId,
          version: 1,
          readAt: input.readAt,
        } });
        return {
          readState: projectGovernanceCaseReadState(
            input.caseId,
            input.observedActivityCursor,
            created,
          ),
          replayed: false,
        };
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new GovernanceCaseReadCursorError(409, 'governance_case_read_cursor_stale');
        }
        throw error;
      }
    }
    if (!Number.isSafeInteger(current.version) || current.version !== input.expectedVersion) {
      throw new GovernanceCaseReadCursorError(409, 'governance_case_read_cursor_stale');
    }
    if (current.visitId === input.visitId
      && current.activityCursor === input.observedActivityCursor
      && (current.resumeFragment ?? null) === input.resumeFragment) {
      return {
        readState: projectGovernanceCaseReadState(
          input.caseId,
          input.observedActivityCursor,
          current,
        ),
        replayed: true,
      };
    }
    const updated = await tx.governanceCaseReadCursor.updateMany({
      where: { caseId: input.caseId, userId: input.userId, version: input.expectedVersion },
      data: {
        activityCursor: input.observedActivityCursor,
        resumeFragment: input.resumeFragment,
        visitId: input.visitId,
        readAt: input.readAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseReadCursorError(409, 'governance_case_read_cursor_stale');
    }
    const readback = await tx.governanceCaseReadCursor.findUnique({ where });
    if (!readback
      || readback.version !== input.expectedVersion + 1
      || readback.activityCursor !== input.observedActivityCursor
      || readback.visitId !== input.visitId
      || (readback.resumeFragment ?? null) !== input.resumeFragment) {
      throw new GovernanceCaseReadCursorError(409, 'governance_case_read_cursor_readback_mismatch');
    }
    return {
      readState: projectGovernanceCaseReadState(
        input.caseId,
        input.observedActivityCursor,
        readback,
      ),
      replayed: false,
    };
  });
}

export function projectGovernanceCaseReadState(
  caseId: string,
  currentActivityCursor: string,
  cursor: any | null,
): GovernanceCaseReadState {
  const resumeFragment = cursor?.resumeFragment == null
    ? null
    : isGovernanceCaseResumeFragment(cursor.resumeFragment) ? cursor.resumeFragment : null;
  if (cursor && (!Number.isSafeInteger(cursor.version) || cursor.version <= 0)) {
    throw new GovernanceCaseReadCursorError(409, 'governance_case_read_cursor_invalid');
  }
  return {
    schemaVersion: 1,
    status: !cursor
      ? 'new'
      : cursor.activityCursor === currentActivityCursor ? 'unchanged' : 'changed',
    currentActivityCursor,
    version: cursor?.version ?? 0,
    lastReadAt: cursor?.readAt ?? null,
    resumeFragment,
    resumeUrl: `/governance/cases/${encodeURIComponent(caseId)}${resumeFragment ? `#${resumeFragment}` : ''}`,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && String((error as any).code ?? '') === 'P2002');
}
