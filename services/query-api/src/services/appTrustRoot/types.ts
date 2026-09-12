export type AppTrustRootProductionStatus =
  | "sandbox"
  | "reviewed"
  | "production"
  | "limited"
  | "suspended"
  | "revoked";

export type AppTrustRootCommitmentType =
  | "app_identity"
  | "app_release"
  | "release_channel"
  | "credential_envelope"
  | "credential_issuer"
  | "credential_schema"
  | "revocation_snapshot"
  | "risk_signal"
  | "economic_state"
  | "external_execution";

export interface AppTrustRootCommitment {
  commitmentType: AppTrustRootCommitmentType;
  subjectRef: string;
  payloadDigest: string;
  commitmentDigest: string;
}

export interface AppTrustRootCredentialEnvelope {
  credentialId: string;
  credentialType: string;
  issuerRef: string;
  subjectRef: string;
  audienceRef: string;
  scopeRef: string;
  replayDomain: string;
  nonce: string;
  payloadDigest: string;
  schemaRef: string;
  verifierPolicyRef: string;
  validFrom: string;
  expiresAt: string;
  revocationRef: string | null;
  chainAnchorRef: string | null;
  envelopeDigest: string;
}
