import { expect } from "chai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const ROOT = path.resolve(THIS_DIR, "..", "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

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

describe("Task5 RED: v2 audience control plane", () => {
  const libRs = read("programs/content-manager/src/lib.rs");
  const instructionsRs = read("programs/content-manager/src/instructions.rs");
  const stateRs = read("programs/content-manager/src/state.rs");
  const eventsRs = read("shared/src/events.rs");
  const typesRs = read("shared/src/types.rs");
  const schemaPrisma = read("services/query-api/prisma/schema.prisma");
  const dbWriterRs = read("services/indexer-core/src/database/db_writer.rs");

  it("freezes a packed v2 audience control word without increasing account size", () => {
    const anchorAccountBody = section(
      stateRs,
      "pub struct V2ContentAnchorAccount {",
      "impl V2ContentAnchorAccount {"
    );
    const anchorImplBody = section(
      stateRs,
      "impl V2ContentAnchorAccount {",
      "// ==================== Wrapper Accounts ===================="
    );

    expect(anchorAccountBody, "missing V2ContentAnchorAccount").to.not.equal("");
    expect(anchorAccountBody).to.match(/pub state_flags:\s*u8/);
    expect(anchorAccountBody).to.match(/pub packed_control:\s*u32/);
    expect(anchorAccountBody).to.match(/pub bump:\s*u8/);
    expect(anchorAccountBody).to.not.match(/pub content_hash:\s*\[u8;\s*32\]/);
    expect(anchorAccountBody).to.not.match(/pub uri_ref:\s*String/);
    expect(anchorImplBody).to.match(/pub const SPACE:\s*usize\s*=\s*8\s*\+\s*1\s*\+\s*4\s*\+\s*1/);
    expect(anchorImplBody).to.match(/pub fn audience_kind\(&self\)\s*->\s*V2AudienceKind/);
    expect(anchorImplBody).to.match(/pub fn audience_ref\(&self\)\s*->\s*u8/);
    expect(anchorImplBody).to.match(/pub fn content_version\(&self\)\s*->\s*u32/);
    expect(anchorImplBody).to.match(
      /pub fn initialize\([\s\S]*audience_kind:\s*V2AudienceKind[\s\S]*audience_ref:\s*u8[\s\S]*status:\s*ContentStatus[\s\S]*bump:\s*u8/
    );
  });

  it("defines an explicit raw audience enum shared by state and events", () => {
    expect(typesRs).to.include("pub enum V2AudienceKind");
    expect(typesRs).to.match(/pub enum V2AudienceKind\s*\{[\s\S]*Public[\s\S]*Private[\s\S]*FollowersOnly[\s\S]*CircleOnly/);

    expect(eventsRs).to.match(/ContentAnchoredV2\s*\{[\s\S]*audience_kind:\s*V2AudienceKind[\s\S]*audience_ref:\s*u8/);
    expect(eventsRs).to.match(/ContentAnchorUpdatedV2\s*\{[\s\S]*audience_kind:\s*V2AudienceKind[\s\S]*audience_ref:\s*u8/);
    expect(eventsRs).to.match(/ContentStatusChangedV2\s*\{[\s\S]*audience_kind:\s*V2AudienceKind[\s\S]*audience_ref:\s*u8/);
  });

  it("adds a dedicated v2 create entrypoint for raw audience writes while keeping access-based compatibility", () => {
    expect(libRs).to.include("pub fn create_content_v2_with_audience(");

    const accessBody = section(
      instructionsRs,
      "pub fn create_content_v2_with_access(",
      "pub fn create_reply_v2("
    );
    const audienceBody = section(
      instructionsRs,
      "pub fn create_content_v2_with_audience(",
      "pub fn create_reply_v2("
    );

    expect(accessBody, "missing create_content_v2_with_access").to.not.equal("");
    expect(audienceBody, "missing create_content_v2_with_audience").to.not.equal("");
    expect(accessBody).to.match(/create_content_v2_with_audience\(/);
    expect(audienceBody).to.match(/audience_kind:\s*V2AudienceKind/);
    expect(audienceBody).to.match(/audience_ref:\s*u8/);
  });

  it("persists raw audience columns in the read model instead of deriving circle semantics from visibility alone", () => {
    expect(schemaPrisma).to.match(/v2AudienceKind\s+String\?\s+@map\("v2_audience_kind"\)/);
    expect(schemaPrisma).to.match(/v2AudienceRef\s+Int\?\s+@map\("v2_audience_ref"\)/);
    expect(dbWriterRs).to.match(/v2_audience_kind\s*=\s*COALESCE\(\$16,\s*v2_audience_kind\)/);
    expect(dbWriterRs).to.match(/v2_audience_ref\s*=\s*COALESCE\(\$17,\s*v2_audience_ref\)/);
  });
});
