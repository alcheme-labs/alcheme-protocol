import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCreateCircleStepAdvance } from '../src/lib/circle/createCircleStepAdvance.ts';

test('BLANK circles can advance past the source step without seeded files', () => {
  const decision = resolveCreateCircleStepAdvance({
    step: 1,
    totalSteps: 4,
    genesisMode: 'BLANK',
    selectedSeedFileCount: 0,
  });

  assert.deepEqual(decision, {
    type: 'advance',
    nextStep: 2,
  });
});

test('SEEDED circles stay on the source step until at least one file is selected', () => {
  const decision = resolveCreateCircleStepAdvance({
    step: 1,
    totalSteps: 4,
    genesisMode: 'SEEDED',
    selectedSeedFileCount: 0,
  });

  assert.deepEqual(decision, {
    type: 'error',
    errorKey: 'errors.seededRequired',
  });
});

test('SEEDED circles can advance after selecting a source file', () => {
  const decision = resolveCreateCircleStepAdvance({
    step: 1,
    totalSteps: 4,
    genesisMode: 'SEEDED',
    selectedSeedFileCount: 1,
  });

  assert.deepEqual(decision, {
    type: 'advance',
    nextStep: 2,
  });
});
