import { expect } from "chai";
import fs from "fs";
import path from "path";

function repoFile(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

describe("Task8 gate: protocol-level v1 create closure", () => {
  it("disables legacy v1 create entrypoints with an explicit protocol error", () => {
    const libRs = fs.readFileSync(
      repoFile("programs/content-manager/src/lib.rs"),
      "utf8"
    );

    expect(libRs).to.match(/pub fn create_content\([\s\S]*V1WritePathDisabled/);
    expect(libRs).to.match(/pub fn create_reply\([\s\S]*V1WritePathDisabled/);
    expect(libRs).to.match(/pub fn create_quote\([\s\S]*V1WritePathDisabled/);
    expect(libRs).to.match(/pub fn create_repost\([\s\S]*V1WritePathDisabled/);
  });
});
