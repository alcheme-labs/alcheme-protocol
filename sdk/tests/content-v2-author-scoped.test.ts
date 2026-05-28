import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "@jest/globals";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Batch17 RED: sdk author-scoped v2 anchor routing", () => {
  const pdaSource = read("src/utils/pda.ts");
  const contentSource = read("src/modules/content.ts");

  it("derives v2 anchor pda from author + contentId", () => {
    assert.match(
      pdaSource,
      /findContentV2AnchorPda\s*\(\s*author:\s*PublicKey,\s*contentId:\s*BN\s*\):\s*PublicKey/
    );
    assert.match(
      pdaSource,
      /\[\s*SEEDS\.CONTENT_V2_ANCHOR,\s*author\.toBuffer\(\),\s*contentId\.toArrayLike\(Buffer,\s*"le",\s*8\),?\s*\]/
    );
  });

  it("uses author-scoped v2 anchor pdas for create and update flows", () => {
    assert.match(
      contentSource,
      /v2ContentAnchor:\s*this\.pda\.findContentV2AnchorPda\(author,\s*contentId\)/
    );
    assert.match(
      contentSource,
      /v2ContentAnchor:\s*this\.pda\.findContentV2AnchorPda\(author,\s*params\.contentId\)/
    );
  });

  it("supports explicit target author pubkeys and query-api compatibility lookup for by-id routes", () => {
    assert.match(contentSource, /parentAuthorPubkey/);
    assert.match(contentSource, /originalAuthorPubkey/);
    assert.match(contentSource, /quotedAuthorPubkey/);
    assert.match(contentSource, /resolveRouteAuthorPubkey/);
    assert.match(contentSource, /lookupTargetPostMetadataByContentId/);
    assert.match(contentSource, /api\/v1\/posts/);
  });
});
