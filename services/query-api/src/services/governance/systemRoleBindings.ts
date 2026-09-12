import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  createGovernanceProfileTransition,
  EXTERNAL_APP_SYSTEM_GOVERNANCE_PROFILE_V1,
  type GovernanceProfileDefinition,
} from './governanceProfile';

export const EXTERNAL_APP_REVIEW_PRIMARY_ROLE = "external_app_review_primary";
export const EXTERNAL_APP_RISK_EMERGENCY_ROLE = "external_app_risk_emergency";
export const EXTERNAL_APP_APPEAL_ROLE = "external_app_appeal";
export const EXTERNAL_APP_PARAMETER_GOVERNANCE_ROLE =
  "external_app_parameter_governance";

export const EXTERNAL_APP_GOVERNANCE_ROLE_KEYS = [
  EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  EXTERNAL_APP_RISK_EMERGENCY_ROLE,
  EXTERNAL_APP_APPEAL_ROLE,
  EXTERNAL_APP_PARAMETER_GOVERNANCE_ROLE,
] as const;

export type ExternalAppGovernanceRoleKey =
  (typeof EXTERNAL_APP_GOVERNANCE_ROLE_KEYS)[number];

export type SystemGovernanceDomain = "external_app";
export type SystemGovernanceEnvironment = "sandbox" | "production";

export interface ReviewCircleLike {
  id: number;
  kind?: string | null;
  mode?: string | null;
  circleType?: string | null;
}

interface BindingLike {
  id: string;
  domain: SystemGovernanceDomain;
  roleKey: ExternalAppGovernanceRoleKey;
  environment: SystemGovernanceEnvironment;
  circleId: number;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  status: string;
  activatedAt: Date;
  supersededAt?: Date | null;
  createdByPubkey?: string | null;
  sourceRequestId?: string | null;
  sourceDecisionDigest?: string | null;
  sourceExecutionReceiptId?: string | null;
  metadata?: unknown;
}

interface PolicyLike {
  id: string;
  scopeType: string;
  scopeRef: string;
  status: string;
}

interface PolicyVersionLike {
  id: string;
  policyId: string;
  version: number;
  status: string;
}

interface SystemGovernanceRoleResolution {
  binding: BindingLike;
  circle: ReviewCircleLike;
  policy: PolicyLike;
  policyVersion: PolicyVersionLike;
}

export interface SystemGovernanceRoleBindingPrisma {
  systemGovernanceRoleBinding: {
    findMany(input: unknown): Promise<unknown[]>;
  };
  circle: {
    findUnique(input: unknown): Promise<unknown | null>;
  };
  governancePolicy: {
    findFirst(input: unknown): Promise<unknown | null>;
  };
  governancePolicyVersion: {
    findFirst(input: unknown): Promise<unknown | null>;
  };
}

export interface SystemGovernanceRoleBindingUpdatePrisma
  extends SystemGovernanceRoleBindingPrisma {
  $transaction<T>(operation: (tx: SystemGovernanceRoleBindingUpdateTransaction) => Promise<T>): Promise<T>;
}

export interface SystemGovernanceRoleBindingUpdateTransaction {
  systemGovernanceRoleBinding: {
    update(input: unknown): Promise<unknown>;
    create(input: unknown): Promise<unknown>;
  };
}

export interface ExternalAppGovernanceRoleBootstrapBinding {
  roleKey: ExternalAppGovernanceRoleKey;
  circleId: number;
  policyId: string;
  policyVersionId: string;
}

export function assertReviewCircleShape(circle: ReviewCircleLike): void {
  if (
    circle.kind !== "auxiliary" ||
    circle.mode !== "governance" ||
    circle.circleType !== "Secret"
  ) {
    throw new Error("external_app_review_circle_requires_governance_circle");
  }
}

export function normalizeExternalAppGovernanceRoleKey(
  value: unknown,
): ExternalAppGovernanceRoleKey {
  const normalized = String(value || EXTERNAL_APP_REVIEW_PRIMARY_ROLE)
    .trim()
    .toLowerCase();
  if (
    !EXTERNAL_APP_GOVERNANCE_ROLE_KEYS.includes(
      normalized as ExternalAppGovernanceRoleKey,
    )
  ) {
    throw new Error("invalid_external_app_governance_role_key");
  }
  return normalized as ExternalAppGovernanceRoleKey;
}

export function assertUniqueActiveSystemGovernanceRoleBindings(
  bindings: Array<Pick<BindingLike, "domain" | "roleKey" | "environment">>,
): void {
  const seen = new Set<string>();
  for (const binding of bindings) {
    const key = `${binding.domain}:${binding.roleKey}:${binding.environment}`;
    if (seen.has(key)) {
      throw new Error("system_governance_role_binding_ambiguous");
    }
    seen.add(key);
  }
}

export async function resolveActiveSystemGovernanceRole(
  prisma: SystemGovernanceRoleBindingPrisma,
  input: {
    domain: SystemGovernanceDomain;
    roleKey: ExternalAppGovernanceRoleKey;
    environment: SystemGovernanceEnvironment;
  },
): Promise<SystemGovernanceRoleResolution> {
  const bindings = (await prisma.systemGovernanceRoleBinding.findMany({
    where: {
      domain: input.domain,
      roleKey: input.roleKey,
      environment: input.environment,
      status: "active",
    },
    orderBy: { activatedAt: "desc" },
    take: 2,
  })) as BindingLike[];
  assertUniqueActiveSystemGovernanceRoleBindings(bindings);
  const binding = bindings[0] ?? null;
  if (
    !binding
    || binding.status !== "active"
    || binding.domain !== input.domain
    || binding.roleKey !== input.roleKey
    || binding.environment !== input.environment
  ) {
    throw new Error("system_governance_role_binding_not_found");
  }

  const circle = (await prisma.circle.findUnique({
    where: { id: binding.circleId },
    select: { id: true, kind: true, mode: true, circleType: true },
  })) as ReviewCircleLike | null;
  if (!circle) {
    throw new Error("system_governance_role_circle_not_found");
  }
  assertReviewCircleShape(circle);

  const policy = (await prisma.governancePolicy.findFirst({
    where: {
      id: binding.policyId,
      scopeType: "external_app_review_circle",
      scopeRef: String(binding.circleId),
      status: "active",
    },
    select: { id: true, scopeType: true, scopeRef: true, status: true },
  })) as PolicyLike | null;
  if (
    !policy ||
    policy.status !== "active" ||
    policy.scopeType !== "external_app_review_circle" ||
    policy.scopeRef !== String(binding.circleId)
  ) {
    throw new Error("system_governance_role_policy_not_found");
  }

  const policyVersion = (await prisma.governancePolicyVersion.findFirst({
    where: {
      id: binding.policyVersionId,
      policyId: binding.policyId,
      version: binding.policyVersion,
      status: "active",
    },
    select: { id: true, policyId: true, version: true, status: true },
  })) as PolicyVersionLike | null;
  if (
    !policyVersion ||
    policyVersion.status !== "active" ||
    policyVersion.policyId !== binding.policyId ||
    policyVersion.version !== binding.policyVersion
  ) {
    throw new Error("system_governance_role_policy_version_not_found");
  }

  return { binding, circle, policy, policyVersion };
}

export async function bootstrapExternalAppSystemGovernanceRoleBindings(
  prisma: any,
  input: {
    environment: SystemGovernanceEnvironment;
    bindings: ExternalAppGovernanceRoleBootstrapBinding[];
    createdByPubkey?: string | null;
    now?: Date;
  },
): Promise<Array<{ action: "created" | "unchanged"; binding: BindingLike }>> {
  if (input.environment !== "sandbox") {
    throw new Error("external_app_governance_role_bootstrap_sandbox_only");
  }
  if (!Array.isArray(input.bindings) || input.bindings.length !== EXTERNAL_APP_GOVERNANCE_ROLE_KEYS.length) {
    throw new Error("external_app_governance_role_bindings_complete_set_required");
  }
  const byRole = new Map<ExternalAppGovernanceRoleKey, ExternalAppGovernanceRoleBootstrapBinding>();
  for (const candidate of input.bindings) {
    const roleKey = normalizeExternalAppGovernanceRoleKey(candidate?.roleKey);
    if (byRole.has(roleKey)) {
      throw new Error("external_app_governance_role_binding_duplicate_role");
    }
    if (!Number.isSafeInteger(candidate?.circleId) || candidate.circleId <= 0) {
      throw new Error("external_app_governance_role_binding_circle_required");
    }
    if (!String(candidate?.policyId ?? "").trim() || !String(candidate?.policyVersionId ?? "").trim()) {
      throw new Error("external_app_governance_role_binding_policy_required");
    }
    byRole.set(roleKey, {
      roleKey,
      circleId: candidate.circleId,
      policyId: candidate.policyId.trim(),
      policyVersionId: candidate.policyVersionId.trim(),
    });
  }
  if (EXTERNAL_APP_GOVERNANCE_ROLE_KEYS.some((roleKey) => !byRole.has(roleKey))) {
    throw new Error("external_app_governance_role_bindings_complete_set_required");
  }

  const activatedAt = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const results: Array<{ action: "created" | "unchanged"; binding: BindingLike }> = [];
    for (const roleKey of EXTERNAL_APP_GOVERNANCE_ROLE_KEYS) {
      const candidate = byRole.get(roleKey)!;
      const target = await assertTargetSystemGovernanceRoleBinding(tx, {
        circleId: candidate.circleId,
        policyId: candidate.policyId,
        policyVersionId: candidate.policyVersionId,
      });
      const existing = (await tx.systemGovernanceRoleBinding.findMany({
        where: {
          domain: "external_app",
          roleKey,
          environment: input.environment,
          status: "active",
        },
        orderBy: { activatedAt: "desc" },
        take: 2,
      })) as BindingLike[];
      assertUniqueActiveSystemGovernanceRoleBindings(existing);
      if (existing[0]) {
        const current = existing[0];
        if (
          current.circleId !== candidate.circleId
          || current.policyId !== candidate.policyId
          || current.policyVersionId !== candidate.policyVersionId
          || current.policyVersion !== target.policyVersion.version
        ) {
          throw new Error("external_app_governance_role_binding_already_exists");
        }
        results.push({ action: "unchanged", binding: current });
        continue;
      }
      const id = `external_app:${roleKey}:${input.environment}:bootstrap`;
      const historical = await tx.systemGovernanceRoleBinding.findUnique({ where: { id } });
      if (historical) {
        throw new Error("external_app_governance_role_binding_bootstrap_history_exists");
      }
      const binding = await tx.systemGovernanceRoleBinding.create({
        data: {
          id,
          domain: "external_app",
          roleKey,
          environment: input.environment,
          circleId: candidate.circleId,
          policyId: candidate.policyId,
          policyVersionId: candidate.policyVersionId,
          policyVersion: target.policyVersion.version,
          status: "active",
          activatedAt,
          createdByPubkey: input.createdByPubkey ?? null,
          metadata: {
            source: "bootstrap-external-app-governance-role-bindings",
            provenanceStatus: "bootstrap_bypass_current",
          },
        },
      }) as BindingLike;
      results.push({ action: "created", binding });
    }
    return results;
  });
}

export function buildSystemGovernanceRoleBindingSnapshot(
  resolved: SystemGovernanceRoleResolution,
) {
  return {
    domain: resolved.binding.domain,
    roleKey: resolved.binding.roleKey,
    environment: resolved.binding.environment,
    binding: {
      id: resolved.binding.id,
      status: resolved.binding.status,
      circleId: resolved.binding.circleId,
      policyId: resolved.binding.policyId,
      policyVersionId: resolved.binding.policyVersionId,
      policyVersion: resolved.binding.policyVersion,
      activatedAt: resolved.binding.activatedAt.toISOString(),
      supersededAt: resolved.binding.supersededAt
        ? resolved.binding.supersededAt.toISOString()
        : null,
      createdByPubkey: resolved.binding.createdByPubkey ?? null,
    },
    circle: {
      id: resolved.circle.id,
      kind: resolved.circle.kind ?? null,
      mode: resolved.circle.mode ?? null,
      circleType: resolved.circle.circleType ?? null,
    },
    policy: {
      id: resolved.policy.id,
      scopeType: resolved.policy.scopeType,
      scopeRef: resolved.policy.scopeRef,
      status: resolved.policy.status,
    },
    policyVersion: {
      id: resolved.policyVersion.id,
      policyId: resolved.policyVersion.policyId,
      version: resolved.policyVersion.version,
      status: resolved.policyVersion.status,
    },
    source: {
      requestId: resolved.binding.sourceRequestId ?? null,
      decisionDigest: resolved.binding.sourceDecisionDigest ?? null,
      executionReceiptId: resolved.binding.sourceExecutionReceiptId ?? null,
    },
    metadata: resolved.binding.metadata ?? null,
  };
}

export async function assertActiveExternalAppReviewBinding(
  prisma: SystemGovernanceRoleBindingPrisma,
  input: {
    roleKey?: ExternalAppGovernanceRoleKey;
    environment: SystemGovernanceEnvironment;
    circleId?: number;
    policyId?: string;
    policyVersionId?: string;
    policyVersion?: number;
  },
) {
  const resolved = await resolveActiveSystemGovernanceRole(prisma, {
    domain: "external_app",
    roleKey: input.roleKey ?? EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
    environment: input.environment,
  });

  if (
    (input.circleId !== undefined && input.circleId !== resolved.binding.circleId) ||
    (input.policyId !== undefined && input.policyId !== resolved.binding.policyId) ||
    (input.policyVersionId !== undefined &&
      input.policyVersionId !== resolved.binding.policyVersionId) ||
    (input.policyVersion !== undefined &&
      input.policyVersion !== resolved.binding.policyVersion)
  ) {
    throw new Error("external_app_review_binding_mismatch");
  }

  return resolved;
}

export async function ensureExternalAppSystemGovernanceHome(
  prisma: any,
  input: { environment: SystemGovernanceEnvironment; now?: Date },
): Promise<{ home: any; profileBinding: any }> {
  return ensureBuiltinSystemGovernanceHome(prisma, {
    homeType: 'external_app_system_role',
    homeRef: `external_app:${input.environment}`,
    profile: EXTERNAL_APP_SYSTEM_GOVERNANCE_PROFILE_V1,
    reasonCode: 'external_app_system_domain_initial_profile',
    actionPattern: 'external_app.*',
    adapter: 'external_app',
    errorPrefix: 'external_app_system_governance',
    now: input.now,
  });
}

export async function ensureBuiltinSystemGovernanceHome(
  prisma: any,
  input: {
    homeType: string;
    homeRef: string;
    profile: GovernanceProfileDefinition;
    reasonCode: string;
    actionPattern: string;
    adapter: string;
    errorPrefix: string;
    now?: Date;
  },
): Promise<{ home: any; profileBinding: any }> {
  const now = input.now ?? new Date();
  const { homeType, homeRef, profile } = input;
  const identityFacts = {
    homeType,
    homeRef,
    identityVersion: 1,
    sourceType: 'alcheme_system_domain',
    sourceRef: homeRef,
    sourceVersion: '1',
  };
  const bindingDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.system-home-identity',
    identityFacts,
  );
  const homeId = `governance-home:${bindingDigest.slice(0, 56)}`;
  const definitionId = `profile-definition:${profile.definitionDigest.slice(0, 48)}`;
  const transition = createGovernanceProfileTransition({
    operation: 'bind',
    homeIdentityBindingId: homeId,
    currentProfileVersionRef: null,
    targetProfile: profile,
    reasonCode: input.reasonCode,
  });
  const compatibilityPreflight = {
    actionContracts: { [input.actionPattern]: 'ready' },
    authorities: { system_governance_role_binding: 'ready' },
    providers: { internal: 'ready' },
    adapters: { [input.adapter]: 'ready' },
    uiSchemas: { 'alcheme-governance-workspace-v1': 'ready' },
  };
  const compatibilityDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.profile-compatibility',
    compatibilityPreflight,
  );
  const migrationPreview = {
    fromProfileVersionRef: null,
    toProfileVersionRef: profile.versionRef,
  };
  const migrationPreviewDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.profile-migration-preview',
    migrationPreview,
  );
  const profileBindingId = `governance-profile-binding:${hashCanonicalGovernanceValue(
    'alcheme.governance.system-profile-binding-id',
    { homeIdentityBindingId: homeId, profileVersionRef: profile.versionRef },
  ).slice(0, 48)}`;

  return prisma.$transaction(async (tx: any) => {
    const home = await tx.governanceHomeIdentityBinding.upsert({
      where: { id: homeId },
      update: {},
      create: {
        id: homeId,
        ...identityFacts,
        chainAccountRef: null,
        externalNetwork: null,
        canonicalOrganizationRef: null,
        controllingAuthorityRef: null,
        verificationDigest: null,
        verifiedAt: null,
        verificationExpiresAt: null,
        bindingDigest,
        status: 'active',
        effectiveFrom: now,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (
      home.homeType !== homeType
      || home.homeRef !== homeRef
      || home.identityVersion !== 1
      || home.sourceType !== identityFacts.sourceType
      || home.sourceRef !== identityFacts.sourceRef
      || home.sourceVersion !== identityFacts.sourceVersion
      || home.bindingDigest !== bindingDigest
      || home.status !== 'active'
      || home.supersededAt != null
    ) {
      throw new Error(`${input.errorPrefix}_home_mismatch`);
    }

    const definition = await tx.governanceProfileDefinitionVersion.upsert({
      where: { versionRef: profile.versionRef },
      update: {},
      create: {
        id: definitionId,
        profileId: profile.profileId,
        version: profile.version,
        versionRef: profile.versionRef,
        definition: profile,
        definitionDigest: profile.definitionDigest,
        createdAt: now,
      },
    });
    if (
      definition.profileId !== profile.profileId
      || definition.version !== profile.version
      || definition.versionRef !== profile.versionRef
      || definition.definitionDigest !== profile.definitionDigest
    ) {
      throw new Error(`${input.errorPrefix}_profile_mismatch`);
    }

    const profileBinding = await tx.governanceProfileBinding.upsert({
      where: { id: profileBindingId },
      update: {},
      create: {
        id: profileBindingId,
        homeIdentityBindingId: homeId,
        profileDefinitionVersionId: definition.id,
        operation: 'bind',
        state: 'active',
        stateVersion: 1,
        transition,
        transitionDigest: transition.transitionDigest,
        compatibilityStatus: 'ready',
        compatibilityPreflight,
        compatibilityDigest,
        migrationPreview,
        migrationPreviewDigest,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (
      profileBinding.homeIdentityBindingId !== homeId
      || profileBinding.profileDefinitionVersionId !== definition.id
      || profileBinding.state !== 'active'
      || profileBinding.compatibilityStatus !== 'ready'
      || profileBinding.transitionDigest !== transition.transitionDigest
    ) {
      throw new Error(`${input.errorPrefix}_profile_binding_mismatch`);
    }
    return { home, profileBinding };
  });
}

export async function executeSystemGovernanceRoleBindingUpdate(
  prisma: SystemGovernanceRoleBindingUpdatePrisma,
  input: {
    id: string;
    domain: SystemGovernanceDomain;
    roleKey: ExternalAppGovernanceRoleKey;
    environment: SystemGovernanceEnvironment;
    circleId: number;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    activatedAt?: Date;
    createdByPubkey?: string | null;
    sourceRequestId: string;
    sourceDecisionDigest: string;
    sourceExecutionReceiptId: string;
    metadata?: Record<string, unknown> | null;
  },
) {
  assertGovernanceRoleBindingUpdateProvenance(input);

  const current = await resolveActiveSystemGovernanceRole(prisma, {
    domain: input.domain,
    roleKey: input.roleKey,
    environment: input.environment,
  });
  await assertTargetSystemGovernanceRoleBinding(prisma, input);

  const activatedAt = input.activatedAt ?? new Date();
  return prisma.$transaction(async (tx) => {
    const superseded = await tx.systemGovernanceRoleBinding.update({
      where: { id: current.binding.id },
      data: {
        status: "superseded",
        supersededAt: activatedAt,
      },
    });
    const active = await tx.systemGovernanceRoleBinding.create({
      data: {
        id: input.id,
        domain: input.domain,
        roleKey: input.roleKey,
        environment: input.environment,
        circleId: input.circleId,
        policyId: input.policyId,
        policyVersionId: input.policyVersionId,
        policyVersion: input.policyVersion,
        status: "active",
        activatedAt,
        createdByPubkey: input.createdByPubkey ?? null,
        sourceRequestId: input.sourceRequestId,
        sourceDecisionDigest: input.sourceDecisionDigest,
        sourceExecutionReceiptId: input.sourceExecutionReceiptId,
        metadata: input.metadata ?? null,
      },
    });
    return { superseded, active };
  });
}

function assertGovernanceRoleBindingUpdateProvenance(input: {
  sourceRequestId?: string | null;
  sourceDecisionDigest?: string | null;
  sourceExecutionReceiptId?: string | null;
}): void {
  if (!input.sourceRequestId) {
    throw new Error("system_governance_role_binding_source_request_required");
  }
  if (!input.sourceExecutionReceiptId) {
    throw new Error("system_governance_role_binding_execution_receipt_required");
  }
  if (!input.sourceDecisionDigest || !/^[a-f0-9]{64}$/i.test(input.sourceDecisionDigest)) {
    throw new Error("system_governance_role_binding_decision_digest_required");
  }
}

async function assertTargetSystemGovernanceRoleBinding(
  prisma: SystemGovernanceRoleBindingPrisma,
  input: {
    circleId: number;
    policyId: string;
    policyVersionId: string;
    policyVersion?: number;
  },
): Promise<{ policyVersion: PolicyVersionLike }> {
  const circle = (await prisma.circle.findUnique({
    where: { id: input.circleId },
    select: { id: true, kind: true, mode: true, circleType: true },
  })) as ReviewCircleLike | null;
  if (!circle) {
    throw new Error("system_governance_role_circle_not_found");
  }
  assertReviewCircleShape(circle);

  const policy = (await prisma.governancePolicy.findFirst({
    where: {
      id: input.policyId,
      scopeType: "external_app_review_circle",
      scopeRef: String(input.circleId),
      status: "active",
    },
    select: { id: true, scopeType: true, scopeRef: true, status: true },
  })) as PolicyLike | null;
  if (!policy) {
    throw new Error("system_governance_role_policy_not_found");
  }

  const policyVersion = (await prisma.governancePolicyVersion.findFirst({
    where: {
      id: input.policyVersionId,
      policyId: input.policyId,
      ...(input.policyVersion === undefined ? {} : { version: input.policyVersion }),
      status: "active",
    },
    select: { id: true, policyId: true, version: true, status: true },
  })) as PolicyVersionLike | null;
  if (!policyVersion) {
    throw new Error("system_governance_role_policy_version_not_found");
  }
  return { policyVersion };
}
