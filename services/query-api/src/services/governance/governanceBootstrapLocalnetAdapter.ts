import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';

import circleManagerIdl from '../../../../../sdk/src/idl/circle_manager.json';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID,
  GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID,
  type GovernanceBootstrapCeremonyNetwork,
} from './governanceBootstrapCeremonyContract';
import type { GovernanceBootstrapLocalnetAdapter } from './governanceBootstrapRuntime';

const GUARD_VERSION_SHIFT = 18n;
const ACTION_LOCK_SHIFT = 22n;
const ALL_ACTIONS_MASK = 31;
const LOCALNET_READBACK_DOMAIN = 'alcheme.governance.bootstrap-localnet-readback';
const LOCALNET_SUBMISSION_REF_DOMAIN = 'alcheme.governance.bootstrap-localnet-submission-ref';
const DEVNET_READBACK_DOMAIN = 'alcheme.governance.bootstrap-devnet-readback';
const DEVNET_SUBMISSION_REF_DOMAIN = 'alcheme.governance.bootstrap-devnet-submission-ref';

export interface GovernanceBootstrapLocalnetCircleReadback {
  network: GovernanceBootstrapCeremonyNetwork;
  programId: string;
  circleId: number;
  circleAccountRef: string;
  ownerPubkey: string;
  lifecycleStatus: 'Active' | 'Archived';
  decisionEngine: 'LegacyDisabled';
  guardVersion: 1;
  lockedActionMask: 31;
  observedSlot: number;
  stateDigest: string;
}

export function createGovernanceBootstrapLocalnetCircleReader(input: {
  network?: GovernanceBootstrapCeremonyNetwork;
  rpcUrl: string;
  programId: string;
}) {
  const network = input.network ?? 'solana:localnet';
  const readbackDomain = network === 'solana:devnet'
    ? DEVNET_READBACK_DOMAIN
    : LOCALNET_READBACK_DOMAIN;
  assertRpcForNetwork(network, input.rpcUrl);
  if (input.programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
    throw new Error('governance_bootstrap_localnet_program_mismatch');
  }
  const programId = new PublicKey(input.programId);
  const connection = new Connection(input.rpcUrl, 'finalized');
  const coder = new BorshAccountsCoder(circleManagerIdl as any);
  return {
    async read(circleId: number, circleAccountRef: string): Promise<GovernanceBootstrapLocalnetCircleReadback> {
      if (network === GOVERNANCE_BOOTSTRAP_CEREMONY_DEVNET_CHAIN_ID) {
        const genesisHash = await connection.getGenesisHash();
        if (genesisHash !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') {
          throw new Error('governance_bootstrap_devnet_genesis_mismatch');
        }
      }
      if (!Number.isInteger(circleId) || circleId < 1 || circleId > 255) {
        throw new Error('governance_bootstrap_localnet_circle_id_invalid');
      }
      const accountRef = new PublicKey(circleAccountRef);
      const [expectedAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from('circle'), Buffer.from([circleId])], programId,
      );
      if (!expectedAccount.equals(accountRef)) {
        throw new Error('governance_bootstrap_localnet_circle_pda_mismatch');
      }
      const chain = await connection.getAccountInfoAndContext(accountRef, 'finalized');
      if (!chain.value) throw new Error('governance_bootstrap_localnet_circle_missing');
      if (!chain.value.owner.equals(programId)) {
        throw new Error('governance_bootstrap_localnet_account_owner_mismatch');
      }
      const decoded: any = coder.decode('Circle', chain.value.data);
      const decodedCircleId = Number(decoded.circle_id);
      const ownerPubkey = decoded.curators?.[0]?.toBase58?.() ?? '';
      const flags = BigInt(decoded.flags.toString(10));
      const guardVersion = Number((flags >> GUARD_VERSION_SHIFT) & 0xfn);
      const lockedActionMask = Number((flags >> ACTION_LOCK_SHIFT) & BigInt(ALL_ACTIONS_MASK));
      const decisionEngine = Object.keys(decoded.decision_engine ?? {})[0]?.replace(/_/g, '').toLowerCase() ?? '';
      const lifecycle = Object.keys(decoded.status ?? {})[0]?.replace(/_/g, '').toLowerCase() ?? '';
      if (decodedCircleId !== circleId || !ownerPubkey || guardVersion !== 1
        || lockedActionMask !== ALL_ACTIONS_MASK || decisionEngine !== 'legacydisabled'
        || (lifecycle !== 'active' && lifecycle !== 'archived')) {
        throw new Error('governance_bootstrap_localnet_chain_state_mismatch');
      }
      const facts = {
        network,
        programId: programId.toBase58(),
        circleId,
        circleAccountRef: accountRef.toBase58(),
        ownerPubkey,
        lifecycleStatus: lifecycle === 'active' ? 'Active' as const : 'Archived' as const,
        decisionEngine: 'LegacyDisabled' as const,
        guardVersion: 1 as const,
        lockedActionMask: 31 as const,
      };
      return {
        ...facts,
        observedSlot: chain.context.slot,
        stateDigest: hashCanonicalGovernanceValue(readbackDomain, facts),
      };
    },
  };
}

export function createGovernanceBootstrapLocalnetAdapter(input: {
  network?: GovernanceBootstrapCeremonyNetwork;
  prisma: any;
  rpcUrl: string;
  programId: string;
  circleId: number;
  circleAccountRef: string;
  expectedOwnerPubkey: string;
  homeIdentityBindingId: string;
  configurationBundleId: string;
  now?: () => Date;
}): GovernanceBootstrapLocalnetAdapter {
  const network = input.network ?? 'solana:localnet';
  const networkLabel = network === 'solana:devnet' ? 'devnet' : 'localnet';
  const readbackDomain = network === 'solana:devnet'
    ? DEVNET_READBACK_DOMAIN
    : LOCALNET_READBACK_DOMAIN;
  const submissionRefDomain = network === 'solana:devnet'
    ? DEVNET_SUBMISSION_REF_DOMAIN
    : LOCALNET_SUBMISSION_REF_DOMAIN;
  assertRpcForNetwork(network, input.rpcUrl);
  if (input.programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
    throw new Error('governance_bootstrap_localnet_program_mismatch');
  }
  if (!Number.isInteger(input.circleId) || input.circleId < 1 || input.circleId > 255) {
    throw new Error('governance_bootstrap_localnet_circle_id_invalid');
  }
  const programId = new PublicKey(input.programId);
  const accountRef = new PublicKey(input.circleAccountRef);
  const owner = new PublicKey(input.expectedOwnerPubkey).toBase58();
  const [expectedAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('circle'), Buffer.from([input.circleId])], programId,
  );
  if (!expectedAccount.equals(accountRef)) throw new Error('governance_bootstrap_localnet_circle_pda_mismatch');
  const circleReader = createGovernanceBootstrapLocalnetCircleReader({
    network,
    rpcUrl: input.rpcUrl,
    programId: input.programId,
  });
  const now = input.now ?? (() => new Date());

  async function readFacts() {
    const [chain, activation, bundle, ceremony] = await Promise.all([
      circleReader.read(input.circleId, input.circleAccountRef),
      input.prisma.governanceActivationState.findUnique({
        where: { homeIdentityBindingId: input.homeIdentityBindingId },
      }),
      input.prisma.governanceConfigurationBundle.findUnique({
        where: { id: input.configurationBundleId },
      }),
      input.prisma.governanceBootstrapCeremony.findFirst({
        where: {
          homeIdentityBindingId: input.homeIdentityBindingId,
          configurationBundleId: input.configurationBundleId,
        },
        include: { events: { where: { sequence: 1 } } },
      }),
    ]);
    if (chain.ownerPubkey !== owner) {
      throw new Error('governance_bootstrap_localnet_chain_state_mismatch');
    }
    if (!activation || activation.homeIdentityBindingId !== input.homeIdentityBindingId
      || activation.bootstrapConfigurationBundleId !== input.configurationBundleId
      || activation.bootstrapBypassStatus !== 'disabled'
      || !bundle || bundle.homeIdentityBindingId !== input.homeIdentityBindingId
      || !ceremony || ceremony.id !== activation.bootstrapCeremonyId) {
      throw new Error('governance_bootstrap_localnet_prepared_state_mismatch');
    }
    const body: any = bundle.bundle;
    if ((body.providerRefs?.length ?? 0) !== 0 || (body.resourceRefs?.length ?? 0) !== 0
      || (body.mandateRefs?.length ?? 0) !== 0) {
      throw new Error('governance_bootstrap_localnet_external_adapter_required');
    }
    const evidenceRefs = Array.isArray(ceremony.events?.[0]?.evidenceRefs)
      ? ceremony.events[0].evidenceRefs.map(String) : [];
    const emergencyPolicyRef = String(body.emergencyPolicy?.ref ?? '');
    const recoveryPolicyRef = evidenceRefs.find((ref: string) => ref.startsWith('recovery-policy:')) ?? '';
    const supportPolicyRef = evidenceRefs.find((ref: string) => ref.startsWith('platform-support-policy:')) ?? '';
    const independent = emergencyPolicyRef && recoveryPolicyRef && supportPolicyRef
      && new Set([emergencyPolicyRef, recoveryPolicyRef, supportPolicyRef]).size === 3;
    const facts = {
      network,
      programId: programId.toBase58(), circleId: input.circleId,
      circleAccountRef: accountRef.toBase58(), observedOwnerPubkey: chain.ownerPubkey,
      observedSlot: chain.observedSlot, guardVersion: chain.guardVersion,
      lockedActionMask: chain.lockedActionMask,
      decisionEngine: 'LegacyDisabled', homeIdentityBindingId: input.homeIdentityBindingId,
      configurationBundleId: input.configurationBundleId,
      configurationBundleDigest: bundle.bundleDigest,
      activationState: activation.state, bootstrapBypassStatus: activation.bootstrapBypassStatus,
      emergencyPolicyRef, recoveryPolicyRef, supportPolicyRef,
      independentAuthorityPolicies: Boolean(independent),
    };
    return { facts, digest: hashCanonicalGovernanceValue(readbackDomain, facts) };
  }

  return {
    network,
    async submit(submission) {
      const readback = await readFacts();
      const submissionRefDigest = hashCanonicalGovernanceValue(submissionRefDomain, {
        network,
        circleAccountRef: accountRef.toBase58(),
        observedSlot: readback.facts.observedSlot,
        idempotencyKey: submission.idempotencyKey,
        payloadDigest: submission.payloadDigest,
      });
      return {
        status: 'submitted',
        providerRef: `circle-manager:${programId.toBase58()}`,
        providerVersionRef: 'circle-manager-0.3.0',
        externalRef: `bootstrap-${networkLabel}-submit:${submissionRefDigest}`,
        transactionSignature: null,
        errorCode: null,
      };
    },
    async readback() {
      try {
        const result = await readFacts();
        const effectiveAt = now();
        if (!Number.isFinite(effectiveAt.getTime())) throw new Error('governance_bootstrap_localnet_time_invalid');
        return {
          status: result.facts.independentAuthorityPolicies ? 'confirmed' : 'mismatch',
          readbackRef: `bootstrap-${networkLabel}-readback:${result.digest}`,
          observedAuthorityRef: result.facts.observedOwnerPubkey,
          policyReadyForActivation: true,
          bootstrapAuthorityRevoked: result.facts.bootstrapBypassStatus === 'disabled',
          emergencyAuthorityIndependent: result.facts.independentAuthorityPolicies,
          recoveryAuthorityIndependent: result.facts.independentAuthorityPolicies,
          supportAuthorityIndependent: result.facts.independentAuthorityPolicies,
          effectiveAt: result.facts.independentAuthorityPolicies ? effectiveAt.toISOString() : null,
          stateDigest: result.digest,
          errorCode: result.facts.independentAuthorityPolicies ? null : 'bootstrap_authority_policy_not_independent',
        };
      } catch (error) {
        return {
          status: 'unavailable', readbackRef: `bootstrap-${networkLabel}-readback:unavailable`,
          observedAuthorityRef: owner, policyReadyForActivation: false, bootstrapAuthorityRevoked: false,
          emergencyAuthorityIndependent: false, recoveryAuthorityIndependent: false,
          supportAuthorityIndependent: false, effectiveAt: null,
          stateDigest: hashCanonicalGovernanceValue(readbackDomain, {
            status: 'unavailable', code: error instanceof Error ? error.message : String(error),
          }),
          errorCode: error instanceof Error ? error.message : 'governance_bootstrap_localnet_readback_failed',
        };
      }
    },
  };
}

function assertRpcForNetwork(network: GovernanceBootstrapCeremonyNetwork, value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('governance_bootstrap_localnet_rpc_invalid'); }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol)
    || (network === 'solana:localnet' && !loopback)) {
    throw new Error('governance_bootstrap_localnet_rpc_loopback_required');
  }
  if (network === 'solana:devnet' && (url.protocol !== 'https:' || loopback)) {
    throw new Error('governance_bootstrap_devnet_rpc_https_required');
  }
}
