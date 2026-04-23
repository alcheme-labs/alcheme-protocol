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

describe("Task15: content-manager v2 storage control", () => {
  const libRs = read("programs/content-manager/src/lib.rs");
  const instructionsRs = read("programs/content-manager/src/instructions.rs");
  const stateRs = read("programs/content-manager/src/state.rs");
  const eventsRs = read("shared/src/events.rs");

  it("exposes v2 anchor update program method", () => {
    expect(libRs).to.include("pub fn update_content_anchor_v2(");
  });

  it("stores only compact control state on chain and keeps content payload in events", () => {
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
    expect(anchorAccountBody).to.not.match(/pub content_hash:\s*\[u8;\s*32\]/);
    expect(anchorAccountBody).to.not.match(/pub uri_ref:\s*String/);
    expect(anchorImplBody).to.match(/pub const SPACE:\s*usize\s*=\s*8\s*\+\s*1\s*\+\s*4\s*\+\s*1/);
    expect(anchorImplBody).to.match(/pub fn initialize\([\s\S]*audience_kind:\s*V2AudienceKind/);
    expect(anchorImplBody).to.match(/audience_ref:\s*u8/);
    expect(anchorImplBody).to.match(/status:\s*ContentStatus/);
    expect(anchorImplBody).to.match(/bump:\s*u8/);
    expect(anchorImplBody).to.match(/self\.set_content_version\(1\)/);
    expect(anchorImplBody).to.match(/self\.set_audience_kind\(&audience_kind\)/);
    expect(anchorImplBody).to.match(/self\.set_audience_ref\(audience_ref\)/);
    expect(anchorImplBody).to.match(/self\.set_status\(&status\)/);
  });

  it("defines explicit v2 anchor update accounts and guards", () => {
    expect(instructionsRs).to.include("V2ContentAnchorAlreadyDeleted");

    const updateAccounts = section(
      instructionsRs,
      "pub struct UpdateContentAnchorV2<'info> {",
      "pub fn update_content_anchor_v2("
    );
    expect(updateAccounts, "missing UpdateContentAnchorV2").to.not.equal("");
    expect(updateAccounts).to.match(/pub v2_content_anchor:\s*Account<'info,\s*V2ContentAnchorAccount>/);
    expect(updateAccounts).to.match(/seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*author\.key\(\)\.as_ref\(\),\s*&content_id\.to_le_bytes\(\)\s*\]/);
    expect(updateAccounts).to.match(/pub identity_program:\s*AccountInfo<'info>/);
    expect(updateAccounts).to.match(/pub user_identity:\s*AccountInfo<'info>/);
    expect(updateAccounts).to.match(/pub access_program:\s*AccountInfo<'info>/);
    expect(updateAccounts).to.match(/pub access_controller_account:\s*AccountInfo<'info>/);
  });

  it("updates hash uri and version and emits a dedicated audit event", () => {
    const updateBody = section(
      instructionsRs,
      "pub fn update_content_anchor_v2(",
      "/// 更新内容"
    );
    expect(updateBody, "missing update_content_anchor_v2").to.not.equal("");
    expect(updateBody).to.match(/validate_v2_write_permission/);
    expect(updateBody).to.match(/V2AnchorValidator::validate\(&uri_ref,\s*&ContentAnchorRelation::None\)/);
    expect(updateBody).to.match(/ctx\.accounts\.v2_content_anchor\.status\(\)\s*!=\s*ContentStatus::Deleted/);
    expect(updateBody).to.match(/ctx\.accounts\.v2_content_anchor\.bump_content_version\(\)/);
    expect(updateBody).to.not.match(/ctx\.accounts\.v2_content_anchor\.content_hash\s*=/);
    expect(updateBody).to.not.match(/ctx\.accounts\.v2_content_anchor\.uri_ref\s*=/);
    expect(updateBody).to.match(/emit_content_anchor_updated_v2/);

    expect(eventsRs).to.include("ContentAnchorUpdatedV2 {");
    expect(eventsRs).to.match(/ContentAnchorUpdatedV2\s*\{\s*content_id:\s*u64/);
    expect(eventsRs).to.match(/content_version:\s*u32/);
    expect(eventsRs).to.match(/content_hash:\s*\[u8;\s*32\]/);
    expect(eventsRs).to.match(/uri_ref:\s*String/);
    expect(eventsRs).to.match(/author:\s*Pubkey/);
  });

  it("initializes v2 anchors with the first versioned content snapshot", () => {
    const createContentBody = section(
      instructionsRs,
      "pub fn create_content_v2_with_access(",
      "pub fn create_reply_v2("
    );
    expect(createContentBody).to.match(
      /v2_content_anchor[\s\S]*\.initialize\([\s\S]*audience_kind\.clone\(\)[\s\S]*audience_ref[\s\S]*status\.clone\(\)[\s\S]*v2_content_anchor_bump[\s\S]*\)/
    );
    expect(createContentBody).to.match(/emit_content_anchored_v2/);
  });
});
