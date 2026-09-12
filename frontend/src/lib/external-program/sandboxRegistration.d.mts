export interface SandboxExternalProgramManifestInput {
  version: '1';
  appId: string;
  name: string;
  homeUrl: string;
  ownerWallet: string;
  serverPublicKey: string;
  allowedOrigins: string[];
  capabilities: string[];
  platforms?: Record<string, unknown>;
  callbacks?: Record<string, unknown>;
  policy?: Record<string, unknown>;
}

export interface SandboxExternalProgramManifest extends SandboxExternalProgramManifestInput {}

export interface SandboxExternalProgramOwnerAssertionInput {
  appId: string;
  ownerWallet: string;
  manifestHash: string;
  expiresAt: string;
  nonce: string;
}

export interface SandboxExternalProgramOwnerAssertionPayload
  extends SandboxExternalProgramOwnerAssertionInput {
  audience: 'alcheme:external-app-sandbox-registration';
}

export const SANDBOX_REGISTRATION_AUDIENCE:
  'alcheme:external-app-sandbox-registration';
export function normalizeSandboxExternalProgramManifest(
  input: SandboxExternalProgramManifestInput,
): SandboxExternalProgramManifest;
export function computeSandboxExternalProgramManifestHash(
  input: SandboxExternalProgramManifestInput,
): Promise<string>;
export function buildSandboxExternalProgramOwnerAssertionPayload(
  input: SandboxExternalProgramOwnerAssertionInput,
): SandboxExternalProgramOwnerAssertionPayload;
export function encodeExternalProgramOwnerAssertionPayload(
  input: SandboxExternalProgramOwnerAssertionInput,
): string;
export function bytesToBase64(bytes: Uint8Array): string;
export function stableStringify(value: unknown): string;
