import type { PrismaClient } from '@prisma/client';

import {
  resolveProductionCredentialContext,
  type HostedAppProductionCredentialContext,
} from '../hostedApps/credentialRegistry';

const GOVERNANCE_ISSUER_SCOPE = 'governance-case-decision';
const GOVERNANCE_PRIVATE_KEY_ENV_PREFIX = 'GOVERNANCE_CREDENTIAL_PRIVATE_JWK';

export function resolveGovernanceProductionCredentialContext(
  prisma: PrismaClient,
  input: {
    credentialType: string;
    schemaRef: string;
    verifierPolicyRef: string;
    now: Date;
    requireChainAnchors?: boolean;
  },
): Promise<HostedAppProductionCredentialContext> {
  return resolveProductionCredentialContext(prisma, {
    ...input,
    issuerScope: GOVERNANCE_ISSUER_SCOPE,
    privateKeyEnvPrefix: GOVERNANCE_PRIVATE_KEY_ENV_PREFIX,
  });
}
