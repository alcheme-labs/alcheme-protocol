import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const queryApiRequire = createRequire(join(rootDir, "services/query-api/package.json"));

const apiBaseUrl = process.env.ALCHEME_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const appId = process.env.ALCHEME_EXTERNAL_APP_ID ?? "smoke-web3-game";
const ownerPubkey = process.env.ALCHEME_EXTERNAL_OWNER_PUBKEY ?? "";
const origin = process.env.ALCHEME_EXTERNAL_ORIGIN ?? "http://127.0.0.1:5173";
const registryMode = process.env.EXTERNAL_APP_REGISTRY_MODE ?? "disabled";
const executeChain = process.env.ALCHEME_EXTERNAL_APP_REGISTRY_EXECUTE === "true";

async function main() {
  const manifest = buildManifest();
  const manifestHash = `sha256:${sha256(stableStringify(manifest))}`;
  const appIdHash = sha256(`alcheme:external-app:v2:${appId}`);

  let chainSubmit = { skipped: true, reason: "ALCHEME_EXTERNAL_APP_REGISTRY_EXECUTE_not_true" };
  if (executeChain) {
    chainSubmit = await submitChainSmoke({ manifestHash, appIdHash });
  }

  const discovery = await fetchDiscovery();
  const projection = await loadProjection(appId, appIdHash);
  assertRequiredModeInvariant({ discovery, projection });

  console.log(
    JSON.stringify(
      {
        ok: true,
        appId,
        registryMode,
        manifestHash,
        appIdHash,
        chainSubmit,
        projection,
        discoveryListed: discovery.apps.some((app) => app.id === appId),
      },
      null,
      2,
    ),
  );
}

function buildManifest() {
  return {
    version: "1",
    appId,
    name: process.env.ALCHEME_EXTERNAL_APP_NAME ?? "Smoke Web3 Game",
    homeUrl: origin,
    ownerWallet: ownerPubkey ? `solana:devnet:${ownerPubkey}` : "solana:devnet:unknown",
    serverPublicKey: process.env.ALCHEME_EXTERNAL_SERVER_PUBLIC_KEY ?? "local-smoke-server-key",
    allowedOrigins: [origin],
    capabilities: ["communication.rooms", "voice.livekit"],
  };
}

async function submitChainSmoke({ manifestHash, appIdHash }) {
  if (!ownerPubkey) {
    throw new Error("ALCHEME_EXTERNAL_OWNER_PUBKEY_required_for_chain_execute");
  }
  const adapterPath = join(
    rootDir,
    "services/query-api/dist/services/externalApps/chainRegistryAdapter.js",
  );
  let adapterModule;
  try {
    adapterModule = await import(adapterPath);
  } catch {
    throw new Error("query_api_dist_chain_registry_adapter_missing_run_npm_prefix_services_query_api_run_build");
  }
  const adapter = adapterModule.createExternalAppRegistryAdapter();
  const payload = {
    externalAppId: appId,
    appIdHash,
    ownerPubkey,
    serverKeyHash: sha256(
      stableStringify({
        domain: "alcheme:external-app-server-key:v2",
        serverPublicKey: process.env.ALCHEME_EXTERNAL_SERVER_PUBLIC_KEY ?? "local-smoke-server-key",
      }),
    ),
    manifestHashHex: manifestHash.slice("sha256:".length),
    ownerAssertionHash: sha256("alcheme:external-app-owner-assertion:v2:local-smoke"),
    policyStateDigest: sha256(stableStringify({ origin, mode: registryMode })),
    reviewCircleId: Number(process.env.ALCHEME_EXTERNAL_REVIEW_CIRCLE_ID ?? "0"),
    reviewPolicyDigest: sha256("alcheme:external-app-review-policy:v2:local-smoke"),
    decisionDigest: sha256("alcheme:external-app-decision:v2:local-smoke"),
    executionIntentDigest: sha256("alcheme:external-app-execution-intent:v2:local-smoke"),
    expiresAt: null,
  };
  const registration = await adapter.anchorExternalAppRegistration(payload);
  const receipt = await adapter.anchorExecutionReceipt({
    externalAppId: appId,
    appIdHash,
    executionReceiptDigest: sha256(
      stableStringify({
        domain: "alcheme:external-app-governance-execution-receipt:v2",
        appId,
        registration,
      }),
    ),
  });
  return {
    skipped: false,
    registration,
    receipt,
  };
}

async function fetchDiscovery() {
  const response = await fetch(`${apiBaseUrl}/external-apps/discovery`);
  if (!response.ok) {
    throw new Error(`external_app_discovery_failed:${response.status}`);
  }
  const parsed = await response.json();
  return { apps: Array.isArray(parsed.apps) ? parsed.apps : [] };
}

async function loadProjection(externalAppId, appIdHash) {
  let PrismaClient;
  try {
    ({ PrismaClient } = queryApiRequire("@prisma/client"));
  } catch {
    return { skipped: true, reason: "prisma_client_unavailable" };
  }
  const prisma = new PrismaClient();
  try {
    try {
      const app = await prisma.externalApp.findUnique({
        where: { id: externalAppId },
        select: {
          id: true,
          environment: true,
          registryStatus: true,
          discoveryStatus: true,
          manifestHash: true,
        },
      });
      const anchorClient = prisma.externalAppRegistryAnchor;
      const anchor = anchorClient
        ? await anchorClient.findFirst({
            where: { OR: [{ externalAppId }, { appIdHash }] },
            select: {
              externalAppId: true,
              appIdHash: true,
              recordPda: true,
              registryStatus: true,
              finalityStatus: true,
              receiptFinalityStatus: true,
              txSignature: true,
              receiptTxSignature: true,
            },
          })
        : null;
      return { app, anchor };
    } catch (error) {
      return {
        skipped: true,
        reason: `prisma_projection_unavailable:${shortError(error)}`,
      };
    }
  } finally {
    await prisma.$disconnect();
  }
}

function assertRequiredModeInvariant({ discovery, projection }) {
  if (projection.skipped) return;
  if (registryMode !== "required") return;
  const app = projection.app;
  if (!app || app.environment !== "mainnet_production") return;

  const listed = discovery.apps.some((item) => item.id === app.id);
  const anchor = projection.anchor;
  const trusted =
    anchor &&
    anchor.registryStatus === "active" &&
    ["confirmed", "finalized"].includes(anchor.finalityStatus) &&
    ["confirmed", "finalized"].includes(anchor.receiptFinalityStatus);

  if (listed && !trusted) {
    throw new Error("required_mode_discovery_listed_untrusted_external_app");
  }
}

function stableStringify(input) {
  return JSON.stringify(stableSortValue(input));
}

function stableSortValue(input) {
  if (Array.isArray(input)) return input.map(stableSortValue);
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .filter((key) => input[key] !== undefined)
        .map((key) => [key, stableSortValue(input[key])]),
    );
  }
  return input;
}

function sha256(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

function shortError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n").find((line) => line.trim())?.trim() ?? "unknown_error";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
