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

describe("Batch12 RED: v2 permission truth source", () => {
  const cpiRs = read("cpi-interfaces/src/lib.rs");
  const validationRs = read("programs/content-manager/src/validation.rs");
  const instructionsRs = read("programs/content-manager/src/instructions.rs");
  const accessRs = read("shared/src/access.rs");

  it("CPI identity and permission helpers should not remain unconditional placeholder passes", () => {
    const verifyIdentityBody = section(
      cpiRs,
      "pub fn verify_identity_simple(",
      "/// 检查权限 - 简化的 CPI 调用"
    );
    const checkPermissionBody = section(
      cpiRs,
      "pub fn check_permission_simple(",
      "/// 发射事件 - 真实的 CPI 调用"
    );
    const verifyIdentitySignature = verifyIdentityBody.slice(
      0,
      verifyIdentityBody.indexOf(") -> Result<bool> {") + ") -> Result<bool> {".length
    );
    const checkPermissionSignature = checkPermissionBody.slice(
      0,
      checkPermissionBody.indexOf(") -> Result<bool> {") + ") -> Result<bool> {".length
    );

    expect(verifyIdentityBody, "missing verify_identity_simple body").to.not.equal("");
    expect(checkPermissionBody, "missing check_permission_simple body").to.not.equal("");

    expect(verifyIdentityBody).to.not.include("跳过账户反序列化，直接返回 true");
    expect(checkPermissionBody).to.not.include("跳过账户反序列化，简化返回 true");
    expect(verifyIdentitySignature).to.not.match(/\b_identity_program\b|\b_user_identity\b|\b_identity_id\b/);
    expect(checkPermissionSignature).to.not.match(/\b_access_program\b|\b_access_controller\b|\b_permission\b/);
  });

  it("reply/quote/repost permission validators should not keep placeholder allow-or-deny branches", () => {
    const replyBody = section(
      validationRs,
      "pub fn validate_reply_permission(",
      "/// 验证引用权限"
    );
    const quoteBody = section(
      validationRs,
      "pub fn validate_quote_permission(",
      "/// 验证转发权限"
    );
    const repostBody = section(
      validationRs,
      "pub fn validate_repost_permission(",
      "/// 验证互动类型"
    );

    expect(replyBody, "missing validate_reply_permission body").to.not.equal("");
    expect(quoteBody, "missing validate_quote_permission body").to.not.equal("");
    expect(repostBody, "missing validate_repost_permission body").to.not.equal("");

    expect(replyBody).to.not.include("简化实现：假设有权限");
    expect(replyBody).to.not.match(/ReplyPermission::Followers[\s\S]*Ok\(\)/);
    expect(replyBody).to.not.match(/ReplyPermission::Mentioned[\s\S]*Ok\(\)/);

    expect(quoteBody).to.not.include("简化实现：假设有权限");
    expect(quoteBody).to.not.match(/QuotePermission::Followers[\s\S]*Ok\(\)/);

    expect(repostBody).to.not.include("简化实现：假设有权限");
    expect(repostBody).to.not.match(/RepostPermission::Followers[\s\S]*Ok\(\)/);
  });

  it("access-controller relationship levels should not stay hardcoded false for followers/friends/custom", () => {
    const accessLevelBody = section(
      accessRs,
      "fn check_access_level(",
      "/// 评估条件"
    );

    expect(accessLevelBody, "missing check_access_level body").to.not.equal("");
    expect(accessLevelBody).to.include("AccessLevel::Followers => self.check_relationship_access(RelationshipType::Follower, requester, target)");
    expect(accessLevelBody).to.include("AccessLevel::Friends => self.check_relationship_access(RelationshipType::Friend, requester, target)");
    expect(accessLevelBody).to.include("AccessLevel::Custom => self.check_custom_access(requester, target)");
  });

  it("content visibility mapping should not collapse followers/friends/community/custom into private", () => {
    const contentCreatedEventBody = section(
      instructionsRs,
      "let content_created_event = ProtocolEvent::ContentCreated {",
      "let _event_sequence = alcheme_cpi::CpiHelper::emit_event_simple("
    );

    expect(contentCreatedEventBody, "missing ContentCreated event body").to.not.equal("");
    expect(contentCreatedEventBody).to.not.include("VisibilityLevel::Followers => AccessLevel::Private");
    expect(contentCreatedEventBody).to.not.include("VisibilityLevel::Friends => AccessLevel::Private");
    expect(contentCreatedEventBody).to.not.include("VisibilityLevel::Community(_) => AccessLevel::Private");
    expect(contentCreatedEventBody).to.not.include("VisibilityLevel::Custom(_) => AccessLevel::Private");
  });
});
