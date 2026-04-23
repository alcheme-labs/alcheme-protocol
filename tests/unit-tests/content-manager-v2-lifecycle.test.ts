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

describe("Task13: content-manager v2 lifecycle", () => {
  const libRs = read("programs/content-manager/src/lib.rs");
  const instructionsRs = read("programs/content-manager/src/instructions.rs");
  const stateRs = read("programs/content-manager/src/state.rs");
  const contentRs = read("shared/src/content.rs");
  const eventsRs = read("shared/src/events.rs");

  it("exposes v2 lifecycle program methods", () => {
    expect(libRs).to.include("pub fn publish_content_v2(");
    expect(libRs).to.include("pub fn archive_content_v2(");
    expect(libRs).to.include("pub fn restore_content_v2(");
    expect(libRs).to.include("pub fn tombstone_content_v2(");
  });

  it("keeps lifecycle ownership in author-scoped compact control state", () => {
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
    expect(anchorAccountBody).to.not.match(/pub author:\s*Pubkey/);
    expect(anchorAccountBody).to.match(/pub state_flags:\s*u8/);
    expect(anchorAccountBody).to.match(/pub packed_control:\s*u32/);
    expect(anchorImplBody).to.match(/pub const SPACE:\s*usize\s*=\s*8\s*\+\s*1\s*\+\s*4\s*\+\s*1/);
    expect(anchorImplBody).to.match(/pub fn visibility\(&self\)\s*->\s*AccessLevel/);
    expect(anchorImplBody).to.match(/pub fn status\(&self\)\s*->\s*ContentStatus/);
  });

  it("defines explicit lifecycle errors and shared lifecycle accounts", () => {
    expect(instructionsRs).to.include("V2StatusUnauthorized");
    expect(instructionsRs).to.include("V2StatusAlreadyPublished");
    expect(instructionsRs).to.include("V2StatusAlreadyArchived");
    expect(instructionsRs).to.include("V2StatusAlreadyTombstoned");

    const lifecycleAccounts = section(
      instructionsRs,
      "pub struct UpdateContentV2Lifecycle<'info> {",
      "pub fn publish_content_v2("
    );
    expect(lifecycleAccounts, "missing UpdateContentV2Lifecycle").to.not.equal("");
    expect(lifecycleAccounts).to.match(/pub content_manager:\s*Box<Account<'info,\s*ContentManagerAccount>>/);
    expect(lifecycleAccounts).to.match(/pub v2_content_anchor:\s*Account<'info,\s*V2ContentAnchorAccount>/);
    expect(lifecycleAccounts).to.not.match(/v2_content_anchor\.author/);
    expect(lifecycleAccounts).to.match(/seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*author\.key\(\)\.as_ref\(\),\s*&content_id\.to_le_bytes\(\)\s*\]/);
  });

  it("keeps v2 lifecycle on anchor-only state and emits dedicated v2 status events", () => {
    const publishBody = section(
      instructionsRs,
      "pub fn publish_content_v2(",
      "pub fn archive_content_v2("
    );
    const archiveBody = section(
      instructionsRs,
      "pub fn archive_content_v2(",
      "pub fn restore_content_v2("
    );
    const restoreBody = section(
      instructionsRs,
      "pub fn restore_content_v2(",
      "pub fn tombstone_content_v2("
    );
    const tombstoneBody = section(
      instructionsRs,
      "pub fn tombstone_content_v2(",
      "/// 更新内容"
    );
    const lifecycleHelperBody = section(
      instructionsRs,
      "fn apply_v2_lifecycle_transition<'info>(",
      "#[inline(never)]\npub fn create_content_v2("
    );

    for (const body of [publishBody, archiveBody, restoreBody, tombstoneBody]) {
      expect(body, "missing lifecycle body").to.not.equal("");
      expect(body).to.not.match(/content_post\./);
      expect(body).to.match(/apply_v2_lifecycle_transition/);
    }

    expect(lifecycleHelperBody, "missing apply_v2_lifecycle_transition").to.not.equal("");
    expect(lifecycleHelperBody).to.match(/let old_status = ctx\.accounts\.v2_content_anchor\.status\(\)/);
    expect(lifecycleHelperBody).to.match(/v2_content_anchor\.update_status\(&new_status\)/);
    expect(lifecycleHelperBody).to.match(/emit_content_status_changed_v2/);

    expect(eventsRs).to.include("ContentStatusChangedV2 {");
    expect(eventsRs).to.match(/ContentStatusChangedV2\s*\{\s*content_id:\s*u64/);
    expect(eventsRs).to.match(/old_status:\s*ContentStatus/);
    expect(eventsRs).to.match(/new_status:\s*ContentStatus/);
    expect(eventsRs).to.match(/changed_by:\s*Pubkey/);
  });

  it("tracks active_content with lifecycle-aware manager helpers", () => {
    expect(contentRs).to.include("pub fn create_content_with_status(");
    expect(contentRs).to.include("pub fn apply_v2_status_transition(");
    expect(contentRs).to.match(/matches!\(status,\s*ContentStatus::Published\)/);
    expect(contentRs).to.match(/matches!\(current_status,\s*ContentStatus::Published\)/);
    expect(contentRs).to.match(/matches!\(new_status,\s*ContentStatus::Published\)/);

    const createContentV2WithAccessBody = section(
      instructionsRs,
      "pub fn create_content_v2_with_access(",
      "pub fn create_reply_v2("
    );
    expect(createContentV2WithAccessBody).to.match(/content_manager\.create_content_with_status\(&status\)\?/);
  });

  it("guards duplicate or invalid lifecycle actions with explicit errors", () => {
    const publishBody = section(
      instructionsRs,
      "pub fn publish_content_v2(",
      "pub fn archive_content_v2("
    );
    const archiveBody = section(
      instructionsRs,
      "pub fn archive_content_v2(",
      "pub fn restore_content_v2("
    );
    const restoreBody = section(
      instructionsRs,
      "pub fn restore_content_v2(",
      "pub fn tombstone_content_v2("
    );
    const tombstoneBody = section(
      instructionsRs,
      "pub fn tombstone_content_v2(",
      "/// 更新内容"
    );

    expect(publishBody).to.match(/ContentManagerV2Error::V2StatusAlreadyPublished/);
    expect(archiveBody).to.match(/ContentManagerV2Error::V2StatusAlreadyArchived/);
    expect(restoreBody).to.match(/ContentStatus::Archived/);
    expect(tombstoneBody).to.match(/ContentManagerV2Error::V2StatusAlreadyTombstoned/);
  });
});
