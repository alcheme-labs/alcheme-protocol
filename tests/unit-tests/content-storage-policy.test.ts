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

describe("Task0 batch2 conservative gate: storage policy alignment", () => {
  const storageGuide = read("sdk/STORAGE_GUIDE.md");
  const sdkContent = read("sdk/src/modules/content.ts");
  const instructionsRs = read("programs/content-manager/src/instructions.rs");

  it("SDK should explicitly reject unsupported private URI in v1 with clear no-fallback errors", () => {
    expect(sdkContent).to.include("normalizeV1ExternalUri");
    expect(sdkContent).to.match(/not supported in v1/i);
    expect(sdkContent).to.match(/does not support silent fallback/i);
    expect(sdkContent).to.not.include("externalUri || null");
  });

  it("update_storage_info should bind content_storage to content_post", () => {
    const updateStorageInfoAccounts = section(
      instructionsRs,
      "pub struct UpdateStorageInfo<'info> {",
      "pub fn update_storage_info("
    );

    expect(updateStorageInfoAccounts).to.match(
      /constraint\s*=\s*content_storage\.content_id\s*==\s*content_post\.key\(\)/,
      "missing account binding constraint: content_storage.content_id == content_post.key()"
    );
  });

  it("migrate_storage_strategy should bind content_storage to content_post", () => {
    const migrateStorageStrategyAccounts = section(
      instructionsRs,
      "pub struct MigrateStorageStrategy<'info> {",
      "pub fn migrate_storage_strategy("
    );

    expect(migrateStorageStrategyAccounts).to.match(
      /constraint\s*=\s*content_storage\.content_id\s*==\s*content_post\.key\(\)/,
      "missing account binding constraint: content_storage.content_id == content_post.key()"
    );
  });

  it("STORAGE_GUIDE should document strict v1 policy and no silent fallback", () => {
    expect(storageGuide).to.include("v1 URI 策略（严格模式）");
    expect(storageGuide).to.include("私有/自定义 URI（例如 `https://...`）在 v1 中不支持");
    expect(storageGuide).to.include("不会做 silent fallback");
    expect(storageGuide).to.include("若要使用私有/自定义 URI，请走 v2 路径");
  });
});
