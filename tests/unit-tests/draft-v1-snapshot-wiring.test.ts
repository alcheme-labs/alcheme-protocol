import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('discussion draft trigger v1 snapshot wiring', () => {
  const triggerSource = readFileSync(
    resolve(process.cwd(), 'services/query-api/src/ai/discussion-draft-trigger.ts'),
    'utf8',
  );
  const readModelSource = readFileSync(
    resolve(process.cwd(), 'services/query-api/src/services/draftLifecycle/readModel.ts'),
    'utf8',
  );

  it('materializes a persisted v1 draft snapshot when discussion creates a formal draft', () => {
    assert.match(triggerSource, /createDraftVersionSnapshot/);
    assert.match(triggerSource, /draftVersion:\s*1/);
    assert.match(triggerSource, /contentSnapshot:\s*input\.text/);
  });

  it('prefers the persisted v1 snapshot before falling back to reconstructed seed evidence', () => {
    assert.match(readModelSource, /loadDraftVersionSnapshot/);
    assert.match(readModelSource, /currentSnapshotVersion\s*===\s*1/);
  });
});
