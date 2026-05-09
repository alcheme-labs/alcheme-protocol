import { strict as assert } from "node:assert";
import fs from "fs";
import path from "path";
import { describe, it } from "@jest/globals";

const ROOT = path.resolve(__dirname, "..");
const CONTENT_MODULE = fs.readFileSync(path.join(ROOT, "src/modules/content.ts"), "utf8");
const CONTENT_IDL = fs.readFileSync(path.join(ROOT, "src/idl/content_manager.json"), "utf8");

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    return "";
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    return source.slice(start);
  }
  return source.slice(start, end);
}

describe("Task5 RED: ContentModule v2 audience control", () => {
  it("extends sdk visibility input to cover CircleOnly and raw circle authority id", () => {
    assert.match(
      CONTENT_MODULE,
      /export type VisibilityLevelInput = "Public" \| "Followers" \| "Friends" \| "Private" \| "CircleOnly"/
    );
    assert.match(CONTENT_MODULE, /protocolCircleId\?: number/);
  });

  it("routes CircleOnly writes through a dedicated v2 audience instruction instead of downgrading to Private", () => {
    const createContentV2Section = section(
      CONTENT_MODULE,
      "private async createContentV2(",
      "private buildV2UriRef("
    );

    assert.notEqual(createContentV2Section, "", "missing createContentV2 implementation");
    assert.match(createContentV2Section, /visibilityLevel === "CircleOnly"/);
    assert.match(createContentV2Section, /\.createContentV2WithAudience\(/);
    assert.doesNotMatch(
      createContentV2Section,
      /visibilityLevel === "CircleOnly"[\s\S]*\?\s*"Private"/
    );
  });

  it("anchors raw audience information into the v2 content hash payload", () => {
    assert.match(CONTENT_MODULE, /protocolCircleId/);
    assert.match(CONTENT_MODULE, /visibilityLevel/);
    assert.match(CONTENT_MODULE, /contentStatus/);
  });

  it("syncs sdk idl with the new v2 audience instruction", () => {
    assert.match(CONTENT_IDL, /"name": "create_content_v2_with_audience"/);
  });
});
