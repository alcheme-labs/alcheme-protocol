import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import {
  getSnsProviderTrustProfile,
  getSnsProviderTrustProfileDigest,
  resolveSnsProviderTrustReadiness,
} from './snsProviderTrustProfile';

export type SnsResolvePurpose =
  | 'display'
  | 'transfer'
  | 'invite'
  | 'allowlist'
  | 'authority_input';

export type SnsForwardResolveObservation = {
  walletPubkey: string;
  primaryDomain: string | null;
  resolvedPubkey: string | null;
  observedSlot: number;
  commitment: 'finalized';
  programId: string;
  chainId: 'solana:devnet';
  recordAuthorityValid: boolean;
  tokenizedDomain: boolean;
  stale: boolean;
  authoritative: true;
  selfProvesResolution: false;
};

export type SnsResolveReader = {
  readPrimaryForwardResolve(input: {
    walletPubkey: string;
    programId: string;
    chainId: 'solana:devnet';
  }): Promise<SnsForwardResolveObservation>;
};

export type SnsNameFieldAuthority =
  | 'circle_alias'
  | 'user_profile'
  | 'circle_name'
  | 'external_app_name'
  | 'sns_domain';

export type SnsDisplayProjection = {
  canonicalActorPubkey: string;
  circleAlias: string | null;
  profileLabel: string | null;
  secondarySnsLabel: string | null;
  socialPrimaryLabel: string;
  socialPrimarySource: 'circle_alias' | 'profile' | 'generic_member';
  displaySource: 'sns_primary_secondary' | 'circle_alias' | 'profile' | 'generic_member';
  trustedSource: 'sns_name_service' | 'alcheme_profile' | 'none';
  observedSlot: number | null;
  profileRef: string;
  profileDigest: string;
  isOfficialAlchemeCertification: false;
  optInExternalDisplayFallback: boolean;
  disclosureAccepted: boolean;
  highRiskRequiresFreshResolve: true;
};

export type SnsHistorySnapshot = {
  displayLabel: string | null;
  domain: string | null;
  resolvedPubkey: string;
  observedSlot: number;
  actorPubkeyImmutable: true;
};

export type SnsProgramPresenceObservation = {
  programId: string;
  executable: true;
  observedSlot: number;
  commitment: 'finalized';
  authoritative: true;
  selfProvesResolution: false;
};

let snsResolveReader: SnsResolveReader | null = null;

export function setSnsResolveReader(reader: SnsResolveReader | null): void {
  snsResolveReader = reader;
}

export function getSnsResolveReader(): SnsResolveReader | null {
  return snsResolveReader;
}

function assertPubkey(value: string, code: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(code);
  }
}

function looksLikeSolDomain(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.endsWith('.sol') || trimmed.includes('.sol');
}

export function assertCanonicalActorKeyIsPubkey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || looksLikeSolDomain(trimmed)) {
    throw new Error('sns_actor_key_must_be_pubkey');
  }
  return assertPubkey(trimmed, 'sns_actor_key_must_be_pubkey');
}

export function separateNameFieldAuthorities(input: {
  circleAlias?: string | null;
  userProfile?: string | null;
  circleName?: string | null;
  externalAppName?: string | null;
  snsDomain?: string | null;
}): Record<SnsNameFieldAuthority, string | null> {
  return {
    circle_alias: normalizeOptionalLabel(input.circleAlias),
    user_profile: normalizeOptionalLabel(input.userProfile),
    circle_name: normalizeOptionalLabel(input.circleName),
    external_app_name: normalizeOptionalLabel(input.externalAppName),
    sns_domain: normalizeOptionalLabel(input.snsDomain),
  };
}

export function sameNameDoesNotLinkIdentity(input: {
  left: { field: SnsNameFieldAuthority; value: string };
  right: { field: SnsNameFieldAuthority; value: string };
}): { ownershipLink: false; identityLink: false } {
  if (input.left.field === input.right.field && input.left.value === input.right.value) {
    return { ownershipLink: false, identityLink: false };
  }
  return { ownershipLink: false, identityLink: false };
}

function normalizeOptionalLabel(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function normalizeObservation(
  value: SnsForwardResolveObservation,
  expected: { walletPubkey: string; programId: string; chainId: 'solana:devnet' },
): SnsForwardResolveObservation {
  if (
    value.commitment !== 'finalized'
    || value.authoritative !== true
    || value.selfProvesResolution !== false
    || value.programId !== expected.programId
    || value.chainId !== expected.chainId
    || value.walletPubkey !== expected.walletPubkey
    || !Number.isSafeInteger(value.observedSlot)
    || value.observedSlot < 0
  ) {
    throw new Error('sns_resolve_observation_invalid');
  }
  if (value.primaryDomain != null) {
    const domain = value.primaryDomain.trim().toLowerCase();
    if (!domain.endsWith('.sol') || domain === '.sol' || domain.includes(' ')) {
      throw new Error('sns_primary_domain_invalid');
    }
    if (!value.resolvedPubkey) throw new Error('sns_primary_resolve_pubkey_required');
    assertPubkey(value.resolvedPubkey, 'sns_primary_resolve_pubkey_invalid');
    if (value.stale || !value.recordAuthorityValid) {
      throw new Error('sns_primary_record_not_authoritative');
    }
  } else if (value.resolvedPubkey != null) {
    throw new Error('sns_resolved_pubkey_without_primary');
  }
  return {
    walletPubkey: expected.walletPubkey,
    primaryDomain: value.primaryDomain,
    resolvedPubkey: value.resolvedPubkey,
    observedSlot: value.observedSlot,
    commitment: 'finalized',
    programId: expected.programId,
    chainId: 'solana:devnet',
    recordAuthorityValid: value.recordAuthorityValid,
    tokenizedDomain: value.tokenizedDomain,
    stale: value.stale,
    authoritative: true,
    selfProvesResolution: false,
  };
}

export async function resolveSnsPrimaryForward(input: {
  walletPubkey: string;
  purpose: SnsResolvePurpose;
  cached?: {
    observation: SnsForwardResolveObservation;
    cachedAtMs: number;
  } | null;
  nowMs?: number;
}): Promise<SnsForwardResolveObservation> {
  const profile = getSnsProviderTrustProfile();
  const walletPubkey = assertCanonicalActorKeyIsPubkey(input.walletPubkey);
  const expected = {
    walletPubkey,
    programId: profile.deployment.programId,
    chainId: profile.chain.chainId,
  };
  const highRisk = input.purpose !== 'display';
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  if (!highRisk && input.cached) {
    const ageMs = nowMs - input.cached.cachedAtMs;
    if (
      Number.isFinite(input.cached.cachedAtMs)
      && ageMs >= 0
      && ageMs <= profile.resolutionPolicy.displayCacheTtlSeconds * 1000
    ) {
      try {
        return normalizeObservation(input.cached.observation, expected);
      } catch {
        // fall through to fresh resolve
      }
    }
  }
  const reader = snsResolveReader;
  if (!reader) {
    throw new Error('sns_resolve_reader_unavailable');
  }
  const observation = normalizeObservation(
    await reader.readPrimaryForwardResolve(expected),
    expected,
  );
  if (
    observation.primaryDomain
    && observation.resolvedPubkey
    && observation.resolvedPubkey !== walletPubkey
  ) {
    throw new Error('sns_primary_domain_actor_mismatch');
  }
  if (highRisk && input.cached?.observation.resolvedPubkey && observation.resolvedPubkey
    && input.cached.observation.resolvedPubkey !== observation.resolvedPubkey) {
    throw new Error('sns_fresh_resolve_address_changed');
  }
  return observation;
}

export function projectSnsDisplayLabel(input: {
  walletPubkey: string;
  circleAlias?: string | null;
  profileLabel?: string | null;
  observation?: SnsForwardResolveObservation | null;
  outage?: boolean;
  optInExternalDisplayFallback?: boolean;
  disclosureAccepted?: boolean;
  snsDisplayEnabled?: boolean;
}): SnsDisplayProjection {
  const readiness = resolveSnsProviderTrustReadiness();
  const walletPubkey = assertCanonicalActorKeyIsPubkey(input.walletPubkey);
  const circleAlias = normalizeOptionalLabel(input.circleAlias);
  const profileLabel = normalizeOptionalLabel(input.profileLabel);
  const disclosureAccepted = input.disclosureAccepted === true;
  const snsDisplayEnabled = input.snsDisplayEnabled === true && disclosureAccepted;
  const optInExternalDisplayFallback = input.optInExternalDisplayFallback === true && disclosureAccepted;

  let secondarySnsLabel: string | null = null;
  let observedSlot: number | null = null;
  let trustedSource: SnsDisplayProjection['trustedSource'] = 'none';

  if (
    snsDisplayEnabled
    && !input.outage
    && input.observation
    && input.observation.primaryDomain
    && input.observation.resolvedPubkey === walletPubkey
    && !input.observation.stale
    && input.observation.recordAuthorityValid
  ) {
    secondarySnsLabel = input.observation.primaryDomain;
    observedSlot = input.observation.observedSlot;
    trustedSource = 'sns_name_service';
  }

  // Circle social surfaces always prefer Circle Alias / profile; SNS is secondary unless
  // the user explicitly opted into external-display fallback AND no Circle Alias exists.
  let socialPrimarySource: SnsDisplayProjection['socialPrimarySource'] = circleAlias
    ? 'circle_alias'
    : profileLabel
      ? 'profile'
      : 'generic_member';
  let socialPrimaryLabel = circleAlias ?? profileLabel ?? 'A member';
  if (!circleAlias && optInExternalDisplayFallback && secondarySnsLabel) {
    socialPrimaryLabel = secondarySnsLabel;
    socialPrimarySource = 'generic_member';
  }

  return {
    canonicalActorPubkey: walletPubkey,
    circleAlias,
    profileLabel,
    secondarySnsLabel: snsDisplayEnabled ? secondarySnsLabel : null,
    socialPrimaryLabel,
    socialPrimarySource,
    displaySource: secondarySnsLabel && snsDisplayEnabled
      ? 'sns_primary_secondary'
      : circleAlias
        ? 'circle_alias'
        : profileLabel
          ? 'profile'
          : 'generic_member',
    trustedSource: secondarySnsLabel ? trustedSource : (profileLabel || circleAlias ? 'alcheme_profile' : 'none'),
    observedSlot,
    profileRef: readiness.profileRef,
    profileDigest: readiness.profileDigest,
    isOfficialAlchemeCertification: false,
    optInExternalDisplayFallback,
    disclosureAccepted,
    highRiskRequiresFreshResolve: true,
  };
}

export function buildSnsHistorySnapshot(input: {
  actorPubkey: string;
  observation: SnsForwardResolveObservation;
  displayLabel?: string | null;
}): SnsHistorySnapshot {
  const actorPubkey = assertCanonicalActorKeyIsPubkey(input.actorPubkey);
  return {
    displayLabel: normalizeOptionalLabel(input.displayLabel) ?? input.observation.primaryDomain,
    domain: input.observation.primaryDomain,
    resolvedPubkey: actorPubkey,
    observedSlot: input.observation.observedSlot,
    actorPubkeyImmutable: true,
  };
}

export function invalidatePreflightDigestOnResolveChange(input: {
  previousResolvedPubkey: string;
  nextResolvedPubkey: string;
  previousDigest: string;
}): { valid: false; reason: 'sns_resolved_pubkey_changed' } | { valid: true; digest: string } {
  const previous = assertCanonicalActorKeyIsPubkey(input.previousResolvedPubkey);
  const next = assertCanonicalActorKeyIsPubkey(input.nextResolvedPubkey);
  if (previous !== next) {
    return { valid: false, reason: 'sns_resolved_pubkey_changed' };
  }
  return { valid: true, digest: input.previousDigest };
}

export function projectSnsTrustedSourceHints(input: {
  walletPubkey: string;
  secondarySnsLabel: string | null;
}): {
  trustedSourceLabel: 'sns_name_service' | 'wallet_pubkey';
  shortPubkey: string;
  expandedPubkey: string;
  snsIsOfficialAlchemeCertification: false;
} {
  const expandedPubkey = assertCanonicalActorKeyIsPubkey(input.walletPubkey);
  return {
    trustedSourceLabel: input.secondarySnsLabel ? 'sns_name_service' : 'wallet_pubkey',
    shortPubkey: `${expandedPubkey.slice(0, 4)}…${expandedPubkey.slice(-4)}`,
    expandedPubkey,
    snsIsOfficialAlchemeCertification: false,
  };
}

export function projectSnsExternalActionDisclosure(): {
  registrationRenewalPrimaryUpdate: 'external_optional_action';
  requiredDisclosure: Array<'price' | 'network_fee' | 'payer' | 'ownership'>;
  daoTasksRequireSolDomain: false;
} {
  return {
    registrationRenewalPrimaryUpdate: 'external_optional_action',
    requiredDisclosure: ['price', 'network_fee', 'payer', 'ownership'],
    daoTasksRequireSolDomain: false,
  };
}

export function hashSnsDisplayCacheKey(input: {
  walletPubkey: string;
  primaryDomain: string | null;
  observedSlot: number;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      profileDigest: getSnsProviderTrustProfileDigest(),
      walletPubkey: assertCanonicalActorKeyIsPubkey(input.walletPubkey),
      primaryDomain: input.primaryDomain,
      observedSlot: input.observedSlot,
    }))
    .digest('hex');
}

export function buildSnsWalletDisplayByPubkey(input: {
  entries: Array<{
    walletPubkey: string;
    circleAlias?: string | null;
    profileLabel?: string | null;
    observation?: SnsForwardResolveObservation | null;
    outage?: boolean;
    optInExternalDisplayFallback?: boolean;
    disclosureAccepted?: boolean;
    snsDisplayEnabled?: boolean;
  }>;
}): Record<string, SnsDisplayProjection> {
  const out: Record<string, SnsDisplayProjection> = {};
  for (const entry of input.entries) {
    const projection = projectSnsDisplayLabel(entry);
    out[projection.canonicalActorPubkey] = projection;
  }
  return out;
}

export async function readSnsProgramPresence(input: {
  readAccount(programId: string): Promise<{ executable: boolean; observedSlot: number } | null>;
}): Promise<SnsProgramPresenceObservation> {
  const profile = getSnsProviderTrustProfile();
  const account = await input.readAccount(profile.deployment.programId);
  if (!account || account.executable !== true || !Number.isSafeInteger(account.observedSlot) || account.observedSlot < 0) {
    throw new Error('sns_program_presence_unavailable');
  }
  return {
    programId: profile.deployment.programId,
    executable: true,
    observedSlot: account.observedSlot,
    commitment: 'finalized',
    authoritative: true,
    selfProvesResolution: false,
  };
}
