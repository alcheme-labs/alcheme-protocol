import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccount,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_RPC_URL = "http://127.0.0.1:8899";
const DEFAULT_WALLET_PATH = path.join(os.homedir(), ".config/solana/id.json");
const DEFAULT_TEST_BALANCE_RAW = 1_000_000_000_000n;

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg.startsWith("--") && next && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8"))),
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const environment =
    args.environment || process.env.ALCHEME_ENVIRONMENT || process.env.SOLANA_CLUSTER || "local";
  if (environment === "production" || environment === "mainnet-beta") {
    throw new Error("external_app_settlement_test_mint_refuses_production");
  }

  const mode = args.mode || process.env.EXTERNAL_APP_SETTLEMENT_ASSET_MODE || "test_mint";
  if (mode !== "test_mint") {
    throw new Error("external_app_settlement_test_mint_mode_required");
  }

  const connection = new Connection(
    args.rpc || process.env.SOLANA_RPC_URL || process.env.RPC_URL || DEFAULT_RPC_URL,
    "confirmed",
  );
  const payer = loadKeypair(args.wallet || process.env.ANCHOR_WALLET || DEFAULT_WALLET_PATH);
  const existingMint = args.mint || process.env.EXTERNAL_APP_SETTLEMENT_TEST_MINT;
  const mintAuthority = process.env.EXTERNAL_APP_SETTLEMENT_TEST_MINT_AUTHORITY
    ? loadKeypair(process.env.EXTERNAL_APP_SETTLEMENT_TEST_MINT_AUTHORITY)
    : payer;

  const mint = existingMint
    ? new PublicKey(existingMint)
    : await createMint(connection, payer, mintAuthority.publicKey, null, 6);

  let operatorTokenAccount: PublicKey;
  try {
    const account = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey,
    );
    operatorTokenAccount = account.address;
  } catch {
    operatorTokenAccount = await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey,
    );
  }

  if (!existingMint) {
    const amountRaw = args.amountRaw ? BigInt(args.amountRaw) : DEFAULT_TEST_BALANCE_RAW;
    await mintTo(connection, payer, mint, operatorTokenAccount, mintAuthority, amountRaw);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        environment,
        mint: mint.toBase58(),
        operatorTokenAccount: operatorTokenAccount.toBase58(),
        decimals: 6,
        env: {
          EXTERNAL_APP_SETTLEMENT_ASSET_MODE: "test_mint",
          EXTERNAL_APP_SETTLEMENT_TEST_MINT: mint.toBase58(),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
