import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "@jest/globals";

type IdlInstruction = {
  name: string;
  accounts?: Array<{ name: string }>;
};

type IdlLike = {
  instructions: IdlInstruction[];
};

function readIdl(relativePath: string): IdlLike {
  const root = path.resolve(__dirname, "..", "..");
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as IdlLike;
}

function accountNames(idl: IdlLike, instructionName: string): string[] {
  const instruction = idl.instructions.find((entry) => entry.name === instructionName);
  assert.ok(instruction, `missing instruction in idl: ${instructionName}`);
  return (instruction.accounts || []).map((account) => account.name);
}

describe("Batch18 RED: sdk content-manager idl stays aligned for v2 author-scoped routing", () => {
  const targetIdl = readIdl("target/idl/content_manager.json");
  const sdkIdl = readIdl("sdk/src/idl/content_manager.json");

  for (const instructionName of [
    "create_content_v2",
    "create_content_v2_with_access",
    "create_reply_v2_by_id",
    "create_repost_v2_by_id",
    "create_quote_v2_by_id",
    "update_content_anchor_v2",
  ]) {
    it(`keeps ${instructionName} accounts aligned with target/idl`, () => {
      assert.deepEqual(accountNames(sdkIdl, instructionName), accountNames(targetIdl, instructionName));
    });
  }
});
