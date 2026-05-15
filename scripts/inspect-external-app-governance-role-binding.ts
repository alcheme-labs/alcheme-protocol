import { PrismaClient } from "@prisma/client";

import {
  buildSystemGovernanceRoleBindingSnapshot,
  EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  normalizeExternalAppGovernanceRoleKey,
  resolveActiveSystemGovernanceRole,
  type SystemGovernanceEnvironment,
  type SystemGovernanceRoleBindingPrisma,
} from "../services/query-api/src/services/governance/systemRoleBindings";

const prisma = new PrismaClient();

async function main() {
  const environment = readEnvironment();
  const roleKey = normalizeExternalAppGovernanceRoleKey(
    process.env.EXTERNAL_APP_GOVERNANCE_ROLE_KEY || EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  );
  const resolved = await resolveActiveSystemGovernanceRole(
    prisma as unknown as SystemGovernanceRoleBindingPrisma,
    {
      domain: "external_app",
      roleKey,
      environment,
    },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...buildSystemGovernanceRoleBindingSnapshot(resolved),
      },
      null,
      2,
    ),
  );
}

function readEnvironment(): SystemGovernanceEnvironment {
  const value =
    process.env.EXTERNAL_APP_GOVERNANCE_ENVIRONMENT?.trim() ||
    process.env.EXTERNAL_APP_REVIEW_PRIMARY_ENVIRONMENT?.trim() ||
    "production";
  if (value !== "sandbox" && value !== "production") {
    throw new Error("EXTERNAL_APP_GOVERNANCE_ENVIRONMENT must be sandbox or production");
  }
  return value;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
