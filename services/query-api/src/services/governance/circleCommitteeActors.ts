import type { GovernanceEligibleActor } from "./policyEngine";

const GOVERNANCE_COMMITTEE_OPERATOR_ROLES = new Set(["owner", "admin", "moderator"]);

export function isGovernanceCommitteeOperator(
  actor: Pick<GovernanceEligibleActor, "role">,
): boolean {
  return GOVERNANCE_COMMITTEE_OPERATOR_ROLES.has(String(actor.role ?? "").trim().toLowerCase());
}

export function hasGovernanceCommitteeOperator(
  actors: Array<Pick<GovernanceEligibleActor, "role">>,
): boolean {
  return actors.some(isGovernanceCommitteeOperator);
}

export async function listCommitteeEligibleActors(
  prisma: {
    circleMember: {
      findMany(input: unknown): Promise<unknown[]>;
    };
  },
  input: {
    committeeCircleId: number;
  },
): Promise<GovernanceEligibleActor[]> {
  const members = await prisma.circleMember.findMany({
    where: {
      circleId: input.committeeCircleId,
      status: "Active",
    },
    include: {
      user: {
        select: {
          pubkey: true,
        },
      },
    },
    orderBy: [{ joinedAt: "asc" }],
  });
  return members
    .map((member: any) => ({
      pubkey: String(member?.user?.pubkey || "").trim(),
      role: String(member?.role || "") || null,
      weight: "1",
      source: "committee_member",
    }))
    .filter((actor) => actor.pubkey);
}
