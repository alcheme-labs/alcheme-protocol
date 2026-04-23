import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "mocha";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("start-local-stack indexer schema readiness", () => {
  const script = read("scripts/start-local-stack.sh");

  it("deploys query-api prisma migrations and regenerates the client before starting runtime services", () => {
    assert.match(
      script,
      /deploy_query_api_migrations\(\)\s*\{[\s\S]*\.\/node_modules\/\.bin\/prisma migrate deploy/
    );
    assert.match(
      script,
      /deploy_query_api_migrations\(\)\s*\{[\s\S]*\.\/node_modules\/\.bin\/prisma generate/
    );
    assert.match(
      script,
      /deploy_query_api_migrations[\s\S]*start_indexer_optional\(\)/
    );
  });

  it("prunes locally-missing rolled-back prisma migrations before deploy in local dev", () => {
    assert.match(
      script,
      /cleanup_query_api_rolled_back_orphans\(\)\s*\{[\s\S]*FROM _prisma_migrations[\s\S]*rolled_back_at IS NOT NULL[\s\S]*finished_at IS NULL/
    );
    assert.match(
      script,
      /deploy_query_api_migrations\(\)\s*\{[\s\S]*cleanup_query_api_rolled_back_orphans/
    );
  });

  it("propagates a shared INDEXER_ID to both query-api and indexer-core", () => {
    assert.match(
      script,
      /INDEXER_ID="\$\{INDEXER_ID:-local-indexer-1\}"/
    );
    assert.ok(
      script.includes('local cmd="cd \\"$ROOT_DIR/services/query-api\\" && DATABASE_URL=\\"$DATABASE_URL\\" REDIS_URL=\\"$REDIS_URL\\" SOLANA_RPC_URL=\\"$RPC_URL\\" INDEXER_ID=\\"$INDEXER_ID\\"'),
      "query-api should receive INDEXER_ID in its startup env"
    );
    assert.ok(
      script.includes('base_env="DATABASE_URL=\\"$DATABASE_URL\\" REDIS_URL=\\"$REDIS_URL\\" INDEXER_ID=\\"$INDEXER_ID\\"'),
      "indexer-core should receive INDEXER_ID in base_env"
    );
  });
});
