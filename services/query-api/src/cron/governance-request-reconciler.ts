import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';

import {
  reconcileActiveGovernanceRequests,
  reconcileRecoverableProviderExecutions,
} from '../services/governance/governanceRequestReconciler';
import { reconcileExpiredGovernanceMandates } from '../services/governance/governanceMandateEffects';
import { reconcileExpiredCommunicationMemberMutes } from '../services/governance/communicationMemberMuteLifecycle';
import { reconcileExpiredCommunicationMessageHides } from '../services/governance/communicationMessageHideLifecycle';
import { reconcileExpiredContentVisibilityDownranks } from '../services/governance/contentVisibilityDownrank';
import { reconcileExpiredFeedRecommendationExperiments } from '../services/governance/feedRecommendationExperiment';
import { reconcileExpiredOperatorCapabilitySuspensions } from '../services/governance/operatorCapabilitySuspension';
import { reconcileExpiredPlatformSafetyQuarantines } from '../services/governance/platformSafety';
import {
  createRegistryChainAttemptReadbackFromEnv,
  createRegistryChainAttemptRecoverySubmitterFromEnv,
  reconcileSubmittedExternalAppRegistryChainAttempts,
} from '../services/externalApps/registryChainAttempt';
import { runSingletonTask } from '../services/runtime/queryRuntimeTaskState';

const INTERVAL_MS = 60 * 1_000;
let intervalHandle: NodeJS.Timeout | null = null;

interface SingletonSchedulerOptions {
  ownerId?: string;
}

export async function runGovernanceRequestReconcileSweep(
  prisma: PrismaClient,
  redis?: Redis | null,
): Promise<void> {
  const now = new Date();
  const result = await reconcileActiveGovernanceRequests(prisma, { now, limit: 100 });
  const providerRetryResult = await reconcileRecoverableProviderExecutions(prisma, {
    redis,
    now,
    limit: 25,
  });
  const registryChainResult = await reconcileSubmittedExternalAppRegistryChainAttempts(
    prisma as any,
    {
      limit: 25,
      chainRegistry: createRegistryChainAttemptReadbackFromEnv(),
      submitter: createRegistryChainAttemptRecoverySubmitterFromEnv(),
    },
  );
  if (registryChainResult.failed > 0) {
    console.warn(
      `⚖️ External app registry chain recovery incomplete: scanned=${registryChainResult.scanned} reconciled=${registryChainResult.reconciled} failed=${registryChainResult.failed}`,
    );
  }
  if (registryChainResult.reconciled > 0) {
    console.log(
      `⚖️ External app registry chain recovered ${registryChainResult.reconciled}/${registryChainResult.scanned}`,
    );
  }
  const mandateResult = await reconcileExpiredGovernanceMandates(prisma, {
    now,
    limit: 100,
  });
  const communicationMuteResult = await reconcileExpiredCommunicationMemberMutes(prisma, {
    now,
    limit: 100,
  });
  const messageHideResult = await reconcileExpiredCommunicationMessageHides(prisma, {
    now,
    limit: 100,
  });
  const contentDownrankResult = await reconcileExpiredContentVisibilityDownranks(prisma, {
    now,
    limit: 100,
  });
  const feedExperimentResult = await reconcileExpiredFeedRecommendationExperiments(prisma, {
    now,
    limit: 100,
  });
  const operatorSuspensionResult = await reconcileExpiredOperatorCapabilitySuspensions(prisma, {
    now,
    limit: 100,
  });
  const platformSafetyResult = await reconcileExpiredPlatformSafetyQuarantines(prisma, {
    now,
    limit: 100,
  });
  if (result.terminalized.length > 0) {
    console.log(
      `⚖️ Governance request sweep terminalized ${result.terminalized.length}: ${result.terminalized.map((item) => item.requestId).join(', ')}`,
    );
  }
  if (result.failures.length > 0) {
    throw new Error(`governance_request_reconcile_failures:${JSON.stringify(result.failures)}`);
  }
  if (providerRetryResult.attempted.length > 0) {
    console.log(
      `⚖️ Governance Provider retry attempted ${providerRetryResult.attempted.length}: ${providerRetryResult.attempted.map((item) => `${item.requestId}:${item.status}`).join(', ')}`,
    );
  }
  if (providerRetryResult.retired.length > 0) {
    console.log(
      `⚖️ Governance Provider attempts retired ${providerRetryResult.retired.length}: ${providerRetryResult.retired.map((item) => item.requestId).join(', ')}`,
    );
  }
  if (providerRetryResult.failures.length > 0) {
    throw new Error(`governance_provider_retry_failures:${JSON.stringify(providerRetryResult.failures)}`);
  }
  if (mandateResult.expired.length > 0) {
    console.log(
      `⚖️ Governance mandate sweep expired ${mandateResult.expired.length}: ${mandateResult.expired.map((item) => item.mandateId).join(', ')}`,
    );
  }
  if (mandateResult.failures.length > 0) {
    throw new Error(`governance_mandate_reconcile_failures:${JSON.stringify(mandateResult.failures)}`);
  }
  if (communicationMuteResult.expired.length > 0) {
    console.log(
      `⚖️ Temporary communication mute sweep expired ${communicationMuteResult.expired.length}: ${communicationMuteResult.expired.join(', ')}`,
    );
  }
  if (communicationMuteResult.failures.length > 0) {
    throw new Error(`communication_mute_reconcile_failures:${JSON.stringify(communicationMuteResult.failures)}`);
  }
  if (messageHideResult.restored.length > 0) {
    console.log(
      `⚖️ Temporary message hide sweep restored ${messageHideResult.restored.length}: ${messageHideResult.restored.join(', ')}`,
    );
  }
  if (messageHideResult.failures.length > 0) {
    throw new Error(`communication_message_hide_reconcile_failures:${JSON.stringify(messageHideResult.failures)}`);
  }
  if (contentDownrankResult.restored.length > 0) {
    console.log(
      `⚖️ Content downrank sweep restored ${contentDownrankResult.restored.length}: ${contentDownrankResult.restored.join(', ')}`,
    );
  }
  if (contentDownrankResult.failures.length > 0) {
    throw new Error(`content_visibility_downrank_reconcile_failures:${JSON.stringify(contentDownrankResult.failures)}`);
  }
  if (feedExperimentResult.expired.length > 0) {
    console.log(
      `⚖️ Feed recommendation experiment sweep expired ${feedExperimentResult.expired.length}: ${feedExperimentResult.expired.join(', ')}`,
    );
  }
  if (feedExperimentResult.failures.length > 0) {
    throw new Error(`feed_recommendation_experiment_reconcile_failures:${JSON.stringify(feedExperimentResult.failures)}`);
  }
  if (operatorSuspensionResult.expired.length > 0) {
    console.log(
      `⚖️ Operator capability suspension sweep expired ${operatorSuspensionResult.expired.length}: ${operatorSuspensionResult.expired.join(', ')}`,
    );
  }
  if (operatorSuspensionResult.failures.length > 0) {
    throw new Error(`operator_capability_suspension_reconcile_failures:${JSON.stringify(operatorSuspensionResult.failures)}`);
  }
  if (platformSafetyResult.restored.length > 0) {
    console.log(
      `⚖️ Platform Safety quarantine sweep restored ${platformSafetyResult.restored.length}: ${platformSafetyResult.restored.join(', ')}`,
    );
  }
  if (platformSafetyResult.failures.length > 0) {
    throw new Error(`platform_safety_quarantine_reconcile_failures:${JSON.stringify(platformSafetyResult.failures)}`);
  }
}

export function startGovernanceRequestReconciler(
  prisma: PrismaClient,
  options: SingletonSchedulerOptions & { redis?: Redis | null } = {},
): void {
  console.log('⚖️ Governance request reconciler started (interval: 1m)');
  const ownerId = options.ownerId || `query-api:${process.pid}`;
  const run = async () => {
    try {
      await runSingletonTask(prisma, {
        taskKey: 'governance_request_reconciler',
        ownerId,
        leaseMs: 45_000,
        minIntervalMs: 45_000,
      }, () => runGovernanceRequestReconcileSweep(prisma, options.redis));
    } catch (error) {
      console.error('⚖️ Governance request reconcile sweep error:', error);
    }
  };
  void run();
  intervalHandle = setInterval(() => {
    void run();
  }, INTERVAL_MS);
}

export function stopGovernanceRequestReconciler(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  console.log('⚖️ Governance request reconciler stopped');
}
