import {
  assertActiveExternalAppReviewBinding,
  assertReviewCircleShape,
  buildSystemGovernanceRoleBindingSnapshot,
  EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  executeSystemGovernanceRoleBindingUpdate,
  resolveActiveSystemGovernanceRole,
} from "../systemRoleBindings";

function makePrisma(overrides: {
  binding?: Record<string, unknown> | null;
  circle?: Record<string, unknown> | null;
  policy?: Record<string, unknown> | null;
  policyVersion?: Record<string, unknown> | null;
} = {}) {
  return {
    systemGovernanceRoleBinding: {
      findFirst: jest.fn(async () => overrides.binding ?? null),
    },
    circle: {
      findUnique: jest.fn(async () => overrides.circle ?? null),
    },
    governancePolicy: {
      findFirst: jest.fn(async () => overrides.policy ?? null),
    },
    governancePolicyVersion: {
      findFirst: jest.fn(async () => overrides.policyVersion ?? null),
    },
  };
}

const activeBinding = {
  id: "binding-1",
  domain: "external_app",
  roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  environment: "production",
  circleId: 7,
  policyId: "external-app-review-v1",
  policyVersionId: "external-app-review-v1:1",
  policyVersion: 1,
  status: "active",
  activatedAt: new Date("2026-05-14T00:00:00.000Z"),
  supersededAt: null,
  createdByPubkey: "operator-wallet",
  sourceRequestId: "req-governed-binding",
  sourceDecisionDigest: "a".repeat(64),
  sourceExecutionReceiptId: "receipt-1",
  metadata: { note: "bootstrap" },
};

const reviewCircle = {
  id: 7,
  kind: "auxiliary",
  mode: "governance",
  circleType: "Secret",
};

const activePolicy = {
  id: "external-app-review-v1",
  scopeType: "external_app_review_circle",
  scopeRef: "7",
  status: "active",
};

const activePolicyVersion = {
  id: "external-app-review-v1:1",
  policyId: "external-app-review-v1",
  version: 1,
  status: "active",
};

describe("system governance role bindings", () => {
  it("rejects a normal public circle shape", () => {
    expect(() =>
      assertReviewCircleShape({
        id: 1,
        kind: "main",
        mode: "knowledge",
        circleType: "Open",
      }),
    ).toThrow("external_app_review_circle_requires_governance_circle");
  });

  it("rejects an auxiliary governance secret circle when no active binding points to it", async () => {
    const prisma = makePrisma({ circle: reviewCircle });

    await expect(
      resolveActiveSystemGovernanceRole(prisma, {
        domain: "external_app",
        roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
        environment: "production",
      }),
    ).rejects.toThrow("system_governance_role_binding_not_found");
  });

  it("rejects inactive policies, inactive policy versions, and policy scope mismatches", async () => {
    await expect(
      resolveActiveSystemGovernanceRole(
        makePrisma({
          binding: activeBinding,
          circle: reviewCircle,
          policy: { ...activePolicy, status: "paused" },
          policyVersion: activePolicyVersion,
        }),
        {
          domain: "external_app",
          roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
          environment: "production",
        },
      ),
    ).rejects.toThrow("system_governance_role_policy_not_found");

    await expect(
      resolveActiveSystemGovernanceRole(
        makePrisma({
          binding: activeBinding,
          circle: reviewCircle,
          policy: { ...activePolicy, scopeRef: "999" },
          policyVersion: activePolicyVersion,
        }),
        {
          domain: "external_app",
          roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
          environment: "production",
        },
      ),
    ).rejects.toThrow("system_governance_role_policy_not_found");

    await expect(
      resolveActiveSystemGovernanceRole(
        makePrisma({
          binding: activeBinding,
          circle: reviewCircle,
          policy: activePolicy,
          policyVersion: { ...activePolicyVersion, status: "draft" },
        }),
        {
          domain: "external_app",
          roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
          environment: "production",
        },
      ),
    ).rejects.toThrow("system_governance_role_policy_version_not_found");
  });

  it("returns read-only binding output with governance provenance", async () => {
    const resolved = await resolveActiveSystemGovernanceRole(
      makePrisma({
        binding: activeBinding,
        circle: reviewCircle,
        policy: activePolicy,
        policyVersion: activePolicyVersion,
      }),
      {
        domain: "external_app",
        roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
        environment: "production",
      },
    );

    expect(resolved.binding).toMatchObject({
      id: "binding-1",
      sourceRequestId: "req-governed-binding",
      sourceDecisionDigest: "a".repeat(64),
      sourceExecutionReceiptId: "receipt-1",
    });
    expect(resolved.circle).toMatchObject({ id: 7 });
    expect(resolved.policy).toMatchObject({ id: "external-app-review-v1" });
    expect(resolved.policyVersion).toMatchObject({ id: "external-app-review-v1:1" });
  });

  it("formats a read-only operator snapshot with resolved role provenance", async () => {
    const resolved = await resolveActiveSystemGovernanceRole(
      makePrisma({
        binding: activeBinding,
        circle: reviewCircle,
        policy: activePolicy,
        policyVersion: activePolicyVersion,
      }),
      {
        domain: "external_app",
        roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
        environment: "production",
      },
    );

    expect(buildSystemGovernanceRoleBindingSnapshot(resolved)).toMatchObject({
      domain: "external_app",
      roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
      environment: "production",
      binding: {
        id: "binding-1",
        circleId: 7,
        policyId: "external-app-review-v1",
        policyVersionId: "external-app-review-v1:1",
        policyVersion: 1,
      },
      circle: { id: 7, kind: "auxiliary", mode: "governance", circleType: "Secret" },
      policy: { id: "external-app-review-v1", scopeRef: "7" },
      policyVersion: { id: "external-app-review-v1:1", version: 1 },
      source: {
        requestId: "req-governed-binding",
        decisionDigest: "a".repeat(64),
        executionReceiptId: "receipt-1",
      },
    });
  });

  it("rejects caller assertions that do not match the active binding", async () => {
    const prisma = makePrisma({
      binding: activeBinding,
      circle: reviewCircle,
      policy: activePolicy,
      policyVersion: activePolicyVersion,
    });

    await expect(
      assertActiveExternalAppReviewBinding(prisma, {
        roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
        environment: "production",
        circleId: 999,
        policyId: "external-app-review-v1",
        policyVersionId: "external-app-review-v1:1",
      }),
    ).rejects.toThrow("external_app_review_binding_mismatch");
  });

  it("updates a role binding by superseding the old active binding and creating a receipt-bound active binding", async () => {
    const update = jest.fn(async ({ data }: any) => data);
    const create = jest.fn(async ({ data }: any) => data);
    const prisma = {
      ...makePrisma({
        binding: activeBinding,
        circle: reviewCircle,
        policy: activePolicy,
        policyVersion: activePolicyVersion,
      }),
      $transaction: jest.fn(async (operation: any) =>
        operation({
          systemGovernanceRoleBinding: { update, create },
        }),
      ),
    };

    const result = await executeSystemGovernanceRoleBindingUpdate(prisma, {
      id: "binding-2",
      domain: "external_app",
      roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
      environment: "production",
      circleId: 7,
      policyId: "external-app-review-v1",
      policyVersionId: "external-app-review-v1:1",
      policyVersion: 1,
      activatedAt: new Date("2026-05-14T01:00:00.000Z"),
      createdByPubkey: "reviewer-wallet",
      sourceRequestId: "req-binding-update",
      sourceDecisionDigest: "b".repeat(64),
      sourceExecutionReceiptId: "execution-receipt-2",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "binding-1" },
      data: {
        status: "superseded",
        supersededAt: new Date("2026-05-14T01:00:00.000Z"),
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "binding-2",
        status: "active",
        sourceRequestId: "req-binding-update",
        sourceDecisionDigest: "b".repeat(64),
        sourceExecutionReceiptId: "execution-receipt-2",
      }),
    });
    expect(result).toMatchObject({
      superseded: { status: "superseded" },
      active: { id: "binding-2", status: "active" },
    });
  });

  it("rejects role binding updates without governance provenance or valid target resolver state", async () => {
    await expect(
      executeSystemGovernanceRoleBindingUpdate(
        {
          ...makePrisma({
            binding: activeBinding,
            circle: reviewCircle,
            policy: activePolicy,
            policyVersion: activePolicyVersion,
          }),
          $transaction: jest.fn(),
        },
        {
          id: "binding-2",
          domain: "external_app",
          roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
          environment: "production",
          circleId: 7,
          policyId: "external-app-review-v1",
          policyVersionId: "external-app-review-v1:1",
          policyVersion: 1,
          sourceRequestId: "req-binding-update",
          sourceDecisionDigest: "not-a-digest",
          sourceExecutionReceiptId: "execution-receipt-2",
        },
      ),
    ).rejects.toThrow("system_governance_role_binding_decision_digest_required");

    await expect(
      executeSystemGovernanceRoleBindingUpdate(
        {
          ...makePrisma({
            binding: activeBinding,
            circle: { ...reviewCircle, circleType: "Open" },
            policy: activePolicy,
            policyVersion: activePolicyVersion,
          }),
          $transaction: jest.fn(),
        },
        {
          id: "binding-2",
          domain: "external_app",
          roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
          environment: "production",
          circleId: 7,
          policyId: "external-app-review-v1",
          policyVersionId: "external-app-review-v1:1",
          policyVersion: 1,
          sourceRequestId: "req-binding-update",
          sourceDecisionDigest: "b".repeat(64),
          sourceExecutionReceiptId: "execution-receipt-2",
        },
      ),
    ).rejects.toThrow("external_app_review_circle_requires_governance_circle");
  });
});
