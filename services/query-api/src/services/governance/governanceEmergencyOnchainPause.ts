import { createHash } from 'crypto';
import {
  REALMS_EMERGENCY_ONCHAIN_PAUSE_ACTION_TYPE,
  REALMS_EMERGENCY_ONCHAIN_UNPAUSE_ACTION_TYPE,
} from './actionRegistry';

export {
  REALMS_EMERGENCY_ONCHAIN_PAUSE_ACTION_TYPE,
  REALMS_EMERGENCY_ONCHAIN_UNPAUSE_ACTION_TYPE,
};

export const SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION =
  'hosted_app_trust_root.pause_app_trust_root' as const;

export type EmergencyOnchainPauseEnforcement =
  | 'onchain_timebound'
  | 'explicit_unpause_required';

export type EmergencyOnchainPauseLifecycleState =
  | 'paused'
  | 'unpause_due'
  | 'unpause_blocked'
  | 'rollback_failed'
  | 'resumed_via_explicit_unpause'
  | 'resumed_via_onchain_timebound';

export type EmergencyOnchainPauseTarget = {
  schemaVersion: 1;
  programId: string;
  accountRef: string;
  instruction: typeof SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION;
  pauseAuthorityRef: string;
  unpauseAuthorityRef: string;
  timeboundAutoUnpauseSupported: boolean;
};

export type EmergencyOnchainPauseChainEvidence = {
  commitment: 'finalized';
  paused: boolean;
  programId: string;
  accountRef: string;
  observedSlot: number;
  receiptRef: string;
  authoritative: true;
  selfProvesPause: false;
};

export type EmergencyOnchainPauseRecord = {
  schemaVersion: 1;
  state: EmergencyOnchainPauseLifecycleState;
  requestId: string;
  decisionDigest: string;
  activatedAt: string;
  maxDurationSeconds: number;
  pauseEndsAt: string;
  pauseEnforcement: EmergencyOnchainPauseEnforcement;
  trigger: string;
  scope: string;
  pauseAuthorityRef: string;
  unpauseAuthorityRef: string;
  memberNotificationDigest: string;
  ratificationRequestId: string;
  ratificationDecisionDigest: string;
  recoveryConditionsDigest: string;
  onchainPauseInstruction: typeof SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION;
  programId: string;
  accountRef: string;
  chainPauseEvidence: EmergencyOnchainPauseChainEvidence;
  residualRisk: {
    permanentPausePossible: boolean;
    fallbackAuthority: 'none';
    workflowFreezeClaimsChainPaused: false;
    expiredAliasForbidden: true;
    resumedAliasForbidden: true;
  };
  unpause: {
    requestId: string | null;
    decisionDigest: string | null;
    completedAt: string | null;
    chainEvidence: EmergencyOnchainPauseChainEvidence | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requireDigest(value: unknown, code: string): string {
  const digest = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(code);
  return digest;
}

function requireNonEmpty(value: unknown, code: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(code);
  return text;
}

function requireSafePositiveInt(value: unknown, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(code);
  return n;
}

export function normalizeEmergencyOnchainPauseTarget(
  value: unknown,
): EmergencyOnchainPauseTarget | null {
  const target = asRecord(value);
  if (
    target.schemaVersion !== 1
    || target.instruction !== SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION
    || typeof target.programId !== 'string'
    || !target.programId.trim()
    || typeof target.accountRef !== 'string'
    || !target.accountRef.trim()
    || typeof target.pauseAuthorityRef !== 'string'
    || !target.pauseAuthorityRef.trim()
    || typeof target.unpauseAuthorityRef !== 'string'
    || !target.unpauseAuthorityRef.trim()
    || typeof target.timeboundAutoUnpauseSupported !== 'boolean'
  ) return null;
  return {
    schemaVersion: 1,
    programId: target.programId.trim(),
    accountRef: target.accountRef.trim(),
    instruction: SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION,
    pauseAuthorityRef: target.pauseAuthorityRef.trim(),
    unpauseAuthorityRef: target.unpauseAuthorityRef.trim(),
    timeboundAutoUnpauseSupported: target.timeboundAutoUnpauseSupported,
  };
}

export function assertEmergencyOnchainPauseEnablement(input: {
  target: EmergencyOnchainPauseTarget | null;
  pauseEnforcement: EmergencyOnchainPauseEnforcement;
  unpauseAuthorityPresent: boolean;
  recoveryConditionsDigest: string | null;
  memberNotificationDigest: string | null;
  ratificationRequestId: string | null;
  ratificationDecisionDigest: string | null;
}): EmergencyOnchainPauseTarget {
  if (!input.target) {
    throw new Error('emergency_onchain_pause_instruction_unavailable');
  }
  if (!input.unpauseAuthorityPresent || !input.target.unpauseAuthorityRef) {
    throw new Error('emergency_onchain_pause_unpause_authority_missing');
  }
  if (!input.recoveryConditionsDigest) {
    throw new Error('emergency_onchain_pause_recovery_readiness_missing');
  }
  if (!input.memberNotificationDigest) {
    throw new Error('emergency_onchain_pause_member_notification_missing');
  }
  if (!input.ratificationRequestId || !input.ratificationDecisionDigest) {
    throw new Error('emergency_onchain_pause_ratification_missing');
  }
  if (
    input.pauseEnforcement === 'onchain_timebound'
    && !input.target.timeboundAutoUnpauseSupported
  ) {
    throw new Error('emergency_onchain_pause_timebound_unsupported');
  }
  return input.target;
}

export type EmergencyOnchainPauseChainReader = {
  readPausedState(input: {
    programId: string;
    accountRef: string;
    expectedPaused: boolean;
    transactionSignature: string;
  }): Promise<EmergencyOnchainPauseChainEvidence>;
};

let emergencyOnchainPauseChainReader: EmergencyOnchainPauseChainReader | null = null;

export function setEmergencyOnchainPauseChainReader(
  reader: EmergencyOnchainPauseChainReader | null,
): void {
  emergencyOnchainPauseChainReader = reader;
}

export function getEmergencyOnchainPauseChainReader(): EmergencyOnchainPauseChainReader | null {
  return emergencyOnchainPauseChainReader;
}

export async function readIndependentEmergencyOnchainPauseEvidence(input: {
  programId: string;
  accountRef: string;
  expectedPaused: boolean;
  transactionSignature: string;
}): Promise<EmergencyOnchainPauseChainEvidence> {
  const reader = emergencyOnchainPauseChainReader;
  if (!reader) {
    throw new Error('emergency_onchain_pause_chain_reader_unavailable');
  }
  const evidence = await reader.readPausedState(input);
  return normalizeEmergencyOnchainPauseChainEvidence(evidence, {
    programId: input.programId,
    accountRef: input.accountRef,
    paused: input.expectedPaused,
  });
}

export function normalizeEmergencyOnchainPauseChainEvidence(
  value: unknown,
  expected: { programId: string; accountRef: string; paused: boolean },
): EmergencyOnchainPauseChainEvidence {
  const evidence = asRecord(value);
  const observedSlot = Number(evidence.observedSlot);
  if (
    evidence.commitment !== 'finalized'
    || evidence.paused !== expected.paused
    || evidence.programId !== expected.programId
    || evidence.accountRef !== expected.accountRef
    || evidence.authoritative !== true
    || evidence.selfProvesPause !== false
    || !Number.isSafeInteger(observedSlot)
    || observedSlot < 0
    || typeof evidence.receiptRef !== 'string'
    || !evidence.receiptRef.trim()
  ) {
    throw new Error('emergency_onchain_pause_chain_evidence_invalid');
  }
  return {
    commitment: 'finalized',
    paused: expected.paused,
    programId: expected.programId,
    accountRef: expected.accountRef,
    observedSlot,
    receiptRef: evidence.receiptRef.trim(),
    authoritative: true,
    selfProvesPause: false,
  };
}

export function buildEmergencyOnchainPauseRecord(input: {
  requestId: string;
  decisionDigest: string;
  activatedAt: Date;
  maxDurationSeconds: number;
  pauseEnforcement: EmergencyOnchainPauseEnforcement;
  trigger: string;
  scope: string;
  target: EmergencyOnchainPauseTarget;
  memberNotificationDigest: string;
  ratificationRequestId: string;
  ratificationDecisionDigest: string;
  recoveryConditionsDigest: string;
  chainPauseEvidence: unknown;
}): EmergencyOnchainPauseRecord {
  assertEmergencyOnchainPauseEnablement({
    target: input.target,
    pauseEnforcement: input.pauseEnforcement,
    unpauseAuthorityPresent: true,
    recoveryConditionsDigest: input.recoveryConditionsDigest,
    memberNotificationDigest: input.memberNotificationDigest,
    ratificationRequestId: input.ratificationRequestId,
    ratificationDecisionDigest: input.ratificationDecisionDigest,
  });
  const maxDurationSeconds = requireSafePositiveInt(
    input.maxDurationSeconds,
    'emergency_onchain_pause_max_duration_invalid',
  );
  if (maxDurationSeconds > 7 * 24 * 60 * 60) {
    throw new Error('emergency_onchain_pause_max_duration_exceeds_limit');
  }
  const chainPauseEvidence = normalizeEmergencyOnchainPauseChainEvidence(
    input.chainPauseEvidence,
    {
      programId: input.target.programId,
      accountRef: input.target.accountRef,
      paused: true,
    },
  );
  const activatedAt = input.activatedAt.toISOString();
  const pauseEndsAt = new Date(
    input.activatedAt.getTime() + maxDurationSeconds * 1000,
  ).toISOString();
  return {
    schemaVersion: 1,
    state: 'paused',
    requestId: requireNonEmpty(input.requestId, 'emergency_onchain_pause_request_invalid'),
    decisionDigest: requireDigest(input.decisionDigest, 'emergency_onchain_pause_decision_digest_invalid'),
    activatedAt,
    maxDurationSeconds,
    pauseEndsAt,
    pauseEnforcement: input.pauseEnforcement,
    trigger: requireNonEmpty(input.trigger, 'emergency_onchain_pause_trigger_invalid'),
    scope: requireNonEmpty(input.scope, 'emergency_onchain_pause_scope_invalid'),
    pauseAuthorityRef: input.target.pauseAuthorityRef,
    unpauseAuthorityRef: input.target.unpauseAuthorityRef,
    memberNotificationDigest: requireDigest(
      input.memberNotificationDigest,
      'emergency_onchain_pause_member_notification_invalid',
    ),
    ratificationRequestId: requireNonEmpty(
      input.ratificationRequestId,
      'emergency_onchain_pause_ratification_request_invalid',
    ),
    ratificationDecisionDigest: requireDigest(
      input.ratificationDecisionDigest,
      'emergency_onchain_pause_ratification_decision_invalid',
    ),
    recoveryConditionsDigest: requireDigest(
      input.recoveryConditionsDigest,
      'emergency_onchain_pause_recovery_digest_invalid',
    ),
    onchainPauseInstruction: SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION,
    programId: input.target.programId,
    accountRef: input.target.accountRef,
    chainPauseEvidence,
    residualRisk: {
      permanentPausePossible: input.pauseEnforcement === 'explicit_unpause_required',
      fallbackAuthority: 'none',
      workflowFreezeClaimsChainPaused: false,
      expiredAliasForbidden: true,
      resumedAliasForbidden: true,
    },
    unpause: {
      requestId: null,
      decisionDigest: null,
      completedAt: null,
      chainEvidence: null,
    },
  };
}

export function projectEmergencyOnchainPauseLifecycle(
  record: EmergencyOnchainPauseRecord,
  input: {
    now: Date;
    chainPaused: boolean | null;
  },
): EmergencyOnchainPauseRecord {
  if (
    record.state === 'resumed_via_explicit_unpause'
    || record.state === 'resumed_via_onchain_timebound'
  ) {
    return record;
  }
  if (record.state === 'rollback_failed') return record;

  const due = input.now.getTime() >= Date.parse(record.pauseEndsAt);
  if (!due) {
    if (input.chainPaused === false) {
      return {
        ...record,
        state: record.pauseEnforcement === 'onchain_timebound'
          ? 'resumed_via_onchain_timebound'
          : 'rollback_failed',
      };
    }
    return { ...record, state: 'paused' };
  }

  if (record.pauseEnforcement === 'onchain_timebound') {
    if (input.chainPaused === false) {
      return { ...record, state: 'resumed_via_onchain_timebound' };
    }
    if (input.chainPaused === true) {
      return { ...record, state: 'unpause_blocked' };
    }
    return { ...record, state: 'unpause_due' };
  }

  // explicit_unpause_required: never emit expired/resumed aliases.
  if (input.chainPaused === false && record.unpause.chainEvidence?.paused === false) {
    return { ...record, state: 'resumed_via_explicit_unpause' };
  }
  if (input.chainPaused == null) {
    return { ...record, state: 'unpause_due' };
  }
  if (input.chainPaused === true) {
    return { ...record, state: 'unpause_blocked' };
  }
  return { ...record, state: 'unpause_blocked' };
}

export function applyEmergencyOnchainUnpause(
  record: EmergencyOnchainPauseRecord,
  input: {
    requestId: string;
    decisionDigest: string;
    completedAt: Date;
    chainPauseEvidence: unknown;
  },
): EmergencyOnchainPauseRecord {
  if (
    record.state !== 'paused'
    && record.state !== 'unpause_due'
    && record.state !== 'unpause_blocked'
  ) {
    throw new Error('emergency_onchain_pause_unpause_state_conflict');
  }
  const chainEvidence = normalizeEmergencyOnchainPauseChainEvidence(
    input.chainPauseEvidence,
    {
      programId: record.programId,
      accountRef: record.accountRef,
      paused: false,
    },
  );
  return {
    ...record,
    state: 'resumed_via_explicit_unpause',
    unpause: {
      requestId: requireNonEmpty(input.requestId, 'emergency_onchain_unpause_request_invalid'),
      decisionDigest: requireDigest(
        input.decisionDigest,
        'emergency_onchain_unpause_decision_digest_invalid',
      ),
      completedAt: input.completedAt.toISOString(),
      chainEvidence,
    },
  };
}

export function normalizeEmergencyOnchainPauseRecord(
  value: unknown,
  input?: { now?: Date; chainPaused?: boolean | null },
): EmergencyOnchainPauseRecord | null {
  const record = asRecord(value);
  const residualRisk = asRecord(record.residualRisk);
  const unpause = asRecord(record.unpause);
  const chainPauseEvidence = asRecord(record.chainPauseEvidence);
  if (
    record.schemaVersion !== 1
    || typeof record.requestId !== 'string'
    || !record.requestId
    || typeof record.decisionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.decisionDigest)
    || typeof record.activatedAt !== 'string'
    || !Number.isFinite(Date.parse(record.activatedAt))
    || !Number.isSafeInteger(Number(record.maxDurationSeconds))
    || Number(record.maxDurationSeconds) <= 0
    || typeof record.pauseEndsAt !== 'string'
    || !Number.isFinite(Date.parse(record.pauseEndsAt))
    || !['onchain_timebound', 'explicit_unpause_required'].includes(String(record.pauseEnforcement))
    || typeof record.trigger !== 'string'
    || !record.trigger
    || typeof record.scope !== 'string'
    || !record.scope
    || typeof record.pauseAuthorityRef !== 'string'
    || !record.pauseAuthorityRef
    || typeof record.unpauseAuthorityRef !== 'string'
    || !record.unpauseAuthorityRef
    || typeof record.memberNotificationDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.memberNotificationDigest)
    || typeof record.ratificationRequestId !== 'string'
    || !record.ratificationRequestId
    || typeof record.ratificationDecisionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.ratificationDecisionDigest)
    || typeof record.recoveryConditionsDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.recoveryConditionsDigest)
    || record.onchainPauseInstruction !== SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION
    || typeof record.programId !== 'string'
    || !record.programId
    || typeof record.accountRef !== 'string'
    || !record.accountRef
    || chainPauseEvidence.commitment !== 'finalized'
    || chainPauseEvidence.paused !== true
    || chainPauseEvidence.authoritative !== true
    || chainPauseEvidence.selfProvesPause !== false
    || residualRisk.fallbackAuthority !== 'none'
    || residualRisk.workflowFreezeClaimsChainPaused !== false
    || residualRisk.expiredAliasForbidden !== true
    || residualRisk.resumedAliasForbidden !== true
    || typeof residualRisk.permanentPausePossible !== 'boolean'
    || residualRisk.permanentPausePossible
      !== (record.pauseEnforcement === 'explicit_unpause_required')
    || ![
      'paused',
      'unpause_due',
      'unpause_blocked',
      'rollback_failed',
      'resumed_via_explicit_unpause',
      'resumed_via_onchain_timebound',
    ].includes(String(record.state))
    // Fail closed on forbidden aliases that would claim recovery without readback.
    || ['expired', 'resumed'].includes(String(record.state))
  ) return null;

  let unpauseChainEvidence: EmergencyOnchainPauseChainEvidence | null = null;
  if (unpause.chainEvidence != null) {
    try {
      unpauseChainEvidence = normalizeEmergencyOnchainPauseChainEvidence(unpause.chainEvidence, {
        programId: String(record.programId),
        accountRef: String(record.accountRef),
        paused: false,
      });
    } catch {
      return null;
    }
  }

  const normalized: EmergencyOnchainPauseRecord = {
    schemaVersion: 1,
    state: record.state as EmergencyOnchainPauseLifecycleState,
    requestId: record.requestId,
    decisionDigest: record.decisionDigest,
    activatedAt: new Date(record.activatedAt).toISOString(),
    maxDurationSeconds: Number(record.maxDurationSeconds),
    pauseEndsAt: new Date(record.pauseEndsAt).toISOString(),
    pauseEnforcement: record.pauseEnforcement as EmergencyOnchainPauseEnforcement,
    trigger: record.trigger,
    scope: record.scope,
    pauseAuthorityRef: record.pauseAuthorityRef,
    unpauseAuthorityRef: record.unpauseAuthorityRef,
    memberNotificationDigest: record.memberNotificationDigest,
    ratificationRequestId: record.ratificationRequestId,
    ratificationDecisionDigest: record.ratificationDecisionDigest,
    recoveryConditionsDigest: record.recoveryConditionsDigest,
    onchainPauseInstruction: SUPPORTED_ONCHAIN_PAUSE_INSTRUCTION,
    programId: record.programId,
    accountRef: record.accountRef,
    chainPauseEvidence: {
      commitment: 'finalized',
      paused: true,
      programId: String(chainPauseEvidence.programId),
      accountRef: String(chainPauseEvidence.accountRef),
      observedSlot: Number(chainPauseEvidence.observedSlot),
      receiptRef: String(chainPauseEvidence.receiptRef),
      authoritative: true,
      selfProvesPause: false,
    },
    residualRisk: {
      permanentPausePossible: record.pauseEnforcement === 'explicit_unpause_required',
      fallbackAuthority: 'none',
      workflowFreezeClaimsChainPaused: false,
      expiredAliasForbidden: true,
      resumedAliasForbidden: true,
    },
    unpause: {
      requestId: unpause.requestId == null ? null : String(unpause.requestId),
      decisionDigest: unpause.decisionDigest == null ? null : String(unpause.decisionDigest),
      completedAt: unpause.completedAt == null
        ? null
        : new Date(String(unpause.completedAt)).toISOString(),
      chainEvidence: unpauseChainEvidence,
    },
  };

  if (!input?.now) return normalized;
  return projectEmergencyOnchainPauseLifecycle(normalized, {
    now: input.now,
    chainPaused: input.chainPaused ?? null,
  });
}

export function hashEmergencyOnchainPauseRecord(
  record: EmergencyOnchainPauseRecord,
): string {
  return createHash('sha256')
    .update(JSON.stringify(record))
    .digest('hex');
}
