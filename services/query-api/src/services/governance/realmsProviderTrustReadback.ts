import { createHash } from 'node:crypto';
import {
  getGovernance,
  getProgramDataAccount,
  getProgramDataAddress,
  getRealm,
  getRealmConfigAddress,
  tryGetRealmConfig,
} from '@solana/spl-governance';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  assertRealmsAccountDataType,
  getRealmsProviderTrustProfile,
  resolveRealmsProviderTrustReadiness,
} from './realmsProviderTrustProfile';

export interface RealmsProviderTrustReadback {
  status: 'verified_read_only';
  profileRef: string;
  profileVersion: number;
  profileDigest: string;
  chainId: 'solana:devnet';
  genesisHash: string;
  programId: string;
  programDataAddress: string;
  upgradeAuthority: string;
  lastDeployedSlot: number;
  deployedProgramBytesSha256: string;
  decoder: {
    package: string;
    realm: string;
    governance: string;
    realmConfig: string;
    addins: 'absent';
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

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createReadOnlyConnection(): Connection {
  const profile = getRealmsProviderTrustProfile();
  return new Connection(profile.readback.rpc.endpoint, {
    commitment: profile.readback.commitment,
    fetch: async (input: any, init: any) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(profile.readback.timeoutMs),
    }),
  });
}

async function verifyOnce(connection: Connection, attemptCount: number): Promise<RealmsProviderTrustReadback> {
  const profile = getRealmsProviderTrustProfile();
  const readiness = resolveRealmsProviderTrustReadiness();
  const fixture = profile.decoderConformance.accounts;
  const programId = new PublicKey(profile.deployment.programId);
  const expectedProgramData = new PublicKey(profile.deployment.programDataAddress);
  const realmAddress = new PublicKey(fixture.realm.address);
  const governanceAddress = new PublicKey(fixture.governance.address);

  const genesisHash = await connection.getGenesisHash();
  required(genesisHash === profile.chain.genesisHash, 'realms_probe_genesis_mismatch');

  const derivedProgramData = await getProgramDataAddress(programId);
  required(derivedProgramData.equals(expectedProgramData), 'realms_probe_program_data_address_mismatch');

  const [programInfo, programDataInfo, realmInfo, governanceInfo] =
    await connection.getMultipleAccountsInfo(
      [programId, expectedProgramData, realmAddress, governanceAddress],
      { commitment: profile.readback.commitment },
    );
  required(programInfo, 'realms_probe_program_missing');
  required(programDataInfo, 'realms_probe_program_data_missing');
  required(realmInfo, 'realms_probe_realm_fixture_missing');
  required(governanceInfo, 'realms_probe_governance_fixture_missing');

  required(programInfo.executable, 'realms_probe_program_not_executable');
  required(
    programInfo.owner.equals(new PublicKey(profile.deployment.loaderProgramId)),
    'realms_probe_program_loader_mismatch',
  );
  required(
    programDataInfo.owner.equals(new PublicKey(profile.deployment.loaderProgramId)),
    'realms_probe_program_data_loader_mismatch',
  );
  required(
    programDataInfo.data.length === profile.deployment.deployedProgramBytesLength + 45,
    'realms_probe_program_data_length_mismatch',
  );
  required(
    sha256(programDataInfo.data.subarray(45)) === profile.deployment.deployedProgramBytesSha256,
    'realms_probe_deployed_program_digest_mismatch',
  );

  const programData = await getProgramDataAccount(connection, programId);
  const upgradeAuthority = programData.authority;
  required(
    String(programData.slot) === String(profile.deployment.lastDeployedSlot),
    'realms_probe_last_deployed_slot_mismatch',
  );
  required(upgradeAuthority, 'realms_probe_upgrade_authority_missing');
  required(
    upgradeAuthority.equals(new PublicKey(profile.deployment.upgradeAuthority)),
    'realms_probe_upgrade_authority_mismatch',
  );

  required(realmInfo.owner.toBase58() === fixture.realm.ownerProgram, 'realms_probe_realm_owner_mismatch');
  required(realmInfo.data.length === fixture.realm.dataLength, 'realms_probe_realm_length_mismatch');
  required(sha256(realmInfo.data) === fixture.realm.dataSha256, 'realms_probe_realm_digest_mismatch');
  assertRealmsAccountDataType('realm', realmInfo.data);
  const realm = await getRealm(connection, realmAddress);
  required(realm.account.name === fixture.realm.expected.name, 'realms_probe_realm_name_mismatch');
  required(
    realm.account.communityMint.toBase58() === fixture.realm.expected.communityMint,
    'realms_probe_realm_community_mint_mismatch',
  );
  required(
    realm.account.authority?.toBase58() === fixture.realm.expected.authority,
    'realms_probe_realm_authority_mismatch',
  );
  const realmConfigAddress = await getRealmConfigAddress(programId, realmAddress);
  const realmConfig = await tryGetRealmConfig(connection, programId, realmAddress);
  required(!realmConfig, 'realms_probe_fixture_addin_config_present');

  required(
    governanceInfo.owner.toBase58() === fixture.governance.ownerProgram,
    'realms_probe_governance_owner_mismatch',
  );
  required(
    governanceInfo.data.length === fixture.governance.dataLength,
    'realms_probe_governance_length_mismatch',
  );
  required(
    sha256(governanceInfo.data) === fixture.governance.dataSha256,
    'realms_probe_governance_digest_mismatch',
  );
  assertRealmsAccountDataType('governance', governanceInfo.data);
  const governance = await getGovernance(connection, governanceAddress);
  required(
    governance.account.realm.toBase58() === fixture.governance.expected.realm,
    'realms_probe_governance_realm_mismatch',
  );
  required(
    governance.account.governedAccount.toBase58() === fixture.governance.expected.governedAccount,
    'realms_probe_governed_account_mismatch',
  );
  required(
    governance.account.proposalCount === fixture.governance.expected.proposalCount,
    'realms_probe_governance_proposal_count_mismatch',
  );

  const observedSlot = await connection.getSlot(profile.readback.commitment);
  return {
    status: 'verified_read_only',
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    chainId: profile.chain.chainId,
    genesisHash,
    programId: programId.toBase58(),
    programDataAddress: expectedProgramData.toBase58(),
    upgradeAuthority: upgradeAuthority.toBase58(),
    lastDeployedSlot: Number(programData.slot),
    deployedProgramBytesSha256: profile.deployment.deployedProgramBytesSha256,
    decoder: {
      package: `${profile.clientDecoder.packageName}@${profile.clientDecoder.version}`,
      realm: realmAddress.toBase58(),
      governance: governanceAddress.toBase58(),
      realmConfig: realmConfigAddress.toBase58(),
      addins: 'absent',
    },
    commitment: profile.readback.commitment,
    observedSlot,
    observedAt: new Date().toISOString(),
    attemptCount,
    activation: 'not_activated',
  };
}

export async function verifyRealmsProviderTrustProfileReadback(): Promise<RealmsProviderTrustReadback> {
  const profile = getRealmsProviderTrustProfile();
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= profile.readback.maximumAttempts; attempt += 1) {
    try {
      return await verifyOnce(createReadOnlyConnection(), attempt);
    } catch (error) {
      lastError = error;
      if (attempt === profile.readback.maximumAttempts) break;
      const backoffSeconds = profile.readback.backoffSeconds[attempt - 1] ?? 0;
      const jitterMilliseconds = Math.floor(Math.random() * 250);
      await sleep((backoffSeconds * 1000) + jitterMilliseconds);
    }
  }
  const code = lastError instanceof Error && lastError.message.startsWith('realms_')
    ? lastError.message
    : 'realms_provider_trust_readback_unavailable';
  throw new Error(code);
}
