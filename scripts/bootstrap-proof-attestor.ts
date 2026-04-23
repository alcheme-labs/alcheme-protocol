import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import circleManagerIdl from "../sdk/src/idl/circle_manager.json";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eventEmitterIdl from "../sdk/src/idl/event_emitter.json";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.resolve(PROJECT_ROOT, "sdk/localnet-config.json");
const DEFAULT_WALLET_PATH = path.resolve(os.homedir(), ".config/solana/id.json");

interface BootstrapConfig {
  network: string;
  programIds: {
    circles: string;
    event: string;
  };
}

function parseArgs(): {
  cluster?: string;
  attestor?: string;
  walletPath?: string;
} {
  const out: { cluster?: string; attestor?: string; walletPath?: string } = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];
    if ((arg === "--cluster" || arg === "-c") && next) {
      out.cluster = next;
      i += 1;
      continue;
    }
    if ((arg === "--attestor" || arg === "-a") && next) {
      out.attestor = next;
      i += 1;
      continue;
    }
    if ((arg === "--wallet" || arg === "-w") && next) {
      out.walletPath = next;
      i += 1;
      continue;
    }
  }
  return out;
}

function loadConfig(): BootstrapConfig {
  if (!fs.existsSync(DEFAULT_CONFIG_PATH)) {
    throw new Error(`missing config: ${DEFAULT_CONFIG_PATH}`);
  }
  const parsed = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf8"));
  if (!parsed?.programIds?.circles || !parsed?.programIds?.event) {
    throw new Error("invalid sdk/localnet-config.json: missing circles/event program IDs");
  }
  return parsed;
}

function loadWallet(walletPath: string): Keypair {
  if (!fs.existsSync(walletPath)) {
    throw new Error(`wallet not found: ${walletPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function resolveCluster(config: BootstrapConfig, clusterArg?: string): string {
  if (!clusterArg || clusterArg === "localnet") return config.network;
  if (clusterArg.startsWith("http://") || clusterArg.startsWith("https://")) {
    return clusterArg;
  }
  if (clusterArg === "devnet") return "https://api.devnet.solana.com";
  if (clusterArg === "testnet") return "https://api.testnet.solana.com";
  if (clusterArg === "mainnet-beta") return "https://api.mainnet-beta.solana.com";
  return clusterArg;
}

function toBn(value: unknown): anchor.BN {
  if (anchor.BN.isBN(value)) return value;
  if (typeof value === "number") return new anchor.BN(value);
  if (typeof value === "bigint") return new anchor.BN(value.toString());
  if (value && typeof (value as { toString: () => string }).toString === "function") {
    return new anchor.BN((value as { toString: () => string }).toString());
  }
  throw new Error("failed to read event sequence");
}

async function resolveEventBatchPda(eventProgram: Program<Idl>): Promise<PublicKey> {
  const [eventEmitter] = PublicKey.findProgramAddressSync(
    [Buffer.from("event_emitter")],
    eventProgram.programId,
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const emitterAccount = await eventProgram.account.eventEmitterAccount.fetch(eventEmitter);
  const sequenceValue = emitterAccount?.inner?.eventSequence ?? emitterAccount?.eventSequence;
  const sequence = toBn(sequenceValue);
  const [eventBatch] = PublicKey.findProgramAddressSync(
    [Buffer.from("event_batch"), sequence.toArrayLike(Buffer, "le", 8)],
    eventProgram.programId,
  );
  return eventBatch;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = loadConfig();
  const walletPath = args.walletPath || process.env.ANCHOR_WALLET || DEFAULT_WALLET_PATH;
  const wallet = loadWallet(walletPath);
  const endpoint = resolveCluster(config, args.cluster || process.env.CLUSTER);
  const connection = new Connection(endpoint, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" },
  );
  anchor.setProvider(provider);

  const circlesIdl = {
    ...(circleManagerIdl as Idl),
    address: config.programIds.circles,
  } as Idl;
  const eventIdl = {
    ...(eventEmitterIdl as Idl),
    address: config.programIds.event,
  } as Idl;

  const circlesProgram = new Program(circlesIdl, provider);
  const eventProgram = new Program(eventIdl, provider);
  const attestor = new PublicKey(args.attestor || wallet.publicKey.toBase58());

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proof_attestor_registry")],
    circlesProgram.programId,
  );
  const [circleManagerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle_manager")],
    circlesProgram.programId,
  );
  const eventBatch = await resolveEventBatchPda(eventProgram);
  const [eventEmitter] = PublicKey.findProgramAddressSync(
    [Buffer.from("event_emitter")],
    eventProgram.programId,
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const circleManagerAccount = await circlesProgram.account.circleManager.fetchNullable(circleManagerPda);
  if (!circleManagerAccount) {
    throw new Error(`circle_manager is not initialized: ${circleManagerPda.toBase58()}`);
  }
  const managerAdmin = new PublicKey(circleManagerAccount.admin).toBase58();
  if (managerAdmin !== wallet.publicKey.toBase58()) {
    throw new Error(
      `wallet ${wallet.publicKey.toBase58()} is not circle_manager admin (${managerAdmin})`,
    );
  }

  const existingRegistry = await connection.getAccountInfo(registryPda);
  if (!existingRegistry) {
    console.log(`Initializing proof attestor registry: ${registryPda.toBase58()}`);
    await (circlesProgram.methods as any)
      .initializeProofAttestorRegistry()
      .accounts({
        proofAttestorRegistry: registryPda,
        circleManager: circleManagerPda,
        admin: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log(`Proof attestor registry already exists: ${registryPda.toBase58()}`);
    if (!existingRegistry.owner.equals(circlesProgram.programId)) {
      throw new Error(
        `proof attestor registry PDA owner mismatch: ${existingRegistry.owner.toBase58()}`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const registryAccount = await circlesProgram.account.proofAttestorRegistry.fetch(registryPda);
    const registryAdmin = new PublicKey(registryAccount.admin).toBase58();
    if (registryAdmin !== wallet.publicKey.toBase58()) {
      throw new Error(
        `proof attestor registry is occupied by ${registryAdmin}; expected ${wallet.publicKey.toBase58()}`,
      );
    }
  }

  try {
    console.log(`Registering proof attestor: ${attestor.toBase58()}`);
    await (circlesProgram.methods as any)
      .registerProofAttestor(attestor)
      .accounts({
        proofAttestorRegistry: registryPda,
        admin: wallet.publicKey,
        eventProgram: eventProgram.programId,
        eventEmitter,
        eventBatch,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Attestor registration succeeded.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already in use") || message.includes("InvalidOperation")) {
      console.log("Attestor already registered (or duplicate), skipping.");
    } else {
      throw error;
    }
  }
}

main().catch((error) => {
  console.error("bootstrap-proof-attestor failed:", error);
  process.exit(1);
});
