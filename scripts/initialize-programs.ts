import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ContentManager } from "../target/types/content_manager";
import { AccessController } from "../target/types/access_controller";
import { EventEmitter } from "../target/types/event_emitter";
import { RegistryFactory } from "../target/types/registry_factory";
import { MessagingManager } from "../target/types/messaging_manager";
import { CircleManager } from "../target/types/circle_manager";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import identityRegistryIdl from "../target/idl/identity_registry.json";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import contentManagerIdl from "../target/idl/content_manager.json";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import accessControllerIdl from "../target/idl/access_controller.json";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eventEmitterIdl from "../target/idl/event_emitter.json";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import registryFactoryIdl from "../target/idl/registry_factory.json";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import messagingManagerIdl from "../target/idl/messaging_manager.json";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import circleManagerIdl from "../target/idl/circle_manager.json";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_LOCAL_PROGRAM_IDS_PATH = path.resolve(PROJECT_ROOT, "sdk/localnet-config.json");
const DEFAULT_DEVNET_PROGRAM_IDS_PATH = path.resolve(PROJECT_ROOT, "config/devnet-program-ids.json");
const DEFAULT_CONTRIBUTION_MANIFEST_PATH = path.resolve(
  PROJECT_ROOT,
  "extensions/contribution-engine/extension.manifest.json"
);
const DEFAULT_WALLET_PATH = path.resolve(os.homedir(), ".config/solana/id.json");
const DEFAULT_RPC_URL = "http://127.0.0.1:8899";

process.chdir(PROJECT_ROOT);

interface ProgramIdsConfig {
  identity: string;
  content: string;
  access: string;
  event: string;
  factory: string;
  messaging: string;
  circles: string;
  contributionEngine?: string;
}

interface ExtensionRegistrationPlan {
  programId: string;
  permissions: Record<string, {}>[];
}

interface InitializeConfig {
  network?: string;
  programIds: ProgramIdsConfig;
  sourcePath: string;
}

interface CliArgs {
  cluster?: string;
  rpcUrl?: string;
  walletPath?: string;
  programIdsPath?: string;
}

type ClusterTarget = "localnet" | "devnet" | "testnet" | "mainnet-beta" | "remote";

function parseArgs(): CliArgs {
  const out: CliArgs = {};

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];

    if ((arg === "--cluster" || arg === "-c") && next) {
      out.cluster = next;
      i += 1;
      continue;
    }
    if ((arg === "--rpc" || arg === "-r") && next) {
      out.rpcUrl = next;
      i += 1;
      continue;
    }
    if ((arg === "--wallet" || arg === "-w") && next) {
      out.walletPath = next;
      i += 1;
      continue;
    }
    if ((arg === "--program-ids" || arg === "--config" || arg === "-p") && next) {
      out.programIdsPath = next;
      i += 1;
      continue;
    }
  }

  return out;
}

function expandHomeDir(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveFilePath(inputPath: string): string {
  const expanded = expandHomeDir(inputPath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(PROJECT_ROOT, expanded);
}

function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found at ${filePath}.`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getRequiredProgramId(programIds: Record<string, unknown>, key: keyof ProgramIdsConfig, sourcePath: string): string {
  const value = programIds[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required program ID "${key}" in ${sourcePath}.`);
  }
  return value;
}

function normalizeConfig(raw: unknown, sourcePath: string): InitializeConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid program config at ${sourcePath}. Expected a JSON object.`);
  }

  const parsed = raw as Record<string, unknown>;
  const candidateProgramIds =
    parsed.programIds && typeof parsed.programIds === "object"
      ? (parsed.programIds as Record<string, unknown>)
      : parsed;

  return {
    network: typeof parsed.network === "string" ? parsed.network : undefined,
    sourcePath,
    programIds: {
      identity: getRequiredProgramId(candidateProgramIds, "identity", sourcePath),
      content: getRequiredProgramId(candidateProgramIds, "content", sourcePath),
      access: getRequiredProgramId(candidateProgramIds, "access", sourcePath),
      event: getRequiredProgramId(candidateProgramIds, "event", sourcePath),
      factory: getRequiredProgramId(candidateProgramIds, "factory", sourcePath),
      messaging: getRequiredProgramId(candidateProgramIds, "messaging", sourcePath),
      circles: getRequiredProgramId(candidateProgramIds, "circles", sourcePath),
      contributionEngine:
        typeof candidateProgramIds.contributionEngine === "string" && candidateProgramIds.contributionEngine.trim().length > 0
          ? candidateProgramIds.contributionEngine
          : undefined,
    },
  };
}

export function permissionLabelToAnchorVariant(permissionLabel: string): Record<string, {}> {
  const normalized = permissionLabel.trim();
  if (!normalized) {
    throw new Error("Extension permission labels must be non-empty strings.");
  }

  const variantKey = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  return { [variantKey]: {} };
}

function loadRequiredPermissionLabelsFromManifest(manifestPath: string): string[] {
  const rawManifest = readJsonFile(manifestPath);

  if (!rawManifest || typeof rawManifest !== "object") {
    throw new Error(`Invalid extension manifest at ${manifestPath}. Expected a JSON object.`);
  }

  const manifest = rawManifest as Record<string, unknown>;
  if (!Array.isArray(manifest.required_permissions)) {
    throw new Error(`Extension manifest at ${manifestPath} is missing required_permissions[].`);
  }

  const labels = manifest.required_permissions.filter(
    (permission): permission is string => typeof permission === "string" && permission.trim().length > 0
  );

  if (labels.length === 0) {
    throw new Error(`Extension manifest at ${manifestPath} does not declare any required_permissions.`);
  }

  return labels;
}

export function resolveContributionEngineRegistration(
  programIds: ProgramIdsConfig,
  manifestPath = DEFAULT_CONTRIBUTION_MANIFEST_PATH
): ExtensionRegistrationPlan | null {
  if (!programIds.contributionEngine) {
    return null;
  }

  const permissionLabels = loadRequiredPermissionLabelsFromManifest(manifestPath);
  return {
    programId: programIds.contributionEngine,
    permissions: permissionLabels.map(permissionLabelToAnchorVariant),
  };
}

function classifyClusterTarget(input?: string): ClusterTarget | undefined {
  if (!input) {
    return undefined;
  }

  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "localnet" ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("localhost")
  ) {
    return "localnet";
  }

  if (normalized === "devnet" || normalized.includes("api.devnet.solana.com")) {
    return "devnet";
  }

  if (normalized === "testnet" || normalized.includes("api.testnet.solana.com")) {
    return "testnet";
  }

  if (
    normalized === "mainnet" ||
    normalized === "mainnet-beta" ||
    normalized.includes("api.mainnet-beta.solana.com")
  ) {
    return "mainnet-beta";
  }

  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("ws://") ||
    normalized.startsWith("wss://")
  ) {
    return "remote";
  }

  return "remote";
}

function inferClusterTarget(args: CliArgs): ClusterTarget | undefined {
  const hints = [
    args.cluster,
    args.rpcUrl,
    process.env.ANCHOR_PROVIDER_URL,
    process.env.SOLANA_RPC_URL,
    process.env.RPC_URL,
    process.env.CLUSTER,
  ];

  for (const hint of hints) {
    const target = classifyClusterTarget(hint);
    if (target) {
      return target;
    }
  }

  return undefined;
}

export function resolveProgramConfigPath(args: CliArgs): string {
  const explicitPath =
    args.programIdsPath ||
    process.env.DEVNET_PROGRAM_IDS_PATH ||
    process.env.PROGRAM_IDS_PATH ||
    process.env.ALCHEME_PROGRAM_IDS_PATH;

  if (explicitPath) {
    return resolveFilePath(explicitPath);
  }

  const clusterTarget = inferClusterTarget(args);

  if (!clusterTarget || clusterTarget === "localnet") {
    return DEFAULT_LOCAL_PROGRAM_IDS_PATH;
  }

  if (clusterTarget === "devnet") {
    return DEFAULT_DEVNET_PROGRAM_IDS_PATH;
  }

  throw new Error(
    `Remote cluster target "${clusterTarget}" requires explicit --program-ids (or DEVNET_PROGRAM_IDS_PATH / PROGRAM_IDS_PATH / ALCHEME_PROGRAM_IDS_PATH).`
  );
}

function loadConfig(args: CliArgs): InitializeConfig {
  const sourcePath = resolveProgramConfigPath(args);
  const raw = readJsonFile(sourcePath);
  return normalizeConfig(raw, sourcePath);
}

function resolveClusterValue(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }
  if (input === "localnet") {
    return DEFAULT_RPC_URL;
  }
  if (input === "devnet") {
    return "https://api.devnet.solana.com";
  }
  if (input === "testnet") {
    return "https://api.testnet.solana.com";
  }
  if (input === "mainnet-beta") {
    return "https://api.mainnet-beta.solana.com";
  }
  return input;
}

function resolveEndpoint(config: InitializeConfig, args: CliArgs): string {
  const explicitEndpoint =
    args.rpcUrl ||
    process.env.ANCHOR_PROVIDER_URL ||
    process.env.SOLANA_RPC_URL ||
    process.env.RPC_URL;
  if (explicitEndpoint) {
    return resolveClusterValue(explicitEndpoint) || DEFAULT_RPC_URL;
  }

  return (
    resolveClusterValue(args.cluster) ||
    resolveClusterValue(process.env.CLUSTER) ||
    resolveClusterValue(config.network) ||
    DEFAULT_RPC_URL
  );
}

function resolveWalletPath(args: CliArgs): string {
  const walletPath = args.walletPath || process.env.ANCHOR_WALLET || process.env.WALLET_PATH || DEFAULT_WALLET_PATH;
  return resolveFilePath(walletPath);
}

function loadWallet(walletPath: string): Keypair {
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}. Please provide --wallet or set ANCHOR_WALLET/WALLET_PATH.`);
  }
  const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

function buildProgram<T extends Idl>(idlJson: unknown, programId: string, provider: anchor.AnchorProvider): Program<T> {
  const idl = {
    ...(idlJson as Idl),
    address: programId,
  } as Idl;

  return new Program(idl, provider) as unknown as Program<T>;
}

function permissionVariantKey(permission: unknown): string {
  if (!permission || typeof permission !== "object") {
    return "";
  }

  const [variant] = Object.keys(permission as Record<string, unknown>);
  return variant || "";
}

function comparePermissionSets(current: unknown[], desired: Record<string, {}>[]): boolean {
  const currentKeys = current.map(permissionVariantKey).filter(Boolean).sort();
  const desiredKeys = desired.map(permissionVariantKey).filter(Boolean).sort();
  return currentKeys.length === desiredKeys.length && currentKeys.every((key, index) => key === desiredKeys[index]);
}

async function main() {
  console.log("🚀 开始初始化 Alcheme Protocol...");
  console.log(`工作目录: ${process.cwd()}`);

  const args = parseArgs();
  const config = loadConfig(args);
  const walletPath = resolveWalletPath(args);
  const wallet = loadWallet(walletPath);
  const rpcUrl = resolveEndpoint(config, args);

  console.log(`Program ID 配置: ${config.sourcePath}`);
  console.log(`RPC 端点: ${rpcUrl}`);
  console.log(`钱包路径: ${walletPath}`);

  const connection = new Connection(rpcUrl, "confirmed");
  const walletWrapper = new anchor.Wallet(wallet);
  const provider = new anchor.AnchorProvider(connection, walletWrapper, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const programIds = config.programIds;

  const identityRegistry = buildProgram<IdentityRegistry>(identityRegistryIdl, programIds.identity, provider);
  const contentManager = buildProgram<ContentManager>(contentManagerIdl, programIds.content, provider);
  const accessController = buildProgram<AccessController>(accessControllerIdl, programIds.access, provider);
  const eventEmitter = buildProgram<EventEmitter>(eventEmitterIdl, programIds.event, provider);
  const registryFactory = buildProgram<RegistryFactory>(registryFactoryIdl, programIds.factory, provider);
  const messagingManager = buildProgram<MessagingManager>(messagingManagerIdl, programIds.messaging, provider);
  const circleManager = buildProgram<CircleManager>(circleManagerIdl, programIds.circles, provider);

  const admin = walletWrapper;

  console.log(`Using wallet: ${wallet.publicKey.toBase58()}`);

  console.log("\n🔍 程序 ID 验证:");
  console.log(`  identity: ${identityRegistry.programId.toBase58()}`);
  console.log(`  content: ${contentManager.programId.toBase58()}`);
  console.log(`  access: ${accessController.programId.toBase58()}`);
  console.log(`  event: ${eventEmitter.programId.toBase58()}`);
  console.log(`  factory: ${registryFactory.programId.toBase58()}`);
  console.log(`  messaging: ${messagingManager.programId.toBase58()}`);
  console.log(`  circles: ${circleManager.programId.toBase58()}`);

  try {
    console.log("\n📝 初始化 Identity Registry...");
    const identityRegistryName = "social_hub_identity";
    const [identityRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("identity_registry"), Buffer.from(identityRegistryName)],
      identityRegistry.programId,
    );

    console.log(`  计算的 PDA: ${identityRegistryPDA.toBase58()}`);

    const accountInfo = await connection.getAccountInfo(identityRegistryPDA);
    if (accountInfo) {
      if (accountInfo.owner.toBase58() === programIds.identity) {
        console.log("  ✓ Identity Registry already initialized");
      } else {
        console.log("  ❌ 账户已存在但所有者错误！");
        console.log(`  PDA: ${identityRegistryPDA.toBase58()}`);
        console.log(`  当前所有者: ${accountInfo.owner.toBase58()}`);
        console.log(`  期望所有者: ${programIds.identity}`);
        console.log("  💡 解决方案: 校验当前 Program ID 配置与目标集群是否一致");
        throw new Error("账户状态错误，需要先修正 Program ID 配置");
      }
    } else {
      try {
        await identityRegistry.methods
          .initializeIdentityRegistry(
            identityRegistryName,
            "https://socialhub.protocol/metadata",
            {
              allowHandleTransfers: true,
              requireVerification: false,
              enableReputationSystem: true,
              enableSocialFeatures: true,
              enableEconomicTracking: true,
              maxHandlesPerIdentity: 5,
              handleReservationPeriod: new anchor.BN(86400 * 30),
              minimumHandleLength: 3,
              maximumHandleLength: 32,
            },
          )
          .accounts({
            // @ts-ignore
            identityRegistry: identityRegistryPDA,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`  ✓ Identity Registry initialized at ${identityRegistryPDA.toBase58()}`);
      } catch (e: any) {
        console.log("  ❌ 初始化错误详情:");
        console.log(`  错误消息: ${e.message}`);
        if (e.logs) {
          console.log("  错误日志:", e.logs.filter((l: string) => l.includes("Error") || l.includes("Program log")));
        }
        if (e.message.includes("already in use")) {
          console.log("  ✓ Identity Registry already initialized");
        } else if (e.message.includes("AccountOwnedByWrongProgram")) {
          const newAccountInfo = await connection.getAccountInfo(identityRegistryPDA);
          console.log("  ❌ 初始化失败：账户所有者错误！");
          if (newAccountInfo) {
            console.log(`  当前所有者: ${newAccountInfo.owner.toBase58()}`);
            console.log(`  期望所有者: ${programIds.identity}`);
          }
          console.log("  💡 解决方案: 校验当前 Program ID 配置与目标集群是否一致");
          throw new Error("账户状态错误，需要先修正 Program ID 配置");
        } else {
          throw e;
        }
      }
    }

    console.log("\n🔐 初始化 Access Controller...");
    const [accessControllerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("access_controller")],
      accessController.programId,
    );

    try {
      await accessController.methods
        .initializeAccessController()
        .accounts({
          // @ts-ignore
          accessController: accessControllerPDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✓ Access Controller initialized at ${accessControllerPDA.toBase58()}`);
    } catch (e: any) {
      if (e.message.includes("already in use")) {
        console.log("  ✓ Access Controller already initialized");
      } else {
        throw e;
      }
    }

    console.log("\n📡 初始化 Event Emitter...");
    const [eventEmitterPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_emitter")],
      eventEmitter.programId,
    );

    try {
      await eventEmitter.methods
        .initializeEventEmitter(
          {
            chainStorageLimit: 1000,
            archiveToArweave: true,
            useCompression: true,
            batchSize: 50,
            autoArchiveAfterDays: 30,
            maxEventSize: 1024,
          },
          {
            chainRetentionDays: 30,
            archiveRetentionDays: 365,
            autoCleanup: true,
            priorityRetention: [],
          },
        )
        .accounts({
          // @ts-ignore
          eventEmitter: eventEmitterPDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✓ Event Emitter initialized at ${eventEmitterPDA.toBase58()}`);
    } catch (e: any) {
      if (e.message.includes("already in use")) {
        console.log("  ✓ Event Emitter already initialized");
      } else {
        throw e;
      }
    }

    console.log("\n📦 初始化 Content Manager...");
    const [contentManagerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("content_manager")],
      contentManager.programId,
    );

    try {
      await contentManager.methods
        .initializeContentManager(
          // @ts-ignore
          {
            maxContentSize: new anchor.BN(1024 * 1024 * 10),
            maxMediaAttachments: 5,
            defaultStorageStrategy: { hybrid: {} },
            autoModerationEnabled: true,
            threadDepthLimit: 10,
            quoteChainLimit: 5,
          },
          // @ts-ignore
          {
            textThreshold: new anchor.BN(1000),
            mediaThreshold: new anchor.BN(1024 * 1024),
            arweaveEnabled: true,
            ipfsEnabled: true,
            compressionEnabled: true,
            backupEnabled: true,
          },
          {
            autoModeration: true,
            spamDetection: true,
            contentFiltering: true,
            communityModeration: false,
            appealProcess: true,
          },
        )
        .accounts({
          // @ts-ignore
          contentManager: contentManagerPDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✓ Content Manager initialized at ${contentManagerPDA.toBase58()}`);
    } catch (e: any) {
      if (e.message.includes("already in use")) {
        console.log("  ✓ Content Manager already initialized");
      } else {
        throw e;
      }
    }

    console.log("\n💬 初始化 Messaging Manager...");
    const [messagingManagerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("messaging_manager")],
      messagingManager.programId,
    );
    try {
      await messagingManager.methods
        .initialize({
          maxGroupSize: 100,
          maxMessageSize: 5120,
          batchIntervalSeconds: 60,
          batchSize: 50,
          enableReadReceipts: true,
          enableMessageRecall: true,
          recallTimeLimit: new anchor.BN(86400),
          enableEncryption: true,
          requireIdentityVerification: true,
        })
        .accounts({
          // @ts-ignore
          messagingManager: messagingManagerPDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✓ Messaging Manager initialized at ${messagingManagerPDA.toBase58()}`);
    } catch (e: any) {
      if (e.message.includes("already in use")) {
        console.log("  ✓ Messaging Manager already initialized");
      } else if (e.message.includes("This program may not be used for executing instructions")) {
        console.warn("  ⚠ Messaging Manager init skipped: program is unavailable on current cluster");
      } else {
        throw e;
      }
    }

    console.log("\n⭕ 初始化 Circle Manager...");
    const [circleManagerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("circle_manager")],
      circleManager.programId,
    );

    try {
      await circleManager.methods
        .initialize()
        .accounts({
          // @ts-ignore
          circleManager: circleManagerPDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✓ Circle Manager initialized at ${circleManagerPDA.toBase58()}`);
    } catch (e: any) {
      if (e.message.includes("already in use")) {
        console.log("  ✓ Circle Manager already initialized");
      } else {
        throw e;
      }
    }

    console.log("\n🏭 初始化 Registry Factory...");
    const [registryFactoryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_factory")],
      registryFactory.programId,
    );

    try {
      await registryFactory.methods
        .initializeRegistryFactory({
          maxDeploymentsPerUser: 10,
          deploymentFee: new anchor.BN(100_000_000),
          upgradeFee: new anchor.BN(50_000_000),
          requireApproval: false,
          autoUpgradeEnabled: false,
          supportedRegistryTypes: [
            { identity: {} },
            { content: {} },
            { access: {} },
            { event: {} },
          ],
        })
        .accounts({
          // @ts-ignore
          registryFactory: registryFactoryPDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✓ Registry Factory initialized at ${registryFactoryPDA.toBase58()}`);
    } catch (e: any) {
      if (e.message.includes("already in use")) {
        console.log("  ✓ Registry Factory already initialized");
      } else {
        throw e;
      }
    }

    console.log("\n🧩 初始化 Extension Registry...");
    const [extensionRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("extension_registry")],
      registryFactory.programId,
    );

    let extensionRegistryAccount: any | null = null;
    try {
      extensionRegistryAccount = await (registryFactory.account as any).extensionRegistryAccount.fetch(extensionRegistryPDA);
      console.log(`  ✓ Extension Registry already initialized at ${extensionRegistryPDA.toBase58()}`);
    } catch {
      try {
        await (registryFactory.methods as any)
          .initializeExtensionRegistry(32)
          .accounts({
            // @ts-ignore
            extensionRegistry: extensionRegistryPDA,
            registryFactory: registryFactoryPDA,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`  ✓ Extension Registry initialized at ${extensionRegistryPDA.toBase58()}`);
        extensionRegistryAccount = await (registryFactory.account as any).extensionRegistryAccount.fetch(extensionRegistryPDA);
      } catch (e: any) {
        if (e.message.includes("already in use")) {
          console.log("  ✓ Extension Registry already initialized");
          extensionRegistryAccount = await (registryFactory.account as any).extensionRegistryAccount.fetch(extensionRegistryPDA);
        } else {
          throw e;
        }
      }
    }

    const contributionEngineRegistration = resolveContributionEngineRegistration(programIds);
    if (!contributionEngineRegistration) {
      console.log("  ℹ No contribution-engine program ID configured; skipping extension registration");
    } else {
      console.log("\n🪪 注册 Contribution Engine 扩展...");
      const registryInner = extensionRegistryAccount?.inner ?? extensionRegistryAccount;
      const registeredExtensions = registryInner?.extensions || [];
      const existingContributionEngine = registeredExtensions.find((extension: any) => {
        const programKey = extension.programId ?? extension.program_id;
        return programKey && new PublicKey(programKey).toBase58() === contributionEngineRegistration.programId;
      });

      if (!existingContributionEngine) {
        await (registryFactory.methods as any)
          .registerExtension(
            new PublicKey(contributionEngineRegistration.programId),
            contributionEngineRegistration.permissions,
          )
          .accounts({
            // @ts-ignore
            extensionRegistry: extensionRegistryPDA,
            admin: admin.publicKey,
          })
          .rpc();
        console.log(
          `  ✓ Contribution Engine registered with permissions: ${contributionEngineRegistration.permissions
            .map(permissionVariantKey)
            .join(", ")}`
        );
      } else if (
        comparePermissionSets(existingContributionEngine.permissions || [], contributionEngineRegistration.permissions)
      ) {
        console.log("  ✓ Contribution Engine already registered with the desired permissions");
      } else {
        await (registryFactory.methods as any)
          .updateExtensionPermissions(
            new PublicKey(contributionEngineRegistration.programId),
            contributionEngineRegistration.permissions,
          )
          .accounts({
            // @ts-ignore
            extensionRegistry: extensionRegistryPDA,
            admin: admin.publicKey,
          })
          .rpc();
        console.log(
          `  ✓ Contribution Engine permissions updated to: ${contributionEngineRegistration.permissions
            .map(permissionVariantKey)
            .join(", ")}`
        );
      }
    }

    console.log("\n✅ 所有程序初始化完成！");
  } catch (error) {
    console.error("\n❌ 初始化失败:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
