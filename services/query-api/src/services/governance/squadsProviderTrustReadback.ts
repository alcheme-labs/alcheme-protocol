import { createHash } from 'node:crypto';

import * as squads from '@sqds/multisig';
import { getProgramDataAccount, getProgramDataAddress } from '@solana/spl-governance';
import { Connection, PublicKey } from '@solana/web3.js';

import {
  getSquadsProviderTrustProfile,
  resolveSquadsProviderTrustReadiness,
} from './squadsProviderTrustProfile';

export interface SquadsProviderTrustReadback {
  status: 'verified_read_only';
  profileRef: string;
  profileVersion: 1;
  profileDigest: string;
  chainId: 'solana:devnet';
  genesisHash: string;
  programId: string;
  programDataAddress: string;
  upgradeAuthority: string;
  lastDeployedSlot: number;
  deployedProgramBytesSha256: string;
  sourceReproducibility: 'unverified';
  programConfig: {
    address: string;
    authority: string;
    treasury: string;
    multisigCreationFeeLamports: string;
  };
  decoder: {
    package: '@sqds/multisig@2.1.4';
    multisig: string;
    proposal: string;
    vaultTransaction: string;
    vault: string;
    threshold: 2;
    memberCount: 3;
    proposalState: 'Executed';
  };
  commitment: 'finalized';
  observedSlot: number;
  observedAt: string;
  attemptCount: number;
  activation: 'not_activated';
}

function required(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function createConnection(): Connection {
  const profile = getSquadsProviderTrustProfile();
  return new Connection(profile.readback.rpc.endpoint, {
    commitment: profile.readback.commitment,
    disableRetryOnRateLimit: true,
    fetch: async (input: any, init: any) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(profile.readback.timeoutMs),
    }),
  });
}

async function verifyOnce(
  connection: Connection,
  attemptCount: number,
): Promise<SquadsProviderTrustReadback> {
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const programId = new PublicKey(profile.deployment.programId);
  const programDataAddress = new PublicKey(profile.deployment.programDataAddress);
  const programConfigAddress = new PublicKey(profile.programConfig.address);
  const fixture = profile.decoderConformance.twoOfThree;
  const fixtureAddresses = [fixture.multisig, fixture.proposal, fixture.vaultTransaction]
    .map((value) => new PublicKey(value));
  const genesisHash = await connection.getGenesisHash();
  required(genesisHash === profile.chain.genesisHash, 'squads_probe_genesis_mismatch');
  required(
    (await getProgramDataAddress(programId)).equals(programDataAddress),
    'squads_probe_program_data_address_mismatch',
  );
  const [program, programData, programConfig, multisigInfo, proposalInfo, transactionInfo] =
    await connection.getMultipleAccountsInfo(
      [programId, programDataAddress, programConfigAddress, ...fixtureAddresses],
      { commitment: 'finalized' },
    );
  required(program?.executable, 'squads_probe_program_missing');
  required(programData, 'squads_probe_program_data_missing');
  required(programConfig, 'squads_probe_program_config_missing');
  required(multisigInfo && proposalInfo && transactionInfo, 'squads_probe_decoder_fixture_missing');
  const loader = new PublicKey(profile.deployment.loaderProgramId);
  required(program.owner.equals(loader), 'squads_probe_program_loader_mismatch');
  required(programData.owner.equals(loader), 'squads_probe_program_data_loader_mismatch');
  required(
    createHash('sha256').update(programData.data.subarray(45)).digest('hex')
      === profile.deployment.deployedProgramBytesSha256,
    'squads_probe_deployed_program_digest_mismatch',
  );
  const decodedProgramData = await getProgramDataAccount(connection, programId);
  required(
    Number(decodedProgramData.slot) === profile.deployment.lastDeployedSlot,
    'squads_probe_last_deployed_slot_mismatch',
  );
  required(
    decodedProgramData.authority?.toBase58() === profile.deployment.upgradeAuthority,
    'squads_probe_upgrade_authority_mismatch',
  );
  for (const account of [programConfig, multisigInfo, proposalInfo, transactionInfo]) {
    required(account.owner.equals(programId), 'squads_probe_account_owner_mismatch');
  }
  const [config] = squads.generated.ProgramConfig.fromAccountInfo(programConfig);
  required(config.authority.toBase58() === profile.programConfig.authority, 'squads_probe_config_authority_mismatch');
  required(config.treasury.toBase58() === profile.programConfig.treasury, 'squads_probe_config_treasury_mismatch');
  required(
    config.multisigCreationFee.toString() === String(profile.programConfig.multisigCreationFeeLamports),
    'squads_probe_config_creation_fee_mismatch',
  );
  const [multisig] = squads.generated.Multisig.fromAccountInfo(multisigInfo);
  const [proposal] = squads.generated.Proposal.fromAccountInfo(proposalInfo);
  const [vaultTransaction] = squads.generated.VaultTransaction.fromAccountInfo(transactionInfo);
  required(multisig.threshold === 2 && multisig.members.length === 3, 'squads_probe_multisig_contract_mismatch');
  required(proposal.multisig.equals(fixtureAddresses[0]), 'squads_probe_proposal_multisig_mismatch');
  required(proposal.status.__kind === 'Executed', 'squads_probe_proposal_state_mismatch');
  required(vaultTransaction.multisig.equals(fixtureAddresses[0]), 'squads_probe_transaction_multisig_mismatch');
  required(
    squads.getProposalPda({
      multisigPda: fixtureAddresses[0],
      transactionIndex: BigInt(proposal.transactionIndex.toString()),
      programId,
    })[0].equals(fixtureAddresses[1]),
    'squads_probe_proposal_pda_mismatch',
  );
  required(
    squads.getTransactionPda({
      multisigPda: fixtureAddresses[0],
      index: BigInt(vaultTransaction.index.toString()),
      programId,
    })[0].equals(fixtureAddresses[2]),
    'squads_probe_transaction_pda_mismatch',
  );
  const vault = squads.getVaultPda({
    multisigPda: fixtureAddresses[0],
    index: vaultTransaction.vaultIndex,
    programId,
  })[0];
  required(vault.toBase58() === fixture.vault, 'squads_probe_vault_pda_mismatch');
  return {
    status: 'verified_read_only',
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    chainId: profile.chain.chainId,
    genesisHash,
    programId: programId.toBase58(),
    programDataAddress: programDataAddress.toBase58(),
    upgradeAuthority: decodedProgramData.authority!.toBase58(),
    lastDeployedSlot: Number(decodedProgramData.slot),
    deployedProgramBytesSha256: profile.deployment.deployedProgramBytesSha256,
    sourceReproducibility: profile.deployment.sourceReproducibility,
    programConfig: {
      address: programConfigAddress.toBase58(),
      authority: config.authority.toBase58(),
      treasury: config.treasury.toBase58(),
      multisigCreationFeeLamports: config.multisigCreationFee.toString(),
    },
    decoder: {
      package: '@sqds/multisig@2.1.4',
      multisig: fixture.multisig,
      proposal: fixture.proposal,
      vaultTransaction: fixture.vaultTransaction,
      vault: fixture.vault,
      threshold: 2,
      memberCount: 3,
      proposalState: 'Executed',
    },
    commitment: profile.readback.commitment,
    observedSlot: await connection.getSlot('finalized'),
    observedAt: new Date().toISOString(),
    attemptCount,
    activation: 'not_activated',
  };
}

export async function verifySquadsProviderTrustProfileReadback(): Promise<SquadsProviderTrustReadback> {
  const profile = getSquadsProviderTrustProfile();
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= profile.readback.maximumAttempts; attempt += 1) {
    try {
      return await verifyOnce(createConnection(), attempt);
    } catch (error) {
      lastError = error;
      if (attempt === profile.readback.maximumAttempts) break;
      const seconds = profile.readback.backoffSeconds[attempt - 1] ?? 0;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
  throw new Error(
    lastError instanceof Error && lastError.message.startsWith('squads_')
      ? lastError.message
      : 'squads_provider_trust_readback_unavailable',
  );
}
