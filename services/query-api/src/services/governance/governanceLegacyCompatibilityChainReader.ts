import { PublicKey, type Connection } from '@solana/web3.js';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type {
  GovernanceLegacyCompatibilityChainReader,
  LegacyCircleProgramReadback,
  LegacyTransferProposalReadback,
} from './governanceLegacyCompatibilityRuntime';

const CIRCLE_STATE_DOMAIN = 'alcheme.governance.legacy-circle-program-readback';
const DECISION_ENGINE_DOMAIN = 'alcheme.governance.legacy-decision-engine-readback';

export function createAnchorGovernanceLegacyCompatibilityChainReader(input: {
  connection: Connection;
  program: any;
  programVersionRef: string;
  programIdlDigest: string;
}): GovernanceLegacyCompatibilityChainReader {
  return {
    async readCircle(request): Promise<LegacyCircleProgramReadback> {
      const accountRef = new PublicKey(request.accountRef);
      const response = await input.connection.getAccountInfoAndContext(
        accountRef,
        request.commitment,
      );
      if (!response.value) throw new Error('governance_compatibility_circle_account_missing');
      if (!response.value.owner.equals(input.program.programId)) {
        throw new Error('governance_compatibility_circle_account_owner_mismatch');
      }
      const decoded = input.program.coder.accounts.decode('circle', response.value.data);
      const decodedCircleId = safeChainInteger(decoded.circleId);
      if (decodedCircleId !== request.circleId) {
        throw new Error('governance_compatibility_circle_mismatch');
      }
      const decisionEngine = normalizeAnchorValue(decoded.decisionEngine);
      const stateFacts = {
        circleId: decodedCircleId,
        accountRef: request.accountRef,
        accountOwnerProgramId: response.value.owner.toBase58(),
        lifecycleStatus: enumVariant(decoded.status),
        flags: numericString(decoded.flags),
        curators: (decoded.curators ?? []).map((value: any) => value.toBase58()),
        decisionEngine,
      };
      return {
        ...stateFacts,
        observedSlot: safeChainInteger(response.context.slot),
        programVersionRef: input.programVersionRef,
        programIdlDigest: input.programIdlDigest,
        commitment: request.commitment,
        stateDigest: hashCanonicalGovernanceValue(CIRCLE_STATE_DOMAIN, stateFacts),
        decisionEngine: decisionEngine
          ? {
            type: enumVariant(decoded.decisionEngine),
            configDigest: hashCanonicalGovernanceValue(DECISION_ENGINE_DOMAIN, decisionEngine),
          }
          : null,
      };
    },

    async listOpenTransferProposals(request): Promise<LegacyTransferProposalReadback[]> {
      const rows = await input.program.account.transferProposal.all();
      return rows
        .filter((row: any) => safeChainInteger(row.account.fromCircle) === request.circleId)
        .filter((row: any) => ['Pending', 'Approved'].includes(enumVariant(row.account.status)))
        .map((row: any) => ({
          proposalRef: row.publicKey.toBase58(),
          status: enumVariant(row.account.status),
          decisionEngineDigest: hashCanonicalGovernanceValue(
            DECISION_ENGINE_DOMAIN,
            normalizeAnchorValue(row.account.decisionEngine),
          ),
          deadline: row.account.deadline === null ? null : safeChainInteger(row.account.deadline),
          votesFor: safeChainInteger(row.account.votesFor),
          votesAgainst: safeChainInteger(row.account.votesAgainst),
          voters: row.account.voters.length,
        }))
        .sort((left: LegacyTransferProposalReadback, right: LegacyTransferProposalReadback) =>
          left.proposalRef.localeCompare(right.proposalRef));
    },
  };
}

function enumVariant(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const key = Object.keys(value as Record<string, unknown>)[0] ?? '';
  return key ? `${key[0].toUpperCase()}${key.slice(1)}` : '';
}

function numericString(value: any): string {
  return typeof value === 'number' ? String(value) : value.toString(10);
}

function safeChainInteger(value: unknown): number {
  let numeric: bigint;
  try {
    numeric = typeof value === 'bigint' ? value : BigInt(String(value));
  } catch {
    throw new Error('invalid_governance_compatibility_chain_integer');
  }
  if (numeric < 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('invalid_governance_compatibility_chain_integer');
  }
  return Number(numeric);
}

function normalizeAnchorValue(value: any): any {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value?.toBase58 === 'function') return value.toBase58();
  if (value?.constructor?.name === 'BN') return value.toString(10);
  if (Array.isArray(value)) return value.map(normalizeAnchorValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeAnchorValue(child)]),
    );
  }
  throw new Error('unsupported_governance_compatibility_chain_value');
}
