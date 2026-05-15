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
  domain: string;
  roleKey: string;
  environment: string;
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
    findFirst(input: unknown): Promise<unknown | null>;
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

export async function resolveActiveSystemGovernanceRole(
  prisma: SystemGovernanceRoleBindingPrisma,
  input: {
    domain: SystemGovernanceDomain;
    roleKey: ExternalAppGovernanceRoleKey;
    environment: SystemGovernanceEnvironment;
  },
): Promise<SystemGovernanceRoleResolution> {
  const binding = (await prisma.systemGovernanceRoleBinding.findFirst({
    where: {
      domain: input.domain,
      roleKey: input.roleKey,
      environment: input.environment,
      status: "active",
    },
    orderBy: { activatedAt: "desc" },
  })) as BindingLike | null;
  if (!binding || binding.status !== "active") {
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
    policyVersion: number;
  },
): Promise<void> {
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
      version: input.policyVersion,
      status: "active",
    },
    select: { id: true, policyId: true, version: true, status: true },
  })) as PolicyVersionLike | null;
  if (!policyVersion) {
    throw new Error("system_governance_role_policy_version_not_found");
  }
}
