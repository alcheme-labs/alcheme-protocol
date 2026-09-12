import { randomUUID } from "node:crypto";
import type { GovernanceActionType } from "../policy/types";

export const EXTERNAL_APP_CONFLICT_ROLES = [
  "owner",
  "challenger",
  "major_backer",
  "direct_competitor",
  "paid_promoter",
  "affiliate",
  "sponsor",
  "node_operator",
  "reviewer",
] as const;

export type ExternalAppConflictRole = (typeof EXTERNAL_APP_CONFLICT_ROLES)[number];
export type ExternalAppConflictSource =
  | "self_reported"
  | "reviewer_reported"
  | "projection"
  | "governance_receipt";

export interface ExternalAppConflictDisclosure {
  id: string;
  externalAppId: string;
  actorPubkey: string;
  role: ExternalAppConflictRole;
  source: ExternalAppConflictSource;
  status: "active" | "recused" | "cleared" | "expired";
  disclosedAt: Date;
}

const RECUSAL_ROLES = new Set<ExternalAppConflictRole>([
  "owner",
  "challenger",
  "direct_competitor",
  "paid_promoter",
]);

const HIGH_IMPACT_ACTIONS = new Set<GovernanceActionType>([
  "external_app_bond_disposition_apply",
  "external_app_bond_routing_execute",
  "external_app_owner_bond_slash",
  "external_app_settlement_execute",
  "external_app_registry_revoke",
  "external_app_governance_role_binding_update",
]);

export function buildExternalAppConflictDisclosure(input: {
  id?: string;
  externalAppId: string;
  actorPubkey: string;
  role: ExternalAppConflictRole;
  source: ExternalAppConflictSource;
  status?: ExternalAppConflictDisclosure["status"];
  disclosedAt?: Date;
}): ExternalAppConflictDisclosure {
  return {
    id: input.id ?? randomUUID(),
    externalAppId: input.externalAppId,
    actorPubkey: input.actorPubkey,
    role: input.role,
    source: input.source,
    status: input.status ?? "active",
    disclosedAt: input.disclosedAt ?? new Date(),
  };
}

export function assertExternalAppGovernanceParticipationAllowed(input: {
  externalAppId: string;
  actorPubkey: string;
  actionType: GovernanceActionType;
  disclosures: ExternalAppConflictDisclosure[];
}): void {
  if (!HIGH_IMPACT_ACTIONS.has(input.actionType)) return;
  const activeDisclosures = matchingActiveDisclosures(input);
  if (activeDisclosures.some((disclosure) => RECUSAL_ROLES.has(disclosure.role))) {
    throw new Error("external_app_governance_recusal_required");
  }
}

export function computeExternalAppVotingCap(input: {
  externalAppId: string;
  actorPubkey: string;
  disclosures: ExternalAppConflictDisclosure[];
}): { cap: number; reason: string | null } {
  const activeDisclosures = matchingActiveDisclosures(input);
  if (activeDisclosures.some((disclosure) => RECUSAL_ROLES.has(disclosure.role))) {
    return { cap: 0, reason: "recusal_required" };
  }
  if (activeDisclosures.some((disclosure) => disclosure.role === "major_backer")) {
    return { cap: 0.25, reason: "major_backer" };
  }
  if (
    activeDisclosures.some((disclosure) =>
      ["affiliate", "sponsor", "node_operator"].includes(disclosure.role),
    )
  ) {
    return { cap: 0.5, reason: activeDisclosures[0]?.role ?? "related_party" };
  }
  return { cap: 1, reason: null };
}

function matchingActiveDisclosures(input: {
  externalAppId: string;
  actorPubkey: string;
  disclosures: ExternalAppConflictDisclosure[];
}): ExternalAppConflictDisclosure[] {
  return input.disclosures.filter(
    (disclosure) =>
      disclosure.externalAppId === input.externalAppId &&
      disclosure.actorPubkey === input.actorPubkey &&
      disclosure.status === "active",
  );
}
