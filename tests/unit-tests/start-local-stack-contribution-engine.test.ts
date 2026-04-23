import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'mocha';

const ROOT = process.cwd();
const script = fs.readFileSync(
  path.join(ROOT, 'scripts', 'start-local-stack.sh'),
  'utf8',
);

describe('contribution-engine local stack semantics', () => {
  it('still deploys contribution_engine with the resolved keypair truth', () => {
    assert.match(script, /resolve_contribution_keypair\(\)/);
    assert.match(script, /ensure_contribution_program\(\)/);
    assert.match(script, /deploying contribution_engine:/);
  });

  it('starts tracker explicitly and exposes settlement toggles with safe defaults', () => {
    assert.match(script, /TRACKER_SETTLEMENT_ENABLED="\$\{TRACKER_SETTLEMENT_ENABLED:-false\}"/);
    assert.match(script, /TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN="\$\{TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN:-false\}"/);
    assert.match(script, /IDENTITY_REGISTRY_NAME="\$\{IDENTITY_REGISTRY_NAME:-social_hub_identity\}"/);
    assert.match(script, /start_tracker\(\)/);
    assert.match(script, /SETTLEMENT_ENABLED=\\?"\$TRACKER_SETTLEMENT_ENABLED\\?"/);
    assert.match(script, /SETTLEMENT_EXECUTE_ON_CHAIN=\\?"\$TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN\\?"/);
    assert.match(script, /IDENTITY_REGISTRY_NAME=\\?"\$IDENTITY_REGISTRY_NAME\\?"/);
  });

  it('logs tracker runtime semantics so deploy, tracker, and settlement state are not ambiguous', () => {
    assert.match(script, /tracker runtime: contribution_engine=/);
    assert.match(script, /identity_registry_name=\$IDENTITY_REGISTRY_NAME/);
    assert.match(script, /settlement_enabled=\$TRACKER_SETTLEMENT_ENABLED/);
    assert.match(script, /settlement_execute_on_chain=\$TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN/);
  });
});
