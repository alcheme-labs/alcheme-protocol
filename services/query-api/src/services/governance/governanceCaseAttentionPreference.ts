export type GovernanceCaseAttentionLevel = 'watch' | 'track' | 'mute';

export interface GovernanceCaseAttentionPreferenceReadback {
  schemaVersion: 1;
  level: GovernanceCaseAttentionLevel;
  version: number;
  persisted: boolean;
  ordinaryUpdatePolicy: 'high_attention' | 'normal_attention' | 'muted';
  requiredActionPolicy: 'always_deliver';
  updatedAt: Date | null;
}

export class GovernanceCaseAttentionPreferenceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'GovernanceCaseAttentionPreferenceError';
  }
}

const LEVELS = new Set<GovernanceCaseAttentionLevel>(['watch', 'track', 'mute']);

export function isGovernanceCaseAttentionLevel(value: unknown): value is GovernanceCaseAttentionLevel {
  return typeof value === 'string' && LEVELS.has(value as GovernanceCaseAttentionLevel);
}

export async function readGovernanceCaseAttentionPreference(
  prisma: any,
  input: { caseId: string; userId: number },
): Promise<GovernanceCaseAttentionPreferenceReadback> {
  const current = await prisma.governanceCaseAttentionPreference.findUnique({
    where: { caseId_userId: { caseId: input.caseId, userId: input.userId } },
  });
  if (!current) return projectPreference(null);
  if (!isGovernanceCaseAttentionLevel(current.level)
    || !Number.isSafeInteger(current.version)
    || current.version <= 0) {
    throw new GovernanceCaseAttentionPreferenceError(409, 'governance_case_attention_preference_invalid');
  }
  return projectPreference(current);
}

export async function setGovernanceCaseAttentionPreference(
  prisma: any,
  input: {
    caseId: string;
    userId: number;
    level: GovernanceCaseAttentionLevel;
    expectedVersion: number;
  },
): Promise<{ preference: GovernanceCaseAttentionPreferenceReadback; replayed: boolean }> {
  if (!input.caseId.trim()
    || !Number.isSafeInteger(input.userId)
    || input.userId <= 0
    || !isGovernanceCaseAttentionLevel(input.level)
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 0) {
    throw new GovernanceCaseAttentionPreferenceError(400, 'governance_case_attention_preference_invalid');
  }
  return prisma.$transaction(async (tx: any) => {
    const where = { caseId_userId: { caseId: input.caseId, userId: input.userId } };
    const current = await tx.governanceCaseAttentionPreference.findUnique({ where });
    if (!current) {
      if (input.expectedVersion !== 0) {
        throw new GovernanceCaseAttentionPreferenceError(409, 'governance_case_attention_preference_stale');
      }
      try {
        const created = await tx.governanceCaseAttentionPreference.create({ data: {
          caseId: input.caseId,
          userId: input.userId,
          level: input.level,
          version: 1,
        } });
        return { preference: projectPreference(created), replayed: false };
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new GovernanceCaseAttentionPreferenceError(409, 'governance_case_attention_preference_stale');
        }
        throw error;
      }
    }
    if (!isGovernanceCaseAttentionLevel(current.level)
      || current.version !== input.expectedVersion) {
      throw new GovernanceCaseAttentionPreferenceError(409, 'governance_case_attention_preference_stale');
    }
    if (current.level === input.level) {
      return { preference: projectPreference(current), replayed: true };
    }
    const updated = await tx.governanceCaseAttentionPreference.updateMany({
      where: { caseId: input.caseId, userId: input.userId, version: input.expectedVersion },
      data: { level: input.level, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseAttentionPreferenceError(409, 'governance_case_attention_preference_stale');
    }
    const readback = await tx.governanceCaseAttentionPreference.findUnique({ where });
    if (!readback || readback.version !== input.expectedVersion + 1 || readback.level !== input.level) {
      throw new GovernanceCaseAttentionPreferenceError(409, 'governance_case_attention_preference_readback_mismatch');
    }
    return { preference: projectPreference(readback), replayed: false };
  });
}

function projectPreference(value: any): GovernanceCaseAttentionPreferenceReadback {
  const level: GovernanceCaseAttentionLevel = value?.level ?? 'track';
  return {
    schemaVersion: 1,
    level,
    version: value?.version ?? 0,
    persisted: Boolean(value),
    ordinaryUpdatePolicy: level === 'watch'
      ? 'high_attention'
      : level === 'mute' ? 'muted' : 'normal_attention',
    requiredActionPolicy: 'always_deliver',
    updatedAt: value?.updatedAt ?? null,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && String((error as any).code ?? '') === 'P2002');
}
