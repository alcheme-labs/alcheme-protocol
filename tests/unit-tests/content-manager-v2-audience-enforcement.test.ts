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

describe("Task6 RED: v2 audience enforcement", () => {
  const instructionsRs = read("programs/content-manager/src/instructions.rs");
  const validationRs = read("programs/content-manager/src/validation.rs");
  const cpiRs = read("cpi-interfaces/src/lib.rs");

  it("adds fact readers for follow and circle membership instead of treating config as truth", () => {
    expect(cpiRs).to.include("pub fn check_follow_relationship_simple(");
    expect(cpiRs).to.include("pub fn read_circle_membership_simple(");
  });

  it("adds fact-aware validators for follower and circle audiences", () => {
    expect(validationRs).to.include("fn validate_visible_to_requester_with_facts(");
    expect(validationRs).to.include("pub fn validate_reply_permission_with_facts(");
    expect(validationRs).to.include("pub fn validate_quote_permission_with_facts(");
    expect(validationRs).to.include("pub fn validate_repost_permission_with_facts(");
    expect(validationRs).to.match(/VisibilityLevel::Followers[\s\S]*has_follow_relationship/);
    expect(validationRs).to.match(/VisibilityLevel::Community\(_\)[\s\S]*has_circle_membership/);
  });

  it("validates v2 relation targets against raw audience kind instead of public-only visibility", () => {
    const relationTargetBody = section(
      instructionsRs,
      "fn validate_v2_relation_target_anchor(",
      "fn validate_v2_relation_target_post("
    );

    expect(relationTargetBody, "missing validate_v2_relation_target_anchor").to.not.equal("");
    expect(relationTargetBody).to.match(/target_anchor\.audience_kind\(\)/);
    expect(relationTargetBody).to.match(/V2AudienceKind::FollowersOnly/);
    expect(relationTargetBody).to.match(/V2AudienceKind::CircleOnly/);
    expect(relationTargetBody).to.not.match(/target_anchor\.visibility\(\)\s*==\s*AccessLevel::Public/);
  });

  it("requires explicit proof accounts on both legacy-target and by-id relation routes", () => {
    const replyAccounts = section(
      instructionsRs,
      "pub struct CreateReplyV2<'info> {",
      "/// 创建转发（v2 最小锚点）"
    );
    const repostAccounts = section(
      instructionsRs,
      "pub struct CreateRepostV2<'info> {",
      "/// 创建引用（v2 最小锚点）"
    );
    const quoteAccounts = section(
      instructionsRs,
      "pub struct CreateQuoteV2<'info> {",
      "/// v2 生命周期共用账户"
    );
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
      "pub struct UpdateContentV2Lifecycle<'info> {"
    );

    for (const body of [replyAccounts, repostAccounts, quoteAccounts, replyByIdAccounts, repostByIdAccounts, quoteByIdAccounts]) {
      expect(body, "missing relation account context").to.not.equal("");
      expect(body).to.match(/pub target_follow_relationship:\s*UncheckedAccount<'info>/);
      expect(body).to.match(/pub target_circle_membership:\s*UncheckedAccount<'info>/);
    }
  });
});
