import type { GovernanceLegacyCompatibilityBundleInput } from './governanceLegacyCompatibilityBundle';

const CIRCLE_SUBJECTS = new Set(['circle', 'circles', 'circle-manager']);

export interface GovernanceLegacyMutationSurfaceSnapshot {
  gitHead: string;
  sourceInputDigest: string;
  routes: GovernanceLegacyCompatibilityBundleInput['routes'];
}

export function readGovernanceLegacyCircleMutationSurfaces(ledger: any): GovernanceLegacyMutationSurfaceSnapshot {
  if (
    ledger?.schemaVersion !== 1
    || ledger?.milestone !== 'P01-M1'
    || !Array.isArray(ledger.rows)
    || ledger.canonicalRowCount !== ledger.rows.length
    || ledger.policy?.productionBehaviorChanged !== false
  ) {
    throw new Error('invalid_governance_compatibility_mutation_ledger');
  }
  if (
    !/^[a-f0-9]{40}$/.test(ledger.gitHead)
    || !/^[a-f0-9]{64}$/.test(ledger.sourceInputDigest)
  ) {
    throw new Error('invalid_governance_compatibility_mutation_ledger');
  }
  const rows = ledger.rows.filter((row: any) => CIRCLE_SUBJECTS.has(row.subject));
  const actions = new Set(rows.map((row: any) => row.actionType));
  for (const action of [
    'program:propose_transfer',
    'program:vote',
    'program:submit_ai_evaluation',
    'program:execute_transfer',
    'program:update_decision_engine',
    'instruction-call:proposeTransfer',
    'instruction-call:vote',
    'instruction-call:submitAiEvaluation',
    'instruction-call:executeTransfer',
    'instruction-call:updateDecisionEngine',
  ]) {
    if (!actions.has(action)) {
      throw new Error('governance_compatibility_mutation_ledger_incomplete');
    }
  }
  return {
    gitHead: ledger.gitHead,
    sourceInputDigest: ledger.sourceInputDigest,
    routes: rows
      .map((row: any) => ({
        actionType: row.actionType,
        routeRef: row.candidateKey,
        authority: row.authority,
        status: row.classification,
      }))
      .sort((left: any, right: any) =>
        `${left.actionType}:${left.routeRef}`.localeCompare(`${right.actionType}:${right.routeRef}`)),
  };
}
