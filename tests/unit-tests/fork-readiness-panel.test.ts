import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Fork readiness panel and canonical data wiring', () => {
  const panelSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/fork-lineage/ForkReadinessPanel.tsx'),
    'utf8',
  );
  const adapterSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/fork-lineage/adapter.ts'),
    'utf8',
  );
  const apiSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/fork-lineage/api.ts'),
    'utf8',
  );
  const policySource = readFileSync(
    resolve(process.cwd(), 'frontend/src/lib/circles/policyProfile.ts'),
    'utf8',
  );

  it('upgrades the panel from hint-only copy to qualification-aware fork guidance', () => {
    assert.match(panelSource, /继续分支条件/);
    assert.match(panelSource, /当前资格/);
    assert.match(panelSource, /贡献门槛/);
    assert.match(panelSource, /身份保护线/);
  });

  it('tracks submit readiness in the adapter instead of leaving the panel as a future placeholder', () => {
    assert.match(adapterSource, /qualificationStatus/);
    assert.match(adapterSource, /contributorCount/);
    assert.match(adapterSource, /canSubmitFork/);
    assert.match(adapterSource, /declarationPlaceholder/);
    assert.doesNotMatch(adapterSource, /pending_projection/);
    assert.doesNotMatch(adapterSource, /requiresTeam00Window/);
  });

  it('talks to the canonical fork creation route with declaration and inheritance payloads', () => {
    assert.match(apiSource, /createForkFromCircle/);
    assert.match(apiSource, /\/api\/v1\/fork\/circles\/\$\{input\.sourceCircleId\}\/forks/);
    assert.match(apiSource, /declarationText/);
    assert.match(apiSource, /inheritanceSnapshot/);
  });

  it('reuses the existing policy profile chain for fork prefill data', () => {
    assert.match(policySource, /export interface CircleForkPolicy/);
    assert.match(policySource, /forkPolicy/);
    assert.match(policySource, /minimumContributions/);
    assert.match(policySource, /minimumRole/);
  });
});
