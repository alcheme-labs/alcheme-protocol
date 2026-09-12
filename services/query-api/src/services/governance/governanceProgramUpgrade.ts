import { createHash } from 'crypto';

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID =
  'BPFLoaderUpgradeab1e11111111111111111111111';

export type ProgramUpgradeAuthorityDisposition =
  | 'retain'
  | 'transfer_to_realm'
  | 'transfer_to_squads'
  | 'transfer_to_program'
  | 'revoke';

export type ProgramUpgradeLifecycleState =
  | 'verified'
  | 'finalized'
  | 'compromised'
  | 'verification_blocked';

export type ProgramUpgradeCodeReleaseBinding = {
  repository: string;
  commit: string;
  buildArtifactSha256: string;
  buildArtifactSize: number;
  auditStatus: 'passed' | 'waived_with_digest';
  auditDigest: string;
};

export type ProgramUpgradeContract = {
  schemaVersion: 1;
  chain: {
    genesisHash: string;
    loaderProgramId: typeof BPF_LOADER_UPGRADEABLE_PROGRAM_ID;
  };
  current: {
    programId: string;
    programDataAddress: string;
    deploySlot: number;
    codeSha256: string;
    upgradeAuthority: string;
  };
  codeRelease: ProgramUpgradeCodeReleaseBinding;
  buffer: {
    address: string;
    authority: string;
    codeSha256: string;
    size: number;
  };
  spill: {
    recipient: string;
    accountMetasDigest: string;
    instructionDigest: string;
  };
  target: {
    postDeployCodeSha256: string;
    postDeploySlotMin: number;
    postUpgradeAuthority: string;
    bufferCloseExpected: true;
  };
  disposition: {
    upgradeAuthorityDisposition: ProgramUpgradeAuthorityDisposition;
    tempBufferAuthorityRetireExpected: true;
  };
  recovery: {
    forwardUpgradeOrGovernedRecoveryOnly: true;
    databaseRollbackMayClaimChainRecovery: false;
  };
  upgradePayloadDigest: string;
};

export type ProgramUpgradeChainObservation = {
  commitment: 'finalized';
  programId: string;
  programDataAddress: string;
  deploySlot: number;
  codeSha256: string;
  upgradeAuthority: string | null;
  bufferExists: boolean;
  bufferCodeSha256: string | null;
  bufferSize: number | null;
  bufferAuthority: string | null;
  observedSlot: number;
  receiptRef: string;
  authoritative: true;
  selfProvesUpgrade: false;
};

export type ProgramUpgradeRecord = {
  schemaVersion: 1;
  state: ProgramUpgradeLifecycleState;
  requestId: string;
  decisionDigest: string;
  activatedAt: string;
  contract: ProgramUpgradeContract;
  verification: {
    bufferMatchesArtifact: boolean;
    authorityMatchesContract: boolean;
    loaderMatchesContract: boolean;
  };
  finalized: {
    codeSha256: string | null;
    deploySlot: number | null;
    upgradeAuthority: string | null;
    bufferClosed: boolean | null;
    tempAuthorityRetired: boolean | null;
  };
  residualRisk: {
    executedShown: false;
    mismatchOpensIncident: true;
    fallbackAuthority: 'none';
  };
};

export type ProgramUpgradeChainReader = {
  readProgramAndBuffer(input: {
    programId: string;
    programDataAddress: string;
    bufferAddress: string;
    transactionSignature?: string;
  }): Promise<ProgramUpgradeChainObservation>;
};

let programUpgradeChainReader: ProgramUpgradeChainReader | null = null;

export function setProgramUpgradeChainReader(reader: ProgramUpgradeChainReader | null): void {
  programUpgradeChainReader = reader;
}

export function getProgramUpgradeChainReader(): ProgramUpgradeChainReader | null {
  return programUpgradeChainReader;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requireNonEmpty(value: unknown, code: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(code);
  return text;
}

function requireDigest(value: unknown, code: string): string {
  const digest = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(code);
  return digest;
}

function requireSafeNonNegInt(value: unknown, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(code);
  return n;
}

function requireSafePositiveInt(value: unknown, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(code);
  return n;
}

export function hashProgramUpgradePayload(parts: Omit<ProgramUpgradeContract, 'upgradePayloadDigest'>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function buildProgramUpgradeContract(input: {
  genesisHash: string;
  current: ProgramUpgradeContract['current'];
  codeRelease: ProgramUpgradeCodeReleaseBinding;
  buffer: ProgramUpgradeContract['buffer'];
  spill: ProgramUpgradeContract['spill'];
  target: Omit<ProgramUpgradeContract['target'], 'bufferCloseExpected'> & { bufferCloseExpected?: true };
  disposition: {
    upgradeAuthorityDisposition: ProgramUpgradeAuthorityDisposition;
  };
}): ProgramUpgradeContract {
  const current = {
    programId: requireNonEmpty(input.current.programId, 'program_upgrade_program_id_missing'),
    programDataAddress: requireNonEmpty(input.current.programDataAddress, 'program_upgrade_program_data_missing'),
    deploySlot: requireSafeNonNegInt(input.current.deploySlot, 'program_upgrade_deploy_slot_invalid'),
    codeSha256: requireDigest(input.current.codeSha256, 'program_upgrade_current_code_digest_invalid'),
    upgradeAuthority: requireNonEmpty(input.current.upgradeAuthority, 'program_upgrade_current_authority_missing'),
  };
  const codeRelease = {
    repository: requireNonEmpty(input.codeRelease.repository, 'program_upgrade_repository_missing'),
    commit: requireNonEmpty(input.codeRelease.commit, 'program_upgrade_commit_missing'),
    buildArtifactSha256: requireDigest(
      input.codeRelease.buildArtifactSha256,
      'program_upgrade_build_artifact_digest_invalid',
    ),
    buildArtifactSize: requireSafePositiveInt(
      input.codeRelease.buildArtifactSize,
      'program_upgrade_build_artifact_size_invalid',
    ),
    auditStatus: input.codeRelease.auditStatus === 'waived_with_digest'
      ? 'waived_with_digest' as const
      : input.codeRelease.auditStatus === 'passed'
        ? 'passed' as const
        : (() => { throw new Error('program_upgrade_audit_status_invalid'); })(),
    auditDigest: requireDigest(input.codeRelease.auditDigest, 'program_upgrade_audit_digest_invalid'),
  };
  const buffer = {
    address: requireNonEmpty(input.buffer.address, 'program_upgrade_buffer_address_missing'),
    authority: requireNonEmpty(input.buffer.authority, 'program_upgrade_buffer_authority_missing'),
    codeSha256: requireDigest(input.buffer.codeSha256, 'program_upgrade_buffer_digest_invalid'),
    size: requireSafePositiveInt(input.buffer.size, 'program_upgrade_buffer_size_invalid'),
  };
  if (buffer.codeSha256 !== codeRelease.buildArtifactSha256) {
    throw new Error('program_upgrade_buffer_artifact_digest_mismatch');
  }
  if (buffer.size !== codeRelease.buildArtifactSize) {
    throw new Error('program_upgrade_buffer_artifact_size_mismatch');
  }
  const spill = {
    recipient: requireNonEmpty(input.spill.recipient, 'program_upgrade_spill_recipient_missing'),
    accountMetasDigest: requireDigest(input.spill.accountMetasDigest, 'program_upgrade_account_metas_digest_invalid'),
    instructionDigest: requireDigest(input.spill.instructionDigest, 'program_upgrade_instruction_digest_invalid'),
  };
  const dispositionValue = input.disposition.upgradeAuthorityDisposition;
  if (!['retain', 'transfer_to_realm', 'transfer_to_squads', 'transfer_to_program', 'revoke'].includes(dispositionValue)) {
    throw new Error('program_upgrade_authority_disposition_invalid');
  }
  const target = {
    postDeployCodeSha256: requireDigest(
      input.target.postDeployCodeSha256,
      'program_upgrade_target_code_digest_invalid',
    ),
    postDeploySlotMin: requireSafeNonNegInt(
      input.target.postDeploySlotMin,
      'program_upgrade_target_slot_invalid',
    ),
    postUpgradeAuthority: requireNonEmpty(
      input.target.postUpgradeAuthority,
      'program_upgrade_target_authority_missing',
    ),
    bufferCloseExpected: true as const,
  };
  if (target.postDeployCodeSha256 !== codeRelease.buildArtifactSha256) {
    throw new Error('program_upgrade_target_artifact_digest_mismatch');
  }
  const partial: Omit<ProgramUpgradeContract, 'upgradePayloadDigest'> = {
    schemaVersion: 1,
    chain: {
      genesisHash: requireNonEmpty(input.genesisHash, 'program_upgrade_genesis_missing'),
      loaderProgramId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    },
    current,
    codeRelease,
    buffer,
    spill,
    target,
    disposition: {
      upgradeAuthorityDisposition: dispositionValue,
      tempBufferAuthorityRetireExpected: true,
    },
    recovery: {
      forwardUpgradeOrGovernedRecoveryOnly: true,
      databaseRollbackMayClaimChainRecovery: false,
    },
  };
  return {
    ...partial,
    upgradePayloadDigest: hashProgramUpgradePayload(partial),
  };
}

export async function readIndependentProgramUpgradeObservation(input: {
  programId: string;
  programDataAddress: string;
  bufferAddress: string;
  transactionSignature?: string;
}): Promise<ProgramUpgradeChainObservation> {
  const reader = programUpgradeChainReader;
  if (!reader) throw new Error('program_upgrade_chain_reader_unavailable');
  const observation = await reader.readProgramAndBuffer(input);
  if (
    observation.commitment !== 'finalized'
    || observation.authoritative !== true
    || observation.selfProvesUpgrade !== false
    || observation.programId !== input.programId
    || observation.programDataAddress !== input.programDataAddress
  ) {
    throw new Error('program_upgrade_chain_observation_invalid');
  }
  return observation;
}

export function verifyProgramUpgradeBuffer(
  contract: ProgramUpgradeContract,
  observation: ProgramUpgradeChainObservation,
): { ok: true } | { ok: false; code: string } {
  if (observation.programId !== contract.current.programId) {
    return { ok: false, code: 'program_upgrade_program_mismatch' };
  }
  if (observation.programDataAddress !== contract.current.programDataAddress) {
    return { ok: false, code: 'program_upgrade_program_data_mismatch' };
  }
  if (!observation.bufferExists || observation.bufferCodeSha256 == null || observation.bufferSize == null) {
    return { ok: false, code: 'program_upgrade_buffer_missing' };
  }
  if (observation.bufferCodeSha256 !== contract.buffer.codeSha256) {
    return { ok: false, code: 'program_upgrade_buffer_hash_mismatch' };
  }
  if (observation.bufferSize !== contract.buffer.size) {
    return { ok: false, code: 'program_upgrade_buffer_size_mismatch' };
  }
  if (observation.bufferAuthority !== contract.buffer.authority) {
    return { ok: false, code: 'program_upgrade_buffer_authority_drift' };
  }
  return { ok: true };
}

export function finalizeProgramUpgradeReadback(
  contract: ProgramUpgradeContract,
  observation: ProgramUpgradeChainObservation,
): {
  state: 'finalized' | 'compromised';
  finalized: ProgramUpgradeRecord['finalized'];
} {
  const bufferClosed = observation.bufferExists === false;
  const codeMatches = observation.codeSha256 === contract.target.postDeployCodeSha256;
  const slotOk = observation.deploySlot >= contract.target.postDeploySlotMin;
  const expectedAuthority = contract.target.postUpgradeAuthority;
  const observedAuthority = observation.upgradeAuthority;
  const authorityOk = expectedAuthority === 'none'
    ? observedAuthority === null || observedAuthority === 'none'
    : observedAuthority === expectedAuthority;
  const tempRetired = bufferClosed === true;
  if (!bufferClosed || !codeMatches || !slotOk || !authorityOk || !tempRetired) {
    return {
      state: 'compromised',
      finalized: {
        codeSha256: observation.codeSha256,
        deploySlot: observation.deploySlot,
        upgradeAuthority: observation.upgradeAuthority,
        bufferClosed,
        tempAuthorityRetired: tempRetired,
      },
    };
  }
  return {
    state: 'finalized',
    finalized: {
      codeSha256: observation.codeSha256,
      deploySlot: observation.deploySlot,
      upgradeAuthority: observation.upgradeAuthority,
      bufferClosed: true,
      tempAuthorityRetired: true,
    },
  };
}

export function buildProgramUpgradeRecord(input: {
  requestId: string;
  decisionDigest: string;
  activatedAt: Date;
  contract: ProgramUpgradeContract;
  observation: ProgramUpgradeChainObservation;
  mode: 'verify' | 'finalize';
}): ProgramUpgradeRecord {
  const requestId = requireNonEmpty(input.requestId, 'program_upgrade_request_invalid');
  const decisionDigest = requireDigest(input.decisionDigest, 'program_upgrade_decision_digest_invalid');
  const activatedAt = input.activatedAt.toISOString();
  const residualRisk = {
    executedShown: false as const,
    mismatchOpensIncident: true as const,
    fallbackAuthority: 'none' as const,
  };

  if (input.mode === 'finalize') {
    const finalized = finalizeProgramUpgradeReadback(input.contract, input.observation);
    const matched = finalized.state === 'finalized';
    return {
      schemaVersion: 1,
      state: finalized.state,
      requestId,
      decisionDigest,
      activatedAt,
      contract: input.contract,
      verification: {
        bufferMatchesArtifact: matched,
        authorityMatchesContract: matched,
        loaderMatchesContract: true,
      },
      finalized: finalized.finalized,
      residualRisk,
    };
  }

  const verified = verifyProgramUpgradeBuffer(input.contract, input.observation);
  if (!verified.ok) {
    return {
      schemaVersion: 1,
      state: 'verification_blocked',
      requestId,
      decisionDigest,
      activatedAt,
      contract: input.contract,
      verification: {
        bufferMatchesArtifact: false,
        authorityMatchesContract: false,
        loaderMatchesContract: true,
      },
      finalized: {
        codeSha256: null,
        deploySlot: null,
        upgradeAuthority: null,
        bufferClosed: null,
        tempAuthorityRetired: null,
      },
      residualRisk,
    };
  }

  return {
    schemaVersion: 1,
    state: 'verified',
    requestId,
    decisionDigest,
    activatedAt,
    contract: input.contract,
    verification: {
      bufferMatchesArtifact: true,
      authorityMatchesContract: true,
      loaderMatchesContract: true,
    },
    finalized: {
      codeSha256: null,
      deploySlot: null,
      upgradeAuthority: null,
      bufferClosed: null,
      tempAuthorityRetired: null,
    },
    residualRisk,
  };
}

export function normalizeProgramUpgradeRecord(value: unknown): ProgramUpgradeRecord | null {
  const record = asRecord(value);
  const contract = asRecord(record.contract);
  const codeRelease = asRecord(contract.codeRelease);
  const current = asRecord(contract.current);
  const buffer = asRecord(contract.buffer);
  const spill = asRecord(contract.spill);
  const target = asRecord(contract.target);
  const disposition = asRecord(contract.disposition);
  const recovery = asRecord(contract.recovery);
  const chain = asRecord(contract.chain);
  const verification = asRecord(record.verification);
  const finalized = asRecord(record.finalized);
  const residualRisk = asRecord(record.residualRisk);
  if (
    record.schemaVersion !== 1
    || typeof record.requestId !== 'string'
    || !record.requestId
    || typeof record.decisionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.decisionDigest)
    || !['verified', 'finalized', 'compromised', 'verification_blocked'].includes(String(record.state))
    || residualRisk.executedShown !== false
    || residualRisk.mismatchOpensIncident !== true
    || residualRisk.fallbackAuthority !== 'none'
    || recovery.forwardUpgradeOrGovernedRecoveryOnly !== true
    || recovery.databaseRollbackMayClaimChainRecovery !== false
    || chain.loaderProgramId !== BPF_LOADER_UPGRADEABLE_PROGRAM_ID
    || disposition.tempBufferAuthorityRetireExpected !== true
    || target.bufferCloseExpected !== true
    || typeof codeRelease.repository !== 'string'
    || !codeRelease.repository
    || typeof codeRelease.commit !== 'string'
    || !codeRelease.commit
    || typeof contract.upgradePayloadDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(contract.upgradePayloadDigest))
  ) return null;

  try {
    const rebuilt = buildProgramUpgradeContract({
      genesisHash: String(chain.genesisHash),
      current: {
        programId: String(current.programId),
        programDataAddress: String(current.programDataAddress),
        deploySlot: Number(current.deploySlot),
        codeSha256: String(current.codeSha256),
        upgradeAuthority: String(current.upgradeAuthority),
      },
      codeRelease: {
        repository: String(codeRelease.repository),
        commit: String(codeRelease.commit),
        buildArtifactSha256: String(codeRelease.buildArtifactSha256),
        buildArtifactSize: Number(codeRelease.buildArtifactSize),
        auditStatus: codeRelease.auditStatus as 'passed' | 'waived_with_digest',
        auditDigest: String(codeRelease.auditDigest),
      },
      buffer: {
        address: String(buffer.address),
        authority: String(buffer.authority),
        codeSha256: String(buffer.codeSha256),
        size: Number(buffer.size),
      },
      spill: {
        recipient: String(spill.recipient),
        accountMetasDigest: String(spill.accountMetasDigest),
        instructionDigest: String(spill.instructionDigest),
      },
      target: {
        postDeployCodeSha256: String(target.postDeployCodeSha256),
        postDeploySlotMin: Number(target.postDeploySlotMin),
        postUpgradeAuthority: String(target.postUpgradeAuthority),
        bufferCloseExpected: true,
      },
      disposition: {
        upgradeAuthorityDisposition: disposition.upgradeAuthorityDisposition as ProgramUpgradeAuthorityDisposition,
      },
    });
    if (rebuilt.upgradePayloadDigest !== contract.upgradePayloadDigest) return null;
    const state = record.state as ProgramUpgradeLifecycleState;
    const verificationFlags = {
      bufferMatchesArtifact: Boolean(verification.bufferMatchesArtifact),
      authorityMatchesContract: Boolean(verification.authorityMatchesContract),
      loaderMatchesContract: Boolean(verification.loaderMatchesContract),
    };
    const finalizedFields = {
      codeSha256: finalized.codeSha256 == null ? null : String(finalized.codeSha256),
      deploySlot: finalized.deploySlot == null ? null : Number(finalized.deploySlot),
      upgradeAuthority: finalized.upgradeAuthority == null ? null : String(finalized.upgradeAuthority),
      bufferClosed: finalized.bufferClosed == null ? null : Boolean(finalized.bufferClosed),
      tempAuthorityRetired: finalized.tempAuthorityRetired == null
        ? null
        : Boolean(finalized.tempAuthorityRetired),
    };
    if (state === 'verified') {
      if (
        !verificationFlags.bufferMatchesArtifact
        || !verificationFlags.authorityMatchesContract
        || !verificationFlags.loaderMatchesContract
        || finalizedFields.codeSha256 !== null
        || finalizedFields.deploySlot !== null
        || finalizedFields.upgradeAuthority !== null
        || finalizedFields.bufferClosed !== null
        || finalizedFields.tempAuthorityRetired !== null
      ) return null;
    }
    if (state === 'finalized') {
      if (
        !verificationFlags.bufferMatchesArtifact
        || !verificationFlags.authorityMatchesContract
        || !verificationFlags.loaderMatchesContract
        || typeof finalizedFields.codeSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(finalizedFields.codeSha256)
        || !Number.isSafeInteger(finalizedFields.deploySlot)
        || Number(finalizedFields.deploySlot) < 0
        || finalizedFields.bufferClosed !== true
        || finalizedFields.tempAuthorityRetired !== true
      ) return null;
    }
    if (state === 'verification_blocked') {
      if (
        verificationFlags.bufferMatchesArtifact
        || verificationFlags.authorityMatchesContract
        || finalizedFields.codeSha256 !== null
        || finalizedFields.deploySlot !== null
        || finalizedFields.upgradeAuthority !== null
        || finalizedFields.bufferClosed !== null
        || finalizedFields.tempAuthorityRetired !== null
      ) return null;
    }
    if (state === 'compromised') {
      if (
        finalizedFields.codeSha256 == null
        || finalizedFields.deploySlot == null
        || finalizedFields.bufferClosed == null
        || finalizedFields.tempAuthorityRetired == null
      ) return null;
    }
    return {
      schemaVersion: 1,
      state,
      requestId: record.requestId,
      decisionDigest: record.decisionDigest,
      activatedAt: new Date(String(record.activatedAt)).toISOString(),
      contract: rebuilt,
      verification: verificationFlags,
      finalized: finalizedFields,
      residualRisk: {
        executedShown: false,
        mismatchOpensIncident: true,
        fallbackAuthority: 'none',
      },
    };
  } catch {
    return null;
  }
}
