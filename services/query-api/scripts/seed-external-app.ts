import { prisma } from "../src/database";
import { registerExternalApp } from "../src/services/externalApps/registry";

interface Args {
  id?: string;
  name?: string;
  ownerPubkey?: string;
  origins: string[];
  walletOnlyDev: boolean;
  serverPublicKey?: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id || !args.name || !args.ownerPubkey || args.origins.length === 0) {
    throw new Error(
      "usage: npm run seed:external-app -- --id <id> --name <name> --owner-pubkey <wallet> --origin <origin> [--wallet-only-dev|--server-public-key <key>]",
    );
  }
  const app = await registerExternalApp(prisma, {
    id: args.id,
    name: args.name,
    ownerPubkey: args.ownerPubkey,
    allowedOrigins: args.origins,
    claimAuthMode: args.walletOnlyDev ? "wallet_only_dev" : "server_ed25519",
    serverPublicKey: args.serverPublicKey ?? null,
    config: { environment: "sandbox", reviewLevel: "sandbox" },
  });
  console.log(JSON.stringify({ app }, null, 2));
}

function parseArgs(argv: string[]): Args {
  const result: Args = { origins: [], walletOnlyDev: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === "--id") {
      result.id = next;
      index += 1;
    } else if (flag === "--name") {
      result.name = next;
      index += 1;
    } else if (flag === "--owner-pubkey") {
      result.ownerPubkey = next;
      index += 1;
    } else if (flag === "--origin") {
      result.origins.push(next);
      index += 1;
    } else if (flag === "--wallet-only-dev") {
      result.walletOnlyDev = true;
    } else if (flag === "--server-public-key") {
      result.serverPublicKey = next;
      index += 1;
    }
  }
  return result;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
