#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl } from "@solana/web3.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const IDL_PATH = path.join(ROOT, "target", "idl", "circle_manager.json");
const EVENT_IDL_PATH = path.join(ROOT, "sdk", "src", "idl", "event_emitter.json");
const DEFAULT_PROGRAM_ID = "GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ";
const DEFAULT_WALLET = path.join(os.homedir(), ".config", "solana", "id.json");

function usage() {
  console.error(`Usage:
  node scripts/membership-attestor-registry.mjs show [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
  node scripts/membership-attestor-registry.mjs init [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
  node scripts/membership-attestor-registry.mjs register --attestor PUBKEY [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
  node scripts/membership-attestor-registry.mjs revoke --attestor PUBKEY [--rpc URL] [--wallet PATH] [--program-id PUBKEY]
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {
    command,
    rpc: process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    wallet: process.env.ANCHOR_WALLET || DEFAULT_WALLET,
    programId: DEFAULT_PROGRAM_ID,
    attestor: null,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (value === "--rpc") {
      args.rpc = rest[++i];
    } else if (value === "--wallet") {
      args.wallet = rest[++i];
    } else if (value === "--program-id") {
      args.programId = rest[++i];
    } else if (value === "--attestor") {
      args.attestor = rest[++i];
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

async function deriveContext(args) {
  const wallet = loadWallet(args.wallet);
  const provider = new AnchorProvider(
    new Connection(args.rpc, "confirmed"),
    wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  const program = loadProgram(args.programId, provider);
  const eventProgram = loadEventProgram(provider);
  const [circleManager] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle_manager")],
    program.programId,
  );
  const [membershipAttestorRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("membership_attestor_registry")],
    program.programId,
  );
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
    provider,
    program,
    eventProgram,
    circleManager,
    membershipAttestorRegistry,
    eventEmitter,
    eventBatch,
  };
}

async function showRegistry(args) {
  const { program, membershipAttestorRegistry } = await deriveContext(args);
  const account = await program.account.membershipAttestorRegistry.fetchNullable(membershipAttestorRegistry);
  if (!account) {
    console.log(JSON.stringify({
      exists: false,
      membershipAttestorRegistry: membershipAttestorRegistry.toBase58(),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    exists: true,
    membershipAttestorRegistry: membershipAttestorRegistry.toBase58(),
    admin: account.admin.toBase58(),
    bump: account.bump,
    attestors: account.attestors.map((entry) => entry.toBase58()),
    createdAt: Number(account.createdAt),
    lastUpdated: Number(account.lastUpdated),
  }, null, 2));
}

async function initializeRegistry(args) {
  const { program, circleManager, membershipAttestorRegistry, provider } = await deriveContext(args);
  const signature = await program.methods
    .initializeMembershipAttestorRegistry()
    .accounts({
      membershipAttestorRegistry,
      circleManager,
      admin: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(JSON.stringify({
    action: "initialize",
    signature,
    membershipAttestorRegistry: membershipAttestorRegistry.toBase58(),
  }, null, 2));
}

async function registerAttestor(args, mode) {
  if (!args.attestor) {
    throw new Error("missing_attestor");
  }
  const {
    program,
    eventProgram,
    membershipAttestorRegistry,
    provider,
    eventEmitter,
    eventBatch,
  } = await deriveContext(args);
  const attestor = new PublicKey(args.attestor);

  const method = mode === "register"
    ? program.methods.registerMembershipAttestor(attestor)
    : program.methods.revokeMembershipAttestor(attestor);

  const signature = await method.accounts({
    membershipAttestorRegistry,
    admin: provider.wallet.publicKey,
    eventProgram: eventProgram.programId,
    eventEmitter,
    eventBatch,
    systemProgram: SystemProgram.programId,
  }).rpc();

  console.log(JSON.stringify({
    action: mode,
    signature,
    attestor: attestor.toBase58(),
    membershipAttestorRegistry: membershipAttestorRegistry.toBase58(),
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command) {
    usage();
    process.exit(1);
  }

  if (args.command === "show") {
    await showRegistry(args);
    return;
  }
  if (args.command === "init") {
    await initializeRegistry(args);
    return;
  }
  if (args.command === "register") {
    await registerAttestor(args, "register");
    return;
  }
  if (args.command === "revoke") {
    await registerAttestor(args, "revoke");
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
