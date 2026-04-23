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

describe("Task17 RED: compact v2 control account", () => {
  const instructionsRs = read("programs/content-manager/src/instructions.rs");
  const stateRs = read("programs/content-manager/src/state.rs");
  const eventsRs = read("shared/src/events.rs");

  it("shrinks v2 on-chain control state to visibility/status/version/bump only", () => {
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
    expect(anchorAccountBody).to.not.match(/pub content_hash:\s*\[u8;\s*32\]/);
    expect(anchorAccountBody).to.not.match(/pub uri_ref:\s*String/);
    expect(anchorAccountBody).to.match(/pub state_flags:\s*u8/);
    expect(anchorAccountBody).to.match(/pub packed_control:\s*u32/);
    expect(anchorAccountBody).to.match(/pub bump:\s*u8/);
    expect(anchorImplBody).to.match(/pub const SPACE:\s*usize\s*=\s*8\s*\+\s*1\s*\+\s*4\s*\+\s*1/);
    expect(eventsRs).to.include("ContentAnchoredV2 {");
    expect(eventsRs).to.include("ContentAnchorUpdatedV2 {");
    expect(eventsRs).to.match(/ContentAnchoredV2[\s\S]*content_hash:\s*\[u8;\s*32\]/);
    expect(eventsRs).to.match(/ContentAnchoredV2[\s\S]*uri_ref:\s*String/);
    expect(eventsRs).to.match(/ContentAnchorUpdatedV2[\s\S]*content_hash:\s*\[u8;\s*32\]/);
    expect(eventsRs).to.match(/ContentAnchorUpdatedV2[\s\S]*uri_ref:\s*String/);
  });

  it("derives writer-owned v2 anchor pdas from author + content_id", () => {
    const createContentAccounts = section(
      instructionsRs,
      "pub struct CreateContentV2<'info> {",
      "/// 创建回复（v2 最小锚点）"
    );
    const lifecycleAccounts = section(
      instructionsRs,
      "pub struct UpdateContentV2Lifecycle<'info> {",
      "pub fn emit_v2_status_changed("
    );
    const updateAccounts = section(
      instructionsRs,
      "pub struct UpdateContentAnchorV2<'info> {",
      "pub fn update_content_anchor_v2("
    );

    expect(createContentAccounts).to.match(
      /seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*author\.key\(\)\.as_ref\(\),\s*&content_id\.to_le_bytes\(\)\s*\]/
    );
    expect(lifecycleAccounts).to.match(
      /seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*author\.key\(\)\.as_ref\(\),\s*&content_id\.to_le_bytes\(\)\s*\]/
    );
    expect(updateAccounts).to.match(
      /seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*author\.key\(\)\.as_ref\(\),\s*&content_id\.to_le_bytes\(\)\s*\]/
    );
  });

  it("requires target author accounts for by-id relation lookups", () => {
    const replyByIdAccounts = section(
      instructionsRs,
      "pub struct CreateReplyV2ById<'info> {",
      "/// 创建转发（v2 最小锚点，by_id 关系）"
    );
    const repostByIdAccounts = section(
      instructionsRs,
      "pub struct CreateRepostV2ById<'info> {",
      "/// 创建引用（v2 最小锚点，by_id 关系）"
    );
    const quoteByIdAccounts = section(
      instructionsRs,
      "pub struct CreateQuoteV2ById<'info> {",
      "pub struct V2ContentLifecycle<'info> {"
    );

    expect(replyByIdAccounts).to.match(/pub parent_author:\s*AccountInfo<'info>/);
    expect(replyByIdAccounts).to.match(
      /seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*parent_author\.key\(\)\.as_ref\(\),\s*&parent_content_id\.to_le_bytes\(\)\s*\]/
    );
    expect(repostByIdAccounts).to.match(/pub original_author:\s*AccountInfo<'info>/);
    expect(repostByIdAccounts).to.match(
      /seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*original_author\.key\(\)\.as_ref\(\),\s*&original_content_id\.to_le_bytes\(\)\s*\]/
    );
    expect(quoteByIdAccounts).to.match(/pub quoted_author:\s*AccountInfo<'info>/);
    expect(quoteByIdAccounts).to.match(
      /seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*quoted_author\.key\(\)\.as_ref\(\),\s*&quoted_content_id\.to_le_bytes\(\)\s*\]/
    );
  });
});
