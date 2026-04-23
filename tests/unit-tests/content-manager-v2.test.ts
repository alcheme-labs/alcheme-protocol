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

describe("Task2 batch3b: content-manager v2 minimal anchor write", () => {
  const libRs = read("programs/content-manager/src/lib.rs");
  const instructionsRs = read("programs/content-manager/src/instructions.rs");
  const eventEmitterInstructionsRs = read("programs/event-emitter/src/instructions.rs");
  const eventsRs = read("shared/src/events.rs");
  const contentRs = read("shared/src/content.rs");
  const cpiRs = read("cpi-interfaces/src/lib.rs");

  it("exposes create_content_v2/create_reply_v2/create_repost_v2 program methods", () => {
    expect(libRs).to.include("pub fn create_content_v2(");
    expect(libRs).to.include("pub fn create_content_v2_with_access(");
    expect(libRs).to.include("pub fn create_reply_v2(");
    expect(libRs).to.include("pub fn create_repost_v2(");
    expect(libRs).to.include("pub fn create_quote_v2(");
    expect(libRs).to.include("pub fn create_reply_v2_by_id(");
    expect(libRs).to.include("pub fn create_repost_v2_by_id(");
    expect(libRs).to.include("pub fn create_quote_v2_by_id(");
  });

  it("keeps legacy create_content_v2 while adding explicit v2 access/status path", () => {
    const createContentV2Body = section(
      instructionsRs,
      "pub fn create_content_v2(",
      "pub fn create_content_v2_with_access("
    );
    const createContentV2WithAccessBody = section(
      instructionsRs,
      "pub fn create_content_v2_with_access(",
      "pub fn create_reply_v2("
    );

    expect(createContentV2Body).to.match(/create_content_v2_with_access/);
    expect(createContentV2WithAccessBody).to.match(/visibility:\s*AccessLevel/);
    expect(createContentV2WithAccessBody).to.match(/status:\s*ContentStatus/);
    expect(createContentV2WithAccessBody).to.match(/validate_v2_content_access_status/);
  });

  it("defines v2 account contexts without v1 content_post/content_stats/content_storage init", () => {
    const createContentV2Accounts = section(
      instructionsRs,
      "pub struct CreateContentV2<'info> {",
      "pub struct CreateReplyV2<'info> {"
    );
    const createReplyV2Accounts = section(
      instructionsRs,
      "pub struct CreateReplyV2<'info> {",
      "pub fn create_reply_v2("
    );
    const createRepostV2Accounts = section(
      instructionsRs,
      "pub struct CreateRepostV2<'info> {",
      "pub fn create_repost_v2("
    );

    for (const accountsDef of [createContentV2Accounts, createReplyV2Accounts, createRepostV2Accounts]) {
      expect(accountsDef, "missing v2 accounts struct").to.not.equal("");
      expect(accountsDef).to.not.match(/pub content_post\s*:/i);
      expect(accountsDef).to.not.match(/pub content_stats\s*:/i);
      expect(accountsDef).to.not.match(/pub content_storage\s*:/i);
    }
  });

  it("adds readonly parent/original account dependencies only for reply_v2/repost_v2", () => {
    const createReplyV2Accounts = section(
      instructionsRs,
      "pub struct CreateReplyV2<'info> {",
      "pub fn create_reply_v2("
    );
    const createRepostV2Accounts = section(
      instructionsRs,
      "pub struct CreateRepostV2<'info> {",
      "pub fn create_repost_v2("
    );
    const createContentV2Accounts = section(
      instructionsRs,
      "pub struct CreateContentV2<'info> {",
      "pub struct CreateReplyV2<'info> {"
    );

    expect(createReplyV2Accounts).to.match(/pub parent_content_post:\s*Box<Account<'info,\s*ContentPostAccount>>/);
    expect(createRepostV2Accounts).to.match(/pub original_content_post:\s*Box<Account<'info,\s*ContentPostAccount>>/);

    // Controlled exception should not expand to create_content_v2.
    expect(createContentV2Accounts).to.not.match(/parent_content_post|original_content_post/);
  });

  it("initializes lightweight v2 content anchor account across all v2 create contexts", () => {
    const createContentV2Accounts = section(
      instructionsRs,
      "pub struct CreateContentV2<'info> {",
      "pub struct CreateReplyV2<'info> {"
    );
    const createReplyV2Accounts = section(
      instructionsRs,
      "pub struct CreateReplyV2<'info> {",
      "pub struct CreateRepostV2<'info> {"
    );
    const createRepostV2Accounts = section(
      instructionsRs,
      "pub struct CreateRepostV2<'info> {",
      "fn validate_v2_write_permission("
    );

    for (const accountsDef of [createContentV2Accounts, createReplyV2Accounts, createRepostV2Accounts]) {
      expect(accountsDef).to.match(/pub v2_content_anchor:\s*Account<'info,\s*V2ContentAnchorAccount>/);
      expect(accountsDef).to.match(/init[\s\S]*payer\s*=\s*author/);
      expect(accountsDef).to.match(/seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*author\.key\(\)\.as_ref\(\),\s*&content_id\.to_le_bytes\(\)\s*\]/);
    }
  });

  it("requires target v2 anchor account for by-id reply/repost relation semantics", () => {
    const createReplyV2ByIdAccounts = section(
      instructionsRs,
      "pub struct CreateReplyV2ById<'info> {",
      "pub struct CreateRepostV2ById<'info> {"
    );
    const createRepostV2ByIdAccounts = section(
      instructionsRs,
      "pub struct CreateRepostV2ById<'info> {",
      "fn validate_v2_write_permission("
    );

    expect(createReplyV2ByIdAccounts, "missing CreateReplyV2ById accounts").to.not.equal("");
    expect(createRepostV2ByIdAccounts, "missing CreateRepostV2ById accounts").to.not.equal("");

    expect(createReplyV2ByIdAccounts).to.match(/pub parent_author:\s*AccountInfo<'info>/);
    expect(createReplyV2ByIdAccounts).to.match(/pub parent_v2_content_anchor:\s*Account<'info,\s*V2ContentAnchorAccount>/);
    expect(createRepostV2ByIdAccounts).to.match(/pub original_author:\s*AccountInfo<'info>/);
    expect(createRepostV2ByIdAccounts).to.match(/pub original_v2_content_anchor:\s*Account<'info,\s*V2ContentAnchorAccount>/);
    expect(createReplyV2ByIdAccounts).to.match(/seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*parent_author\.key\(\)\.as_ref\(\),\s*&parent_content_id\.to_le_bytes\(\)\s*\]/);
    expect(createRepostV2ByIdAccounts).to.match(/seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*original_author\.key\(\)\.as_ref\(\),\s*&original_content_id\.to_le_bytes\(\)\s*\]/);
  });

  it("requires target v2 anchor account for by-id quote relation semantics", () => {
    const createQuoteV2ByIdAccounts = section(
      instructionsRs,
      "pub struct CreateQuoteV2ById<'info> {",
      "fn validate_v2_write_permission("
    );
    expect(createQuoteV2ByIdAccounts, "missing CreateQuoteV2ById accounts").to.not.equal("");
    expect(createQuoteV2ByIdAccounts).to.match(/pub quoted_author:\s*AccountInfo<'info>/);
    expect(createQuoteV2ByIdAccounts).to.match(/pub quoted_v2_content_anchor:\s*Account<'info,\s*V2ContentAnchorAccount>/);
    expect(createQuoteV2ByIdAccounts).to.match(/seeds\s*=\s*\[\s*CONTENT_V2_ANCHOR_SEED,\s*quoted_author\.key\(\)\.as_ref\(\),\s*&quoted_content_id\.to_le_bytes\(\)\s*\]/);
  });

  it("enforces v2 reply/repost existence and permission semantics at least equal to v1", () => {
    const replyBody = section(
      instructionsRs,
      "pub fn create_reply_v2(",
      "pub fn create_repost_v2("
    );
    const repostBody = section(
      instructionsRs,
      "pub fn create_repost_v2(",
      "/// 更新内容"
    );

    expect(replyBody).to.match(/parent_content_post\.key\(\)\s*==\s*parent_content/);
    expect(replyBody).to.match(/ContentValidator::validate_reply_permission/);
    expect(repostBody).to.match(/original_content_post\.key\(\)\s*==\s*original_content/);
    expect(repostBody).to.match(/ContentValidator::validate_repost_permission/);
  });

  it("drops strict event-sequence gating and keeps content_id validity guard", () => {
    expect(instructionsRs).to.include("pub enum ContentManagerV2Error");
    expect(instructionsRs).to.include("V2ContentIdInvalid");
    expect(instructionsRs).to.match(/fn validate_v2_content_id\(/);
    expect(instructionsRs).to.match(/content_id\s*>\s*0/);
    expect(instructionsRs).to.match(/ContentManagerV2Error::V2ContentIdInvalid/);
    expect(instructionsRs).to.not.match(/expected_next_content_id/);
    expect(instructionsRs).to.not.match(/read_event_sequence_from_event_emitter/);
  });

  it("defines minimal v2 anchor relation type", () => {
    expect(contentRs).to.include("pub enum ContentAnchorRelation");
    expect(contentRs).to.match(/None\s*,/);
    expect(contentRs).to.match(/Reply\s*\{\s*parent_content\s*:\s*Pubkey\s*\}/);
    expect(contentRs).to.match(/Repost\s*\{\s*original_content\s*:\s*Pubkey\s*\}/);
    expect(contentRs).to.match(/Quote\s*\{\s*quoted_content\s*:\s*Pubkey\s*\}/);
    expect(contentRs).to.match(/ReplyById\s*\{\s*parent_content_id\s*:\s*u64\s*\}/);
    expect(contentRs).to.match(/RepostById\s*\{\s*original_content_id\s*:\s*u64\s*\}/);
    expect(contentRs).to.match(/QuoteById\s*\{\s*quoted_content_id\s*:\s*u64\s*\}/);
  });

  it("adds ContentAnchoredV2 event with hash/uri_ref/relation", () => {
    expect(eventsRs).to.include("ContentAnchoredV2 {");
    expect(eventsRs).to.match(/content_hash\s*:\s*\[u8;\s*32\]/);
    expect(eventsRs).to.match(/uri_ref\s*:\s*String/);
    expect(eventsRs).to.match(/relation\s*:\s*ContentAnchorRelation/);
    expect(eventsRs).to.match(/visibility\s*:\s*AccessLevel/);
    expect(eventsRs).to.match(/status\s*:\s*ContentStatus/);
  });

  it("emits ContentAnchoredV2 from all v2 create paths", () => {
    expect(instructionsRs).to.match(/fn emit_content_anchored_v2[\s\S]*ProtocolEvent::ContentAnchoredV2/);
    expect(instructionsRs).to.match(/create_content_v2[\s\S]*emit_content_anchored_v2/);
    expect(instructionsRs).to.match(/create_reply_v2[\s\S]*emit_content_anchored_v2/);
    expect(instructionsRs).to.match(/create_repost_v2[\s\S]*emit_content_anchored_v2/);
    expect(instructionsRs).to.match(/create_quote_v2[\s\S]*emit_content_anchored_v2/);
    expect(instructionsRs).to.match(/create_reply_v2_by_id[\s\S]*emit_content_anchored_v2/);
    expect(instructionsRs).to.match(/create_repost_v2_by_id[\s\S]*emit_content_anchored_v2/);
    expect(instructionsRs).to.match(/create_quote_v2_by_id[\s\S]*emit_content_anchored_v2/);
  });

  it("adds explicit by-id relation guards for v2->v2 paths", () => {
    expect(instructionsRs).to.include("V2RelationTargetInvalid");
    expect(instructionsRs).to.include("V2RelationSelfReference");
    expect(instructionsRs).to.include("V2RelationTargetNotPublic");
    expect(instructionsRs).to.include("V2RelationTargetNotPublished");
    expect(instructionsRs).to.match(/fn validate_v2_relation_content_ids\(/);
    expect(instructionsRs).to.match(/fn validate_v2_relation_target_anchor\(/);
    expect(instructionsRs).to.match(/relation_target_content_id > 0/);
    expect(instructionsRs).to.match(/relation_target_content_id != content_id/);
    expect(instructionsRs).to.match(/match target_anchor\.audience_kind\(\)/);
    expect(instructionsRs).to.match(/V2AudienceKind::FollowersOnly/);
    expect(instructionsRs).to.match(/V2AudienceKind::CircleOnly/);
    expect(instructionsRs).to.match(/target_anchor\.status\(\)\s*==\s*ContentStatus::Published/);
  });

  it("keeps legacy relation target guards aligned with by-id v2 paths", () => {
    const replyBody = section(
      instructionsRs,
      "pub fn create_reply_v2(",
      "pub fn create_repost_v2("
    );
    const repostBody = section(
      instructionsRs,
      "pub fn create_repost_v2(",
      "pub fn create_quote_v2("
    );
    const quoteBody = section(
      instructionsRs,
      "pub fn create_quote_v2(",
      "pub fn create_reply_v2_by_id("
    );

    expect(instructionsRs).to.match(/fn validate_v2_relation_target_post\(\s*target_post:\s*&ContentPostAccount,/);
    expect(instructionsRs).to.match(/ContentValidator::validate_visible_to_requester_with_facts/);
    expect(instructionsRs).to.match(/read_relation_fact_flags/);
    expect(instructionsRs).to.match(/target_post\.status == ContentStatus::Published/);
    expect(replyBody).to.match(/validate_v2_relation_target_post\(\s*parent_post,/);
    expect(repostBody).to.match(/validate_v2_relation_target_post\(\s*original_post,/);
    expect(quoteBody).to.match(/validate_v2_relation_target_post\(\s*quoted_post,/);
    expect(replyBody).to.match(/validate_reply_permission_with_facts/);
    expect(repostBody).to.match(/validate_repost_permission_with_facts/);
    expect(quoteBody).to.match(/validate_quote_permission_with_facts/);
  });

  it("routes v2 anchor create/update events to lightweight event-emitter path", () => {
    expect(cpiRs).to.match(/let lightweight_v2_anchor = matches!\(\s*&event,\s*ProtocolEvent::ContentAnchoredV2 \{ \.\. \} \| ProtocolEvent::ContentAnchorUpdatedV2 \{ \.\. \}\s*\);/);
    expect(cpiRs).to.match(/if lightweight_v2_anchor[\s\S]*build_emit_content_anchor_v2_light_instruction/);
    expect(cpiRs).to.match(/else[\s\S]*build_emit_event_instruction/);
  });

  it("guards lightweight v2 event emitter path as CPI-only", () => {
    const lightEmitFn = section(
      eventEmitterInstructionsRs,
      "pub fn emit_content_anchor_v2_light(",
      "/// 发射权限事件 (CPI)"
    );
    expect(lightEmitFn, "missing emit_content_anchor_v2_light body").to.not.equal("");
    expect(lightEmitFn).to.match(/get_stack_height\(\)\s*>\s*TRANSACTION_LEVEL_STACK_HEIGHT/);
    expect(lightEmitFn).to.match(/UnauthorizedCpiCall/);
    expect(lightEmitFn).to.match(/ProtocolEvent::ContentAnchoredV2 \{ \.\. \} \| ProtocolEvent::ContentAnchorUpdatedV2 \{ \.\. \}/);
  });
});
