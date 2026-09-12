import type { AppTrustRootCredentialEnvelope } from './types';
import {
  buildProductionOfflineVerificationBundle as buildHostedProductionOfflineVerificationBundle,
  signProductionCredentialEnvelope as signHostedProductionCredentialEnvelope,
  type ProductionSignedCredential,
} from '../hostedApps/credentialLayer';
import type { HostedAppProductionCredentialContext } from '../hostedApps/credentialRegistry';

/**
 * Domain-neutral trust-root facade. The existing hosted-app implementation
 * remains the single signer and bundle builder; callers supply their own
 * issuer scope and policy through the resolved context.
 */
export type ProductionCredentialContext = HostedAppProductionCredentialContext;
export type { ProductionSignedCredential };

export function signProductionCredentialEnvelope(
  context: ProductionCredentialContext,
  envelope: AppTrustRootCredentialEnvelope,
): Promise<ProductionSignedCredential> {
  return signHostedProductionCredentialEnvelope(context, envelope);
}

export function buildProductionOfflineVerificationBundle(
  contexts: ProductionCredentialContext[],
  options: {
    now?: Date;
    chainAnchorRefs?: string[];
    requireChainAnchors?: boolean;
    bundleId?: string;
    redactionPolicyRef?: string;
  } = {},
) {
  return buildHostedProductionOfflineVerificationBundle(contexts, options);
}
