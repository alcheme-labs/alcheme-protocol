import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "mocha";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Batch19 RED: start-local-stack auto-detects core redeploy conditions", () => {
  const script = read("scripts/start-local-stack.sh");

  it("defines a FORCE_REDEPLOY_CORE toggle", () => {
    assert.match(script, /FORCE_REDEPLOY_CORE="\$\{FORCE_REDEPLOY_CORE:-false\}"/);
  });

  it("tracks a core source fingerprint so program changes can force redeploy automatically", () => {
    assert.match(
      script,
      /CORE_PROGRAM_FINGERPRINT_FILE=/
    );
    assert.match(
      script,
      /current_core_source_fingerprint\(\)/
    );
    assert.match(
      script,
      /core_sources_changed_since_last_deploy\(\)/
    );
    assert.match(
      script,
      /record_core_source_fingerprint\(\)/
    );
  });

  it("bypasses the 'already deployed' early return when source fingerprint changed", () => {
    assert.match(
      script,
      /deploy_core_if_needed\(\)\s*\{[\s\S]*elif core_sources_changed_since_last_deploy; then[\s\S]*running scripts\/deploy-local-optimized\.sh/
    );
    assert.match(
      script,
      /record_core_source_fingerprint[\s\S]*\n[\s\S]*\}/
    );
  });

  it("resolves stale failed slots when checkpoint fast-forward advances the local indexer", () => {
    assert.match(
      script,
      /resolve_failed_slots_before\(\)/
    );
    assert.match(
      script,
      /UPDATE indexer_failed_slots[\s\S]*SET resolved=TRUE, resolved_at=NOW\(\), updated_at=NOW\(\)[\s\S]*WHERE program_id='.*'\s+AND resolved=FALSE\s+AND slot <=/
    );
    assert.match(
      script,
      /ensure_indexer_checkpoint_freshness\(\)\s*\{[\s\S]*resolve_failed_slots_before "\$EVENT_PROGRAM_ID" "\$target_slot"/
    );
  });

  it("also resolves failed slots already behind the current checkpoint before starting the local indexer", () => {
    assert.match(
      script,
      /resolve_failed_slots_behind_checkpoint\(\)/
    );
    assert.match(
      script,
      /start_indexer_optional\(\)\s*\{[\s\S]*resolve_failed_slots_behind_checkpoint "\$EVENT_PROGRAM_ID"/
    );
  });
});
