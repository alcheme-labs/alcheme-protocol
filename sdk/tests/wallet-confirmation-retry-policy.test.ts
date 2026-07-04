import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from '@jest/globals';

const repoRoot = path.resolve(__dirname, '..', '..');

describe('wallet confirmation retry policy', () => {
  it('does not silently retry identity wallet prompts on event batch seed conflicts', () => {
    const identitySource = readFileSync(path.join(repoRoot, 'sdk/src/modules/identity.ts'), 'utf8');
    assert.doesNotMatch(identitySource, /withResolvedEventAccountsRetry\(\(eventAccounts\)\s*=>\s*sendTransactionWithAlreadyProcessedRecovery/);
    assert.match(identitySource, /requires_wallet_reauthorization|WalletReauthorizationRequired|event_batch_seed_conflict/);
  });
});
