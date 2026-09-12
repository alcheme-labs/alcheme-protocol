import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '@prisma/client';

import {
  createGovernedActionRegistry,
  PLATFORM_SAFETY_AUTHORITY_CHANGE_APPROVE_ACTION_TYPE,
  PLATFORM_SAFETY_AUTHORITY_CHANGE_PROPOSE_ACTION_TYPE,
  PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
  PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE,
  PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE,
  PLATFORM_SAFETY_EVIDENCE_CAPTURE_ACTION_TYPE,
  PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE,
} from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { GovernedActionGateway } from './governedActionGateway';
import {
  resolveGovernedSystemRoleOperationRuntime,
  type GovernedActionGatewayRuntimeBinding,
} from './governedActionGatewayRuntime';
import { PLATFORM_SAFETY_SYSTEM_GOVERNANCE_PROFILE_V1 } from './governanceProfile';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import {
  openGovernedActionAppeal,
  resolveGovernedActionAppeal,
  type GovernedActionAppealResolutionOutcome,
} from './governedActionAppeal';
import { createPrismaGovernanceRequestStore } from './policyEngine';
import { ensureBuiltinSystemGovernanceHome } from './systemRoleBindings';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';

export const PLATFORM_SAFETY_DOMAIN = 'platform_safety';
export const PLATFORM_SAFETY_ENVIRONMENT = 'sandbox';
export const PLATFORM_SAFETY_POLICY_ADMIN_ROLE = 'platform_safety_policy_admin';
export const PLATFORM_SAFETY_CASE_RESPONDER_ROLE = 'platform_safety_case_responder';
export const PLATFORM_SAFETY_EMERGENCY_RESPONDER_ROLE =
  'platform_safety_emergency_responder';
export const PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE =
  PLATFORM_SAFETY_EMERGENCY_RESPONDER_ROLE;
export const PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE = 'platform_safety_appeal_reviewer';
export const PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE = 'platform_safety_audit_reviewer';
export const PLATFORM_SAFETY_LEGAL_OPERATOR_ROLE =
  'platform_safety_legal_operator';
export const PLATFORM_SAFETY_LEGAL_APPEAL_REVIEWER_ROLE =
  'platform_safety_legal_appeal_reviewer';

export const PLATFORM_SAFETY_ROLE_KEYS = [
  PLATFORM_SAFETY_POLICY_ADMIN_ROLE,
  PLATFORM_SAFETY_CASE_RESPONDER_ROLE,
  PLATFORM_SAFETY_EMERGENCY_RESPONDER_ROLE,
  PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE,
  PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
  PLATFORM_SAFETY_LEGAL_OPERATOR_ROLE,
  PLATFORM_SAFETY_LEGAL_APPEAL_REVIEWER_ROLE,
] as const;

export type PlatformSafetyRoleKey = (typeof PLATFORM_SAFETY_ROLE_KEYS)[number];

export const PLATFORM_SAFETY_POLICY_ID = 'platform-safety:us-public-adult-demo';
export const PLATFORM_SAFETY_POLICY_VERSION_ID =
  'platform-safety:us-public-adult-demo:v1';
export const PLATFORM_SAFETY_POLICY_VERSION = 1;

export const PLATFORM_SAFETY_POLICY_RULES = Object.freeze({
  contractVersion: 'platform-safety-us-public-adult-demo-v1',
  scope: {
    environment: PLATFORM_SAFETY_ENVIRONMENT,
    jurisdiction: 'US',
    minimumAge: 18,
    audience: 'public_adult_demo',
    network: 'solana:devnet',
    assetMode: 'devnet_test_assets_only',
  },
  taxonomy: {
    version: 1,
    categories: [
      { code: 'credible_threat', minimumSeverity: 'sev2' },
      { code: 'doxxing_or_pii', minimumSeverity: 'sev2' },
      { code: 'malware_or_phishing', minimumSeverity: 'sev2' },
      { code: 'sexual_exploitation', minimumSeverity: 'sev1' },
    ],
  },
  quarantine: {
    target: 'single_feed_post',
    minimumDurationSeconds: 5 * 60,
    maximumDurationSeconds: 60 * 60,
    maximumInvocationsPerActorPerHour: 20,
    originalContentAccess: 'author_and_bound_platform_safety_roles_only',
    publicProjection: 'not_found_while_active',
    expiry: 'automatic_restore',
    delete: false,
    legalDisposition: false,
  },
  automation: {
    contractVersion: 'platform-safety-moderation-automation-policy-v1',
    ruleVersion: 'platform-safety-moderation-automation-rules-v1',
    modelVersion: 'advisory-signal-disabled-v1',
    signalMode: 'advisory_only',
    thresholds: {
      quarantineCandidate: '0.92',
      legalEscalationCandidate: '0.99',
      permanentDisposition: 'forbidden',
    },
    scope: {
      targetTypes: ['feed_post'],
      maximumBatchSubjects: 1,
      publicAdultDemoOnly: true,
    },
    activation: 'human_review_only',
    automatedEnforcement: false,
    batchMaximumSubjects: 1,
    sampling: {
      required: true,
      minimumRate: 1,
      reviewerRole: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
    },
    samplingRequired: true,
    expirySeconds: 60 * 60,
    rollback: 'automatic_expiry_or_governed_release',
    appeal: 'independent_platform_safety_appeal_role',
    killSwitch: {
      state: 'active',
      effect: 'block_automation_execution',
      ownerRole: PLATFORM_SAFETY_POLICY_ADMIN_ROLE,
    },
    permanentDispositionByModelSignal: false,
  },
  incident: {
    severities: ['sev2', 'sev1'],
    commanderRole: PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE,
    reviewRole: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
    afterActionReviewRequired: true,
    merge: 'independent_audit_review_same_circle_no_time_extension',
    externalLegalReporting: 'manual_external_authority_required',
  },
  separation: {
    policyCaseEmergencyAppealAuditLegalRolesSeparate: true,
    circleGovernanceMayActAsPlatformSafety: false,
    reporterMayAutoExecute: false,
    originalExecutorMayReviewAppeal: false,
    responderAndIndependentReviewerActorSetsMustBeDisjoint: true,
    criticalActionsRequireDualApproval: true,
  },
});

export const PLATFORM_SAFETY_POLICY_DIGEST = hashCanonicalGovernanceValue(
  'alcheme.governance.platform-safety-policy',
  PLATFORM_SAFETY_POLICY_RULES,
);

export const PLATFORM_SAFETY_INCIDENT_POLICY_ID =
  'platform-safety-incident-activation:us-public-adult-demo';
export const PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID =
  'platform-safety-incident-activation:us-public-adult-demo:v1';
export const PLATFORM_SAFETY_INCIDENT_POLICY_VERSION = 1;
export const PLATFORM_SAFETY_INCIDENT_POLICY_RULES = Object.freeze({
  contractVersion: 'platform-safety-incident-activation-v1',
  scope: {
    environment: PLATFORM_SAFETY_ENVIRONMENT,
    jurisdiction: 'US',
    minimumAge: 18,
    target: 'single_circle',
  },
  declaration: {
    categories: PLATFORM_SAFETY_POLICY_RULES.taxonomy.categories.map(
      (item) => item.code,
    ),
    severities: ['sev2', 'sev1'],
    commanderRole: PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE,
    approvalRole: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
    distinctActorThreshold: 2,
    activationWindowSeconds: 15 * 60,
    minimumDurationSeconds: 15 * 60,
    maximumDurationSeconds: 4 * 60 * 60,
  },
  authority: {
    createsNewAuthority: false,
    originalCommanderMayApprove: false,
    ordinaryCircleRolesEligible: false,
    allowedEmergencyActions: [
      PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
      PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE,
      PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE,
    ],
  },
  breakGlass: {
    contractVersion: 'platform-safety-evidence-break-glass-policy-v1',
    targetTypes: ['platform_safety_evidence'],
    predefinedEvents: [
      'credible_threat',
      'doxxing_or_pii',
      'malware_or_phishing',
      'sexual_exploitation',
    ],
    requestRole: PLATFORM_SAFETY_CASE_RESPONDER_ROLE,
    approvalRole: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
    distinctActorsRequired: true,
    minimumDurationSeconds: 5 * 60,
    maximumDurationSeconds: 15 * 60,
    alertRequired: true,
    afterActionReviewRequired: true,
    automaticExpiry: true,
    dailyOperatorPermission: false,
    originalMaterialExport: false,
  },
  restore: {
    conditions: [
      'automatic_max_duration_expiry',
      'governed_commander_close',
    ],
    newActionsAfterEnd: false,
    existingEffectsKeepOwnExpiryOrRelease: true,
  },
  review: {
    requiredAfterActivation: true,
    reviewerRole: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
    commanderExcluded: true,
    dueSecondsAfterEnd: 24 * 60 * 60,
  },
  currentLifecycle: {
    declare: true,
    activateOrReject: true,
    upgrade: true,
    extend: true,
    merge: true,
    close: true,
    automaticExpiry: true,
    afterActionReview: true,
    lifecycleMutationRole: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
    commanderMayMutateOwnIncident: false,
    maximumTotalDurationSeconds: 4 * 60 * 60,
    mergeMayExtendExpiry: false,
  },
});
export const PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST =
  hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-incident-activation-policy',
    PLATFORM_SAFETY_INCIDENT_POLICY_RULES,
  );

const TAXONOMY_CATEGORIES = new Set(
  PLATFORM_SAFETY_POLICY_RULES.taxonomy.categories.map((item) => item.code),
);
const MIN_DURATION_SECONDS =
  PLATFORM_SAFETY_POLICY_RULES.quarantine.minimumDurationSeconds;
const MAX_DURATION_SECONDS =
  PLATFORM_SAFETY_POLICY_RULES.quarantine.maximumDurationSeconds;
const PLATFORM_SAFETY_LEGAL_STATUS_VALUES = [
  'legal_hold',
  'legal_takedown',
  'legal_redaction',
  'retention_authorized',
  'destruction_authorized',
] as const;
const PLATFORM_SAFETY_EVIDENCE_CAPTURE_KINDS = [
  'report_url',
  'screenshot',
  'attachment',
  'feed_post_snapshot',
] as const;

type RoleBinding = {
  id: string;
  domain: string;
  roleKey: PlatformSafetyRoleKey;
  environment: string;
  circleId: number;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  status: string;
  activatedAt: Date;
  metadata?: unknown;
};

export type PlatformSafetyRoleResolution = {
  binding: RoleBinding;
  policy: any;
  policyVersion: any;
  circle: any;
  actorPubkeys: string[];
};

export class PlatformSafetyError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

function safetyError(statusCode: number, code: string): PlatformSafetyError {
  return new PlatformSafetyError(statusCode, code);
}

function bootstrapOperatorPubkeys(): ReadonlySet<string> {
  return new Set(
    String(process.env.PLATFORM_SAFETY_BOOTSTRAP_OPERATOR_PUBKEYS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function assertPlatformSafetyBootstrapOperator(actorPubkey: string): void {
  const canonical = canonicalSolanaPublicKeyString(actorPubkey);
  if (
    !canonical
    || canonical !== actorPubkey
    || !bootstrapOperatorPubkeys().has(actorPubkey)
  ) {
    throw safetyError(403, 'platform_safety_bootstrap_operator_required');
  }
}

export async function ensurePlatformSafetySystemGovernanceHome(
  prisma: any,
  now?: Date,
) {
  return ensureBuiltinSystemGovernanceHome(prisma, {
    homeType: 'platform_safety_system_role',
    homeRef: 'platform_safety:sandbox',
    profile: PLATFORM_SAFETY_SYSTEM_GOVERNANCE_PROFILE_V1,
    reasonCode: 'platform_safety_system_domain_initial_profile',
    actionPattern: 'platform.safety.*',
    adapter: 'platform_safety',
    errorPrefix: 'platform_safety_system_governance',
    now,
  });
}

export async function bootstrapPlatformSafetySandbox(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    policyAdminCircleId: number;
    caseResponderCircleId: number;
    emergencyResponderCircleId: number;
    appealReviewCircleId: number;
    auditReviewCircleId: number;
    legalOperatorCircleId: number;
    legalAppealCircleId: number;
    now?: Date;
  },
) {
  assertPlatformSafetyBootstrapOperator(input.actorPubkey);
  const now = input.now ?? new Date();
  const circleIds = [
    input.policyAdminCircleId,
    input.caseResponderCircleId,
    input.emergencyResponderCircleId,
    input.appealReviewCircleId,
    input.auditReviewCircleId,
    input.legalOperatorCircleId,
    input.legalAppealCircleId,
  ];
  if (
    circleIds.some((value) => !Number.isSafeInteger(value) || value <= 0)
    || new Set(circleIds).size !== circleIds.length
  ) {
    throw safetyError(400, 'platform_safety_role_circles_must_be_distinct');
  }
  const roleCircles: Record<PlatformSafetyRoleKey, number> = {
    [PLATFORM_SAFETY_POLICY_ADMIN_ROLE]: input.policyAdminCircleId,
    [PLATFORM_SAFETY_CASE_RESPONDER_ROLE]: input.caseResponderCircleId,
    [PLATFORM_SAFETY_EMERGENCY_RESPONDER_ROLE]:
      input.emergencyResponderCircleId,
    [PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE]: input.appealReviewCircleId,
    [PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE]: input.auditReviewCircleId,
    [PLATFORM_SAFETY_LEGAL_OPERATOR_ROLE]: input.legalOperatorCircleId,
    [PLATFORM_SAFETY_LEGAL_APPEAL_REVIEWER_ROLE]: input.legalAppealCircleId,
  };

  const result = await (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'platform-safety:sandbox:bootstrap',
    );
    const circles = await tx.circle.findMany({
      where: { id: { in: circleIds } },
      select: { id: true, kind: true, mode: true, circleType: true },
      orderBy: { id: 'asc' },
    });
    if (
      circles.length !== circleIds.length
      || circles.some((circle: any) =>
        circle.kind !== 'auxiliary'
        || circle.mode !== 'governance'
        || circle.circleType !== 'Secret')
    ) {
      throw safetyError(409, 'platform_safety_secret_governance_circles_required');
    }
    const memberships = await tx.circleMember.findMany({
      where: { circleId: { in: circleIds }, status: 'Active' },
      include: { user: { select: { pubkey: true } } },
      orderBy: [{ circleId: 'asc' }, { userId: 'asc' }],
    });
    const actorsByCircle = new Map<number, Set<string>>();
    for (const circleId of circleIds) actorsByCircle.set(circleId, new Set());
    for (const membership of memberships) {
      const pubkey = canonicalSolanaPublicKeyString(membership.user?.pubkey);
      if (pubkey) actorsByCircle.get(membership.circleId)?.add(pubkey);
    }
    if ([...actorsByCircle.values()].some((actors) => actors.size === 0)) {
      throw safetyError(409, 'platform_safety_role_circle_requires_active_actor');
    }
    for (let index = 0; index < circleIds.length; index += 1) {
      for (let other = index + 1; other < circleIds.length; other += 1) {
        const left = actorsByCircle.get(circleIds[index])!;
        const right = actorsByCircle.get(circleIds[other])!;
        if ([...left].some((actor) => right.has(actor))) {
          throw safetyError(409, 'platform_safety_role_actor_sets_must_be_disjoint');
        }
      }
    }

    const existingPolicy = await tx.governancePolicy.findUnique({
      where: { id: PLATFORM_SAFETY_POLICY_ID },
    });
    if (!existingPolicy) {
      await tx.governancePolicy.create({
        data: {
          id: PLATFORM_SAFETY_POLICY_ID,
          scopeType: 'platform_safety_system',
          scopeRef: PLATFORM_SAFETY_ENVIRONMENT,
          status: 'active',
          activeVersion: PLATFORM_SAFETY_POLICY_VERSION,
          createdByPubkey: input.actorPubkey,
          metadata: {
            jurisdiction: 'US',
            minimumAge: 18,
            environment: PLATFORM_SAFETY_ENVIRONMENT,
            assetMode: 'devnet_test_assets_only',
          },
        },
      });
    } else if (
      existingPolicy.scopeType !== 'platform_safety_system'
      || existingPolicy.scopeRef !== PLATFORM_SAFETY_ENVIRONMENT
      || existingPolicy.status !== 'active'
      || existingPolicy.activeVersion !== PLATFORM_SAFETY_POLICY_VERSION
    ) {
      throw safetyError(409, 'platform_safety_policy_mismatch');
    }
    const existingVersion = await tx.governancePolicyVersion.findUnique({
      where: { id: PLATFORM_SAFETY_POLICY_VERSION_ID },
    });
    if (!existingVersion) {
      await tx.governancePolicyVersion.create({
        data: {
          id: PLATFORM_SAFETY_POLICY_VERSION_ID,
          policyId: PLATFORM_SAFETY_POLICY_ID,
          version: PLATFORM_SAFETY_POLICY_VERSION,
          status: 'active',
          rules: PLATFORM_SAFETY_POLICY_RULES,
          configDigest: PLATFORM_SAFETY_POLICY_DIGEST,
          activatedAt: now,
          createdByPubkey: input.actorPubkey,
        },
      });
    } else if (
      existingVersion.policyId !== PLATFORM_SAFETY_POLICY_ID
      || existingVersion.version !== PLATFORM_SAFETY_POLICY_VERSION
      || existingVersion.status !== 'active'
      || existingVersion.configDigest !== PLATFORM_SAFETY_POLICY_DIGEST
      || !isDeepStrictEqual(existingVersion.rules, PLATFORM_SAFETY_POLICY_RULES)
    ) {
      throw safetyError(409, 'platform_safety_policy_version_mismatch');
    }
    const existingIncidentPolicy = await tx.governancePolicy.findUnique({
      where: { id: PLATFORM_SAFETY_INCIDENT_POLICY_ID },
    });
    if (!existingIncidentPolicy) {
      await tx.governancePolicy.create({
        data: {
          id: PLATFORM_SAFETY_INCIDENT_POLICY_ID,
          scopeType: 'platform_safety_incident',
          scopeRef: PLATFORM_SAFETY_ENVIRONMENT,
          status: 'active',
          activeVersion: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION,
          createdByPubkey: input.actorPubkey,
          metadata: {
            jurisdiction: 'US',
            minimumAge: 18,
            authorityExpansion: false,
          },
        },
      });
    } else if (
      existingIncidentPolicy.scopeType !== 'platform_safety_incident'
      || existingIncidentPolicy.scopeRef !== PLATFORM_SAFETY_ENVIRONMENT
      || existingIncidentPolicy.status !== 'active'
      || existingIncidentPolicy.activeVersion
        !== PLATFORM_SAFETY_INCIDENT_POLICY_VERSION
    ) {
      throw safetyError(409, 'platform_safety_incident_policy_mismatch');
    }
    const existingIncidentVersion =
      await tx.governancePolicyVersion.findUnique({
        where: { id: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID },
      });
    if (!existingIncidentVersion) {
      await tx.governancePolicyVersion.create({
        data: {
          id: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
          policyId: PLATFORM_SAFETY_INCIDENT_POLICY_ID,
          version: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION,
          status: 'active',
          rules: PLATFORM_SAFETY_INCIDENT_POLICY_RULES,
          configDigest: PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
          activatedAt: now,
          createdByPubkey: input.actorPubkey,
        },
      });
    } else if (
      existingIncidentVersion.policyId !== PLATFORM_SAFETY_INCIDENT_POLICY_ID
      || existingIncidentVersion.version
        !== PLATFORM_SAFETY_INCIDENT_POLICY_VERSION
      || existingIncidentVersion.status !== 'active'
      || existingIncidentVersion.configDigest
        !== PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST
      || !isDeepStrictEqual(
        existingIncidentVersion.rules,
        PLATFORM_SAFETY_INCIDENT_POLICY_RULES,
      )
    ) {
      throw safetyError(
        409,
        'platform_safety_incident_policy_version_mismatch',
      );
    }

    const bindings: RoleBinding[] = [];
    for (const roleKey of PLATFORM_SAFETY_ROLE_KEYS) {
      const circleId = roleCircles[roleKey];
      const active = await tx.systemGovernanceRoleBinding.findMany({
        where: {
          domain: PLATFORM_SAFETY_DOMAIN,
          roleKey,
          environment: PLATFORM_SAFETY_ENVIRONMENT,
          status: 'active',
        },
        orderBy: { activatedAt: 'desc' },
        take: 2,
      });
      if (active.length > 1) {
        throw safetyError(409, 'platform_safety_role_binding_ambiguous');
      }
      if (active[0]) {
        if (
          active[0].circleId !== circleId
          || active[0].policyId !== PLATFORM_SAFETY_POLICY_ID
          || active[0].policyVersionId !== PLATFORM_SAFETY_POLICY_VERSION_ID
          || active[0].policyVersion !== PLATFORM_SAFETY_POLICY_VERSION
        ) {
          throw safetyError(409, 'platform_safety_role_binding_already_exists');
        }
        bindings.push(active[0]);
        continue;
      }
      const id = `platform-safety:${PLATFORM_SAFETY_ENVIRONMENT}:${roleKey}:v1`;
      const historical = await tx.systemGovernanceRoleBinding.findUnique({
        where: { id },
      });
      if (historical) {
        throw safetyError(409, 'platform_safety_role_binding_history_mismatch');
      }
      bindings.push(await tx.systemGovernanceRoleBinding.create({
        data: {
          id,
          domain: PLATFORM_SAFETY_DOMAIN,
          roleKey,
          environment: PLATFORM_SAFETY_ENVIRONMENT,
          circleId,
          policyId: PLATFORM_SAFETY_POLICY_ID,
          policyVersionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
          policyVersion: PLATFORM_SAFETY_POLICY_VERSION,
          status: 'active',
          activatedAt: now,
          createdByPubkey: input.actorPubkey,
          metadata: {
            bootstrapMode: 'signed_sandbox_product_operator',
            jurisdiction: 'US',
            minimumAge: 18,
            roleActorSetDigest: hashCanonicalGovernanceValue(
              'alcheme.governance.platform-safety-role-actors',
              [...actorsByCircle.get(circleId)!].sort(),
            ),
          },
        },
      }));
    }
    return { policy: existingPolicy, bindings };
  });
  const home = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return {
    schemaVersion: 1,
    environment: PLATFORM_SAFETY_ENVIRONMENT,
    jurisdiction: 'US',
    minimumAge: 18,
    policyId: PLATFORM_SAFETY_POLICY_ID,
    policyVersionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
    policyDigest: PLATFORM_SAFETY_POLICY_DIGEST,
    incidentPolicy: {
      id: PLATFORM_SAFETY_INCIDENT_POLICY_ID,
      versionId: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
      version: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION,
      digest: PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
    },
    roleBindings: result.bindings.map(projectRoleBinding),
    governanceHome: {
      id: home.home.id,
      type: home.home.homeType,
      ref: home.home.homeRef,
      profileBindingId: home.profileBinding.id,
    },
  };
}

export async function readPlatformSafetyPolicy(prisma: PrismaClient) {
  const roles = await (prisma as any).systemGovernanceRoleBinding.findMany({
    where: {
      domain: PLATFORM_SAFETY_DOMAIN,
      roleKey: { in: [...PLATFORM_SAFETY_ROLE_KEYS] },
      environment: PLATFORM_SAFETY_ENVIRONMENT,
      status: 'active',
    },
    orderBy: { roleKey: 'asc' },
  });
  const [policy, incidentPolicy] = await Promise.all([
    (prisma as any).governancePolicyVersion.findUnique({
      where: { id: PLATFORM_SAFETY_POLICY_VERSION_ID },
    }),
    (prisma as any).governancePolicyVersion.findUnique({
      where: { id: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID },
    }),
  ]);
  const configured = roles.length === PLATFORM_SAFETY_ROLE_KEYS.length
    && policy?.status === 'active'
    && policy.configDigest === PLATFORM_SAFETY_POLICY_DIGEST
    && isDeepStrictEqual(policy.rules, PLATFORM_SAFETY_POLICY_RULES)
    && incidentPolicy?.status === 'active'
    && incidentPolicy.configDigest === PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST
    && isDeepStrictEqual(
      incidentPolicy.rules,
      PLATFORM_SAFETY_INCIDENT_POLICY_RULES,
    );
  return {
    schemaVersion: 1,
    configured,
    environment: PLATFORM_SAFETY_ENVIRONMENT,
    jurisdiction: 'US',
    minimumAge: 18,
    assetMode: 'devnet_test_assets_only',
    policy: configured ? {
      id: PLATFORM_SAFETY_POLICY_ID,
      versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
      version: PLATFORM_SAFETY_POLICY_VERSION,
      digest: PLATFORM_SAFETY_POLICY_DIGEST,
      rules: PLATFORM_SAFETY_POLICY_RULES,
    } : null,
    incidentPolicy: configured ? {
      id: PLATFORM_SAFETY_INCIDENT_POLICY_ID,
      versionId: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
      version: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION,
      digest: PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
      rules: PLATFORM_SAFETY_INCIDENT_POLICY_RULES,
    } : null,
    roles: PLATFORM_SAFETY_ROLE_KEYS.map((roleKey) => ({
      roleKey,
      status: roles.some((role: RoleBinding) => role.roleKey === roleKey)
        ? 'bound'
        : 'unavailable',
    })),
    externalBoundaries: {
      productionMainnet: 'not_authorized',
      assetExecution: 'devnet_test_contract_required_when_relevant',
      legalReporting: 'manual_external_authority_required',
      authoritativeDestruction: 'external_legal_and_provider_authority_required',
    },
  };
}

export async function proposePlatformSafetyAuthorityChange(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    targetRoleKey: PlatformSafetyRoleKey;
    targetCircleId: number;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    excludedActorPubkeys?: string[];
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const targetRoleKey = input.targetRoleKey;
  const reasonCode = input.reasonCode.trim();
  const evidenceDigest = input.evidenceDigest.trim().toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !PLATFORM_SAFETY_ROLE_KEYS.includes(targetRoleKey)
    || !Number.isSafeInteger(input.targetCircleId)
    || input.targetCircleId <= 0
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || !/^[a-f0-9]{64}$/.test(evidenceDigest)
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
  ) {
    throw safetyError(400, 'platform_safety_authority_change_input_invalid');
  }
  const excludedActorPubkeys = normalizeActorList(input.excludedActorPubkeys);
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-authority:${targetRoleKey}`,
    );
    const [policyAdmin, currentRole, candidate] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_POLICY_ADMIN_ROLE),
      resolvePlatformSafetyRole(tx, targetRoleKey),
      resolvePlatformSafetyCandidateCircle(tx, input.targetCircleId),
    ]);
    assertActorInRole(policyAdmin, actorPubkey);
    assertPolicyAdminDualControlAvailable(policyAdmin, actorPubkey);
    if (currentRole.binding.circleId === candidate.circle.id) {
      throw safetyError(409, 'platform_safety_authority_change_noop');
    }
    assertCandidateRoleSeparation({
      targetRoleKey,
      candidate,
      currentRoles: await resolveAllPlatformSafetyRoles(tx),
      proposerPubkey: actorPubkey,
      approverPubkey: null,
      excludedActorPubkeys,
    });

    const currentActorSetDigest = roleActorSetDigest(currentRole.actorPubkeys);
    const candidateActorSetDigest = roleActorSetDigest(candidate.actorPubkeys);
    const payload = {
      contractVersion: 'platform-safety-authority-change-proposal-v1',
      changeKind: 'role_binding',
      targetRoleKey,
      currentBindingId: currentRole.binding.id,
      currentCircleId: currentRole.binding.circleId,
      currentActorSetDigest,
      targetCircleId: candidate.circle.id,
      targetActorSetDigest: candidateActorSetDigest,
      proposerPubkey: actorPubkey,
      excludedActorPubkeys,
      reasonCode,
      evidenceDigest,
      proposedAt: now.toISOString(),
      effectiveAt: now.toISOString(),
      policy: {
        id: PLATFORM_SAFETY_POLICY_ID,
        versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
        version: PLATFORM_SAFETY_POLICY_VERSION,
        digest: PLATFORM_SAFETY_POLICY_DIGEST,
      },
      dualControl: {
        requiredRoleKey: PLATFORM_SAFETY_POLICY_ADMIN_ROLE,
        proposerExcluded: true,
        approverMustBeDistinctPolicyAdmin: true,
        targetActorsExcludedFromApproval: true,
        conflictFallback: 'blocked_no_independent_authority',
      },
      state: 'pending_second_policy_admin_approval',
    };
    const outcome = await executePlatformSafetyPolicyAdminOperation(tx, {
      home,
      policyAdmin,
      actorPubkey,
      actionType: PLATFORM_SAFETY_AUTHORITY_CHANGE_PROPOSE_ACTION_TYPE,
      targetRoleKey,
      targetRef: targetRoleKey,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      executionRef: `platform-safety-authority-proposal:${targetRoleKey}`,
      result: {
        state: 'pending_second_policy_admin_approval',
        targetRoleKey,
        targetCircleId: candidate.circle.id,
        blocked: false,
      },
    });
    const effect = await tx.operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
    });
    if (!effect) {
      throw safetyError(409, 'platform_safety_authority_proposal_effect_missing');
    }
    return {
      replayed: outcome.replayed,
      receipt: outcome.receipt,
      proposal: {
        targetRoleKey,
        targetCircleId: candidate.circle.id,
        proposalReceiptId: outcome.receipt.id,
        proposalEffectId: effect.id,
        state: effect.state,
        effectiveAt: payload.effectiveAt,
      },
    };
  });
}

export async function approvePlatformSafetyAuthorityChange(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    proposalReceiptId: string;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const proposalReceiptId = input.proposalReceiptId.trim();
  const reasonCode = input.reasonCode.trim();
  const evidenceDigest = input.evidenceDigest.trim().toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !proposalReceiptId
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || !/^[a-f0-9]{64}$/.test(evidenceDigest)
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
  ) {
    throw safetyError(400, 'platform_safety_authority_approval_input_invalid');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-authority-approval:${proposalReceiptId}`,
    );
    const proposalReceipt = await tx.operationReceipt.findUnique({
      where: { id: proposalReceiptId },
      include: {
        invocation: { include: { contractVersion: true, operationEffect: true } },
        initialEffect: true,
      },
    });
    if (
      !proposalReceipt
      || proposalReceipt.invocation?.contractVersion?.actionType
        !== PLATFORM_SAFETY_AUTHORITY_CHANGE_PROPOSE_ACTION_TYPE
      || !proposalReceipt.initialEffect
    ) {
      throw safetyError(404, 'platform_safety_authority_proposal_not_found');
    }
    const proposalPayload = record(proposalReceipt.invocation.requestedEffect);
    if (
      proposalPayload.contractVersion
        !== 'platform-safety-authority-change-proposal-v1'
      || proposalPayload.changeKind !== 'role_binding'
      || !PLATFORM_SAFETY_ROLE_KEYS.includes(proposalPayload.targetRoleKey)
    ) {
      throw safetyError(409, 'platform_safety_authority_proposal_invalid');
    }
    const targetRoleKey = proposalPayload.targetRoleKey as PlatformSafetyRoleKey;
    const replayedApproval = await findReplayedAuthorityApproval(tx, {
      actorPubkey,
      targetRoleKey,
      idempotencyKey,
    });
    if (proposalReceipt.initialEffect.state !== 'active') {
      if (replayedApproval) return replayedApproval;
      throw safetyError(409, 'platform_safety_authority_proposal_not_active');
    }

    const [policyAdmin, currentRole, candidate] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_POLICY_ADMIN_ROLE),
      resolvePlatformSafetyRole(tx, targetRoleKey),
      resolvePlatformSafetyCandidateCircle(
        tx,
        Number(proposalPayload.targetCircleId),
      ),
    ]);
    assertActorInRole(policyAdmin, actorPubkey);
    if (actorPubkey === proposalPayload.proposerPubkey) {
      throw safetyError(409, 'platform_safety_authority_self_approval_forbidden');
    }
    const excludedActorPubkeys = normalizeActorList(
      Array.isArray(proposalPayload.excludedActorPubkeys)
        ? proposalPayload.excludedActorPubkeys
        : [],
    );
    assertCandidateRoleSeparation({
      targetRoleKey,
      candidate,
      currentRoles: await resolveAllPlatformSafetyRoles(tx),
      proposerPubkey: String(proposalPayload.proposerPubkey || ''),
      approverPubkey: actorPubkey,
      excludedActorPubkeys,
    });
    if (
      currentRole.binding.id !== proposalPayload.currentBindingId
      || currentRole.binding.circleId !== proposalPayload.currentCircleId
      || roleActorSetDigest(currentRole.actorPubkeys)
        !== proposalPayload.currentActorSetDigest
      || candidate.circle.id !== proposalPayload.targetCircleId
      || roleActorSetDigest(candidate.actorPubkeys)
        !== proposalPayload.targetActorSetDigest
      || proposalPayload.policy?.versionId !== PLATFORM_SAFETY_POLICY_VERSION_ID
      || proposalPayload.policy?.digest !== PLATFORM_SAFETY_POLICY_DIGEST
    ) {
      throw safetyError(409, 'platform_safety_authority_proposal_drift');
    }
    if (replayedApproval) {
      return replayedApproval;
    }

    const approvalPayload = {
      contractVersion: 'platform-safety-authority-change-approval-v1',
      changeKind: 'role_binding',
      proposalReceiptId,
      proposalInvocationId: proposalReceipt.invocationId,
      proposalEffectId: proposalReceipt.initialEffect.id,
      targetRoleKey,
      previousBindingId: currentRole.binding.id,
      previousCircleId: currentRole.binding.circleId,
      nextCircleId: candidate.circle.id,
      nextActorSetDigest: roleActorSetDigest(candidate.actorPubkeys),
      proposerPubkey: String(proposalPayload.proposerPubkey),
      approverPubkey: actorPubkey,
      approvedAt: now.toISOString(),
      effectiveAt: now.toISOString(),
      reasonCode,
      evidenceDigest,
      policy: proposalPayload.policy,
    };
    const nextBindingId = `platform-safety:${targetRoleKey}:${
      hashCanonicalGovernanceValue(
        'alcheme.governance.platform-safety-authority-binding-id',
        approvalPayload,
      ).slice(0, 28)
    }`;
    const outcome = await executePlatformSafetyPolicyAdminOperation(tx, {
      home,
      policyAdmin,
      actorPubkey,
      actionType: PLATFORM_SAFETY_AUTHORITY_CHANGE_APPROVE_ACTION_TYPE,
      targetRoleKey,
      targetRef: targetRoleKey,
      payload: approvalPayload,
      reasonCode,
      idempotencyKey,
      now,
      executionRef: `platform-safety-authority-approval:${targetRoleKey}`,
      result: {
        state: 'approved',
        targetRoleKey,
        bindingId: nextBindingId,
        supersededBindingId: currentRole.binding.id,
      },
      executeBeforeResult: async () => {
        const superseded = await tx.systemGovernanceRoleBinding.updateMany({
          where: {
            id: currentRole.binding.id,
            status: 'active',
            circleId: currentRole.binding.circleId,
          },
          data: {
            status: 'superseded',
            supersededAt: now,
          },
        });
        if (superseded.count !== 1) {
          throw safetyError(409, 'platform_safety_authority_supersede_cas_failed');
        }
        await tx.systemGovernanceRoleBinding.create({
          data: {
            id: nextBindingId,
            domain: PLATFORM_SAFETY_DOMAIN,
            roleKey: targetRoleKey,
            environment: PLATFORM_SAFETY_ENVIRONMENT,
            circleId: candidate.circle.id,
            policyId: PLATFORM_SAFETY_POLICY_ID,
            policyVersionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
            policyVersion: PLATFORM_SAFETY_POLICY_VERSION,
            status: 'active',
            activatedAt: now,
            createdByPubkey: actorPubkey,
            sourceRequestId: proposalReceipt.invocationId,
            sourceDecisionDigest: hashCanonicalGovernanceValue(
              'alcheme.governance.platform-safety-authority-approval',
              approvalPayload,
            ),
            metadata: {
              proposalReceiptId,
              proposalEffectId: proposalReceipt.initialEffect.id,
              proposerPubkey: proposalPayload.proposerPubkey,
              approverPubkey: actorPubkey,
              previousBindingId: currentRole.binding.id,
              roleActorSetDigest: roleActorSetDigest(candidate.actorPubkeys),
              dualControl: true,
              selfReviewForbidden: true,
            },
          },
        });
      },
    });
    await tx.systemGovernanceRoleBinding.update({
      where: { id: nextBindingId },
      data: {
        sourceExecutionReceiptId: outcome.receipt.id,
        metadata: {
          proposalReceiptId,
          approvalReceiptId: outcome.receipt.id,
          proposalEffectId: proposalReceipt.initialEffect.id,
          proposerPubkey: proposalPayload.proposerPubkey,
          approverPubkey: actorPubkey,
          previousBindingId: currentRole.binding.id,
          roleActorSetDigest: roleActorSetDigest(candidate.actorPubkeys),
          dualControl: true,
          selfReviewForbidden: true,
        },
      },
    });
    await transitionOperationEffectInTransaction(tx, {
      effectId: proposalReceipt.initialEffect.id,
      nextState: 'expired',
      reasonCode: 'platform_safety_authority_change_approved',
      actorPubkey,
      sourceReceiptId: outcome.receipt.id,
      occurredAt: now,
    });
    const binding = await resolvePlatformSafetyRole(tx, targetRoleKey);
    if (binding.binding.id !== nextBindingId) {
      throw safetyError(409, 'platform_safety_authority_readback_mismatch');
    }
    return {
      replayed: outcome.replayed,
      receipt: outcome.receipt,
      binding: projectRoleBinding(binding.binding),
      approval: {
        proposalReceiptId,
        targetRoleKey,
        previousBindingId: currentRole.binding.id,
        bindingId: binding.binding.id,
        effectiveAt: now.toISOString(),
      },
    };
  });
}

export async function capturePlatformSafetyEvidence(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    subjectType: (typeof PLATFORM_SAFETY_EVIDENCE_CAPTURE_KINDS)[number];
    subjectRef: string;
    sourceDigest: string;
    malwareScanStatus: 'clean' | 'blocked' | 'not_applicable';
    piiRedactionStatus: 'none' | 'redacted' | 'blocked';
    retentionSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const subjectType = String(input.subjectType || '').trim() as typeof input.subjectType;
  const subjectRef = input.subjectRef.trim();
  const sourceDigest = input.sourceDigest.trim().toLowerCase();
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !PLATFORM_SAFETY_EVIDENCE_CAPTURE_KINDS.includes(subjectType)
    || !subjectRef
    || subjectRef.length > 128
    || !/^[a-f0-9]{64}$/.test(sourceDigest)
    || !['clean', 'blocked', 'not_applicable'].includes(input.malwareScanStatus)
    || !['none', 'redacted', 'blocked'].includes(input.piiRedactionStatus)
    || !Number.isSafeInteger(input.retentionSeconds)
    || input.retentionSeconds < 60
    || input.retentionSeconds > 30 * 24 * 60 * 60
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
  ) {
    throw safetyError(400, 'platform_safety_evidence_capture_input_invalid');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-evidence:${subjectType}:${subjectRef}`,
    );
    const role = await resolvePlatformSafetyRole(
      tx,
      PLATFORM_SAFETY_CASE_RESPONDER_ROLE,
    );
    assertActorInRole(role, actorPubkey);
    const retentionExpiresAt = new Date(now.getTime() + input.retentionSeconds * 1000);
    const payload = {
      contractVersion: 'platform-safety-evidence-capture-v1',
      subjectType,
      subjectRef,
      sourceDigest,
      malwareScanStatus: input.malwareScanStatus,
      piiRedactionStatus: input.piiRedactionStatus,
      restrictedCapture: true,
      minimalAccessRoleKeys: [
        PLATFORM_SAFETY_CASE_RESPONDER_ROLE,
        PLATFORM_SAFETY_LEGAL_OPERATOR_ROLE,
        PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      ],
      publicExport: false,
      aiExport: false,
      knowledgeExport: false,
      retention: {
        mode: 'short_retention',
        retentionSeconds: input.retentionSeconds,
        expiresAt: retentionExpiresAt.toISOString(),
      },
      policy: {
        id: PLATFORM_SAFETY_POLICY_ID,
        versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
        digest: PLATFORM_SAFETY_POLICY_DIGEST,
      },
      reasonCode,
    };
    const outcome = await executePlatformSafetyRoleOperation(tx, {
      home,
      role,
      actorPubkey,
      expectedRoleKey: PLATFORM_SAFETY_CASE_RESPONDER_ROLE,
      actionType: PLATFORM_SAFETY_EVIDENCE_CAPTURE_ACTION_TYPE,
      targetType: 'platform_safety_evidence',
      targetRef: `${subjectType}:${subjectRef}`,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      executionRef: `platform-safety-evidence:${hashCanonicalGovernanceValue(
        'alcheme.governance.platform-safety-evidence-capture-ref',
        { subjectType, subjectRef, idempotencyKey },
      ).slice(0, 63)}`,
      result: {
        state: 'captured_restricted',
        subjectType,
        subjectRef,
        retentionExpiresAt: retentionExpiresAt.toISOString(),
      },
    });
    const effect = await tx.operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
    });
    if (!effect) {
      throw safetyError(409, 'platform_safety_evidence_capture_effect_missing');
    }
    return {
      replayed: outcome.replayed,
      receipt: outcome.receipt,
      capture: {
        subjectType,
        subjectRef,
        state: effect.state,
        effectId: effect.id,
        sourceDigest,
        malwareScanStatus: input.malwareScanStatus,
        piiRedactionStatus: input.piiRedactionStatus,
        retentionExpiresAt: retentionExpiresAt.toISOString(),
        publicExport: false,
        aiExport: false,
        knowledgeExport: false,
      },
    };
  });
}

export async function recordPlatformSafetyEvidenceBreakGlassAccess(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    requesterPubkey: string;
    evidenceReceiptId: string;
    safetyIncidentId: string;
    purposeCode: string;
    accessJustificationDigest: string;
    durationSeconds: number;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const requesterPubkey = canonicalSolanaPublicKeyString(input.requesterPubkey);
  const evidenceReceiptId = input.evidenceReceiptId.trim();
  const safetyIncidentId = input.safetyIncidentId.trim();
  const purposeCode = input.purposeCode.trim();
  const accessJustificationDigest =
    input.accessJustificationDigest.trim().toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !requesterPubkey
    || requesterPubkey !== input.requesterPubkey
    || actorPubkey === requesterPubkey
    || !evidenceReceiptId
    || !safetyIncidentId
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(purposeCode)
    || !/^[a-f0-9]{64}$/.test(accessJustificationDigest)
    || !Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds
      < PLATFORM_SAFETY_INCIDENT_POLICY_RULES.breakGlass.minimumDurationSeconds
    || input.durationSeconds
      > PLATFORM_SAFETY_INCIDENT_POLICY_RULES.breakGlass.maximumDurationSeconds
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
  ) {
    throw safetyError(400, 'platform_safety_break_glass_access_input_invalid');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return (prisma as any).$transaction(async (tx: any) => {
    await reconcileExpiredPlatformSafetyBreakGlassAccessesInTransaction(tx, now);
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-break-glass:${evidenceReceiptId}`,
    );
    const [requesterRole, approvalRole, evidenceReceipt, incident] =
      await Promise.all([
        resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_CASE_RESPONDER_ROLE),
        resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE),
        tx.operationReceipt.findUnique({
          where: { id: evidenceReceiptId },
          include: {
            invocation: { include: { contractVersion: true } },
            initialEffect: true,
          },
        }),
        tx.platformSafetyIncident.findUnique({
          where: { id: safetyIncidentId },
        }),
      ]);
    assertActorInRole(requesterRole, requesterPubkey);
    assertActorInRole(approvalRole, actorPubkey);
    assertIndependentRoleSeparation(requesterRole, approvalRole);
    if (!evidenceReceipt || !evidenceReceipt.initialEffect) {
      throw safetyError(404, 'platform_safety_break_glass_evidence_not_found');
    }
    const evidencePayload = record(evidenceReceipt.invocation?.requestedEffect);
    if (
      evidenceReceipt.invocation?.contractVersion?.actionType
        !== PLATFORM_SAFETY_EVIDENCE_CAPTURE_ACTION_TYPE
      || evidencePayload.contractVersion !== 'platform-safety-evidence-capture-v1'
      || evidenceReceipt.initialEffect.state !== 'active'
    ) {
      throw safetyError(409, 'platform_safety_break_glass_evidence_invalid');
    }
    const incidentExpiresAt = incident?.expiresAt
      ? new Date(incident.expiresAt)
      : null;
    const allowedActions = Array.isArray(incident?.allowedEmergencyActions)
      ? incident.allowedEmergencyActions
      : [];
    const incidentScope = record(incident?.scope);
    const incidentCategories = Array.isArray(incidentScope.categories)
      ? incidentScope.categories.filter(
        (value: unknown): value is string => typeof value === 'string',
      )
      : [incident?.category].filter(
        (value: unknown): value is string => typeof value === 'string',
      );
    if (
      !incident
      || incident.state !== 'active'
      || incident.policyVersionId !== PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID
      || incident.policyDigest !== PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST
      || !incidentExpiresAt
      || !Number.isFinite(incidentExpiresAt.getTime())
      || incidentExpiresAt.getTime() <= now.getTime()
      || !allowedActions.includes(PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE)
      || !PLATFORM_SAFETY_INCIDENT_POLICY_RULES.breakGlass.predefinedEvents
        .some((category) => incidentCategories.includes(category))
    ) {
      throw safetyError(409, 'platform_safety_break_glass_incident_invalid');
    }
    const expiresAt = new Date(now.getTime() + input.durationSeconds * 1000);
    const evidenceSubjectType = String(evidencePayload.subjectType || '');
    const evidenceSubjectRef = String(evidencePayload.subjectRef || '');
    const alertRecipients = [requesterPubkey, actorPubkey].sort();
    const payload = {
      contractVersion: 'platform-safety-evidence-break-glass-read-v1',
      evidenceReceiptId,
      evidenceEffectId: evidenceReceipt.initialEffect.id,
      evidenceSubjectType,
      evidenceSubjectRef,
      evidenceSourceDigest: evidencePayload.sourceDigest,
      evidenceRetentionExpiresAt: record(evidencePayload.retention).expiresAt ?? null,
      safetyIncidentId,
      incidentPolicyVersionId: incident.policyVersionId,
      incidentPolicyDigest: incident.policyDigest,
      incidentScopeDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.platform-safety-break-glass-incident-scope',
        incident.scope,
      ),
      request: {
        requesterPubkey,
        requesterRoleBindingId: requesterRole.binding.id,
        requestedAt: now.toISOString(),
        purposeCode,
        accessJustificationDigest,
      },
      approval: {
        approverPubkey: actorPubkey,
        approverRoleBindingId: approvalRole.binding.id,
        approvedAt: now.toISOString(),
        distinctActorsRequired: true,
        ordinaryOperatorPermission: false,
      },
      access: {
        actualAccessRecordedAt: now.toISOString(),
        durationSeconds: input.durationSeconds,
        expiresAt: expiresAt.toISOString(),
        originalMaterialExport: false,
        rawEvidenceIncludedInReceipt: false,
        searchableAuditOnly: true,
      },
      alerts: {
        required: true,
        recipients: alertRecipients,
        channel: 'governance_notification',
      },
      afterActionReview: {
        required: true,
        incidentReviewRequired: true,
        reviewerRole: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      },
      policy: {
        id: PLATFORM_SAFETY_INCIDENT_POLICY_ID,
        versionId: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
        digest: PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
      },
    };
    const outcome = await executePlatformSafetyRoleOperation(tx, {
      home,
      role: approvalRole,
      actorPubkey,
      expectedRoleKey: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      actionType: PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE,
      targetType: 'platform_safety_evidence',
      targetRef: evidenceReceiptId,
      payload,
      reasonCode: purposeCode,
      idempotencyKey,
      now,
      executionRef: `platform-safety-break-glass:${evidenceReceiptId}:${safetyIncidentId}`,
      result: {
        state: 'break_glass_access_recorded',
        evidenceReceiptId,
        safetyIncidentId,
        expiresAt: expiresAt.toISOString(),
        originalMaterialExport: false,
      },
      authorityExtraSelector: {
        requesterPubkey,
        safetyIncidentId,
      },
      platformSafetyPolicyLimits: {
        breakGlassPolicy: PLATFORM_SAFETY_INCIDENT_POLICY_RULES.breakGlass,
        requesterRoleBindingId: requesterRole.binding.id,
        incidentPolicyVersionId: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
      },
    });
    const effect = await tx.operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
      include: {
        invocation: true,
        initialReceipt: true,
        events: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!effect) {
      throw safetyError(409, 'platform_safety_break_glass_effect_missing');
    }
    if (!outcome.replayed) {
      const users = await tx.user.findMany({
        where: { pubkey: { in: alertRecipients } },
        select: { id: true, pubkey: true },
      });
      await Promise.all(users.map((user: any) => tx.notification.create({
        data: {
          userId: user.id,
          type: 'governance_moderation',
          title: 'Platform Safety break-glass evidence access recorded',
          body: `Evidence receipt ${evidenceReceiptId} was accessed under Incident ${safetyIncidentId}. Access expires at ${expiresAt.toISOString()}.`,
          sourceType: 'operation_receipt',
          sourceId: outcome.receipt.id,
          createdAt: now,
        },
      })));
    }
    return {
      replayed: outcome.replayed,
      receipt: outcome.receipt,
      access: projectPlatformSafetyBreakGlassAccess(effect),
    };
  });
}

export async function readPlatformSafetyBreakGlassAccessAudit(
  prisma: PrismaClient | any,
  input: { actorPubkey: string; limit?: number },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  if (!actorPubkey || actorPubkey !== input.actorPubkey) {
    throw safetyError(400, 'platform_safety_break_glass_actor_invalid');
  }
  await reconcileExpiredPlatformSafetyBreakGlassAccesses(prisma, { limit: 100 });
  const roles = await resolvePlatformSafetyActorRoles(prisma as any, actorPubkey);
  if (
    !roles.includes(PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE)
    && !roles.includes(PLATFORM_SAFETY_CASE_RESPONDER_ROLE)
    && !roles.includes(PLATFORM_SAFETY_POLICY_ADMIN_ROLE)
  ) {
    throw safetyError(403, 'platform_safety_break_glass_audit_role_required');
  }
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const effects = await (prisma as any).operationEffect.findMany({
    where: {
      invocation: {
        subjectType: 'platform_safety_evidence',
        contractVersion: {
          actionType: PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE,
        },
      },
    },
    include: {
      invocation: true,
      initialReceipt: true,
      events: { orderBy: { sequence: 'asc' } },
    },
    orderBy: { activatedAt: 'desc' },
    take: limit,
  });
  return effects.map(projectPlatformSafetyBreakGlassAccess);
}

export async function appendPlatformSafetyLegalStatus(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    contentId: string;
    status: (typeof PLATFORM_SAFETY_LEGAL_STATUS_VALUES)[number];
    jurisdiction: 'US';
    authorityDigest: string;
    publicTombstoneDigest: string;
    redactedSummaryDigest: string;
    lifecyclePlanDigest: string;
    noticeRequired: boolean;
    appealWindowSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const contentId = input.contentId.trim();
  const status = String(input.status || '').trim() as typeof input.status;
  const authorityDigest = input.authorityDigest.trim().toLowerCase();
  const publicTombstoneDigest = input.publicTombstoneDigest.trim().toLowerCase();
  const redactedSummaryDigest = input.redactedSummaryDigest.trim().toLowerCase();
  const lifecyclePlanDigest = input.lifecyclePlanDigest.trim().toLowerCase();
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !contentId
    || contentId.length > 128
    || !PLATFORM_SAFETY_LEGAL_STATUS_VALUES.includes(status)
    || input.jurisdiction !== 'US'
    || ![authorityDigest, publicTombstoneDigest, redactedSummaryDigest, lifecyclePlanDigest]
      .every((digest) => /^[a-f0-9]{64}$/.test(digest))
    || typeof input.noticeRequired !== 'boolean'
    || !Number.isSafeInteger(input.appealWindowSeconds)
    || input.appealWindowSeconds !== 30 * 24 * 60 * 60
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
  ) {
    throw safetyError(400, 'platform_safety_legal_status_input_invalid');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-legal-status:${contentId}`,
    );
    const [role, appealRole, post] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_LEGAL_OPERATOR_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_LEGAL_APPEAL_REVIEWER_ROLE),
      tx.post.findUnique({
        where: { contentId },
        select: {
          id: true,
          authorId: true,
          author: { select: { pubkey: true } },
          contentId: true,
          circleId: true,
          status: true,
          visibility: true,
          safetyQuarantineOperationReceiptId: true,
          safetyQuarantineOperationEffectId: true,
        },
      }),
    ]);
    assertActorInRole(role, actorPubkey);
    assertIndependentRoleSeparation(role, appealRole);
    if (!post || !post.circleId) {
      throw safetyError(404, 'platform_safety_legal_target_not_found');
    }
    const existing = await readPlatformSafetyLegalStatusInTransaction(tx, contentId);
    const previousLegalStatusDigest = existing?.legalStatusDigest ?? null;
    const payload = {
      contractVersion: 'platform-safety-legal-status-append-v1',
      contentId,
      circleId: post.circleId,
      authorPubkey: post.author?.pubkey ?? null,
      status,
      jurisdiction: input.jurisdiction,
      authorityDigest,
      publicTombstoneDigest,
      redactedSummaryDigest,
      lifecyclePlanDigest,
      previousLegalStatusDigest,
      noticeRequired: input.noticeRequired,
      appealWindowSeconds: input.appealWindowSeconds,
      appealAuthority: {
        roleBindingId: appealRole.binding.id,
        roleKey: appealRole.binding.roleKey,
      },
      legalSafeProjection: {
        ordinaryRead: status === 'legal_hold' ? 'legal_status_notice' : 'legal_tombstone',
        listRead: status === 'legal_hold' ? 'legal_status_notice' : 'excluded',
        originalMaterialExport: false,
        circleGovernanceMayRestoreOriginal: false,
      },
      historicalDecisionMutation: false,
      originalQuarantineReceiptId: post.safetyQuarantineOperationReceiptId,
      originalQuarantineEffectId: post.safetyQuarantineOperationEffectId,
      policy: {
        id: PLATFORM_SAFETY_POLICY_ID,
        versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
        digest: PLATFORM_SAFETY_POLICY_DIGEST,
      },
      reasonCode,
      appendedAt: now.toISOString(),
    };
    const outcome = await executePlatformSafetyRoleOperation(tx, {
      home,
      role,
      actorPubkey,
      expectedRoleKey: PLATFORM_SAFETY_LEGAL_OPERATOR_ROLE,
      actionType: PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE,
      targetType: 'feed_post',
      targetRef: contentId,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      executionRef: `platform-safety-legal-status:${contentId}`,
      result: {
        state: 'legal_status_appended',
        contentId,
        status,
        publicProjection: payload.legalSafeProjection.ordinaryRead,
      },
    });
    const effect = await tx.operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
      include: { invocation: true, initialReceipt: true },
    });
    if (!effect) {
      throw safetyError(409, 'platform_safety_legal_status_effect_missing');
    }
    if (!outcome.replayed && input.noticeRequired) {
      await tx.notification.create({
        data: {
          userId: post.authorId,
          type: 'governance_moderation',
          title: 'Platform Safety legal status was appended',
          body: `A legal-safe status was appended for content ${contentId}. Receipt ${outcome.receipt.id}.`,
          sourceType: 'operation_receipt',
          sourceId: outcome.receipt.id,
          circleId: post.circleId,
          createdAt: now,
        },
      });
    }
    return {
      replayed: outcome.replayed,
      receipt: outcome.receipt,
      legalStatus: projectPlatformSafetyLegalStatus(effect),
    };
  });
}

export async function quarantinePlatformSafetyContent(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    circleId: number;
    contentId: string;
    category: string;
    severity: 'sev2' | 'sev1';
    durationSeconds: number;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    safetyIncidentId?: string | null;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const contentId = input.contentId.trim();
  const category = input.category.trim();
  const reasonCode = input.reasonCode.trim();
  const evidenceDigest = input.evidenceDigest.trim().toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  const safetyIncidentId = String(input.safetyIncidentId || '').trim();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !Number.isSafeInteger(input.circleId)
    || input.circleId <= 0
    || !contentId
    || contentId.length > 128
    || !TAXONOMY_CATEGORIES.has(category)
    || !['sev2', 'sev1'].includes(input.severity)
    || !Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds < MIN_DURATION_SECONDS
    || input.durationSeconds > MAX_DURATION_SECONDS
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || !/^[a-f0-9]{64}$/.test(evidenceDigest)
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
    || (
      safetyIncidentId
      && !/^platform-safety-incident:[a-f0-9]{63}$/.test(safetyIncidentId)
    )
  ) {
    throw safetyError(400, 'platform_safety_quarantine_input_invalid');
  }
  const taxonomy = PLATFORM_SAFETY_POLICY_RULES.taxonomy.categories.find(
    (item) => item.code === category,
  );
  if (!taxonomy || (taxonomy.minimumSeverity === 'sev1' && input.severity !== 'sev1')) {
    throw safetyError(409, 'platform_safety_taxonomy_severity_mismatch');
  }
  const now = new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return (prisma as any).$transaction(async (tx: any) => {
    const targetRef = `${input.circleId}:${contentId}`;
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-quarantine:${targetRef}`,
    );
    const [responder, appeal] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_CASE_RESPONDER_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE),
    ]);
    assertActorInRole(responder, actorPubkey);
    assertIndependentRoleSeparation(responder, appeal);
    if (appeal.actorPubkeys.includes(actorPubkey)) {
      throw safetyError(403, 'platform_safety_responder_appeal_conflict');
    }
    let post = await tx.post.findUnique({
      where: { contentId },
      include: { author: { select: { id: true, pubkey: true } } },
    });
    if (
      !post
      || post.circleId !== input.circleId
      || !['Active', 'Published'].includes(String(post.status))
      || post.isV2Draft === true
      || post.visibility === 'Private'
    ) {
      throw safetyError(404, 'platform_safety_quarantine_target_not_found');
    }
    if (post.author?.pubkey === actorPubkey) {
      throw safetyError(409, 'platform_safety_responder_subject_conflict');
    }
    if (post.safetyQuarantined === true) {
      const expiresAt = new Date(String(post.safetyQuarantineExpiresAt || ''));
      if (!Number.isFinite(expiresAt.getTime())) {
        throw safetyError(409, 'platform_safety_quarantine_stored_state_invalid');
      }
      if (expiresAt.getTime() <= now.getTime()) {
        await restoreExpiredPlatformSafetyPostInTransaction(tx, post, now);
        post = await tx.post.findUnique({
          where: { contentId },
          include: { author: { select: { id: true, pubkey: true } } },
        });
      }
    }

    const existingInvocation = await tx.governedActionInvocation.findFirst({
      where: {
        actorPubkey,
        subjectType: 'feed_post',
        subjectRef: targetRef,
        idempotencyKey,
        contractVersion: {
          actionType: PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (post.safetyQuarantined === true && !existingInvocation) {
      throw safetyError(409, 'platform_safety_quarantine_overlap');
    }
    const stored = record(existingInvocation?.requestedEffect);
    let safetyIncidentContext: Record<string, unknown> | null = null;
    if (safetyIncidentId) {
      const safetyIncident = await tx.platformSafetyIncident.findUnique({
        where: { id: safetyIncidentId },
      });
      const allowedActions = Array.isArray(
        safetyIncident?.allowedEmergencyActions,
      )
        ? safetyIncident.allowedEmergencyActions
        : [];
      const incidentExpiresAt = safetyIncident?.expiresAt
        ? new Date(safetyIncident.expiresAt)
        : null;
      const incidentScope = record(safetyIncident?.scope);
      const incidentCategories = Array.isArray(incidentScope.categories)
        ? incidentScope.categories.filter(
            (value: unknown): value is string => typeof value === 'string',
          )
        : [safetyIncident?.category].filter(
            (value: unknown): value is string => typeof value === 'string',
          );
      if (
        !safetyIncident
        || safetyIncident.policyVersionId
          !== PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID
        || safetyIncident.policyDigest !== PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST
        || safetyIncident.targetCircleId !== input.circleId
        || !incidentCategories.includes(category)
        || safetyIncident.severity !== input.severity
        || !allowedActions.includes(
          PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
        )
        || !incidentExpiresAt
        || !Number.isFinite(incidentExpiresAt.getTime())
        || (
          !existingInvocation
          && (
            safetyIncident.state !== 'active'
            || incidentExpiresAt.getTime() <= now.getTime()
          )
        )
      ) {
        throw safetyError(409, 'platform_safety_incident_scope_invalid');
      }
      safetyIncidentContext = {
        id: safetyIncident.id,
        declarationReceiptId: safetyIncident.declarationReceiptId,
        declarationEffectId: safetyIncident.declarationEffectId,
        commanderPubkey: safetyIncident.commanderPubkey,
        policyVersionId: safetyIncident.policyVersionId,
        policyDigest: safetyIncident.policyDigest,
        scopeDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.platform-safety-incident-scope',
          safetyIncident.scope,
        ),
        activatedAt: new Date(safetyIncident.activatedAt).toISOString(),
        expiresAt: incidentExpiresAt.toISOString(),
        createsNewAuthority: false,
      };
    }
    const activatedAt = stored.activatedAt
      ? new Date(String(stored.activatedAt))
      : now;
    const expiresAt = stored.expiresAt
      ? new Date(String(stored.expiresAt))
      : new Date(activatedAt.getTime() + input.durationSeconds * 1000);
    if (
      !Number.isFinite(activatedAt.getTime())
      || !Number.isFinite(expiresAt.getTime())
      || expiresAt.getTime() - activatedAt.getTime() !== input.durationSeconds * 1000
    ) {
      throw safetyError(409, 'platform_safety_quarantine_expiry_mismatch');
    }
    const frozenSubject = {
      contentId,
      circleId: input.circleId,
      authorPubkey: String(post.author?.pubkey || ''),
      contentType: String(post.contentType),
      visibility: String(post.visibility),
      status: String(post.status),
      textDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.platform-safety-content-text',
        { text: post.text ?? null, storageUri: post.storageUri ?? null },
      ),
    };
    const subjectSnapshotDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-content-snapshot',
      frozenSubject,
    );
    const incidentRef = `platform-safety-incident:${hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-id',
      { actorPubkey, targetRef, idempotencyKey },
    ).slice(0, 56)}`;
    const payload = {
      contractVersion: 'platform-safety-content-quarantine-current',
      incidentRef,
      targetRef,
      contentId,
      circleId: input.circleId,
      category,
      severity: input.severity,
      durationSeconds: input.durationSeconds,
      activatedAt: activatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      reasonCode,
      evidenceDigest,
      subjectSnapshotDigest,
      frozenSubject,
      safetyIncident: safetyIncidentContext,
      policy: {
        id: PLATFORM_SAFETY_POLICY_ID,
        versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
        version: PLATFORM_SAFETY_POLICY_VERSION,
        digest: PLATFORM_SAFETY_POLICY_DIGEST,
        jurisdiction: 'US',
        minimumAge: 18,
      },
      authority: {
        roleBindingId: responder.binding.id,
        roleKey: responder.binding.roleKey,
        independentAppealBindingId: appeal.binding.id,
      },
      activation: 'human_platform_safety_responder',
      automatedEnforcement: false,
      batchSubjectCount: 1,
      delete: false,
      legalDisposition: false,
      originalContentAccess: 'author_and_bound_platform_safety_roles_only',
      afterActionReviewRequired: true,
    };
    if (existingInvocation && !isDeepStrictEqual(stored, payload)) {
      throw safetyError(409, 'platform_safety_quarantine_idempotency_conflict');
    }
    const recentCount = await tx.governedActionInvocation.count({
      where: {
        governanceHomeType: 'platform_safety_system_role',
        governanceHomeRef: 'platform_safety:sandbox',
        actorPubkey,
        contractVersion: {
          actionType: PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
        },
        createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
        state: { in: ['executing', 'completed'] },
        NOT: { subjectRef: targetRef, idempotencyKey },
      },
    });
    if (
      recentCount
      >= PLATFORM_SAFETY_POLICY_RULES.quarantine.maximumInvocationsPerActorPerHour
    ) {
      throw safetyError(429, 'platform_safety_quarantine_frequency_exceeded');
    }
    const actorSetDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-role-actors',
      responder.actorPubkeys,
    );
    const runtimeBinding: GovernedActionGatewayRuntimeBinding = {
      id: responder.binding.id,
      policyId: responder.binding.policyId,
      policyVersionId: responder.binding.policyVersionId,
      policyVersion: responder.binding.policyVersion,
      ruleId: 'platform_safety_single_content_quarantine',
      committeeCircleId: responder.binding.circleId,
      authoritySourceType: 'system_governance_role_binding',
      authoritySourceRef: responder.binding.id,
      authoritySourceVersion:
        `${responder.binding.policyVersionId}:${responder.binding.roleKey}`,
      authorityPurpose: 'operational_execution',
      authoritySelector: {
        actorPubkey,
        roleKey: responder.binding.roleKey,
        subjectType: 'feed_post',
        subjectRef: targetRef,
        actorSetDigest,
        environment: 'local_development',
        network: 'solana:localnet',
      },
      authorityLimits: {
        platformSafetyPolicy: {
          id: PLATFORM_SAFETY_POLICY_ID,
          versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
          digest: PLATFORM_SAFETY_POLICY_DIGEST,
          jurisdiction: 'US',
          minimumAge: 18,
          maximumDurationSeconds: MAX_DURATION_SECONDS,
          maximumInvocationsPerActorPerHour:
            PLATFORM_SAFETY_POLICY_RULES.quarantine.maximumInvocationsPerActorPerHour,
          actorSetDigest,
          independentAppealBindingId: appeal.binding.id,
        },
        executionAuthority: {
          type: 'registered_adapter',
          ref: 'platform_safety',
        },
        riskFloor: 'high',
      },
    };
    const registry = createGovernedActionRegistry({
      includePlatformSafetyActions: true,
    });
    const definition = registry.get(PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE);
    if (!definition) {
      throw safetyError(500, 'platform_safety_quarantine_contract_missing');
    }
    const runtime = await resolveGovernedSystemRoleOperationRuntime({
      prisma: tx,
      transactionClient: true,
    }, {
      definition,
      home,
      binding: runtimeBinding,
      actorPubkey,
      targetType: 'feed_post',
      targetRef,
      payload,
      reasonCode,
      expectedRoleKey: PLATFORM_SAFETY_CASE_RESPONDER_ROLE,
      now,
    });
    const gateway = new GovernedActionGateway({
      registry,
      resolveBinding: async () => null,
      listCommitteeEligibleActors: async () => [],
      requestStore: createPrismaGovernanceRequestStore(tx),
      runtimePrisma: tx,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const outcome = await gateway.executeSystemRoleOperation({
      actionType: PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'feed_post',
      targetRef,
      actorPubkey,
      payload,
      reasonCode,
      idempotencyKey,
      runtime,
      execute: async () => {
        const updated = await tx.post.updateMany({
          where: {
            id: post.id,
            updatedAt: post.updatedAt,
            safetyQuarantined: false,
          },
          data: {
            safetyQuarantined: true,
            safetyQuarantinedAt: activatedAt,
            safetyQuarantineExpiresAt: expiresAt,
            safetyQuarantineReasonCode: reasonCode,
            safetyQuarantinePolicyRef: PLATFORM_SAFETY_POLICY_VERSION_ID,
            safetyQuarantineIncidentRef: incidentRef,
            safetyQuarantineEvidenceDigest: evidenceDigest,
            safetyQuarantineOriginalVisibility: String(post.visibility),
            safetyQuarantineOperationReceiptId: null,
            safetyQuarantineOperationEffectId: null,
          },
        });
        if (updated.count !== 1) {
          throw safetyError(409, 'platform_safety_quarantine_target_changed');
        }
        return {
          result: {
            incidentRef,
            state: 'active',
            expiresAt: expiresAt.toISOString(),
            publicProjection: 'not_found_while_active',
          },
          executionRef: `feed-post:${targetRef}:platform-safety-quarantined`,
        };
      },
    });
    const durable = await linkPlatformSafetyQuarantineInTransaction(tx, {
      postId: post.id,
      contentId,
      receiptId: outcome.receipt.id,
      invocationId: outcome.receipt.invocationId,
      incidentRef,
      replayed: outcome.replayed,
    });
    if (!outcome.replayed && post.author?.id) {
      await tx.notification.create({
        data: {
          userId: post.author.id,
          type: 'governance_moderation',
          title: 'Content was temporarily quarantined by Platform Safety',
          body: `The quarantine expires at ${expiresAt.toISOString()}. The action receipt is ${outcome.receipt.id}.`,
          sourceType: 'operation_receipt',
          sourceId: outcome.receipt.id,
          circleId: input.circleId,
          createdAt: now,
        },
      });
    }
    return {
      replayed: outcome.replayed,
      receipt: outcome.receipt,
      incident: projectPlatformSafetyIncident(durable),
    };
  });
}

export async function releasePlatformSafetyContent(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    circleId: number;
    contentId: string;
    reasonCode: string;
    idempotencyKey: string;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const contentId = input.contentId.trim();
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !Number.isSafeInteger(input.circleId)
    || input.circleId <= 0
    || !contentId
    || contentId.length > 128
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
  ) {
    throw safetyError(400, 'platform_safety_release_input_invalid');
  }
  const now = new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(prisma as any, now);
  return (prisma as any).$transaction(async (tx: any) => {
    const targetRef = `${input.circleId}:${contentId}`;
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-quarantine:${targetRef}`,
    );
    const [responder, appeal] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_CASE_RESPONDER_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE),
    ]);
    assertActorInRole(responder, actorPubkey);
    assertIndependentRoleSeparation(responder, appeal);

    const existingInvocation = await tx.governedActionInvocation.findFirst({
      where: {
        actorPubkey,
        subjectType: 'feed_post',
        subjectRef: targetRef,
        idempotencyKey,
        contractVersion: {
          actionType: PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE,
        },
      },
      include: {
        operationReceipts: { orderBy: { completedAt: 'desc' }, take: 1 },
        operationEffect: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingInvocation) {
      const stored = record(existingInvocation.requestedEffect);
      const receipt = existingInvocation.operationReceipts?.[0];
      const effect = existingInvocation.operationEffect;
      if (
        stored.contentId !== contentId
        || stored.circleId !== input.circleId
        || stored.reasonCode !== reasonCode
        || !receipt
        || receipt.executionStatus !== 'succeeded'
        || !effect
        || !['expired', 'revoked'].includes(effect.state)
      ) {
        throw safetyError(409, 'platform_safety_release_idempotency_conflict');
      }
      return {
        replayed: true,
        receipt,
        release: {
          contentId,
          circleId: input.circleId,
          originalIncidentRef: stored.originalIncidentRef,
          originalEffectId: stored.originalEffectId,
          releaseEffectId: effect.id,
          state: 'released',
          releasedAt: stored.releasedAt,
        },
      };
    }

    const post = await tx.post.findUnique({
      where: { contentId },
      include: {
        author: { select: { id: true, pubkey: true } },
        safetyQuarantineOperationReceipt: true,
        safetyQuarantineOperationEffect: true,
      },
    });
    if (
      !post
      || post.circleId !== input.circleId
      || post.safetyQuarantined !== true
      || !post.safetyQuarantineOperationReceipt
      || !post.safetyQuarantineOperationEffect
      || post.safetyQuarantineOperationEffect.state !== 'active'
      || !post.safetyQuarantineIncidentRef
    ) {
      throw safetyError(404, 'platform_safety_release_target_not_found');
    }
    const originalReceipt = post.safetyQuarantineOperationReceipt;
    const originalEffect = post.safetyQuarantineOperationEffect;
    const payload = {
      contractVersion: 'platform-safety-content-release-current',
      targetRef,
      contentId,
      circleId: input.circleId,
      reasonCode,
      releasedAt: now.toISOString(),
      originalIncidentRef: post.safetyQuarantineIncidentRef,
      originalReceiptId: originalReceipt.id,
      originalReceiptDigest: originalReceipt.receiptDigest,
      originalEffectId: originalEffect.id,
      originalEffectDigest: originalEffect.effectDigest,
      originalEffectState: originalEffect.state,
      policy: {
        id: PLATFORM_SAFETY_POLICY_ID,
        versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
        version: PLATFORM_SAFETY_POLICY_VERSION,
        digest: PLATFORM_SAFETY_POLICY_DIGEST,
      },
      authority: {
        roleBindingId: responder.binding.id,
        roleKey: responder.binding.roleKey,
        independentAppealBindingId: appeal.binding.id,
      },
      scope: 'release_exact_platform_safety_quarantine',
      delete: false,
      legalDisposition: false,
    };
    const actorSetDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-role-actors',
      responder.actorPubkeys,
    );
    const runtimeBinding: GovernedActionGatewayRuntimeBinding = {
      id: responder.binding.id,
      policyId: responder.binding.policyId,
      policyVersionId: responder.binding.policyVersionId,
      policyVersion: responder.binding.policyVersion,
      ruleId: 'platform_safety_single_content_release',
      committeeCircleId: responder.binding.circleId,
      authoritySourceType: 'system_governance_role_binding',
      authoritySourceRef: responder.binding.id,
      authoritySourceVersion:
        `${responder.binding.policyVersionId}:${responder.binding.roleKey}`,
      authorityPurpose: 'operational_execution',
      authoritySelector: {
        actorPubkey,
        roleKey: responder.binding.roleKey,
        subjectType: 'feed_post',
        subjectRef: targetRef,
        actorSetDigest,
        environment: 'local_development',
        network: 'solana:localnet',
      },
      authorityLimits: {
        platformSafetyPolicy: {
          id: PLATFORM_SAFETY_POLICY_ID,
          versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
          digest: PLATFORM_SAFETY_POLICY_DIGEST,
          actorSetDigest,
          exactOriginalEffectId: originalEffect.id,
        },
        executionAuthority: { type: 'registered_adapter', ref: 'platform_safety' },
        riskFloor: 'high',
      },
    };
    const registry = createGovernedActionRegistry({ includePlatformSafetyActions: true });
    const definition = registry.get(PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE);
    if (!definition) throw safetyError(500, 'platform_safety_release_contract_missing');
    const runtime = await resolveGovernedSystemRoleOperationRuntime({
      prisma: tx,
      transactionClient: true,
    }, {
      definition,
      home,
      binding: runtimeBinding,
      actorPubkey,
      targetType: 'feed_post',
      targetRef,
      payload,
      reasonCode,
      expectedRoleKey: PLATFORM_SAFETY_CASE_RESPONDER_ROLE,
      now,
    });
    const gateway = new GovernedActionGateway({
      registry,
      resolveBinding: async () => null,
      listCommitteeEligibleActors: async () => [],
      requestStore: createPrismaGovernanceRequestStore(tx),
      runtimePrisma: tx,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const outcome = await gateway.executeSystemRoleOperation({
      actionType: PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'feed_post',
      targetRef,
      actorPubkey,
      payload,
      reasonCode,
      idempotencyKey,
      runtime,
      execute: async () => ({
        result: {
          originalIncidentRef: post.safetyQuarantineIncidentRef,
          originalEffectId: originalEffect.id,
          state: 'release_authorized',
        },
        executionRef: `feed-post:${targetRef}:platform-safety-released`,
      }),
    });
    if (outcome.replayed) {
      throw safetyError(409, 'platform_safety_release_replay_state_mismatch');
    }
    const releaseEffect = await tx.operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
    });
    if (!releaseEffect || releaseEffect.state !== 'active') {
      throw safetyError(409, 'platform_safety_release_effect_missing');
    }
    await transitionOperationEffectInTransaction(tx, {
      effectId: originalEffect.id,
      nextState: 'revoked',
      reasonCode: 'platform_safety_governed_release',
      actorPubkey,
      sourceReceiptId: outcome.receipt.id,
      occurredAt: now,
    });
    const cleared = await tx.post.updateMany({
      where: {
        id: post.id,
        safetyQuarantined: true,
        safetyQuarantineOperationEffectId: originalEffect.id,
      },
      data: {
        safetyQuarantined: false,
        safetyQuarantinedAt: null,
        safetyQuarantineExpiresAt: null,
        safetyQuarantineReasonCode: null,
        safetyQuarantinePolicyRef: null,
        safetyQuarantineIncidentRef: null,
        safetyQuarantineEvidenceDigest: null,
        safetyQuarantineOriginalVisibility: null,
        safetyQuarantineOperationReceiptId: null,
        safetyQuarantineOperationEffectId: null,
      },
    });
    if (cleared.count !== 1) {
      throw safetyError(409, 'platform_safety_release_post_cas_failed');
    }
    await transitionOperationEffectInTransaction(tx, {
      effectId: releaseEffect.id,
      nextState: 'expired',
      reasonCode: 'platform_safety_release_action_completed',
      actorPubkey,
      sourceReceiptId: outcome.receipt.id,
      occurredAt: now,
    });
    if (post.author?.id) {
      await tx.notification.create({
        data: {
          userId: post.author.id,
          type: 'governance_moderation',
          title: 'Platform Safety quarantine was released',
          body: `The quarantine was released by governed action ${outcome.receipt.id}.`,
          sourceType: 'operation_receipt',
          sourceId: outcome.receipt.id,
          circleId: input.circleId,
          createdAt: now,
        },
      });
    }
    return {
      replayed: false,
      receipt: outcome.receipt,
      release: {
        contentId,
        circleId: input.circleId,
        originalIncidentRef: post.safetyQuarantineIncidentRef,
        originalEffectId: originalEffect.id,
        releaseEffectId: releaseEffect.id,
        state: 'released',
        releasedAt: now.toISOString(),
      },
    };
  });
}

export async function openPlatformSafetyAppeal(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    contentId: string;
    reasonCode: string;
    evidenceDigest: string;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const contentId = input.contentId.trim();
  const reasonCode = input.reasonCode.trim();
  const evidenceDigest = input.evidenceDigest.trim().toLowerCase();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !contentId
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || !/^[a-f0-9]{64}$/.test(evidenceDigest)
  ) {
    throw safetyError(400, 'platform_safety_appeal_input_invalid');
  }
  await reconcileExpiredPlatformSafetyQuarantines(prisma, {
    now: input.now,
    limit: 100,
  });
  const post = await (prisma as any).post.findUnique({
    where: { contentId },
    include: {
      author: { select: { pubkey: true } },
      safetyQuarantineOperationReceipt: true,
    },
  });
  if (
    !post
    || post.author?.pubkey !== actorPubkey
    || post.safetyQuarantined !== true
    || !post.safetyQuarantineOperationReceipt
  ) {
    throw safetyError(404, 'platform_safety_appeal_subject_not_found');
  }
  try {
    return await openGovernedActionAppeal(prisma as any, {
      originalReceiptId: post.safetyQuarantineOperationReceipt.id,
      appellantPubkey: actorPubkey,
      reasonCode,
      evidence: {
        contractVersion: 'platform-safety-appeal-evidence-digest-v1',
        evidenceDigest,
      },
      now: input.now,
    });
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith('governed_action_appeal_')
    ) {
      throw safetyError(409, error.message);
    }
    throw error;
  }
}

export async function openPlatformSafetyLegalStatusAppeal(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    contentId: string;
    reasonCode: string;
    evidenceDigest: string;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const contentId = input.contentId.trim();
  const reasonCode = input.reasonCode.trim();
  const evidenceDigest = input.evidenceDigest.trim().toLowerCase();
  if (
    !actorPubkey
    || actorPubkey !== input.actorPubkey
    || !contentId
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || !/^[a-f0-9]{64}$/.test(evidenceDigest)
  ) {
    throw safetyError(400, 'platform_safety_legal_appeal_input_invalid');
  }
  const [post, legalStatus] = await Promise.all([
    (prisma as any).post.findUnique({
      where: { contentId },
      include: { author: { select: { pubkey: true } } },
    }),
    readPlatformSafetyPublicLegalStatus(prisma, contentId),
  ]);
  if (
    !post
    || post.author?.pubkey !== actorPubkey
    || !legalStatus
    || legalStatus.state !== 'active'
  ) {
    throw safetyError(404, 'platform_safety_legal_appeal_subject_not_found');
  }
  try {
    return await openGovernedActionAppeal(prisma as any, {
      originalReceiptId: legalStatus.receiptId,
      appellantPubkey: actorPubkey,
      reasonCode,
      evidence: {
        contractVersion: 'platform-safety-legal-appeal-evidence-digest-v1',
        evidenceDigest,
      },
      now: input.now,
    });
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith('governed_action_appeal_')
    ) {
      throw safetyError(409, error.message);
    }
    throw error;
  }
}

export async function resolvePlatformSafetyAppeal(
  prisma: PrismaClient,
  input: {
    reviewerPubkey: string;
    appealId: string;
    outcome: Extract<GovernedActionAppealResolutionOutcome, 'uphold' | 'revoke'>;
    reasonCode: string;
    evidenceDigest: string;
    now?: Date;
  },
) {
  const reviewerPubkey = canonicalSolanaPublicKeyString(input.reviewerPubkey);
  const appealId = input.appealId.trim();
  const reasonCode = input.reasonCode.trim();
  const evidenceDigest = input.evidenceDigest.trim().toLowerCase();
  if (
    !reviewerPubkey
    || reviewerPubkey !== input.reviewerPubkey
    || !appealId
    || !['uphold', 'revoke'].includes(input.outcome)
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || !/^[a-f0-9]{64}$/.test(evidenceDigest)
  ) {
    throw safetyError(400, 'platform_safety_appeal_resolution_input_invalid');
  }
  const now = input.now ?? new Date();
  return (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `platform-safety-appeal-resolution:${appealId}`,
    );
    const appeal = await tx.governedActionAppeal.findUnique({
      where: { id: appealId },
      include: {
        appealInvocation: true,
        originalReceipt: {
          include: {
            invocation: { include: { contractVersion: true } },
            initialEffect: true,
          },
        },
      },
    });
    if (
      !appeal
      || appeal.resolutionPath !== 'independent_review'
      || ![
        PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
        PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE,
      ].includes(appeal.originalReceipt?.invocation?.contractVersion?.actionType)
    ) {
      throw safetyError(404, 'platform_safety_appeal_not_found');
    }
    const actionType = appeal.originalReceipt.invocation.contractVersion.actionType;
    const expectedReviewRole = actionType === PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE
      ? PLATFORM_SAFETY_LEGAL_APPEAL_REVIEWER_ROLE
      : PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE;
    const reviewRole = await resolvePlatformSafetyRole(
      tx,
      expectedReviewRole,
    );
    assertActorInRole(reviewRole, reviewerPubkey);
    if (
      reviewerPubkey === appeal.originalReceipt.actorPubkey
      || reviewerPubkey === appeal.appellantPubkey
    ) {
      throw safetyError(409, 'platform_safety_appeal_reviewer_conflict');
    }
    const appealPayload = record(appeal.appealInvocation?.requestedEffect);
    const frozenAuthority = record(appealPayload.independentReviewAuthority);
    const currentActorSetDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-role-actors',
      reviewRole.actorPubkeys,
    );
    const eligibleActors = reviewRole.actorPubkeys.filter(
      (actor) =>
        actor !== appeal.originalReceipt.actorPubkey
        && actor !== appeal.appellantPubkey,
    );
    const eligibleActorSetDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-appeal-eligible-actors',
      eligibleActors,
    );
    if (
      frozenAuthority.bindingId !== reviewRole.binding.id
      || frozenAuthority.policyVersionId !== reviewRole.binding.policyVersionId
      || frozenAuthority.policyDigest !== PLATFORM_SAFETY_POLICY_DIGEST
      || frozenAuthority.actorSetDigest !== currentActorSetDigest
      || frozenAuthority.eligibleActorSetDigest !== eligibleActorSetDigest
      || !eligibleActors.includes(reviewerPubkey)
    ) {
      throw safetyError(409, 'platform_safety_appeal_authority_drift');
    }
    const reviewerAuthorityDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-appeal-review-authority',
      {
        appealId,
        reviewerPubkey,
        bindingId: reviewRole.binding.id,
        policyVersionId: reviewRole.binding.policyVersionId,
        policyDigest: PLATFORM_SAFETY_POLICY_DIGEST,
        actorSetDigest: currentActorSetDigest,
        eligibleActorSetDigest,
      },
    );
    const result = await resolveGovernedActionAppeal(tx, {
      appealId,
      reviewerPubkey,
      reviewerAuthorityDigest,
      outcome: input.outcome,
      reasonCode,
      evidence: {
        contractVersion: 'platform-safety-appeal-resolution-evidence-digest-v1',
        evidenceDigest,
      },
      now,
    });
    const originalPayload = record(
      appeal.originalReceipt.invocation.requestedEffect,
    );
    const contentId = String(originalPayload.contentId || '');
    const post = contentId
      ? await tx.post.findUnique({ where: { contentId } })
      : null;
    if (
      input.outcome === 'revoke'
      && post?.safetyQuarantined === true
      && post.safetyQuarantineOperationEffectId
        === appeal.originalReceipt.initialEffect?.id
    ) {
      const cleared = await tx.post.updateMany({
        where: {
          id: post.id,
          safetyQuarantined: true,
          safetyQuarantineOperationEffectId:
            appeal.originalReceipt.initialEffect.id,
        },
        data: {
          safetyQuarantined: false,
          safetyQuarantinedAt: null,
          safetyQuarantineExpiresAt: null,
          safetyQuarantineReasonCode: null,
          safetyQuarantinePolicyRef: null,
          safetyQuarantineIncidentRef: null,
          safetyQuarantineEvidenceDigest: null,
          safetyQuarantineOriginalVisibility: null,
          safetyQuarantineOperationReceiptId: null,
          safetyQuarantineOperationEffectId: null,
        },
      });
      if (cleared.count !== 1) {
        throw safetyError(409, 'platform_safety_appeal_restore_cas_failed');
      }
    }
    return {
      ...result,
      appeal: {
        id: appeal.id,
        originalReceiptId: appeal.originalReceiptId,
        contentId,
        actionType,
        outcome: input.outcome,
        state: 'resolved',
        effectState: input.outcome === 'revoke'
          ? 'revoked'
          : appeal.originalReceipt.initialEffect?.state,
        postRestored:
          input.outcome === 'revoke' && post?.safetyQuarantined === true,
      },
    };
  });
}

export async function readPlatformSafetyWorkspace(
  prisma: PrismaClient,
  input: { actorPubkey: string },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  if (!actorPubkey || actorPubkey !== input.actorPubkey) {
    throw safetyError(400, 'platform_safety_actor_invalid');
  }
  await reconcileExpiredPlatformSafetyQuarantines(prisma, { limit: 100 });
  await reconcileExpiredPlatformSafetyBreakGlassAccesses(prisma, { limit: 100 });
  const roles = await resolvePlatformSafetyActorRoles(prisma as any, actorPubkey);
  if (roles.length === 0) {
    throw safetyError(403, 'platform_safety_role_required');
  }
  const posts = await (prisma as any).post.findMany({
    where: { safetyQuarantined: true },
    include: {
      author: { select: { pubkey: true, handle: true } },
      safetyQuarantineOperationReceipt: {
        include: {
          appeals: {
            orderBy: { openedAt: 'desc' },
            take: 1,
            include: { resolutionReceipt: true },
          },
        },
      },
      safetyQuarantineOperationEffect: {
        include: {
          invocation: true,
          events: { orderBy: { sequence: 'asc' } },
        },
      },
    },
    orderBy: { safetyQuarantinedAt: 'desc' },
    take: 100,
  });
  return {
    schemaVersion: 1,
    viewer: { pubkey: actorPubkey, roles },
    policy: await readPlatformSafetyPolicy(prisma),
    incidents: posts.map(projectPlatformSafetyIncident),
    legalStatuses: await readActivePlatformSafetyLegalStatuses(prisma),
    breakGlassAccesses: await readPlatformSafetyBreakGlassAccessAudit(prisma, {
      actorPubkey,
      limit: 50,
    }),
  };
}

export async function readPlatformSafetyPublicLegalStatus(
  prisma: PrismaClient,
  contentId: string,
) {
  const normalized = String(contentId || '').trim();
  if (!normalized) return null;
  return readPlatformSafetyLegalStatusInTransaction(prisma as any, normalized);
}

export async function readActivePlatformSafetyLegalStatuses(
  prisma: PrismaClient | any,
  contentIds?: string[],
) {
  const normalizedContentIds = Array.isArray(contentIds)
    ? [...new Set(contentIds.map((value) => String(value || '').trim()).filter(Boolean))]
    : null;
  if (normalizedContentIds && normalizedContentIds.length === 0) return [];
  const effects = await (prisma as any).operationEffect.findMany({
    where: {
      state: 'active',
      invocation: {
        subjectType: 'feed_post',
        ...(normalizedContentIds ? { subjectRef: { in: normalizedContentIds } } : {}),
        contractVersion: {
          actionType: PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE,
        },
      },
    },
    include: {
      invocation: true,
      initialReceipt: true,
    },
    orderBy: { activatedAt: 'desc' },
    take: normalizedContentIds ? Math.max(1, normalizedContentIds.length * 4) : 100,
  });
  const byContentId = new Map<string, any>();
  for (const effect of effects) {
    const projected = projectPlatformSafetyLegalStatus(effect);
    if (!byContentId.has(projected.contentId)) {
      byContentId.set(projected.contentId, projected);
    }
  }
  return [...byContentId.values()];
}

export async function readPlatformSafetySubjectQuarantine(
  prisma: PrismaClient,
  input: { actorPubkey: string; contentId: string },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const contentId = input.contentId.trim();
  if (!actorPubkey || actorPubkey !== input.actorPubkey || !contentId) {
    throw safetyError(400, 'platform_safety_subject_read_input_invalid');
  }
  await reconcileExpiredPlatformSafetyQuarantines(prisma, { limit: 100 });
  const post = await (prisma as any).post.findUnique({
    where: { contentId },
    include: {
      author: { select: { pubkey: true, handle: true } },
      safetyQuarantineOperationReceipt: {
        include: {
          appeals: {
            orderBy: { openedAt: 'desc' },
            take: 1,
            include: { resolutionReceipt: true },
          },
        },
      },
      safetyQuarantineOperationEffect: {
        include: {
          invocation: true,
          events: { orderBy: { sequence: 'asc' } },
        },
      },
    },
  });
  if (!post) throw safetyError(404, 'platform_safety_subject_not_found');
  const roles = await resolvePlatformSafetyActorRoles(prisma as any, actorPubkey);
  if (post.author?.pubkey !== actorPubkey && roles.length === 0) {
    throw safetyError(404, 'platform_safety_subject_not_found');
  }
  return {
    schemaVersion: 1,
    viewer: {
      pubkey: actorPubkey,
      access: post.author?.pubkey === actorPubkey ? 'content_author' : 'platform_safety_role',
      roles,
    },
    incident: post.safetyQuarantined ? projectPlatformSafetyIncident(post) : null,
    originalContent: post.safetyQuarantined ? {
      contentId: post.contentId,
      text: post.text,
      storageUri: post.storageUri,
      contentType: post.contentType,
      authorPubkey: post.author?.pubkey ?? null,
      authorHandle: post.author?.handle ?? null,
    } : null,
  };
}

export async function reconcileExpiredPlatformSafetyQuarantines(
  prisma: PrismaClient | any,
  input: { now?: Date; limit?: number } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const candidates = await (prisma as any).post.findMany({
    where: {
      safetyQuarantined: true,
      safetyQuarantineExpiresAt: { lte: now },
    },
    orderBy: { safetyQuarantineExpiresAt: 'asc' },
    take: limit,
  });
  const restored: string[] = [];
  const failures: Array<{ contentId: string; error: string }> = [];
  for (const candidate of candidates) {
    try {
      const result = await (prisma as any).$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          `platform-safety-quarantine:${candidate.circleId}:${candidate.contentId}`,
        );
        const current = await tx.post.findUnique({
          where: { contentId: candidate.contentId },
        });
        if (
          !current
          || current.safetyQuarantined !== true
          || current.safetyQuarantineOperationEffectId
            !== candidate.safetyQuarantineOperationEffectId
        ) {
          return 'stale';
        }
        await restoreExpiredPlatformSafetyPostInTransaction(tx, current, now);
        return 'restored';
      });
      if (result === 'restored') restored.push(candidate.contentId);
    } catch (error) {
      failures.push({
        contentId: candidate.contentId,
        error: error instanceof Error
          ? error.message
          : 'platform_safety_quarantine_expiry_failed',
      });
    }
  }
  return { restored, failures };
}

export async function reconcileExpiredPlatformSafetyBreakGlassAccesses(
  prisma: PrismaClient | any,
  input: { now?: Date; limit?: number } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  return (prisma as any).$transaction(async (tx: any) =>
    reconcileExpiredPlatformSafetyBreakGlassAccessesInTransaction(tx, now, limit));
}

async function reconcileExpiredPlatformSafetyBreakGlassAccessesInTransaction(
  tx: any,
  now: Date,
  limit = 100,
) {
  const candidates = await tx.operationEffect.findMany({
    where: {
      state: 'active',
      invocation: {
        subjectType: 'platform_safety_evidence',
        contractVersion: {
          actionType: PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE,
        },
      },
    },
    include: {
      invocation: true,
      initialReceipt: true,
    },
    orderBy: { activatedAt: 'asc' },
    take: limit,
  });
  const expired: string[] = [];
  for (const effect of candidates) {
    const expiresAt = new Date(
      String(record(record(effect.invocation?.requestedEffect).access).expiresAt || ''),
    );
    if (
      !Number.isFinite(expiresAt.getTime())
      || expiresAt.getTime() > now.getTime()
    ) {
      continue;
    }
    try {
      await transitionOperationEffectInTransaction(tx, {
        effectId: effect.id,
        nextState: 'expired',
        reasonCode: 'platform_safety_break_glass_access_expired',
        actorPubkey: null,
        sourceReceiptId: effect.initialReceiptId,
        occurredAt: now,
      });
      expired.push(effect.id);
    } catch (error) {
      if (
        !(error instanceof Error)
        || error.message !== 'operation_effect_transition_cas_failed'
      ) {
        throw error;
      }
      const concurrent = await tx.operationEffect.findUnique({
        where: { id: effect.id },
      });
      if (!concurrent || !['expired', 'revoked'].includes(concurrent.state)) {
        throw error;
      }
    }
  }
  return { expired };
}

export async function resolvePlatformSafetyRole(
  prisma: any,
  roleKey: PlatformSafetyRoleKey,
): Promise<PlatformSafetyRoleResolution> {
  const bindings = await prisma.systemGovernanceRoleBinding.findMany({
    where: {
      domain: PLATFORM_SAFETY_DOMAIN,
      roleKey,
      environment: PLATFORM_SAFETY_ENVIRONMENT,
      status: 'active',
    },
    orderBy: { activatedAt: 'desc' },
    take: 2,
  });
  if (bindings.length !== 1) {
    throw safetyError(
      409,
      bindings.length === 0
        ? 'platform_safety_role_binding_required'
        : 'platform_safety_role_binding_ambiguous',
    );
  }
  const binding = bindings[0] as RoleBinding;
  if (
    binding.policyId !== PLATFORM_SAFETY_POLICY_ID
    || binding.policyVersionId !== PLATFORM_SAFETY_POLICY_VERSION_ID
    || binding.policyVersion !== PLATFORM_SAFETY_POLICY_VERSION
  ) {
    throw safetyError(409, 'platform_safety_role_policy_mismatch');
  }
  const [circle, policy, policyVersion, memberships] = await Promise.all([
    prisma.circle.findUnique({
      where: { id: binding.circleId },
      select: { id: true, kind: true, mode: true, circleType: true },
    }),
    prisma.governancePolicy.findUnique({
      where: { id: binding.policyId },
    }),
    prisma.governancePolicyVersion.findUnique({
      where: { id: binding.policyVersionId },
    }),
    prisma.circleMember.findMany({
      where: { circleId: binding.circleId, status: 'Active' },
      include: { user: { select: { pubkey: true } } },
      orderBy: { userId: 'asc' },
    }),
  ]);
  if (
    !circle
    || circle.kind !== 'auxiliary'
    || circle.mode !== 'governance'
    || circle.circleType !== 'Secret'
  ) {
    throw safetyError(409, 'platform_safety_role_circle_invalid');
  }
  if (
    !policy
    || policy.scopeType !== 'platform_safety_system'
    || policy.scopeRef !== PLATFORM_SAFETY_ENVIRONMENT
    || policy.status !== 'active'
    || policy.activeVersion !== PLATFORM_SAFETY_POLICY_VERSION
    || !policyVersion
    || policyVersion.policyId !== policy.id
    || policyVersion.status !== 'active'
    || policyVersion.configDigest !== PLATFORM_SAFETY_POLICY_DIGEST
    || !isDeepStrictEqual(policyVersion.rules, PLATFORM_SAFETY_POLICY_RULES)
  ) {
    throw safetyError(409, 'platform_safety_policy_drift');
  }
  const actorPubkeys = memberships
    .map((membership: any) => canonicalSolanaPublicKeyString(membership.user?.pubkey))
    .filter((value: string | null): value is string => !!value)
    .sort();
  if (actorPubkeys.length === 0 || new Set(actorPubkeys).size !== actorPubkeys.length) {
    throw safetyError(409, 'platform_safety_role_actor_set_invalid');
  }
  return { binding, policy, policyVersion, circle, actorPubkeys };
}

async function resolvePlatformSafetyActorRoles(
  prisma: any,
  actorPubkey: string,
): Promise<PlatformSafetyRoleKey[]> {
  const results = await Promise.all(PLATFORM_SAFETY_ROLE_KEYS.map(async (roleKey) => {
    try {
      const resolved = await resolvePlatformSafetyRole(prisma, roleKey);
      return resolved.actorPubkeys.includes(actorPubkey) ? roleKey : null;
    } catch (error) {
      if (
        error instanceof PlatformSafetyError
        && error.code === 'platform_safety_role_binding_required'
      ) {
        return null;
      }
      throw error;
    }
  }));
  return results.filter((value): value is PlatformSafetyRoleKey => value !== null);
}

export function assertActorInRole(
  role: PlatformSafetyRoleResolution,
  actorPubkey: string,
): void {
  if (!role.actorPubkeys.includes(actorPubkey)) {
    throw safetyError(403, 'platform_safety_role_actor_required');
  }
}

export function assertIndependentRoleSeparation(
  responder: PlatformSafetyRoleResolution,
  independent: PlatformSafetyRoleResolution,
): void {
  if (
    responder.binding.circleId === independent.binding.circleId
    || responder.actorPubkeys.some((actor) => independent.actorPubkeys.includes(actor))
  ) {
    throw safetyError(409, 'platform_safety_independent_role_required');
  }
}

function assertPolicyAdminDualControlAvailable(
  policyAdmin: PlatformSafetyRoleResolution,
  proposerPubkey: string,
): void {
  if (policyAdmin.actorPubkeys.filter((actor) => actor !== proposerPubkey).length === 0) {
    throw safetyError(409, 'platform_safety_authority_independent_policy_admin_required');
  }
}

async function resolveAllPlatformSafetyRoles(
  prisma: any,
): Promise<Record<PlatformSafetyRoleKey, PlatformSafetyRoleResolution>> {
  const entries = await Promise.all(PLATFORM_SAFETY_ROLE_KEYS.map(async (roleKey) => [
    roleKey,
    await resolvePlatformSafetyRole(prisma, roleKey),
  ] as const));
  return Object.fromEntries(entries) as Record<
    PlatformSafetyRoleKey,
    PlatformSafetyRoleResolution
  >;
}

async function resolvePlatformSafetyCandidateCircle(
  prisma: any,
  circleId: number,
): Promise<{ circle: any; actorPubkeys: string[] }> {
  const [circle, memberships] = await Promise.all([
    prisma.circle.findUnique({
      where: { id: circleId },
      select: { id: true, kind: true, mode: true, circleType: true },
    }),
    prisma.circleMember.findMany({
      where: { circleId, status: 'Active' },
      include: { user: { select: { pubkey: true } } },
      orderBy: { userId: 'asc' },
    }),
  ]);
  if (
    !circle
    || circle.kind !== 'auxiliary'
    || circle.mode !== 'governance'
    || circle.circleType !== 'Secret'
  ) {
    throw safetyError(409, 'platform_safety_authority_target_circle_invalid');
  }
  const actorPubkeys = memberships
    .map((membership: any) => canonicalSolanaPublicKeyString(membership.user?.pubkey))
    .filter((value: string | null): value is string => !!value)
    .sort();
  if (actorPubkeys.length === 0 || new Set(actorPubkeys).size !== actorPubkeys.length) {
    throw safetyError(409, 'platform_safety_authority_target_actor_set_invalid');
  }
  return { circle, actorPubkeys };
}

function assertCandidateRoleSeparation(input: {
  targetRoleKey: PlatformSafetyRoleKey;
  candidate: { circle: any; actorPubkeys: string[] };
  currentRoles: Record<PlatformSafetyRoleKey, PlatformSafetyRoleResolution>;
  proposerPubkey: string;
  approverPubkey: string | null;
  excludedActorPubkeys: string[];
}): void {
  const candidateActors = new Set(input.candidate.actorPubkeys);
  const blockedActors = [
    input.proposerPubkey,
    input.approverPubkey,
    ...input.excludedActorPubkeys,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (blockedActors.some((actor) => candidateActors.has(actor))) {
    throw safetyError(409, 'platform_safety_authority_conflicted_actor_set');
  }
  for (const roleKey of PLATFORM_SAFETY_ROLE_KEYS) {
    if (roleKey === input.targetRoleKey) continue;
    const role = input.currentRoles[roleKey];
    if (
      role.binding.circleId === input.candidate.circle.id
      || role.actorPubkeys.some((actor) => candidateActors.has(actor))
    ) {
      throw safetyError(409, 'platform_safety_authority_role_sets_must_remain_disjoint');
    }
  }
}

async function executePlatformSafetyPolicyAdminOperation<T>(
  tx: any,
  input: {
    home: { id: string; homeType: string; homeRef: string };
    policyAdmin: PlatformSafetyRoleResolution;
    actorPubkey: string;
    actionType: string;
    targetRoleKey: PlatformSafetyRoleKey;
    targetRef: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    idempotencyKey: string;
    now: Date;
    executionRef: string;
    result: T;
    executeBeforeResult?: () => Promise<void>;
  },
) {
  return executePlatformSafetyRoleOperation(tx, {
    home: input.home,
    role: input.policyAdmin,
    actorPubkey: input.actorPubkey,
    expectedRoleKey: PLATFORM_SAFETY_POLICY_ADMIN_ROLE,
    actionType: input.actionType,
    targetType: 'system_governance_role_binding',
    targetRef: input.targetRef,
    payload: input.payload,
    reasonCode: input.reasonCode,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
    executionRef: input.executionRef,
    result: input.result,
    executeBeforeResult: input.executeBeforeResult,
    authorityExtraSelector: {
      targetRoleKey: input.targetRoleKey,
    },
    platformSafetyPolicyLimits: {
      policyAdminBindingId: input.policyAdmin.binding.id,
      dualControlRequired: true,
      selfAuthorizationForbidden: true,
    },
  });
}

async function executePlatformSafetyRoleOperation<T>(
  tx: any,
  input: {
    home: { id: string; homeType: string; homeRef: string };
    role: PlatformSafetyRoleResolution;
    actorPubkey: string;
    expectedRoleKey: PlatformSafetyRoleKey;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    idempotencyKey: string;
    now: Date;
    executionRef: string;
    result: T;
    executeBeforeResult?: () => Promise<void>;
    authorityExtraSelector?: Record<string, unknown>;
    platformSafetyPolicyLimits?: Record<string, unknown>;
  },
) {
  const actorSetDigest = roleActorSetDigest(input.role.actorPubkeys);
  const runtimeBinding: GovernedActionGatewayRuntimeBinding = {
    id: input.role.binding.id,
    policyId: input.role.binding.policyId,
    policyVersionId: input.role.binding.policyVersionId,
    policyVersion: input.role.binding.policyVersion,
    ruleId: input.actionType.replaceAll('.', '_'),
    committeeCircleId: input.role.binding.circleId,
    authoritySourceType: 'system_governance_role_binding',
    authoritySourceRef: input.role.binding.id,
    authoritySourceVersion:
      `${input.role.binding.policyVersionId}:${input.role.binding.roleKey}`,
    authorityPurpose: 'operational_execution',
    authoritySelector: {
      actorPubkey: input.actorPubkey,
      roleKey: input.expectedRoleKey,
      subjectType: input.targetType,
      subjectRef: input.targetRef,
      actorSetDigest,
      environment: 'local_development',
      network: 'solana:localnet',
      ...(input.authorityExtraSelector ?? {}),
    },
    authorityLimits: {
      platformSafetyPolicy: {
        id: PLATFORM_SAFETY_POLICY_ID,
        versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
        digest: PLATFORM_SAFETY_POLICY_DIGEST,
        jurisdiction: 'US',
        minimumAge: 18,
        roleBindingId: input.role.binding.id,
        roleKey: input.expectedRoleKey,
        actorSetDigest,
        ...(input.platformSafetyPolicyLimits ?? {}),
      },
      executionAuthority: {
        type: 'registered_adapter',
        ref: 'platform_safety',
      },
      riskFloor: 'high',
    },
  };
  const registry = createGovernedActionRegistry({
    includePlatformSafetyActions: true,
  });
  const definition = registry.get(input.actionType);
  if (!definition) {
    throw safetyError(500, 'platform_safety_authority_contract_missing');
  }
  const runtime = await resolveGovernedSystemRoleOperationRuntime({
    prisma: tx,
    transactionClient: true,
  }, {
    definition,
    home: input.home,
    binding: runtimeBinding,
    actorPubkey: input.actorPubkey,
    targetType: input.targetType,
    targetRef: input.targetRef,
    payload: input.payload,
    reasonCode: input.reasonCode,
    expectedRoleKey: input.expectedRoleKey,
    now: input.now,
  });
  const gateway = new GovernedActionGateway({
    registry,
    resolveBinding: async () => null,
    listCommitteeEligibleActors: async () => [],
    requestStore: createPrismaGovernanceRequestStore(tx),
    runtimePrisma: tx,
    runtimeTransactionClient: true,
    now: () => input.now,
  });
  return gateway.executeSystemRoleOperation({
    actionType: input.actionType,
    targetCircleId: input.role.binding.circleId,
    targetType: input.targetType,
    targetRef: input.targetRef,
    actorPubkey: input.actorPubkey,
    payload: input.payload,
    reasonCode: input.reasonCode,
    idempotencyKey: input.idempotencyKey,
    runtime,
    execute: async () => {
      await input.executeBeforeResult?.();
      return {
        result: input.result,
        executionRef: input.executionRef,
      };
    },
  });
}

async function findReplayedAuthorityApproval(
  tx: any,
  input: {
    actorPubkey: string;
    targetRoleKey: PlatformSafetyRoleKey;
    idempotencyKey: string;
  },
) {
  const existing = await tx.governedActionInvocation.findFirst({
    where: {
      actorPubkey: input.actorPubkey,
      subjectType: 'system_governance_role_binding',
      subjectRef: input.targetRoleKey,
      idempotencyKey: input.idempotencyKey,
      contractVersion: {
        actionType: PLATFORM_SAFETY_AUTHORITY_CHANGE_APPROVE_ACTION_TYPE,
      },
    },
    include: {
      operationReceipts: { orderBy: { completedAt: 'desc' }, take: 1 },
    },
    orderBy: { activatedAt: 'desc' },
  });
  const receipt = existing?.operationReceipts?.[0];
  if (!receipt) return null;
  const binding = await resolvePlatformSafetyRole(tx, input.targetRoleKey);
  return {
    replayed: true,
    receipt,
    binding: projectRoleBinding(binding.binding),
    approval: {
      proposalReceiptId: record(existing.requestedEffect).proposalReceiptId ?? null,
      targetRoleKey: input.targetRoleKey,
      previousBindingId: record(existing.requestedEffect).previousBindingId ?? null,
      bindingId: binding.binding.id,
      effectiveAt: date(receipt.completedAt).toISOString(),
    },
  };
}

function normalizeActorList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source
    .map((item) => canonicalSolanaPublicKeyString(String(item || '').trim()))
    .filter((item): item is string => !!item))]
    .sort();
}

function roleActorSetDigest(actorPubkeys: string[]): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-role-actors',
    [...actorPubkeys].sort(),
  );
}

async function linkPlatformSafetyQuarantineInTransaction(
  tx: any,
  input: {
    postId: number;
    contentId: string;
    receiptId: string;
    invocationId: string;
    incidentRef: string;
    replayed: boolean;
  },
) {
  const effect = await tx.operationEffect.findUnique({
    where: { invocationId: input.invocationId },
    include: {
      invocation: true,
      initialReceipt: true,
      events: { orderBy: { sequence: 'asc' } },
    },
  });
  if (
    !effect
    || effect.state !== 'active'
    || effect.initialReceiptId !== input.receiptId
    || effect.invocation?.contractVersionId == null
  ) {
    throw safetyError(409, 'platform_safety_quarantine_effect_missing');
  }
  const updated = await tx.post.updateMany({
    where: {
      id: input.postId,
      contentId: input.contentId,
      safetyQuarantined: true,
      safetyQuarantineIncidentRef: input.incidentRef,
      ...(input.replayed
        ? {
            safetyQuarantineOperationReceiptId: input.receiptId,
            safetyQuarantineOperationEffectId: effect.id,
          }
        : {
            safetyQuarantineOperationReceiptId: null,
            safetyQuarantineOperationEffectId: null,
          }),
    },
    data: {
      safetyQuarantineOperationReceiptId: input.receiptId,
      safetyQuarantineOperationEffectId: effect.id,
    },
  });
  if (updated.count !== 1) {
    throw safetyError(409, 'platform_safety_quarantine_link_cas_failed');
  }
  const durable = await tx.post.findUnique({
    where: { id: input.postId },
    include: {
      author: { select: { pubkey: true, handle: true } },
      safetyQuarantineOperationReceipt: {
        include: {
          appeals: {
            orderBy: { openedAt: 'desc' },
            take: 1,
            include: { resolutionReceipt: true },
          },
        },
      },
      safetyQuarantineOperationEffect: {
        include: {
          invocation: true,
          events: { orderBy: { sequence: 'asc' } },
        },
      },
    },
  });
  if (
    !durable
    || durable.safetyQuarantineOperationReceiptId !== input.receiptId
    || durable.safetyQuarantineOperationEffectId !== effect.id
  ) {
    throw safetyError(409, 'platform_safety_quarantine_readback_mismatch');
  }
  return durable;
}

async function restoreExpiredPlatformSafetyPostInTransaction(
  tx: any,
  post: any,
  now: Date,
) {
  const expiresAt = new Date(String(post.safetyQuarantineExpiresAt || ''));
  if (
    post.safetyQuarantined !== true
    || !Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() > now.getTime()
    || !post.safetyQuarantineOperationEffectId
  ) {
    throw safetyError(409, 'platform_safety_quarantine_not_expired');
  }
  const effect = await tx.operationEffect.findUnique({
    where: { id: post.safetyQuarantineOperationEffectId },
  });
  if (!effect) {
    throw safetyError(409, 'platform_safety_quarantine_effect_missing');
  }
  if (effect.state === 'active') {
    try {
      await transitionOperationEffectInTransaction(tx, {
        effectId: effect.id,
        nextState: 'expired',
        reasonCode: 'platform_safety_quarantine_expired',
        actorPubkey: null,
        sourceReceiptId: null,
        occurredAt: now,
      });
    } catch (error) {
      if (
        !(error instanceof Error)
        || error.message !== 'operation_effect_transition_cas_failed'
      ) {
        throw error;
      }
      const concurrent = await tx.operationEffect.findUnique({
        where: { id: effect.id },
      });
      if (!concurrent || !['expired', 'revoked'].includes(concurrent.state)) {
        throw error;
      }
    }
  } else if (!['expired', 'revoked'].includes(effect.state)) {
    throw safetyError(409, 'platform_safety_quarantine_effect_terminal_mismatch');
  }
  const cleared = await tx.post.updateMany({
    where: {
      id: post.id,
      safetyQuarantined: true,
      safetyQuarantineOperationEffectId: effect.id,
      safetyQuarantineExpiresAt: post.safetyQuarantineExpiresAt,
    },
    data: {
      safetyQuarantined: false,
      safetyQuarantinedAt: null,
      safetyQuarantineExpiresAt: null,
      safetyQuarantineReasonCode: null,
      safetyQuarantinePolicyRef: null,
      safetyQuarantineIncidentRef: null,
      safetyQuarantineEvidenceDigest: null,
      safetyQuarantineOriginalVisibility: null,
      safetyQuarantineOperationReceiptId: null,
      safetyQuarantineOperationEffectId: null,
    },
  });
  if (cleared.count !== 1) {
    const concurrent = await tx.post.findUnique({ where: { id: post.id } });
    if (concurrent?.safetyQuarantined !== false) {
      throw safetyError(409, 'platform_safety_quarantine_restore_cas_failed');
    }
  }
}

function projectRoleBinding(binding: RoleBinding) {
  return {
    id: binding.id,
    roleKey: binding.roleKey,
    circleId: binding.circleId,
    policyId: binding.policyId,
    policyVersionId: binding.policyVersionId,
    policyVersion: binding.policyVersion,
    status: binding.status,
  };
}

function projectPlatformSafetyIncident(post: any) {
  const effect = post.safetyQuarantineOperationEffect;
  const receipt = post.safetyQuarantineOperationReceipt;
  const invocation = effect?.invocation;
  const payload = record(invocation?.requestedEffect);
  if (
    post.safetyQuarantined !== true
    || !effect
    || !receipt
    || effect.id !== post.safetyQuarantineOperationEffectId
    || receipt.id !== post.safetyQuarantineOperationReceiptId
    || payload.contractVersion !== 'platform-safety-content-quarantine-current'
    || payload.incidentRef !== post.safetyQuarantineIncidentRef
  ) {
    throw safetyError(409, 'platform_safety_incident_readback_invalid');
  }
  return {
    incidentRef: post.safetyQuarantineIncidentRef,
    state: effect.state,
    contentId: post.contentId,
    circleId: post.circleId,
    category: payload.category,
    severity: payload.severity,
    activatedAt: date(post.safetyQuarantinedAt).toISOString(),
    expiresAt: date(post.safetyQuarantineExpiresAt).toISOString(),
    reasonCode: post.safetyQuarantineReasonCode,
    policyRef: post.safetyQuarantinePolicyRef,
    policyDigest: record(payload.policy).digest ?? null,
    subjectSnapshotDigest: payload.subjectSnapshotDigest,
    evidenceDigest: post.safetyQuarantineEvidenceDigest,
    receiptId: receipt.id,
    receiptDigest: receipt.receiptDigest,
    effectId: effect.id,
    appealRef: receipt.appealRef,
    appealWindowEndsAt: receipt.appealWindowEndsAt
      ? date(receipt.appealWindowEndsAt).toISOString()
      : null,
    appeal: Array.isArray(receipt.appeals) && receipt.appeals[0]
      ? {
          id: receipt.appeals[0].id,
          state: receipt.appeals[0].state,
          appellantPubkey: receipt.appeals[0].appellantPubkey,
          resolutionPath: receipt.appeals[0].resolutionPath,
          openedAt: date(receipt.appeals[0].openedAt).toISOString(),
          resolution: receipt.appeals[0].resolutionReceipt
            ? {
                outcome: receipt.appeals[0].resolutionReceipt.outcome,
                reviewerPubkey:
                  receipt.appeals[0].resolutionReceipt.reviewerPubkey,
                resolvedAt: date(
                  receipt.appeals[0].resolutionReceipt.resolvedAt,
                ).toISOString(),
              }
            : null,
        }
      : null,
    afterActionReviewRequired: payload.afterActionReviewRequired === true,
    publicProjection: 'not_found_while_active',
    legalDisposition: false,
    events: Array.isArray(effect.events)
      ? effect.events.map((event: any) => ({
          sequence: event.sequence,
          fromState: event.fromState,
          toState: event.toState,
          reasonCode: event.reasonCode,
          occurredAt: date(event.occurredAt).toISOString(),
        }))
      : [],
  };
}

async function readPlatformSafetyLegalStatusInTransaction(
  prisma: any,
  contentId: string,
) {
  const effect = await prisma.operationEffect.findFirst({
    where: {
      state: 'active',
      invocation: {
        subjectType: 'feed_post',
        subjectRef: contentId,
        contractVersion: {
          actionType: PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE,
        },
      },
    },
    include: {
      invocation: true,
      initialReceipt: true,
    },
    orderBy: [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ],
  });
  return effect ? projectPlatformSafetyLegalStatus(effect) : null;
}

function projectPlatformSafetyLegalStatus(effect: any) {
  const invocation = effect?.invocation;
  const receipt = effect?.initialReceipt;
  const payload = record(invocation?.requestedEffect);
  const legalSafeProjection = record(payload.legalSafeProjection);
  const appealAuthority = record(payload.appealAuthority);
  const policy = record(payload.policy);
  if (
    !effect
    || !invocation
    || !receipt
    || effect.initialReceiptId !== receipt.id
    || invocation.contractVersionId == null
    || payload.contractVersion !== 'platform-safety-legal-status-append-v1'
    || invocation.subjectType !== 'feed_post'
    || invocation.subjectRef !== payload.contentId
    || !PLATFORM_SAFETY_LEGAL_STATUS_VALUES.includes(payload.status)
    || policy.versionId !== PLATFORM_SAFETY_POLICY_VERSION_ID
    || policy.digest !== PLATFORM_SAFETY_POLICY_DIGEST
  ) {
    throw safetyError(409, 'platform_safety_legal_status_readback_invalid');
  }
  const legalStatusDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-legal-status',
    {
      contentId: payload.contentId,
      status: payload.status,
      jurisdiction: payload.jurisdiction,
      authorityDigest: payload.authorityDigest,
      publicTombstoneDigest: payload.publicTombstoneDigest,
      redactedSummaryDigest: payload.redactedSummaryDigest,
      lifecyclePlanDigest: payload.lifecyclePlanDigest,
      previousLegalStatusDigest: payload.previousLegalStatusDigest ?? null,
      receiptId: receipt.id,
      effectId: effect.id,
    },
  );
  return {
    contentId: String(payload.contentId),
    circleId: Number(payload.circleId),
    status: payload.status as (typeof PLATFORM_SAFETY_LEGAL_STATUS_VALUES)[number],
    state: effect.state,
    jurisdiction: payload.jurisdiction,
    receiptId: receipt.id,
    receiptDigest: receipt.receiptDigest,
    effectId: effect.id,
    effectDigest: effect.effectDigest,
    legalStatusDigest,
    previousLegalStatusDigest: payload.previousLegalStatusDigest ?? null,
    authorityDigest: payload.authorityDigest,
    publicTombstoneDigest: payload.publicTombstoneDigest,
    redactedSummaryDigest: payload.redactedSummaryDigest,
    lifecyclePlanDigest: payload.lifecyclePlanDigest,
    legalSafeProjection: {
      ordinaryRead: legalSafeProjection.ordinaryRead,
      listRead: legalSafeProjection.listRead,
      originalMaterialExport: legalSafeProjection.originalMaterialExport === true,
      circleGovernanceMayRestoreOriginal:
        legalSafeProjection.circleGovernanceMayRestoreOriginal === true,
    },
    noticeRequired: payload.noticeRequired === true,
    appealWindowSeconds: Number(payload.appealWindowSeconds ?? 0),
    appealWindowEndsAt: receipt.appealWindowEndsAt
      ? date(receipt.appealWindowEndsAt).toISOString()
      : null,
    appealAuthority: {
      roleBindingId: String(appealAuthority.roleBindingId || ''),
      roleKey: appealAuthority.roleKey,
    },
    historicalDecisionMutation: payload.historicalDecisionMutation === true,
    originalQuarantineReceiptId: payload.originalQuarantineReceiptId ?? null,
    originalQuarantineEffectId: payload.originalQuarantineEffectId ?? null,
    appendedAt: date(payload.appendedAt).toISOString(),
    reasonCode: payload.reasonCode,
    publicExport: false,
    aiExport: false,
    knowledgeExport: false,
  };
}

function projectPlatformSafetyBreakGlassAccess(effect: any) {
  const invocation = effect?.invocation;
  const receipt = effect?.initialReceipt;
  const payload = record(invocation?.requestedEffect);
  const request = record(payload.request);
  const approval = record(payload.approval);
  const access = record(payload.access);
  const alerts = record(payload.alerts);
  const afterActionReview = record(payload.afterActionReview);
  const policy = record(payload.policy);
  if (
    !effect
    || !invocation
    || !receipt
    || effect.initialReceiptId !== receipt.id
    || invocation.contractVersionId == null
    || invocation.subjectType !== 'platform_safety_evidence'
    || payload.contractVersion !== 'platform-safety-evidence-break-glass-read-v1'
    || invocation.subjectRef !== payload.evidenceReceiptId
    || policy.versionId !== PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID
    || policy.digest !== PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST
    || access.originalMaterialExport !== false
    || access.rawEvidenceIncludedInReceipt !== false
  ) {
    throw safetyError(409, 'platform_safety_break_glass_readback_invalid');
  }
  return {
    id: effect.id,
    state: effect.state,
    receiptId: receipt.id,
    receiptDigest: receipt.receiptDigest,
    evidenceReceiptId: String(payload.evidenceReceiptId),
    evidenceEffectId: String(payload.evidenceEffectId),
    evidenceSubjectType: String(payload.evidenceSubjectType),
    evidenceSubjectRef: String(payload.evidenceSubjectRef),
    evidenceSourceDigest: String(payload.evidenceSourceDigest),
    safetyIncidentId: String(payload.safetyIncidentId),
    requesterPubkey: String(request.requesterPubkey),
    approverPubkey: String(approval.approverPubkey),
    purposeCode: String(request.purposeCode),
    accessJustificationDigest: String(request.accessJustificationDigest),
    requestedAt: date(request.requestedAt).toISOString(),
    approvedAt: date(approval.approvedAt).toISOString(),
    actualAccessRecordedAt: date(access.actualAccessRecordedAt).toISOString(),
    expiresAt: date(access.expiresAt).toISOString(),
    durationSeconds: Number(access.durationSeconds),
    ordinaryOperatorPermission: approval.ordinaryOperatorPermission === true
      ? true
      : false,
    originalMaterialExport: access.originalMaterialExport === true,
    rawEvidenceIncludedInReceipt: access.rawEvidenceIncludedInReceipt === true,
    searchableAuditOnly: access.searchableAuditOnly === true,
    alertRequired: alerts.required === true,
    alertRecipients: Array.isArray(alerts.recipients)
      ? alerts.recipients.map((value: unknown) => String(value))
      : [],
    afterActionReviewRequired: afterActionReview.required === true,
    incidentReviewRequired: afterActionReview.incidentReviewRequired === true,
    events: Array.isArray(effect.events)
      ? effect.events.map((event: any) => ({
          sequence: event.sequence,
          fromState: event.fromState,
          toState: event.toState,
          reasonCode: event.reasonCode,
          occurredAt: date(event.occurredAt).toISOString(),
        }))
      : [],
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  if (!Number.isFinite(parsed.getTime())) {
    throw safetyError(409, 'platform_safety_date_invalid');
  }
  return parsed;
}
