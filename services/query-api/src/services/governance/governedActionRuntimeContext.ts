import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type { GovernedActionRuntimeContext } from './externalGovernedActionReadiness';
import type { GovernanceSignalChainId } from './signalEnvelopeV2';

const KNOWN_NETWORKS = ['solana:localnet', 'solana:devnet'] as const;
const SOURCE_DOMAIN = 'alcheme.governance.governed-action-runtime-network-source-v1';

export type GovernedActionRuntimeContextResolution = GovernedActionRuntimeContext & {
  sourceDigest: string;
};

export function isKnownGovernedActionNetwork(
  value: unknown,
): value is GovernanceSignalChainId {
  return value === 'solana:localnet' || value === 'solana:devnet';
}

export function resolveDeploymentAllowedNetworks(
  env: Record<string, string | undefined> = process.env,
): GovernanceSignalChainId[] {
  const raw = env.GOVERNANCE_ALLOWED_NETWORKS?.trim();
  if (!raw) return [...KNOWN_NETWORKS];
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('governed_action_allowed_networks_invalid');
  }
  const allowed: GovernanceSignalChainId[] = [];
  for (const part of parts) {
    if (!isKnownGovernedActionNetwork(part)) {
      throw new Error('governed_action_network_unknown');
    }
    if (!allowed.includes(part)) allowed.push(part);
  }
  return allowed;
}

export function resolveGovernedActionRuntimeContext(input: {
  binding?: {
    authoritySelector?: Record<string, unknown> | null;
  } | null;
  mandateNetwork?: unknown;
  aapbSelectorNetwork?: unknown;
  adapterNetwork?: unknown;
  /** Ignored — UI/payload self-reported network is never authoritative. */
  payloadNetwork?: unknown;
  allowedNetworks?: readonly string[];
  env?: Record<string, string | undefined>;
}): GovernedActionRuntimeContextResolution {
  void input.payloadNetwork;
  const selector = input.binding?.authoritySelector && typeof input.binding.authoritySelector === 'object'
    ? input.binding.authoritySelector
    : {};
  const selectorNetwork = typeof selector.network === 'string' ? selector.network.trim() : '';
  const environment = typeof selector.environment === 'string' && selector.environment.trim()
    ? selector.environment.trim()
    : 'local_development';

  if (!selectorNetwork) {
    throw new Error('governed_action_network_required');
  }
  if (!isKnownGovernedActionNetwork(selectorNetwork)) {
    throw new Error('governed_action_network_unknown');
  }

  const allowedNetworks = input.allowedNetworks
    ?? resolveDeploymentAllowedNetworks(input.env ?? process.env);
  if (!allowedNetworks.includes(selectorNetwork)) {
    throw new Error('governed_action_network_not_allowed');
  }

  for (const candidate of [
    input.mandateNetwork,
    input.aapbSelectorNetwork,
    input.adapterNetwork,
  ]) {
    if (candidate == null || candidate === '') continue;
    if (String(candidate).trim() !== selectorNetwork) {
      throw new Error('governed_action_network_mismatch');
    }
  }

  const sourceFacts = {
    network: selectorNetwork,
    environment,
    allowedNetworks: [...allowedNetworks],
    mandateNetwork: normalizeOptionalNetwork(input.mandateNetwork),
    aapbSelectorNetwork: normalizeOptionalNetwork(input.aapbSelectorNetwork),
    adapterNetwork: normalizeOptionalNetwork(input.adapterNetwork),
  };

  return {
    network: selectorNetwork,
    environment,
    allowedNetworks,
    sourceDigest: hashCanonicalGovernanceValue(SOURCE_DOMAIN, sourceFacts),
  };
}

function normalizeOptionalNetwork(value: unknown): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  return normalized || null;
}
