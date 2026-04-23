import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "mocha";

function repoFile(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

function read(relativePath: string): string {
  const filePath = repoFile(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

describe("relation v2 cost scripts", () => {
  const scripts = [
    {
      path: "scripts/measure/create-reply-v2-cost.ts",
      threshold: "CREATE_REPLY_V2_THRESHOLD_LAMPORTS",
    },
    {
      path: "scripts/measure/create-repost-v2-cost.ts",
      threshold: "CREATE_REPOST_V2_THRESHOLD_LAMPORTS",
    },
    {
      path: "scripts/measure/create-quote-v2-cost.ts",
      threshold: "CREATE_QUOTE_V2_THRESHOLD_LAMPORTS",
    },
  ];

  for (const script of scripts) {
    it(`${path.basename(script.path)} keeps threshold_lamports in baseResult`, () => {
      const source = read(script.path);
      assert.match(
        source,
        new RegExp(`threshold_lamports:\\s*${script.threshold}`),
      );
      assert.match(source, /\.\.\.baseResult/);
    });
  }
});
