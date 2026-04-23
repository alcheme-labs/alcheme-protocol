import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'mocha';

const repoRoot = resolve(process.cwd());
const crucibleEditorSource = readFileSync(
  join(repoRoot, 'frontend/src/components/circle/CrucibleEditor/CrucibleEditor.tsx'),
  'utf8',
);
const crucibleTabSource = readFileSync(
  join(repoRoot, 'frontend/src/components/circle/CrucibleTab/CrucibleTab.tsx'),
  'utf8',
);

describe('Crucible paragraph collaboration regression guard', () => {
  it('uses the collaborative paragraph editor instead of a plain textarea fallback', () => {
    assert.match(crucibleEditorSource, /import\s+CollaborativeEditor\s+from\s+'\.\/CollaborativeEditor'/);
    assert.match(crucibleEditorSource, /<CollaborativeEditor[\s\S]*field=\{block\.blockId\}/);
    assert.doesNotMatch(crucibleEditorSource, /<textarea/);
  });

  it('passes the shared collaboration doc into the paragraph editor surface', () => {
    assert.match(crucibleTabSource, /const\s*\{[\s\S]*ydoc,[\s\S]*\}\s*=\s*useCollaboration/);
    assert.match(crucibleTabSource, /<CrucibleEditor[\s\S]*ydoc=\{ydoc\}/);
  });
});
