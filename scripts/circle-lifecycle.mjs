#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl } from "@solana/web3.js";

const scriptPath = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(scriptPath), "..");
const IDL_PATH = path.join(ROOT, "target", "idl", "circle_manager.json");
const EVENT_IDL_PATH = path.join(ROOT, "sdk", "src", "idl", "event_emitter.json");
const DEFAULT_PROGRAM_ID = "GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ";
const DEFAULT_WALLET = path.join(os.homedir(), ".config", "solana", "id.json");

function usage() {
  console.error(`Usage:
  node scripts/circle-lifecycle.mjs show --circle-id <id> [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
  node scripts/circle-lifecycle.mjs migrate --circle-id <id> [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
  node scripts/circle-lifecycle.mjs archive --circle-id <id> --reason "demo cleanup" [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
  node scripts/circle-lifecycle.mjs restore --circle-id <id> [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {
    command,
    rpc: process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    wallet: process.env.ANCHOR_WALLET || DEFAULT_WALLET,
    programId: DEFAULT_PROGRAM_ID,
    circleId: null,
    reason: "",
  };

  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (value === "--rpc") {
      args.rpc = rest[++i];
    } else if (value === "--wallet") {
      args.wallet = rest[++i];
    } else if (value === "--program-id") {
      args.programId = rest[++i];
    } else if (value === "--circle-id") {
      args.circleId = rest[++i];
    } else if (value === "--reason") {
      args.reason = rest[++i];
    } else {
      throw new Error(`unknown_argument:${value}`);
    }
  }

  return args;
}

function loadWallet(walletPath) {
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")));
  return new Wallet(Keypair.fromSecretKey(secret));
}

function loadProgram(programId, provider) {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  idl.address = programId;
  return new Program(idl, provider);
}

function loadEventProgram(provider) {
  const idl = JSON.parse(fs.readFileSync(EVENT_IDL_PATH, "utf8"));
  return new Program(idl, provider);
}

function parseCircleId(args) {
  const circleId = Number.parseInt(args.circleId, 10);
  if (!Number.isInteger(circleId) || circleId < 0 || circleId > 255) {
    throw new Error("invalid_circle_id");
  }
  return circleId;
}

async function deriveBaseContext(args) {
  const wallet = loadWallet(args.wallet);
  const provider = new AnchorProvider(
    new Connection(args.rpc, "confirmed"),
    wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  const program = loadProgram(args.programId, provider);
  const circleId = parseCircleId(args);
  const [circleManager] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle_manager")],
    program.programId,
  );
  const [circle] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), Buffer.from([circleId & 0xff])],
    program.programId,
  );

  return {
    provider,
    program,
    circleId,
    circle,
    circleManager,
  };
}

async function deriveEventContext(args) {
  const base = await deriveBaseContext(args);
  const eventProgram = loadEventProgram(base.provider);
  const [eventEmitter] = PublicKey.findProgramAddressSync(
    [Buffer.from("event_emitter")],
    eventProgram.programId,
  );

  const emitterAccount = await eventProgram.account.eventEmitterAccount.fetch(eventEmitter);
  const eventSequenceValue = emitterAccount?.inner?.eventSequence ?? emitterAccount?.eventSequence;
  const eventSequence = BigInt(eventSequenceValue.toString());
  const eventSequenceBuffer = Buffer.alloc(8);
  eventSequenceBuffer.writeBigUInt64LE(eventSequence, 0);
  const [eventBatch] = PublicKey.findProgramAddressSync(
    [Buffer.from("event_batch"), eventSequenceBuffer],
    eventProgram.programId,
  );

  return {
    ...base,
    eventProgram,
    eventEmitter,
    eventBatch,
  };
}

function toCircleStatus(value) {
  if (!value) return "Unknown";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return Object.keys(value)[0] || "Unknown";
  }
  return String(value);
}

async function showCircle(args) {
  const { program, circle, circleManager } = await deriveBaseContext(args);
  const circleId = parseCircleId(args);
  const account = await program.account.circle.fetchNullable(circle);
  if (!account) {
    console.log(JSON.stringify({
      exists: false,
      circleId,
      circle: circle.toBase58(),
      circleManager: circleManager.toBase58(),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    exists: true,
    circleId,
    circle: circle.toBase58(),
    circleManager: circleManager.toBase58(),
    name: account.name,
    status: toCircleStatus(account.status),
    owner: account.curators?.[0]?.toBase58?.() ?? null,
    curators: account.curators?.map((entry) => entry.toBase58()) ?? [],
    parentCircle: account.parentCircle ?? null,
    flags: Number(account.flags),
    createdAt: Number(account.createdAt),
  }, null, 2));
}

async function migrateCircle(args) {
  const {
    program,
    circle,
    circleManager,
    provider,
  } = await deriveBaseContext(args);
  const circleId = parseCircleId(args);

  const signature = await program.methods
    .migrateCircleLifecycle(circleId)
    .accounts({
      circle,
      payer: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(JSON.stringify({
    action: "migrate",
    signature,
    circleId,
    circle: circle.toBase58(),
    circleManager: circleManager.toBase58(),
  }, null, 2));
}

async function mutateCircle(args, mode) {
  const {
    program,
    circle,
    circleManager,
    provider,
    eventProgram,
    eventEmitter,
    eventBatch,
  } = await deriveEventContext(args);
  const circleId = parseCircleId(args);
  const reason = args.reason || "";

  const method = mode === "archive"
    ? program.methods.archiveCircle(reason)
    : program.methods.restoreCircle();

  const signature = await method.accounts({
    circleManager,
    circle,
    authority: provider.wallet.publicKey,
    eventProgram: eventProgram.programId,
    eventEmitter,
    eventBatch,
    systemProgram: SystemProgram.programId,
  }).rpc();

  console.log(JSON.stringify({
    action: mode,
    signature,
    circleId,
    circle: circle.toBase58(),
    circleManager: circleManager.toBase58(),
    reason: mode === "archive" ? reason : undefined,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command) {
    usage();
    process.exit(1);
  }

  if (args.command === "show") {
    await showCircle(args);
    return;
  }
  if (args.command === "migrate") {
    await migrateCircle(args);
    return;
  }
  if (args.command === "archive") {
    await mutateCircle(args, "archive");
    return;
  }
  if (args.command === "restore") {
    await mutateCircle(args, "restore");
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
