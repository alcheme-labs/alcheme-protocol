import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import circleManagerIdl from '../../../../../sdk/src/idl/circle_manager.json';
import {
  createGovernanceBootstrapBundle,
  type GovernanceBootstrapBundleInput,
  type GovernanceBootstrapReadinessChecks,
  type GovernanceBootstrapVersionedRef,
} from './governanceBootstrapContract';
import {
  GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID,
  GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_DOMAIN,
  GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_SCHEMA_VERSION,
  createGovernanceBootstrapCeremonyOpeningV2,
  createGovernanceBootstrapCircleOwnerProof,
  createGovernanceBootstrapFoundingConfirmationPolicyV2,
  verifyGovernanceBootstrapCeremonyOpeningV2Signature,
  type GovernanceBootstrapCeremonyOpeningV2Input,
  type GovernanceBootstrapFoundingConfirmationPolicyV2Input,
} from './governanceBootstrapCeremonyContract';
import {
  createGovernanceBootstrapLocalnetAdapter,
  type GovernanceBootstrapLocalnetCircleReadback,
} from './governanceBootstrapLocalnetAdapter';
import {
  createGovernanceBootstrapReadinessRuntimeEvidence,
  openGovernanceBootstrapCeremonyRuntime,
  queueGovernanceBootstrapCeremonyRuntime,
  submitGovernanceBootstrapDeliveryRuntime,
  verifyAndActivateGovernanceBootstrapRuntime,
} from './governanceBootstrapRuntime';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { CIRCLE_GOVERNANCE_PROFILE_V1 } from './governanceProfile';
import { createPrismaGovernanceConfigurationBundleStore } from './governanceConfigurationBundleStore';
import { createGovernedActionRegistry } from './actionRegistry';
import { GovernedActionGateway } from './governedActionGateway';
import { ensureGovernedActionRuntimeSeeds } from './governedActionGatewayRuntime';
import {
  governanceBootstrapProfileBindingId,
  prepareBootstrapGovernanceProfileBinding,
} from './governanceProfileLifecycle';
import {
  createPrismaGovernanceRequestStore,
} from './policyEngine';
import { createBootstrapSelfGovernedPolicyContract } from './circleGovernanceBindings';

const READINESS_FACT_DOMAIN = 'alcheme.governance.bootstrap-circle-readiness-fact';
const CURRENT_CIRCLE_BOOTSTRAP_FACT_DOMAIN = 'alcheme.governance.bootstrap-current-circle-fact';
const SIGNATURE_TTL_SECONDS = 300;
const PROGRAM_IDL_DIGEST = createHash('sha256')
  .update(JSON.stringify(circleManagerIdl))
  .digest('hex');

export interface GovernanceBootstrapCircleReader {
  read(circleId: number, circleAccountRef: string): Promise<GovernanceBootstrapLocalnetCircleReadback>;
}

export interface CircleGovernanceBootstrapPreviewInput {
  circleId: number;
  actorPubkey: string;
}

export type CircleGovernanceBootstrapPreview = Awaited<ReturnType<typeof prepareCircleGovernanceBootstrapPreview>>;

export async function prepareCircleGovernanceBootstrapPreview(
  dependencies: {
    prisma: any;
    chainReader: GovernanceBootstrapCircleReader;
    now?: () => Date;
    randomId?: () => string;
  },
  input: CircleGovernanceBootstrapPreviewInput,
) {
  assertCircleAndActor(input.circleId, input.actorPubkey);
  const now = validDate((dependencies.now ?? (() => new Date()))());
  const [circle, identity] = await Promise.all([
    dependencies.prisma.circle.findUnique({
      where: { id: input.circleId },
      select: {
        id: true,
        onChainAddress: true,
        creator: { select: { pubkey: true, onChainAddress: true } },
      },
    }),
    dependencies.prisma.governanceHomeIdentityBinding.findUnique({
      where: { id: homeIdentityId(input.circleId) },
      include: { activationState: true },
    }),
  ]);
  if (!circle || !identity || !identity.activationState) {
    throw new Error('governance_bootstrap_circle_home_not_initialized');
  }
  if (identity.status !== 'inactive'
    || identity.activationState.state !== 'bootstrap_pending'
    || identity.chainAccountRef !== circle.onChainAddress) {
    throw new Error('governance_bootstrap_circle_home_not_preparable');
  }
  const chain = await dependencies.chainReader.read(input.circleId, circle.onChainAddress);
  if (chain.ownerPubkey !== input.actorPubkey
    || chain.programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
    throw new Error('governance_bootstrap_circle_owner_mismatch');
  }
  const projectionCreatorPubkey = String(circle.creator?.pubkey || circle.creator?.onChainAddress || '');
  if (projectionCreatorPubkey !== input.actorPubkey) {
    throw new Error('governance_bootstrap_owner_projection_chain_mismatch');
  }
  const currentContract = createCurrentCircleGovernanceBootstrapContract(identity);
  const canonicalBundle = createGovernanceBootstrapBundle(currentContract.configurationBundle);
  assertIndependentPolicyRefs(
    canonicalBundle.bundle.emergencyPolicy,
    currentContract.recoveryPolicy,
    currentContract.supportPolicy,
    input.actorPubkey,
  );
  if (currentContract.confirmation.authoritySignature !== 'required') {
    throw new Error('governance_bootstrap_circle_owner_signature_required');
  }
  const configurationBundleId = `governance-config-circle-${input.circleId}-${canonicalBundle.digest.slice(0, 24)}`;
  const nonce = (dependencies.randomId ?? randomUUID)();
  const ceremonyId = `governance-bootstrap-circle-${input.circleId}-${nonce}`;
  if (ceremonyId.length > 96) throw new Error('governance_bootstrap_ceremony_id_too_long');
  const openedAt = now.toISOString();
  const signatureExpiresAt = new Date(now.getTime() + SIGNATURE_TTL_SECONDS * 1000).toISOString();
  const authorityProof = createGovernanceBootstrapCircleOwnerProof({
    network: chain.network,
    homeIdentityBindingId: identity.id,
    homeChainAccountRef: circle.onChainAddress,
    circleId: input.circleId,
    circleAccountRef: circle.onChainAddress,
    circleAccountOwnerProgramId: chain.programId,
    programId: chain.programId,
    programVersionRef: 'circle-manager-0.3.0',
    programIdlDigest: PROGRAM_IDL_DIGEST,
    decodedCircleId: chain.circleId,
    decodedStatus: chain.lifecycleStatus,
    decodedOwnerPubkey: chain.ownerPubkey,
    actorPubkey: input.actorPubkey,
    observedSlot: chain.observedSlot,
    commitment: 'confirmed',
    stateDigest: chain.stateDigest,
    observedAt: openedAt,
    validUntil: signatureExpiresAt,
    projectionCreatorPubkey,
    unresolvedOwnerTransferCount: 0,
  });
  const confirmationPolicy = createGovernanceBootstrapFoundingConfirmationPolicyV2({
    ...currentContract.confirmation,
    homeIdentityBindingId: identity.id,
    configurationBundleId,
    configurationBundleDigest: canonicalBundle.digest,
    openedAt,
  });
  const readinessChecks = createCircleReadinessChecks({
    bundle: canonicalBundle.bundle,
    bundleDigest: canonicalBundle.digest,
    authorityProof,
    confirmationPolicy,
    recoveryPolicy: currentContract.recoveryPolicy,
    supportPolicy: currentContract.supportPolicy,
  });
  const readiness = createGovernanceBootstrapReadinessRuntimeEvidence({
    bundle: currentContract.configurationBundle,
    checks: readinessChecks,
  });
  const openingInput = {
    config: { chainId: chain.network },
    ceremonyId,
    homeIdentityBindingId: identity.id,
    configurationBundleId,
    configurationBundleVersion: 1,
    configurationBundleDigest: canonicalBundle.digest,
    actorPubkey: input.actorPubkey,
    authorityProof,
    confirmationPolicy,
    signatureNonce: nonce,
    openedAt,
    signatureExpiresAt,
    readinessDigest: readiness.readinessDigest,
  };
  const opening = createGovernanceBootstrapCeremonyOpeningV2(openingInput);
  return deepFreeze({
    schemaVersion: 1,
    circleId: input.circleId,
    configurationBundle: currentContract.configurationBundle,
    recoveryPolicy: currentContract.recoveryPolicy,
    supportPolicy: currentContract.supportPolicy,
    foundingConfirmationRequest: confirmationPolicy.requestFacts === null ? null : {
      requestFacts: confirmationPolicy.requestFacts,
      snapshotFacts: confirmationPolicy.snapshotFacts,
    },
    readinessChecks,
    readiness: readiness.evaluation,
    openingInput,
    opening,
    temporaryAuthority: temporaryAuthorityExplanation(openingInput),
  });
}

export async function openCircleGovernanceBootstrapCeremony(
  dependencies: { prisma: any; chainReader: GovernanceBootstrapCircleReader },
  input: {
    preview: CircleGovernanceBootstrapPreview;
    signatureBase64: string;
    governanceRequestId: string | null;
    now: Date;
  },
) {
  const now = validDate(input.now);
  await validatePreviewAgainstCurrentAuthority(dependencies, input.preview);
  const rebuilt = rebuildPreviewContracts(input.preview);
  const signatureEvidence = verifyGovernanceBootstrapCeremonyOpeningV2Signature({
    opening: rebuilt.opening,
    authorityProof: input.preview.openingInput.authorityProof,
    signatureBase64: input.signatureBase64,
    now: now.toISOString(),
  });
  await prepareBootstrapGovernanceProfileBinding(dependencies.prisma, {
    homeIdentityBindingId: input.preview.openingInput.homeIdentityBindingId,
    homeType: 'circle',
    targetProfile: CIRCLE_GOVERNANCE_PROFILE_V1,
    now: new Date(input.preview.openingInput.openedAt),
  });
  await createPrismaGovernanceConfigurationBundleStore(dependencies.prisma)
    .persistGovernanceConfigurationBundle({
      id: input.preview.openingInput.configurationBundleId,
      homeIdentityBindingId: input.preview.openingInput.homeIdentityBindingId,
      version: input.preview.openingInput.configurationBundleVersion,
      bundle: input.preview.configurationBundle,
      createdAt: new Date(input.preview.openingInput.openedAt),
    });
  const opened = await openGovernanceBootstrapCeremonyRuntime({ prisma: dependencies.prisma }, {
    configurationBundleId: input.preview.openingInput.configurationBundleId,
    configurationBundle: input.preview.configurationBundle,
    openingInput: input.preview.openingInput,
    signatureBase64: input.signatureBase64,
    readinessChecks: input.preview.readinessChecks,
    governanceRequestId: input.governanceRequestId,
    now,
  });
  return deepFreeze({ opened, signatureEvidence, temporaryAuthority: input.preview.temporaryAuthority });
}

export async function openCircleGovernanceBootstrapFoundingRequest(
  dependencies: { prisma: any; chainReader: GovernanceBootstrapCircleReader },
  input: { preview: CircleGovernanceBootstrapPreview; now: Date },
) {
  validDate(input.now);
  await validatePreviewAgainstCurrentAuthority(dependencies, input.preview);
  const rebuilt = rebuildPreviewContracts(input.preview);
  const requestFacts = input.preview.foundingConfirmationRequest?.requestFacts;
  const snapshotFacts = input.preview.foundingConfirmationRequest?.snapshotFacts;
  const foundingPolicy = input.preview.openingInput.confirmationPolicy.policy.foundingMemberPolicy;
  if (!requestFacts || !snapshotFacts || !foundingPolicy) {
    throw new Error('governance_bootstrap_founding_request_not_required');
  }
  const policyDigest = input.preview.openingInput.confirmationPolicy.digest;
  const policyId = `bootstrap-confirmation-policy:${policyDigest.slice(0, 32)}`;
  const policyVersionId = `${policyId}:v1`;
  const ruleId = 'bootstrap:founding_confirmation';
  const requestId = `governance-bootstrap-founding:${rebuilt.opening.openingDigest.slice(0, 40)}`;
  const idempotencyKey = `bootstrap-founding:${input.preview.openingInput.configurationBundleId}`;
  const actionType = 'governance.bootstrap.founding_confirmation';
  const registry = createGovernedActionRegistry({ includeGovernanceBootstrapActions: true });
  const definition = registry.get(actionType);
  if (!definition) throw new Error('governance_bootstrap_founding_action_contract_missing');
  const openedAt = new Date(input.preview.openingInput.openedAt);
  const executionModeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.request-execution-mode',
    {
      executionMode: 'stage_decision_only',
      ceremonyId: input.preview.openingInput.ceremonyId,
      confirmationPolicyDigest: input.preview.opening.opening.confirmationPolicyDigest,
      homeIdentityBindingId: input.preview.openingInput.homeIdentityBindingId,
      profileBindingId: governanceBootstrapProfileBindingId(
        input.preview.openingInput.homeIdentityBindingId,
      ),
      profileVersionRef: CIRCLE_GOVERNANCE_PROFILE_V1.versionRef,
      profileDefinitionDigest: CIRCLE_GOVERNANCE_PROFILE_V1.definitionDigest,
    },
  );
  const rules = {
    rules: [{
      id: ruleId,
      strategy: 'committee.member_threshold',
      threshold: foundingPolicy.threshold,
      ballotDisclosure: { mode: 'member' },
    }],
  };
  const metadata = {
    bootstrapOnly: true,
    ceremonyId: input.preview.openingInput.ceremonyId,
    configurationBundleId: input.preview.openingInput.configurationBundleId,
    configurationBundleDigest: input.preview.openingInput.configurationBundleDigest,
    confirmationPolicyDigest: policyDigest,
    grantsActivePolicyAuthority: false,
  };
  const persist = () => dependencies.prisma.$transaction(async (tx: any) => {
    const [existingPolicy, existingVersion, home] = await Promise.all([
      tx.governancePolicy.findUnique({ where: { id: policyId } }),
      tx.governancePolicyVersion.findUnique({ where: { id: policyVersionId } }),
      tx.governanceHomeIdentityBinding.findUnique({
        where: { id: input.preview.openingInput.homeIdentityBindingId },
      }),
    ]);
    if (!home
      || home.homeType !== 'circle'
      || home.homeRef !== String(input.preview.circleId)
      || home.supersededAt !== null) {
      throw new Error('governance_bootstrap_founding_request_home_mismatch');
    }
    const profileBinding = await prepareBootstrapGovernanceProfileBinding({
      ...tx,
      $transaction: async (operation: (client: any) => Promise<any>) => operation(tx),
    }, {
      homeIdentityBindingId: home.id,
      homeType: home.homeType,
      targetProfile: CIRCLE_GOVERNANCE_PROFILE_V1,
      now: openedAt,
    });
    if (existingPolicy) {
      if (existingPolicy.scopeType !== 'governance_home'
        || existingPolicy.scopeRef !== input.preview.openingInput.homeIdentityBindingId
        || existingPolicy.status !== 'draft'
        || existingPolicy.activeVersion !== null
        || existingPolicy.createdByPubkey !== input.preview.openingInput.actorPubkey
        || !isDeepStrictEqual(existingPolicy.metadata, metadata)) {
        throw new Error('governance_bootstrap_founding_policy_immutable_mismatch');
      }
    } else {
      await tx.governancePolicy.create({ data: {
        id: policyId,
        scopeType: 'governance_home',
        scopeRef: input.preview.openingInput.homeIdentityBindingId,
        status: 'draft',
        activeVersion: null,
        createdByPubkey: input.preview.openingInput.actorPubkey,
        metadata,
      } });
    }
    if (existingVersion) {
      if (existingVersion.policyId !== policyId || existingVersion.version !== 1
        || existingVersion.status !== 'draft'
        || existingVersion.configDigest !== policyDigest
        || existingVersion.activatedAt !== null
        || existingVersion.createdByPubkey !== input.preview.openingInput.actorPubkey
        || !isDeepStrictEqual(existingVersion.rules, rules)) {
        throw new Error('governance_bootstrap_founding_policy_immutable_mismatch');
      }
    } else {
      await tx.governancePolicyVersion.create({ data: {
        id: policyVersionId,
        policyId,
        version: 1,
        status: 'draft',
        rules,
        configDigest: policyDigest,
        activatedAt: null,
        createdByPubkey: input.preview.openingInput.actorPubkey,
      } });
    }
    const seeded = await ensureGovernedActionRuntimeSeeds({
      prisma: tx,
      transactionClient: true,
    }, {
      definition,
      home,
      binding: {
        id: `bootstrap-founding-authority:${policyDigest.slice(0, 32)}`,
        policyId,
        policyVersionId,
        policyVersion: 1,
        ruleId,
        committeeCircleId: input.preview.circleId,
        authoritySourceType: 'bootstrap_founding_policy',
        authoritySourceRef: policyVersionId,
        authoritySourceVersion: foundingPolicy.eligibleSourceVersion,
        authorityPurpose: 'bootstrap_founding_confirmation',
        authoritySelector: {
          actionType,
          homeIdentityBindingId: home.id,
          subjectType: requestFacts.action.targetType,
          subjectRef: requestFacts.action.targetRef,
          environment: 'local_development',
          network: 'solana:localnet',
        },
        authorityLimits: {
          policyDigest,
          eligibleSourceDigest: foundingPolicy.eligibleSourceDigest,
          threshold: foundingPolicy.threshold,
          grantsActivePolicyAuthority: false,
        },
      },
      now: openedAt,
    });
    const payload = requestFacts.action.payload as Record<string, unknown>;
    const gateway = new GovernedActionGateway({
      registry,
      resolveBinding: async () => null,
      listCommitteeEligibleActors: async () => requestFacts.eligibleActors,
      requestStore: createPrismaGovernanceRequestStore(tx),
      runtimePrisma: tx,
      runtimeTransactionClient: true,
      createRequestId: () => requestId,
      now: () => openedAt,
    });
    const request = await gateway.openPreResolvedRequest({
      actionType,
      targetType: requestFacts.action.targetType,
      targetRef: requestFacts.action.targetRef,
      payload,
      idempotencyKey,
      proposerPubkey: input.preview.openingInput.actorPubkey,
      authority: {
        id: `bootstrap-founding-authority:${policyDigest.slice(0, 32)}`,
        policyId,
        policyVersionId,
        policyVersion: 1,
        ruleId,
        committeeCircleId: input.preview.circleId,
      },
      eligibleActors: requestFacts.eligibleActors,
      scope: requestFacts.scope,
      runtime: {
        homeIdentityBindingId: home.id,
        governanceHomeType: home.homeType,
        governanceHomeRef: home.homeRef,
        ...seeded,
        profileBindingId: profileBinding.id,
        profileVersionRef: CIRCLE_GOVERNANCE_PROFILE_V1.versionRef,
        profileDefinitionDigest: CIRCLE_GOVERNANCE_PROFILE_V1.definitionDigest,
        payloadDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.action-payload',
          payload,
        ),
        executionMode: 'stage_decision_only',
        compatibilityBundleVersion: null,
        executionModeDigest,
      },
      caseRef: input.preview.openingInput.ceremonyId,
      stageRef: 'bootstrap_founding_confirmation',
      executionAuthorizationReason: 'bootstrap_founding_confirmation_stage',
      expiresAt: null,
    });
    const current = await tx.governanceRequest.findUnique({
      where: { id: request.id },
      include: { snapshot: true },
    });
    if (!current || current.homeIdentityBindingId !== input.preview.openingInput.homeIdentityBindingId) {
      throw new Error('governance_bootstrap_founding_request_home_mismatch');
    }
    return tx.governanceRequest.findUnique({
      where: { id: request.id },
      include: { snapshot: true },
    });
  });
  try {
    return await persist();
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    return persist();
  }
}

export async function activateCircleGovernanceBootstrapCeremony(
  dependencies: {
    prisma: any;
    chainReader: GovernanceBootstrapCircleReader;
    rpcUrl: string;
    programId: string;
  },
  input: { circleId: number; ceremonyId: string; actorPubkey: string; now: Date },
) {
  assertCircleAndActor(input.circleId, input.actorPubkey);
  const now = validDate(input.now);
  const homeIdentityBindingId = homeIdentityId(input.circleId);
  const circle = await dependencies.prisma.circle.findUnique({
    where: { id: input.circleId },
    select: { id: true, onChainAddress: true },
  });
  const ceremony = await dependencies.prisma.governanceBootstrapCeremony.findUnique({
    where: { id: input.ceremonyId },
    include: {
      configurationBundle: true,
      events: { orderBy: { sequence: 'asc' } },
      deliveries: { orderBy: { attempt: 'asc' } },
    },
  });
  if (!circle?.onChainAddress
    || !ceremony
    || ceremony.actorPubkey !== input.actorPubkey
    || ceremony.homeIdentityBindingId !== homeIdentityBindingId
    || (ceremony.signatureNetwork !== 'solana:localnet'
      && ceremony.signatureNetwork !== 'solana:devnet')
    || !ceremony.signature
    || !ceremony.signatureDigest
    || !ceremony.readinessDigest
    || ceremony.confirmationPolicyVersion !== 'founding-v2'
    || ceremony.governanceRequestId !== null
    || ceremony.events?.length < 1
    || ceremony.deliveries?.length !== 1) {
    throw new Error('governance_bootstrap_circle_ceremony_mismatch');
  }
  const persistedBundle = ceremony.configurationBundle.bundle as Record<string, unknown>;
  const {
    schemaVersion,
    canonicalCodecVersion,
    ...bundleInput
  } = persistedBundle;
  if (schemaVersion !== 1 || canonicalCodecVersion !== 1) {
    throw new Error('governance_bootstrap_circle_configuration_bundle_version_mismatch');
  }
  const canonicalBundle = createGovernanceBootstrapBundle(
    bundleInput as unknown as GovernanceBootstrapBundleInput,
  );
  if (canonicalBundle.digest !== ceremony.configurationBundleDigest
    || canonicalBundle.digest !== ceremony.configurationBundle.bundleDigest
    || ceremony.configurationBundleId !== ceremony.configurationBundle.id
    || !isDeepStrictEqual(canonicalBundle.bundle, persistedBundle)) {
    throw new Error('governance_bootstrap_circle_configuration_bundle_mismatch');
  }
  const openedEvent = ceremony.events[0];
  const openingDigest = openedEvent.transactionIntentDigest;
  const storedSignatureDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.bootstrap-opening-signature',
    { signatureBase64: ceremony.signature },
  );
  if (openedEvent.sequence !== 1
    || openedEvent.eventType !== 'ceremony_opened'
    || !openingDigest
    || storedSignatureDigest !== ceremony.signatureDigest
    || openedEvent.observedAuthorityRef !== input.actorPubkey
    || openedEvent.observedAuthorityDigest !== ceremony.sourceAuthorityDigest) {
    throw new Error('governance_bootstrap_circle_opening_evidence_mismatch');
  }
  const signatureEvidenceFacts = {
    schemaVersion: GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_SCHEMA_VERSION,
    domain: GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_DOMAIN,
    signatureScheme: 'ed25519' as const,
    signatureVersion: 'ed25519-detached-v1' as const,
    network: ceremony.signatureNetwork,
    actorPubkey: ceremony.actorPubkey,
    openingDigest,
    authorityProofDigest: ceremony.sourceAuthorityDigest,
    signatureDigest: storedSignatureDigest,
    verifiedAt: new Date(openedEvent.occurredAt).toISOString(),
  };
  const signatureEvidence = {
    evidence: signatureEvidenceFacts,
    signatureEvidenceRef: `bootstrap-opening-signature:${openingDigest}:${ceremony.actorPubkey}`,
    signatureEvidenceVersion: 'ed25519-detached-v1' as const,
    signatureEvidenceDigest: hashCanonicalGovernanceValue(
      GOVERNANCE_BOOTSTRAP_OPENING_SIGNATURE_EVIDENCE_DOMAIN,
      signatureEvidenceFacts,
    ),
  };
  const persistedOpening = {
    opening: {
      network: ceremony.signatureNetwork,
      homeIdentityBindingId,
      configurationBundleId: ceremony.configurationBundleId,
      confirmationPolicyDigest: ceremony.confirmationPolicyDigest,
      foundingMemberConfirmation: 'not_required' as const,
    },
    openingDigest,
  } as ReturnType<typeof createGovernanceBootstrapCeremonyOpeningV2>;
  const chain = await dependencies.chainReader.read(input.circleId, circle.onChainAddress);
  if (chain.circleId !== input.circleId
    || chain.network !== ceremony.signatureNetwork
    || chain.circleAccountRef !== circle.onChainAddress
    || chain.ownerPubkey !== input.actorPubkey
    || chain.programId !== dependencies.programId
    || chain.programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID
    || !ceremony.sourceAuthorityRef.startsWith(
      `${chain.network}:${chain.programId}:${chain.circleAccountRef}:`,
    )) {
    throw new Error('governance_bootstrap_circle_authority_drift');
  }
  const temporaryAuthority = {
    actorPubkey: ceremony.actorPubkey,
    source: 'current_circle_program_owner',
    scope: 'open_and_activate_this_bootstrap_ceremony',
    retainedAfterActivation: false,
    bypassStatus: 'disabled',
    terminatesOn: 'activation_or_recovery_abort',
    openingSignatureExpiresAt: ceremony.signatureExpiresAt?.toISOString?.() ?? null,
    explanationRef: 'knowledge://governance/bootstrap/current-circle-owner-timelock',
  };
  const queued = ['prepared', 'waiting'].includes(ceremony.state)
    ? await queueGovernanceBootstrapCeremonyRuntime({ prisma: dependencies.prisma }, {
      ceremonyId: ceremony.id,
      opening: persistedOpening,
      signatureEvidence,
      now,
    })
    : null;
  if (queued && !queued.queued) return deepFreeze({
    activated: false as const,
    queued,
    activation: null,
    temporaryAuthority,
  });
  if (!queued && !['executing', 'verifying', 'recovery_required', 'active'].includes(ceremony.state)) {
    throw new Error('governance_bootstrap_circle_ceremony_state_invalid');
  }
  const adapter = createGovernanceBootstrapLocalnetAdapter({
    network: chain.network,
    prisma: dependencies.prisma,
    rpcUrl: dependencies.rpcUrl,
    programId: dependencies.programId,
    circleId: input.circleId,
    circleAccountRef: chain.circleAccountRef,
    expectedOwnerPubkey: chain.ownerPubkey,
    homeIdentityBindingId,
    configurationBundleId: ceremony.configurationBundleId,
  });
  let submitted: Awaited<ReturnType<typeof submitGovernanceBootstrapDeliveryRuntime>>;
  try {
    submitted = await submitGovernanceBootstrapDeliveryRuntime({
      prisma: dependencies.prisma,
      adapter,
    }, {
      ceremonyId: ceremony.id,
      leaseOwner: 'circle-bootstrap-route',
      leaseToken: randomUUID(),
      now,
    });
  } catch {
    throw new Error('governance_bootstrap_runtime_adapter_submit_unavailable');
  }
  const activation = await verifyAndActivateGovernanceBootstrapRuntime({
    prisma: dependencies.prisma,
    adapter,
  }, { ceremonyId: ceremony.id, now });
  if (!activation.activated) return deepFreeze({
    activated: false as const,
    queued,
    submitted,
    activation,
    temporaryAuthority,
  });
  return deepFreeze({ activated: true as const, queued, submitted, activation });
}

function rebuildPreviewContracts(preview: CircleGovernanceBootstrapPreview) {
  const canonical = createGovernanceBootstrapBundle(preview.configurationBundle);
  const expectedConfigurationBundleId =
    `governance-config-circle-${preview.circleId}-${canonical.digest.slice(0, 24)}`;
  const expectedCeremonyId =
    `governance-bootstrap-circle-${preview.circleId}-${preview.openingInput.signatureNonce}`;
  assertIndependentPolicyRefs(
    canonical.bundle.emergencyPolicy,
    preview.recoveryPolicy,
    preview.supportPolicy,
    preview.openingInput.actorPubkey,
  );
  if (preview.schemaVersion !== 1
    || preview.openingInput.configurationBundleId !== expectedConfigurationBundleId
    || preview.openingInput.ceremonyId !== expectedCeremonyId
    || preview.openingInput.confirmationPolicy.policy.authoritySignature !== 'required'
    || Date.parse(preview.openingInput.signatureExpiresAt)
      - Date.parse(preview.openingInput.openedAt) !== SIGNATURE_TTL_SECONDS * 1000
    || preview.openingInput.authorityProof.proof.programIdlDigest !== PROGRAM_IDL_DIGEST
    || preview.openingInput.authorityProof.proof.programVersionRef !== 'circle-manager-0.3.0'
    || !isDeepStrictEqual(
      preview.temporaryAuthority,
      temporaryAuthorityExplanation(preview.openingInput),
    )) {
    throw new Error('governance_bootstrap_circle_preview_contract_mismatch');
  }
  const expectedReadinessChecks = createCircleReadinessChecks({
    bundle: canonical.bundle,
    bundleDigest: canonical.digest,
    authorityProof: preview.openingInput.authorityProof,
    confirmationPolicy: preview.openingInput.confirmationPolicy,
    recoveryPolicy: preview.recoveryPolicy,
    supportPolicy: preview.supportPolicy,
  });
  if (!isDeepStrictEqual(expectedReadinessChecks, preview.readinessChecks)) {
    throw new Error('governance_bootstrap_circle_preview_readiness_mismatch');
  }
  const readiness = createGovernanceBootstrapReadinessRuntimeEvidence({
    bundle: preview.configurationBundle,
    checks: preview.readinessChecks,
  });
  if (!isDeepStrictEqual(readiness.evaluation, preview.readiness)) {
    throw new Error('governance_bootstrap_circle_preview_readiness_mismatch');
  }
  if (canonical.digest !== preview.openingInput.configurationBundleDigest
    || readiness.readinessDigest !== preview.openingInput.readinessDigest) {
    throw new Error('governance_bootstrap_circle_preview_digest_mismatch');
  }
  const opening = createGovernanceBootstrapCeremonyOpeningV2(preview.openingInput);
  if (opening.openingDigest !== preview.opening.openingDigest
    || opening.signedMessage !== preview.opening.signedMessage) {
    throw new Error('governance_bootstrap_circle_preview_opening_mismatch');
  }
  return { canonical, readiness, opening };
}

async function validatePreviewAgainstCurrentAuthority(
  dependencies: { prisma: any; chainReader: GovernanceBootstrapCircleReader },
  preview: CircleGovernanceBootstrapPreview,
) {
  rebuildPreviewContracts(preview);
  const circle = await dependencies.prisma.circle.findUnique({
    where: { id: preview.circleId },
    select: { onChainAddress: true },
  });
  if (!circle || circle.onChainAddress !== preview.openingInput.authorityProof.proof.circleAccountRef) {
    throw new Error('governance_bootstrap_circle_projection_drift');
  }
  const chain = await dependencies.chainReader.read(preview.circleId, circle.onChainAddress);
  const proof = preview.openingInput.authorityProof.proof;
  if (chain.ownerPubkey !== proof.observedOwnerPubkey
    || chain.ownerPubkey !== preview.openingInput.actorPubkey
    || chain.programId !== proof.programId
    || chain.circleId !== proof.circleId
    || chain.circleAccountRef !== proof.circleAccountRef
    || chain.lifecycleStatus !== proof.decodedStatus
    || chain.stateDigest !== proof.stateDigest
    || chain.observedSlot < proof.observedSlot) {
    throw new Error('governance_bootstrap_circle_authority_drift');
  }
  return chain;
}

function createCircleReadinessChecks(input: {
  bundle: ReturnType<typeof createGovernanceBootstrapBundle>['bundle'];
  bundleDigest: string;
  authorityProof: ReturnType<typeof createGovernanceBootstrapCircleOwnerProof>;
  confirmationPolicy: ReturnType<typeof createGovernanceBootstrapFoundingConfirmationPolicyV2>;
  recoveryPolicy: GovernanceBootstrapVersionedRef;
  supportPolicy: GovernanceBootstrapVersionedRef;
}): GovernanceBootstrapReadinessChecks {
  const ready = (evidenceRef: string, facts: unknown) => ({
    status: 'ready' as const,
    evidenceRef,
    evidenceDigest: hashCanonicalGovernanceValue(READINESS_FACT_DOMAIN, facts),
    bundleDigest: input.bundleDigest,
    reasonCode: null,
  });
  const optional = (kind: 'mandates' | 'providers' | 'resources', refs: GovernanceBootstrapVersionedRef[]) =>
    refs.length === 0 ? {
      status: 'not_applicable' as const,
      evidenceRef: null,
      evidenceDigest: null,
      bundleDigest: null,
      reasonCode: null,
    } : {
      status: 'blocked' as const,
      evidenceRef: [
        `bootstrap-${input.authorityProof.proof.network === 'solana:devnet' ? 'devnet' : 'localnet'}`,
        kind,
        'external-adapter-required',
      ].join(':'),
      evidenceDigest: hashCanonicalGovernanceValue(READINESS_FACT_DOMAIN, { kind, refs }),
      bundleDigest: input.bundleDigest,
      reasonCode: 'external_adapter_required',
    };
  const foundingPolicy = input.confirmationPolicy.policy.foundingMemberPolicy;
  const eligibleActors = foundingPolicy?.eligibleActors ?? [{
    pubkey: input.authorityProof.proof.observedOwnerPubkey,
    source: 'circle_owner',
    role: 'Owner',
    weight: '1',
  }];
  const eligibleEvidenceRef = foundingPolicy?.eligibleSourceRef
    ?? `circle-owner:${input.authorityProof.proof.observedOwnerPubkey}`;
  return {
    eligibleActors: ready(eligibleEvidenceRef, {
      eligibleActors,
      authorityProofDigest: input.authorityProof.proofDigest,
    }),
    threshold: ready(`bootstrap-confirmation-policy:${input.confirmationPolicy.digest}`, {
      confirmationPolicy: input.confirmationPolicy.policy,
    }),
    authority: ready(input.authorityProof.authoritySourceRef, input.authorityProof.proof),
    funding: ready(input.bundle.payerPolicy.ref, { payerPolicy: input.bundle.payerPolicy, externalEffects: false }),
    publicSafeBoundary: ready(input.supportPolicy.ref, { supportPolicy: input.supportPolicy }),
    recoveryContact: ready(input.recoveryPolicy.ref, { recoveryPolicy: input.recoveryPolicy }),
    mandates: optional('mandates', input.bundle.mandateRefs),
    providers: optional('providers', input.bundle.providerRefs),
    resources: optional('resources', input.bundle.resourceRefs),
  };
}

function createCurrentCircleGovernanceBootstrapContract(identity: {
  id: string;
  identityVersion: number;
  bindingDigest: string;
}): {
  configurationBundle: GovernanceBootstrapBundleInput;
  recoveryPolicy: GovernanceBootstrapVersionedRef;
  supportPolicy: GovernanceBootstrapVersionedRef;
  confirmation: Omit<GovernanceBootstrapFoundingConfirmationPolicyV2Input,
    'homeIdentityBindingId' | 'configurationBundleId' | 'configurationBundleDigest' | 'openedAt'>;
} {
  const fact = (ref: string, version: string, value: unknown): GovernanceBootstrapVersionedRef => ({
    ref,
    version,
    digest: hashCanonicalGovernanceValue(CURRENT_CIRCLE_BOOTSTRAP_FACT_DOMAIN, value),
  });
  const profileRef = fact(
    `governance-profile:${CIRCLE_GOVERNANCE_PROFILE_V1.profileId}`,
    CIRCLE_GOVERNANCE_PROFILE_V1.versionRef,
    CIRCLE_GOVERNANCE_PROFILE_V1,
  );
  const dimension = (
    key: keyof typeof CIRCLE_GOVERNANCE_PROFILE_V1.dimensionApplicability,
  ) => ({
    applicability: 'applicable' as const,
    policy: fact(
      `governance-profile-dimension:${CIRCLE_GOVERNANCE_PROFILE_V1.profileId}:${key}`,
      CIRCLE_GOVERNANCE_PROFILE_V1.versionRef,
      CIRCLE_GOVERNANCE_PROFILE_V1.dimensionApplicability[key],
    ),
  });
  const recoveryPolicy = fact('recovery-policy:circle:a-plus-e-manual-pending', 'current', {
    defaultRecoveryAuthority: 'none',
    healthyGovernanceMayBindIndependentRecoveryCircle: true,
    deadlockState: 'manual_recovery_pending',
    permanentBlockPossible: true,
    ownerOperatorFallback: 'none',
  });
  const supportPolicy = fact('platform-support-policy:circle:no-governance-authority', 'current', {
    platformSupportAuthority: 'none',
    ownerOperatorFallback: 'none',
    silentFallback: false,
  });
  const initialAuthorityPolicy = createBootstrapSelfGovernedPolicyContract().reference;
  const explanation = {
    authority: 'current_finalized_circle_program_owner',
    foundingMemberConfirmation: 'not_required_for_single_owner_new_circle',
    timelock: 'required',
    waitingPeriodSeconds: SIGNATURE_TTL_SECONDS,
    temporaryAuthorityRetainedAfterActivation: false,
    ownerOperatorFallback: 'none',
  };
  return {
    configurationBundle: {
      homeIdentity: {
        ref: identity.id,
        version: identity.identityVersion,
        digest: identity.bindingDigest,
      },
      template: profileRef,
      policyDimensions: {
        admission: dimension('admission'),
        proposalCreation: dimension('proposal_creation'),
        voterEligibility: dimension('voter_eligibility'),
        votingPower: dimension('voting_power'),
      },
      riskFloor: {
        value: 'high',
        source: fact('governance-bootstrap-risk:authority-activation', 'current', {
          value: 'high',
          reason: 'activates_governance_home_authority',
        }),
      },
      stagePlan: fact('governance-bootstrap-stage-plan:owner-signature-timelock-readback', 'current', {
        ownerSignature: 'required',
        timelockSeconds: SIGNATURE_TTL_SECONDS,
        intentBeforeEffect: true,
        authoritativeReadback: true,
        activationCas: true,
      }),
      visibilityPolicy: fact('visibility-policy:existing-circle-access-control', 'current', {
        source: 'existing_circle_visibility_and_access_control',
        publicExpansion: false,
      }),
      emergencyPolicy: fact('emergency-policy:circle:a-plus-e-no-fallback', 'current', {
        recoveryModel: 'A+E',
        preboundRecoveryAuthority: 'none',
        ownerOperatorFallback: 'none',
      }),
      payerPolicy: fact('payer-policy:no-external-effect', 'current', {
        externalEffect: false,
        payer: null,
        defaultPayer: 'none',
      }),
      initialAuthorityPolicy,
      mandateRefs: [],
      providerRefs: [],
      resourceRefs: [],
    },
    recoveryPolicy,
    supportPolicy,
    confirmation: {
      version: 'founding-v2',
      foundingMemberConfirmation: 'not_required',
      authoritySignature: 'required',
      timelock: 'required',
      waitingPeriodSeconds: SIGNATURE_TTL_SECONDS,
      explanationRef: 'knowledge://governance/bootstrap/current-circle-owner-timelock',
      explanationDigest: hashCanonicalGovernanceValue(
        CURRENT_CIRCLE_BOOTSTRAP_FACT_DOMAIN,
        explanation,
      ),
      foundingMemberPolicy: null,
    },
  };
}

function assertIndependentPolicyRefs(
  emergency: GovernanceBootstrapVersionedRef,
  recovery: GovernanceBootstrapVersionedRef,
  support: GovernanceBootstrapVersionedRef,
  actorPubkey: string,
) {
  if (!recovery.ref.startsWith('recovery-policy:')
    || !support.ref.startsWith('platform-support-policy:')) {
    throw new Error('governance_bootstrap_independent_policy_ref_required');
  }
  for (const value of [emergency, recovery, support]) {
    if (!value.ref || !value.version || !/^[a-f0-9]{64}$/.test(value.digest)) {
      throw new Error('governance_bootstrap_independent_policy_invalid');
    }
  }
  const refs = [emergency.ref, recovery.ref, support.ref];
  if (new Set(refs).size !== refs.length || refs.includes(actorPubkey)) {
    throw new Error('governance_bootstrap_independent_policy_mismatch');
  }
}

function homeIdentityId(circleId: number) {
  return `governance-home-circle-${circleId}-v1`;
}

function temporaryAuthorityExplanation(
  openingInput: GovernanceBootstrapCeremonyOpeningV2Input,
) {
  return {
    actorPubkey: openingInput.actorPubkey,
    source: 'current_circle_program_owner',
    scope: 'open_and_activate_this_bootstrap_ceremony',
    retainedAfterActivation: false,
    bypassStatus: 'disabled',
    terminatesOn: 'activation_or_recovery_abort',
    openingSignatureExpiresAt: openingInput.signatureExpiresAt,
    explanationRef: openingInput.confirmationPolicy.policy.explanationRef,
  };
}

function assertCircleAndActor(circleId: number, actorPubkey: string) {
  if (!Number.isInteger(circleId) || circleId < 1 || circleId > 255) {
    throw new Error('governance_bootstrap_circle_id_invalid');
  }
  if (!actorPubkey || actorPubkey !== actorPubkey.trim()) {
    throw new Error('governance_bootstrap_circle_actor_required');
  }
}

function validDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('governance_bootstrap_circle_time_invalid');
  }
  return value;
}

function isUniqueConflict(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002';
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
