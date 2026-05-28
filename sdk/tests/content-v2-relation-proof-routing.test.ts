import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "@jest/globals";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Task7 RED: sdk relation proof routing", () => {
  const pdaSource = read("src/utils/pda.ts");
  const contentSource = read("src/modules/content.ts");

  it("derives circle authority and membership proof PDAs for relation targets", () => {
    assert.match(pdaSource, /findCirclePda/);
    assert.match(pdaSource, /findCircleMemberPda/);
  });

  it("stops using SystemProgram placeholders for relation proof accounts", () => {
    assert.doesNotMatch(contentSource, /targetFollowRelationship:\s*SystemProgram\.programId/);
    assert.doesNotMatch(contentSource, /targetCircleMembership:\s*SystemProgram\.programId/);
    assert.match(contentSource, /resolveRelationProofAccounts/);
  });
});
