import type { PrismaClient } from "@prisma/client";

import {
  EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  resolveActiveSystemGovernanceRole,
} from "../governance/systemRoleBindings";
import { buildRiskDisclaimerTerms } from "./riskDisclaimer";

export type ExternalProgramReviewPolicyCurrent =
  | {
      available: true;
      policyEpochId: string;
      reviewPolicyId: string;
      reviewPolicyVersionId: string;
      reviewPolicyVersion: number;
      reviewCircleId: number;
      reviewRoleKey: string;
      developerAgreement: {
        required: true;
        scope: "developer_registration";
        disclaimerVersion: string;
        termsDigest: string;
        chainReceiptRequired: true;
      };
    }
  | {
      available: false;
      error: string;
      reviewRoleKey: string;
      developerAgreement: {
        required: true;
        scope: "developer_registration";
        chainReceiptRequired: true;
      };
    };

export async function getExternalProgramReviewPolicyCurrent(
  prisma: PrismaClient,
): Promise<ExternalProgramReviewPolicyCurrent> {
  try {
    const resolved = await resolveActiveSystemGovernanceRole(prisma as any, {
      domain: "external_app",
      roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
      environment: "production",
    });
    const terms = buildRiskDisclaimerTerms("developer_registration");
    return {
      available: true,
      policyEpochId: resolved.binding.policyVersionId,
      reviewPolicyId: resolved.binding.policyId,
      reviewPolicyVersionId: resolved.binding.policyVersionId,
      reviewPolicyVersion: resolved.binding.policyVersion,
      reviewCircleId: resolved.binding.circleId,
      reviewRoleKey: resolved.binding.roleKey,
      developerAgreement: {
        required: true,
        scope: "developer_registration",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        chainReceiptRequired: true,
      },
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "review_policy_unavailable",
      reviewRoleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
      developerAgreement: {
        required: true,
        scope: "developer_registration",
        chainReceiptRequired: true,
      },
    };
  }
}
