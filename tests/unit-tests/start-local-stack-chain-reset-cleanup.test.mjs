import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filePath), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'start-local-stack.sh');

function readScript() {
  assert.equal(fs.existsSync(scriptPath), true, `missing file: ${scriptPath}`);
  return fs.readFileSync(scriptPath, 'utf8');
}

test('start-local-stack tracks fresh-chain signals separately from ordinary redeploys', () => {
  const source = readScript();

  assert.match(source, /CORE_PROGRAMS_WERE_MISSING="false"/);
  assert.match(source, /REQUIRED_PDAS_WERE_MISSING="false"/);
  assert.match(source, /check_core_programs; then[\s\S]*return[\s\S]*CORE_PROGRAMS_WERE_MISSING="true"/);
  assert.match(source, /if check_required_pdas; then[\s\S]*return[\s\S]*REQUIRED_PDAS_WERE_MISSING="true"/);
});

test('start-local-stack can clear local read models when a fresh chain is detected', () => {
  const source = readScript();

  assert.match(source, /RESET_LOCAL_READ_MODEL_ON_CHAIN_REBUILD="\$\{RESET_LOCAL_READ_MODEL_ON_CHAIN_REBUILD:-true\}"/);
  assert.match(source, /cleanup_local_read_model_after_chain_rebuild_if_needed\(\)/);
  assert.match(source, /tablename <> '_prisma_migrations'/);
  assert.match(source, /TRUNCATE TABLE \$\{tables\} RESTART IDENTITY CASCADE/);
});

test('start-local-stack runs local read-model cleanup after migrations and before runtime startup', () => {
  const source = readScript();

  assert.match(
    source,
    /ensure_data_services[\s\S]*deploy_query_api_migrations[\s\S]*cleanup_local_read_model_after_chain_rebuild_if_needed[\s\S]*seed_fresh_chain_checkpoint_baseline_if_needed[\s\S]*resolve_indexer_event_source[\s\S]*start_query_api/
  );
});

test('start-local-stack seeds a sync checkpoint baseline after fresh-chain cleanup', () => {
  const source = readScript();

  assert.match(source, /seed_fresh_chain_checkpoint_baseline_if_needed\(\)/);
  assert.match(source, /INSERT INTO sync_checkpoints/);
  assert.match(source, /ON CONFLICT \(program_id\) DO UPDATE SET/);
  assert.match(source, /last_processed_slot = EXCLUDED.last_processed_slot/);
});
