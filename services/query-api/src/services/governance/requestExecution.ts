import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import {
  CIRCLE_FORK_ACTION_TYPE,
  CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
  CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
  createGovernedActionRegistry,
  governedActionUnavailableReason,
  type GovernedActionDefinition,
  type GovernedActionRegistry,
} from "./actionRegistry";
import {
  CIRCLE_GOVERNANCE_BINDING_EXECUTOR,
  executeCircleGovernanceBindingAction,
} from "./circleGovernanceBindingExecution";
import {
  CIRCLE_OWNER_TRANSFER_ACTION_TYPE,
  executeCircleOwnerTransfer,
} from "./circleAuthority";
import { setCircleGovernanceCommitteeAvailability } from "./circleCommitteeProfiles";
import {
  normalizeCircleLifecycleActionType,
} from "./circleLifecycle";
import { executeCirclePolicyGovernanceAction } from "./circlePolicyGovernance";
import { executeCircleAgentGovernanceAction } from "./circleAgentGovernance";
import { executeCircleSeededGovernanceAction } from "./circleSeededGovernance";
import { executeCommunicationGovernanceAction } from "./communicationGovernance";
import { executeDraftGovernanceAction } from "./draftGovernance";
import { executeSourceMaterialGovernanceAction } from "./sourceMaterialGovernance";
import {
  createPrismaGovernanceEngineStore,
  recordExecutionReceipt,
  type GovernanceEngineStore,
  type GovernanceExecutionReceiptRecord,
} from "./policyEngine";
import {
  isFundingAmendmentRequiredExecutionErrorCode,
  isFundingRequiredExecutionErrorCode,
  type GovernanceCaseBlockerCode,
} from './governanceCaseBlocker';
import { executeExternalAppDecision } from "../externalApps/executionAdapter";
import { createExternalAppRegistryAdapter } from "../externalApps/chainRegistryAdapter";
import {
  EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR,
  buildExternalAppCircleBindingExecutionIdempotencyKey,
  executeExternalAppCircleBindingGovernanceAction,
} from "../externalApps/circleBindingExecution";
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { governedActionAuthoritySeparationError } from './governedActionGatewayRuntime';
import { assertPinnedGovernanceProfileCompatibility } from './governanceProfileLifecycle';
import {
  resolveLegacyAutoExecutionCutoverError,
  type GovernanceLegacyAutoExecutionCutoverResolver,
} from './legacyExecutionCompatibility';
import { executeRealmsProviderBindingAction } from './realmsProviderBinding';
import { RealmsProviderExecutionExpiredError } from './realmsDevnetProvider';
import { executeSquadsProviderBindingAction } from './squadsProviderBinding';
import { resolveProviderExecutionAuthorityHealthPreflight } from './providerExecutionAuthorityHealthPreflight';
import {
  resolveGovernanceProviderTerminalAbandonmentExecutionBlocker,
} from './governanceProviderExecutionTerminalAbandonment';
import { executeGovernanceProfileTransition } from './governanceProfileTransitionExecution';

export type GovernanceRequestExecutionSource =
  | "auto_after_decision"
  | "manual_retry"
  | "reconciler_retry";

export interface GovernanceExecutableRequest {
  id: string;
  homeIdentityBindingId?: string | null;
  invocationId?: string | null;
  actionType: string;
  targetType: string;
  targetRef: string;
  payload?: Record<string, unknown> | null;
  proposerPubkey: string;
  idempotencyKey?: string | null;
  state: string;
  executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
  executionModeDigest?: string | null;
  compatibilityBundleVersion?: string | null;
  executionAuthorizationStatus?: string | null;
}

export interface GovernanceActionExecutionOutcome {
  executionStatus: "executed" | "skipped" | "failed";
  executionRef: string | null;
  errorCode?: string | null;
  executionEvidence?: Record<string, unknown> | null;
  receipt?: GovernanceExecutionReceiptRecord | null;
  receiptId?: string;
}

export type GovernanceRequestExecutionAdapter = (input: {
  prisma: PrismaClient | Record<string, unknown>;
  redis: Redis | null;
  source: GovernanceRequestExecutionSource;
  request: GovernanceExecutableRequest;
  decisionDigest?: string | null;
  now: Date;
  engineStore: GovernanceEngineStore;
  createReceiptId?: () => string;
}) => Promise<GovernanceActionExecutionOutcome | null>;

export interface GovernanceRequestExecutionLock {
  acquire(input: {
    requestId: string;
    executorModule: string;
    idempotencyKey: string;
    ttlMs?: number;
  }): Promise<{
    acquired: boolean;
    release(): Promise<void>;
  }>;
}

export interface GovernanceRequestExecutionInput {
  prisma: PrismaClient | Record<string, unknown>;
  redis?: Redis | null;
  registry: GovernedActionRegistry;
  request: GovernanceExecutableRequest;
  source: GovernanceRequestExecutionSource;
  decisionDigest?: string | null;
  now?: Date;
  adapters?: Record<string, GovernanceRequestExecutionAdapter>;
  lock?: GovernanceRequestExecutionLock;
  engineStore?: GovernanceEngineStore;
  createReceiptId?: () => string;
  resolveLegacyAutoExecutionCutover?: GovernanceLegacyAutoExecutionCutoverResolver;
  resolveProviderAuthorityHealthPreflight?: typeof resolveProviderExecutionAuthorityHealthPreflight;
  resolveProviderTerminalAbandonmentBlocker?:
    typeof resolveGovernanceProviderTerminalAbandonmentExecutionBlocker;
}

export interface GovernanceRequestExecutionResult {
  status:
    | "executed"
    | "skipped"
    | "failed"
    | "not_applicable"
    | "already_executed"
    | "execution_in_progress";
  actionType: string;
  executorModule: string | null;
  executionRef: string | null;
  errorCode: string | null;
  receipt: GovernanceExecutionReceiptRecord | null;
}

const PROVIDER_BOUND_EXECUTION_LOCK_TTL_MS = 15 * 60 * 1000;

export async function executeAcceptedGovernanceRequest(
  input: GovernanceRequestExecutionInput,
): Promise<GovernanceRequestExecutionResult> {
  const request = normalizeRequest(input.request);
  const now = input.now ?? new Date();
  if (request.state !== "accepted") {
    return result({
      request,
      status: "not_applicable",
      executorModule: null,
      receipt: null,
    });
  }

  const definition = input.registry.get(request.actionType);
  if (!definition) {
    return result({
      request,
      status: "not_applicable",
      executorModule: null,
      receipt: null,
    });
  }

  const executorModule = definition.executionAdapter;
  const decisionDigest = normalizeDecisionDigest(input.decisionDigest);
  if (!decisionDigest) {
    return result({
      request,
      status: "failed",
      executorModule,
      receipt: null,
      errorCode: "governance_decision_digest_required",
    });
  }
  const engineStore =
    input.engineStore ??
    createPrismaGovernanceEngineStore(input.prisma as PrismaClient);
  const modeError = governanceExecutionModeError(request, definition);
  if (modeError) {
    return recordModeBlockedExecution({
      engineStore,
      request,
      executorModule,
      errorCode: modeError,
      decisionDigest,
      now,
      createReceiptId: input.createReceiptId,
    });
  }
  if (request.executionMode === 'legacy_action_checkpoint') {
    const resolveCutover = input.resolveLegacyAutoExecutionCutover
      ?? ((facts) => resolveLegacyAutoExecutionCutoverError(
        input.prisma as Record<string, any>,
        {
          id: facts.requestId,
          homeIdentityBindingId: facts.homeIdentityBindingId,
          compatibilityBundleVersion: facts.compatibilityBundleVersion,
        },
      ));
    let cutoverError: string | null;
    try {
      cutoverError = await resolveCutover({
        requestId: request.id,
        homeIdentityBindingId: request.homeIdentityBindingId ?? null,
        compatibilityBundleVersion: request.compatibilityBundleVersion!,
      });
    } catch {
      cutoverError = 'legacy_auto_execution_cutover_readback_unavailable';
    }
    if (cutoverError) {
      return recordModeBlockedExecution({
        engineStore,
        request,
        executorModule,
        errorCode: cutoverError,
        decisionDigest,
        now,
        createReceiptId: input.createReceiptId,
      });
    }
  }
  const invocationError = await governedActionInvocationPreflightError(
    input.prisma,
    request,
    definition,
    now,
  );
  if (invocationError) {
    return recordModeBlockedExecution({
      engineStore,
      request,
      executorModule,
      errorCode: invocationError,
      decisionDigest,
      now,
      createReceiptId: input.createReceiptId,
    });
  }
  const terminalKey = normalizeGovernanceExecutionReceiptKey(buildTerminalReceiptKey({
    executorModule,
    request,
    outcome: null,
  }));
  const existingTerminal = await engineStore.getExecutionReceiptByMarker({
    requestId: request.id,
    executorModule,
    idempotencyKey: terminalKey,
  });
  if (existingTerminal && isTerminalReceipt(existingTerminal)) {
    return result({
      request,
      status:
        existingTerminal.executionStatus === "executed"
          ? "already_executed"
          : existingTerminal.executionStatus,
      executorModule,
      receipt: existingTerminal,
      executionRef: existingTerminal.executionRef ?? null,
      errorCode: existingTerminal.errorCode ?? null,
    });
  }

  const lock =
    input.lock ?? createRedisGovernanceExecutionLock(input.redis ?? null);
  const lease = await lock.acquire({
    requestId: request.id,
    executorModule,
    idempotencyKey: terminalKey,
    ttlMs: request.executionMode === 'provider_bound_action'
      ? PROVIDER_BOUND_EXECUTION_LOCK_TTL_MS
      : undefined,
  });
  if (!lease.acquired) {
    return result({
      request,
      status: "execution_in_progress",
      executorModule,
      receipt: null,
    });
  }

  try {
    const terminalAfterLock = await engineStore.getExecutionReceiptByMarker({
      requestId: request.id,
      executorModule,
      idempotencyKey: terminalKey,
    });
    if (terminalAfterLock && isTerminalReceipt(terminalAfterLock)) {
      return result({
        request,
        status:
          terminalAfterLock.executionStatus === "executed"
            ? "already_executed"
            : terminalAfterLock.executionStatus,
        executorModule,
        receipt: terminalAfterLock,
        executionRef: terminalAfterLock.executionRef ?? null,
        errorCode: terminalAfterLock.errorCode ?? null,
      });
    }

    if (request.executionMode === 'provider_bound_action') {
      const terminalAbandonmentBlocker = await (
        input.resolveProviderTerminalAbandonmentBlocker
          ?? resolveGovernanceProviderTerminalAbandonmentExecutionBlocker
      )(input.prisma, request.id);
      if (terminalAbandonmentBlocker) {
        return recordModeBlockedExecution({
          engineStore,
          request,
          executorModule,
          errorCode: terminalAbandonmentBlocker,
          decisionDigest,
          now,
          createReceiptId: input.createReceiptId,
        });
      }
      try {
        await (input.resolveProviderAuthorityHealthPreflight
          ?? resolveProviderExecutionAuthorityHealthPreflight)(
          input.prisma,
          request,
          now,
        );
      } catch (error) {
        return recordModeBlockedExecution({
          engineStore,
          request,
          executorModule,
          errorCode: sanitizeErrorCode(error),
          decisionDigest,
          now,
          createReceiptId: input.createReceiptId,
        });
      }
    }

    const adapter = (input.adapters ??
      createDefaultGovernanceExecutionAdapters())[executorModule];
    if (!adapter) {
      return recordFailedExecution({
        engineStore,
        request,
        executorModule,
        terminalKey,
        errorCode: "unsupported_governed_action_execution",
        decisionDigest,
        now: input.now ?? new Date(),
        createReceiptId: input.createReceiptId,
      });
    }
    const unavailableReason = governedActionUnavailableReason(definition);
    if (unavailableReason) {
      return recordFailedExecution({
        engineStore,
        request,
        executorModule,
        terminalKey,
        errorCode: unavailableReason,
        decisionDigest,
        now: input.now ?? new Date(),
        createReceiptId: input.createReceiptId,
      });
    }

    let outcome: GovernanceActionExecutionOutcome | null;
    try {
      outcome = await adapter({
        prisma: input.prisma,
        redis: input.redis ?? null,
        source: input.source,
        request,
        decisionDigest,
        now: input.now ?? new Date(),
        engineStore,
        createReceiptId: input.createReceiptId,
      });
    } catch (error) {
      return recordFailedExecution({
        engineStore,
        request,
        executorModule,
        terminalKey,
        errorCode: sanitizeErrorCode(error),
        executionEvidence: executorModule === 'realms_provider_binding'
          && error instanceof RealmsProviderExecutionExpiredError
          ? { ...error.evidence }
          : null,
        decisionDigest,
        now: input.now ?? new Date(),
        createReceiptId: input.createReceiptId,
      });
    }

    if (!outcome) {
      return recordFailedExecution({
        engineStore,
        request,
        executorModule,
        terminalKey,
        errorCode: "unsupported_governed_action_execution",
        decisionDigest,
        now: input.now ?? new Date(),
        createReceiptId: input.createReceiptId,
      });
    }

    if (outcome.receipt) {
      return result({
        request,
        status: outcome.receipt.executionStatus,
        executorModule,
        receipt: outcome.receipt,
        executionRef: outcome.receipt.executionRef ?? outcome.executionRef,
        errorCode: outcome.receipt.errorCode ?? outcome.errorCode ?? null,
      });
    }

    const receiptKey = normalizeGovernanceExecutionReceiptKey(buildTerminalReceiptKey({
      executorModule,
      request,
      outcome,
    }));
    const executionReceiptKey =
      outcome.executionStatus === "failed" && outcome.errorCode
        ? normalizeGovernanceExecutionReceiptKey(`${receiptKey}:failed:${outcome.errorCode}`)
        : receiptKey;
    const receipt = await recordExecutionReceipt(engineStore, {
      id: outcome.receiptId ?? input.createReceiptId?.() ?? randomUUID(),
      requestId: request.id,
      actionType: request.actionType,
      executorModule,
      executionStatus: outcome.executionStatus,
      executionRef: outcome.executionRef,
      errorCode: outcome.errorCode ?? null,
      decisionDigest,
      idempotencyKey: executionReceiptKey,
      executionMode: request.executionMode,
      executionModeDigest: request.executionModeDigest,
      compatibilityBundleVersion: request.compatibilityBundleVersion,
      executionEvidence: outcome.executionEvidence ?? null,
      executedAt: input.now ?? new Date(),
    }, executionReceiptBlockerOptions(outcome.errorCode));
    return result({
      request,
      status: receipt.executionStatus,
      executorModule,
      receipt,
      executionRef: receipt.executionRef ?? null,
      errorCode: receipt.errorCode ?? null,
    });
  } finally {
    await releaseExecutionLock(lease);
  }
}

export function createDefaultGovernanceExecutionAdapters(): Record<
  string,
  GovernanceRequestExecutionAdapter
> {
  return {
    [CIRCLE_GOVERNANCE_BINDING_EXECUTOR]: async ({
      prisma,
      request,
      decisionDigest,
      now,
    }) =>
      executeCircleGovernanceBindingAction(prisma as any, {
        ...request,
        decisionDigest,
        now,
      }),
    circle_lifecycle: async ({ request }) => {
      if (request.actionType === CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE) {
        if (request.targetType !== "circle") return null;
        const circleId = parsePositiveInteger(request.targetRef);
        if (!circleId) throw new Error("invalid_circle_lifecycle_target");
        return {
          executionStatus: "skipped",
          executionRef: request.id,
          errorCode: "merge_source_approval_recording_required",
        };
      }
      if (request.actionType === CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE) {
        if (request.targetType !== "circle") return null;
        const circleId = parsePositiveInteger(request.targetRef);
        if (!circleId) throw new Error("invalid_circle_lifecycle_target");
        return {
          executionStatus: "skipped",
          executionRef: request.id,
          errorCode: "merge_successor_acceptance_pending",
        };
      }
      if (request.actionType === CIRCLE_FORK_ACTION_TYPE) {
        if (request.targetType !== "circle") return null;
        const circleId = parsePositiveInteger(request.targetRef);
        if (!circleId) throw new Error("invalid_circle_lifecycle_target");
        return {
          executionStatus: "skipped",
          executionRef: String(circleId),
          errorCode: "wallet_finalization_required",
        };
      }
      const action = normalizeCircleLifecycleActionType(request.actionType);
      if (!action || request.targetType !== "circle") return null;
      if (action === "dissolve") {
        const circleId = parsePositiveInteger(request.targetRef);
        if (!circleId) throw new Error("invalid_circle_lifecycle_target");
        return {
          executionStatus: "skipped",
          executionRef: String(circleId),
          errorCode: "dissolution_disposition_pending",
        };
      }
      const circleId = parsePositiveInteger(request.targetRef);
      if (!circleId) throw new Error("invalid_circle_lifecycle_target");
      return {
        executionStatus: "skipped",
        executionRef: String(circleId),
        errorCode: "wallet_finalization_required",
      };
    },
    circle_authority: async ({ prisma, redis, request }) => {
      if (request.actionType !== CIRCLE_OWNER_TRANSFER_ACTION_TYPE) return null;
      const payload = normalizeRecord(request.payload);
      const transferRequestId = parseOptionalString(payload.transferRequestId);
      if (!transferRequestId)
        throw new Error("invalid_owner_transfer_request_id");
      const executed = await executeCircleOwnerTransfer(
        prisma as any,
        redis as any,
        {
          transferRequestId,
          governanceRequestId: request.id,
        },
      );
      return {
        executionStatus: "executed",
        executionRef: executed.transfer.id,
      };
    },
    circle_committee_profile: async ({ prisma, request, now }) => {
      if (
        request.actionType !==
        "circle.governance_binding.committee_profile.update"
      )
        return null;
      if (request.targetType !== "circle") return null;
      const circleId = parsePositiveInteger(request.targetRef);
      if (!circleId) throw new Error("invalid_circle_committee_profile_target");
      const payload = normalizeRecord(request.payload);
      if (
        payload.availabilityStatus !== "enabled" &&
        payload.availabilityStatus !== "disabled"
      ) {
        throw new Error("invalid_circle_committee_profile_availability_status");
      }
      const availabilityStatus = payload.availabilityStatus;
      const windowMinutes =
        typeof payload.windowMinutes === "number"
          ? payload.windowMinutes
          : null;
      const allowedActionPrefixes = Array.isArray(payload.allowedActionPrefixes)
        ? payload.allowedActionPrefixes
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : null;
      const electorateTemplate = payload.electorateTemplate ?? null;
      const profile = await setCircleGovernanceCommitteeAvailability(
        prisma as any,
        {
          circleId,
          availabilityStatus,
          actorPubkey:
            parseOptionalString(payload.actorPubkey) ||
            request.proposerPubkey ||
            null,
          windowMinutes,
          allowedActionPrefixes,
          electorateTemplate,
          now,
        },
      );
      return {
        executionStatus: "executed",
        executionRef: String(profile.circleId),
      };
    },
    circle_policy: async ({ prisma, redis, request }) =>
      executeCirclePolicyGovernanceAction(
        prisma as PrismaClient,
        redis as any,
        request,
      ),
    circle_agent: async ({ prisma, request }) =>
      executeCircleAgentGovernanceAction(prisma as PrismaClient, request),
    circle_seeded: async ({ prisma, redis, request }) =>
      executeCircleSeededGovernanceAction(
        prisma as PrismaClient,
        redis as any,
        request,
      ),
    source_material: async ({ prisma, redis, request }) =>
      executeSourceMaterialGovernanceAction(
        prisma as PrismaClient,
        redis as any,
        request,
      ),
    communication: async ({ prisma, request }) =>
      executeCommunicationGovernanceAction(prisma as PrismaClient, request),
    draft_governance: async ({ prisma, request, decisionDigest, now, createReceiptId }) =>
      executeDraftGovernanceAction(prisma as PrismaClient, request, {
        decisionDigest,
        now,
        createReceiptId,
      }),
    realms_provider_binding: async ({ prisma, request, decisionDigest, now, source }) => {
      if (!decisionDigest) {
        throw new Error('realms_provider_binding_decision_digest_required');
      }
      return executeRealmsProviderBindingAction(prisma as PrismaClient, {
        request,
        decisionDigest,
        now,
        source,
      });
    },
    squads_provider_binding: async ({ prisma, request, decisionDigest, now, source }) => {
      if (!decisionDigest) {
        throw new Error('squads_provider_binding_decision_digest_required');
      }
      return executeSquadsProviderBindingAction(prisma as PrismaClient, {
        request,
        decisionDigest,
        now,
        source,
      });
    },
    [EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR]: async ({
      prisma,
      request,
      decisionDigest,
      now,
    }) =>
      executeExternalAppCircleBindingGovernanceAction(
        prisma as PrismaClient,
        request,
        { decisionDigest, now },
      ),
    external_app: async ({
      prisma,
      request,
      decisionDigest,
      now,
      engineStore,
      createReceiptId,
    }) => {
      if (request.targetType !== "external_app") return null;
      const receipt = await executeExternalAppDecision({
        prisma: prisma as any,
        governanceStore: engineStore,
        request: {
          id: request.id,
          actionType: request.actionType,
          targetRef: request.targetRef,
          payload: normalizeRecord(request.payload),
        },
        decision: { decision: "accepted", decisionDigest },
        now,
        chainRegistry: createExternalAppRegistryAdapter(),
        createReceiptId,
        receiptIdempotencyKey: buildTerminalReceiptKey({
          executorModule: "external_app",
          request,
          outcome: null,
        }),
      });
      return {
        executionStatus: receipt.executionStatus,
        executionRef: receipt.executionRef ?? null,
        errorCode: receipt.errorCode ?? null,
        receipt,
      };
    },
    governance_profile: async ({ prisma, request, now }) =>
      executeGovernanceProfileTransition(prisma, request, now),
  };
}

export function createDefaultGovernanceExecutionRegistry(): GovernedActionRegistry {
  return createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeCircleLifecycleActions: true,
    includeCircleAuthorityActions: true,
    includeCirclePolicyActions: true,
    includeCircleAgentActions: true,
    includeCircleSeededActions: true,
    includeSourceMaterialActions: true,
    includeCommunicationActions: true,
    includeDraftGovernanceActions: true,
    includeCircleCommitteeProfileActions: true,
    includeExternalAppActions: true,
    includeExternalAppCircleBindingActions: true,
    includeGovernanceHomeProfileActions: true,
    includeGrantActions: true,
    includeProviderExecutionLifecycleActions: true,
    includeRealmsProviderBindingActions: true,
    includeSquadsProviderBindingActions: true,
  });
}

const localGovernanceExecutionLocks = new Set<string>();

export function createRedisGovernanceExecutionLock(
  redis: Redis | null | undefined,
  input?: { ttlMs?: number; createToken?: () => string },
): GovernanceRequestExecutionLock {
  const ttlMs = input?.ttlMs ?? 30_000;
  return {
    async acquire(lockInput) {
      const key = buildExecutionLockKey(lockInput);
      if (!redis || typeof (redis as any).set !== "function") {
        if (localGovernanceExecutionLocks.has(key)) {
          return { acquired: false, release: async () => undefined };
        }
        localGovernanceExecutionLocks.add(key);
        return {
          acquired: true,
          release: async () => {
            localGovernanceExecutionLocks.delete(key);
          },
        };
      }
      const token = input?.createToken?.() ?? randomUUID();
      let acquired: unknown;
      try {
        acquired = await (redis as any).set(
          key,
          token,
          "PX",
          lockInput.ttlMs ?? ttlMs,
          "NX",
        );
      } catch {
        return { acquired: false, release: async () => undefined };
      }
      if (acquired !== "OK") {
        return { acquired: false, release: async () => undefined };
      }
      return {
        acquired: true,
        release: async () => {
          try {
            if (typeof (redis as any).eval === "function") {
              await (redis as any).eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                1,
                key,
                token,
              );
              return;
            }
            if (
              typeof (redis as any).get === "function" &&
              typeof (redis as any).del === "function"
            ) {
              const current = await (redis as any).get(key);
              if (current === token) {
                await (redis as any).del(key);
              }
            }
          } catch {
            return;
          }
        },
      };
    },
  };
}

function buildExecutionLockKey(input: {
  requestId: string;
  executorModule: string;
  idempotencyKey: string;
}): string {
  return `governance:execution:${input.requestId}:${input.executorModule}:${input.idempotencyKey}`;
}

async function releaseExecutionLock(lease: {
  release(): Promise<void>;
}): Promise<void> {
  try {
    await lease.release();
  } catch {
    return;
  }
}

async function recordFailedExecution(input: {
  engineStore: GovernanceEngineStore;
  request: GovernanceExecutableRequest;
  executorModule: string;
  terminalKey: string;
  errorCode: string;
  executionEvidence?: Record<string, unknown> | null;
  decisionDigest: string;
  now: Date;
  createReceiptId?: () => string;
}): Promise<GovernanceRequestExecutionResult> {
  const terminal = await input.engineStore.getExecutionReceiptByMarker({
    requestId: input.request.id,
    executorModule: input.executorModule,
    idempotencyKey: input.terminalKey,
  });
  if (terminal && isTerminalReceipt(terminal)) {
    return result({
      request: input.request,
      status:
        terminal.executionStatus === "executed"
          ? "already_executed"
          : terminal.executionStatus,
      executorModule: input.executorModule,
      receipt: terminal,
      executionRef: terminal.executionRef ?? null,
      errorCode: terminal.errorCode ?? null,
    });
  }

  const receipt = await recordExecutionReceipt(input.engineStore, {
    id: input.createReceiptId?.() ?? randomUUID(),
    requestId: input.request.id,
    actionType: input.request.actionType,
    executorModule: input.executorModule,
    executionStatus: "failed",
    executionRef: null,
    errorCode: input.errorCode,
    executionEvidence: input.executionEvidence ?? null,
    decisionDigest: input.decisionDigest,
    idempotencyKey: normalizeGovernanceExecutionReceiptKey(
      `${input.terminalKey}:failed:${input.errorCode}`,
    ),
    executionMode: input.request.executionMode,
    executionModeDigest: input.request.executionModeDigest,
    compatibilityBundleVersion: input.request.compatibilityBundleVersion,
    executedAt: input.now,
  }, executionReceiptBlockerOptions(input.errorCode));
  return result({
    request: input.request,
    status: "failed",
    executorModule: input.executorModule,
    receipt,
    errorCode: receipt.errorCode ?? input.errorCode,
  });
}

function executionReceiptBlockerOptions(errorCode: unknown): {
  caseBlocker?: { code: GovernanceCaseBlockerCode };
} {
  if (isFundingAmendmentRequiredExecutionErrorCode(errorCode)) {
    return { caseBlocker: { code: "funding_amendment_required" } };
  }
  return isFundingRequiredExecutionErrorCode(errorCode)
    ? { caseBlocker: { code: "funding_required" } }
    : {};
}

async function recordModeBlockedExecution(input: {
  engineStore: GovernanceEngineStore;
  request: GovernanceExecutableRequest;
  executorModule: string;
  errorCode: string;
  decisionDigest: string;
  now: Date;
  createReceiptId?: () => string;
}): Promise<GovernanceRequestExecutionResult> {
  const idempotencyKey = normalizeGovernanceExecutionReceiptKey(
    `${input.request.actionType}:${input.request.targetRef}:mode:${input.errorCode}`,
  );
  const receipt = await recordExecutionReceipt(input.engineStore, {
    id: input.createReceiptId?.() ?? randomUUID(),
    requestId: input.request.id,
    actionType: input.request.actionType,
    executorModule: input.executorModule,
    executionStatus: 'skipped',
    executionRef: null,
    errorCode: input.errorCode,
    decisionDigest: input.decisionDigest,
    idempotencyKey,
    executionMode: input.request.executionMode,
    executionModeDigest: input.request.executionModeDigest,
    compatibilityBundleVersion: input.request.compatibilityBundleVersion,
    executedAt: input.now,
  });
  return result({
    request: input.request,
    status: 'skipped',
    executorModule: input.executorModule,
    receipt,
    errorCode: input.errorCode,
  });
}

function governanceExecutionModeError(
  request: GovernanceExecutableRequest,
  definition: GovernedActionDefinition,
): string | null {
  if (
    !request.executionMode
    || !request.executionModeDigest
    || request.executionAuthorizationStatus !== 'authorized'
  ) return 'governance_request_execution_mode_quarantined';
  if (request.executionMode === 'stage_decision_only') {
    return 'stage_decision_only_execution_action_required';
  }
  if (request.executionMode === 'provider_bound_action') {
    if (
      !['realms_provider_binding', 'squads_provider_binding'].includes(
        definition.executionAdapter,
      )
      || request.compatibilityBundleVersion
    ) {
      return 'provider_bound_action_execution_contract_mismatch';
    }
    return null;
  }
  if (request.executionMode !== 'legacy_action_checkpoint') {
    return 'governance_request_execution_mode_invalid';
  }
  if (!request.compatibilityBundleVersion) {
    return 'governance_request_execution_mode_quarantined';
  }
  return null;
}

function normalizeDecisionDigest(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

async function governedActionInvocationPreflightError(
  prisma: PrismaClient | Record<string, unknown>,
  request: GovernanceExecutableRequest,
  definition: GovernedActionDefinition,
  now: Date,
): Promise<string | null> {
  if (!request.invocationId) return null;
  if (!request.homeIdentityBindingId || !request.idempotencyKey) {
    return 'governed_action_execution_invocation_facts_missing';
  }
  const client = prisma as any;
  if (!client.governedActionInvocation?.findUnique
    || !client.governanceHomeIdentityBinding?.findUnique) {
    return 'governed_action_execution_invocation_readback_unavailable';
  }
  const [invocation, home] = await Promise.all([
    client.governedActionInvocation.findUnique({
      where: { id: request.invocationId },
      include: {
        authoritySnapshot: { include: { binding: true } },
        contractVersion: true,
        profileBinding: { include: { definitionVersion: true } },
      },
    }),
    client.governanceHomeIdentityBinding.findUnique({
      where: { id: request.homeIdentityBindingId },
    }),
  ]);
  if (!invocation
    || !invocation.authoritySnapshot
    || !invocation.authoritySnapshot.binding
    || !invocation.contractVersion
    || !home) {
    return 'governed_action_execution_invocation_readback_missing';
  }
  if (!invocation.profileBindingId || !invocation.authoritySnapshot.profileBindingId
    || !invocation.authoritySnapshot.profileVersionRef
    || !invocation.profileBinding?.definitionVersion) {
    return 'governance_profile_pinned_binding_migration_required';
  }
  const payloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-payload',
    normalizeRecord(request.payload),
  );
  const authoritySeparationError = governedActionAuthoritySeparationError(
    invocation.authoritySnapshot.binding,
    definition,
  );
  if (authoritySeparationError) return authoritySeparationError;
  try {
    assertPinnedGovernanceProfileCompatibility({
      profileBindingId: invocation.profileBinding.id,
      profileVersionRef: invocation.profileBinding.definitionVersion.versionRef,
      profileDefinitionDigest: invocation.profileBinding.definitionVersion.definitionDigest,
      definition: invocation.profileBinding.definitionVersion.definition,
    }, {
      homeType: home.homeType,
      actionType: definition.actionType,
      executionAdapter: definition.executionAdapter,
    });
  } catch {
    return 'governance_profile_pinned_adapter_incompatible_requires_migration';
  }
  if (
    invocation.id !== request.invocationId
    || invocation.contractVersionId !== invocation.contractVersion.id
    || invocation.contractVersion.actionType !== definition.actionType
    || invocation.contractVersion.subjectType !== definition.targetType
    || invocation.contractVersion.executionAdapter !== definition.executionAdapter
    || invocation.contractVersion.executionDomain !== definition.executionDomain
    || invocation.profileBindingId !== invocation.profileBinding.id
    || invocation.authoritySnapshot.profileBindingId !== invocation.profileBinding.id
    || invocation.authoritySnapshot.profileVersionRef
      !== invocation.profileBinding.definitionVersion.versionRef
    || invocation.subjectType !== request.targetType
    || invocation.subjectRef !== request.targetRef
    || invocation.actorPubkey !== request.proposerPubkey
    || invocation.idempotencyKey !== request.idempotencyKey
    || invocation.payloadDigest !== payloadDigest
    || invocation.governanceHomeType !== home.homeType
    || invocation.governanceHomeRef !== home.homeRef
    || home.id !== request.homeIdentityBindingId
    || home.supersededAt != null
    || invocation.preflightDigest !== request.executionModeDigest
    || invocation.authoritySnapshot.invocationId !== invocation.id
    || invocation.authoritySnapshot.bindingId !== invocation.authoritySnapshot.binding.id
    || invocation.authoritySnapshot.binding.contractVersionId !== invocation.contractVersionId
    || invocation.authoritySnapshot.binding.governanceHomeType !== home.homeType
    || invocation.authoritySnapshot.binding.governanceHomeRef !== home.homeRef
    || invocation.authoritySnapshot.binding.status !== 'active'
    || invocation.authoritySnapshot.binding.supersededAt != null
    || invocation.authoritySnapshot.riskFloor
      !== normalizeRecord(invocation.authoritySnapshot.binding.limits).riskFloor
    || (invocation.authoritySnapshot.binding.effectiveUntil
      && new Date(invocation.authoritySnapshot.binding.effectiveUntil).getTime() <= now.getTime())
    || invocation.authoritySnapshot.resolvedSubjectDigest !== hashCanonicalGovernanceValue(
      'alcheme.governance.action-subject',
      { targetType: request.targetType, targetRef: request.targetRef },
    )
    || invocation.authoritySnapshot.resolvedPayloadDigest !== payloadDigest
    || invocation.authoritySnapshot.liveConfigDigest !== request.executionModeDigest
    || invocation.authoritySnapshot.decisionPath !== request.executionMode
    || (invocation.authoritySnapshot.validUntil
      && new Date(invocation.authoritySnapshot.validUntil).getTime() <= now.getTime())
  ) {
    return 'governed_action_execution_invocation_mismatch';
  }
  return null;
}

function result(input: {
  request: GovernanceExecutableRequest;
  status: GovernanceRequestExecutionResult["status"];
  executorModule: string | null;
  receipt: GovernanceExecutionReceiptRecord | null;
  executionRef?: string | null;
  errorCode?: string | null;
}): GovernanceRequestExecutionResult {
  return {
    status: input.status,
    actionType: input.request.actionType,
    executorModule: input.executorModule,
    executionRef: input.executionRef ?? input.receipt?.executionRef ?? null,
    errorCode: input.errorCode ?? input.receipt?.errorCode ?? null,
    receipt: input.receipt,
  };
}

function buildTerminalReceiptKey(input: {
  executorModule: string;
  request: GovernanceExecutableRequest;
  outcome: GovernanceActionExecutionOutcome | null;
}): string {
  if (
    input.executorModule === "circle_policy" &&
    ((input.outcome?.executionStatus === "skipped" &&
      input.outcome.errorCode === "wallet_finalization_required") ||
      (input.request.actionType === "circle.policy.membership.update" &&
        parseOptionalString(
          normalizeRecord(input.request.payload).chainStatus,
        ) === "requires_wallet_finalization"))
  ) {
    return `${input.request.actionType}:${input.request.targetRef}:wallet-required`;
  }
  if (input.executorModule === "circle_authority") {
    const transferId = parseOptionalString(
      normalizeRecord(input.request.payload).transferRequestId,
    );
    return `${input.request.actionType}:${transferId || input.outcome?.executionRef || input.request.targetRef}`;
  }
  if (
    input.outcome?.executionRef &&
    input.executorModule === "circle_lifecycle"
  ) {
    return `${input.request.actionType}:${input.outcome.executionRef}`;
  }
  if (input.executorModule === EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR) {
    const operation = input.request.actionType.endsWith("_revoke")
      ? "revoke"
      : "activate";
    return buildExternalAppCircleBindingExecutionIdempotencyKey({
      bindingId: input.outcome?.executionRef ?? input.request.targetRef,
      operation,
    });
  }
  return `${input.request.actionType}:${input.request.targetRef}`;
}

function normalizeGovernanceExecutionReceiptKey(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= 128) return value;
  return `governance-execution:${hashCanonicalGovernanceValue(
    "alcheme.governance.execution-receipt-key",
    { value },
  )}`;
}

function normalizeRequest(
  request: GovernanceExecutableRequest,
): GovernanceExecutableRequest {
  return {
    ...request,
    payload: normalizeRecord(request.payload),
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isTerminalReceipt(receipt: GovernanceExecutionReceiptRecord): boolean {
  return (
    receipt.executionStatus === "executed" ||
    receipt.executionStatus === "skipped"
  );
}

function sanitizeErrorCode(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error || "governance_execution_failed");
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || "governance_execution_failed";
}
