export type GovernedActionEffect =
  | { kind: 'external_authoritative'; credentialProfileRef: string; readbackProfileRef: string }
  | { kind: 'local_transactional'; executorRef: string };

export type VerifiedProducerContext =
  | { kind: 'native_user'; actorPubkey: string; actorRole: string }
  | { kind: 'route_a_server_intent'; externalAppId: string; preparationRef: string }
  | { kind: 'hosted_app_session'; installationId: string; sessionId: string };

export type PublicSafeCandidatePage = {
  actionType: string;
  items: Array<{
    candidateRef: string;
    displayName: string;
    statusSummary: string;
    capacitySummary?: string;
    policySummary?: string;
    snapshotVersion: string;
    snapshotDigest: string;
    expiresAt?: string;
  }>;
  nextCursor: string | null;
};

export type CanonicalIntent = {
  actionType: string;
  effect: GovernedActionEffect;
  subjectType: string;
  subjectRef: string;
  operationPayload: Record<string, unknown>;
  statePrecondition: Record<string, unknown> | null;
  snapshotVersion?: string;
  snapshotDigest?: string;
  expiresAt?: string | null;
  connectorTrustProfile?: string | null;
  preview: NativeActionPreview;
};

export type NativeActionPreview = {
  title: string;
  summary: string;
  displayName: string;
  statusSummary: string;
  technicalDetailsCollapsed: true;
};

export type PreparedGovernedActionIntent = {
  preparationDigest: string;
  actionType: string;
  effect: GovernedActionEffect;
  preview: NativeActionPreview;
  candidateRef: string;
  expectedSnapshotVersion: string;
  expectedSnapshotDigest: string;
  subjectType: string;
  subjectRef: string;
  operationPayload: Record<string, unknown>;
  statePrecondition: Record<string, unknown> | null;
  rationale: string;
};

export type IntakeAdapterContext = {
  confirmingActorSession: { actorPubkey: string; actorRole: string };
  verifiedProducerContext: VerifiedProducerContext;
  externalAppId?: string | null;
  circleId: number;
};

export interface GovernedActionIntakeAdapter {
  actionType: string;
  effect: GovernedActionEffect;
  listCandidates(context: IntakeAdapterContext): Promise<PublicSafeCandidatePage>;
  resolveCanonicalIntent(
    context: IntakeAdapterContext,
    candidateRef: string,
    expectedSnapshotVersion: string,
    expectedSnapshotDigest: string,
  ): Promise<CanonicalIntent>;
  projectNativePreview(intent: CanonicalIntent): NativeActionPreview;
}

export class ExternalGovernedActionIntakeError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.name = 'ExternalGovernedActionIntakeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
