import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

import {
  GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
  REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
  REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
  SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
} from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { getRealmsProviderTrustProfile } from './realmsProviderTrustProfile';
import {
  getSquadsProviderTrustProfile,
  resolveSquadsProviderTrustReadiness,
} from './squadsProviderTrustProfile';

const RUNTIME_POLICY_NAME = 'alcheme-realms-devnet-runtime-current';
const RUNTIME_TOKEN_PERIOD_SECONDS = 86400;
const RUNTIME_TOKEN_RENEWAL_THRESHOLD_SECONDS = 43200;
const KEYCHAIN_SERVICE = 'Alcheme Governance OS OpenBao Devnet';
const KEYCHAIN_ACCOUNT = 'realms-runtime-application-token';
const KEYCHAIN_CREDENTIAL_REF = `macos-keychain:${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}`;
const KEYCHAIN_RUNTIME_HELPER_SOURCE_SHA256 = 'e78eb036641e918500f30ba4b536ad8bcc29227180fee156ccf07d5f19cbbf14';
const KEYCHAIN_RUNTIME_HELPER = path.join(
  os.homedir(),
  'Library/Application Support/Alcheme Governance OS/OpenBao Devnet/bin/alcheme-keychain-runtime',
);
const KEYCHAIN_RUNTIME_HELPER_SOURCE_DIGEST = `${KEYCHAIN_RUNTIME_HELPER}.source.sha256`;
const KEYCHAIN_RUNTIME_HELPER_BINARY_DIGEST = `${KEYCHAIN_RUNTIME_HELPER}.binary.sha256`;

export interface RealmsOpenBaoRuntimeSignerReadback {
  status: 'not_configured' | 'pending_keys' | 'verified_read_only' | 'unavailable';
  signerProvider: 'openbao_transit';
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: number;
  resourceBindingId: string | null;
  applicationIdentity: {
    authMethod: 'openbao_periodic_token';
    credentialRef: string;
    policyName: 'alcheme-realms-devnet-runtime-current';
    tokenPeriodSeconds: 86400;
    status: 'not_configured' | 'pending_keys' | 'verified' | 'unavailable';
  };
  keys: Array<{
    role: string;
    keyRef: string;
    publicKey: string | null;
    status: 'pending_generation' | 'verified' | 'unavailable';
  }>;
  observedAt: string | null;
  blocker: string | null;
}

export function projectRealmsOpenBaoRuntimeSignerUnavailable(input: {
  resourceBindingId: string | null;
  blocker: string;
}): RealmsOpenBaoRuntimeSignerReadback {
  const profile = getRealmsProviderTrustProfile();
  const blocker = /^(?:openbao|realms_openbao)_[a-z0-9_]+$/.test(input.blocker)
    ? input.blocker
    : 'realms_openbao_runtime_readback_unavailable';
  return baseReadback({
    profile,
    status: 'unavailable',
    resourceBindingId: input.resourceBindingId,
    applicationIdentityStatus: 'unavailable',
    keys: profile.keyCustodyRecord.keyContracts.map((contract) => ({
      role: contract.role,
      keyRef: contract.keyRef,
      publicKey: null,
      status: 'unavailable' as const,
    })),
    blocker,
  });
}

interface RuntimeReadbackDependencies {
  loadApplicationToken(): Buffer;
  getJson(requestPath: string, tokenBuffer: Buffer): Promise<any>;
  postJson(
    requestPath: string,
    tokenBuffer: Buffer,
    body: Record<string, unknown>,
  ): Promise<any>;
  renewApplicationToken(tokenBuffer: Buffer): Promise<void>;
  now(): Date;
}

export interface RealmsOpenBaoTransitSignature {
  keyRef: string;
  keyVersion: 1;
  publicKey: string;
  signature: Uint8Array;
}

export interface SquadsOpenBaoTransitSignature {
  keyRef: string;
  keyVersion: 1;
  publicKey: string;
  signature: Uint8Array;
}

export interface SquadsOpenBaoRuntimeKeyInventoryEntry {
  role: string;
  keyRef: string;
  publicKey: string;
  policyName: string;
  credentialRef: string;
  tokenPeriodSeconds: 86400;
  tokenAccessor: string;
}

interface SquadsRuntimeDependencies {
  loadApplicationToken(account: string): Buffer;
  getJson(requestPath: string, tokenBuffer: Buffer): Promise<any>;
  postJson(
    requestPath: string,
    tokenBuffer: Buffer,
    body: Record<string, unknown>,
  ): Promise<any>;
  renewApplicationToken(tokenBuffer: Buffer): Promise<void>;
  now(): Date;
}

export interface SquadsOpenBaoRuntimeSignerReadback {
  status: 'not_configured' | 'pending_keys' | 'verified_read_only';
  signerProvider: 'openbao_transit';
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: 1;
  resourceBindingId: string | null;
  bindingStatus: 'not_configured' | 'pending_custody' | 'active' | 'degraded' | 'disabled';
  identities: Array<{
    role: string;
    keyRef: string;
    publicKey: string | null;
    policyName: string;
    credentialRef: string;
    tokenPeriodSeconds: 86400;
    status: 'pending_generation' | 'verified';
  }>;
  observedAt: string | null;
  blocker: string | null;
}

export async function signSquadsOpenBaoCanonicalMessage(
  prisma: PrismaClient,
  input: {
    circleId: number;
    requestId: string;
    decisionDigest: string;
    actionIntentDigest: string;
    role: string;
    operation: string;
    message: Uint8Array;
  },
  dependencies?: Partial<SquadsRuntimeDependencies>,
): Promise<SquadsOpenBaoTransitSignature> {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('squads_openbao_runtime_circle_invalid');
  }
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(input.role)) {
    throw new Error('squads_openbao_runtime_role_invalid');
  }
  if (!/^[a-z][a-z0-9_]{1,95}$/.test(input.operation)) {
    throw new Error('squads_openbao_runtime_operation_invalid');
  }
  if (!(input.message instanceof Uint8Array) || input.message.length < 1 || input.message.length > 1232) {
    throw new Error('squads_openbao_runtime_message_invalid');
  }
  const profile = getSquadsProviderTrustProfile();
  const contract = profile.keyCustodyRecord.keyContracts.find(
    (candidate) => candidate.role === input.role,
  );
  if (!contract || !contract.allowedOperations.includes(input.operation as never)) {
    throw new Error('squads_openbao_runtime_operation_not_authorized');
  }
  const home = await prisma.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  const resource = home
    ? await prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        provider: profile.provider,
        capability: profile.resourceContract.capability,
        contractVersion: profile.resourceContract.contractVersion,
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        status: { in: ['pending_custody', 'active', 'degraded'] },
      },
      include: { authorityBindings: true },
    })
    : null;
  if (!resource) throw new Error('squads_openbao_runtime_owner_not_configured');
  const authorization = await prisma.governanceRequest.findUnique({
    where: { id: input.requestId },
    include: { decision: true },
  });
  const payload = asRecord(authorization?.payload);
  const providerIntent = asRecord(payload.providerIntent);
  const resourceBinding = asRecord(payload.resourceBinding);
  const operations = Array.isArray(providerIntent.operations) ? providerIntent.operations : [];
  const activation = asRecord(payload.activation);
  const frozenAuthority = (Array.isArray(payload.authorityBindings)
    ? payload.authorityBindings.map(asRecord)
    : []).find((candidate) => candidate.role === input.role);
  const frozenAuthorityOperations = Array.isArray(frozenAuthority?.allowedOperations)
    ? frozenAuthority.allowedOperations
    : [];
  const now = dependencies?.now?.() ?? new Date();
  const bootstrapAuthorizationMatches =
    authorization?.actionType === SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE
    && operations.includes(input.operation)
    && hashCanonicalGovernanceValue(
      'alcheme.governance.squads-provider-action-intent',
      payload,
    ) === input.actionIntentDigest;
  const payoutAuthorizationMatches =
    authorization?.actionType === GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE
    && payload.operation === 'execute_exact_devnet_grant_payout'
    && payload.circleId === input.circleId
    && payload.provider === profile.provider
    && providerIntent.noRealAssets === true
    && providerIntent.commitment === 'finalized'
    && activation.nonce === providerIntent.transactionIndex
    && Number.isFinite(Date.parse(String(activation.effectiveAt ?? '')))
    && Number.isFinite(Date.parse(String(activation.expiresAt ?? '')))
    && now >= new Date(String(activation.effectiveAt))
    && now <= new Date(String(activation.expiresAt))
    && frozenAuthority?.keyRef === contract.keyRef
    && frozenAuthority?.publicKey === resource.authorityBindings.find(
      (candidate) => candidate.authorityRole === input.role,
    )?.currentAuthority
    && frozenAuthorityOperations.includes(input.operation)
    && hashCanonicalGovernanceValue(
      'alcheme.governance.squads-grant-payout-action-intent-v1',
      payload,
    ) === input.actionIntentDigest;
  if (
    !authorization
    || authorization.state !== 'accepted'
    || (!bootstrapAuthorizationMatches && !payoutAuthorizationMatches)
    || authorization.targetType !== 'circle'
    || authorization.targetRef !== String(input.circleId)
    || authorization.homeIdentityBindingId !== home!.id
    || authorization.executionMode !== 'provider_bound_action'
    || authorization.executionAuthorizationStatus !== 'authorized'
    || authorization.decision?.decision !== 'accepted'
    || authorization.decision.decisionDigest !== input.decisionDigest
    || (authorization.decision.executableFrom
      && authorization.decision.executableFrom.getTime() > now.getTime())
    || (authorization.decision.executableUntil
      && authorization.decision.executableUntil.getTime() < now.getTime())
    || resourceBinding.id !== resource.id
    || payload.chainId !== profile.chain.chainId
    || payload.profileRef !== profile.profileRef
    || payload.profileVersion !== profile.version
  ) throw new Error('squads_openbao_runtime_governance_authorization_mismatch');
  const binding = resource.authorityBindings.find(
    (candidate) => candidate.authorityRole === input.role,
  );
  const allowedOperations = Array.isArray(binding?.allowedOperations)
    ? binding.allowedOperations
    : [];
  if (
    !binding
    || binding.keyRef !== contract.keyRef
    || binding.custodyProvider !== 'openbao_transit'
    || !['pending_provider_bootstrap', 'active'].includes(binding.status)
    || typeof binding.currentAuthority !== 'string'
    || !allowedOperations.includes(input.operation)
  ) throw new Error('squads_openbao_runtime_authority_owner_mismatch');
  assertSquadsApplicationIdentity(resource.verification, contract);

  const runtime = dependencies ?? {};
  const account = keychainAccountFromCredentialRef(contract.applicationIdentity.credentialRef);
  const loadToken = runtime.loadApplicationToken ?? loadNamedApplicationTokenFromKeychain;
  let client: ReturnType<typeof createOpenBaoClient> | null = null;
  const getClient = () => (client ??= createOpenBaoClient());
  const getJson = runtime.getJson ?? ((requestPath, token) => getClient().getJson(requestPath, token));
  const postJson = runtime.postJson
    ?? ((requestPath, token, body) => getClient().postJson(requestPath, token, body));
  const renew = runtime.renewApplicationToken
    ?? ((token) => getClient().renewApplicationToken(token));
  const token = loadToken(account);
  const message = Buffer.from(input.message);
  try {
    await ensureNamedRuntimeApplicationIdentity({
      tokenBuffer: token,
      getJson,
      renewApplicationToken: renew,
      policyName: contract.applicationIdentity.policyName,
      tokenPeriodSeconds: contract.applicationIdentity.tokenPeriodSeconds,
    });
    const keyReadback = await getJson(`/v1/transit/keys/${contract.keyRef}`, token);
    const publicKey = readAndVerifyTransitPublicKey(keyReadback, contract.keyRef);
    if (publicKey !== new PublicKey(binding.currentAuthority).toBase58()) {
      throw new Error('squads_openbao_runtime_public_key_owner_mismatch');
    }
    const signed = await postJson(`/v1/transit/sign/${contract.keyRef}`, token, {
      input: message.toString('base64'),
      key_version: 1,
      prehashed: false,
    });
    const signature = readTransitSignature(signed);
    if (!nacl.sign.detached.verify(message, signature, new PublicKey(publicKey).toBytes())) {
      signature.fill(0);
      throw new Error('squads_openbao_runtime_signature_verification_failed');
    }
    return { keyRef: contract.keyRef, keyVersion: 1, publicKey, signature };
  } finally {
    token.fill(0);
    message.fill(0);
  }
}

export async function verifySquadsOpenBaoRuntimeSignerReadback(
  prisma: PrismaClient,
  input: { circleId: number },
  dependencies?: Partial<SquadsRuntimeDependencies>,
): Promise<SquadsOpenBaoRuntimeSignerReadback> {
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const home = await prisma.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  const resource = home
    ? await prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        provider: profile.provider,
        capability: profile.resourceContract.capability,
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        status: { in: ['pending_custody', 'active', 'degraded', 'disabled'] },
      },
      include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    })
    : null;
  const contracts = profile.keyCustodyRecord.keyContracts;
  if (!resource) return {
    status: 'not_configured',
    signerProvider: 'openbao_transit',
    chainId: profile.chain.chainId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBindingId: null,
    bindingStatus: 'not_configured',
    identities: contracts.map((contract) => ({
      role: contract.role,
      keyRef: contract.keyRef,
      publicKey: null,
      ...contract.applicationIdentity,
      status: 'pending_generation' as const,
    })),
    observedAt: null,
    blocker: readiness.blockerCodes[0],
  };
  const bindings = new Map(resource.authorityBindings.map((binding) => [binding.keyRef, binding]));
  if (bindings.size !== contracts.length) {
    throw new Error('squads_openbao_runtime_owner_inventory_mismatch');
  }
  if (contracts.some((contract) => !bindings.get(contract.keyRef)?.currentAuthority)) {
    return {
      status: 'pending_keys',
      signerProvider: 'openbao_transit',
      chainId: profile.chain.chainId,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      resourceBindingId: resource.id,
      bindingStatus: resource.status as SquadsOpenBaoRuntimeSignerReadback['bindingStatus'],
      identities: contracts.map((contract) => ({
        role: contract.role,
        keyRef: contract.keyRef,
        publicKey: null,
        ...contract.applicationIdentity,
        status: 'pending_generation' as const,
      })),
      observedAt: null,
      blocker: 'squads_openbao_wallet_keys_required',
    };
  }
  const runtime = dependencies ?? {};
  let client: ReturnType<typeof createOpenBaoClient> | null = null;
  const getClient = () => (client ??= createOpenBaoClient());
  const getJson = runtime.getJson ?? ((requestPath, token) => getClient().getJson(requestPath, token));
  const renew = runtime.renewApplicationToken
    ?? ((token) => getClient().renewApplicationToken(token));
  const loadToken = runtime.loadApplicationToken ?? loadNamedApplicationTokenFromKeychain;
  const identities = [];
  for (const contract of contracts) {
    assertSquadsApplicationIdentity(resource.verification, contract);
    const token = loadToken(keychainAccountFromCredentialRef(contract.applicationIdentity.credentialRef));
    try {
      await ensureNamedRuntimeApplicationIdentity({
        tokenBuffer: token,
        getJson,
        renewApplicationToken: renew,
        policyName: contract.applicationIdentity.policyName,
        tokenPeriodSeconds: contract.applicationIdentity.tokenPeriodSeconds,
      });
      const publicKey = readAndVerifyTransitPublicKey(
        await getJson(`/v1/transit/keys/${contract.keyRef}`, token),
        contract.keyRef,
      );
      if (publicKey !== bindings.get(contract.keyRef)!.currentAuthority) {
        throw new Error('squads_openbao_runtime_public_key_owner_mismatch');
      }
      identities.push({
        role: contract.role,
        keyRef: contract.keyRef,
        publicKey,
        ...contract.applicationIdentity,
        status: 'verified' as const,
      });
    } finally {
      token.fill(0);
    }
  }
  return {
    status: 'verified_read_only',
    signerProvider: 'openbao_transit',
    chainId: profile.chain.chainId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBindingId: resource.id,
    bindingStatus: resource.status as SquadsOpenBaoRuntimeSignerReadback['bindingStatus'],
    identities,
    observedAt: (runtime.now?.() ?? new Date()).toISOString(),
    blocker: null,
  };
}

export async function readSquadsOpenBaoRuntimeKeyInventory(
  dependencies?: Partial<SquadsRuntimeDependencies>,
): Promise<SquadsOpenBaoRuntimeKeyInventoryEntry[]> {
  const profile = getSquadsProviderTrustProfile();
  const runtime = dependencies ?? {};
  let client: ReturnType<typeof createOpenBaoClient> | null = null;
  const getClient = () => (client ??= createOpenBaoClient());
  const getJson = runtime.getJson ?? ((requestPath, token) => getClient().getJson(requestPath, token));
  const renew = runtime.renewApplicationToken
    ?? ((token) => getClient().renewApplicationToken(token));
  const loadToken = runtime.loadApplicationToken ?? loadNamedApplicationTokenFromKeychain;
  const publicKeys = new Set<string>();
  const accessors = new Set<string>();
  const inventory: SquadsOpenBaoRuntimeKeyInventoryEntry[] = [];

  for (const contract of profile.keyCustodyRecord.keyContracts) {
    const account = keychainAccountFromCredentialRef(contract.applicationIdentity.credentialRef);
    const token = loadToken(account);
    try {
      const identity = await ensureNamedRuntimeApplicationIdentity({
        tokenBuffer: token,
        getJson,
        renewApplicationToken: renew,
        policyName: contract.applicationIdentity.policyName,
        tokenPeriodSeconds: contract.applicationIdentity.tokenPeriodSeconds,
      });
      const publicKey = readAndVerifyTransitPublicKey(
        await getJson(`/v1/transit/keys/${contract.keyRef}`, token),
        contract.keyRef,
      );
      if (publicKeys.has(publicKey)) {
        throw new Error('squads_openbao_runtime_key_inventory_authority_collapse');
      }
      if (accessors.has(identity.tokenAccessor)) {
        throw new Error('squads_openbao_runtime_key_inventory_identity_collapse');
      }
      publicKeys.add(publicKey);
      accessors.add(identity.tokenAccessor);
      inventory.push({
        role: contract.role,
        keyRef: contract.keyRef,
        publicKey,
        ...contract.applicationIdentity,
        tokenAccessor: identity.tokenAccessor,
      });
    } finally {
      token.fill(0);
    }
  }

  if (inventory.length !== profile.keyCustodyRecord.keyContracts.length) {
    throw new Error('squads_openbao_runtime_key_inventory_incomplete');
  }
  return inventory;
}

export async function signRealmsOpenBaoCanonicalMessage(
  prisma: PrismaClient,
  input: {
    circleId: number;
    requestId: string;
    decisionDigest: string;
    actionIntentDigest: string;
    role: string;
    operation: string;
    message: Uint8Array;
  },
  dependencies?: Partial<RuntimeReadbackDependencies>,
): Promise<RealmsOpenBaoTransitSignature> {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_openbao_runtime_circle_invalid');
  }
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(input.role)) {
    throw new Error('realms_openbao_runtime_role_invalid');
  }
  if (!/^[a-z][a-z0-9_]{1,95}$/.test(input.operation)) {
    throw new Error('realms_openbao_runtime_operation_invalid');
  }
  if (!(input.message instanceof Uint8Array) || input.message.length < 1 || input.message.length > 1232) {
    throw new Error('realms_openbao_runtime_message_invalid');
  }
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(input.requestId)) {
    throw new Error('realms_openbao_runtime_request_invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(input.decisionDigest)) {
    throw new Error('realms_openbao_runtime_decision_digest_invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(input.actionIntentDigest)) {
    throw new Error('realms_openbao_runtime_action_intent_digest_invalid');
  }

  const profile = getRealmsProviderTrustProfile();
  const contract = profile.keyCustodyRecord.keyContracts.find(
    (candidate) => candidate.role === input.role,
  );
  if (!contract || !contract.allowedOperations.includes(input.operation as never)) {
    throw new Error('realms_openbao_runtime_operation_not_authorized');
  }
  const home = await prisma.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  const resource = home
    ? await prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        provider: profile.provider,
        capability: 'realms_governance',
        contractVersion: 1,
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        status: { in: ['pending_custody', 'active', 'degraded'] },
      },
      include: { authorityBindings: true },
    })
    : null;
  if (!resource) {
    throw new Error('realms_openbao_runtime_owner_not_configured');
  }
  const authorization = await prisma.governanceRequest.findUnique({
    where: { id: input.requestId },
    include: { decision: true },
  });
  const authorizationPayload = asRecord(authorization?.payload);
  const requestedResource = asRecord(authorizationPayload.resourceBinding);
  const providerIntent = asRecord(authorizationPayload.providerIntent);
  const payerAuthorization = asRecord(authorizationPayload.payerAuthorization);
  const operations = Array.isArray(providerIntent.operations)
    ? providerIntent.operations
    : [];
  const now = dependencies?.now?.() ?? new Date();
  const operationAuthorizedByPayload = input.role === 'fee_payer'
    ? input.operation === 'pay_approved_devnet_fee_and_rent'
      && payerAuthorization.feePayerSignerRef === contract.keyRef
    : operations.includes(input.operation);
  const delegationLifecycle = asRecord(asRecord(resource.verification).delegationConformance);
  const degradedRecoveryAuthorized = resource.status === 'degraded'
    && authorization?.actionType === REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE
    && delegationLifecycle.state === 'revoke_pending'
    && delegationLifecycle.requestId === input.requestId
    && delegationLifecycle.blocker === 'provider_delegate_set_revoke_not_finalized'
    && (
      (input.role === 'voter' && input.operation === 'revoke_governance_delegate')
      || (input.role === 'fee_payer' && input.operation === 'pay_approved_devnet_fee_and_rent')
    );
  if (
    !authorization
    || authorization.state !== 'accepted'
    || ![
      REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
      REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
    ].includes(authorization.actionType)
    || authorization.targetType !== 'circle'
    || authorization.targetRef !== String(input.circleId)
    || authorization.homeIdentityBindingId !== home!.id
    || authorization.executionMode !== 'provider_bound_action'
    || authorization.executionAuthorizationStatus !== 'authorized'
    || authorization.decision?.decision !== 'accepted'
    || authorization.decision.decisionDigest !== input.decisionDigest
    || (authorization.decision.executableFrom
      && authorization.decision.executableFrom.getTime() > now.getTime())
    || (authorization.decision.executableUntil
      && authorization.decision.executableUntil.getTime() < now.getTime())
    || requestedResource.id !== resource.id
    || authorizationPayload.chainId !== profile.chain.chainId
    || authorizationPayload.profileRef !== profile.profileRef
    || authorizationPayload.profileVersion !== profile.version
    || !operationAuthorizedByPayload
    || (resource.status === 'degraded' && !degradedRecoveryAuthorized)
    || hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-action-intent',
      authorizationPayload,
    ) !== input.actionIntentDigest
  ) {
    throw new Error('realms_openbao_runtime_governance_authorization_mismatch');
  }
  if (authorization.actionType === REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE) {
    const payerPolicy = await prisma.payerPolicy.findUnique({
      where: { sourceRequestId: input.requestId },
    });
    const actionScope = asRecord(payerPolicy?.actionScope);
    if (
      !payerPolicy
      || payerPolicy.status !== 'active'
      || payerPolicy.network !== profile.chain.chainId
      || payerPolicy.feePayerSignerRef !== payerAuthorization.feePayerSignerRef
      || payerPolicy.sourceDecisionDigest !== input.decisionDigest
      || (payerPolicy.expiry && payerPolicy.expiry.getTime() < now.getTime()
        && !degradedRecoveryAuthorized)
      || actionScope.actionType !== REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE
      || actionScope.chainId !== profile.chain.chainId
      || actionScope.profileRef !== profile.profileRef
      || actionScope.profileVersion !== profile.version
      || actionScope.resourceBindingId !== resource.id
      || actionScope.requestId !== input.requestId
      || actionScope.noRealAssets !== true
    ) {
      throw new Error('realms_openbao_runtime_payer_authorization_mismatch');
    }
  }
  assertApplicationIdentity(resource.verification);
  const binding = resource.authorityBindings.find(
    (candidate) => candidate.authorityRole === input.role,
  );
  const allowedOperations = Array.isArray(binding?.allowedOperations)
    ? binding.allowedOperations
    : [];
  if (
    !binding
    || binding.keyRef !== contract.keyRef
    || binding.custodyProvider !== 'openbao_transit'
    || !['pending_provider_bootstrap', 'active'].includes(binding.status)
    || typeof binding.currentAuthority !== 'string'
    || !allowedOperations.includes(input.operation)
  ) {
    throw new Error('realms_openbao_runtime_authority_owner_mismatch');
  }

  const runtime = dependencies ?? {};
  const loadToken = runtime.loadApplicationToken ?? loadApplicationTokenFromKeychain;
  let defaultClient: ReturnType<typeof createOpenBaoClient> | null = null;
  const getDefaultClient = () => {
    defaultClient ??= createOpenBaoClient();
    return defaultClient;
  };
  const getJson = runtime.getJson
    ?? ((requestPath, token) => getDefaultClient().getJson(requestPath, token));
  const postJson = runtime.postJson
    ?? ((requestPath, token, body) => getDefaultClient().postJson(requestPath, token, body));
  const renewApplicationToken = runtime.renewApplicationToken
    ?? ((token) => getDefaultClient().renewApplicationToken(token));
  const tokenBuffer = loadToken();
  const message = Buffer.from(input.message);
  try {
    await ensureRuntimeApplicationIdentity({
      tokenBuffer,
      getJson,
      renewApplicationToken,
    });
    const keyReadback = await getJson(`/v1/transit/keys/${contract.keyRef}`, tokenBuffer);
    const publicKey = readAndVerifyTransitPublicKey(keyReadback, contract.keyRef);
    if (publicKey !== new PublicKey(binding.currentAuthority).toBase58()) {
      throw new Error('realms_openbao_runtime_public_key_owner_mismatch');
    }
    const signed = await postJson(
      `/v1/transit/sign/${contract.keyRef}`,
      tokenBuffer,
      {
        input: message.toString('base64'),
        key_version: 1,
        prehashed: false,
      },
    );
    const signature = readTransitSignature(signed);
    const publicKeyBytes = new PublicKey(publicKey).toBytes();
    if (!nacl.sign.detached.verify(message, signature, publicKeyBytes)) {
      signature.fill(0);
      throw new Error('realms_openbao_runtime_signature_verification_failed');
    }
    return {
      keyRef: contract.keyRef,
      keyVersion: 1,
      publicKey,
      signature,
    };
  } finally {
    tokenBuffer.fill(0);
    message.fill(0);
  }
}

export async function verifyRealmsOpenBaoRuntimeSignerReadback(
  prisma: PrismaClient,
  input: { circleId: number },
  dependencies?: Partial<RuntimeReadbackDependencies>,
): Promise<RealmsOpenBaoRuntimeSignerReadback> {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_openbao_runtime_circle_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const home = await prisma.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  const resource = home
    ? await prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        provider: profile.provider,
        capability: 'realms_governance',
        contractVersion: 1,
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        status: { in: ['pending_custody', 'active'] },
      },
      include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    })
    : null;
  const contracts = profile.keyCustodyRecord.keyContracts;
  if (!resource) {
    return baseReadback({
      profile,
      status: 'not_configured',
      resourceBindingId: null,
      applicationIdentityStatus: 'not_configured',
      keys: contracts.map((contract) => ({
        role: contract.role,
        keyRef: contract.keyRef,
        publicKey: null,
        status: 'pending_generation' as const,
      })),
      blocker: 'realms_openbao_runtime_owner_not_configured',
    });
  }
  const authorities = new Map(
    resource.authorityBindings.map((binding) => [binding.keyRef, binding]),
  );
  if (
    authorities.size !== contracts.length
    || contracts.some((contract) => {
      const binding = authorities.get(contract.keyRef);
      return !binding
        || binding.authorityRole !== contract.role
        || binding.custodyProvider !== 'openbao_transit';
    })
  ) {
    throw new Error('realms_openbao_runtime_owner_inventory_mismatch');
  }
  const pendingKeys = contracts.some(
    (contract) => !authorities.get(contract.keyRef)?.currentAuthority,
  );
  if (pendingKeys) {
    if (contracts.some((contract) => authorities.get(contract.keyRef)?.currentAuthority)) {
      throw new Error('realms_openbao_runtime_partial_key_inventory');
    }
    return baseReadback({
      profile,
      status: 'pending_keys',
      resourceBindingId: resource.id,
      applicationIdentityStatus: 'pending_keys',
      keys: contracts.map((contract) => ({
        role: contract.role,
        keyRef: contract.keyRef,
        publicKey: null,
        status: 'pending_generation' as const,
      })),
      blocker: 'openbao_wallet_not_generated',
    });
  }
  assertApplicationIdentity(resource.verification);
  const runtime = dependencies ?? {};
  const loadToken = runtime.loadApplicationToken ?? loadApplicationTokenFromKeychain;
  let defaultClient: ReturnType<typeof createOpenBaoClient> | null = null;
  const getDefaultClient = () => {
    defaultClient ??= createOpenBaoClient();
    return defaultClient;
  };
  const getJson = runtime.getJson
    ?? ((requestPath, token) => getDefaultClient().getJson(requestPath, token));
  const now = runtime.now ?? (() => new Date());
  const tokenBuffer = loadToken();
  try {
    const renewApplicationToken = runtime.renewApplicationToken
      ?? ((token) => getDefaultClient().renewApplicationToken(token));
    await ensureRuntimeApplicationIdentity({
      tokenBuffer,
      getJson,
      renewApplicationToken,
    });
    const keys = [];
    for (const contract of contracts) {
      const binding = authorities.get(contract.keyRef)!;
      const readback = await getJson(`/v1/transit/keys/${contract.keyRef}`, tokenBuffer);
      const publicKey = readAndVerifyTransitPublicKey(readback, contract.keyRef);
      if (publicKey !== new PublicKey(binding.currentAuthority!).toBase58()) {
        throw new Error('realms_openbao_runtime_public_key_owner_mismatch');
      }
      keys.push({
        role: contract.role,
        keyRef: contract.keyRef,
        publicKey,
        status: 'verified' as const,
      });
    }
    const observedAt = now();
    if (!Number.isFinite(observedAt.getTime())) {
      throw new Error('realms_openbao_runtime_readback_time_invalid');
    }
    return baseReadback({
      profile,
      status: 'verified_read_only',
      resourceBindingId: resource.id,
      applicationIdentityStatus: 'verified',
      keys,
      observedAt: observedAt.toISOString(),
      blocker: null,
    });
  } finally {
    tokenBuffer.fill(0);
  }
}

function baseReadback(input: {
  profile: ReturnType<typeof getRealmsProviderTrustProfile>;
  status: RealmsOpenBaoRuntimeSignerReadback['status'];
  resourceBindingId: string | null;
  applicationIdentityStatus: RealmsOpenBaoRuntimeSignerReadback['applicationIdentity']['status'];
  keys: RealmsOpenBaoRuntimeSignerReadback['keys'];
  observedAt?: string | null;
  blocker: string | null;
}): RealmsOpenBaoRuntimeSignerReadback {
  return {
    status: input.status,
    signerProvider: 'openbao_transit',
    chainId: input.profile.chain.chainId,
    profileRef: input.profile.profileRef,
    profileVersion: input.profile.version,
    resourceBindingId: input.resourceBindingId,
    applicationIdentity: {
      authMethod: 'openbao_periodic_token',
      credentialRef: KEYCHAIN_CREDENTIAL_REF,
      policyName: RUNTIME_POLICY_NAME,
      tokenPeriodSeconds: RUNTIME_TOKEN_PERIOD_SECONDS,
      status: input.applicationIdentityStatus,
    },
    keys: input.keys,
    observedAt: input.observedAt ?? null,
    blocker: input.blocker,
  };
}

function assertApplicationIdentity(verificationValue: unknown): void {
  const verification = asRecord(verificationValue);
  const identity = asRecord(verification.applicationIdentity);
  if (
    identity.authMethod !== 'openbao_periodic_token'
    || identity.credentialRef !== KEYCHAIN_CREDENTIAL_REF
    || identity.policyName !== RUNTIME_POLICY_NAME
    || identity.tokenPeriodSeconds !== RUNTIME_TOKEN_PERIOD_SECONDS
    || typeof identity.tokenAccessor !== 'string'
    || !/^[A-Za-z0-9._-]{8,160}$/.test(identity.tokenAccessor)
  ) {
    throw new Error('realms_openbao_runtime_application_identity_owner_mismatch');
  }
}

function assertRuntimeToken(readback: unknown): number {
  const data = asRecord(asRecord(readback).data);
  if (
    !Array.isArray(data.policies)
    || data.policies.length !== 1
    || data.policies[0] !== RUNTIME_POLICY_NAME
    || data.renewable !== true
    || data.period !== RUNTIME_TOKEN_PERIOD_SECONDS
    || typeof data.ttl !== 'number'
    || data.ttl <= 0
  ) {
    throw new Error('realms_openbao_runtime_application_token_mismatch');
  }
  return data.ttl;
}

async function ensureRuntimeApplicationIdentity(input: {
  tokenBuffer: Buffer;
  getJson(requestPath: string, tokenBuffer: Buffer): Promise<any>;
  renewApplicationToken(tokenBuffer: Buffer): Promise<void>;
}): Promise<void> {
  let identity = await input.getJson('/v1/auth/token/lookup-self', input.tokenBuffer);
  let tokenTtlSeconds = assertRuntimeToken(identity);
  if (tokenTtlSeconds > RUNTIME_TOKEN_RENEWAL_THRESHOLD_SECONDS) return;
  await input.renewApplicationToken(input.tokenBuffer);
  identity = await input.getJson('/v1/auth/token/lookup-self', input.tokenBuffer);
  tokenTtlSeconds = assertRuntimeToken(identity);
  if (tokenTtlSeconds <= RUNTIME_TOKEN_RENEWAL_THRESHOLD_SECONDS) {
    throw new Error('realms_openbao_runtime_renewal_readback_invalid');
  }
}

function readTransitSignature(readback: unknown): Uint8Array {
  const signatureValue = asRecord(asRecord(readback).data).signature;
  if (typeof signatureValue !== 'string') {
    throw new Error('realms_openbao_runtime_signature_response_invalid');
  }
  const match = /^vault:v1:([A-Za-z0-9+/]+={0,2})$/.exec(signatureValue);
  if (!match) throw new Error('realms_openbao_runtime_signature_response_invalid');
  const signature = Buffer.from(match[1], 'base64');
  if (
    signature.length !== nacl.sign.signatureLength
    || signature.toString('base64') !== match[1]
  ) {
    signature.fill(0);
    throw new Error('realms_openbao_runtime_signature_response_invalid');
  }
  return signature;
}

function readAndVerifyTransitPublicKey(readback: unknown, keyRef: string): string {
  const data = asRecord(asRecord(readback).data);
  const keys = asRecord(data.keys);
  const version = asRecord(keys['1']);
  if (
    data.name !== keyRef
    || data.type !== 'ed25519'
    || data.derived !== false
    || data.exportable !== false
    || data.allow_plaintext_backup !== false
    || data.deletion_allowed !== false
    || data.supports_signing !== true
    || data.latest_version !== 1
    || Object.keys(keys).length !== 1
    || typeof version.public_key !== 'string'
  ) {
    throw new Error('realms_openbao_runtime_key_contract_mismatch');
  }
  const publicKeyBytes = Buffer.from(version.public_key, 'base64');
  try {
    if (publicKeyBytes.length !== 32) {
      throw new Error('realms_openbao_runtime_public_key_invalid');
    }
    return new PublicKey(publicKeyBytes).toBase58();
  } finally {
    publicKeyBytes.fill(0);
  }
}

function loadApplicationTokenFromKeychain(): Buffer {
  if (process.platform !== 'darwin') {
    throw new Error('realms_openbao_runtime_keychain_platform_unsupported');
  }
  assertKeychainRuntimeHelper();
  const result = spawnSync(KEYCHAIN_RUNTIME_HELPER, [
    'read-generic-password',
    KEYCHAIN_SERVICE,
    KEYCHAIN_ACCOUNT,
  ], {
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024,
    timeout: 5000,
    killSignal: 'SIGKILL',
  });
  const stderr = Buffer.from(result.stderr ?? Buffer.alloc(0));
  stderr.fill(0);
  if (result.error || result.status !== 0) {
    result.stdout?.fill(0);
    throw new Error('realms_openbao_runtime_application_identity_unavailable');
  }
  const stdout = Buffer.from(result.stdout ?? Buffer.alloc(0));
  let end = stdout.length;
  while (end > 0 && (stdout[end - 1] === 10 || stdout[end - 1] === 13)) end -= 1;
  const token = Buffer.from(stdout.subarray(0, end));
  stdout.fill(0);
  if (token.length < 16 || token.includes(0)) {
    token.fill(0);
    throw new Error('realms_openbao_runtime_application_identity_invalid');
  }
  return token;
}

function assertKeychainRuntimeHelper(): void {
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : null;
  const files = [
    { filePath: KEYCHAIN_RUNTIME_HELPER, mode: 0o755 },
    { filePath: KEYCHAIN_RUNTIME_HELPER_SOURCE_DIGEST, mode: 0o644 },
    { filePath: KEYCHAIN_RUNTIME_HELPER_BINARY_DIGEST, mode: 0o644 },
  ];
  for (const item of files) {
    const stat = fs.statSync(item.filePath);
    if (
      !stat.isFile()
      || (expectedUid !== null && stat.uid !== expectedUid)
      || (stat.mode & 0o777) !== item.mode
    ) {
      throw new Error('realms_openbao_runtime_keychain_helper_contract_invalid');
    }
  }
  const sourceDigest = fs.readFileSync(KEYCHAIN_RUNTIME_HELPER_SOURCE_DIGEST, 'utf8').trim();
  const binaryDigest = fs.readFileSync(KEYCHAIN_RUNTIME_HELPER_BINARY_DIGEST, 'utf8').trim();
  const observedBinaryDigest = createHash('sha256')
    .update(fs.readFileSync(KEYCHAIN_RUNTIME_HELPER))
    .digest('hex');
  if (
    sourceDigest !== KEYCHAIN_RUNTIME_HELPER_SOURCE_SHA256
    || !/^[a-f0-9]{64}$/.test(binaryDigest)
    || observedBinaryDigest !== binaryDigest
  ) {
    throw new Error('realms_openbao_runtime_keychain_helper_digest_mismatch');
  }
}

function createOpenBaoClient(): Pick<
  RuntimeReadbackDependencies,
  'getJson' | 'postJson' | 'renewApplicationToken'
> {
  const profile = getRealmsProviderTrustProfile();
  const certificatePath = path.join(
    os.homedir(),
    'Library/Application Support/Alcheme Governance OS/OpenBao Devnet/tls/server.crt',
  );
  const certificate = fs.readFileSync(certificatePath);
  const digest = new X509Certificate(certificate).fingerprint256
    .replaceAll(':', '')
    .toLowerCase();
  if (digest !== profile.keyCustodyRecord.tls.certificateSha256) {
    certificate.fill(0);
    throw new Error('realms_openbao_runtime_tls_trust_anchor_mismatch');
  }
  const endpoint = new URL(profile.keyCustodyRecord.endpoint);
  const requestJson = async (
    method: 'GET' | 'POST',
    requestPath: string,
    tokenBuffer: Buffer,
    body?: Record<string, unknown>,
  ): Promise<any> => {
    let tokenHeader = tokenBuffer.toString('utf8');
    const requestBody = body === undefined
      ? null
      : Buffer.from(JSON.stringify(body), 'utf8');
    try {
      return await new Promise((resolve, reject) => {
        const request = https.request({
          hostname: endpoint.hostname,
          port: Number(endpoint.port),
          path: requestPath,
          method,
          ca: certificate,
          servername: profile.keyCustodyRecord.tls.serverName,
          rejectUnauthorized: true,
          timeout: 5000,
          headers: {
            'X-Vault-Token': tokenHeader,
            ...(requestBody
              ? {
                'Content-Type': 'application/json',
                'Content-Length': requestBody.length,
              }
              : {}),
          },
        }, (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk) => {
            const value = Buffer.from(chunk);
            size += value.length;
            if (size > 1024 * 1024) {
              value.fill(0);
              request.destroy(new Error('realms_openbao_runtime_response_too_large'));
              return;
            }
            chunks.push(value);
          });
          response.on('end', () => {
            const body = Buffer.concat(chunks);
            try {
              if (response.statusCode !== 200) {
                reject(new Error(`realms_openbao_runtime_api_status_${response.statusCode}`));
                return;
              }
              resolve(JSON.parse(body.toString('utf8')));
            } catch (error) {
              reject(error instanceof SyntaxError
                ? new Error('realms_openbao_runtime_response_invalid')
                : error);
            } finally {
              body.fill(0);
              chunks.forEach((chunk) => chunk.fill(0));
            }
          });
        });
        request.on('timeout', () => request.destroy(new Error('realms_openbao_runtime_timeout')));
        request.on('error', () => reject(new Error('realms_openbao_runtime_unavailable')));
        request.end(requestBody ?? undefined);
      });
    } finally {
      tokenHeader = '';
      requestBody?.fill(0);
    }
  };
  return {
    getJson: (requestPath, tokenBuffer) => requestJson('GET', requestPath, tokenBuffer),
    postJson: (requestPath, tokenBuffer, body) => requestJson(
      'POST',
      requestPath,
      tokenBuffer,
      body,
    ),
    async renewApplicationToken(tokenBuffer) {
      try {
        await requestJson('POST', '/v1/auth/token/renew-self', tokenBuffer);
      } catch {
        throw new Error('realms_openbao_runtime_renewal_failed');
      }
    },
  };
}

function assertSquadsApplicationIdentity(
  verificationValue: unknown,
  contract: ReturnType<typeof getSquadsProviderTrustProfile>['keyCustodyRecord']['keyContracts'][number],
): void {
  const verification = asRecord(verificationValue);
  const identities = asRecord(verification.applicationIdentities);
  const identity = asRecord(identities[contract.role]);
  if (
    identity.authMethod !== 'openbao_periodic_token'
    || identity.credentialRef !== contract.applicationIdentity.credentialRef
    || identity.policyName !== contract.applicationIdentity.policyName
    || identity.tokenPeriodSeconds !== contract.applicationIdentity.tokenPeriodSeconds
    || typeof identity.tokenAccessor !== 'string'
    || !/^[A-Za-z0-9._-]{8,160}$/.test(identity.tokenAccessor)
  ) throw new Error('squads_openbao_runtime_application_identity_owner_mismatch');
}

function keychainAccountFromCredentialRef(credentialRef: string): string {
  const prefix = `macos-keychain:${KEYCHAIN_SERVICE}/`;
  if (!credentialRef.startsWith(prefix)) {
    throw new Error('squads_openbao_runtime_credential_ref_invalid');
  }
  const account = credentialRef.slice(prefix.length);
  if (!/^squads-[a-z-]+-runtime-token$/.test(account)) {
    throw new Error('squads_openbao_runtime_credential_ref_invalid');
  }
  return account;
}

function loadNamedApplicationTokenFromKeychain(account: string): Buffer {
  if (process.platform !== 'darwin') {
    throw new Error('squads_openbao_runtime_keychain_platform_unsupported');
  }
  if (!/^squads-[a-z-]+-runtime-token$/.test(account)) {
    throw new Error('squads_openbao_runtime_keychain_account_invalid');
  }
  assertKeychainRuntimeHelper();
  const result = spawnSync(KEYCHAIN_RUNTIME_HELPER, [
    'read-generic-password',
    KEYCHAIN_SERVICE,
    account,
  ], {
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024,
    timeout: 5000,
    killSignal: 'SIGKILL',
  });
  const stderr = Buffer.from(result.stderr ?? Buffer.alloc(0));
  stderr.fill(0);
  if (result.error || result.status !== 0) {
    result.stdout?.fill(0);
    throw new Error('squads_openbao_runtime_application_identity_unavailable');
  }
  const stdout = Buffer.from(result.stdout ?? Buffer.alloc(0));
  let end = stdout.length;
  while (end > 0 && (stdout[end - 1] === 10 || stdout[end - 1] === 13)) end -= 1;
  const token = Buffer.from(stdout.subarray(0, end));
  stdout.fill(0);
  if (token.length < 16 || token.includes(0)) {
    token.fill(0);
    throw new Error('squads_openbao_runtime_application_identity_invalid');
  }
  return token;
}

async function ensureNamedRuntimeApplicationIdentity(input: {
  tokenBuffer: Buffer;
  getJson(requestPath: string, tokenBuffer: Buffer): Promise<any>;
  renewApplicationToken(tokenBuffer: Buffer): Promise<void>;
  policyName: string;
  tokenPeriodSeconds: number;
}): Promise<{ tokenAccessor: string }> {
  const read = async () => {
    const data = asRecord(asRecord(
      await input.getJson('/v1/auth/token/lookup-self', input.tokenBuffer),
    ).data);
    if (
      !Array.isArray(data.policies)
      || data.policies.length !== 1
      || data.policies[0] !== input.policyName
      || data.renewable !== true
      || data.period !== input.tokenPeriodSeconds
      || typeof data.ttl !== 'number'
      || data.ttl <= 0
      || typeof data.accessor !== 'string'
      || !/^[A-Za-z0-9._-]{8,160}$/.test(data.accessor)
    ) throw new Error('squads_openbao_runtime_application_token_mismatch');
    return { ttl: data.ttl as number, tokenAccessor: data.accessor as string };
  };
  let identity = await read();
  if (identity.ttl > RUNTIME_TOKEN_RENEWAL_THRESHOLD_SECONDS) {
    return { tokenAccessor: identity.tokenAccessor };
  }
  await input.renewApplicationToken(input.tokenBuffer);
  identity = await read();
  if (identity.ttl <= RUNTIME_TOKEN_RENEWAL_THRESHOLD_SECONDS) {
    throw new Error('squads_openbao_runtime_renewal_readback_invalid');
  }
  return { tokenAccessor: identity.tokenAccessor };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
