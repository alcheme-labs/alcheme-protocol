import fs from "fs";
import path from "path";

import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

export type ExtensionRuntimeSource = "chain" | "unavailable";
export type ExtensionManifestSource = "configured" | "auto_discovered" | "missing";
export type ExtensionRegistrationStatus =
  | "not_registered"
  | "registered_enabled"
  | "registered_disabled"
  | "runtime_unavailable";

export interface ExtensionRuntimeRecord {
  registered: boolean;
  enabled: boolean | null;
  permissions: string[] | null;
  source: ExtensionRuntimeSource;
  registrationStatus: ExtensionRegistrationStatus;
  reason: string | null;
}

export interface ExtensionCapabilityRecord {
  extensionId: string;
  displayName: string;
  programId: string;
  version: string;
  parserVersion: string;
  status: string;
  reason: string | null;
  sdkPackage: string;
  requiredPermissions: string[];
  tags: string[];
  sourceManifestPath: string;
  runtime: ExtensionRuntimeRecord;
}

interface ExtensionManifestShape {
  extension_id?: unknown;
  display_name?: unknown;
  program_id?: unknown;
  version?: unknown;
  parser_contract_version?: unknown;
  status?: unknown;
  sdk_package?: unknown;
  required_permissions?: unknown;
  tags?: unknown;
}

export interface ExtensionRuntimeSnapshot {
  source: ExtensionRuntimeSource;
  reason: string | null;
  entries: Record<
    string,
    {
      enabled: boolean;
      permissions: string[];
    }
  >;
}

interface RegistryFactoryIdlShape extends Idl {
  address: string;
}

interface LoadExtensionCatalogOptions {
  runtimeLoader?: () => Promise<ExtensionRuntimeSnapshot>;
}

interface ExtensionCatalogPayload {
  generatedAt: string;
  manifestSource: ExtensionManifestSource;
  manifestReason: string | null;
  capabilities: ExtensionCapabilityRecord[];
  skippedFiles: string[];
}

interface ExtensionCatalogCache {
  expiresAtMs: number;
  payload: ExtensionCatalogPayload;
}

function loadRegistryFactoryIdl(): RegistryFactoryIdlShape {
  const idlPath = path.resolve(__dirname, "..", "idl", "registry_factory.json");

  if (!fs.existsSync(idlPath)) {
    throw new Error(
      `Missing query-api registry_factory idl asset at ${idlPath}. Run the query-api build to copy static assets into dist/.`
    );
  }

  return JSON.parse(fs.readFileSync(idlPath, "utf8")) as RegistryFactoryIdlShape;
}

const registryFactoryIdl = loadRegistryFactoryIdl();
const registryFactoryIdlTyped = registryFactoryIdl as Idl;
const registryFactoryProgramId = new PublicKey(
  registryFactoryIdl.address
);
const extensionRegistryPda = PublicKey.findProgramAddressSync(
  [Buffer.from("extension_registry")],
  registryFactoryProgramId
)[0];

let cachedCatalog: ExtensionCatalogCache | null = null;

function getCacheTtlMs(): number {
  const ttl = Number(process.env.EXTENSION_CAPABILITY_CACHE_TTL_MS || "5000");
  return Number.isFinite(ttl) && ttl >= 0 ? ttl : 5000;
}

function resolveManifestRoot(): {
  root: string | null;
  manifestSource: ExtensionManifestSource;
  manifestReason: string | null;
} {
  const configured = process.env.EXTENSION_MANIFEST_ROOT?.trim();
  if (configured) {
    const absolute = path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
    if (fs.existsSync(absolute)) {
      return {
        root: absolute,
        manifestSource: "configured",
        manifestReason: null,
      };
    }

    return {
      root: null,
      manifestSource: "missing",
      manifestReason: "manifest_root_missing",
    };
  }

  const candidates = [
    path.resolve(process.cwd(), "extensions"),
    path.resolve(process.cwd(), "..", "..", "extensions"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        root: candidate,
        manifestSource: "auto_discovered",
        manifestReason: null,
      };
    }
  }

  return {
    root: null,
    manifestSource: "missing",
    manifestReason: "manifest_root_missing",
  };
}

function findManifestFiles(root: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "extension.manifest.json") {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files;
}

function getStatusReason(status: string): string | null {
  if (status === "suspended") return "suspended_by_governance";
  if (status === "deprecated") return "deprecated_extension";
  if (status === "draft") return "draft_not_enabled";
  return null;
}

function normalizePermissionName(permission: unknown): string {
  if (typeof permission === "string") return permission;
  if (permission && typeof permission === "object") {
    const [variant] = Object.keys(permission as Record<string, unknown>);
    if (variant) return variant.charAt(0).toUpperCase() + variant.slice(1);
  }
  return "Unknown";
}

function buildRuntimeRecord(
  programId: string,
  snapshot: ExtensionRuntimeSnapshot
): ExtensionRuntimeRecord {
  if (snapshot.source === "unavailable") {
    return {
      registered: false,
      enabled: null,
      permissions: null,
      source: "unavailable",
      registrationStatus: "runtime_unavailable",
      reason: snapshot.reason,
    };
  }

  const entry = snapshot.entries[programId];
  if (!entry) {
    return {
      registered: false,
      enabled: null,
      permissions: null,
      source: "chain",
      registrationStatus: "not_registered",
      reason: null,
    };
  }

  return {
    registered: true,
    enabled: entry.enabled,
    permissions: [...entry.permissions].sort(),
    source: "chain",
    registrationStatus: entry.enabled
      ? "registered_enabled"
      : "registered_disabled",
    reason: null,
  };
}

function parseManifest(
  filePath: string,
  root: string,
  runtime: ExtensionRuntimeSnapshot
): ExtensionCapabilityRecord | null {
  const raw = fs.readFileSync(filePath, "utf8");
  const manifest = JSON.parse(raw) as ExtensionManifestShape;

  if (
    typeof manifest.extension_id !== "string" ||
    typeof manifest.display_name !== "string" ||
    typeof manifest.program_id !== "string" ||
    typeof manifest.version !== "string" ||
    typeof manifest.parser_contract_version !== "string" ||
    typeof manifest.sdk_package !== "string" ||
    !Array.isArray(manifest.required_permissions)
  ) {
    return null;
  }

  const status =
    typeof manifest.status === "string" ? manifest.status : "active";
  const tags = Array.isArray(manifest.tags)
    ? manifest.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const requiredPermissions = manifest.required_permissions.filter(
    (permission): permission is string => typeof permission === "string"
  );

  return {
    extensionId: manifest.extension_id,
    displayName: manifest.display_name,
    programId: manifest.program_id,
    version: manifest.version,
    parserVersion: manifest.parser_contract_version,
    status,
    reason: getStatusReason(status),
    sdkPackage: manifest.sdk_package,
    requiredPermissions,
    tags,
    sourceManifestPath: path.relative(root, filePath),
    runtime: buildRuntimeRecord(manifest.program_id, runtime),
  };
}

function resolveRuntimeRpcUrl(): string | null {
  const candidates = [process.env.SOLANA_RPC_URL, process.env.RPC_URL];
  for (const candidate of candidates) {
    if (candidate?.trim()) return candidate.trim();
  }
  return null;
}

export async function loadExtensionRuntimeSnapshot(): Promise<ExtensionRuntimeSnapshot> {
  const rpcUrl = resolveRuntimeRpcUrl();
  if (!rpcUrl) {
    return {
      source: "unavailable",
      reason: "missing_rpc_url",
      entries: {},
    };
  }

  const connection = new Connection(rpcUrl, "confirmed");
  let accountInfo: Awaited<ReturnType<Connection["getAccountInfo"]>>;

  try {
    accountInfo = await connection.getAccountInfo(extensionRegistryPda);
  } catch {
    return {
      source: "unavailable",
      reason: "runtime_lookup_failed",
      entries: {},
    };
  }

  if (!accountInfo) {
    return {
      source: "unavailable",
      reason: "extension_registry_missing",
      entries: {},
    };
  }

  try {
    const coder = new BorshCoder(registryFactoryIdlTyped);
    const decoded = coder.accounts.decode(
      "ExtensionRegistryAccount",
      accountInfo.data
    ) as {
      inner?: {
        extensions?: Array<{
          program_id?: PublicKey;
          programId?: PublicKey;
          enabled?: boolean;
          permissions?: unknown[];
        }>;
      };
      extensions?: Array<{
        program_id?: PublicKey;
        programId?: PublicKey;
        enabled?: boolean;
        permissions?: unknown[];
      }>;
    };

    const inner = decoded.inner ?? decoded;
    const entries = Object.fromEntries(
      (inner.extensions || []).map((extension) => {
        const programKey = extension.programId ?? extension.program_id;
        const programId = new PublicKey(programKey as PublicKey).toBase58();
        const permissions = (extension.permissions || [])
          .map(normalizePermissionName)
          .sort();
        return [
          programId,
          {
            enabled: Boolean(extension.enabled),
            permissions,
          },
        ];
      })
    );

    return {
      source: "chain",
      reason: null,
      entries,
    };
  } catch {
    return {
      source: "unavailable",
      reason: "runtime_decode_failed",
      entries: {},
    };
  }
}

export function clearExtensionCatalogCache(): void {
  cachedCatalog = null;
}

export async function loadExtensionCatalog(
  options: LoadExtensionCatalogOptions = {}
): Promise<ExtensionCatalogPayload> {
  const ttlMs = getCacheTtlMs();
  const now = Date.now();
  const useCache = !options.runtimeLoader;
  if (useCache && cachedCatalog && now <= cachedCatalog.expiresAtMs) {
    return cachedCatalog.payload;
  }

  const runtimeLoader = options.runtimeLoader ?? loadExtensionRuntimeSnapshot;
  const runtimeSnapshot = await runtimeLoader();
  const manifestRoot = resolveManifestRoot();
  const manifestsRoot = manifestRoot.root;
  if (!manifestsRoot) {
    const emptyPayload: ExtensionCatalogPayload = {
      generatedAt: new Date().toISOString(),
      manifestSource: manifestRoot.manifestSource,
      manifestReason: manifestRoot.manifestReason,
      capabilities: [],
      skippedFiles: [],
    };
    if (useCache) {
      cachedCatalog = {
        expiresAtMs: now + ttlMs,
        payload: emptyPayload,
      };
    }
    return emptyPayload;
  }

  const files = findManifestFiles(manifestsRoot);
  const capabilities: ExtensionCapabilityRecord[] = [];
  const skippedFiles: string[] = [];

  for (const filePath of files) {
    try {
      const parsed = parseManifest(filePath, manifestsRoot, runtimeSnapshot);
      if (!parsed) {
        skippedFiles.push(path.relative(manifestsRoot, filePath));
        continue;
      }
      capabilities.push(parsed);
    } catch {
      skippedFiles.push(path.relative(manifestsRoot, filePath));
    }
  }

  capabilities.sort((a, b) => a.extensionId.localeCompare(b.extensionId));

  const payload: ExtensionCatalogPayload = {
    generatedAt: new Date().toISOString(),
    manifestSource: manifestRoot.manifestSource,
    manifestReason: manifestRoot.manifestReason,
    capabilities,
    skippedFiles,
  };

  if (useCache) {
    cachedCatalog = {
      expiresAtMs: now + ttlMs,
      payload,
    };
  }

  return payload;
}
