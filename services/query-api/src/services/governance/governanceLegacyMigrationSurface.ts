import { createHash } from 'node:crypto';

import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';

import circleManagerIdl from '../../../../../sdk/src/idl/circle_manager.json';
import mutationLedger from '../../../../../docs/architecture/governance-os-implementation/evidence/P01-M1-mutation-surface-ledger.json';
import {
  GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID,
} from './governanceBootstrapCeremonyContract';
import {
  LEGACY_GOVERNANCE_ACTIONS,
  type LegacyGovernanceAction,
} from './governanceLegacyCompatibilityBundle';
import {
  createPrismaGovernanceLegacyCompatibilityBundleStore,
  type GovernanceLegacyCompatibilityBundleRecord,
} from './governanceLegacyCompatibilityBundleStore';
import {
  persistGovernanceLegacyCompatibilityFromReadback,
  type GovernanceLegacyCompatibilityChainReader,
  type LegacyTransferProposalReadback,
} from './governanceLegacyCompatibilityRuntime';
import { readGovernanceLegacyCircleMutationSurfaces } from './governanceLegacyMutationSurfaceReader';
import {
  assertGovernanceLegacyActionCutoverRecordIntegrity,
  createPrismaGovernanceLegacyActionCutoverStore,
  type GovernanceLegacyActionCutoverRecord,
  type GovernanceLegacyActionCutoverState,
} from './governanceLegacyActionCutoverRuntime';
import {
  executeGovernanceLegacyMigrationTransition,
  prepareGovernanceLegacyMigrationTransition,
  type GovernanceLegacyMigrationOwnerLockReadback,
  type GovernanceLegacyMigrationTransitionPreview,
} from './governanceLegacyMigrationTransitionRuntime';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { projectGovernanceCaseInboxProviderHealth } from './governanceCaseInbox';
import {
  projectGovernanceAuthorityHealthReadback,
  type GovernanceAuthorityHealthReadback,
} from './governanceAuthorityHealthReadback';
import {
  loadGovernanceProviderIndexerObservations,
  providerResourceBindingIdFromRequest,
} from './governanceProviderProjectionContext';
import {
  projectGovernanceProviderExecutionProgressReadback,
  projectGovernanceProviderExecutionReadback,
} from './readProjection';

const PROGRAM_VERSION = 'circle-manager-0.3.0';
const PROGRAM_IDL_DIGEST = createHash('sha256')
  .update(JSON.stringify(circleManagerIdl))
  .digest('hex');

export interface GovernanceLegacyMigrationSurface {
  prepare(input: { circleId: number; actorPubkey: string }): Promise<any>;
  finalize(input: {
    circleId: number;
    actorPubkey: string;
    compatibilityBundleId: string;
    transactionSignature: string;
  }): Promise<any>;
  read(input: { circleId: number; actorPubkey: string }): Promise<any>;
}

export function createGovernanceLegacyMigrationSurface(input: {
  prisma: any;
  rpcUrl: string;
  programId: string;
  now?: () => Date;
}): GovernanceLegacyMigrationSurface {
  if (input.programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
    throw new Error('governance_migration_runtime_chain_config_mismatch');
  }
  const connection = new Connection(input.rpcUrl, 'confirmed');
  const programId = new PublicKey(input.programId);
  const coder = new BorshAccountsCoder(circleManagerIdl as any);
  const chainReader = createRpcCompatibilityReader({ connection, programId, coder });
  const bundleStore = createPrismaGovernanceLegacyCompatibilityBundleStore(input.prisma);
  const cutoverStore = createPrismaGovernanceLegacyActionCutoverStore(input.prisma);
  const now = input.now ?? (() => new Date());

  const loadBundle = async (id: string): Promise<GovernanceLegacyCompatibilityBundleRecord> => {
    const record = await input.prisma.governanceCompatibilityBundle.findUnique({ where: { id } });
    if (!record) throw new Error('governance_migration_compatibility_bundle_missing');
    return compatibilityRecord(record);
  };
  const persist = async (
    circleId: number,
    existing: GovernanceLegacyCompatibilityBundleRecord | undefined,
    expectedOwnerPubkey: string,
    expectedPostLockActionMask?: number,
  ) => {
    const home = await input.prisma.governanceHomeIdentityBinding.findUnique({
      where: { homeType_homeRef_identityVersion: {
        homeType: 'circle', homeRef: String(circleId), identityVersion: 1,
      } },
    });
    if (!home) throw new Error('governance_compatibility_home_identity_missing');
    const id = existing?.id ?? `governance-compatibility-circle-${circleId}-v1`;
    return persistGovernanceLegacyCompatibilityFromReadback({
      prisma: input.prisma,
      chainReader,
      mutationSurfaceReader: {
        readCircleMutationSurfaces: () => readGovernanceLegacyCircleMutationSurfaces(mutationLedger),
      },
      store: bundleStore,
    }, {
      id,
      homeIdentityBindingId: home.id,
      circleId,
      expectedOwnerPubkey,
      expectedPostLockActionMask,
      version: existing?.version ?? 1,
      createdAt: existing?.createdAt ?? now(),
    });
  };

  return {
    async prepare(request) {
      assertCircleAndActor(request.circleId, request.actorPubkey);
      const record = await persist(request.circleId, undefined, request.actorPubkey);
      assertActorIsChainOwner(record, request.actorPubkey);
      const recoveryFacts = await readGovernanceLegacyMigrationRecoveryFacts(
        input.prisma,
        request.circleId,
        now(),
      );
      return buildPublicGovernanceLegacyMigrationReport(record, null, recoveryFacts);
    },
    async finalize(request) {
      assertCircleAndActor(request.circleId, request.actorPubkey);
      if (!request.transactionSignature.trim()) {
        throw new Error('governance_migration_transaction_signature_required');
      }
      const record = await loadBundle(request.compatibilityBundleId);
      if (record.circleId !== request.circleId) {
        throw new Error('governance_migration_transition_bundle_subject_mismatch');
      }
      assertActorIsChainOwner(record, request.actorPubkey);
      const result = await executeGovernanceLegacyMigrationTransition({
        loadCompatibilityBundle: loadBundle,
        revalidateCompatibilityBundle: async (id) => {
          const recoveryFacts = await readGovernanceLegacyMigrationRecoveryFacts(
            input.prisma,
            request.circleId,
            now(),
          );
          if (recoveryFacts.length > 0) {
            throw new Error('governance_migration_active_recovery_facts_present');
          }
          const current = await loadBundle(id);
          return persist(request.circleId, current, request.actorPubkey, 31);
        },
        executor: createWalletFinalizationExecutor({
          connection,
          programId,
          coder,
          actorPubkey: request.actorPubkey,
          transactionSignature: request.transactionSignature,
        }),
        actionCutoverStore: cutoverStore,
        now,
      }, {
        compatibilityBundleId: record.id,
        actions: [...LEGACY_GOVERNANCE_ACTIONS],
      });
      const recoveryFacts = await readGovernanceLegacyMigrationRecoveryFacts(
        input.prisma,
        request.circleId,
        now(),
      );
      return buildPublicGovernanceLegacyMigrationReport(
        record,
        result.actionCutover,
        recoveryFacts,
      );
    },
    async read(request) {
      assertCircleAndActor(request.circleId, request.actorPubkey);
      const record = await input.prisma.governanceCompatibilityBundle.findFirst({
        where: { circleId: request.circleId },
        orderBy: { version: 'desc' },
        include: { actionCutover: true },
      });
      if (!record) throw new Error('governance_migration_compatibility_bundle_missing');
      const compatibility = compatibilityRecord(record);
      assertActorIsChainOwner(compatibility, request.actorPubkey);
      const recoveryFacts = await readGovernanceLegacyMigrationRecoveryFacts(
        input.prisma,
        request.circleId,
        now(),
      );
      return buildPublicGovernanceLegacyMigrationReport(
        compatibility,
        record.actionCutover ?? null,
        recoveryFacts,
      );
    },
  };
}

function createRpcCompatibilityReader(input: {
  connection: Connection;
  programId: PublicKey;
  coder: BorshAccountsCoder;
}): GovernanceLegacyCompatibilityChainReader {
  return {
    async readCircle(request) {
      const accountRef = new PublicKey(request.accountRef);
      const response = await input.connection.getAccountInfoAndContext(accountRef, request.commitment);
      if (!response.value) throw new Error('governance_compatibility_circle_account_missing');
      if (!response.value.owner.equals(input.programId)) {
        throw new Error('governance_compatibility_circle_account_owner_mismatch');
      }
      const decoded: any = input.coder.decode('Circle', response.value.data);
      const circleId = safeNumber(decoded.circle_id);
      if (circleId !== request.circleId) throw new Error('governance_compatibility_circle_mismatch');
      const decisionEngine = normalizeAnchorValue(decoded.decision_engine);
      const stateFacts = {
        circleId,
        accountRef: request.accountRef,
        accountOwnerProgramId: response.value.owner.toBase58(),
        lifecycleStatus: enumVariant(decoded.status),
        flags: String(decoded.flags),
        curators: (decoded.curators ?? []).map((value: any) => value.toBase58()),
        decisionEngine,
      };
      return {
        ...stateFacts,
        observedSlot: safeNumber(response.context.slot),
        programVersionRef: PROGRAM_VERSION,
        programIdlDigest: PROGRAM_IDL_DIGEST,
        commitment: request.commitment,
        stateDigest: governanceDigest('legacy-circle-program-readback', stateFacts),
        decisionEngine: decisionEngine ? {
          type: enumVariant(decoded.decision_engine),
          configDigest: governanceDigest('legacy-decision-engine-readback', decisionEngine),
        } : null,
      };
    },
    async listOpenTransferProposals(request): Promise<LegacyTransferProposalReadback[]> {
      const rows = await input.connection.getProgramAccounts(input.programId, {
        commitment: request.commitment,
        filters: [{ memcmp: input.coder.memcmp('TransferProposal') }],
      });
      return rows.map((row) => {
        const proposal: any = input.coder.decode('TransferProposal', row.account.data);
        return { row, proposal };
      }).filter(({ proposal }) => safeNumber(proposal.from_circle) === request.circleId)
        .filter(({ proposal }) => ['Pending', 'Approved'].includes(enumVariant(proposal.status)))
        .map(({ row, proposal }) => ({
          proposalRef: row.pubkey.toBase58(),
          status: enumVariant(proposal.status),
          decisionEngineDigest: governanceDigest(
            'legacy-decision-engine-readback', normalizeAnchorValue(proposal.decision_engine),
          ),
          deadline: proposal.deadline == null ? null : safeNumber(proposal.deadline),
          votesFor: safeNumber(proposal.votes_for),
          votesAgainst: safeNumber(proposal.votes_against),
          voters: proposal.voters.length,
        })).sort((left, right) => left.proposalRef.localeCompare(right.proposalRef));
    },
  };
}

function createWalletFinalizationExecutor(input: {
  connection: Connection;
  programId: PublicKey;
  coder: BorshAccountsCoder;
  actorPubkey: string;
  transactionSignature: string;
}) {
  const readOwnerLock = async (
    preview: GovernanceLegacyMigrationTransitionPreview,
    minContextSlot?: number,
  ): Promise<GovernanceLegacyMigrationOwnerLockReadback | null> => {
    const refs = migrationRefs(input.programId, preview);
    const [migration, circle] = await Promise.all([
      input.connection.getAccountInfo(refs.migrationRecord, { commitment: 'confirmed', minContextSlot }),
      input.connection.getAccountInfo(refs.circle, { commitment: 'confirmed', minContextSlot }),
    ]);
    if (!migration) return null;
    if (!circle || !migration.owner.equals(input.programId) || !circle.owner.equals(input.programId)) {
      throw new Error('governance_migration_transition_program_owner_mismatch');
    }
    const record: any = input.coder.decode('CircleGovernanceMigrationRecord', migration.data);
    const circleState: any = input.coder.decode('Circle', circle.data);
    return {
      circleAccountRef: refs.circle.toBase58(),
      migrationRecordRef: refs.migrationRecord.toBase58(),
      preMigrationOwner: record.pre_migration_owner.toBase58(),
      compatibilityBundleDigest: Buffer.from(record.compatibility_bundle_digest).toString('hex'),
      openProposalDispositionDigest: Buffer.from(record.open_proposal_disposition_digest).toString('hex'),
      lockedActionMask: safeNumber(record.locked_action_mask),
      circleLockedActionMask: Number(BigInt(String(circleState.flags)) >> 22n) & 31,
    };
  };
  return {
    signerPubkey: input.actorPubkey,
    // This API is a wallet-finalization boundary: even when the Program record
    // already exists after an API crash, the submitted transaction must be
    // verified before cutover evidence is persisted.
    readOwnerLock: async () => null,
    async executeOwnerLock(preview: GovernanceLegacyMigrationTransitionPreview) {
      const transaction: any = await input.connection.getTransaction(input.transactionSignature, {
        commitment: 'confirmed', maxSupportedTransactionVersion: 0,
      });
      if (!transaction || transaction.meta?.err) {
        throw new Error('governance_migration_transaction_not_confirmed');
      }
      verifyMigrationInstruction(transaction, input.programId, preview, input.actorPubkey);
      const readback = await readOwnerLock(preview, safeNumber(transaction.slot));
      if (!readback) throw new Error('governance_migration_transition_readback_missing');
      return { transactionSignature: input.transactionSignature, readback };
    },
  };
}

function verifyMigrationInstruction(
  transaction: any,
  programId: PublicKey,
  preview: GovernanceLegacyMigrationTransitionPreview,
  actorPubkey: string,
): void {
  const keys = transactionAccountKeys(transaction);
  const message = transaction.transaction.message;
  const signers = keys.slice(0, Number(message.header?.numRequiredSignatures ?? 0));
  const actor = new PublicKey(actorPubkey);
  const refs = migrationRefs(programId, preview);
  if (!signers.some((key) => key.equals(actor))) {
    throw new Error('governance_migration_transaction_signer_mismatch');
  }
  const discriminator = Buffer.from([181, 40, 32, 168, 92, 186, 150, 181]);
  const expectedData = Buffer.concat([
    discriminator,
    u16(preview.actionMask),
    Buffer.from(preview.compatibilityBundleDigest, 'hex'),
    Buffer.from(preview.openProposalDispositionDigest, 'hex'),
  ]);
  const matched = (message.compiledInstructions ?? message.instructions ?? []).some((ix: any) => {
    const accounts = Array.from(ix.accountKeyIndexes ?? ix.accounts ?? []).map(Number);
    return keys[Number(ix.programIdIndex)]?.equals(programId)
      && Buffer.from(ix.data ?? []).equals(expectedData)
      && accounts.length === 4
      && keys[accounts[0]]?.equals(refs.circle)
      && keys[accounts[1]]?.equals(refs.migrationRecord)
      && keys[accounts[2]]?.equals(actor)
      && keys[accounts[3]]?.equals(SystemProgram.programId);
  });
  if (!matched) throw new Error('governance_migration_transaction_instruction_mismatch');
}

export interface GovernanceLegacyMigrationRecoveryFact {
  scenario: 'provider_outage' | 'indexer_lag' | 'partial_execution' | 'lost_key';
  caseId: string;
  requestId: string;
  provider: 'realms_provider_binding' | 'squads_provider_binding' | null;
  authority:
    | 'canonical_provider_receipt_and_reconciliation'
    | 'canonical_provider_and_indexer_observation'
    | 'canonical_cost_preflight_provider_checkpoint'
    | 'canonical_wallet_signed_authority_health_binding';
  state: 'blocked' | 'degraded' | 'partially_executed';
  blocker:
    | 'provider_readback_outage'
    | 'indexer_lag_or_finality_gap'
    | 'partial_execution_reconciliation_required'
    | 'authority_lost_key_high_risk_freeze';
  recoveryAction:
    | 'restore_readback_then_reconcile_same_receipt'
    | 'refresh_program_readback_then_rebuild_compatibility_bundle'
    | 'same_receipt_reconciliation_or_roll_forward_recovery'
    | 'new_accepted_wallet_signed_health_case_without_fault';
  retryMode: 'blocked_until_recovery_fact' | 'same_request_only';
  acceptedDecisionPreserved: true;
  observedAt: string | null;
  receiptId: string | null;
  providerObservedSlot: number | null;
  indexedSlot: number | null;
  completedSteps: number | null;
  remainingSteps: number | null;
  authorityBindingId: string | null;
  authorityEvidenceDigest: string | null;
  affectedActorPubkey: string | null;
  evidenceRef: string | null;
  freezeEndsAt: string | null;
  reviewDueAt: string | null;
  reviewStatus: 'required' | 'overdue' | null;
  authorityContinuity: {
    state: 'active_signer_wait' | 'permanently_blocked_external_authority';
    policy: 'authority_health_emergency_freeze_continuity_policy';
    signerWaitExceeded: boolean;
    providerNativeRotationAvailable: false;
    circleOwnerAdminFallbackAllowed: false;
    fallbackAuthority: 'none';
    requiredRecovery: 'new_accepted_wallet_signed_health_case_without_fault_or_external_reconstitution';
  } | null;
  authorityDisposition: {
    authority: 'canonical_provider_resource_authority_or_wallet_signed_health_readback';
    providerReadback:
      | 'authoritative_unavailable'
      | 'authoritative_degraded'
      | 'partial_finalized_checkpoint'
      | 'not_applicable_wallet_signer_fault';
    resourceAuthority:
      | 'provider_authoritative_readback_required'
      | 'canonical_cost_preflight_provider_checkpoint'
      | 'wallet_signed_authority_health_binding';
    recoveryState:
      | 'provider_recovery_required'
      | 'resource_authority_rotation_required'
      | 'partial_execution_reconciliation_required'
      | 'permanently_blocked_external_authority';
    acceptedArtifact: {
      caseId: string;
      requestId: string;
      receiptId: string | null;
      authorityBindingId: string | null;
    };
    unfulfilledObligations: string[];
    residualRisks: string[];
    fallbackAuthority: 'none';
    circleOwnerAdminFallbackAllowed: false;
  };
}

export function projectGovernanceLegacyMigrationRecoveryFacts(
  entries: Array<{
    caseId: string;
    requestId: string;
    providerExecution: any;
    providerHealth: any;
    executionProgress: any;
  }>,
): GovernanceLegacyMigrationRecoveryFact[] {
  return entries.flatMap((entry) => {
    const caseId = String(entry.caseId ?? '').trim();
    const requestId = String(entry.requestId ?? '').trim();
    if (!caseId || !requestId) return [];
    const providerValue = String(
      entry.providerExecution?.provider?.module ?? entry.providerHealth?.provider ?? '',
    );
    const provider: GovernanceLegacyMigrationRecoveryFact['provider'] =
      providerValue === 'realms_provider_binding' || providerValue === 'squads_provider_binding'
        ? providerValue
        : null;
    const receiptId = optionalText(entry.providerExecution?.receiptId);
    const providerObservedSlot = positiveIntegerOrNull(
      entry.providerHealth?.sources?.indexer?.providerObservedSlot
        ?? entry.providerHealth?.observedSlot,
    );
    const common = {
      caseId,
      requestId,
      provider,
      acceptedDecisionPreserved: true as const,
      receiptId,
      providerObservedSlot,
      authorityBindingId: null,
      authorityEvidenceDigest: null,
      affectedActorPubkey: null,
      evidenceRef: null,
      freezeEndsAt: null,
      reviewDueAt: null,
      reviewStatus: null,
      authorityContinuity: null,
    };
    const facts: GovernanceLegacyMigrationRecoveryFact[] = [];
    const recovery = entry.providerExecution?.recovery;
    if (
      recovery?.category === 'provider_outage'
      && recovery?.action === 'restore_readback_then_reconcile_same_receipt'
      && recovery?.retryMode === 'blocked_until_recovery_fact'
      && recovery?.acceptedDecisionPreserved === true
    ) {
      facts.push({
        ...common,
        scenario: 'provider_outage',
        authority: 'canonical_provider_receipt_and_reconciliation',
        state: 'blocked',
        blocker: 'provider_readback_outage',
        recoveryAction: 'restore_readback_then_reconcile_same_receipt',
        retryMode: 'blocked_until_recovery_fact',
        observedAt: dateTimeOrNull(
          entry.providerHealth?.observedAt ?? entry.providerExecution?.executedAt,
        ),
        indexedSlot: null,
        completedSteps: null,
        remainingSteps: null,
        authorityDisposition: buildProviderAuthorityDisposition({
          scenario: 'provider_outage',
          caseId,
          requestId,
          receiptId,
        }),
      });
    }
    const indexer = entry.providerHealth?.sources?.indexer;
    if (['behind', 'failed', 'unavailable'].includes(String(indexer?.state ?? ''))) {
      facts.push({
        ...common,
        scenario: 'indexer_lag',
        authority: 'canonical_provider_and_indexer_observation',
        state: 'degraded',
        blocker: 'indexer_lag_or_finality_gap',
        recoveryAction: 'refresh_program_readback_then_rebuild_compatibility_bundle',
        retryMode: 'same_request_only',
        observedAt: dateTimeOrNull(
          indexer?.lastProgressAt ?? indexer?.lastSyncedAt ?? entry.providerHealth?.observedAt,
        ),
        indexedSlot: nonNegativeIntegerOrNull(indexer?.indexedSlot),
        completedSteps: null,
        remainingSteps: null,
        authorityDisposition: buildProviderAuthorityDisposition({
          scenario: 'indexer_lag',
          caseId,
          requestId,
          receiptId,
        }),
      });
    }
    const progress = entry.executionProgress;
    if (
      progress?.state === 'partially_executed'
      && Array.isArray(progress.completed)
      && progress.completed.length > 0
      && Array.isArray(progress.remaining)
      && progress.remaining.length > 0
    ) {
      facts.push({
        ...common,
        scenario: 'partial_execution',
        authority: 'canonical_cost_preflight_provider_checkpoint',
        state: 'partially_executed',
        blocker: 'partial_execution_reconciliation_required',
        recoveryAction: 'same_receipt_reconciliation_or_roll_forward_recovery',
        retryMode: 'same_request_only',
        observedAt: dateTimeOrNull(
          entry.providerHealth?.observedAt ?? entry.providerExecution?.executedAt,
        ),
        indexedSlot: null,
        completedSteps: progress.completed.length,
        remainingSteps: progress.remaining.length,
        authorityDisposition: buildProviderAuthorityDisposition({
          scenario: 'partial_execution',
          caseId,
          requestId,
          receiptId,
        }),
      });
    }
    return facts;
  }).sort((left, right) => (
    left.scenario.localeCompare(right.scenario)
    || left.caseId.localeCompare(right.caseId)
    || left.requestId.localeCompare(right.requestId)
  ));
}

export async function readGovernanceLegacyMigrationRecoveryFacts(
  prisma: any,
  circleId: number,
  observedAt = new Date(),
): Promise<GovernanceLegacyMigrationRecoveryFact[]> {
  const [cases, authorityBindings] = await Promise.all([
    prisma.governanceCase.findMany({
      where: {
        homeIdentityBinding: { homeType: 'circle', homeRef: String(circleId) },
        primaryRequestId: { not: null },
      },
      include: {
        decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
        primaryRequest: {
          include: {
            decision: true,
            receipts: { orderBy: { executedAt: 'asc' } },
            invocation: {
              include: {
                contractVersion: true,
                profileBinding: { include: { definitionVersion: true } },
                authoritySnapshot: { include: { binding: true } },
                costPreflights: {
                  orderBy: { checkedAt: 'desc' },
                  take: 1,
                  include: { payerPolicy: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    }),
    prisma.circleGovernanceBinding.findMany({
      where: { targetCircleId: circleId, status: 'active' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const requests = cases.flatMap((governanceCase: any) => (
    governanceCase.primaryRequest ? [governanceCase.primaryRequest] : []
  ));
  const requestIds = requests.map((request: any) => request.id);
  const explicitBindingIds = requests.flatMap((request: any) => {
    const bindingId = providerResourceBindingIdFromRequest(request);
    return bindingId ? [bindingId] : [];
  });
  const bindings = requestIds.length === 0
    ? []
    : await prisma.governedResourceBinding.findMany({
      where: {
        OR: [
          { sourceRequestId: { in: requestIds } },
          { id: { in: explicitBindingIds } },
        ],
      },
      include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  const bindingBySourceRequestId = new Map(
    bindings.map((binding: any) => [binding.sourceRequestId, binding]),
  );
  const bindingById = new Map(bindings.map((binding: any) => [binding.id, binding]));
  const requestContexts: Array<{
    caseId: string;
    requestId: string;
    request: any;
    providerExecution: Record<string, unknown> | null;
  }> = cases.flatMap((governanceCase: any) => {
    const request = governanceCase.primaryRequest;
    if (!request) return [];
    const explicitBindingId = providerResourceBindingIdFromRequest(request);
    const providerResourceBinding = bindingBySourceRequestId.get(request.id)
      ?? (explicitBindingId ? bindingById.get(explicitBindingId) : null)
      ?? null;
    const requestWithProviderContext = {
      ...request,
      decisionOutputArtifacts: governanceCase.decisionOutputArtifacts,
      providerResourceBinding,
    };
    const providerExecution = projectGovernanceProviderExecutionReadback(
      requestWithProviderContext,
    );
    return [{
      caseId: String(governanceCase.id),
      requestId: String(request.id),
      request,
      providerExecution,
    }];
  });
  const providerProgramIds = [...new Set(requestContexts.flatMap((context) => {
    const programId = String((context.providerExecution as any)?.provider?.trustProfile?.programId ?? '').trim();
    return programId ? [programId] : [];
  }))];
  const indexerObservations = await loadGovernanceProviderIndexerObservations(
    prisma,
    providerProgramIds,
  );
  const providerFacts = projectGovernanceLegacyMigrationRecoveryFacts(requestContexts.map((context) => {
    const programId = String(
      (context.providerExecution as any)?.provider?.trustProfile?.programId ?? '',
    ).trim();
    return {
      caseId: context.caseId,
      requestId: context.requestId,
      providerExecution: context.providerExecution,
      providerHealth: projectGovernanceCaseInboxProviderHealth(
        context.providerExecution,
        programId ? indexerObservations.get(programId) ?? null : null,
      ),
      executionProgress: projectGovernanceProviderExecutionProgressReadback(context.request),
    };
  }));
  const caseByRequestId = new Map<string, any>(cases.flatMap((governanceCase: any) => {
    const requestId = optionalText(
      governanceCase.primaryRequest?.id ?? governanceCase.primaryRequestId,
    );
    return requestId ? [[requestId, governanceCase] as const] : [];
  }));
  const authorityHealthContexts: Array<{
    binding: any;
    health: GovernanceAuthorityHealthReadback;
    requestId: string;
  }> = authorityBindings.flatMap((binding: any) => {
    const health = projectGovernanceAuthorityHealthReadback(binding, observedAt);
    const evidence = binding.authorityHealthEvidence && typeof binding.authorityHealthEvidence === 'object'
      ? binding.authorityHealthEvidence as Record<string, any>
      : {};
    if (
      evidence.faultAssessment?.faultClass === 'lost_key'
      && health.evidenceIntegrity !== 'verified'
    ) {
      throw new Error('governance_migration_lost_key_authority_evidence_drift');
    }
    if (
      health.evidenceIntegrity !== 'verified'
      || health.faultAssessment?.faultClass !== 'lost_key'
    ) return [];
    const requestId = optionalText(evidence.sourceRequestId);
    if (!requestId) {
      throw new Error('governance_migration_lost_key_source_case_missing');
    }
    return [{ binding, health, requestId }];
  });
  const missingSourceRequestIds = [...new Set(authorityHealthContexts.flatMap((context) => (
    caseByRequestId.has(context.requestId) ? [] : [context.requestId]
  )))].sort();
  if (missingSourceRequestIds.length > 0) {
    const sourceCases = await prisma.governanceCase.findMany({
      where: {
        homeIdentityBinding: { homeType: 'circle', homeRef: String(circleId) },
        primaryRequestId: { in: missingSourceRequestIds },
      },
      select: { id: true, primaryRequestId: true },
      orderBy: { id: 'asc' },
    });
    for (const sourceCase of sourceCases) {
      const requestId = optionalText(sourceCase.primaryRequestId);
      if (requestId) caseByRequestId.set(requestId, sourceCase);
    }
  }
  const authorityFacts: GovernanceLegacyMigrationRecoveryFact[] = authorityHealthContexts.map(({
    binding,
    health,
    requestId,
  }) => {
    const sourceCase = caseByRequestId.get(requestId);
    if (!sourceCase) throw new Error('governance_migration_lost_key_source_case_missing');
    const fault = health.faultAssessment;
    if (!fault || fault.faultClass !== 'lost_key') {
      throw new Error('governance_migration_lost_key_authority_evidence_drift');
    }
    return {
      scenario: 'lost_key' as const,
      caseId: String(sourceCase.id),
      requestId,
      provider: null,
      authority: 'canonical_wallet_signed_authority_health_binding' as const,
      state: 'blocked' as const,
      blocker: 'authority_lost_key_high_risk_freeze' as const,
      recoveryAction: 'new_accepted_wallet_signed_health_case_without_fault' as const,
      retryMode: 'blocked_until_recovery_fact' as const,
      acceptedDecisionPreserved: true as const,
      observedAt: health.checkedAt,
      receiptId: null,
      providerObservedSlot: null,
      indexedSlot: null,
      completedSteps: null,
      remainingSteps: null,
      authorityBindingId: String(binding.id),
      authorityEvidenceDigest: health.evidenceDigest,
      affectedActorPubkey: fault.affectedActorPubkey,
      evidenceRef: fault.evidenceRef,
      freezeEndsAt: fault.emergencyFreeze.freezeEndsAt,
      reviewDueAt: fault.emergencyFreeze.reviewDueAt,
      reviewStatus: fault.emergencyFreeze.reviewStatus,
      authorityContinuity: {
        state: fault.emergencyFreeze.reviewStatus === 'overdue'
          ? 'permanently_blocked_external_authority' as const
          : 'active_signer_wait' as const,
        policy: 'authority_health_emergency_freeze_continuity_policy' as const,
        signerWaitExceeded: fault.emergencyFreeze.reviewStatus === 'overdue',
        providerNativeRotationAvailable: false as const,
        circleOwnerAdminFallbackAllowed: false as const,
        fallbackAuthority: 'none' as const,
        requiredRecovery: 'new_accepted_wallet_signed_health_case_without_fault_or_external_reconstitution' as const,
      },
      authorityDisposition: buildAuthorityHealthDisposition({
        caseId: String(sourceCase.id),
        requestId,
        authorityBindingId: String(binding.id),
        permanentlyBlocked: fault.emergencyFreeze.reviewStatus === 'overdue',
      }),
    };
  });
  return [...providerFacts, ...authorityFacts].sort((left, right) => (
    left.scenario.localeCompare(right.scenario)
    || left.caseId.localeCompare(right.caseId)
    || left.requestId.localeCompare(right.requestId)
  ));
}

function buildProviderAuthorityDisposition(input: {
  scenario: 'provider_outage' | 'indexer_lag' | 'partial_execution';
  caseId: string;
  requestId: string;
  receiptId: string | null;
}): GovernanceLegacyMigrationRecoveryFact['authorityDisposition'] {
  const byScenario = {
    provider_outage: {
      providerReadback: 'authoritative_unavailable' as const,
      resourceAuthority: 'provider_authoritative_readback_required' as const,
      recoveryState: 'provider_recovery_required' as const,
      unfulfilledObligations: [
        'restore_authoritative_provider_readback',
        'reconcile_same_receipt_before_any_new_execution',
      ],
      residualRisks: [
        'provider_state_unknown_until_authoritative_readback',
        'duplicate_execution_forbidden_until_same_receipt_reconciles',
      ],
    },
    indexer_lag: {
      providerReadback: 'authoritative_degraded' as const,
      resourceAuthority: 'provider_authoritative_readback_required' as const,
      recoveryState: 'resource_authority_rotation_required' as const,
      unfulfilledObligations: [
        'refresh_finalized_program_readback',
        'rebuild_compatibility_bundle_after_indexer_catches_up',
      ],
      residualRisks: [
        'program_state_may_be_newer_than_indexer_projection',
        'cutover_forbidden_until_chain_and_indexer_converge',
      ],
    },
    partial_execution: {
      providerReadback: 'partial_finalized_checkpoint' as const,
      resourceAuthority: 'canonical_cost_preflight_provider_checkpoint' as const,
      recoveryState: 'partial_execution_reconciliation_required' as const,
      unfulfilledObligations: [
        'preserve_realized_provider_steps',
        'resolve_remaining_steps_by_original_decision_authority',
      ],
      residualRisks: [
        'irreversible_provider_state_must_not_be_rewritten',
        'accepted_partial_result_must_not_display_as_original_fully_executed',
      ],
    },
  }[input.scenario];
  return {
    authority: 'canonical_provider_resource_authority_or_wallet_signed_health_readback' as const,
    ...byScenario,
    acceptedArtifact: {
      caseId: input.caseId,
      requestId: input.requestId,
      receiptId: input.receiptId,
      authorityBindingId: null,
    },
    fallbackAuthority: 'none' as const,
    circleOwnerAdminFallbackAllowed: false as const,
  };
}

function buildAuthorityHealthDisposition(input: {
  caseId: string;
  requestId: string;
  authorityBindingId: string;
  permanentlyBlocked: boolean;
}): GovernanceLegacyMigrationRecoveryFact['authorityDisposition'] {
  return {
    authority: 'canonical_provider_resource_authority_or_wallet_signed_health_readback' as const,
    providerReadback: 'not_applicable_wallet_signer_fault' as const,
    resourceAuthority: 'wallet_signed_authority_health_binding' as const,
    recoveryState: input.permanentlyBlocked
      ? 'permanently_blocked_external_authority' as const
      : 'resource_authority_rotation_required' as const,
    acceptedArtifact: {
      caseId: input.caseId,
      requestId: input.requestId,
      receiptId: null,
      authorityBindingId: input.authorityBindingId,
    },
    unfulfilledObligations: input.permanentlyBlocked
      ? [
        'external_authority_reconstitution_or_new_accepted_wallet_signed_health_case',
        'preserve_unfulfilled_provider_or_resource_obligations',
      ]
      : [
        'complete_mandatory_review_before_release',
        'prove_external_authority_rotation_or_reconstitution',
      ],
    residualRisks: input.permanentlyBlocked
      ? [
        'affected_external_authority_cannot_be_used_by_alcheme_fallback',
        'remaining_external_obligations_stay_publicly_blocked',
      ]
      : [
        'signer_wait_not_yet_terminal_but_high_risk_actions_remain_frozen',
        'circle_owner_admin_fallback_forbidden',
      ],
    fallbackAuthority: 'none' as const,
    circleOwnerAdminFallbackAllowed: false as const,
  };
}

export function buildPublicGovernanceLegacyMigrationReport(
  compatibility: GovernanceLegacyCompatibilityBundleRecord,
  cutover: GovernanceLegacyActionCutoverRecord | null,
  currentRecoveryFacts: GovernanceLegacyMigrationRecoveryFact[] = [],
) {
  if (cutover) {
    assertGovernanceLegacyActionCutoverRecordIntegrity(cutover, compatibility);
  }
  const beforeByAction = new Map(compatibility.bundle.actionMatrix.map((entry) => [entry.actionType, entry]));
  const afterByAction = new Map((cutover?.actionMatrix ?? []).map((entry) => [entry.actionType, entry]));
  const authorityMatrix = LEGACY_GOVERNANCE_ACTIONS.map((actionType) => ({
    actionType,
    before: beforeByAction.get(actionType),
    after: afterByAction.get(actionType) ?? null,
    programGuardLocked: cutover?.lockedActionMask === 31,
  }));
  const historicalExecutionBoundary = {
    policy: 'preserve_original_disposition_never_automatic_reexecute' as const,
    governanceRequestRefs: compatibility.bundle.governanceRequests.map((item) => item.requestRef),
    transferProposalRefs: compatibility.bundle.openTransferProposals.map((item) => item.proposalRef),
    crystalAssetJobRefs: compatibility.bundle.assetJobs.map((item) => item.jobRef),
    rollback: cutover
      ? 'post_cutover_roll_forward_only_history_remains_read_only' as const
      : 'pre_cutover_no_effect_history_remains_read_only' as const,
  };
  const cutoverState: GovernanceLegacyActionCutoverState | 'compatibility_ready' =
    cutover?.state ?? 'compatibility_ready';
  const chainRecoveryBoundary = {
    authority: 'canonical_program_readback_and_cutover_record' as const,
    currentState: cutoverState,
    historicalBoundary: historicalExecutionBoundary.rollback,
    verifiedRollbackPath: cutover
      ? 'not_available_after_program_guard_lock' as const
      : 'not_applicable_before_cutover_effect' as const,
    allowedRecovery: cutover
      ? 'forward_upgrade_or_governed_recovery_only' as const
      : 'refresh_dry_run_or_cancel_without_program_effect' as const,
    databaseRollbackMayClaimChainRecovery: false,
    confirmedTransactionSelfProvesRecovery: false,
    normalizedReceiptSelfProvesRecovery: false,
    historicalRecordPolicy: historicalExecutionBoundary.policy,
  };
  const recoveryRehearsal = {
    authority: 'canonical_recovery_projections_and_migration_report' as const,
    source: 'canonical_provider_indexer_and_authority_health_owners' as const,
    currentFactState: currentRecoveryFacts.length > 0
      ? 'active_recovery_facts' as const
      : 'no_active_recovery_fact' as const,
    currentFacts: [...currentRecoveryFacts].sort((left, right) => (
      left.scenario.localeCompare(right.scenario)
      || left.caseId.localeCompare(right.caseId)
      || left.requestId.localeCompare(right.requestId)
    )),
    scenarios: [
      {
        scenario: 'provider_outage' as const,
        blocker: 'provider_readback_outage' as const,
        executionPolicy: 'block_new_execution_until_reconciled' as const,
        recoveryAction: 'restore_readback_then_reconcile_same_receipt' as const,
        acceptedDecisionPreserved: true,
        retryMode: 'blocked_until_recovery_fact' as const,
      },
      {
        scenario: 'indexer_lag' as const,
        blocker: 'indexer_lag_or_finality_gap' as const,
        executionPolicy: 'authoritative_program_readback_before_cutover' as const,
        recoveryAction: 'refresh_program_readback_then_rebuild_compatibility_bundle' as const,
        acceptedDecisionPreserved: true,
        retryMode: 'same_request_only' as const,
      },
      {
        scenario: 'partial_execution' as const,
        blocker: 'partial_execution_reconciliation_required' as const,
        executionPolicy: 'preserve_receipt_and_block_legacy_reexecution' as const,
        recoveryAction: 'same_receipt_reconciliation_or_roll_forward_recovery' as const,
        acceptedDecisionPreserved: true,
        retryMode: 'same_request_only' as const,
      },
      {
        scenario: 'lost_key' as const,
        blocker: 'authority_lost_key_high_risk_freeze' as const,
        executionPolicy: 'block_cutover_until_new_wallet_signed_health_case_and_review' as const,
        recoveryAction: 'new_accepted_wallet_signed_health_case_without_fault' as const,
        acceptedDecisionPreserved: true,
        retryMode: 'blocked_until_recovery_fact' as const,
      },
    ],
    observedCutoverState: cutover?.state ?? 'compatibility_ready',
    historicalBoundary: historicalExecutionBoundary.rollback,
  };
  const hasActiveRecoveryFacts = currentRecoveryFacts.length > 0;
  const lockIntent = cutover || hasActiveRecoveryFacts ? null : ownerLockIntent(compatibility);
  const cutoverAction = buildCutoverActionReadback(
    compatibility,
    cutoverState,
    historicalExecutionBoundary.rollback,
    lockIntent !== null,
    hasActiveRecoveryFacts,
  );
  const auditTimeline = buildMigrationAuditTimeline(
    compatibility,
    cutover,
    cutoverState,
    historicalExecutionBoundary.rollback,
  );
  const residualBypass = cutover?.lockedActionMask === 31 ? [] : [...LEGACY_GOVERNANCE_ACTIONS];
  const blockingCompatibilityFacts = compatibility.bundle.blockers.filter(
    (blocker) => blocker !== 'legacy_program_incomplete',
  );
  const programGuardsLocked = authorityMatrix.filter((entry) => entry.programGuardLocked).length;
  const migrationReadiness = {
    authority: 'canonical_migration_report' as const,
    scope: 'existing_circle_action_cutover' as const,
    currentState: cutoverState,
    historicalBoundary: historicalExecutionBoundary.rollback,
    status: cutoverState === 'recovery_required' || hasActiveRecoveryFacts
      ? 'recovery_required' as const
      : cutoverState === 'cutover_active'
        && programGuardsLocked === LEGACY_GOVERNANCE_ACTIONS.length
        && residualBypass.length === 0
        && blockingCompatibilityFacts.length === 0
        ? 'ready' as const
        : 'not_ready' as const,
    metrics: {
      actionsTotal: LEGACY_GOVERNANCE_ACTIONS.length,
      programGuardsLocked,
      residualLegacyBypass: residualBypass.length,
      blockingCompatibilityFacts: blockingCompatibilityFacts.length,
      protectedHistoricalRecords:
        historicalExecutionBoundary.governanceRequestRefs.length
        + historicalExecutionBoundary.transferProposalRefs.length
        + historicalExecutionBoundary.crystalAssetJobRefs.length,
      activeRecoveryFacts: currentRecoveryFacts.length,
    },
    redlines: {
      programGuardLockComplete: programGuardsLocked === LEGACY_GOVERNANCE_ACTIONS.length,
      residualLegacyBypassZero: residualBypass.length === 0,
      compatibilityBlockersCleared: blockingCompatibilityFacts.length === 0,
      historicalAutomaticReexecutionForbidden:
        historicalExecutionBoundary.policy === 'preserve_original_disposition_never_automatic_reexecute',
      activeRecoveryFactsClear: !hasActiveRecoveryFacts,
    },
  };
  return {
    circleId: compatibility.circleId,
    network: compatibility.network,
    compatibilityBundleId: compatibility.id,
    compatibilityBundleDigest: compatibility.bundleDigest,
    state: cutoverState,
    ownerLockIntent: lockIntent,
    migrationRecordRef: cutover?.migrationRecordRef ?? null,
    transactionSignature: cutover?.transactionSignature ?? null,
    authorityMatrix,
    inFlightDisposition: {
      governanceRequests: compatibility.bundle.governanceRequests,
      openTransferProposals: compatibility.bundle.openTransferProposals,
      assetJobs: compatibility.bundle.assetJobs,
    },
    residualBypass,
    rollbackEvidence: authorityMatrix.map((entry) => ({
      actionType: entry.actionType,
      rollback: (entry.after as any)?.rollback ?? entry.before?.rollback ?? 'blocked',
    })),
    historicalExecutionBoundary: {
      ...historicalExecutionBoundary,
      auditDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.legacy-migration-historical-execution-boundary',
        historicalExecutionBoundary,
      ),
    },
    recoveryRehearsal: {
      ...recoveryRehearsal,
      auditDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.legacy-migration-recovery-rehearsal',
        recoveryRehearsal,
      ),
    },
    chainRecoveryBoundary: {
      ...chainRecoveryBoundary,
      auditDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.legacy-migration-chain-recovery-boundary',
        chainRecoveryBoundary,
      ),
    },
    cutoverAction: {
      ...cutoverAction,
      auditDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.legacy-migration-cutover-action-readback',
        cutoverAction,
      ),
    },
    auditTimeline: {
      ...auditTimeline,
      auditDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.legacy-migration-audit-timeline',
        auditTimeline,
      ),
    },
    migrationReadiness: {
      ...migrationReadiness,
      auditDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.legacy-migration-readiness',
        migrationReadiness,
      ),
    },
    blockers: compatibility.bundle.blockers,
  };
}

function buildMigrationAuditTimeline(
  compatibility: GovernanceLegacyCompatibilityBundleRecord,
  cutover: GovernanceLegacyActionCutoverRecord | null,
  currentState: GovernanceLegacyActionCutoverState | 'compatibility_ready',
  historicalBoundary: 'pre_cutover_no_effect_history_remains_read_only'
    | 'post_cutover_roll_forward_only_history_remains_read_only',
) {
  const events: Array<{
    eventType:
      | 'compatibility_bundle_persisted'
      | 'program_cutover_verified'
      | 'recovery_required'
      | 'verified_readback_restored'
      | 'future_routing_rolled_back';
    occurredAt: string;
    state: GovernanceLegacyActionCutoverState | 'compatibility_ready';
    recordRef: string;
  }> = [{
    eventType: 'compatibility_bundle_persisted',
    occurredAt: compatibility.createdAt.toISOString(),
    state: 'compatibility_ready',
    recordRef: compatibility.id,
  }];
  if (cutover) {
    events.push({
      eventType: 'program_cutover_verified',
      occurredAt: cutover.createdAt.toISOString(),
      state: 'cutover_active',
      recordRef: cutover.migrationRecordRef,
    });
    if (cutover.state === 'recovery_required') {
      events.push({
        eventType: 'recovery_required',
        occurredAt: cutover.recoveryAt!.toISOString(),
        state: 'recovery_required',
        recordRef: cutover.migrationRecordRef,
      });
    } else if (cutover.state === 'rolled_back') {
      events.push({
        eventType: 'future_routing_rolled_back',
        occurredAt: cutover.updatedAt.toISOString(),
        state: 'rolled_back',
        recordRef: cutover.migrationRecordRef,
      });
    } else if (cutover.updatedAt.getTime() > cutover.createdAt.getTime()) {
      events.push({
        eventType: 'verified_readback_restored',
        occurredAt: cutover.updatedAt.toISOString(),
        state: 'cutover_active',
        recordRef: cutover.migrationRecordRef,
      });
    }
  }
  return {
    authority: 'canonical_compatibility_and_cutover_records' as const,
    currentState,
    historicalBoundary,
    events,
  };
}

function buildCutoverActionReadback(
  compatibility: GovernanceLegacyCompatibilityBundleRecord,
  cutoverState: 'compatibility_ready' | 'cutover_active' | 'recovery_required' | 'rolled_back',
  historicalBoundary: 'pre_cutover_no_effect_history_remains_read_only'
    | 'post_cutover_roll_forward_only_history_remains_read_only',
  ownerLockAvailable: boolean,
  hasActiveRecoveryFacts: boolean,
) {
  const base = {
    authority: 'server_verified_migration_surface' as const,
    compatibilityBundleId: compatibility.id,
    compatibilityBundleDigest: compatibility.bundleDigest,
    cutoverState,
    historicalBoundary,
  };
  if (cutoverState === 'cutover_active') {
    return {
      ...base,
      status: 'already_active' as const,
      walletSignatureAllowed: false,
      disabledReason: 'cutover_already_verified' as const,
      nextAction: 'refresh_verified_readback_only' as const,
    };
  }
  if (cutoverState === 'recovery_required') {
    return {
      ...base,
      status: 'recovery_readback_required' as const,
      walletSignatureAllowed: false,
      disabledReason: 'cutover_recovery_required' as const,
      nextAction: 'restore_dependencies_then_verified_readback' as const,
    };
  }
  if (cutoverState === 'rolled_back') {
    return {
      ...base,
      status: 'rolled_back_history_read_only' as const,
      walletSignatureAllowed: false,
      disabledReason: 'future_routing_rolled_back_history_read_only' as const,
      nextAction: 'new_circle_or_program_upgrade_only' as const,
    };
  }
  if (hasActiveRecoveryFacts) {
    return {
      ...base,
      status: 'blocked_by_active_recovery' as const,
      walletSignatureAllowed: false,
      disabledReason: 'active_recovery_facts_present' as const,
      nextAction: 'resolve_active_recovery_facts_then_refresh' as const,
    };
  }
  if (!ownerLockAvailable) {
    return {
      ...base,
      status: 'blocked_by_compatibility_blockers' as const,
      walletSignatureAllowed: false,
      disabledReason: 'compatibility_blockers_present' as const,
      nextAction: 'resolve_compatibility_blockers_then_refresh_dry_run' as const,
    };
  }
  return {
    ...base,
    status: 'wallet_signature_available' as const,
    walletSignatureAllowed: true,
    disabledReason: null,
    nextAction: 'owner_wallet_signature_then_server_verified_finalize' as const,
  };
}

function ownerLockIntent(compatibility: GovernanceLegacyCompatibilityBundleRecord) {
  if (compatibility.bundle.blockers.some((blocker) => blocker !== 'legacy_program_incomplete')) {
    return null;
  }
  const preview = prepareGovernanceLegacyMigrationTransition(compatibility, {
    actions: [...LEGACY_GOVERNANCE_ACTIONS],
  });
  return {
    network: preview.network,
    circleId: preview.circleId,
    circleAccountRef: preview.circleAccountRef,
    expectedOwnerPubkey: preview.expectedOwnerPubkey,
    actions: preview.actions,
    actionMask: preview.actionMask,
    compatibilityBundleDigest: preview.compatibilityBundleDigest,
    openProposalDispositionDigest: preview.openProposalDispositionDigest,
  };
}

function compatibilityRecord(value: any): GovernanceLegacyCompatibilityBundleRecord {
  return {
    id: value.id,
    homeIdentityBindingId: value.homeIdentityBindingId,
    circleId: value.circleId,
    version: value.version,
    schemaVersion: value.schemaVersion,
    canonicalCodecVersion: value.canonicalCodecVersion,
    network: value.network,
    sourceSlot: BigInt(value.sourceSlot),
    chainStateDigest: value.chainStateDigest,
    projectionStateDigest: value.projectionStateDigest,
    bundle: JSON.parse(JSON.stringify(value.bundle)),
    bundleDigest: value.bundleDigest,
    createdAt: new Date(value.createdAt),
  };
}

function migrationRefs(programId: PublicKey, preview: GovernanceLegacyMigrationTransitionPreview) {
  const circle = new PublicKey(preview.circleAccountRef);
  const [expectedCircle] = PublicKey.findProgramAddressSync(
    [Buffer.from('circle'), Buffer.from([preview.circleId])], programId,
  );
  if (!circle.equals(expectedCircle)) throw new Error('governance_migration_circle_pda_mismatch');
  const [migrationRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from('circle_governance_migration'), circle.toBuffer(), u16(preview.actionMask)],
    programId,
  );
  return { circle, migrationRecord };
}

function transactionAccountKeys(transaction: any): PublicKey[] {
  const message = transaction.transaction.message;
  const loaded = transaction.meta?.loadedAddresses;
  return [
    ...(message.staticAccountKeys ?? message.accountKeys ?? []),
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ].map((value) => new PublicKey(value));
}

function governanceDigest(domain: string, value: unknown): string {
  return hashCanonicalGovernanceValue(`alcheme.governance.${domain}`, value);
}

function assertCircleAndActor(circleId: number, actorPubkey: string) {
  if (!Number.isSafeInteger(circleId) || circleId < 1 || circleId > 255) {
    throw new Error('invalid_governance_migration_circle_id');
  }
  new PublicKey(actorPubkey);
}

function assertActorIsChainOwner(record: GovernanceLegacyCompatibilityBundleRecord, actorPubkey: string) {
  if (record.bundle.chainReadback.curators[0] !== actorPubkey) {
    throw new Error('governance_migration_transition_owner_signature_required');
  }
}

function safeNumber(value: unknown): number {
  const bigint = BigInt(String(value));
  if (bigint < 0n || bigint > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('invalid_governance_migration_chain_integer');
  }
  return Number(bigint);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateTimeOrNull(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveIntegerOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function enumVariant(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const key = Object.keys(value as Record<string, unknown>)[0] ?? '';
  return key ? `${key[0].toUpperCase()}${key.slice(1)}` : '';
}

function normalizeAnchorValue(value: any): any {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value?.toBase58 === 'function') return value.toBase58();
  if (value?.constructor?.name === 'BN') return value.toString(10);
  if (Array.isArray(value)) return value.map(normalizeAnchorValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      normalizeIdlKey(key),
      normalizeAnchorValue(child),
    ]));
  }
  throw new Error('unsupported_governance_migration_chain_value');
}

function normalizeIdlKey(value: string): string {
  const camel = value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return camel ? `${camel[0].toLowerCase()}${camel.slice(1)}` : camel;
}
